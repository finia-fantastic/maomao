// NOTICE:
// Standalone TTS bridge: exposes an OpenAI-compatible `/v1/audio/speech` endpoint
// and forwards each request to a running GPT-SoVITS `api_v2.py` server (`/tts`).
//
// Why this exists:
//   AIRI's speech module (@xsai/generate-speech) speaks the OpenAI Audio Speech
//   contract — `POST {baseURL}audio/speech` with `{ model, input, voice }`, and it
//   decodes whatever bytes come back via Web Audio `decodeAudioData`. GPT-SoVITS
//   speaks its own `/tts` contract (text/text_lang/ref_audio_path/prompt_text/...)
//   and returns raw WAV. This process is the thin adapter between the two, so the
//   user's locally-trained 小野寺小咲 voice can drive AIRI with zero app changes.
//
// Runtime: Node 18+ (uses the global `fetch`), no npm dependencies.
//
// Data flow:
//   AIRI renderer
//     --POST http://127.0.0.1:9881/v1/audio/speech {model,input,voice}-->
//   this bridge
//     --POST http://127.0.0.1:9880/tts {text,ref_audio_path,prompt_text,...}-->
//   GPT-SoVITS api_v2.py  --WAV bytes--> bridge --WAV bytes--> AIRI --decodeAudioData

import { createServer } from 'node:http'
import process from 'node:process'

/**
 * Bridge configuration. Every field is overridable by an environment variable so the
 * script itself never needs editing, but the defaults are filled in for this machine's
 * setup so `node bridge.mjs` works once REF_TEXT is provided.
 */
const CONFIG = {
  /** Address this bridge listens on. AIRI's TTS baseURL should point here + `/v1/`. */
  host: process.env.BRIDGE_HOST ?? '127.0.0.1',
  port: Number(process.env.BRIDGE_PORT ?? 9881),

  /** Base URL of the running GPT-SoVITS api_v2.py server (no trailing slash). */
  gsvApi: (process.env.GSV_API ?? 'http://127.0.0.1:9880').replace(/\/+$/, ''),

  /**
   * Reference audio for zero-shot cloning. GPT-SoVITS needs BOTH the audio file and
   * the exact transcript of what is spoken in it (`refText`); a wrong transcript
   * noticeably degrades timbre/prosody. Points at the ASCII-named working copy
   * (I:/GPT-SoVITS/asr_in/ref.wav) rather than the original Chinese-named file, so the
   * path survives the api_v2.py request without any codepage ambiguity.
   */
  refAudio: process.env.REF_AUDIO ?? 'I:/GPT-SoVITS/asr_in/ref.wav',
  // Reference transcript for the clip above, produced by faster-whisper (small, ja).
  // The small model can miss a character or two; re-transcribe with large-v3 and update
  // this string if the cloned voice quality is off.
  refText: process.env.REF_TEXT ?? 'ダメダメだよ バイキン入ったらどうするのほら切り裂きさん切り裂きさんが来てほしいって',

  // Language of the reference transcript. The reference clip is Japanese (小野寺小咲),
  // so this defaults to `ja`; the synthesized-text language (textLang) is independent.
  refLang: process.env.REF_LANG ?? 'ja',
  /**
   * Default language of the text to synthesize, used when the request doesn't select one.
   * The voice model is Japanese, so `ja` gives the most natural output today. This is only
   * the fallback: a request may override it per-call via its `voice` field (see LANG_CODES),
   * which is how the user switches to Chinese later without touching this file.
   */
  textLang: process.env.TEXT_LANG ?? 'ja',

  /**
   * Sentence-splitting strategy passed through to GPT-SoVITS. `cut5` splits on
   * punctuation, which gives the most natural pauses for chat-length replies.
   */
  cutMethod: process.env.CUT_METHOD ?? 'cut5',
}

/**
 * GPT-SoVITS language codes accepted as an override. AIRI's per-request `voice` field is
 * repurposed as a language selector: setting the AIRI voice to one of these switches the
 * synthesis language live (no restart), and anything else falls back to CONFIG.textLang.
 */
const LANG_CODES = new Set(['zh', 'en', 'ja', 'ko', 'yue', 'auto'])

/**
 * Resolves the synthesis language for one request. The OpenAI `voice` field doubles as a
 * language selector so the user can switch zh/ja/auto from AIRI's own settings UI; when it
 * isn't a recognized code we keep the configured default (Japanese for this voice model).
 */
function resolveTextLang(voice) {
  const v = typeof voice === 'string' ? voice.trim().toLowerCase() : ''
  return LANG_CODES.has(v) ? v : CONFIG.textLang
}

/**
 * Sampling parameters for GPT-SoVITS inference, tuned to reduce the breathy / "gasping"
 * tail that the default settings produced with this voice model. These are the values the
 * user A/B-picked ("v3"): a lower temperature/top_p plus a higher repetition penalty keep
 * phrase endings crisp instead of trailing off into breath, and a slightly >1 speed avoids
 * dragging. Overridable via env for future retuning without touching code.
 */
const SAMPLING = {
  temperature: Number(process.env.GSV_TEMPERATURE ?? 0.7),
  topK: Number(process.env.GSV_TOP_K ?? 10),
  topP: Number(process.env.GSV_TOP_P ?? 0.8),
  repetitionPenalty: Number(process.env.GSV_REPETITION_PENALTY ?? 1.5),
  defaultSpeed: Number(process.env.GSV_SPEED ?? 1.05),
}

/**
 * Builds the GPT-SoVITS `/tts` request body for one utterance.
 *
 * @param input - The text AIRI wants spoken.
 * @param speed - Playback speed factor from the OpenAI `speed` field; falls back to the
 *   tuned default when AIRI omits it (which it does on most calls).
 * @param textLang - Resolved synthesis language code (see resolveTextLang).
 */
function buildTtsBody(input, speed, textLang) {
  // GPT-SoVITS rejects speed_factor <= 0; use the tuned default when unspecified.
  const speedFactor = Number.isFinite(speed) && speed > 0 ? speed : SAMPLING.defaultSpeed
  return {
    text: input,
    text_lang: textLang,
    ref_audio_path: CONFIG.refAudio,
    prompt_text: CONFIG.refText,
    prompt_lang: CONFIG.refLang,
    text_split_method: CONFIG.cutMethod,
    batch_size: 1,
    media_type: 'wav',
    streaming_mode: false,
    speed_factor: speedFactor,
    temperature: SAMPLING.temperature,
    top_k: SAMPLING.topK,
    top_p: SAMPLING.topP,
    repetition_penalty: SAMPLING.repetitionPenalty,
    parallel_infer: true,
  }
}

/** Permissive CORS so the Electron renderer (custom origin) can call this local bridge. */
function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  withCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

/** Reads a full request body as a UTF-8 string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleSpeech(req, res) {
  const raw = await readBody(req)
  let payload
  try {
    payload = JSON.parse(raw || '{}')
  }
  catch {
    sendJson(res, 400, { error: `Invalid JSON body: ${raw}` })
    return
  }

  const input = typeof payload.input === 'string' ? payload.input.trim() : ''
  if (!input) {
    sendJson(res, 400, { error: 'Missing "input" text.' })
    return
  }

  const ttsBody = buildTtsBody(input, Number(payload.speed), resolveTextLang(payload.voice))

  let upstream
  try {
    upstream = await fetch(`${CONFIG.gsvApi}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsBody),
    })
  }
  catch (err) {
    // Connection refused / DNS — almost always "api_v2.py isn't running".
    sendJson(res, 502, {
      error: `Cannot reach GPT-SoVITS at ${CONFIG.gsvApi} — is api_v2.py running? (${err?.message ?? err})`,
    })
    return
  }

  const contentType = upstream.headers.get('content-type') ?? ''

  // GPT-SoVITS returns audio bytes on success and a JSON `{message}` on failure.
  // Anything non-2xx or JSON-shaped is an upstream synthesis error we surface verbatim.
  if (!upstream.ok || contentType.includes('application/json')) {
    const errText = await upstream.text().catch(() => '')
    sendJson(res, 502, {
      error: `GPT-SoVITS /tts failed (HTTP ${upstream.status}): ${errText || contentType}`,
    })
    return
  }

  const audio = Buffer.from(await upstream.arrayBuffer())
  withCors(res)
  // WAV is decodable by the renderer's decodeAudioData; keep the upstream type if given.
  res.writeHead(200, {
    'Content-Type': contentType || 'audio/wav',
    'Content-Length': String(audio.length),
  })
  res.end(audio)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${CONFIG.host}:${CONFIG.port}`)

  if (req.method === 'OPTIONS') {
    withCors(res)
    res.writeHead(204)
    res.end()
    return
  }

  // Accept the endpoint both with and without the OpenAI `/v1` prefix, so the AIRI
  // baseURL can be `http://127.0.0.1:9881/v1/` (conventional) or `http://127.0.0.1:9881/`.
  if (req.method === 'POST' && url.pathname.endsWith('/audio/speech')) {
    handleSpeech(req, res).catch(err => sendJson(res, 500, { error: err?.message ?? String(err) }))
    return
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    sendJson(res, 200, {
      ok: true,
      bridge: 'gpt-sovits-openai',
      gsvApi: CONFIG.gsvApi,
      refAudio: CONFIG.refAudio,
      refTextConfigured: Boolean(CONFIG.refText),
      textLang: CONFIG.textLang,
    })
    return
  }

  sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` })
})

// Fail fast with a clear message instead of producing silent, low-quality audio.
if (!CONFIG.refText) {
  console.error('[bridge] REF_TEXT is empty. Set it to the exact words spoken in the reference audio,')
  console.error('[bridge] e.g.  REF_TEXT="……" node bridge.mjs   (or edit CONFIG.refText in bridge.mjs)')
  process.exit(1)
}

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[bridge] OpenAI→GPT-SoVITS TTS bridge listening on http://${CONFIG.host}:${CONFIG.port}`)
  console.log(`[bridge]   AIRI OpenAI-compatible TTS baseURL -> http://${CONFIG.host}:${CONFIG.port}/v1/`)
  console.log(`[bridge]   forwarding to GPT-SoVITS           -> ${CONFIG.gsvApi}/tts`)
  console.log(`[bridge]   ref audio: ${CONFIG.refAudio}`)
  console.log(`[bridge]   ref text : ${CONFIG.refText}`)
  console.log(`[bridge]   languages: ref=${CONFIG.refLang}  synth default=${CONFIG.textLang} (override per-call via AIRI "voice" = zh/ja/auto)`)
})
