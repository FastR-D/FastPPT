/**
 * Editable PPTX export validation.
 *
 * A structural QA pass over the generated PPTX: the package must be a valid
 * OOXML ZIP with the required parts, the slide count must match the manifest,
 * every relationship target must exist, no slide may be dominated by a single
 * full-slide raster, and each slide must carry native editable text. The report
 * is evidence for the export job; it deliberately avoids hashing/fingerprinting.
 */

import { basename, posix } from 'node:path'

import JSZip from 'jszip'

export type ExportQaCode =
  | 'invalid-package'
  | 'missing-part'
  | 'invalid-xml'
  | 'slide-count-mismatch'
  | 'missing-relationship-target'
  | 'full-slide-raster'
  | 'no-native-text'

export interface ExportQaIssue {
  code: ExportQaCode
  message: string
  slide?: number
}

export interface ExportQaReport {
  ok: boolean
  slideCount: number
  issues: ExportQaIssue[]
}

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  'ppt/presentation.xml',
  'ppt/_rels/presentation.xml.rels',
]

function resolveTarget(relsPath: string, target: string): string {
  // A rels file at ppt/X/_rels/Y.rels describes part ppt/X/Y, and relationship
  // targets are relative to the PART's directory (the parent of `_rels`).
  const partDirectory = posix.dirname(relsPath).replace(/\/_rels$/, '')
  return posix.normalize(posix.join(partDirectory, target))
}

function slideXmlNames(zip: JSZip): string[] {
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number.parseInt(basename(a).match(/\d+/)?.[0] ?? '0', 10)
      const nb = Number.parseInt(basename(b).match(/\d+/)?.[0] ?? '0', 10)
      return na - nb
    })
  return names
}

export async function validateEditablePptx(
  pptx: ArrayBuffer | Uint8Array | Buffer,
  expectedSlides?: number,
): Promise<ExportQaReport> {
  const issues: ExportQaIssue[] = []
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(pptx)
  } catch (cause) {
    return {
      ok: false,
      slideCount: 0,
      issues: [
        {
          code: 'invalid-package',
          message: `Not a valid OOXML ZIP package: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        },
      ],
    }
  }

  const missingPart = (path: string): boolean => {
    const present = zip.files[path] !== undefined && !zip.files[path].dir
    if (!present)
      issues.push({
        code: 'missing-part',
        message: `Required part is missing: ${path}`,
      })
    return !present
  }

  for (const part of REQUIRED_PARTS) missingPart(part)
  if (issues.length > 0)
    return { ok: false, slideCount: 0, issues }

  const slideNames = slideXmlNames(zip)
  const slideCount = slideNames.length
  if (slideCount === 0) {
    issues.push({
      code: 'missing-part',
      message: 'No slide parts were found under ppt/slides/',
    })
    return { ok: false, slideCount: 0, issues }
  }

  // Slide size from presentation.xml (EMU).
  let slideWidth = 0
  let slideHeight = 0
  try {
    const presentation = await zip.files['ppt/presentation.xml']!.async('string')
    if (!/<p:presentation\b/.test(presentation) || !/<\/p:presentation>/.test(presentation))
      issues.push({
        code: 'invalid-xml',
        message: 'presentation.xml is not well-formed PresentationML',
      })
    const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation)
    if (size) {
      slideWidth = Number.parseInt(size[1]!, 10)
      slideHeight = Number.parseInt(size[2]!, 10)
    }
  } catch (cause) {
    issues.push({
      code: 'invalid-xml',
      message: `Could not read presentation.xml: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
  }

  if (expectedSlides !== undefined && slideCount !== expectedSlides) {
    issues.push({
      code: 'slide-count-mismatch',
      message: `Expected ${expectedSlides} slides, found ${slideCount}`,
    })
  }

  // Per-slide structural checks.
  for (let index = 0; index < slideCount; index++) {
    const slideNumber = index + 1
    const name = slideNames[index]!
    let xml: string
    try {
      xml = await zip.files[name]!.async('string')
    } catch (cause) {
      issues.push({
        code: 'invalid-xml',
        slide: slideNumber,
        message: `Could not read slide XML: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      })
      continue
    }
    if (!/<p:sld\b/.test(xml) || !/<\/p:sld>/.test(xml)) {
      issues.push({
        code: 'invalid-xml',
        slide: slideNumber,
        message: `${name} is not well-formed slide XML`,
      })
    }
    const hasNativeText = /<a:t\b/.test(xml)
    if (!hasNativeText) {
      issues.push({
        code: 'no-native-text',
        slide: slideNumber,
        message: `Slide ${slideNumber} contains no native editable text`,
      })
    }
    if (!hasNativeText && slideWidth > 0 && slideHeight > 0) {
      const picRe = /<p:pic\b[\s\S]*?<\/p:pic>/g
      let pic: RegExpExecArray | null
      while ((pic = picRe.exec(xml))) {
        const ext = /<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(pic[0])
        if (!ext) continue
        const cx = Number.parseInt(ext[1]!, 10)
        const cy = Number.parseInt(ext[2]!, 10)
        if (cx > slideWidth * 0.9 && cy > slideHeight * 0.9) {
          issues.push({
            code: 'full-slide-raster',
            slide: slideNumber,
            message: `Slide ${slideNumber} has a raster image covering most of the canvas`,
          })
          break
        }
      }
    }
  }

  // Relationship targets must resolve to an existing part.
  const relsNames = Object.keys(zip.files).filter((name) =>
    /^ppt\/.*\/_rels\/.*\.rels$/.test(name),
  )
  for (const relsName of relsNames) {
    let relsXml: string
    try {
      relsXml = await zip.files[relsName]!.async('string')
    } catch {
      continue
    }
    const targetRe = /<Relationship[^>]*Target="([^"]+)"/g
    let match: RegExpExecArray | null
    while ((match = targetRe.exec(relsXml))) {
      const target = match[1]!
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:'))
        continue
      const resolved = resolveTarget(relsName, target)
      if (zip.files[resolved] === undefined) {
        issues.push({
          code: 'missing-relationship-target',
          message: `Relationship from ${relsName} targets missing part: ${resolved}`,
        })
      }
    }
  }

  return { ok: issues.length === 0, slideCount, issues }
}
