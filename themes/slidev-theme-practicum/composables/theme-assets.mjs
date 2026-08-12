const THEME_ASSET_PREFIX = '/theme'
const THEME_ASSET_ORIGIN = 'https://theme-assets.invalid'

function unsafeThemeAssetPath() {
  throw new Error('theme asset path содержит небезопасные сегменты')
}

export function themeAssetPath(path = '') {
  const source = String(path)
  const pathPart = source.split(/[?#]/, 1)[0]

  if (pathPart.includes('\\'))
    unsafeThemeAssetPath()

  const segments = pathPart
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)

  for (const segment of segments) {
    let decoded = ''

    try {
      decoded = decodeURIComponent(segment)
    }
    catch {
      unsafeThemeAssetPath()
    }

    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\'))
      unsafeThemeAssetPath()
  }

  const normalized = `/${source.replace(/^\/+/, '')}`
  const normalizedPathPart = normalized.split(/[?#]/, 1)[0]
  const candidate = normalizedPathPart === THEME_ASSET_PREFIX
    || normalizedPathPart.startsWith(`${THEME_ASSET_PREFIX}/`)
    ? normalized
    : `${THEME_ASSET_PREFIX}${normalized}`
  const url = new URL(candidate, THEME_ASSET_ORIGIN)

  if (url.pathname !== THEME_ASSET_PREFIX && !url.pathname.startsWith(`${THEME_ASSET_PREFIX}/`))
    unsafeThemeAssetPath()

  return candidate
}

/**
 * @param {number} number
 */
export function themePhotoPath(number) {
  return themeAssetPath(`/photos/photo-${number}.webp`)
}

/**
 * @param {string} file
 */
export function themeDecorPath(file) {
  return themeAssetPath(`/decor/${String(file).replace(/^\/+/, '')}`)
}
