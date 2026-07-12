// NOTICE:
// Bridge from AIRI's renderer to the user's external web app (a Vite React SPA served
// at WEBPAGE_URL) over a plain window.postMessage envelope — intentionally NOT AIRI's
// internal @moeru/eventa gamelet protocol, so the SPA stays decoupled and can be authored
// with a few lines of vanilla JS.
//
// Envelope (both directions carry `__airi: true`):
//   AIRI -> SPA : { __airi, kind: 'request',  id, action, params }
//   SPA  -> AIRI: { __airi, kind: 'response', id, ok, result | error }
//   SPA  -> AIRI: { __airi, kind: 'ready' }   // announced once the SPA's handler is live
//
// The SPA is mounted in a hidden iframe on first use: the bridge only needs the SPA's
// message handler, not its UI. Showing the SPA as a visible panel is a separate feature.

const WEBPAGE_URL = 'http://localhost:5199'
const READY_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 60_000

interface AiriInboundMessage {
  __airi?: true
  kind?: 'response' | 'ready'
  id?: string
  ok?: boolean
  result?: unknown
  error?: string
}

let iframe: HTMLIFrameElement | null = null
let ready = false
let readyWaiters: Array<() => void> = []
const pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()

function markReady() {
  if (ready) {
    return
  }
  ready = true
  const waiters = readyWaiters
  readyWaiters = []
  waiters.forEach(waiter => waiter())
}

function handleMessage(event: MessageEvent) {
  const message = event.data as AiriInboundMessage | undefined
  if (!message || message.__airi !== true) {
    return
  }

  if (message.kind === 'ready') {
    markReady()
    return
  }

  // Correlate responses to their pending request by id; ignore anything unmatched
  // (e.g. a late response after a timeout already rejected the caller).
  if (message.kind === 'response' && message.id) {
    const waiter = pending.get(message.id)
    if (!waiter) {
      return
    }
    pending.delete(message.id)
    if (message.ok) {
      waiter.resolve(message.result)
    }
    else {
      waiter.reject(new Error(message.error ?? `webpage action failed`))
    }
  }
}

function ensureIframe() {
  if (iframe) {
    return
  }

  // Register the listener before the iframe loads so we never miss the 'ready' event.
  window.addEventListener('message', handleMessage)

  iframe = document.createElement('iframe')
  iframe.src = WEBPAGE_URL
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;border:0;visibility:hidden;'

  // Fallback readiness: the SPA is expected to emit an explicit 'ready' once its handler
  // is registered. If it doesn't, assume readiness a short grace after the document loads
  // — the grace lets a client-rendered (React) app mount and register its message handler
  // before the first request is sent. `markReady` is idempotent, so whichever fires first
  // (explicit 'ready' or this timer) wins.
  iframe.addEventListener('load', () => {
    setTimeout(markReady, 1500)
  })

  document.body.appendChild(iframe)
}

function waitForReady(): Promise<void> {
  if (ready) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter(waiter => waiter !== onReady)
      reject(new Error(`Webpage did not become ready within ${READY_TIMEOUT_MS}ms — is it running at ${WEBPAGE_URL}?`))
    }, READY_TIMEOUT_MS)

    const onReady = () => {
      clearTimeout(timer)
      resolve()
    }
    readyWaiters.push(onReady)
  })
}

/**
 * Invokes one action registered by the user's embedded web app and resolves with its
 * JSON-safe result. Lazily mounts the SPA iframe, waits for it to signal readiness, then
 * sends a correlated postMessage request and awaits the matching response.
 *
 * @param action - One of the SPA's registered action ids (e.g. `stock.quote`, `tts`).
 * @param params - JSON-safe arguments for the action; `{}` when none are needed.
 * @throws if the SPA never becomes ready, the action rejects, or the request times out.
 */
export async function callWebpage(action: string, params: Record<string, unknown>): Promise<unknown> {
  ensureIframe()
  await waitForReady()

  const id = crypto.randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`Webpage action "${action}" timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })

    iframe!.contentWindow?.postMessage({ __airi: true, kind: 'request', id, action, params }, '*')
  })
}
