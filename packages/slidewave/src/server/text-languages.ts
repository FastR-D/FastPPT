import { validateTextCapitalization, type TextCapitalization } from '../primitives/text-capitalization.mjs'
import { validateTextKerning, type TextKerning } from '../primitives/text-kerning.mjs'
import { validateTextBaseline, type TextBaseline } from '../primitives/text-baseline.mjs'
import { validateTextLanguages, type TextLanguages } from '../primitives/text-language.mjs'
import { validateTextLetterSpacing, type TextLetterSpacing } from '../primitives/text-letter-spacing.mjs'

export type SerializedTextProperties = TextCapitalization & TextLanguages & TextLetterSpacing & TextBaseline & TextKerning

type Options = Record<string, unknown>
type Run = { text: string; options?: Options }

/** The writer fabricates languages, omits zero tracking and uses legacy baseline units.
 * Private-use identifiers recover authored properties after run/line splitting. */
export function prepareTextLanguages(text: string | Run[], options: Options, markers: Map<string, SerializedTextProperties>): { text: string | Run[]; options: Options } {
  const properties = (value: Options): SerializedTextProperties => ({ capitalization: value.capitalization as TextCapitalization['capitalization'], kerningThreshold: value.kerningThreshold as number | undefined, language: value.lang as string | undefined, alternativeLanguage: value.altLang as string | undefined, letterSpacing: value.charSpacing as number | undefined, baselinePercent: value.baselinePercent as number | undefined })
  const validate = (value: Options) => { validateTextLanguages(properties(value)); validateTextLetterSpacing(properties(value)); validateTextBaseline(properties(value)); validateTextKerning(properties(value)); validateTextCapitalization(properties(value)); if (value.baselinePercent !== undefined && ['baseline', 'superscript', 'subscript'].some(key => value[key] !== undefined)) throw new Error('baselinePercent cannot be combined with legacy baseline or script options.') }
  validate(options)
  if (Array.isArray(text)) for (const run of text) {
    validate(run.options ?? {})
    validate({ ...options, ...run.options, baselinePercent: run.options?.baselinePercent ?? options.baselinePercent })
  }
  const register = (value: Options): string => {
    const marker = `x-fastppt-${markers.size}`
    markers.set(marker, properties(value))
    return marker
  }
  // PptxGenJS also mutates nested options such as hyperlink._rId.
  text = structuredClone(text)
  options = structuredClone(options)
  const base = register(options)
  return {
    text: typeof text === 'string' ? text : text.map(run => ({
      ...run,
      options: { ...run.options, lang: register({ capitalization: run.options?.capitalization ?? options.capitalization, kerningThreshold: run.options?.kerningThreshold ?? options.kerningThreshold, lang: run.options?.lang ?? options.lang, altLang: run.options?.altLang ?? options.altLang, charSpacing: run.options?.charSpacing ?? options.charSpacing, baselinePercent: run.options?.baselinePercent ?? options.baselinePercent }) },
    })),
    options: { ...options, lang: base },
  }
}

/** Run after serialization, before adding the authoritative paragraph defaults. */
export function applyTextLanguages(xml: string, markers: ReadonlyMap<string, SerializedTextProperties>): string {
  return xml.replace(/<a:(?:rPr|defRPr|endParaRPr)\b[^>]*>/g, opening => {
    const marker = /\slang="([^"]*)"/.exec(opening)?.[1]
    const languages = marker === undefined ? undefined : markers.get(marker)
    if (!languages) return opening
    const attributes = `${languages.capitalization === undefined ? '' : ` cap="${languages.capitalization}"`}${languages.kerningThreshold === undefined ? '' : ` kern="${Math.round(languages.kerningThreshold * 100)}"`}${languages.language === undefined ? '' : ` lang="${languages.language}"`}${languages.alternativeLanguage === undefined ? '' : ` altLang="${languages.alternativeLanguage}"`}${languages.letterSpacing === undefined ? '' : ` spc="${Math.round(languages.letterSpacing * 100)}"`}${languages.baselinePercent === undefined ? '' : ` baseline="${Math.round(languages.baselinePercent * 1000)}"`}`
    if (languages.capitalization !== undefined) opening = opening.replace(/\scap="[^"]*"/g, '')
    if (languages.kerningThreshold !== undefined) opening = opening.replace(/\skern="[^"]*"/g, '')
    if (languages.baselinePercent !== undefined) opening = opening.replace(/\sbaseline="[^"]*"/g, '')
    if (languages.letterSpacing !== undefined) opening = opening.replace(/\sspc="[^"]*"/g, '')
    return opening.replace(/\s(?:lang|altLang)="[^"]*"/g, '').replace(/\/?>(?=$)/, end => attributes + end)
  })
}
