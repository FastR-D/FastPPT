import { expect, it } from 'vitest'
import { extractObjects } from '../src/objects.js'
import { DRAWING_NS, PRESENTATION_NS } from '../src/relationships.js'

it('extracts shape identity, explicit placeholder values and local transforms with group coordinates', () => {
  const xml = `<p:sldLayout xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree>
    <p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="60000"><a:off x="100" y="200"/><a:ext cx="3000" cy="2000"/><a:chOff x="10" y="20"/><a:chExt cx="300" cy="200"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="4" name="Title &amp; subtitle"/><p:nvPr><p:ph type="title" idx="7"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm flipH="1"><a:off x="15" y="25"/><a:ext cx="150" cy="50"/></a:xfrm></p:spPr></p:sp>
    </p:grpSp>
    <p:sp><p:nvSpPr><p:cNvPr id="5" name="Inherited"/><p:nvPr><p:ph idx="8"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
  </p:spTree></p:cSld></p:sldLayout>`
  const result = extractObjects(xml, 'custom/layout.xml')
  expect(result).toHaveLength(3)
  expect(result[0]).toMatchObject({
    shapeId: '3',
    transform: {
      units: 'emu',
      attributes: { rot: '60000' },
      childOffset: { x: '10', y: '20' },
      childExtent: { cx: '300', cy: '200' },
    },
  })
  expect(result[1]).toMatchObject({
    part: 'custom/layout.xml',
    shapeId: '4',
    parentShapeId: '3',
    name: 'Title & subtitle',
    placeholder: {
      type: 'title',
      idx: '7',
      explicit: { type: 'title', idx: '7' },
    },
    transform: {
      attributes: { flipH: '1' },
      offset: { x: '15', y: '25' },
      extent: { cx: '150', cy: '50' },
    },
  })
  expect(result[1]!.sourceXml).toContain('<p:ph type="title" idx="7"/>')
  expect(result[2]!.transform).toBeUndefined()
  expect(result[2]!.placeholder).toEqual({
    type: 'obj',
    idx: '8',
    explicit: { idx: '8' },
  })
})

it('retains image relationship IDs, crop percentages and stretch parameters without resolving external content', () => {
  const xml = `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="9" name="Cropped image"/></p:nvPicPr><p:blipFill rotWithShape="0"><a:blip rel:embed="image1" rel:link="linked1"/><a:srcRect l="12500" r="-5000" t="25000"/><a:stretch><a:fillRect l="1000"/></a:stretch></p:blipFill><p:spPr/></p:pic></p:spTree></p:cSld></p:sld>`
  expect(extractObjects(xml, 'slides/a.xml')[0]?.image).toEqual({
    references: [
      { kind: 'embed', relationshipId: 'image1' },
      { kind: 'link', relationshipId: 'linked1' },
    ],
    crop: { l: '12500', r: '-5000', t: '25000' },
    stretch: { l: '1000' },
    attributes: { rotWithShape: '0' },
  })
})

it('extracts text paragraphs and runs with source formatting attributes', () => {
  const xml = `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="11" name="Title"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>Hello &amp; world</a:t></a:r><a:r><a:t>!</a:t></a:r></a:p><a:p><a:r><a:t>第二段</a:t></a:r></a:p></p:txBody><p:spPr/></p:sp></p:spTree></p:cSld></p:sld>`
  const object = extractObjects(xml, 'slides/page.xml')[0]
  expect(object?.text).toMatchObject({
    plainText: 'Hello & world!\n第二段',
    paragraphs: [
      {
        text: 'Hello & world!',
        runs: [
          { text: 'Hello & world', properties: { b: '1' } },
          { text: '!', properties: {} },
        ],
      },
      { text: '第二段' },
    ],
    provenance: 'extracted',
  })
})

it('keeps breaks and tabs in run order and extracts typed font and color evidence', () => {
  const xml = `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr><a:latin typeface="Arial"/><a:ea typeface="Noto Sans SC"/><a:solidFill><a:srgbClr val="224466"/></a:solidFill></a:rPr><a:t>Before</a:t></a:r><a:br/><a:r><a:t>After</a:t></a:r><a:tab/><a:fld><a:t>Field</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const object = extractObjects(xml, 'page.xml')[0]!
  expect(object.text?.plainText).toBe('Before\nAfter\tField')
  expect(object.text?.paragraphs[0]?.runs.map((run) => run.kind)).toEqual([
    'text',
    'break',
    'text',
    'tab',
    'field',
  ])
  expect(object.text?.paragraphs[0]?.runs[0]?.style).toMatchObject({
    latin: 'Arial',
    eastAsian: 'Noto Sans SC',
    fill: { color: { kind: 'srgbClr', attributes: { val: '224466' } } },
  })
})

it('extracts local fill, line and text-body evidence without resolving theme inheritance', () => {
  const xml = `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="12" name="Styled"/></p:nvSpPr><p:spPr><a:solidFill><a:schemeClr val="accent1"><a:tint val="25000"/></a:schemeClr></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle><a:lvl1pPr marL="120000"><a:defRPr sz="1800"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:t>Styled</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const object = extractObjects(xml, 'slides/styled.xml')[0]
  expect(object?.appearance).toMatchObject({
    fill: {
      kind: 'solid',
      color: {
        kind: 'schemeClr',
        attributes: { val: 'accent1' },
        transforms: [{ kind: 'tint' }],
      },
    },
    line: {
      attributes: { w: '12700' },
      fill: { kind: 'solid', color: { kind: 'srgbClr' } },
    },
    textBody: { attributes: { wrap: 'square', anchor: 'ctr' } },
    paragraphDefaults: [{ level: 1, attributes: { marL: '120000' } }],
  })
  expect(object?.appearance?.fill?.sourceXml).toContain('schemeClr')
})
