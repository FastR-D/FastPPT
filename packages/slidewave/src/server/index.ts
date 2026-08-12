import { htmlDeckToPresentation } from '../slidev/render.js'

import type { HtmlDeckSnapshot } from '../snapshot-types.js'
import type { HtmlConversionWarning } from '../snapshot-types.js'

export interface WriteEditablePptxOptions {
  title?: string
}

export interface WriteEditablePptxResult {
  warnings: HtmlConversionWarning[]
  elementCount: number
  slideCount: number
}

export interface EditablePptxRuntimeStatus {
  status: 'available'
  version: 'slidewave 0.6.1-fastppt.1'
  byteLength: number
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
  try {
    await rendered.presentation.save(outputPath)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`PPTX serialization failed: ${message}`, { cause })
  }
  return {
    warnings: rendered.warnings,
    elementCount: rendered.elementCount,
    slideCount: snapshot.slides.length,
  }
}
