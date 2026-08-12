// Resolve an asset URL for use in an inline `background-image` style.
// Absolute site paths (`/foo.jpg`) are rebased onto Slidev's BASE_URL so decks
// still work when served from a sub-path (e.g. GitHub Pages); anything else —
// a remote URL — is returned unchanged.
export function resolveAssetUrl(url: string) {
  if (url.startsWith('/'))
    return import.meta.env.BASE_URL + url.slice(1)
  return url
}
