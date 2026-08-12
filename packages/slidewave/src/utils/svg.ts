/**
 * Rasterizes an SVG string to a PNG data URL through Canvas.
 * Used by non-native primitives such as blobs, grain, glass, and gradient text.
 *
 * @param {string} svgString — complete SVG markup
 * @param {number} widthPx   — output width in pixels
 * @param {number} heightPx  — output height in pixels
 * @returns {Promise<string>} dataURL PNG (base64)
 */
export function svgToPngDataUrl(
  svgString: string,
  widthPx: number,
  heightPx: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = widthPx
      canvas.height = heightPx
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Canvas 2D context is unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, widthPx, heightPx)
      URL.revokeObjectURL(url)
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }

    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      const message = e instanceof Error ? e.message : String(e)
      reject(new Error('SVG rasterization failed: ' + message))
    }

    img.src = url
  })
}

/**
 * Generates a noise texture directly as a PNG data URL.
 */
export function generateGrainPng(
  widthPx: number,
  heightPx: number,
  opacity = 0.08,
  monochrome = true,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable')
  const img = ctx.createImageData(widthPx, heightPx)
  const data = img.data

  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(Math.random() * 256)
    if (monochrome) {
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
    } else {
      data[i] = Math.floor(Math.random() * 256)
      data[i + 1] = Math.floor(Math.random() * 256)
      data[i + 2] = Math.floor(Math.random() * 256)
    }
    data[i + 3] = Math.floor(opacity * 255)
  }

  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Rasterization pixels per inch. 144 provides Retina-quality PPT output.
 */
export const DPI = 144

export function inchesToPx(inches: number): number {
  return Math.round(inches * DPI)
}
