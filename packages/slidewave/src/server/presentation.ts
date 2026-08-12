import { createRequire } from 'node:module'

import type { Layout, Size } from '../types.js'

type PresentationOptions = Record<string, unknown>

interface PresentationImageOptions extends PresentationOptions {
  data?: string
  path?: string
}

interface PresentationSlideRuntime {
  addShape(type: string, options: PresentationOptions): unknown
  addText(
    text: string | PresentationTextRun[],
    options: PresentationOptions,
  ): unknown
  addImage(options: PresentationImageOptions): unknown
}

interface PresentationTextRun {
  text: string
  options?: PresentationOptions
}

interface PresentationRuntime {
  layout: string
  title: string
  author: string
  ShapeType: { line: string }
  addSlide(): PresentationSlideRuntime
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
  readonly #layout: Layout

  constructor(options: { layout: Layout; title?: string; author?: string }) {
    this.#layout = options.layout
    this.#pptx.layout = options.layout
    if (options.title) this.#pptx.title = options.title
    if (options.author) this.#pptx.author = options.author
  }

  addSlide(): NodePresentationSlide {
    const slide = new NodePresentationSlide(
      this.#pptx,
      this.#pptx.addSlide(),
      this,
    )
    this._slides.push(slide)
    return slide
  }

  size(): Size {
    return LAYOUT_SIZE[this.#layout]
  }

  async flush(): Promise<void> {
    await Promise.resolve()
  }

  async save(outputPath: string): Promise<unknown> {
    return this.#pptx.writeFile({ fileName: outputPath })
  }

  async toArrayBuffer(): Promise<ArrayBuffer> {
    const output = await this.#pptx.write({ outputType: 'arraybuffer' })
    if (!(output instanceof ArrayBuffer)) {
      throw new TypeError('PptxGenJS did not return an ArrayBuffer.')
    }
    return output
  }
}

export class NodePresentationSlide {
  readonly _ops: NodePresentationOperation[] = []

  constructor(
    private readonly pptx: PresentationRuntime,
    private readonly slide: PresentationSlideRuntime,
    readonly _pres: NodePresentation,
  ) {}

  addShape(type: string, options: object): void {
    const shapeOptions = options as PresentationOptions
    this.slide.addShape(type, shapeOptions)
    this._ops.push({ kind: 'shape', type, opts: shapeOptions })
  }

  addLine(options: NodePresentationLineOptions): void {
    const { x1, y1, x2, y2, color, width, transparency, dash } = options
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
    this.slide.addText(text, textOptions)
    this._ops.push({
      kind: 'text',
      text:
        typeof text === 'string'
          ? text
          : text.map((run) => run.text).join(''),
      ...(typeof text === 'string' ? {} : { runs: text }),
      opts: textOptions,
    })
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
}

interface NodePresentationLineOptions {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
  transparency?: number
  dash?: 'solid' | 'dash' | 'dot'
}

type NodePresentationOperation =
  | { kind: 'shape'; type: string; opts: PresentationOptions }
  | ({ kind: 'line' } & NodePresentationLineOptions)
  | {
      kind: 'text'
      text: string
      runs?: PresentationTextRun[]
      opts: PresentationOptions
    }
  | ({ kind: 'image'; data?: string } & PresentationImageOptions)
