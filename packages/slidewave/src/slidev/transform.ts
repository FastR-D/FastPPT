export interface TransformMetrics {
  scaleX: number
  scaleY: number
  rotation: number
}

export function mergeTransform(
  parent: TransformMetrics,
  style: CSSStyleDeclaration,
): TransformMetrics {
  let scaleX = 1
  let scaleY = 1
  let rotation = 0
  if (style.transform && style.transform !== 'none') {
    try {
      const matrix = new DOMMatrixReadOnly(style.transform)
      scaleX = Math.hypot(matrix.a, matrix.b)
      scaleY = Math.hypot(matrix.c, matrix.d)
      rotation = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
    } catch {
      // The browser has already resolved geometry; unsupported matrix parsing only affects text scaling.
    }
  }
  const zoom = numericOpacity(style.zoom || '1') || 1
  return {
    scaleX: parent.scaleX * scaleX * zoom,
    scaleY: parent.scaleY * scaleY * zoom,
    rotation: parent.rotation + rotation,
  }
}

export function averageScale(transform: TransformMetrics): number {
  return Math.sqrt(Math.abs(transform.scaleX * transform.scaleY))
}

export function nonZeroRotation(value: number): number | undefined {
  return Math.abs(value) > 0.01 ? value : undefined
}

function numericOpacity(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 1
}
