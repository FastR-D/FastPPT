import {
  DEFAULT_DECOR_CATALOG,
  hasDecorInput,
  normalizeDecorCatalog,
  resolveDecorImage,
} from './decor-config.mjs'
import {
  isSvgImageSource,
  parseImageBackgrounds,
  parseImageConfig,
  resolveImageMaskSize,
} from './image-config.mjs'

/**
 * @typedef {Record<string, unknown>} PlainRecord
 * @typedef {import('./image-config.mjs').NormalizedImageData} NormalizedImageData
 * @typedef {import('./decor-config.mjs').NormalizedDecorCatalog} NormalizedDecorCatalog
 * @typedef {{ cols?: number, rows?: number, label?: string }} GridFootprint
 * @typedef {{ key: string, image: NormalizedImageData, render: { kind: 'img' | 'mask', decorative: boolean, alt: string, cssVars: Record<string, string> } }} ThemeMediaLayer
 * @typedef {{ background?: unknown, decor?: unknown }} ThemeSlotLayerInput
 * @typedef {{ label?: string, footprint?: GridFootprint | null, seed?: string, tone?: string, contrast?: boolean }} ThemeSlotMediaContext
 * @typedef {{ baseCatalog?: readonly object[] | NormalizedDecorCatalog, themeCatalog?: readonly object[], warn?: (message: string) => void }} ThemeMediaInput
 * @typedef {{ key?: string, alt?: string, decorative?: boolean }} LayerOptions
 */

/**
 * @param {unknown} value
 * @returns {value is PlainRecord}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is NormalizedDecorCatalog}
 */
function isNormalizedDecorCatalog(value) {
  return isRecord(value)
    && Array.isArray(value.variants)
    && value.byId instanceof Map
}

/**
 * @param {unknown} value
 */
function hasBackgroundInput(value) {
  if (value === undefined || value === null || value === '')
    return false

  if (Array.isArray(value))
    return value.some(item => item !== undefined && item !== null && item !== '')

  return true
}

/**
 * @param {readonly object[] | NormalizedDecorCatalog | undefined} baseCatalog
 * @param {readonly object[] | undefined} themeCatalog
 * @returns {NormalizedDecorCatalog}
 */
function resolveCatalog(baseCatalog, themeCatalog) {
  const base = isNormalizedDecorCatalog(baseCatalog)
    ? baseCatalog
    : normalizeDecorCatalog(Array.isArray(baseCatalog) ? baseCatalog : [])

  if (!Array.isArray(themeCatalog) || themeCatalog.length === 0)
    return base

  return normalizeDecorCatalog([...base.variants], themeCatalog)
}

/**
 * @param {NormalizedImageData} image
 * @param {'img' | 'mask'} kind
 * @returns {Record<string, string>}
 */
function cssVarsForImage(image, kind) {
  return {
    '--theme-image-background': image.backgroundColor || 'transparent',
    '--theme-image-fit': image.fit,
    '--theme-image-position': image.position,
    '--theme-image-origin': image.anchor,
    '--theme-image-x': image.x,
    '--theme-image-y': image.y,
    '--theme-image-zoom': String(image.zoom),
    '--theme-image-rotate': image.rotate,
    '--theme-image-opacity': String(image.opacity),
    ...(kind === 'mask'
      ? {
          '--theme-image-color': image.color || 'currentColor',
          '--theme-image-mask': `url("${image.src}")`,
          '--theme-image-mask-size': resolveImageMaskSize(image.fit),
        }
      : {}),
  }
}

/**
 * @param {NormalizedImageData} image
 * @param {LayerOptions} [options]
 * @returns {ThemeMediaLayer}
 */
function createLayer(image, options = {}) {
  const kind = image.color && isSvgImageSource(image.src) ? 'mask' : 'img'
  const alt = typeof options.alt === 'string' ? options.alt : ''
  const decorative = options.decorative ?? !alt

  return {
    key: options.key || `${kind}:${image.src}:${image.fit}:${image.position}:${image.zoom}:${image.color}:${image.opacity}`,
    image,
    render: {
      kind,
      decorative,
      alt,
      cssVars: cssVarsForImage(image, kind),
    },
  }
}

/**
 * @param {ThemeMediaInput} [input]
 */
export function createThemeMedia(input = {}) {
  const catalog = resolveCatalog(input.baseCatalog ?? DEFAULT_DECOR_CATALOG, input.themeCatalog)
  const warn = typeof input.warn === 'function' ? input.warn : undefined

  return {
    /**
     * @param {ThemeSlotLayerInput} [layerInput]
     * @param {ThemeSlotMediaContext} [context]
     * @returns {ThemeMediaLayer[]}
     */
    resolveSlotLayers(layerInput = {}, context = {}) {
      const hasBackground = hasBackgroundInput(layerInput.background)
      const hasDecor = layerInput.decor ? hasDecorInput(layerInput.decor) : false
      const label = context.label || 'slot'

      if (hasBackground && hasDecor)
        throw new Error(`[${label}] background and decor cannot be used together.`)

      if (hasDecor) {
        if (!context.footprint)
          return []

        const image = resolveDecorImage(layerInput.decor, {
          catalog: catalog.variants,
          footprint: context.footprint,
          seed: context.seed,
          warn,
          label: `${label}.decor`,
        })

        return image
          ? [createLayer(image, { key: `${label}.decor:${image.src}:${context.seed ?? ''}`, decorative: true })]
          : []
      }

      if (!hasBackground)
        return []

      return parseImageBackgrounds(
        /** @type {Parameters<typeof parseImageBackgrounds>[0]} */ (layerInput.background),
        {},
        `${label}.background`,
      )
        .map((image, index) =>
          createLayer(image, { key: `${label}.background:${index}:${image.src}`, decorative: true }),
        )
    },

    /**
     * @param {unknown} imageInput
     * @param {string} [label]
     * @returns {ThemeMediaLayer | null}
     */
    resolveImage(imageInput, label = 'image') {
      if (!imageInput)
        return null

      if (typeof imageInput === 'string' && !imageInput.trim())
        return null

      if (isRecord(imageInput) && typeof imageInput.src === 'string' && !imageInput.src.trim())
        return null

      const image = parseImageConfig(
        /** @type {Parameters<typeof parseImageConfig>[0]} */ (imageInput),
        {},
        label,
      )
      if (!image)
        return null

      return createLayer(image, {
        key: `${label}:${image.src}`,
        alt: image.alt,
        decorative: !image.alt,
      })
    },
  }
}
