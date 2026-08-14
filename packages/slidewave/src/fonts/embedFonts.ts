/**
 * PPTX font embedding.
 *
 * PowerPoint embeds fonts in `.pptx` as `ppt/fonts/fontN.fntdata` parts (EOT
 * containers), registered through `<p:embeddedFontLst>` in presentation.xml,
 * a relationship from the presentation part, and a `[Content_Types].xml`
 * default for the `fntdata` extension. This module post-processes a generated
 * PPTX buffer: it scans the slide XML for every `typeface` actually used,
 * subsets the matching bundled font (from `@fastppt/fonts`) to the glyphs in
 * the deck, wraps each face in EOT, and wires the parts into the package.
 *
 * It also handles CJK correctly: pptxgenjs writes the same family to
 * `a:latin`/`a:ea`/`a:cs`, so a run's CJK characters are assigned to its
 * `a:ea` font and Latin characters to its `a:latin` font during collection.
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import JSZip from 'jszip'
import subsetFont from 'subset-font'
import ttf2eot from 'ttf2eot'

import type { HtmlConversionWarning } from '../snapshot-types.js'

export interface ResolvedFontFile {
  path: string
  /** True when the binary is a variable font covering a weight axis. */
  variable?: boolean
  subset?: boolean
  faces?: Partial<
    Record<
      'regular' | 'bold' | 'italic' | 'boldItalic',
      { path: string; variable?: boolean; subset?: boolean }
    >
  >
}

export interface FontEmbedOptions {
  /**
   * Resolve a family to its bundled font binary. Callers own the catalog
   * (FastPPT supplies `@fastppt/fonts/registry`); slidewave stays free of
   * `@fastppt/*` dependencies. When omitted, no font is embedded and every
   * used family emits an `unembedded-font` warning.
   */
  resolveFont?: (family: string) => ResolvedFontFile | undefined
  /** Upper bound on total embedded font bytes; once exceeded, later faces warn and are skipped. */
  maxTotalBytes?: number
}

export interface FontEmbedResult {
  /** Final PPTX bytes (re-zipped when any face was embedded). */
  buffer: ArrayBuffer
  embeddedFaces: number
  warnings: HtmlConversionWarning[]
}

type FontFaceKey = 'regular' | 'bold' | 'italic' | 'boldItalic'
const FACE_KEYS: readonly FontFaceKey[] = ['regular', 'bold', 'italic', 'boldItalic']

const EMBEDDED_FONT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/embeddedFont'
const FNTDATA_CONTENT_TYPE = 'application/x-fontdata'

interface TypefaceUsage {
  faces: Record<FontFaceKey, string>
}

function faceKeyOf(bold: boolean, italic: boolean): FontFaceKey {
  if (bold && italic) return 'boldItalic'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'regular'
}

/** Rough CJK / East-Asian code-point ranges. */
function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x2eff) ||
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fffd)
  )
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Scan one slide part for `a:r` runs and accumulate text per typeface + face. */
function collectTypefaces(slideXml: string, usage: Map<string, TypefaceUsage>): void {
  const runRe = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g
  let match: RegExpExecArray | null
  while ((match = runRe.exec(slideXml))) {
    const run = match[1]!
    const rPr = /<a:rPr\b([^>]*)>/.exec(run)?.[1] ?? ''
    const bold = /\bb="1"/.test(rPr)
    const italic = /\bi="1"/.test(rPr)
    const latin = /<a:latin\b[^>]*typeface=["']([^"']*)["']/.exec(run)?.[1]
    const ea = /<a:ea\b[^>]*typeface=["']([^"']*)["']/.exec(run)?.[1]
    const cs = /<a:cs\b[^>]*typeface=["']([^"']*)["']/.exec(run)?.[1]

    let text = ''
    const textRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
    let tMatch: RegExpExecArray | null
    while ((tMatch = textRe.exec(run))) text += decodeXmlEntities(tMatch[1]!)
    if (!text) continue

    const faceKey = faceKeyOf(bold, italic)
    for (const char of text) {
      const cjk = isCjkCodePoint(char.codePointAt(0)!)
      // East-Asian characters use the ea font; complex scripts the cs font;
      // everything else (Latin, digits, punctuation) the latin font.
      const family = cjk ? ea ?? latin : cs ?? latin ?? ea
      if (!family) continue
      let entry = usage.get(family)
      if (!entry) {
        entry = { faces: { regular: '', bold: '', italic: '', boldItalic: '' } }
        usage.set(family, entry)
      }
      entry.faces[faceKey] += char
    }
  }
}

async function maxRelationshipId(zip: JSZip): Promise<number> {
  const rels = zip.file('ppt/_rels/presentation.xml.rels')
  if (!rels) return 0
  const xml = await rels.async('string')
  const ids = [...xml.matchAll(/rId(\d+)/g)].map((m) => Number.parseInt(m[1] ?? '', 10))
  return ids.length > 0 ? Math.max(...ids) : 0
}

async function addContentTypeDefault(zip: JSZip): Promise<void> {
  const path = '[Content_Types].xml'
  const part = zip.file(path)
  if (!part) return
  let xml = await part.async('string')
  if (/Extension="fntdata"/.test(xml)) return
  const defaults = [...xml.matchAll(/<Default\b[^>]*\/>/g)]
  const last = defaults.at(-1)
  if (last) {
    const idx = last.index + last[0].length
    xml = `${xml.slice(0, idx)}<Default Extension="fntdata" ContentType="${FNTDATA_CONTENT_TYPE}"/>${xml.slice(idx)}`
  } else {
    const typesOpen = /<Types[^>]*>/.exec(xml)
    if (typesOpen) {
      const idx = typesOpen.index + typesOpen[0].length
      xml = `${xml.slice(0, idx)}<Default Extension="fntdata" ContentType="${FNTDATA_CONTENT_TYPE}"/>${xml.slice(idx)}`
    }
  }
  zip.file(path, xml)
}

async function addEmbeddedFontRels(
  zip: JSZip,
  faces: Array<{ part: string }>,
  startId: number,
): Promise<void> {
  const path = 'ppt/_rels/presentation.xml.rels'
  const part = zip.file(path)
  if (!part) return
  let xml = await part.async('string')
  const entries = faces
    .map((face, i) => {
      const id = startId + i
      const target = `fonts/${basename(face.part)}`
      return `<Relationship Id="rId${id}" Type="${EMBEDDED_FONT_REL}" Target="${target}"/>`
    })
    .join('')
  xml = xml.replace('</Relationships>', `${entries}</Relationships>`)
  zip.file(path, xml)
}

async function injectEmbeddedFontLst(
  zip: JSZip,
  faces: Array<{ typeface: string; face: FontFaceKey; relId: number }>,
): Promise<void> {
  const path = 'ppt/presentation.xml'
  const part = zip.file(path)
  if (!part) return
  let xml = await part.async('string')

  const byTypeface = new Map<string, Array<{ face: FontFaceKey; relId: number }>>()
  for (const face of faces) {
    const group = byTypeface.get(face.typeface) ?? []
    group.push(face)
    byTypeface.set(face.typeface, group)
  }

  let lst = '<p:embeddedFontLst>'
  for (const [typeface, group] of byTypeface) {
    const regular = group.find((f) => f.face === 'regular')
    const bold = group.find((f) => f.face === 'bold')
    const italic = group.find((f) => f.face === 'italic')
    const boldItalic = group.find((f) => f.face === 'boldItalic')
    lst += `<p:embeddedFont><p:font typeface="${escapeXml(typeface)}"/>`
    if (regular) lst += `<p:regular r:id="rId${regular.relId}"/>`
    if (bold) lst += `<p:bold r:id="rId${bold.relId}"/>`
    if (italic) lst += `<p:italic r:id="rId${italic.relId}"/>`
    if (boldItalic) lst += `<p:boldItalic r:id="rId${boldItalic.relId}"/>`
    lst += '</p:embeddedFont>'
  }
  lst += '</p:embeddedFontLst>'

  const anchor = /<\/p:notesSz>/.exec(xml)
    ? '</p:notesSz>'
    : /<\/p:sldSz>/.exec(xml)
      ? '</p:sldSz>'
      : '</p:sldIdLst>'
  if (!xml.includes(anchor)) return
  xml = xml.replace(anchor, `${anchor}${lst}`)
  xml = xml.replace(/<p:presentation\b/, '<p:presentation embedTrueTypeFonts="1" saveSubsetFonts="1"')
  zip.file(path, xml)
}

export async function embedFonts(
  pptx: ArrayBuffer,
  options: FontEmbedOptions = {},
): Promise<FontEmbedResult> {
  const zip = await JSZip.loadAsync(pptx)
  const usage = new Map<string, TypefaceUsage>()
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue
    const xml = await zip.files[name]!.async('string')
    collectTypefaces(xml, usage)
  }
  if (usage.size === 0) return { buffer: pptx, embeddedFaces: 0, warnings: [] }

  const resolve = options.resolveFont ?? (() => undefined)
  const warnings: HtmlConversionWarning[] = []
  const faces: Array<{ typeface: string; face: FontFaceKey; part: string }> = []
  let fontIndex = 0
  let totalBytes = 0
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024

  for (const [typeface, typefaceUsage] of usage) {
    const resolved = resolve(typeface)
    if (!resolved) {
      warnings.push({
        code: 'unembedded-font',
        message: `Font "${typeface}" is not in the local catalog; machines without it will fall back.`,
      })
      continue
    }
    for (const face of FACE_KEYS) {
      const text = typefaceUsage.faces[face]
      if (!text) continue
      const faceSource =
        resolved.faces?.[face] ??
        (face === 'boldItalic' ? resolved.faces?.bold : undefined) ??
        (face === 'italic' ? resolved.faces?.regular : undefined) ??
        resolved
      let font: Buffer
      try {
        font = await readFile(faceSource.path)
      } catch (cause) {
        warnings.push({
          code: 'unembedded-font',
          message: `Font "${typeface}" (${face}) could not be read from the catalog: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
        continue
      }
      const isVariable = faceSource.variable === true
      const weight = face === 'bold' || face === 'boldItalic' ? 700 : 400
      let subset: Uint8Array
      try {
        subset =
          faceSource.subset === false
            ? font
            : await subsetFont(font, text, {
                targetFormat: 'sfnt',
                ...(isVariable ? { variationAxes: { wght: weight } } : {}),
              })
      } catch (cause) {
        warnings.push({
          code: 'font-subset-failed',
          message: `Could not subset "${typeface}" (${face}): ${cause instanceof Error ? cause.message : String(cause)}`,
        })
        continue
      }
      let eot: Uint8Array
      try {
        eot = ttf2eot(subset)
      } catch (cause) {
        warnings.push({
          code: 'font-subset-failed',
          message: `Could not wrap "${typeface}" (${face}) as EOT: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
        continue
      }
      totalBytes += eot.byteLength
      if (totalBytes > maxTotalBytes) {
        warnings.push({
          code: 'font-subset-failed',
          message: `Embedded font size cap reached; "${typeface}" (${face}) was skipped.`,
        })
        continue
      }
      const part = `ppt/fonts/font${++fontIndex}.fntdata`
      zip.file(part, eot)
      faces.push({ typeface, face, part })
    }
  }

  if (faces.length === 0) return { buffer: pptx, embeddedFaces: 0, warnings }

  const startId = (await maxRelationshipId(zip)) + 1
  await addContentTypeDefault(zip)
  await addEmbeddedFontRels(zip, faces, startId)
  const mapped = faces.map((face, i) => ({ ...face, relId: startId + i }))
  await injectEmbeddedFontLst(zip, mapped)

  const buffer = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return { buffer, embeddedFaces: faces.length, warnings }
}
