// Default Shiki color scheme for fenced code blocks (```lang ... ```).
// Matches the inline-code highlighter (see vite.config.ts) and the chair's
// template, so inline and fenced code look the same.
//
// NB: no `import { defineShikiSetup } from '@slidev/types'` on purpose — it's
// only a type helper, and Slidev calls this default export as `setup(ctx)`.
// catppuccin-latte / -mocha are bundled with Shiki, so no extra deps needed.
export default () => ({
  themes: {
    light: 'catppuccin-latte',
    dark: 'catppuccin-mocha',
  },
})
