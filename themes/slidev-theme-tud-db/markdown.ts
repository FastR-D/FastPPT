import type { MarkdownExit } from 'markdown-exit'
import { readFileSync, statSync } from 'node:fs'
import { parseSync } from '@slidev/parser'

// Slidev runs markdown through `markdown-exit` (a markdown-it fork), so the
// `md` passed to markdownSetup is a MarkdownExit instance, not a markdown-it one.

// Custom markdown-it customizations for the theme, wired up from
// `slidev.markdown.markdownSetup` in vite.config.ts:
//   - footnotes teleported into a <Footnotes> component
//   - LaTeX-style figure captions (`![alt](img){.caption}`)
//   - LaTeX-style table captions (a `{.caption}` paragraph after a table)
//   - deck-wide "Figure N:" / "Table N:" numbering

// --- Global figure/table numbering -----------------------------------------
// Figures and tables are numbered across the whole deck, not per slide. CSS
// counters can't do this: Slidev hides off-screen slides with `display: none`,
// and `counter-increment` is ignored on display:none elements — so a slide
// never "sees" the figures on other slides. Instead we bake the numbers in at
// build time. `env.id` (".../deck.md__slidev_<N>.md") tells us which slide is
// rendering; we parse the full deck once (cached by mtime), count the numbered
// `{.caption .numbered}` figures/tables on every earlier slide, and use those
// running totals as the starting offset for this slide.

interface DeckCounts { mtimeMs: number, fig: number[], tab: number[] }
const deckCountsCache = new Map<string, DeckCounts>()

// Count `{.caption .numbered}` figures (image) and tables (standalone
// paragraph) in one slide's raw markdown. Code spans/fences are stripped first
// so a `{.caption .numbered}` shown as example code is never miscounted.
function countNumbered(content: string): { fig: number, tab: number } {
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
  let fig = 0
  let tab = 0
  const attrBlock = /\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = attrBlock.exec(stripped))) {
    const classes = (match[1].match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1))
    if (!classes.includes('numbered')) continue
    if (!classes.includes('table-caption') && !classes.includes('table-footer') && !classes.includes('caption'))
      continue
    if (/!\[[^\]]*\]\([^)]*\)\s*$/.test(stripped.slice(0, match.index)))
      fig++
    else
      tab++
  }
  return { fig, tab }
}

function deckCounts(entryPath: string): DeckCounts | null {
  let stat
  try {
    stat = statSync(entryPath)
  }
  catch {
    return null
  }
  const cached = deckCountsCache.get(entryPath)
  if (cached && cached.mtimeMs === stat.mtimeMs)
    return cached
  const parsed = parseSync(readFileSync(entryPath, 'utf-8'), entryPath)
  const counts: DeckCounts = { mtimeMs: stat.mtimeMs, fig: [], tab: [] }
  for (const slide of parsed.slides) {
    const { fig, tab } = countNumbered(slide.content ?? '')
    counts.fig.push(fig)
    counts.tab.push(tab)
  }
  deckCountsCache.set(entryPath, counts)
  return counts
}

// How many numbered figures/tables appear on slides *before* the one rendering
// now — i.e. the offset this slide's numbering should start from.
function numberingOffset(env: any): { fig: number, tab: number } {
  const id = /^(.*)__slidev_(\d+)\.md$/.exec(env?.id ?? '')
  if (!id)
    return { fig: 0, tab: 0 }
  const counts = deckCounts(id[1])
  if (!counts)
    return { fig: 0, tab: 0 }
  const slideIndex = Number(id[2]) - 1
  let fig = 0
  let tab = 0
  for (let i = 0; i < slideIndex && i < counts.fig.length; i++) {
    fig += counts.fig[i]
    tab += counts.tab[i]
  }
  return { fig, tab }
}

// Gather every class on a token, coping with both markdown-it-attrs (one
// space-separated `class` attr) and Slidev's MDC (a separate `class` attr per
// class, e.g. [["class","caption"],["class","numbered"]]).
function classesOf(token: { attrs?: [string, string][] | null }): string[] {
  return (token.attrs ?? [])
    .filter(([name]) => name === 'class')
    .flatMap(([, value]) => value.split(/\s+/))
    .filter(Boolean)
}

// Footnotes: wrap the rendered footnotes block in a <Footnotes> component (see
// components/Footnotes.vue) instead of emitting it inline in the slide. The
// component teleports it into global-bottom, so footnotes live in the
// persistent layer: they don't animate with slide transitions and sit next to
// the footer. The inline footnote refs ([^1] markers) are produced by other
// rules and stay in the slide body.
export function setupFootnotes(md: MarkdownExit): void {
  md.renderer.rules.footnote_block_open = () =>
    '<Footnotes>\n<section class="footnotes">\n<ol class="footnotes-list">\n'
  md.renderer.rules.footnote_block_close = () =>
    '</ol>\n</section>\n</Footnotes>\n'
}

// LaTeX-style figure captions: an image marked with `{.caption}` gets its alt
// text rendered as a caption below it. Add `{.numbered}` too for a "Figure N:"
// prefix (numbered deck-wide — see numberingOffset). We wrap the <img> and the
// caption in inline <span>s (not a <figure>) so the markup stays valid inside
// the <p> that markdown puts a standalone image in. Styling lives in
// styles/layout.css.
export function setupFigureCaptions(md: MarkdownExit): void {
  const defaultImage = md.renderer.rules.image
    ?? ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const img = defaultImage(tokens, idx, options, env, self)
    const cls = token.attrGet('class') ?? ''
    if (!/(^|\s)caption(\s|$)/.test(cls))
      return img
    // `token.content` is the image's alt text.
    const alt = md.utils.escapeHtml(token.content ?? '')
    let label = ''
    if (/(^|\s)numbered(\s|$)/.test(cls)) {
      // Continue the figure count from earlier slides; images render in
      // document order, so a per-render running tally stays correct.
      const e = env as { __figureNo?: number }
      e.__figureNo ??= numberingOffset(env).fig
      label = `<span class="caption-label">Figure ${++e.__figureNo}: </span>`
    }
    return `<span class="caption-figure">${img}<span class="caption-text">${label}${alt}</span></span>`
  }
}

// LaTeX-style table captions, the table analogue of the figure captions above.
// A paragraph marked `{.caption}` placed directly after a table becomes that
// table's caption; add `{.numbered}` for a "Table N:" prefix. We wrap the
// <table> and the caption in a `display: table` container (.caption-table) —
// the exact trick the figure captions use — so the caption wraps to the
// table's width instead of stretching it. Styling lives in styles/layout.css
// and reuses `.caption-text`.
export function setupTableCaptions(md: MarkdownExit): void {
  md.core.ruler.push('table_caption', (state) => {
    const tokens = state.tokens
    const Token = state.Token

    // First pass: find every paragraph that has .table-caption or .table-footer
    const captions: { pInlineIdx: number, numbered: boolean, num?: number }[] = []
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== 'paragraph_close') continue
      const pInline = tokens[i - 1]
      const pOpen = tokens[i - 2]
      if (pInline.type !== 'inline' || pOpen.type !== 'paragraph_open') continue

      const classes = [pOpen, ...(pInline.children ?? [])].flatMap(classesOf)
      if (classes.includes('table-caption') || classes.includes('table-footer')) {
        captions.push({ pInlineIdx: i - 1, numbered: classes.includes('numbered') })
      }
    }
    
    if (captions.length === 0) return

    let tableNo = numberingOffset(state.env).tab
    for (const caption of captions) {
      if (caption.numbered) caption.num = ++tableNo
    }

    // Second pass: inject Tab N:
    for (let k = captions.length - 1; k >= 0; k--) {
      const { pInlineIdx, numbered, num } = captions[k]
      const pInline = tokens[pInlineIdx]

      // Remove the .numbered marker so it doesn't bleed
      for (const token of [tokens[pInlineIdx - 1], ...(pInline.children ?? [])]) {
        if (token.attrs) {
          token.attrs = token.attrs.filter(([name, value]) => !(name === 'class' && value === 'numbered'))
        }
      }

      if (numbered) {
        const label = new Token('html_inline', '', 0)
        label.content = `<span class="caption-label">Tab. ${num}: </span>`
        ;(pInline.children ??= []).unshift(label)
      }
    }
  })
}
