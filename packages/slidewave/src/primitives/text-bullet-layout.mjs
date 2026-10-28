// Portable DOM geometry, also embedded into standalone generated themes.
// The zero-size inline anchor does not introduce a word-break opportunity.
export function sourceBulletContext(paragraph) {
  const marker = paragraph.querySelector(':scope > [data-fastppt-bullet-marker]')
  const anchor = paragraph.querySelector(':scope > [data-fastppt-bullet-anchor]')
  const label = marker?.querySelector(':scope > [data-fastppt-bullet-label]')
  const baseline = marker?.querySelector(':scope > [data-fastppt-bullet-baseline]')
  const root = paragraph.closest('.source-layout')
  const canvas = Number(paragraph.getAttribute('data-fastppt-bullet-canvas'))
  const rawIndent = paragraph.getAttribute('data-fastppt-bullet-indent')
  const sourceIndent = Number(rawIndent)
  if (!marker || !anchor || !label || !baseline || !root || !Number.isFinite(canvas) || canvas <= 0 || rawIndent === null || !rawIndent.trim() || !Number.isFinite(sourceIndent))
    throw new Error('bullet geometry needs its marker, anchor and source canvas')
  const computed = element => paragraph.ownerDocument.defaultView.getComputedStyle(element)
  const rect = paragraph.getBoundingClientRect()
  const scale = rect.width / parseFloat(computed(paragraph).width)
  const units = parseFloat(computed(root).width) / canvas
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(units) || units <= 0)
    throw new Error('bullet geometry needs a positive paragraph and canvas width')
  const range = paragraph.ownerDocument.createRange()
  range.selectNodeContents(label)
  const advance = range.getBoundingClientRect().width / scale
  const visible = computed(marker).visibility === 'visible'
  const indent = sourceIndent * units
  return { marker, anchor, label, baseline, rect, scale, units, indent, advance, prefix: visible ? Math.max(0, indent + advance) : 0, visible }
}

export function syncSourceBulletGeometry(paragraph, positionOnly = false) {
  if (!paragraph.querySelector(':scope > [data-fastppt-bullet-marker]')) return
  try {
    const context = sourceBulletContext(paragraph)
    const { marker, anchor, baseline, rect, scale, indent, prefix, visible } = context
    if (!positionOnly) paragraph.style.textIndent = `${prefix}px`
    if (visible && prefix >= rect.width / scale)
      throw new Error('bullet prefix leaves no first-line body space')
    const origin = anchor.getBoundingClientRect()
    const left = visible ? (origin.left - rect.left) / scale + indent - prefix : indent
    const top = visible ? parseFloat(marker.style.top || '0') + (origin.top - baseline.getBoundingClientRect().top) / scale : 0
    marker.style.left = `${left}px`
    marker.style.top = `${top}px`
    paragraph.removeAttribute('data-fastppt-bullet-error')
  } catch (error) {
    paragraph.setAttribute('data-fastppt-bullet-error', error.message)
  }
}
