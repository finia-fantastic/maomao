import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

const drawSvgParams = z.object({
  svg: z.string().describe('Complete SVG markup. Use viewBox="0 0 800 600", include all paths/circles/rects. Keep strokes clean and colors simple.'),
  description: z.string().describe('Short Chinese description of what you drew.'),
})

/**
 * AI draws vector SVG art — the LLM generates SVG paths directly.
 * The SVG is saved to a file and displayed in chat.
 * Each "stroke" is an SVG element (path, circle, rect, line, etc.).
 */
async function executeDrawSvg(input: { svg: string, description: string }): Promise<string> {
  let svg = input.svg.trim()

  // Extract SVG if wrapped in markdown code blocks
  const match = svg.match(/<svg[\s\S]*?<\/svg>/i)
  if (match) svg = match[0]

  if (!svg.startsWith('<svg')) {
    return '❌ SVG 格式不正确。请提供完整的 <svg> 标签。'
  }

  try {
    // Save SVG to temp file
    const saved = await (window as any).electron.ipcRenderer.invoke('image:save-svg', {
      svg,
      name: `airi-svg-${Date.now()}.svg`,
    })
    const fileUrl = saved?.fileUrl

    // Also save to desktop
    let desktopPath = ''
    try {
      // btoa handles unicode by encoding to UTF-8 bytes first
      const base64 = btoa(unescape(encodeURIComponent(svg)))
      const ds = await (window as any).electron.ipcRenderer.invoke('image:save-to-desktop', {
        base64,
        name: `AI画作-${Date.now()}.svg`,
      })
      if (ds?.filePath) desktopPath = ds.filePath
    }
    catch { /* nice-to-have */ }

    const desc = input.description || 'AI 矢量绘图'
    let rsp = `${desc}\n\n<img src="${fileUrl}" alt="SVG矢量图" style="max-width:100%;border-radius:12px" />`
    if (desktopPath) rsp += '\n\n已保存SVG到桌面AI画作文件夹'

    return rsp
  }
  catch (e: any) {
    return `❌ SVG 保存失败：${e?.message || '未知错误'}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'draw_svg',
    description: [
      'Draw vector SVG art. You create the SVG markup yourself — each path/circle/rect/line is a "stroke".',
      '',
      'HOW TO DRAW:',
      '1. Think of what to draw (cat, flower, landscape, character face)',
      '2. Create SVG elements step by step:',
      '   - Background: <rect> or <circle>',
      '   - Lines: <path d="M x y L x y" stroke="black" fill="none" />',
      '   - Shapes: <circle>, <rect>, <ellipse>',
      '   - Details: more <path> elements with stroke-width',
      '3. Use viewBox="0 0 800 600" for a good canvas size',
      '4. Keep it simple — 5-15 elements is enough for a recognizable drawing',
      '',
      'COLORS: use hex values like stroke="#333" fill="#f0f0f0". Use warm, artistic colors.',
      'STYLE: clean line art style, stroke-width 2-4px, some filled shapes for color areas.',
      '',
      'SVG TIPS:',
      '- Circles for faces/eyes: <circle cx="400" cy="250" r="80" fill="none" stroke="#333" stroke-width="3"/>',
      '- Lines for mouths: <path d="M 370 280 Q 400 300 430 280" stroke="#333" stroke-width="2" fill="none"/>',
      '- Filled areas: <rect x="0" y="0" width="800" height="600" fill="#fff5f5"/>',
      '',
      'Use this when the user wants to see your drawing ability or needs vector art.',
      'DO NOT generate raster descriptions — generate actual SVG code.',
    ].join('\n'),
    execute: executeDrawSvg,
    parameters: drawSvgParams,
  }),
]

export const drawSvgTools = async () => Promise.all(tools)
