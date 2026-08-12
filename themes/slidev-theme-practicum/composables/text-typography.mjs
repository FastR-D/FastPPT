const NON_BREAKING_SPACE = '\u00a0'
const RUSSIAN_SPACED_HYPHEN = /(\p{sc=Cyrillic}) - (?=\p{sc=Cyrillic})/gu
const RUSSIAN_SPACED_EM_DASH = /(\p{sc=Cyrillic}) (?=—)/gu
const TEXT_NODE_FILTER = 4
const FILTER_ACCEPT = 1
const FILTER_REJECT = 2
const TYPOGRAPHY_SKIP_SELECTOR = [
  'script',
  'style',
  'pre',
  'code',
  'kbd',
  'samp',
  'textarea',
  '.shiki',
  '.katex',
  '.mermaid',
  '[data-no-typography]',
  '[data-typography="off"]',
].join(',')

const RUSSIAN_SERVICE_WORDS = [
  'благодаря',
  'вместо',
  'вокруг',
  'вдоль',
  'между',
  'около',
  'перед',
  'после',
  'прежде',
  'против',
  'сквозь',
  'спустя',
  'среди',
  'через',
  'возле',
  'из-за',
  'из-под',
  'кроме',
  'мимо',
  'ради',
  'или',
  'без',
  'для',
  'над',
  'под',
  'при',
  'про',
  'как',
  'обо',
  'во',
  'до',
  'за',
  'из',
  'ко',
  'на',
  'не',
  'ни',
  'но',
  'об',
  'от',
  'по',
  'со',
  'а',
  'в',
  'да',
  'и',
  'к',
  'ли',
  'о',
  'с',
  'у',
]
const RUSSIAN_COMPACT_SERVICE_WORDS = RUSSIAN_SERVICE_WORDS.filter(word => word.length <= 2)
const RUSSIAN_SERVICE_WORD_WITH_SPACE = createServiceWordPattern(RUSSIAN_SERVICE_WORDS)
const RUSSIAN_COMPACT_SERVICE_WORD_WITH_SPACE = createServiceWordPattern(RUSSIAN_COMPACT_SERVICE_WORDS)

/**
 * @param {string[]} words
 */
function createServiceWordPattern(words) {
  return new RegExp(`(?<=^|[\\s\\p{Pi}\\p{Ps}])(${words.join('|')})[ \\t]+(?=[\\p{L}\\p{N}\\p{Pi}\\p{Ps}])`, 'giu')
}

/**
 * @param {string} value
 * @param {{ mode?: 'default' | 'compact' }} [options]
 */
export function typographText(value, options = {}) {
  const serviceWordPattern = options.mode === 'compact'
    ? RUSSIAN_COMPACT_SERVICE_WORD_WITH_SPACE
    : RUSSIAN_SERVICE_WORD_WITH_SPACE

  return value
    .replace(serviceWordPattern, `$1${NON_BREAKING_SPACE}`)
    .replace(RUSSIAN_SPACED_HYPHEN, `$1${NON_BREAKING_SPACE}— `)
    .replace(RUSSIAN_SPACED_EM_DASH, `$1${NON_BREAKING_SPACE}`)
}

/**
 * @param {Element | null | undefined} root
 */
export function typographElement(root) {
  if (!root)
    return 0

  const ownerDocument = root.ownerDocument ?? globalThis.document
  if (!ownerDocument?.createTreeWalker)
    return 0

  const nodeFilter = ownerDocument.defaultView?.NodeFilter ?? globalThis.NodeFilter
  const walker = ownerDocument.createTreeWalker(root, nodeFilter?.SHOW_TEXT ?? TEXT_NODE_FILTER, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(TYPOGRAPHY_SKIP_SELECTOR))
        return nodeFilter?.FILTER_REJECT ?? FILTER_REJECT

      return nodeFilter?.FILTER_ACCEPT ?? FILTER_ACCEPT
    },
  })
  let changed = 0

  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    const text = node.nodeValue ?? ''
    const typographedText = typographText(text, {
      mode: parent?.closest('[data-typography="compact"]') ? 'compact' : 'default',
    })

    if (typographedText === text)
      continue

    node.nodeValue = typographedText
    changed += 1
  }

  return changed
}
