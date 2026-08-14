#!/usr/bin/env node
/**
 * Generates src/index.css (all families) and src/families/<slug>.css (one
 * family each) from the catalog. Run after fetch-fonts. Themes should import
 * per-family entries so Vite only bundles the fonts they use.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const familiesDir = join(root, 'src', 'families')
await mkdir(familiesDir, { recursive: true })

/** @type {Array<{ family: string; slug: string; file: string; variable?: boolean; weight?: number; custom?: boolean }>} */
const FAMILIES = [
  { family: 'Inter', slug: 'inter', file: 'inter-variable.ttf', variable: true },
  { family: 'Space Grotesk', slug: 'space-grotesk', file: 'space-grotesk-variable.ttf', variable: true },
  { family: 'Fira Code', slug: 'fira-code', file: 'fira-code-variable.ttf', variable: true },
  { family: 'JetBrains Mono', slug: 'jetbrains-mono', file: 'jetbrains-mono-variable.ttf', variable: true },
  { family: 'Space Mono', slug: 'space-mono', file: 'space-mono-regular.ttf', weight: 400 },
  { family: 'Nunito Sans', slug: 'nunito-sans', file: 'nunito-sans-variable.ttf', variable: true },
  { family: 'Sofia Sans', slug: 'sofia-sans', file: 'sofia-sans-variable.ttf', variable: true },
  { family: 'Lexend', slug: 'lexend', file: 'lexend-variable.ttf', variable: true },
  { family: 'Caveat', slug: 'caveat', file: 'caveat-variable.ttf', variable: true },
  { family: 'Shantell Sans', slug: 'shantell-sans', file: 'shantell-sans-variable.ttf', variable: true },
  { family: 'Noto Sans SC', slug: 'noto-sans-sc', file: 'noto-sans-sc-variable.ttf', variable: true },
  { family: 'Noto Serif SC', slug: 'noto-serif-sc', file: 'noto-serif-sc-variable.ttf', variable: true },
  { family: 'LXGW WenKai', slug: 'lxgw-wenkai', file: 'lxgw-wenkai-regular.ttf', weight: 400 },
  { family: 'MiSans', slug: 'misans', file: 'misans-regular.ttf', weight: 400, custom: true },
]

const face = (f) =>
  f.custom
    ? `@import './families/${f.slug}.css';
`
    : `@font-face {
  font-family: '${f.family}';
  font-style: normal;
  ${f.variable ? '  font-weight: 100 900;' : `  font-weight: ${f.weight ?? 400};`}
  font-display: swap;
  src: url('../../assets/fonts/${f.file}') format('truetype');
}
`

const header = `/*
 * @fastppt/fonts — self-hosted font catalog.
 * Import the specific family you need: e.g. \`import '@fastppt/fonts/noto-sans-sc'\`.
 * Family names must stay byte-identical to src/registry.mjs keys.
 */
`

const blocks = FAMILIES.map(face).join('\n')
await writeFile(join(root, 'src', 'index.css'), header + blocks)
for (const f of FAMILIES) {
  if (f.custom) continue // misans.css declares its three complete static faces
  await writeFile(join(familiesDir, `${f.slug}.css`), header + face(f))
}
console.log(`generated index.css + ${FAMILIES.length} family entries`)
