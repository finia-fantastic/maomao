import { desktopCapturer } from 'electron'

/**
 * Take a screenshot of the primary display via Electron desktopCapturer.
 * No system dialog — uses built-in thumbnail capture.
 * Returns a JPEG data URL string or null.
 */
export async function captureScreenToDataUrl(quality = 0.85, maxWidth = 1920, maxHeight = 1080): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight },
    })
    const screen = sources.find(s => s.name.includes('Entire Screen') || s.id.startsWith('screen:'))
    if (!screen) {
      console.warn('[ScreenCapture] no screen source found')
      return null
    }

    const img = screen.thumbnail
    const size = img.getSize()
    console.info('[ScreenCapture] thumbnail size:', size.width, 'x', size.height)

    const scale = Math.min(maxWidth / size.width, maxHeight / size.height, 1)
    let finalImg = img
    if (scale < 1) {
      finalImg = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'best',
      })
    }

    const jpegBuffer = finalImg.toJPEG(Math.round(quality * 100))
    const base64 = Buffer.from(jpegBuffer).toString('base64')
    const dataUrl = `data:image/jpeg;base64,${base64}`

    console.info('[ScreenCapture] data URL length:', dataUrl.length, 'chars')
    return dataUrl
  }
  catch (e) {
    console.warn('[ScreenCapture] failed:', e)
    return null
  }
}
