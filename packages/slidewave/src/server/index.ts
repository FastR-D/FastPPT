import { writeFile } from 'node:fs/promises'

import { htmlDeckToPresentation } from '../slidev/render.js'
import { embedFonts, type FontEmbedOptions } from '../fonts/embedFonts.js'
import type { ResolvedFontFile } from '../fonts/embedFonts.js'
import { validateEditablePptx, type ExportQaReport } from '../export/validate.js'

import type { HtmlDeckSnapshot } from '../snapshot-types.js'
import type { HtmlConversionWarning } from '../snapshot-types.js'

export interface WriteEditablePptxOptions {
  title?: string
  /**
   * Embed subsetted fonts into the PPTX. Enabled when `true` or when a
   * `resolveFont` catalog is supplied (FastPPT passes `@fastppt/fonts`'s
   * registry resolver here). Explicitly `false` disables embedding.
   */
  embedFonts?: boolean | FontEmbedOptions
  /** Per-family font-binary resolver for embedding. */
  resolveFont?: (family: string) => ResolvedFontFile | undefined
}

export interface WriteEditablePptxResult {
  warnings: HtmlConversionWarning[]
  elementCount: number
  slideCount: number
  embeddedFaces: number
  qa: ExportQaReport
}

export interface EditablePptxRuntimeStatus {
  status: 'available'
  version: 'slidewave 0.6.1-fastppt.1'
  byteLength: number
  fontEmbedding: 'ok'
}

export async function probeEditablePptxRuntime(): Promise<EditablePptxRuntimeStatus> {
  const rendered = htmlDeckToPresentation({
    version: 1,
    source: 'html',
    slides: [
      {
        version: 1,
        id: 'readiness-probe',
        width: 1600,
        height: 900,
        elements: [],
        warnings: [],
      },
    ],
    warnings: [],
  })
  const output = await rendered.presentation.toArrayBuffer()
  const signature = new Uint8Array(output, 0, Math.min(2, output.byteLength))
  if (output.byteLength === 0 || signature[0] !== 0x50 || signature[1] !== 0x4b)
    throw new Error('Slidewave did not produce a valid PPTX ZIP payload.')
  return {
    status: 'available',
    version: 'slidewave 0.6.1-fastppt.1',
    byteLength: output.byteLength,
    fontEmbedding: 'ok',
  }
}

export async function writeEditablePptx(
  snapshot: HtmlDeckSnapshot,
  outputPath: string,
  options: WriteEditablePptxOptions = {},
): Promise<WriteEditablePptxResult> {
  const rendered = htmlDeckToPresentation(snapshot, {
    layout: 'LAYOUT_WIDE',
    ...(options.title ? { title: options.title } : {}),
  })
  const embed =
    options.embedFonts !== false &&
    (options.embedFonts === true || typeof options.resolveFont === 'function')
  const embedOptions: FontEmbedOptions | undefined = typeof options.embedFonts === 'object'
    ? options.embedFonts
    : typeof options.resolveFont === 'function'
      ? { resolveFont: options.resolveFont }
      : undefined
  const warnings: HtmlConversionWarning[] = [...rendered.warnings]
  let embeddedFaces = 0
  try {
    const raw = await rendered.presentation.toArrayBuffer()
    let buffer = raw
    if (embed && embedOptions) {
      const result = await embedFonts(raw, embedOptions)
      warnings.push(...result.warnings)
      embeddedFaces = result.embeddedFaces
      buffer = result.buffer
    }
    const qa = await validateEditablePptx(buffer, snapshot.slides.length)
    await writeFile(outputPath, Buffer.from(buffer))
    return {
      warnings,
      elementCount: rendered.elementCount,
      slideCount: snapshot.slides.length,
      embeddedFaces,
      qa,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`PPTX serialization failed: ${message}`, { cause })
  }
}
