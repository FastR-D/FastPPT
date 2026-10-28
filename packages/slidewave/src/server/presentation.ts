import { finalizeFreeforms } from './freeform.js'
import type { NativePaths } from '../primitives/native-geometry.js'
import { layoutDiagram, type DiagramLayoutInput } from '../primitives/diagram-layout.js'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { finalizeNativeTables } from './tables.js'
import { applyTextParagraphs, type CapturedNativeParagraph } from './text-paragraphs.js'
import { prepareTextLanguages, applyTextLanguages, type SerializedTextProperties } from './text-languages.js'

import type { Layout, Size } from '../types.js'

type PresentationOptions = Record<string, unknown>

interface PresentationImageOptions extends PresentationOptions {
  data?: string
  path?: string
}

interface PresentationSlideRuntime {
  background?: { color: string }
  addShape(type: string, options: PresentationOptions): unknown
  addText(
    text: string | PresentationTextRun[],
    options: PresentationOptions,
  ): unknown
  addTable(rows: PresentationTableCell[][], options: PresentationOptions): unknown
  addImage(options: PresentationImageOptions): unknown
  addNotes?(notes: string): unknown
}

export interface PresentationTableCell {
  text: PresentationTextRun[]
  options: PresentationOptions
}

interface PresentationTextRun {
  text: string
  options?: PresentationOptions
}

interface PresentationRuntime {
  layout: string
  title: string
  author: string
  theme: { headFontFace?: string; bodyFontFace?: string }
  ShapeType: { line: string }
  defineLayout(layout: { name: string; width: number; height: number }): void
  defineSlideMaster(props: PresentationOptions): void
  addSlide(options?: { masterName: string }): PresentationSlideRuntime
  writeFile(options: { fileName: string }): Promise<string>
  write(options: { outputType: 'arraybuffer' }): Promise<unknown>
}

type PresentationConstructor = new () => PresentationRuntime

const LAYOUT_SIZE: Record<Layout, Size> = {
  LAYOUT_WIDE: { width: 13.333, height: 7.5 },
  LAYOUT_16x9: { width: 10, height: 5.625 },
  LAYOUT_16x10: { width: 10, height: 6.25 },
  LAYOUT_4x3: { width: 10, height: 7.5 },
}

const require = createRequire(import.meta.url)
const PptxGenJSConstructor = require('pptxgenjs') as PresentationConstructor

export class NodePresentation {
  readonly #pptx = new PptxGenJSConstructor()
  readonly _slides: NodePresentationSlide[] = []
  readonly #size: Size
  readonly #master: boolean

  constructor(options: {
    layout: Layout | Size
    title?: string
    author?: string
    master?: boolean
    themeFont?: string
  }) {
    this.#size = typeof options.layout === 'string' ? LAYOUT_SIZE[options.layout] : { ...options.layout }
    if (![this.#size.width, this.#size.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid presentation dimensions')
    this.#master = options.master === true
    if (typeof options.layout === 'string') this.#pptx.layout = options.layout
    else {
      this.#pptx.defineLayout({ name: 'FASTPPT_CUSTOM', ...this.#size })
      this.#pptx.layout = 'FASTPPT_CUSTOM'
    }
    if (options.title) this.#pptx.title = options.title
    if (options.author) this.#pptx.author = options.author
    if (options.themeFont)
      this.#pptx.theme = {
        headFontFace: options.themeFont,
        bodyFontFace: options.themeFont,
      }
    if (this.#master)
      this.#pptx.defineSlideMaster({
        title: 'FASTPPT_MASTER',
        // Captured slide content already supplies its own editable text shapes.
        // Native template placeholders are added only by explicit layout definitions.
        objects: [],
      })
  }

  addSlide(): NodePresentationSlide {
    const slide = new NodePresentationSlide(
      this.#pptx,
      this.#pptx.addSlide(
        this.#master ? { masterName: 'FASTPPT_MASTER' } : undefined,
      ),
      this,
    )
    this._slides.push(slide)
    return slide
  }

  size(): Size {
    return { ...this.#size }
  }

  async flush(): Promise<void> {
    await Promise.resolve()
  }

  async save(outputPath: string): Promise<unknown> {
    await writeFile(outputPath, Buffer.from(await this.toArrayBuffer()))
    return outputPath
  }

  async toArrayBuffer(): Promise<ArrayBuffer> {
    const output = await this.#pptx.write({ outputType: 'arraybuffer' })
    if (!(output instanceof ArrayBuffer)) {
      throw new TypeError('PptxGenJS did not return an ArrayBuffer.')
    }
    const zip = await JSZip.loadAsync(output)
    // PptxGenJS 4 emits one master override per slide but writes only one master.
    // Keep declarations only for actual parts, before template masters are added.
    const types = zip.file('[Content_Types].xml')
    if (types) zip.file('[Content_Types].xml', (await types.async('string')).replace(
      /<Override\b[^>]*PartName="\/(ppt\/slideMasters\/[^"]+)"[^>]*\/>/g,
      (declaration: string, path: string) => zip.file(path) ? declaration : '',
    ))
    for (const [index, slide] of this._slides.entries()) {
      if (!slide._freeforms.length && !slide._textFrames.length && !slide._textLanguages.size && !slide._ops.some(op => op.kind === 'table')) continue
      const path = `ppt/slides/slide${index + 1}.xml`
      const part = zip.file(path)
      if (!part) throw new Error(`Missing native text frame slide: ${path}`)
      let xml = await part.async('string')
      xml = finalizeNativeTables(xml, slide._ops.filter(op => op.kind === 'table').map(op => ({ name: String(op.opts.objectName), headerRows: op.headerRows, insets: op.opts.insets as Array<{ row: number; column: number; values: number[] }>, runStyles: op.runStyles })))
      xml = finalizeFreeforms(xml, slide._freeforms)
      xml = applyTextLanguages(xml, slide._textLanguages)
      for (const frame of slide._textFrames) xml = applyTextParagraphs(xml, frame.name, frame.paragraphs)
      zip.file(path, xml)
    }
    return zip.generateAsync({ type: 'arraybuffer' })
  }
}

export class NodePresentationSlide {
  readonly _ops: NodePresentationOperation[] = []
  readonly _freeforms: Array<{name:string;geometry:NativePaths}> = []
  readonly _textFrames: Array<{ name: string; paragraphs: CapturedNativeParagraph[] }> = []
  readonly _textLanguages = new Map<string, SerializedTextProperties>()

  constructor(
    private readonly pptx: PresentationRuntime,
    private readonly slide: PresentationSlideRuntime,
    readonly _pres: NodePresentation,
  ) {}

  setBackground(color: string): void {
    this.slide.background = { color }
    this._ops.push({ kind: 'background', color })
  }

  addShape(type: string, options: object): void {
    const shapeOptions = options as PresentationOptions
    this.slide.addShape(type, shapeOptions)
    this._ops.push({ kind: 'shape', type, opts: shapeOptions })
  }

  addFreeform(geometry: NativePaths, options: PresentationOptions): void {
    const name=typeof options.objectName === 'string' ? options.objectName : `freeform-${this._freeforms.length+1}`
    this.addShape('rect', {...options,objectName:name})
    this._freeforms.push({name,geometry})
  }

  addLine(options: NodePresentationLineOptions): void {
    const { x1, y1, x2, y2, color, width, transparency, dash, endArrowType } =
      options
    const deltaX = Math.abs(x2 - x1)
    const deltaY = Math.abs(y2 - y1)
    this.slide.addShape(this.pptx.ShapeType.line, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: deltaX || (deltaY ? 0 : 0.01),
      h: deltaY || (deltaX ? 0 : 0.01),
      line: {
        color,
        width,
        ...(endArrowType ? { endArrowType } : {}),
        ...(transparency === undefined ? {} : { transparency }),
        ...(dash === undefined
          ? {}
          : { dashType: dash === 'dot' ? 'sysDot' : dash }),
      },
      flipV: y2 < y1,
      flipH: x2 < x1,
    })
    this._ops.push({ kind: 'line', ...options })
  }

  addText(text: string | PresentationTextRun[], options: object): void {
    const textOptions = options as PresentationOptions
    const prepared = prepareTextLanguages(text, textOptions, this._textLanguages)
    this.slide.addText(prepared.text, prepared.options)
    this._ops.push({
      kind: 'text',
      text:
        typeof text === 'string' ? text : text.map((run) => run.text).join(''),
      ...(typeof text === 'string' ? {} : { runs: text }),
      opts: textOptions,
    })
  }

  addTextFrame(text: PresentationTextRun[], options: PresentationOptions & { objectName: string }, paragraphs: CapturedNativeParagraph[]): void {
    this.addText(text, options)
    this._textFrames.push({ name: options.objectName, paragraphs })
  }

  addImage(options: PresentationImageOptions): void {
    this.slide.addImage(options)
    const data = options.data ?? options.path
    this._ops.push({
      kind: 'image',
      ...options,
      ...(data === undefined ? {} : { data }),
    })
  }

  addTable(rows: PresentationTableCell[][], options: PresentationOptions, headerRows: number): void {
    const captured = structuredClone(rows)
    const prepared = rows.map(row => row.map(cell => {
      const value = prepareTextLanguages(cell.text, cell.options, this._textLanguages)
      return { text: value.text as PresentationTextRun[], options: value.options }
    }))
    const runStyles = Object.fromEntries(prepared.flatMap(row => row.flatMap(cell => cell.text.map(run => [String(run.options?.lang), structuredClone(run.options ?? {})]))))
    this.slide.addTable(prepared, structuredClone(options))
    this._ops.push({ kind: 'table', rows: captured, opts: options, headerRows, runStyles })
  }

  addNotes(notes: string): void {
    this.slide.addNotes?.(notes)
  }

  addDiagram(document: NativeDiagramDocument, frame = { x: 0, y: 0, ...this._pres.size() }): void {
    const scaleX = frame.width / document.style.width
    const scaleY = frame.height / document.style.height
    for (const p of layoutDiagram(document)) {
      if (p.kind === 'line') {
        this.addLine({
          x1: frame.x + p.x1 * scaleX,
          y1: frame.y + p.y1 * scaleY,
          x2: frame.x + p.x2 * scaleX,
          y2: frame.y + p.y2 * scaleY,
          color: '64748B',
          width: 1.2,
          ...(p.arrow ? { endArrowType: 'triangle' as const } : {}),
        })
      } else if (p.kind === 'text') {
        this.addText(p.text, {
          x: frame.x + p.x * scaleX,
          y: frame.y + p.y * scaleY,
          w: p.width * scaleX,
          h: p.height * scaleY,
          fontFace: document.style.fontFamily,
          fontSize: p.fontSize * scaleY * 72,
          color: '334155',
          align: p.align,
          valign: 'mid',
          margin: 0,
          breakLine: false,
        })
      } else {
        this.addShape(p.kind === 'ellipse' ? 'ellipse' : 'roundRect', {
          x: frame.x + p.x * scaleX,
          y: frame.y + p.y * scaleY,
          w: p.width * scaleX,
          h: p.height * scaleY,
          rectRadius: 6 * scaleX,
          fill: { color: p.fill.slice(1).toUpperCase() },
          line: { color: p.stroke.slice(1).toUpperCase(), width: 1 },
        })
      }
    }
  }
}

export type NativeDiagramDocument = DiagramLayoutInput

interface NodePresentationLineOptions {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
  transparency?: number
  dash?: 'solid' | 'dash' | 'dot'
  endArrowType?: 'triangle'
}

type NodePresentationOperation =
  | { kind: 'table'; rows: PresentationTableCell[][]; opts: PresentationOptions; headerRows: number; runStyles: Record<string, PresentationOptions> }
  | { kind: 'background'; color: string }
  | { kind: 'shape'; type: string; opts: PresentationOptions }
  | ({ kind: 'line' } & NodePresentationLineOptions)
  | {
      kind: 'text'
      text: string
      runs?: PresentationTextRun[]
      opts: PresentationOptions
    }
  | ({ kind: 'image'; data?: string } & PresentationImageOptions)
