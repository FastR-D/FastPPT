import { z } from 'zod'
export { PptxRenderEvidenceV1Schema, PptxRenderFontInventoryV1Schema, type PptxRenderEvidenceV1, type PptxRenderFontInventoryV1 } from './pptx-render-evidence.js'
import { DecimalTabSourceConventionSchema, DecimalTabSchema } from './text-environment.js'
export { DecimalTabSchema, DecimalTabDeclarationV1Schema, type DecimalTab, DecimalTabSourceConventionSchema, TextRenderingEnvironmentSchema, DecimalTabEvidenceV1Schema, type DecimalTabEvidenceV1, type TextRenderingEnvironment } from './text-environment.js'

export const TriggerSchema = z.enum(['on-click','with-previous','after-previous'])
export const EffectSchema = z.object({ id:z.string().min(1), kind:z.enum(['entrance_fade','appear','fly','zoom','emphasis_pulse','teeter','exit_fade','path_line','path_arc','native']), target:z.string().min(1), trigger:TriggerSchema.default('on-click'), delayMs:z.number().nonnegative().default(0), durationMs:z.number().positive().default(400), params:z.record(z.string(),z.unknown()).default({}) })
export const AnimationDocumentV1Schema = z.object({ version:z.literal(1), slideId:z.string().min(1), transition:z.object({ kind:z.enum(['none','fade','push','wipe','morph']), durationMs:z.number().positive().default(500), direction:z.string().optional() }).default({kind:'none',durationMs:500}), groups:z.array(z.object({ id:z.string().min(1), label:z.string().optional(), effects:z.array(EffectSchema), static:z.boolean().default(false) })), source:z.enum(['user','agent','system']).default('user'), diagnostics:z.array(z.string()).default([]), digest:z.string().optional() })
export type AnimationDocumentV1=z.infer<typeof AnimationDocumentV1Schema>
export const SpeakerNotesDocumentV1Schema=z.object({ version:z.literal(1), slideId:z.string().min(1), spokenText:z.string().default(''), format:z.enum(['plain','ssml']).default('plain'), language:z.string().min(2).default('en-US'), estimatedSeconds:z.number().nonnegative().default(0), cues:z.array(z.object({ startSeconds:z.number().nonnegative(), endSeconds:z.number().nonnegative(), text:z.string() })).default([]), status:z.enum(['draft','accepted']).default('draft'), digest:z.string().optional() })
export type SpeakerNotesDocumentV1=z.infer<typeof SpeakerNotesDocumentV1Schema>
const NativeScriptFontsSchema = z.object({
  latin: z.string().trim().min(1).optional(),
  ea: z.string().trim().min(1).optional(),
  cs: z.string().trim().min(1).optional(),
}).strict().refine(fonts => Object.values(fonts).some(Boolean), 'At least one script font is required.')
const NativeTextLanguageSchema = z.string().max(255).regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|[xXiI](?:-[A-Za-z0-9]{1,8})+)?$/)
const NativeCharacterStyleSchema = z.object({
  capitalization: z.enum(['none', 'all', 'small']).optional(),
  kerningThreshold: z.number().min(0).max(4000).optional(), baselinePercent: z.number().min(-2147483.648).max(2147483.647).optional(),
  letterSpacing: z.number().min(-4000).max(4000).optional(),
  language: NativeTextLanguageSchema.optional(),
  alternativeLanguage: NativeTextLanguageSchema.optional(),
  fontFamily: z.string().trim().min(1).optional(),
  fontFamilies: NativeScriptFontsSchema.optional(),
  fontSize: z.number().min(1).max(4000).optional(),
  color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
})
const NativeTextSpacingSchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('points'), value: z.number().min(0).max(1584) }).strict(),
  z.object({ unit: z.literal('percent'), value: z.number().min(0).max(13200) }).strict(),
])
const NativeParagraphStyleSchema = z.object({
  decimalTab: DecimalTabSchema.nullable().optional(),
  defaultTabSize: z.number().int().min(0).max(51206400).optional(),
  tabStops: z.array(z.object({ position: z.number().int().min(-51206400).max(51206400), align: z.enum(['left', 'center', 'right', 'decimal']) }).strict()).max(1024).refine(stops => stops.every((stop, index) => index === 0 || stop.position > stops[index - 1]!.position), 'Tab positions must strictly increase.').optional(),
  bullet: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('auto-number'), scheme: z.enum(['arabicPeriod', 'arabicParenR', 'arabicParenBoth', 'arabicPlain', 'alphaLcPeriod', 'alphaUcPeriod', 'alphaLcParenR', 'alphaUcParenR', 'alphaLcParenBoth', 'alphaUcParenBoth', 'romanLcPeriod', 'romanUcPeriod', 'romanLcParenR', 'romanUcParenR', 'romanLcParenBoth', 'romanUcParenBoth']), startAt: z.number().int().min(1).max(32767).optional() }).strict(),
    z.object({ kind: z.literal('character'), character: z.string().refine(value => [...value].length === 1 && !/[\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(value), 'Expected one printable bullet character.') }).strict(),
  ]).optional(),
  bulletFont: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('font'), fontFamily: z.string().trim().min(1) }).strict()]).optional(),
  bulletSize: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('points'), value: z.number().min(1).max(4000) }).strict(), z.object({ kind: z.literal('percent'), value: z.number().min(25).max(400) }).strict()]).optional(),
  bulletColor: z.discriminatedUnion('kind', [z.object({ kind: z.literal('text') }).strict(), z.object({ kind: z.literal('color'), color: z.string().regex(/^[0-9a-fA-F]{6}$/) }).strict()]).optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  marginLeft: z.number().int().min(0).max(51206400).optional(),
  marginRight: z.number().int().min(0).max(51206400).optional(),
  indent: z.number().int().min(-51206400).max(51206400).optional(),
  lineSpacing: NativeTextSpacingSchema.optional(),
  spaceBefore: NativeTextSpacingSchema.optional(),
  spaceAfter: NativeTextSpacingSchema.optional(),
}).strict()
const NativeTextStyleSchema = NativeCharacterStyleSchema.extend({
  paragraph: NativeParagraphStyleSchema.optional(),
  levels: z.array(z.object({
    level: z.number().int().min(1).max(9),
    textStyle: NativeCharacterStyleSchema.strict().optional(),
    paragraph: NativeParagraphStyleSchema.optional(),
  }).strict()).min(1).max(9).refine(levels => new Set(levels.map(entry => entry.level)).size === levels.length, 'Text style levels must be unique.').optional(),
})
const NativeTextBodySchema = z.object({
  insets: z.object({
    left: z.number().int().min(0).max(51206400).optional(),
    right: z.number().int().min(0).max(51206400).optional(),
    top: z.number().int().min(0).max(51206400).optional(),
    bottom: z.number().int().min(0).max(51206400).optional(),
  }).strict().optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  wrap: z.boolean().optional(),
  autoFit: z.literal('none').optional(),
}).strict()
const NativeFixedObjectSchema = z.object({ capitalization: z.enum(['none', 'all', 'small']).optional(), kerningThreshold: z.number().min(0).max(4000).optional(), baselinePercent: z.number().min(-2147483.648).max(2147483.647).optional(), letterSpacing: z.number().min(-4000).max(4000).optional(), underline: z.boolean().optional(), strike: z.boolean().optional(), direction: z.enum(['ltr', 'rtl']).optional(), language: NativeTextLanguageSchema.optional(), alternativeLanguage: NativeTextLanguageSchema.optional(), anchor: z.string().trim().min(1).optional(), name: z.string().trim().min(1), x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive(), fill: z.string().regex(/^[0-9a-fA-F]{6}$/).optional(), text: z.string().optional(), fontFamily: z.string().trim().min(1).optional(), fontSize: z.number().min(1).max(4000).optional(), color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional() })
export const NativeMasterLayoutSchema = z.object({ masterObjects: z.object({ canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(), objects: z.array(NativeFixedObjectSchema).refine(items => new Set(items.map(item => item.name)).size === items.length, 'Master object names must be unique.') }).optional(), name: z.string().trim().min(1), masterId: z.string().trim().min(1).optional(), masterTheme: z.object({ fontFamily: z.string().trim().min(1).optional(), colors: z.array(z.string().regex(/^[0-9a-fA-F]{6}$/)).max(6).optional() }).optional(), canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(), fixedObjects: z.array(NativeFixedObjectSchema).refine(items => new Set(items.map(item => item.name)).size === items.length, 'Fixed object names must be unique.').optional(), placeholders: z.array(z.object({ index: z.number().int().nonnegative(), type: z.enum(['title', 'ctrTitle', 'subTitle', 'body', 'obj', 'pic']), x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive(), textStyle: NativeTextStyleSchema.optional(), textBody: NativeTextBodySchema.optional() }).refine(slot => slot.type !== 'pic' || slot.textBody === undefined, 'Picture placeholders cannot define a text body.')) }).refine(layout => new Set(layout.placeholders.map(slot => slot.index)).size === layout.placeholders.length, { message: 'Placeholder indices must be unique within a layout.', path: ['placeholders'] })
export const MasterSnapshotV1Schema=z.object({ version:z.literal(1), themeId:z.string().min(1), digest:z.string().min(1), fonts:z.array(z.string()), colors:z.record(z.string(),z.string()), masters:z.array(z.object({ id:z.string(), layouts:z.array(z.string()), placeholders:z.array(z.string()) })), layoutDefinitions:z.array(NativeMasterLayoutSchema).refine(layouts => new Set(layouts.map(layout => layout.name)).size === layouts.length, 'Layout names must be unique.').optional(), unsupported:z.array(z.string()).default([]) })
export type MasterSnapshotV1=z.infer<typeof MasterSnapshotV1Schema>
export const CreationDecisionV1Schema=z.object({ version:z.literal(1), stepId:z.string().min(1), question:z.string().min(1), options:z.array(z.string()), selected:z.string().optional(), rationale:z.string().optional(), actor:z.enum(['user','agent','system']), locked:z.boolean().default(false), timestamp:z.iso.datetime() })
export type CreationDecisionV1=z.infer<typeof CreationDecisionV1Schema>
export const ImportSourceGraphSchema = z.object({
  presentationPart: z.string().min(1),
  slides: z.array(z.object({
    index: z.number().int().positive(), part: z.string().min(1),
    layout: z.string().optional(), master: z.string().optional(), theme: z.string().optional(), notes: z.string().optional(),
    provenance: z.literal('extracted'),
  })),
  masters: z.array(z.object({
    part: z.string().min(1), layouts: z.array(z.string()), theme: z.string().optional(), provenance: z.literal('extracted'),
  })),
})
export const ImportLayoutEvidenceSchema = z.object({
  kind: z.string().min(1),
  value: z.string().optional(),
  reason: z.string().optional(),
  sourcePart: z.string().min(1).optional(),
  shapeId: z.string().min(1).optional(),
})
export const ImportLayoutCompletenessSchema = z.object({
  geometry: z.enum(['complete', 'partial', 'unresolved']),
  placeholders: z.enum(['complete', 'partial', 'unresolved']),
  fixedObjects: z.enum(['complete', 'partial', 'unresolved']),
  styles: z.enum(['complete', 'partial', 'unresolved']),
})
export const ImportLayoutCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  source: z.object({
    part: z.string().min(1),
    master: z.string().min(1).optional(),
    theme: z.string().min(1).optional(),
    provenance: z.literal('extracted'),
  }).optional(),
  semanticEvidence: z.array(ImportLayoutEvidenceSchema).default([]),
  completeness: ImportLayoutCompletenessSchema.optional(),
  generated: z.object({
    status: z.enum(['complete', 'partial', 'unsupported']),
    definition: NativeMasterLayoutSchema.optional(),
  }).optional(),
  issues: z.array(z.string()).default([]),
  provenance: z.enum(['derived', 'user-overridden']).default('derived'),
})
export type ImportLayoutCandidate = z.infer<typeof ImportLayoutCandidateSchema>
export const ImportAnalysisV1Schema=z.object({ version:z.literal(1), sourceHash:z.string().regex(/^[a-f0-9]{64}$/), sourceGraph:ImportSourceGraphSchema.optional(), decimalTabConvention:DecimalTabSourceConventionSchema.optional(), extractedFeatures:z.record(z.string(),z.unknown()), candidateLayouts:z.array(ImportLayoutCandidateSchema), unsupportedOoxml:z.array(z.string()).default([]), userOverrides:z.record(z.string(),z.unknown()).default({}) })
export type ImportAnalysisV1=z.infer<typeof ImportAnalysisV1Schema>
export const ExportCapabilityReportSchema=z.object({ version:z.literal(1), deckRevision:z.string().min(1), themeDigest:z.string().optional(), capabilities:z.record(z.string(),z.enum(['supported','partial','unsupported'])), warnings:z.array(z.string()).default([]), blocks:z.array(z.string()).default([]) })
export type ExportCapabilityReport=z.infer<typeof ExportCapabilityReportSchema>
export const NarrationProviderSchema=z.enum(['edge','elevenlabs','minimax','qwen','cosyvoice'])
export const NarrationManifestV1Schema=z.object({ version:z.literal(1), provider:NarrationProviderSchema, status:z.enum(['ready','unavailable','failed']), language:z.string().min(2), voiceId:z.string().optional(), audioFormat:z.enum(['mp3','m4a','wav']).optional(), subtitleFormat:z.literal('srt').optional(), reason:z.string().optional(), generatedAt:z.iso.datetime() })
export type NarrationManifestV1=z.infer<typeof NarrationManifestV1Schema>
export const NarrationProviderStatusV1Schema=z.object({ version:z.literal(1), providers:z.array(z.object({ provider:NarrationProviderSchema, configured:z.boolean(), timing:z.enum(['provider','none']), reason:z.string().optional() })) })
export type NarrationProviderStatusV1=z.infer<typeof NarrationProviderStatusV1Schema>
export function digest(value: unknown): string { const canonical=JSON.stringify(value,(_key: string,v: unknown)=>v && typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v); let h1=0x811c9dc5,h2=0x9e3779b9; for(const c of canonical){h1=Math.imul(h1^c.charCodeAt(0),16777619);h2=Math.imul(h2^c.charCodeAt(0),2246822519)} return [h1>>>0,h2>>>0,Math.imul(h1^h2,3266489917)>>>0,canonical.length>>>0].map(n=>n.toString(16).padStart(8,'0')).join('') }
export function normalizeAnimation(input: unknown): AnimationDocumentV1 { const parsed=AnimationDocumentV1Schema.parse(input); return {...parsed,digest:digest({...parsed,digest:undefined})} }
export function estimateNotesSeconds(text:string, wordsPerMinute=150): number {
  const trimmed = text.trim()
  if (!trimmed || wordsPerMinute <= 0) return 0
  // CJK scripts are normally written without spaces. Treating each character
  // as a word overestimates duration, while whitespace splitting counts a
  // whole paragraph as one word. At 150 WPM, 1.7 characters per word gives a
  // conversational rate of roughly 255 CJK characters per minute.
  const cjkCharacters = [...trimmed.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)].length
  const nonCjk = trimmed.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
  const latinWords = nonCjk.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  const equivalentWords = latinWords + cjkCharacters / 1.7
  return Math.round((equivalentWords / wordsPerMinute) * 60 * 10) / 10
}

export type NarrationCue = Pick<SpeakerNotesDocumentV1, 'cues'>['cues'][number]
function srtTimestamp(seconds:number): string {
  const millis=Math.max(0, Math.round(seconds*1000)); const hours=Math.floor(millis/3600000); const minutes=Math.floor((millis%3600000)/60000); const secs=Math.floor((millis%60000)/1000); const ms=millis%1000
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}
export function cuesToSrt(cues: readonly NarrationCue[]): string {
  return cues.filter(c=>c.text.trim() && c.endSeconds>c.startSeconds).map((cue,index)=>`${index+1}\n${srtTimestamp(cue.startSeconds)} --> ${srtTimestamp(cue.endSeconds)}\n${cue.text.trim()}`).join('\n\n') + (cues.some(c=>c.text.trim() && c.endSeconds>c.startSeconds)?'\n':'')
}
