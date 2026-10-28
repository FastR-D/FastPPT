export interface NativeTextBody {
  /** English Metric Units in the layout's reference canvas. */
  insets?:
    | {
        left?: number | undefined
        right?: number | undefined
        top?: number | undefined
        bottom?: number | undefined
      }
    | undefined
  verticalAlign?: 'top' | 'middle' | 'bottom' | undefined
  wrap?: boolean | undefined
  autoFit?: 'none' | undefined
}

export function validateNativeTextBody(body: NativeTextBody): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['insets', 'verticalAlign', 'wrap', 'autoFit'].includes(key),
    )
  )
    throw new Error('Invalid text body contract.')
  if (
    body.insets !== undefined &&
    (!body.insets ||
      Array.isArray(body.insets) ||
      typeof body.insets !== 'object' ||
      Object.entries(body.insets).some(
        ([key, value]) =>
          !['left', 'right', 'top', 'bottom'].includes(key) ||
          (value !== undefined &&
            (!Number.isSafeInteger(value) || value < 0 || value > 51206400)),
      ))
  )
    throw new Error('Invalid text body insets.')
  if (
    body.verticalAlign !== undefined &&
    !['top', 'middle', 'bottom'].includes(body.verticalAlign)
  )
    throw new Error('Invalid text body vertical alignment.')
  if (body.wrap !== undefined && typeof body.wrap !== 'boolean')
    throw new Error('Invalid text body wrap policy.')
  if (body.autoFit !== undefined && body.autoFit !== 'none')
    throw new Error('Unsupported text body autofit.')
}

export function scaleNativeTextBody(
  body: NativeTextBody,
  sx: number,
  sy: number,
): NativeTextBody {
  validateNativeTextBody(body)
  const insets = {
    left: body.insets?.left ?? 91440,
    right: body.insets?.right ?? 91440,
    top: body.insets?.top ?? 45720,
    bottom: body.insets?.bottom ?? 45720,
  }
  return {
    ...body,
    insets: Object.fromEntries(
      Object.entries(insets).map(([key, value]) => [
        key,
        Math.round(value * (key === 'left' || key === 'right' ? sx : sy)),
      ]),
    ),
  }
}

export function nativeTextBodyXml(body: NativeTextBody | undefined): string {
  if (!body) return '<a:bodyPr/>'
  validateNativeTextBody(body)
  const insets = body.insets ?? {}
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[
    body.verticalAlign ?? 'top'
  ]
  return `<a:bodyPr lIns="${insets.left ?? 91440}" rIns="${insets.right ?? 91440}" tIns="${insets.top ?? 45720}" bIns="${insets.bottom ?? 45720}" anchor="${anchor}" wrap="${body.wrap === false ? 'none' : 'square'}" vert="horz" rot="0" anchorCtr="0"><a:noAutofit/></a:bodyPr>`
}
