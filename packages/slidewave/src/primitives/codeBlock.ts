import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript.js'
import 'prismjs/components/prism-typescript.js'
import 'prismjs/components/prism-jsx.js'
import 'prismjs/components/prism-tsx.js'
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-css.js'
import 'prismjs/components/prism-markup.js'
import 'prismjs/components/prism-markdown.js'
import 'prismjs/components/prism-rust.js'
import 'prismjs/components/prism-go.js'
import 'prismjs/components/prism-sql.js'

/**
 * Production-grade code-block syntax highlighting with Prism.js.
 * Supported languages: js, ts, jsx, tsx, py, json, bash, css, html, md, rust, go, sql.
 *
 * Prism produces accurate tokens; unsupported languages use a regex tokenizer fallback.
 */

/** Map user-friendly lang names → Prism keys. */
const LANG_ALIASES = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  python: 'python',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  css: 'css',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  rust: 'rust',
  rs: 'rust',
  go: 'go',
  sql: 'sql',
}

/** Maps Prism token types to the unified Slidewave palette. */
const PRISM_TO_TYPE = {
  keyword: 'keyword',
  'class-name': 'type',
  builtin: 'type',
  function: 'fn',
  'function-variable': 'fn',
  string: 'string',
  'template-string': 'string',
  number: 'number',
  boolean: 'number',
  comment: 'comment',
  doc: 'comment',
  operator: 'punct',
  punctuation: 'punct',
  tag: 'keyword',
  'attr-name': 'fn',
  'attr-value': 'string',
  property: 'fn',
  selector: 'keyword',
  variable: 'text',
  parameter: 'text',
  regex: 'string',
}

/** Recursively flattens Prism tokens into a {type, value} list. */
function flattenPrismTokens(tokens, parentType = 'text') {
  const out = []
  for (const tok of tokens) {
    if (typeof tok === 'string') {
      out.push({ type: parentType, value: tok })
    } else if (tok && tok.content) {
      const type = PRISM_TO_TYPE[tok.type] || parentType
      if (Array.isArray(tok.content)) {
        out.push(...flattenPrismTokens(tok.content, type))
      } else if (typeof tok.content === 'string') {
        out.push({ type, value: tok.content })
      }
    }
  }
  return out
}

// Themes inspired by One Dark and GitHub Light.
export const CODE_THEMES = {
  dark: {
    bg: '#0d1117',
    text: '#c9d1d9',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    number: '#79c0ff',
    comment: '#8b949e',
    fn: '#d2a8ff',
    type: '#ffa657',
    punct: '#c9d1d9',
  },
  light: {
    bg: '#f6f8fa',
    text: '#24292f',
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    fn: '#8250df',
    type: '#953800',
    punct: '#24292f',
  },
  mono: {
    bg: '#fafafa',
    text: '#111111',
    keyword: '#111111',
    string: '#555555',
    number: '#111111',
    comment: '#999999',
    fn: '#111111',
    type: '#111111',
    punct: '#111111',
  },
}

const KEYWORDS: Record<string, string[]> = {
  js: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'new',
    'this',
    'async',
    'await',
    'import',
    'export',
    'from',
    'default',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'of',
    'in',
    'true',
    'false',
    'null',
    'undefined',
  ],
  ts: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'class',
    'extends',
    'interface',
    'type',
    'enum',
    'new',
    'this',
    'async',
    'await',
    'import',
    'export',
    'from',
    'default',
    'try',
    'catch',
    'finally',
    'throw',
    'as',
    'is',
    'readonly',
    'public',
    'private',
    'protected',
    'true',
    'false',
    'null',
    'undefined',
  ],
  py: [
    'def',
    'class',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'import',
    'from',
    'as',
    'pass',
    'break',
    'continue',
    'try',
    'except',
    'finally',
    'raise',
    'with',
    'lambda',
    'yield',
    'async',
    'await',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'in',
    'is',
    'self',
  ],
  json: ['true', 'false', 'null'],
  sh: [
    'if',
    'then',
    'else',
    'fi',
    'for',
    'do',
    'done',
    'while',
    'function',
    'echo',
    'export',
    'return',
    'case',
    'esac',
  ],
}
KEYWORDS.jsx = KEYWORDS.js
KEYWORDS.tsx = KEYWORDS.ts

/**
 * Tokenizes a string into {type, value} segments.
 * Uses Prism for supported languages and the regex fallback otherwise.
 */
export function tokenize(code, lang = 'js') {
  const prismLang = LANG_ALIASES[lang] || lang
  const grammar = Prism.languages[prismLang]
  if (grammar) {
    const prismTokens = Prism.tokenize(code, grammar)
    return flattenPrismTokens(prismTokens)
  }
  return tokenizeFallback(code, lang)
}

/** Simple regex tokenizer for languages not supported by Prism. */
function tokenizeFallback(code, lang = 'js') {
  const kws = new Set(KEYWORDS[lang] || [])
  const tokens = []
  let i = 0
  const push = (type, value) => {
    if (value) tokens.push({ type, value })
  }

  while (i < code.length) {
    const ch = code[i]
    const rest = code.slice(i)

    // Line comment: //
    if (rest.startsWith('//')) {
      const end = code.indexOf('\n', i)
      const slice = code.slice(i, end === -1 ? code.length : end)
      push('comment', slice)
      i += slice.length
      continue
    }
    // Block comment: /* */
    if (rest.startsWith('/*')) {
      const end = code.indexOf('*/', i + 2)
      const slice = code.slice(i, end === -1 ? code.length : end + 2)
      push('comment', slice)
      i += slice.length
      continue
    }
    // Hash comment for Python and shell.
    if ((lang === 'py' || lang === 'sh') && ch === '#') {
      const end = code.indexOf('\n', i)
      const slice = code.slice(i, end === -1 ? code.length : end)
      push('comment', slice)
      i += slice.length
      continue
    }
    // strings "..." '...' `...`
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < code.length && code[j] !== ch) {
        if (code[j] === '\\') j += 2
        else j++
      }
      push('string', code.slice(i, j + 1))
      i = j + 1
      continue
    }
    // number
    if (/[0-9]/.test(ch)) {
      const m = rest.match(/^[0-9][0-9_.eE+-]*/)
      if (m) {
        push('number', m[0])
        i += m[0].length
        continue
      }
    }
    // identifier / keyword / function
    if (/[A-Za-z_$]/.test(ch)) {
      const m = rest.match(/^[A-Za-z0-9_$]+/)
      const word = m[0]
      if (kws.has(word)) push('keyword', word)
      else if (code[i + word.length] === '(') push('fn', word)
      else if (/^[A-Z]/.test(word)) push('type', word)
      else push('text', word)
      i += word.length
      continue
    }
    // whitespace / newline
    if (/\s/.test(ch)) {
      const m = rest.match(/^\s+/)
      push('text', m[0])
      i += m[0].length
      continue
    }
    // punct
    push('punct', ch)
    i++
  }

  return tokens
}

export function codeBlockSvg({
  code = '',
  lang = 'js',
  theme = 'dark',
  fontSize = 16,
  fontFamily = 'Menlo, Consolas, Courier New, monospace',
  padding = 24,
  lineNumbers = false,
  lineHeight = 1.55,
  radius = 12,
  widthPx = 900,
  heightPx = 500,
}) {
  const t =
    typeof theme === 'string' ? CODE_THEMES[theme] || CODE_THEMES.dark : theme
  const tokens = tokenize(code, lang)
  const lh = fontSize * lineHeight

  // Group tokens by line: each line is [{type, value}, ...].
  // Tokens can contain newlines, so split them first.
  const linesOfTokens = [[]]
  for (const tok of tokens) {
    const parts = tok.value.split('\n')
    for (let k = 0; k < parts.length; k++) {
      if (parts[k])
        linesOfTokens[linesOfTokens.length - 1].push({
          type: tok.type,
          value: parts[k],
        })
      if (k < parts.length - 1) linesOfTokens.push([])
    }
  }

  const colorOf = (type) =>
    ({
      keyword: t.keyword,
      string: t.string,
      number: t.number,
      comment: t.comment,
      fn: t.fn,
      type: t.type,
      punct: t.punct,
      text: t.text,
    })[type] || t.text

  const gutterW = lineNumbers
    ? Math.max(3, String(linesOfTokens.length).length + 1) * fontSize * 0.6
    : 0
  const textX = padding + gutterW
  const firstBaselineY = padding + fontSize

  const lineEls = linesOfTokens
    .map((toks, i) => {
      const y = firstBaselineY + i * lh
      const tspans = toks
        .map((tok) => {
          return `<tspan fill="#${normalizeHex(colorOf(tok.type))}" xml:space="preserve">${escXml(tok.value)}</tspan>`
        })
        .join('')

      const gutter = lineNumbers
        ? `<text x="${padding + gutterW - fontSize * 0.6}" y="${y}" text-anchor="end" fill="#${normalizeHex(t.comment)}" opacity="0.5" xml:space="preserve">${i + 1}</text>`
        : ''

      return `${gutter}<text x="${textX}" y="${y}" xml:space="preserve">${tspans || ' '}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">
    <rect x="0" y="0" width="${widthPx}" height="${heightPx}" rx="${radius}" fill="#${normalizeHex(t.bg)}"/>
    <g font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(t.text)}">
      ${lineEls}
    </g>
  </svg>`
}

export async function codeBlockToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = codeBlockSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
