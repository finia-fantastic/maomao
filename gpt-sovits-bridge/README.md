# GPT-SoVITS ↔ AIRI TTS 转接

把本地 **GPT-SoVITS**（`api_v2.py`）的语音合成，接成 AIRI 能直接用的 **OpenAI 兼容 TTS** 接口。
这样角色就能用你训练好的 **小野寺小咲** 音色读文字，不用改 AIRI 的任何代码。

## 它做什么

```
AIRI 渲染进程
  --POST /v1/audio/speech {model,input,voice}-->  bridge.mjs (:9881)
  --POST /tts {text,ref_audio_path,prompt_text,...}-->  GPT-SoVITS api_v2.py (:9880)
  <--WAV bytes--  <--WAV bytes--  → decodeAudioData 播放 + 对口型
```

零依赖，只用 Node 内置 `http` + 全局 `fetch`（Node 18+）。

## 前置

1. GPT-SoVITS 整合包已解压，`.ckpt`(GPT) / `.pth`(SoVITS) 已放进对应 weights 目录，并在 WebUI 里选好。
2. `api_v2.py` 已启动，监听 `127.0.0.1:9880`。
3. 一段 **3–10 秒干净参考音频**（wav 最佳）**加上它的逐字文本**（`REF_TEXT`，必填）。

## 用法

```bash
# REF_TEXT 必须是参考音频里“说的那句话”的原文，否则音色会明显变差
REF_TEXT="参考音频里那句话的原文" node gpt-sovits-bridge/bridge.mjs
```

全部可用环境变量（都有默认值，按本机设好了，通常只需补 `REF_TEXT`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `REF_TEXT` | *(空，必填)* | 参考音频的逐字文本 |
| `REF_AUDIO` | `I:/download/小野寺小咲_V2ProPlus/小野寺小咲_参考音频.wav` | 参考音频路径 |
| `REF_LANG` | `ja` | 参考文本语言（zh/en/ja/ko/yue/auto）；声源是日文小野寺小咲 |
| `TEXT_LANG` | `ja` | **默认**合成语言；单次请求可被 AIRI 的 voice 字段覆盖（见下） |
| `GSV_API` | `http://127.0.0.1:9880` | GPT-SoVITS api_v2.py 地址 |
| `BRIDGE_PORT` | `9881` | 本转接监听端口 |
| `CUT_METHOD` | `cut5` | 断句方式（按标点切，停顿最自然） |

启动后自检：浏览器/命令行访问 `http://127.0.0.1:9881/health` 应返回 `{ ok: true, ... }`。

## 语言选择（挂在 AIRI 的 voice 字段上）

转接把 AIRI 每次请求带的 `voice` 字段当**语言开关**：填 `zh`/`ja`/`auto` 就切对应合成语言，填别的（或不填）就用默认 `TEXT_LANG`（当前 `ja`）。

- 现在：AIRI voice 留空或填 `ja` → 说**日语**（音质最好，声源就是日文训练的）。
- 以后想切中文：把 AIRI 语音设置里的 voice 改成 `zh` → **说中文，不用重启转接、不用改代码**。

> 注意：日文音源读中文会带日式口音，属正常；要纯正中文得另训中文模型。

## 在 AIRI 里配置

设置 → 模块 → 语音 → 选 **OpenAI 兼容 TTS**（`openai-compatible-audio-speech`）：

- **Base URL**：`http://127.0.0.1:9881/v1/`
- **API Key**：随便填（本地不校验，但字段可能必填）
- **Model**：随便填（转接忽略）
- **Voice**：填 `ja`（说日语）；以后想说中文改成 `zh`

配好后在语音测试里试一句，能听到小野寺小咲的声音即成功。

## 排错

- `502 ... is api_v2.py running?` → GPT-SoVITS 没起来或端口不对，检查 `GSV_API`。
- 声音不像 → `REF_TEXT` 跟音频对不上，或参考音频有杂音/太短。
- AIRI 里没声音但 `/health` 正常 → 检查 AIRI 语音 provider 的 Base URL 是否带 `/v1/`。
