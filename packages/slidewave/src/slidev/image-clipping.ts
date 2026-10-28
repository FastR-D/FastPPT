import type { HtmlBox, HtmlImageElement } from './types.js'

export interface ImageClip {
  box: HtmlBox
  x: boolean
  y: boolean
}

/** Intersect all clipping ancestors before deriving crop fractions once. */
export function clipImageBox(
  image: HtmlBox,
  clips: readonly ImageClip[],
): { box: HtmlBox; crop?: HtmlImageElement['crop'] } | undefined {
  let left = image.x, top = image.y
  let right = left + image.width, bottom = top + image.height
  for (const clip of clips) {
    if (clip.x) {
      left = Math.max(left, clip.box.x)
      right = Math.min(right, clip.box.x + clip.box.width)
    }
    if (clip.y) {
      top = Math.max(top, clip.box.y)
      bottom = Math.min(bottom, clip.box.y + clip.box.height)
    }
  }
  if (right - left <= 0.01 || bottom - top <= 0.01) return undefined
  const crop = {
    left: (left - image.x) / image.width,
    top: (top - image.y) / image.height,
    right: (image.x + image.width - right) / image.width,
    bottom: (image.y + image.height - bottom) / image.height,
  }
  return {
    box: { x: left, y: top, width: right - left, height: bottom - top },
    ...(Object.values(crop).some(value => value > 0) ? { crop } : {}),
  }
}
