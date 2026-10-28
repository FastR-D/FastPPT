import { NativeMasterLayoutSchema, MasterSnapshotV1Schema } from '../src/index.js'
import { describe, expect, it } from 'vitest'
import { AnimationDocumentV1Schema, NarrationManifestV1Schema, cuesToSrt, digest, estimateNotesSeconds, normalizeAnimation } from '../src/index.js'

describe('presentation IR', () => {
  it('normalizes animation documents and produces stable digests', () => {
    const value = normalizeAnimation({ version: 1, slideId: 's1', groups: [] })
    expect(AnimationDocumentV1Schema.parse(value)).toEqual(value)
    expect(value.digest).toBe(digest({ ...value, digest: undefined }))
  })
  it('estimates spoken duration', () => expect(estimateNotesSeconds('one two three', 60)).toBe(3))
  it('estimates CJK and mixed-language narration without whitespace', () => {
    expect(estimateNotesSeconds('你好世界你好世界你好', 150)).toBe(2.4)
    expect(estimateNotesSeconds('你好 FastPPT 演示文稿', 150)).toBeGreaterThan(1)
  })
  it('renders deterministic page-local SRT cues', () => {
    expect(cuesToSrt([
      { startSeconds: 0.125, endSeconds: 1.5, text: '  Hello  ' },
      { startSeconds: 2, endSeconds: 2, text: 'ignored' },
      { startSeconds: 2.001, endSeconds: 3.004, text: '' },
      { startSeconds: 3.25, endSeconds: 65.5, text: 'Second cue' },
    ])).toBe('1\n00:00:00,125 --> 00:00:01,500\nHello\n\n2\n00:00:03,250 --> 00:01:05,500\nSecond cue\n')
  })
  it('validates explicit unavailable provider state', () => {
    expect(NarrationManifestV1Schema.parse({ version: 1, provider: 'edge', status: 'unavailable', language: 'en-US', reason: 'provider not configured', generatedAt: new Date().toISOString() }).status).toBe('unavailable')
  })
})

it('validates layout identities while preserving legacy master snapshots', () => {
  const slot = { index: 0, type: 'title', x: 0, y: 0, width: 100, height: 200 }
  expect(NativeMasterLayoutSchema.parse({ name: ' Cover ', placeholders: [slot] }).name).toBe('Cover')
  expect(NativeMasterLayoutSchema.safeParse({ name: 'Cover', placeholders: [slot, slot] }).success).toBe(false)
  const legacy = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [] }
  expect(MasterSnapshotV1Schema.safeParse(legacy).success).toBe(true)
  expect(MasterSnapshotV1Schema.safeParse({ ...legacy, layoutDefinitions: [
    { name: 'Cover', placeholders: [slot] }, { name: ' Cover ', placeholders: [slot] },
  ] }).success).toBe(false)
})
it('preserves native placeholder text defaults and rejects invalid sizes and colors', () => {
  const layout = { name: 'Cover', placeholders: [{ index: 0, type: 'title', x: 0, y: 0, width: 100, height: 200, textStyle: { fontFamily: 'Inter', fontSize: 24, color: 'AABBCC', bold: false } }] }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const textStyle of [{ fontSize: -1 }, { fontSize: Infinity }, { color: '#fff' }, { fontFamily: '' }])
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...layout.placeholders[0], textStyle }] }).success).toBe(false)
})
it('preserves script-specific fonts through a master lock without accepting ambiguous keys', () => {
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 200, textStyle: { fontFamily: 'Fallback', fontFamilies: { latin: 'Inter', ea: 'Noto Serif SC', cs: 'Noto Sans Arabic' } } }
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [{ name: 'Mixed', placeholders: [slot] }] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const fontFamilies of [{}, { ea: '' }, { ea: ' ' }, { eastAsian: 'CJK' }])
    expect(NativeMasterLayoutSchema.safeParse({ name: 'Mixed', placeholders: [{ ...slot, textStyle: { fontFamilies } }] }).success).toBe(false)
})
it('validates per-level character and paragraph overrides without replacing explicit zero values', () => {
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 200 }
  const textStyle = { fontSize: 24, paragraph: { marginLeft: 0, spaceBefore: { unit: 'percent', value: 0 } }, levels: [{ level: 2, textStyle: { bold: false, fontSize: 16 }, paragraph: { indent: -120000, lineSpacing: { unit: 'points', value: 22 } } }] }
  expect(NativeMasterLayoutSchema.parse({ name: 'Body', placeholders: [{ ...slot, textStyle }] }).placeholders[0]?.textStyle).toEqual(textStyle)
  for (const invalid of [{ levels: [{ level: 0 }] }, { levels: [{ level: 10 }] }, { levels: [{ level: 2 }, { level: 2 }] }, { levels: [] }, { paragraph: { marginLeft: -1 } }, { paragraph: { align: 'ctr' } }, { paragraph: { lineSpacing: { unit: 'px', value: 24 } } }])
    expect(NativeMasterLayoutSchema.safeParse({ name: 'Body', placeholders: [{ ...slot, textStyle: invalid }] }).success).toBe(false)
})

it('retains independent text frame defaults through locks and rejects unsupported body formats', () => {
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 1000, height: 2000, textBody: { insets: { left: 0, top: 10 }, verticalAlign: 'middle', wrap: false, autoFit: 'none' } }
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [{ name: 'Body', placeholders: [slot] }] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const textBody of [{ insets: { left: -1 } }, { insets: { top: 51206401 } }, { insets: { lIns: 0 } }, { wrap: 'none' }, { verticalAlign: 'ctr' }, { autoFit: 'shrink' }, { unknown: true }])
    expect(NativeMasterLayoutSchema.safeParse({ name: 'Body', placeholders: [{ ...slot, textBody }] }).success).toBe(false)
  expect(NativeMasterLayoutSchema.safeParse({ name: 'Picture', placeholders: [{ ...slot, type: 'pic' }] }).success).toBe(false)
})

it('preserves all four bullet groups and rejects contradictory or out-of-range marker contracts', () => {
  const paragraph = { bullet: { kind: 'character', character: '\uF0A7' }, bulletFont: { kind: 'font', fontFamily: 'Wingdings' }, bulletSize: { kind: 'percent', value: 80 }, bulletColor: { kind: 'text' } }
  const layout = { name: 'Bullets', placeholders: [{ index: 0, type: 'body', x: 0, y: 0, width: 1000, height: 2000, textStyle: { paragraph, levels: [{ level: 2, paragraph: { bullet: { kind: 'none' }, bulletFont: { kind: 'text' } } }] } }] }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const fields of [{ bullet: { kind: 'none', character: '•' } }, { bullet: { kind: 'character', character: 'ab' } }, { bullet: { kind: 'character', character: '\t' } }, { bulletFont: { kind: 'text', fontFamily: 'Arial' } }, { bulletFont: { kind: 'font', fontFamily: '' } }, { bulletSize: { kind: 'percent', value: 401 } }, { bulletSize: { kind: 'points', value: 0 } }, { bulletSize: { kind: 'text', value: 12 } }, { bulletColor: { kind: 'color', color: '#112233' } }]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...layout.placeholders[0], textStyle: { paragraph: { ...paragraph, ...fields } } }] }).success).toBe(false)
  }
})

it('keeps automatic numbering defaults in the locked layout and rejects unsupported schemes', () => {
  const layout = { name: 'Numbered', placeholders: [{ index: 0, type: 'body', x: 0, y: 0, width: 1000, height: 2000, textStyle: { paragraph: { bullet: { kind: 'auto-number', scheme: 'alphaUcParenR', startAt: 27 } } } }] }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const bullet of [{ kind: 'auto-number', scheme: 'arabicPeriod', startAt: 0 }, { kind: 'auto-number', scheme: 'unsupported' }, { kind: 'auto-number', scheme: 'arabicPeriod', startAt: 1.5 }]) expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...layout.placeholders[0], textStyle: { paragraph: { bullet } } }] }).success).toBe(false)
})

it('keeps tab-list clearing and default interval overrides separate in locked native layouts', () => {
  const layout = { name: 'Tabs', placeholders: [{ index: 0, type: 'body', x: 0, y: 0, width: 1000, height: 1000, textStyle: { paragraph: { defaultTabSize: 914400, tabStops: [{ position: 0, align: 'left' }, { position: 2000000, align: 'right' }] }, levels: [{ level: 2, paragraph: { defaultTabSize: 0, tabStops: [] } }] } }] }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const paragraph of [{ defaultTabSize: -1 }, { tabStops: [{ position: 100, align: 'left' }, { position: 0, align: 'left' }] }, { tabStops: [{ position: 0, align: 'other' }] }]) expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...layout.placeholders[0], textStyle: { paragraph } }] }).success).toBe(false)
})


it('locks primary and alternate languages verbatim, including independent empty overrides', () => {
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 1000, height: 1000 }
  const textStyle = { language: 'zh-Hant', alternativeLanguage: 'x-Mixed', levels: [{ level: 2, textStyle: { language: '' } }] }
  const object = { name: 'Footer', x: 0, y: 0, width: 1000, height: 1000, text: 'Footer', language: '', alternativeLanguage: 'en-GB' }
  const layout = { name: 'Languages', placeholders: [{ ...slot, textStyle }], fixedObjects: [object], masterObjects: { objects: [object] } }
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [layout] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const value of ['en_US', ' zh-CN ', 'en-"', 'a'.repeat(256), null]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { language: value } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, alternativeLanguage: value }] }).success).toBe(false)
  }
})

it('retains independent decoration declarations in locked placeholders and fixed layers', () => {
  const object = { name: 'Footer', text: 'Both', x: 0, y: 0, width: 100, height: 100, underline: true, strike: false }
  const layout = { name: 'Decorated', placeholders: [{ index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { underline: true, levels: [{ level: 2, textStyle: { underline: false, strike: true } }] } }], fixedObjects: [object], masterObjects: { objects: [object] } }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const value of ['double', null, 1, 'false']) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...layout.placeholders[0], textStyle: { underline: value } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, strike: value }] }).success).toBe(false)
  }
})


it('locks signed letter spacing and zero overrides for placeholder and fixed text', () => {
  const object = { name: 'Footer', text: 'Body', x: 0, y: 0, width: 100, height: 100, letterSpacing: -0.25 }
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { letterSpacing: 1.25, levels: [{ level: 2, textStyle: { letterSpacing: 0 } }] } }
  const layout = { name: 'Spacing', placeholders: [slot], fixedObjects: [object], masterObjects: { objects: [object] } }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [layout] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const letterSpacing of [null, '0', Infinity, 4000.01, -4000.01]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { letterSpacing } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, letterSpacing }] }).success).toBe(false)
  }
})

it('locks signed baseline percentages and zero overrides for placeholder and fixed text', () => {
  const object = { name: 'Footer', text: 'Body', x: 0, y: 0, width: 100, height: 100, baselinePercent: -0.25 }
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { baselinePercent: 1.25, levels: [{ level: 2, textStyle: { baselinePercent: 0 } }] } }
  const layout = { name: 'Spacing', placeholders: [slot], fixedObjects: [object], masterObjects: { objects: [object] } }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [layout] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const baselinePercent of [null, '0', Infinity, 2147483.648, -2147483.649]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { baselinePercent } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, baselinePercent }] }).success).toBe(false)
  }
})


it('locks kerning thresholds and zero overrides for placeholder and fixed text', () => {
  const object = { name: 'Footer', text: 'Body', x: 0, y: 0, width: 100, height: 100, kerningThreshold: 0.25 }
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { kerningThreshold: 1.25, levels: [{ level: 2, textStyle: { kerningThreshold: 0 } }] } }
  const layout = { name: 'Spacing', placeholders: [slot], fixedObjects: [object], masterObjects: { objects: [object] } }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  const snapshot = { version: 1, themeId: 'theme', digest: 'digest', fonts: [], colors: {}, masters: [], layoutDefinitions: [layout] }
  expect(MasterSnapshotV1Schema.parse(snapshot)).toMatchObject(snapshot)
  for (const kerningThreshold of [null, '0', Infinity, 4000.01, -0.01]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { kerningThreshold } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, kerningThreshold }] }).success).toBe(false)
  }
})

it('locks capitalization separately from original editable strings and supports explicit cancellation', () => {
  const object = { name: 'Footer', text: 'Straße', x: 0, y: 0, width: 100, height: 100, capitalization: 'small' }
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { capitalization: 'all', levels: [{ level: 2, textStyle: { capitalization: 'none' } }] } }
  const layout = { name: 'Caps', placeholders: [slot], fixedObjects: [object] }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const capitalization of [null, 'uppercase', '', false, 0]) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { capitalization } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, capitalization }] }).success).toBe(false)
  }
})

it('locks explicit LTR cancellation independently of language, alignment and body column flow', () => {
  const object = { name: 'Footer', text: 'שלום 123 ABC', x: 0, y: 0, width: 100, height: 100, direction: 'rtl', language: 'en-US' }
  const slot = { index: 0, type: 'body', x: 0, y: 0, width: 100, height: 100, textStyle: { language: 'ar-SA', paragraph: { direction: 'rtl', align: 'left' }, levels: [{ level: 2, paragraph: { direction: 'ltr' } }] } }
  const layout = { name: 'RTL', placeholders: [slot], fixedObjects: [object], masterObjects: { objects: [object] } }
  expect(NativeMasterLayoutSchema.parse(layout)).toEqual(layout)
  for (const direction of [null, '', true, 0, 'auto', 'vertical']) {
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, placeholders: [{ ...slot, textStyle: { paragraph: { direction } } }] }).success).toBe(false)
    expect(NativeMasterLayoutSchema.safeParse({ ...layout, fixedObjects: [{ ...object, direction }] }).success).toBe(false)
  }
})
