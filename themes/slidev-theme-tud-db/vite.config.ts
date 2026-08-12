import { createHighlighter } from 'shiki'
import { setupTableCaptions } from './markdown'

// Shipped WITH the theme: Slidev merges vite.config from every root (theme +
// addons + deck), so installing this theme is enough — no need to copy a file.
//
// Inline code syntax highlighting. Write inline code as:  `{lang} the code`
//   e.g.  `{json} {"a": 1}`
// The leading `{lang}` token selects the language; everything after the first
// space is highlighted with Shiki and rendered inside a normal inline <code>.
//
// A deck can still override THEME, LANGS, or the rule by defining its own
// vite.config.ts (the deck's config merges last and wins).
//
// NB: no `import ... from 'vite'` here on purpose — `defineConfig` is only a
// type helper, and importing it would require `vite` to be resolvable from this
// file's location (it isn't, when the theme is loaded from its own directory).
const THEME = 'catppuccin-latte'
const LANGS = ['json', 'yaml', 'sql', 'c', 'cpp', 'python']

export default async () => {
  const highlighter = await createHighlighter({ themes: [THEME], langs: LANGS })

  return {
    slidev: {
      markdown: {
        // runs after Slidev's own markdown-it plugins, so our rule wins
        markdownSetup(md: any) {
          setupTableCaptions(md)
          const fallback = md.renderer.rules.code_inline
          md.renderer.rules.code_inline = (tokens: any[], idx: number, options: any, env: any, self: any) => {
            const m = String(tokens[idx].content).match(/^\{([\w-]+)\}\s+([\s\S]+)$/)
            if (m && highlighter.getLoadedLanguages().includes(m[1])) {
              const inner = highlighter
                .codeToHtml(m[2], { lang: m[1], theme: THEME })
                .replace(/^<pre[^>]*><code[^>]*>/, '')
                .replace(/<\/code><\/pre>\s*$/, '')
              return `<code class="db-inline-code">${inner}</code>`
            }
            return fallback
              ? fallback(tokens, idx, options, env, self)
              : self.renderToken(tokens, idx, options)
          }

          // ASCII arrows -> unicode, in plain TEXT only. Code spans/blocks are
          // separate token types, so SQL `->` / `->>` is never touched.
          // Markdown's typographer turns `--` into an en-dash (`–`) before this
          // runs, so we match the hyphen, en-dash and em-dash forms.
          const DASH = '(?:--|–|—)' // -- or – or —
          const reBoth = new RegExp(`<${DASH}>`, 'g')
          const reRight = new RegExp(`${DASH}>`, 'g')
          const reLeft = new RegExp(`<${DASH}`, 'g')
          md.core.ruler.push('db-arrows', (state: any) => {
            for (const tok of state.tokens) {
              if (tok.type !== 'inline' || !tok.children) continue
              for (const child of tok.children) {
                if (child.type === 'text') {
                  child.content = child.content
                    .replace(reBoth, '↔')
                    .replace(reRight, '→')
                    .replace(reLeft, '←')
                }
              }
            }
          })
        },
      },
    },
  }
}
