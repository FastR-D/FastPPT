import { expect, it } from 'vitest'
import { extractObjects, extractPartTextStyles } from '../src/objects.js'
import { resolvePlaceholderChain } from '../src/inheritance.js'
import { resolveObjectText, resolveTextFont } from '../src/text-inheritance.js'
import { DRAWING_NS, PRESENTATION_NS } from '../src/relationships.js'
import type { ThemeDefinitionLike } from '../src/color-resolution.js'

const ns = `xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"`
const theme: ThemeDefinitionLike = {
  part: 'theme.xml',
  colors: [
    {
      role: 'accent1',
      kind: 'srgbClr',
      attributes: { val: '224466' },
      transforms: [],
    },
  ],
  majorFonts: {
    latin: { typeface: 'Major Latin' },
    eastAsian: { typeface: '' },
    complexScript: { typeface: '' },
    scripts: [
      { script: 'Hans', typeface: 'Major SC' },
      { script: 'Hant', typeface: 'Major TC' },
      { script: 'Jpan', typeface: 'Major JP' },
      { script: 'Arab', typeface: 'Major Arabic' },
    ],
  },
}
const presentation = extractPartTextStyles(
  `<p:presentation ${ns}><p:defaultTextStyle><a:defPPr algn="l"><a:defRPr sz="1200" b="1" lang="zh-CN"><a:latin typeface="Presentation"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:defPPr></p:defaultTextStyle></p:presentation>`,
  'presentation.xml',
)
const shape = (
  part: string,
  ph: string,
  list: string,
  paragraphs: string,
  style = '',
) =>
  extractObjects(
    `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/>${style}<p:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    part,
  )[0]!

it('inherits paragraph/run properties individually with the owning part and source fragment', () => {
  const master = extractPartTextStyles(
    `<p:sldMaster ${ns}><p:txStyles><p:titleStyle><a:lvl1pPr marL="100"><a:defRPr sz="3000"><a:latin typeface="+mj-lt"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`,
    'master.xml',
  )
  const parent = shape(
    'master.xml',
    '<p:ph type="title"/>',
    '<a:lvl1pPr><a:defRPr i="1"/></a:lvl1pPr>',
    '<a:p><a:r><a:rPr sz="9900"/><a:t>Template sample</a:t></a:r></a:p>',
  )
  const layout = shape(
    'layout.xml',
    '<p:ph type="ctrTitle" idx="7"/>',
    '<a:lvl1pPr algn="ctr"><a:defRPr b="0"/></a:lvl1pPr>',
    '<a:p/>',
  )
  const local = shape(
    'slide.xml',
    '<p:ph idx="7"/>',
    '',
    '<a:p><a:pPr><a:defRPr sz="2400"/></a:pPr><a:r><a:rPr i="0"/><a:t>A中文</a:t></a:r><a:r><a:rPr><a:latin typeface="Local"/></a:rPr><a:t>B</a:t></a:r><a:endParaRPr sz="800"/></a:p>',
  )
  const before = JSON.stringify([local, layout, parent])
  const { chain } = resolvePlaceholderChain(local, [layout], [parent], 'slide')
  const resolved = resolveObjectText({
    object: local,
    chain,
    presentation,
    master,
    theme,
  })
  const paragraph = resolved.paragraphs[0]!
  const run = paragraph.runs[0]!
  expect(resolved.category).toBe('titleStyle')
  expect(paragraph.attributes).toMatchObject({ marL: '100', algn: 'ctr' })
  expect(run.attributes).toMatchObject({
    sz: '2400',
    b: '0',
    i: '0',
    lang: 'zh-CN',
  })
  expect(run.color?.value).toBe('#224466')
  expect(run.segments.map((entry) => [entry.text, entry.font.family])).toEqual([
    ['A', 'Major Latin'],
    ['中文', 'Major SC'],
  ])
  expect(run.origins['attributes.sz']).toMatchObject({
    part: 'slide.xml',
    scope: 'paragraph/pPr/defRPr',
    paragraph: 0,
  })
  expect(run.origins['attributes.b']).toMatchObject({
    part: 'layout.xml',
    shapeId: '2',
  })
  expect(run.origins['fonts.latin.typeface']).toMatchObject({
    part: 'master.xml',
    scope: 'master/txStyles/titleStyle/defRPr',
  })
  expect(
    run.sources.some((source) => source.sourceXml.includes('sz="3000"')),
  ).toBe(true)
  expect(paragraph.runs[1]?.resolvedFonts.latin?.family).toBe('Local')
  expect(paragraph.end.attributes.sz).toBe('800')
  expect(JSON.stringify([local, layout, parent])).toBe(before)
})

it('keeps list levels distinct and replaces mutually exclusive bullet properties', () => {
  const master = extractPartTextStyles(
    `<p:sldMaster ${ns}><p:txStyles><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr marL="400"><a:buAutoNum type="arabicPeriod"/><a:buClr><a:srgbClr val="AA0000"/></a:buClr><a:defRPr sz="1800"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`,
    'master.xml',
  )
  const local = shape(
    'layout.xml',
    '<p:ph type="body"/>',
    '<a:lvl2pPr><a:buNone/><a:buClrTx/><a:defRPr b="0"/></a:lvl2pPr>',
    '<a:p><a:pPr lvl="1"/><a:r><a:t>item</a:t></a:r></a:p>',
  )
  const result = resolveObjectText({
    object: local,
    presentation,
    master,
    theme,
  })
  expect(result.levels[0]?.defaultRun.attributes.sz).toBe('2800')
  expect(result.levels[1]?.defaultRun.attributes).toMatchObject({
    sz: '1800',
    b: '0',
  })
  expect(result.levels[2]?.defaultRun.attributes.sz).toBe('1200')
  expect(result.paragraphs[0]?.children.bullet?.kind).toBe('buNone')
  expect(result.paragraphs[0]?.children.bulletColor?.kind).toBe('buClrTx')
  expect(result.paragraphs[0]?.origins['children.bullet']).toMatchObject({
    part: 'layout.xml',
    level: 2,
  })
})

it('resolves script-specific theme fonts using language and Unicode without a generic fallback', () => {
  const local = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:r><a:rPr lang="zh-TW"><a:latin typeface="+mj-lt"/></a:rPr><a:t>A漢かなع</a:t></a:r></a:p>',
  )
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(
    result.paragraphs[0]?.runs[0]?.segments.map(
      (segment) => segment.font.family,
    ),
  ).toEqual(['Major Latin', 'Major TC', 'Major JP', 'Major Arabic'])
  expect(resolveTextFont('+mj-ea', theme).issue).toContain(
    'language/script evidence',
  )
  expect(resolveTextFont('+mj-ea', theme, 'Hans').family).toBe('Major SC')
  expect(
    resolveTextFont(
      '+mj-ea',
      {
        ...theme,
        majorFonts: {
          ...theme.majorFonts,
          scripts: [
            { script: 'Hans', typeface: 'One' },
            { script: 'Hans', typeface: 'Two' },
          ],
        },
      },
      'Hans',
    ).issue,
  ).toContain('Ambiguous')
  const unknown = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:r><a:rPr lang="en-US"/><a:t>漢</a:t></a:r></a:p>',
  )
  const unresolved = resolveObjectText({ object: unknown, presentation, theme })
  expect(
    unresolved.paragraphs[0]?.runs[0]?.segments[0]?.font.family,
  ).toBeUndefined()
  expect(unresolved.issues.join(' ')).toContain('slide.xml#2/p0/r0: Theme font')
})

it.each([
  ['bullet', '<a:buChar char="•"/>', '<a:buNone/>'],
  ['bullet', '<a:buNone/>', '<a:buAutoNum type="arabicPeriod"/>'],
  ['bullet', '<a:buNone/>', '<a:buNone/>'],
  ['bulletFont', '<a:buFont typeface="Arial"/>', '<a:buFontTx/>'],
  ['bulletSize', '<a:buSzPts val="1200"/>', '<a:buSzTx/>'],
  [
    'bulletColor',
    '<a:buClr><a:srgbClr val="FF0000"/></a:buClr>',
    '<a:buClrTx/>',
  ],
  [
    'tabLst',
    '<a:tabLst><a:tab pos="914400" algn="l"/></a:tabLst>',
    '<a:tabLst/>',
  ],
  [
    'lnSpc',
    '<a:lnSpc><a:spcPts val="1200"/></a:lnSpc>',
    '<a:lnSpc><a:spcPct val="120000"/></a:lnSpc>',
  ],
])(
  'does not select a winner or fall back to a parent for ambiguous %s children',
  (key, first, second) => {
    const parent = shape(
      'master.xml',
      '<p:ph type="body"/>',
      `<a:lvl2pPr>${first}</a:lvl2pPr>`,
      '<a:p/>',
    )
    const local = shape(
      'layout.xml',
      '<p:ph type="body"/>',
      `<a:lvl2pPr>${first}${second}</a:lvl2pPr>`,
      '<a:p><a:pPr lvl="1"/><a:r><a:t>item</a:t></a:r></a:p>',
    )
    const sourceBefore = JSON.stringify([local, parent])
    const result = resolveObjectText({
      object: local,
      chain: [local, parent],
      presentation,
      theme,
    })
    for (const style of [result.levels[1]!, result.paragraphs[0]!]) {
      expect(style.children[key!]).toBeUndefined()
      expect(style.origins[`children.${key}`]).toBeUndefined()
      expect(
        style.sources.some(
          (source) =>
            source.part === 'layout.xml' &&
            source.sourceXml.includes(`${first}${second}`),
        ),
      ).toBe(true)
    }
    expect(
      result.issues.filter((issue) =>
        issue.startsWith(`Ambiguous text property ${key} `),
      ),
    ).toEqual([
      expect.stringContaining('at layout.xml#2/shape/lstStyle/level2'),
    ])
    expect(JSON.stringify([local, parent])).toBe(sourceBefore)
  },
)

it('locates conflicting run choices without losing text or accepting a foreign choice', () => {
  const local = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:r><a:rPr><a:uFillTx/><a:uFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:uFill></a:rPr><a:t>A</a:t></a:r><a:r><a:rPr><a:uFillTx/><x:uFill xmlns:x="urn:foreign"/></a:rPr><a:t>B</a:t></a:r></a:p>',
  )
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(result.paragraphs[0]!.runs.map((run) => run.text).join('')).toBe('AB')
  expect(result.paragraphs[0]!.runs[0]!.children.underlineFill).toBeUndefined()
  expect(result.paragraphs[0]!.runs[1]!.children.underlineFill?.kind).toBe(
    'uFillTx',
  )
  expect(
    result.paragraphs[0]!.runs[1]!.children['urn:foreign:uFill']?.kind,
  ).toBe('uFill')
  expect(result.issues).toEqual([
    expect.stringContaining(
      'Ambiguous text property underlineFill (uFillTx, uFill) at slide.xml#2/run/rPr/p0/r0',
    ),
  ])
})

it('preserves break and paragraph-end formatting without changing neighboring runs', () => {
  const local = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:r><a:t>before</a:t></a:r><a:br><a:rPr sz="600" b="0"/></a:br><a:r><a:t>after</a:t></a:r><a:endParaRPr sz="800"/></a:p><a:p><a:endParaRPr sz="4200"/></a:p>',
  )
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(result.paragraphs[0]?.runs.map((run) => run.attributes.sz)).toEqual([
    '1200',
    '600',
    '1200',
  ])
  expect(result.paragraphs[0]?.end.attributes.sz).toBe('800')
  expect(result.paragraphs[1]?.end.attributes.sz).toBe('4200')
  expect(result.paragraphs[1]?.runs).toEqual([])
})

it('resolves fontRef below local paragraph/run overrides and keeps unsupported children as evidence', () => {
  const local = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:pPr><a:defRPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr><a:latin typeface="Explicit"/><a:effectLst><a:glow rad="100"/></a:effectLst></a:rPr><a:t>A</a:t></a:r></a:p>',
    '<p:style><a:fontRef idx="major"><a:schemeClr val="accent1"/></a:fontRef></p:style>',
  )
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(result.paragraphs[0]?.runs[0]?.resolvedFonts.latin?.family).toBe(
    'Explicit',
  )
  expect(result.paragraphs[0]?.runs[0]?.color?.value).toBe('#112233')
  expect(
    result.paragraphs[0]?.runs[0]?.children.effectLst?.children[0]?.kind,
  ).toBe('glow')
  expect(result.levels[0]?.defaultRun.color?.value).toBe('#224466')
})

it('does not silently coerce invalid paragraph levels to level one', () => {
  const local = shape(
    'slide.xml',
    '',
    '',
    '<a:p><a:pPr lvl="99"/><a:r><a:t>A</a:t></a:r></a:p>',
  )
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(result.paragraphs[0]?.level).toBeUndefined()
  expect(result.paragraphs[0]?.runs[0]?.attributes.sz).toBeUndefined()
  expect(result.issues[0]).toContain('Invalid paragraph level 99')
})

it('resolves bullet theme fonts and transformed scheme colors without changing source evidence', () => {
  const local = shape('layout.xml', '<p:ph type="body"/>', '<a:lvl1pPr marL="500000" indent="-200000"><a:buClr><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:buClr><a:buSzPct val="80000"/><a:buFont typeface="+mj-lt"/><a:buChar char="•"/></a:lvl1pPr><a:lvl2pPr><a:buFontTx/><a:buClrTx/><a:buNone/></a:lvl2pPr>', '<a:p/>')
  const before = JSON.stringify(local)
  const result = resolveObjectText({ object: local, presentation, theme })
  expect(result.levels[0]!.resolvedBulletFont).toMatchObject({ reference: '+mj-lt', family: 'Major Latin', themePart: 'theme.xml' })
  expect(result.levels[0]!.resolvedBulletColor).toMatchObject({ value: '#112233', source: { sourcePart: 'layout.xml', role: 'accent1' } })
  expect(result.levels[0]!.origins['children.bulletFont']).toMatchObject({ part: 'layout.xml', level: 1 })
  expect(result.levels[1]!.resolvedBulletFont).toBeUndefined()
  expect(result.levels[1]!.resolvedBulletColor).toBeUndefined()
  expect(JSON.stringify(local)).toBe(before)
})
