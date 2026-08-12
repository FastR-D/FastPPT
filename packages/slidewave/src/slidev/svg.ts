export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

export function maskToSvgDataUrl(
  maskImage: string,
  color: string,
): string | null {
  const url = extractCssUrl(maskImage)
  if (!url?.startsWith('data:image/svg+xml')) return null
  try {
    const comma = url.indexOf(',')
    const metadata = url.slice(0, comma)
    const payload = url.slice(comma + 1)
    const decoded = metadata.includes(';base64')
      ? atob(payload)
      : decodeURIComponent(payload)
    const painted = decoded
      .replace(/currentColor/gi, `#${color}`)
      .replace(/fill=(['"])(?!none)[^'"]*\1/gi, `fill="#${color}"`)
      .replace(/<svg\b/i, `<svg style="color:#${color}"`)
    return svgToDataUrl(painted)
  } catch {
    return null
  }
}

export function inlineSvgPaint(
  source: SVGSVGElement,
  clone: SVGSVGElement,
): void {
  const sourceElements = [source, ...source.querySelectorAll<SVGElement>('*')]
  const cloneElements = [clone, ...clone.querySelectorAll<SVGElement>('*')]
  sourceElements.forEach((element, index) => {
    const target = cloneElements[index]
    if (!target) return
    const style = getComputedStyle(element)
    if (style.fill && style.fill !== 'none')
      target.setAttribute('fill', style.fill)
    if (style.stroke && style.stroke !== 'none')
      target.setAttribute('stroke', style.stroke)
    if (style.strokeWidth)
      target.setAttribute('stroke-width', style.strokeWidth)
  })
}

export function htmlElementToSvgDataUrl(
  source: HTMLElement,
  width: number,
  height: number,
  styleOverrides: Record<string, string> = {},
): string {
  const clone = source.cloneNode(true) as HTMLElement
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const cloneElements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  sourceElements.forEach((element, index) => {
    const target = cloneElements[index]
    if (!target) return
    const style = getComputedStyle(element)
    target.setAttribute(
      'style',
      [...style]
        .map((property) => `${property}:${style.getPropertyValue(property)};`)
        .join(''),
    )
  })
  clone.style.margin = '0'
  clone.style.position = 'relative'
  clone.style.inset = 'auto'
  clone.style.transform = 'none'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  for (const [property, value] of Object.entries(styleOverrides)) {
    clone.style.setProperty(property, value)
  }
  const html = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`
  return svgToDataUrl(svg)
}

export async function resourceToDataUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source
  const response = await fetch(source, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function extractCssUrl(value: string): string | null {
  const match = value.match(/url\((['"]?)(.*?)\1\)/)
  return match?.[2] ?? null
}
