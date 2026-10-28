interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Union, clipped to the slide, so nested content and overlaps count once. */
export function occupiedFraction(boxes: readonly Rect[], canvas: Rect): number {
  if (canvas.width <= 0 || canvas.height <= 0) return 0
  const clipped = boxes
    .map((box) => ({
      left: Math.max(canvas.x, box.x),
      top: Math.max(canvas.y, box.y),
      right: Math.min(canvas.x + canvas.width, box.x + box.width),
      bottom: Math.min(canvas.y + canvas.height, box.y + box.height),
    }))
    .filter((box) => box.right > box.left && box.bottom > box.top)
  const xs = [...new Set(clipped.flatMap((box) => [box.left, box.right]))].sort(
    (a, b) => a - b,
  )
  let area = 0
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!,
      right = xs[i]!
    const intervals = clipped
      .filter((box) => box.left < right && box.right > left)
      .sort((a, b) => a.top - b.top)
    let bottom = -Infinity,
      height = 0
    for (const interval of intervals) {
      height += Math.max(0, interval.bottom - Math.max(bottom, interval.top))
      bottom = Math.max(bottom, interval.bottom)
    }
    area += (right - left) * height
  }
  return Math.min(1, area / (canvas.width * canvas.height))
}

function visible(element: Element, root: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number(style.opacity) === 0
    )
      return false
    if (current === root) break
  }
  return !element.closest('script,style,[data-fastppt-layout-object]')
}

/** Total rendered lines of editable content by block, and union of visible
 * text/media bounds divided by canvas area. Inherited brand objects are excluded. */
export function measureThemeRules(root: HTMLElement, slide: number) {
  const boxes: Rect[] = []
  const blocks = new Map<Element, Array<{ top: number; bottom: number }>>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode,
      parent = node.parentElement
    if (!node.textContent?.trim() || !parent || !visible(parent, root)) continue
    let block = parent
    while (
      block !== root &&
      getComputedStyle(block).display === 'inline' &&
      block.parentElement
    )
      block = block.parentElement
    const range = document.createRange()
    range.selectNodeContents(node)
    const lines = blocks.get(block) ?? []
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue
      boxes.push(rect)
      lines.push({ top: rect.top, bottom: rect.bottom })
    }
    blocks.set(block, lines)
  }
  let textLines = 0
  for (const lines of blocks.values()) {
    let bottom = -Infinity
    for (const line of lines.sort((a, b) => a.top - b.top)) {
      if (line.top >= bottom - 0.5) textLines++
      bottom = Math.max(bottom, line.bottom)
    }
  }
  for (const element of root.querySelectorAll('img,svg,canvas,video,table')) {
    if (visible(element, root)) boxes.push(element.getBoundingClientRect())
  }
  const style = getComputedStyle(root.querySelector('.slidev-layout') ?? root)
  const tokens = Array.from({ length: style.length }, (_, i) => style.item(i))
    .filter(
      (name) => name.startsWith('--') && style.getPropertyValue(name).trim(),
    )
    .sort()
  return {
    slide,
    textLines,
    density: occupiedFraction(boxes, root.getBoundingClientRect()),
    tokens,
  }
}
