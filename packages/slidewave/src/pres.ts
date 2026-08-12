import PptxGenJS from 'pptxgenjs'
import { Slide } from './slide'
import { renderSlideToSvg } from './preview/renderSvg'
import { mergeTheme, DEFAULT_THEME } from './theme'
import { rasterCacheStats, clearRasterCache, setRasterCacheMax } from './cache'
import type { AddSlideOptions, PresOptions, Size, Theme } from './types'

/**
 * Pres — Slidewave's main entry point.
 *
 * Usage:
 *   const pres = new Pres({ layout: 'LAYOUT_WIDE' })
 *   const slide = pres.addSlide()
 *   await slide.addBackground({ gradient: { type: 'mesh', colors: [...] } })
 *   slide.addText('Hello', { x: 1, y: 1, fontFace: 'Fraunces', fontSize: 72 })
 *   await pres.save('demo.pptx')
 */
export class Pres {
  /** @internal */ declare _pptx: PptxGenJS
  /** @internal */ declare _slides: Slide[]
  /** @internal */ declare _theme: Theme
  /** @internal */ declare _previewMode?: boolean

  constructor(opts: PresOptions = {}) {
    const {
      layout = 'LAYOUT_WIDE', // LAYOUT_WIDE = 13.333x7.5, LAYOUT_16x9 = 10x5.63, LAYOUT_16x10 = 10x6.25, LAYOUT_4x3 = 10x7.5
      title = '',
      author = '',
      company = '',
      subject = '',
    } = opts

    this._pptx = new PptxGenJS()
    this._pptx.layout = layout
    if (title) this._pptx.title = title
    if (author) this._pptx.author = author
    if (company) this._pptx.company = company
    if (subject) this._pptx.subject = subject

    this._slides = []
    this._theme = mergeTheme(opts.theme)
  }

  /**
   * Defines or updates the global theme. Primitives use these values
   * by default when no explicit override is provided.
   *
   *   pres.setTheme({ primary: '#FF0000', fontBody: 'Inter' })
   */
  setTheme(theme: Partial<Theme> = {}) {
    this._theme = { ...this._theme, ...theme }
    return this
  }

  /** Read-only access to the current theme. */
  get theme() {
    return this._theme
  }

  /** Global raster-cache statistics: { size, max, hits, misses, hitRate }. */
  get cacheStats() {
    return rasterCacheStats()
  }

  /** Clears the global raster cache. */
  clearCache() {
    clearRasterCache()
    return this
  }

  /** Configures the raster LRU cache limit (default: 150). */
  setCacheMax(n: number) {
    setRasterCacheMax(n)
    return this
  }

  /** Current slide dimensions in inches. */
  size(): Size {
    const L = this._pptx.layout
    const map: Record<string, { width: number; height: number }> = {
      LAYOUT_WIDE: { width: 13.333, height: 7.5 },
      LAYOUT_16x9: { width: 10, height: 5.625 },
      LAYOUT_16x10: { width: 10, height: 6.25 },
      LAYOUT_4x3: { width: 10, height: 7.5 },
    }
    return map[L] || { width: 13.333, height: 7.5 }
  }

  addSlide(opts: AddSlideOptions = {}) {
    const pptxSlide = this._pptx.addSlide()
    const slide = new Slide(pptxSlide, this)
    this._slides.push(slide)

    if (opts.background) {
      slide.addBackground(opts.background)
    }
    return slide
  }

  /**
   * Direct access to pptxgenjs constants (ShapeType, AlignH, and so on).
   */
  get ShapeType() {
    return this._pptx.ShapeType
  }
  get AlignH() {
    return this._pptx.AlignH
  }
  get AlignV() {
    return this._pptx.AlignV
  }

  /**
   * Writes the .pptx and triggers a browser download.
   * This is a no-op in preview mode (`_previewMode=true`).
   */
  async save(filename = 'presentation.pptx') {
    await this._flushAll()
    if (this._previewMode) return null
    return this._pptx.writeFile({ fileName: filename })
  }

  /**
   * Renders the slide at the requested index as an SVG string.
   * Useful for live previews before generating the .pptx file.
   */
  renderSvg(index = 0) {
    const slide = this._slides[index]
    if (!slide) return ''
    return renderSlideToSvg(slide, this.size())
  }

  /**
   * Renders every slide as an array of SVG strings.
   */
  renderAllSvg() {
    return this._slides.map((s) => renderSlideToSvg(s, this.size()))
  }

  /**
   * Waits for every pending asynchronous primitive across all slides.
   * Runs automatically before save/toBlob/toArrayBuffer.
   */
  /** @internal */
  async _flushAll() {
    await Promise.all(this._slides.map((s) => s._flush()))
  }

  /** Flushes manually, which is useful before renderAllSvg when primitives are queued. */
  async flush() {
    return this._flushAll()
  }

  /** Number of slides. */
  get slideCount() {
    return this._slides.length
  }

  /**
   * Returns a .pptx Blob for custom processing.
   */
  async toBlob(): Promise<Blob> {
    await this._flushAll()
    const result = await this._pptx.write({ outputType: 'blob' })
    return result as Blob
  }

  /**
   * Returns raw bytes, for example for backend processing.
   */
  async toArrayBuffer(): Promise<ArrayBuffer> {
    await this._flushAll()
    return this._pptx.write({
      outputType: 'arraybuffer',
    }) as Promise<ArrayBuffer>
  }
}
