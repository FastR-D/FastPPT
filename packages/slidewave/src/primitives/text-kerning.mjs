/** Self-contained so generated standalone themes can embed exactly this runtime. */
export function sourceKerningRuntime() {
  function validateTextKerning(value) {
    const threshold = value.kerningThreshold
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 4000))
      throw new Error('Invalid text kerningThreshold; expected 0–4000 points.')
  }
  function parseSourceKerning(value) {
    if (typeof value !== 'string' || !/^\+?\d+$/.test(value.trim())) return undefined
    const kerningThreshold = Number(value) / 100
    try { validateTextKerning({ kerningThreshold }) } catch { return undefined }
    return kerningThreshold
  }
  function readSourceKerning(element, checkCss = true) {
    const raw = element.getAttribute('data-fastppt-text-kerning')
    if (raw === null) return undefined
    const contract = JSON.parse(raw)
    if (!contract || typeof contract !== 'object' || Array.isArray(contract) ||
        Object.keys(contract).some(key => !['threshold', 'canvasWidth'].includes(key)) ||
        typeof contract.threshold !== 'number' || !Number.isSafeInteger(contract.canvasWidth) || contract.canvasWidth <= 0)
      throw new Error('Invalid source kerning contract.')
    validateTextKerning({ kerningThreshold: contract.threshold })
    if (!(element.tagName === 'SPAN' && [...element.childNodes].every(node => node.nodeType === 3)) &&
        !element.hasAttribute('data-fastppt-text-level') && element.tagName !== 'BR')
      throw new Error('Kerning requires a text leaf, projected paragraph or soft break.')
    const root = element.closest('.source-layout, [data-fastppt-kerning-root]')
    if (!root) throw new Error('Source kerning requires its canvas.')
    const computed = node => element.ownerDocument.defaultView.getComputedStyle(node)
    const css = computed(element), width = parseFloat(computed(root).width), size = parseFloat(css.fontSize)
    const thresholdPx = contract.threshold * 12700 * width / contract.canvasWidth
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(size) || size <= 0)
      throw new Error('Source kerning requires positive font and canvas sizes.')
    // CSS serialization rounds cqw values; tolerate only that numerical error.
    const fontKerning = size + Math.max(size, thresholdPx) * 0.000005 >= thresholdPx ? 'normal' : 'none'
    if (checkCss && (css.fontKerning !== fontKerning || css.fontFeatureSettings !== 'normal' || css.fontVariationSettings !== 'normal' || !['normal', '100%'].includes(css.fontStretch)))
      throw new Error('Source kerning differs from its displayed font settings.')
    return { thresholdPx, fontKerning }
  }
  function syncSourceKerning(root) {
    if (!root) return
    const elements = [...(root.hasAttribute('data-fastppt-text-kerning') ? [root] : []), ...root.querySelectorAll('[data-fastppt-text-kerning]')]
    for (const element of elements) {
      try {
        const { fontKerning } = readSourceKerning(element, false)
        if (element.style.fontKerning !== fontKerning) element.style.fontKerning = fontKerning
        element.removeAttribute('data-fastppt-kerning-error')
      } catch (error) { element.setAttribute('data-fastppt-kerning-error', error.message) }
    }
  }
  return { validateTextKerning, parseSourceKerning, readSourceKerning, syncSourceKerning }
}
export const { validateTextKerning, parseSourceKerning, readSourceKerning, syncSourceKerning } = sourceKerningRuntime()
export const textKerningCompatibility = 'Source kerning thresholds and font sizes are preserved. LibreOffice 7.3.7.2 keeps kerning enabled in the measured cases even below the declared threshold; font metrics, tracking and wrapping can differ. Verify the actual file in the target application.'

/** An independent layout hook handles fixed text and direct CSS edits. Names are
 * aliased so it can coexist with ScriptFonts in the same generated Vue SFC. */
export const sourceKerningSetup = `import { ref as kerningRef, onMounted as kerningMounted, onUpdated as kerningUpdated, onBeforeUnmount as kerningUnmounted } from 'vue'
const kerningRoot = kerningRef(null)
const fixedKerningRuntime = (${sourceKerningRuntime.toString()})()
let kerningResize, kerningMutation
const syncFixedKerning = () => fixedKerningRuntime.syncSourceKerning(kerningRoot.value)
kerningMounted(() => {
  syncFixedKerning()
  kerningResize = new ResizeObserver(syncFixedKerning)
  kerningMutation = new MutationObserver(syncFixedKerning)
  if (kerningRoot.value) {
    kerningResize.observe(kerningRoot.value)
    kerningMutation.observe(kerningRoot.value, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
  }
  document.fonts?.ready.then(syncFixedKerning)
  document.fonts?.addEventListener('loadingdone', syncFixedKerning)
})
kerningUpdated(syncFixedKerning)
kerningUnmounted(() => { kerningResize?.disconnect(); kerningMutation?.disconnect(); document.fonts?.removeEventListener('loadingdone', syncFixedKerning) })`
