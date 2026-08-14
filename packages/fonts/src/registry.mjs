/**
 * @fastppt/fonts — font catalog registry.
 *
 * Maps the exact font-family names used by themes (and therefore the `typeface`
 * values slidewave writes into exported PPTX runs) to the local font binaries
 * bundled in this package. The embedder uses `resolveFontPath()` to read a font
 * at export time; themes use `src/index.css` to load the same files in-browser.
 *
 * Keep family keys byte-identical to the names declared in theme CSS stacks and
 * in the `@font-face` rules in `src/index.css`.
 */

/** @typedef {{ file: string; license: string; variable?: boolean; subset?: boolean; weight?: number; style?: 'normal'|'italic'; faces?: Record<string, { file: string; variable?: boolean; subset?: boolean }> }} FontFile */

/** @type {Record<string, FontFile>} */
export const FONT_FILES = {
  // Latin
  Inter: { file: 'assets/fonts/inter-variable.ttf', license: 'OFL-1.1', variable: true },
  'Space Grotesk': { file: 'assets/fonts/space-grotesk-variable.ttf', license: 'OFL-1.1', variable: true },
  'Fira Code': { file: 'assets/fonts/fira-code-variable.ttf', license: 'OFL-1.1', variable: true },
  'JetBrains Mono': { file: 'assets/fonts/jetbrains-mono-variable.ttf', license: 'OFL-1.1', variable: true },
  'Space Mono': { file: 'assets/fonts/space-mono-regular.ttf', license: 'OFL-1.1', weight: 400 },
  'Nunito Sans': { file: 'assets/fonts/nunito-sans-variable.ttf', license: 'OFL-1.1', variable: true },
  'Sofia Sans': { file: 'assets/fonts/sofia-sans-variable.ttf', license: 'OFL-1.1', variable: true },
  Lexend: { file: 'assets/fonts/lexend-variable.ttf', license: 'OFL-1.1', variable: true },
  Caveat: { file: 'assets/fonts/caveat-variable.ttf', license: 'OFL-1.1', variable: true },
  'Shantell Sans': { file: 'assets/fonts/shantell-sans-variable.ttf', license: 'OFL-1.1', variable: true },

  // CJK
  'Noto Sans SC': { file: 'assets/fonts/noto-sans-sc-variable.ttf', license: 'OFL-1.1', variable: true },
  'Noto Serif SC': { file: 'assets/fonts/noto-serif-sc-variable.ttf', license: 'OFL-1.1', variable: true },
  'LXGW WenKai': { file: 'assets/fonts/lxgw-wenkai-regular.ttf', license: 'OFL-1.1', weight: 400 },

  MiSans: {
    file: 'assets/fonts/misans-regular.ttf',
    license: 'Xiaomi free license',
    weight: 400,
    faces: {
      regular: { file: 'assets/fonts/misans-regular.ttf', subset: false },
      bold: { file: 'assets/fonts/misans-bold.ttf', subset: false },
    },
  },
  'MiSans Semibold': {
    file: 'assets/fonts/misans-semibold.ttf',
    license: 'Xiaomi free license',
    weight: 600,
    subset: false,
  },
}

/** Optional families (none currently; reserved for runtime-detectable fonts). */
export const OPTIONAL_FONT_FILES = {}

/**
 * Resolve the absolute path of a family's bundled font binary, or undefined when
 * the family is not in the catalog (the caller should emit an `unembedded-font`
 * warning). Relative to this module so the packaged CLI (dist/fonts) resolves
 * identically to the monorepo.
 */
export function resolveFontPath(family) {
  const entry = FONT_FILES[family] ?? OPTIONAL_FONT_FILES[family]
  if (!entry) return undefined
  return new URL(`../${entry.file}`, import.meta.url).pathname
}

/**
 * Resolve a family to its full descriptor (path + metadata), or undefined when
 * the family is not in the catalog. The embedder consumes this so it knows
 * whether the binary is a variable font (to pin weight when subsetting).
 */
export function resolveFontDescriptor(family) {
  const entry = FONT_FILES[family] ?? OPTIONAL_FONT_FILES[family]
  if (!entry) return undefined
  const path = new URL(`../${entry.file}`, import.meta.url).pathname
  const faces = entry.faces
    ? Object.fromEntries(
        Object.entries(entry.faces).map(([face, descriptor]) => [
          face,
          {
            ...descriptor,
            path: new URL(`../${descriptor.file}`, import.meta.url).pathname,
          },
        ]),
      )
    : undefined
  return { ...entry, path, ...(faces ? { faces } : {}) }
}
