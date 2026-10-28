/** Pinned observations, not claims that an output deck renders correctly.
 * These IDs identify the locale target inside this exact report. The matching
 * measurements used a diagnostic copy; production indent remains unchanged. */
export const decimalTabProfiles = Object.freeze(Object.fromEntries([
  ['en-US', '.'], ['de-DE', ','], ['fr-FR', ','],
].map(([locale, separator]) => [`libreoffice-7.3.7.2-linux-${locale}`, Object.freeze({
  locale, separator, application: 'LibreOffice 7.3.7.2 30(Build:2)', platform: 'Linux x86_64',
  evidencePath: 'docs/validation/decimal-libreoffice-7.3.7.2.json',
  evidenceSha256: '870c46d7d9ff0c44d7d031625e078efc14e187f5644501ba6ff8736066e2e451',
  measurementBasis: 'diagnostic-indent-removed', compatibility: 'known-difference',
})])))

export function validateDecimalTab(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['separator', 'provenance', 'reason', 'targetProfile'].includes(key)) ||
      value.provenance !== 'user-declared' || typeof value.reason !== 'string' || !value.reason.trim() ||
      typeof value.targetProfile !== 'string' || !Object.hasOwn(decimalTabProfiles, value.targetProfile) ||
      value.separator !== decimalTabProfiles[value.targetProfile].separator) throw new Error('Decimal tab alignment requires a measured separator convention with a matching target profile and user-declared reason.')
}

/** Applies to every decimal stop in this source; cannot be reused on a different PPTX. */
export function validateDecimalTabDeclaration(value, sourceHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['version', 'sourcePptxSha256', 'decimalTab'].includes(key)) ||
      value.version !== 1 || typeof value.sourcePptxSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sourcePptxSha256) || value.sourcePptxSha256 !== sourceHash) throw new Error('Decimal tab declaration must bind to the analyzed source PPTX SHA-256.')
  validateDecimalTab(value.decimalTab)
}

export function decimalTabCompatibility(value) {
  if (!value) return 'Decimal tab separator is undeclared; DrawingML does not encode a separator. Verify the target application locale.'
  validateDecimalTab(value)
  const profile = decimalTabProfiles[value.targetProfile]
  return `Decimal tab separator ${JSON.stringify(value.separator)} is user-declared for ${value.targetProfile} (${profile.application}, ${profile.platform}, system locale ${profile.locale}). Evidence SHA-256 ${profile.evidenceSha256} measures diagnostic output only; actual native output has known indent differences. DrawingML does not encode the separator or enforce the target locale. Verify the actual output in the target application.`
}

export function validateTextTabs(value) {
  if (value.decimalTab !== undefined && value.decimalTab !== null) validateDecimalTab(value.decimalTab)
  if (value.defaultTabSize !== undefined && (!Number.isSafeInteger(value.defaultTabSize) || value.defaultTabSize < 0 || value.defaultTabSize > 51206400)) throw new Error('Invalid default tab size.')
  if (value.tabStops === undefined) return
  if (!Array.isArray(value.tabStops) || value.tabStops.length > 1024) throw new Error('Invalid tab stop list.')
  let previous = -Infinity
  for (const stop of value.tabStops) {
    if (!stop || Object.keys(stop).some(key => !['position', 'align'].includes(key)) ||
      !Number.isSafeInteger(stop.position) || Math.abs(stop.position) > 51206400 ||
      stop.position <= previous || !['left', 'center', 'right', 'decimal'].includes(stop.align)) throw new Error('Tab stops must have supported alignment and strictly increasing positions.')
    previous = stop.position
  }
}

/** Units are supplied by the caller. Positions are relative to paragraph marL.
 * Browser positions are quantized to CSS subpixels; a 0.05-unit tolerance
 * prevents consecutive tabs from selecting the same rounded stop.
 * Explicit stops take precedence; after the last one, use the default grid.
 * A stop aligns the entire following field, up to the next tab or soft break.
 * A field that cannot fit before its anchor consumes the tab with zero gap.
 * It does not silently jump to a later/default stop. */
export function resolveTextTab(cursor, defaultSize, stops, fieldWidth, decimalOffset) {
  if (!Number.isFinite(cursor) || !Number.isFinite(defaultSize) || defaultSize < 0 || !Number.isFinite(fieldWidth) || fieldWidth < 0) throw new Error('Invalid tab geometry.')
  let stop = stops.find(stop => stop.position > cursor + 0.05)
  if (!stop) {
    if (defaultSize <= 0) throw new Error('A zero default tab size needs a following explicit stop.')
    stop = { position: Math.max(0, (Math.floor((cursor + 0.05) / defaultSize) + 1) * defaultSize), align: 'left' }
  }
  if (stop.align === 'decimal' && (!Number.isFinite(decimalOffset) || decimalOffset < 0 || decimalOffset > fieldWidth + 0.05)) throw new Error('Decimal tab alignment requires a measured separator convention and field anchor.')
  const offset = stop.align === 'decimal' ? decimalOffset : stop.align === 'center' ? fieldWidth / 2 : stop.align === 'right' ? fieldWidth : 0
  return { ...stop, width: Math.max(0, stop.position - cursor - offset) }
}

/** Text-only ranges avoid counting both an inline wrapper and its descendants.
 * Keep soft breaks as field boundaries, including a newline inside a text node. */
export function sourceTabFields(paragraph) {
  const fields = []
  let current
  const visit = node => {
    if (node.nodeType === 1) {
      const css = paragraph.ownerDocument.defaultView.getComputedStyle(node)
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0 || node.hasAttribute('data-fastppt-bullet-marker')) return
      if (node.hasAttribute('data-fastppt-tab')) {
        current = { marker: node, ranges: [] }
        fields.push(current)
      } else if (node.tagName === 'BR') current = undefined
      else for (const child of node.childNodes) visit(child)
    } else if (node.nodeType === 3 && current) {
      const newline = node.data.indexOf('\n'), end = newline < 0 ? node.data.length : newline
      if (end) {
        const range = paragraph.ownerDocument.createRange()
        range.setStart(node, 0); range.setEnd(node, end)
        current.ranges.push(range)
      }
      if (newline >= 0) current = undefined
    }
  }
  visit(paragraph)
  return fields
}

export function measureTabField(field, scale) {
  return field.ranges.reduce((total, range) => total + [...range.getClientRects()].reduce((sum, rect) => sum + rect.width / scale, 0), 0)
}

/** Measure the first separator's actual glyph edge, preserving shaping across
 * inline runs. Missing separators use the field end, including nonnumeric text. */
export function measureDecimalTabOffset(field, scale, separator) {
  let prefix = 0
  for (const range of field.ranges) {
    const index = range.toString().indexOf(separator)
    const before = range.cloneRange()
    if (index >= 0) before.setEnd(range.startContainer, range.startOffset + index)
    prefix += [...before.getClientRects()].reduce((sum, rect) => sum + rect.width / scale, 0)
    if (index >= 0) return prefix
  }
  return prefix
}

export function sourceTabContext(paragraph) {
  const contract = JSON.parse(paragraph.getAttribute('data-fastppt-tabs') ?? '{}')
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) || Object.keys(contract).some(key => !['defaultTabSize', 'tabStops', 'decimalTab'].includes(key))) throw new Error('Invalid tab contract.')
  validateTextTabs(contract)
  if (contract.tabStops?.some(stop => stop.align === 'decimal')) validateDecimalTab(contract.decimalTab)
  const canvas = Number(paragraph.getAttribute('data-fastppt-tab-canvas'))
  const root = paragraph.closest('.source-layout')
  if (!root || !Number.isFinite(canvas) || canvas <= 0) throw new Error('Tabs require a source canvas.')
  const computed = element => paragraph.ownerDocument.defaultView.getComputedStyle(element)
  const css = computed(paragraph), width = parseFloat(css.width)
  const rect = paragraph.getBoundingClientRect(), scale = rect.width / width
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Tabs require ordinary left-aligned text geometry.')
  const units = parseFloat(computed(root).width) / canvas
  return { contract, css, rect, scale, units, defaultSize: (contract.defaultTabSize ?? 914400) * units, stops: (contract.tabStops ?? []).map(stop => ({ ...stop, position: stop.position * units })) }
}

/** Update only generated tab spacers, preserving the authored tab characters. */
export function syncSourceTabs(paragraph) {
  const markers = [...paragraph.querySelectorAll('[data-fastppt-tab]')]
  if (!markers.length) return
  try {
    const context = sourceTabContext(paragraph)
    if (context.css.textAlign !== 'left' || context.css.direction !== 'ltr') throw new Error('Tabs require left-aligned, left-to-right paragraphs.')
    for (const marker of markers) marker.style.width = '0px'
    const fields = sourceTabFields(paragraph)
    let stable = false
    // A spacer that moves to the next visual line must select a stop from that
    // line's cursor. Forward text flow normally settles in two or three passes.
    // Reject oscillation instead of capturing an arbitrary intermediate layout.
    for (let pass = 0; pass < 8 && !stable; pass++) {
      stable = true
      for (const field of fields) {
        const marker = field.marker, rect = marker.getBoundingClientRect()
        const cursor = (rect.left - context.rect.left) / context.scale
        const width = resolveTextTab(cursor, context.defaultSize, context.stops, measureTabField(field, context.scale), context.contract.decimalTab ? measureDecimalTabOffset(field, context.scale, context.contract.decimalTab.separator) : undefined).width
        if (Math.abs(rect.width / context.scale - width) > 0.02) { marker.style.width = width + 'px'; stable = false }
      }
    }
    if (!stable) throw new Error('Tab wrapping did not reach a stable measured layout.')
    paragraph.removeAttribute('data-fastppt-tab-error')
  } catch (error) {
    paragraph.setAttribute('data-fastppt-tab-error', error.message)
  }
}
