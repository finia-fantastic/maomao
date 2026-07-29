/**
 * Subtitle Overlay Window — transparent bar at screen bottom.
 * Shows AI responses as game-like subtitles with typing animation.
 */

import type { Rectangle } from 'electron'

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'

const SUBTITLE_HEIGHT = 160
const BOTTOM_MARGIN = 70

let win: BrowserWindow | null = null

function getWorkArea(): Rectangle {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
}

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:"Microsoft YaHei","PingFang SC",sans-serif;overflow:hidden;user-select:none}
.s{max-width:95%;padding:12px 24px;font-size:30px;line-height:1.5;color:#fff;text-align:center;pointer-events:auto;text-shadow:-1px -1px 0 #000000aa,1px -1px 0 #000000aa,-1px 1px 0 #000000aa,1px 1px 0 #000000aa;background:rgba(0,0,0,0.32);border-radius:12px;white-space:pre-wrap;word-break:break-word;cursor:pointer;display:none}
.s.on{display:block}.c{display:inline-block;width:2px;height:24px;background:#fffa;margin-left:2px;vertical-align:text-bottom;animation:b .6s infinite}@keyframes b{50%{opacity:0}}
.i{display:none;margin-top:12px;gap:8px;align-items:center}.i.on{display:flex}
.i input{width:300px;padding:8px 14px;font-size:16px;border:none;border-radius:10px;background:rgba(30,30,40,.85);color:#fff;outline:none}
.i input::placeholder{color:#888}
.i button{padding:8px 16px;border:none;border-radius:10px;background:#6366f1;color:#fff;font-size:15px;cursor:pointer}
</style></head><body>
<div id="s" class="s"><span id="t"></span><span id="c" class="c"></span></div>
<div id="i" class="i"><input id="inp" placeholder="输入消息..."><button onclick="send()">发送</button></div>
<script>
const s=document.getElementById('s'),t=document.getElementById('t'),c=document.getElementById('c'),i=document.getElementById('i'),inp=document.getElementById('inp')
let tt=null,ht=null,ft='',ci=0
function showSubtitle(text){
  ft=text;ci=0;t.textContent='';s.classList.add('on');c.style.display='inline-block'
  if(tt)clearInterval(tt);if(ht)clearTimeout(ht)
  tt=setInterval(()=>{ci+=2
    if(ci>=ft.length){t.textContent=ft;c.style.display='none';clearInterval(tt);tt=null
      ht=setTimeout(hideSubtitle,Math.min(ft.length*100,12000));return}
    t.textContent=ft.slice(0,ci)
    if(/[，。！？、；：]/.test(ft[ci-1]||''))ci--},45)}
function hideSubtitle(){if(tt)clearInterval(tt);if(ht)clearTimeout(ht);s.classList.remove('on');t.textContent=''}
function showInput(){i.classList.add('on');inp.value='';inp.focus()}
function hideInput(){i.classList.remove('on');inp.value=''}
function send(){const tx=inp.value.trim();if(!tx)return;inp.value='';i.classList.remove('on')
  try{window.electron.ipcRenderer.invoke('subtitle:send-message',tx)}catch(e){}}
s.onclick=()=>{if(ci<ft.length){t.textContent=ft;c.style.display='none';clearInterval(tt);tt=null}else hideSubtitle()}
inp.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();send()}if(e.key==='Escape')hideInput()}
</script></body></html>`

// Write HTML to temp file so preload script works
const HTML_PATH = join(tmpdir(), 'airi-subtitle.html')

export async function createSubtitleWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win

  // Write HTML once
  writeFileSync(HTML_PATH, HTML, 'utf-8')

  const workArea = getWorkArea()
  const width = Math.min(Math.round(workArea.width * 0.65), 1200)
  const x = workArea.x + Math.round(workArea.width * 0.15)
  const y = workArea.y + workArea.height - SUBTITLE_HEIGHT - BOTTOM_MARGIN

  win = new BrowserWindow({
    x, y, width, height: SUBTITLE_HEIGHT,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, focusable: false,
    hasShadow: false,
    webPreferences: { sandbox: false, preload: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preload', 'index.mjs') },
  })

  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true)

  await win.loadFile(HTML_PATH)

  ipcMain.handle('subtitle:show', (_e, text) => {
    win?.webContents.executeJavaScript(`showSubtitle(${JSON.stringify(text)})`)
  })
  ipcMain.handle('subtitle:hide', () => {
    win?.webContents.executeJavaScript('hideSubtitle()')
  })
  ipcMain.handle('subtitle:show-input', () => {
    win?.setIgnoreMouseEvents(false); win?.setFocusable(true); win?.focus()
    win?.webContents.executeJavaScript('showInput()')
  })
  ipcMain.handle('subtitle:hide-input', () => {
    win?.setIgnoreMouseEvents(true, { forward: true }); win?.setFocusable(false)
    win?.webContents.executeJavaScript('hideInput()')
  })
  ipcMain.handle('subtitle:send-message', (_e, text) => {
    const main = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== win && w.getTitle() === 'AIRI')
    main?.webContents.send('subtitle:incoming-message', text)
    return { ok: true }
  })

  win.on('closed', () => { win = null })
  return win
}

export function getSubtitleWindow() { return win && !win.isDestroyed() ? win : null }

export function setupSubtitleIPC() {
  globalShortcut.register('Ctrl+Alt+Space', () => {
    const w = getSubtitleWindow()
    if (!w) return
    if (w.isFocused()) w.webContents.executeJavaScript('hideInput()')
    else { w.setIgnoreMouseEvents(false); w.setFocusable(true); w.focus(); w.webContents.executeJavaScript('showInput()') }
  })
}
