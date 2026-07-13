# AIRI 桌宠定制 · 进度记录

> 个人定制分支：把 AIRI 精简成**纯桌面版**，做成一个叫 **Niko（猫猫）** 的桌宠——会说话（小野寺小咲音色）、能聊天（DeepSeek）、能读单词库、能调网页工具、会跳舞。
> 分支：`admin/chore/desktop-only-slim`（基于 `main`，本地，未 push）
> 最后更新：2026-07-12（对话进行中）
> **GitHub**：已作为新项目上传到 **https://github.com/finia-fantastic/maomao**（分支 `maomao-main` → 远程 `main`，干净单提交 `886e11a`，排除了 155M 素材文件夹，扫描确认无密钥）。
> ⚠️ 上传**之后**又加的（`sync-dances.mjs` + 动作/ 投放工作流 + 5 支舞 + 背单词 PYTHONUTF8 修复）**尚未推到 GitHub**，还在本地工作树；要同步需再 `commit` + `git push maomao maomao-main:main`。

---

## ✅ 已完成（分支上 5 个提交）

| 提交 | 内容 |
|---|---|
| `6c69163` | **精简为纯桌面版**：删掉 web/pocket/ui-server-auth/component-calling、16 个包、全部 services & plugins、docs、Nix 构建链、web/pocket CI 工作流。保留 `apps/server` + `packages/server-schema` 仅作 stage-ui 的**编译期类型依赖**。修好根配置（package.json 脚本、vitest/eslint/bump、turbo）。 |
| `fb4c935` | **修复图标不显示**：`presetIcons` 自动加载器在本机 pnpm 布局下失效 → 在 `uno.config.ts` 显式注册 `@iconify-json/*` 集合 + 加 `.npmrc` 的 `public-hoist-pattern`。 |
| `1a712b1` | **控制栏"打开网页"按钮**：展开菜单里那个按钮改成打开 `WEBPAGE_URL`（系统浏览器），换成地球图标。 |
| `b614192` | **单词库联动**：桌宠能读外部 Python 背单词 App 的 `words.db`。主进程用 Node 24 内置 `node:sqlite` 只读查询；AI 工具 `get_vocabulary_progress`。已验证（typecheck + 运行时读真实库 + 启动无错）。 |
| `9589a1c` | **网页工具联动**：AI 工具 `call_webpage_tool` 通过隐藏 iframe + `postMessage` 双向调用用户的本地 React SPA（localhost:5199）的 8 个 action。已用 Playwright 合约测试实拿真实数据验证。 |

---

## ⚠️ 本机运行要点（重要，不然跑不起来）

1. **启动桌面版必须去掉 `ELECTRON_RUN_AS_NODE`**（Claude Code 自身给子进程设了它，会让 electron 退化成 node）：
   ```bash
   env -u ELECTRON_RUN_AS_NODE pnpm dev:tamagotchi
   ```
2. **electron 安装曾反复损坏**（pnpm side-effects-cache 缓存了残缺的 electron 快照）。若 `pnpm install` 报 `ENOENT .../electron/package.json`：先 `taskkill //F //IM electron.exe`，删 `node_modules/.pnpm/electron@*`，再 `pnpm install --config.side-effects-cache=false`。
3. 图标依赖 `.npmrc` 的 hoist + `uno.config.ts` 的显式注册（已提交）。

---

## 🚧 进行中 / 待办

### 1. 角色说话（TTS）—— ✅ 后端已跑通并调优（2026-07-12）

**声源**：GPT-SoVITS v2ProPlus 训练模型（小野寺小咲，日文训练），`.ckpt`(GPT)+`.pth`(SoVITS)。

**完整链路已跑通**（全部在本机 `I:\GPT-SoVITS\`）：
- 官方整合包 `GPT-SoVITS-v2pro-20250604`（自带便携 Python + torch 2.0.0+cu118，特意保留对老显卡 Maxwell 的支持）解压在 `I:\GPT-SoVITS\GPT-SoVITS-v2pro-20250604\`。
- 用户模型已放进 `GPT_weights_v2ProPlus/` + `SoVITS_weights_v2ProPlus/`；`GPT_SoVITS/configs/tts_infer.yaml` 的 `custom` 段指向它们（`device:cuda`, `is_half:false` —— Maxwell 的 fp16 又慢又不稳，用 fp32）。
- 参考音频：`I:\GPT-SoVITS\asr_in\ref.wav`（7.44s 干净人声，从用户 mp3 转），参考文本用 faster-whisper-small 转出的日文（见 bridge 里 `refText`）。
- **GPU 验证通过**：Quadro M6000（Maxwell sm_52）能跑；api_v2.py 加载模型 + `/tts` 合成均成功。
- 转接 `gpt-sovits-bridge/bridge.mjs`（仓库内，零依赖）：OpenAI `/v1/audio/speech` ↔ GPT-SoVITS `/tts`。含**语言选择**（AIRI 的 voice 字段填 `ja/zh/auto` 切换，默认 `ja`）+ **调优采样参数**（用户 A/B 选定的 "v3"：temperature 0.7 / top_k 10 / top_p 0.8 / 重复惩罚 1.5 / 语速 1.05，压住默认那种"断气/漏气"尾音）。
- **一键启动**：`I:\GPT-SoVITS\启动语音后端.bat`（起 api_v2.py + bridge）。

**怎么用**：双击 `启动语音后端.bat` → 两个服务起来（9880 推理 + 9881 转接）→ AIRI 设置里配 **OpenAI 兼容 TTS**，Base URL 填 `http://127.0.0.1:9881/v1/`，voice 填 `ja`。

**✅ 已接入 AIRI**：设置里配了 OpenAI 兼容 TTS（Base URL `http://127.0.0.1:9881/v1/`，voice `ja`），聊天里 Niko 会用小野寺小咲音色说话。**待办**：想更像/换中文可换 large-v3 重转参考文本（large-v3 已下好在 `I:\GPT-SoVITS\whisper-large-v3\`）。

### 2. 唱歌 —— 暂缓（用户说先不做）
AIRI 无内置歌声合成。可行路径：用户提供预渲染歌声音频文件 → 走现有 audio→lip-sync 通道播放。

### 3. 网页"内嵌可视面板" —— 可选后续
目前网页是隐藏 iframe（只为让 AI 能调用）。若想在 AIRI 窗口里**看到**网页界面，是另一个小活。

### 4. 配置 LLM —— ✅ 已配（DeepSeek）
设置里配了 **DeepSeek**（用"OpenAI 兼容 API"聊天类，Base URL `https://api.deepseek.com/v1`，model `deepseek-chat`）。Niko 能聊天，回复会用小咲音色读出来。⚠️ DeepSeek **不能看图**——将来"视觉"功能要另配视觉模型。

### 5. 跳舞（VRM）—— ✅ 已做（工作树未提交）
- 跳舞系统合入主项目（来自 agent 工作树 `agent-a12c24eb7f28a0e1d`）：`VRMModel.playAnimation`（crossFade 进舞，跳完 `stop()` **硬切回 idle**——修了"跳一次就卡在最后一帧、之后跳不了"的 bug）、LLM 工具 `vrm_play_animation`/`vrm_list_animations`、model-store `requestGesturePlay`、ThreeScene watcher。
- **多舞蹈 + 投放文件夹工作流**：用户把整个舞蹈包**文件夹**丢进根目录 `动作/`（gitignore，不入库）；根目录 `sync-dances.mjs` 递归找每个包里的 `.vrma`、按**包文件夹名**复制进 `packages/stage-ui-three/src/assets/vrm/animations/dances/`（`import.meta.glob` 自动注册；带清理，改名/删包不留垃圾）。`run_pet.bat` 启动时自动跑同步。**加舞 = 丢文件夹进 动作/ + 把文件夹改成想喊的简体名 + 双击 run_pet.bat**。现有 5 支：刀p、心予报、快乐合成器、最上级的可爱、露露卡。
- **跳舞触发靠关键词**（不靠 DeepSeek 自觉）：`chat-sync.ts` 的 `maybeTriggerDance()`——用户消息含"跳"+（"舞"或某舞名）就**直接**播放。**原因**：AIRI 人设提示词太入戏，DeepSeek 只会用文字"演"跳舞、不去调工具。说"跳个舞"随机、"跳刀p"/"跳露露卡"指定。
- 只支持 **VRM(3D)**，Live2D 不行。用户舞蹈素材在 `C:\Users\Administrator\airi-app\动作\`（MMD 包，含 vmd/fbx/vrma；**只用 vrma**，vmd 是 MMD 骨骼不能直接用）。

### 6. 手持道具（相机）—— ✅ 已做但暂关（工作树未提交）
- `packages/stage-ui-three/src/composables/vrm/handProp.ts`（来自 agent 工作树 `agent-acbf46921a2fee5d1`）：把 glb 道具挂到 VRM 手骨、跟手动。支持双手（`HAND_PROP_BONES`）。
- 相机模型 `camera.glb`（Canon AT-1，从用户 FBX/.blend 用 Blender 转、贴图降 1K）在 `packages/stage-ui-three/src/assets/vrm/props/`。
- **开关 `ATTACH_HAND_PROP` 当前 = `false`**（用户说先放下）。改 `true` + 重启即挂回；握持位置 `HAND_PROP_POSITION_OFFSET` 等真机调。

### 7. 背单词按钮 —— ✅ 已做（工作树未提交）
控制栏展开菜单：删了"移到屏幕中心"，加了"背单词"按钮（`i-solar:notebook-linear`）→ 主进程 spawn `pythonw mainv10.py` 启动用户的 Python 背单词程序。契约 `electronOpenVocabApp`（`src/shared/eventa`），handler `openVocabApp()` 在 `src/main/services/airi/vocab-db/index.ts`，按钮在 `controls-island/index.vue`。⚠️ **关键坑（已修）**：mainv10.py 顶部有 `print("✅…")`，Node spawn 下 stdout 是 GBK 编码、编不出 ✅ emoji → 启动即崩（点按钮"没反应"）。修法：spawn 时传 `env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }`（不动 mainv10.py）。⚠️ 写死用户路径 `C:\Users\Administrator\Desktop\代码\01英语单词app\mainv10.py`（`mainv10.py` 是当前成品版，其它 mainv* 作废），发给别人无效。

### 8. 开机自动同步音律（beat-sync）—— 🔬 agent 做完，未合入
工作树 `agent-ae5e1b166ae1500f7`：加"开机自动挂系统声音律动"开关，复用 `electron-screen-capture` 的 loopback（不弹选择器抓系统声音）。**待合入主项目**。（同步音律=beat-sync=跟着音乐律动身体，非唱歌。）

### 9. 已研究待拍板（方案见对话/记忆）
- **视觉+主动对话**（看桌面、主动搭话）：AIRI 几乎全现成（截屏/VLM/spark:notify 主动说话/TTS），接线活；需视觉模型（DeepSeek 不行）。
- **游戏观战陪聊**：复用视觉；重度玩法（Minecraft/computer-use）可从 `6c69163^` 恢复。
- **MediaCrawler**（小红书/抖音/B站等抓取）：推荐现成 MCP server 挂 `mcp.json` 起步（AIRI MCP 通道零改动即插即用）。

---

## 🚀 怎么跑（重要：谁来启动）

**关键教训**：从 Claude Code 的自动化环境启动 electron/python **常驻**进程，会在会话边界被系统掐掉（污染环境 + 子进程回收）；**由用户在干净环境双击 `.bat` 启动才稳**。所以日常启动交给用户双击。（Claude 侧若要临时拉起，`cmd //c start "" run_pet.bat` 独立窗口方式最能存活。）

- **桌宠**：双击 `C:\Users\Administrator\airi-app\run_pet.bat`（纯 ASCII，清了 `ELECTRON_RUN_AS_NODE`，跑 `pnpm dev:tamagotchi`）。黑窗口别关。
- **语音后端**：双击 `I:\GPT-SoVITS\run_voice.bat`（起 api_v2.py:9880 + bridge:9881）。黑窗口别关。
- ⚠️ **中文名的 .bat**（`启动桌宠.bat`/`启动语音后端.bat`）在 GBK cmd 下**会乱码报错**——用上面**英文名**的 `run_pet.bat`/`run_voice.bat`。
- 改了**主进程代码**（如背单词按钮）或加了**新 .vrma** 要**重启桌宠**；纯渲染改动 Vite HMR 多能热更。

```bash
# 装依赖（本机 electron 缓存易坏，见上面"运行要点2"）
pnpm install
# 类型检查 / lint
pnpm -F @proj-airi/stage-ui-three typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm lint
```

---

## 📁 新功能关键文件（都在 `apps/stage-tamagotchi/`）
- 单词库：`src/main/services/airi/vocab-db/index.ts`（node:sqlite 读 words.db）、`src/shared/eventa/index.ts`（`electronVocabStats`）、`src/renderer/stores/tools/builtin/vocabulary.ts`
- 网页联动：`src/renderer/stores/tools/builtin/webpage-bridge.ts`（iframe+postMessage 桥）、`webpage.ts`（`call_webpage_tool`）
- 工具注册：`src/renderer/stores/chat-sync.ts`（`resolveTools`）
- "打开网页"按钮 & `WEBPAGE_URL`：`src/renderer/components/stage-islands/controls-island/index.vue`

### 网页 SPA 侧协议（用户的 React app 已实现）
`postMessage` 信封：`{__airi:true, kind:'request'|'response'|'ready', id, action, params, ok, result|error}`。
已注册 8 个 action：`chat{model,messages[]}` · `stock.quote{code}` · `stock.kline{code,days?}` · `design.fetch{url}` · `design.imageSearch{query}` · `design.crawlImages{url}` · `tts{model,text,voice?}` · `characters.list{}`。
