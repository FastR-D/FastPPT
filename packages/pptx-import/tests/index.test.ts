import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { analyzePptx } from '../src/index.js'
import {
  DRAWING_NS,
  PRESENTATION_NS,
  DOCUMENT_REL_NS,
  PACKAGE_REL_NS,
  tags,
  relationships,
} from '../src/relationships.js'

function part(zip: JSZip, name: string, xml: string): void {
  zip.file(
    name,
    xml
      .replace(
        /Type="(slide|slideLayout|slideMaster|theme)"/g,
        `Type="${DOCUMENT_REL_NS}/$1"`,
      )
      .replace(
        /<([\w:]+)/,
        `<$1 xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}" xmlns:r="${DOCUMENT_REL_NS}" xmlns="${PACKAGE_REL_NS}"`,
      ),
  )
}

describe('pptx import analysis', () => {
  it('extracts deterministic package features', async () => {
    const zip = new JSZip()
    part(
      zip,
      'ppt/presentation.xml',
      '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>',
    )
    part(
      zip,
      'ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="r1" Type="slide" Target="slides/slide1.xml"/></Relationships>',
    )
    part(
      zip,
      'ppt/slides/_rels/slide1.xml.rels',
      '<Relationships><Relationship Id="l1" Type="slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    )
    part(
      zip,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      '<Relationships><Relationship Id="m1" Type="slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    )
    part(
      zip,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      '<Relationships><Relationship Id="t1" Type="theme" Target="../theme/theme1.xml"/></Relationships>',
    )
    part(
      zip,
      'ppt/theme/theme1.xml',
      '<a:theme><a:srgbClr val="FF0000"/><a:latin typeface="Inter"/></a:theme>',
    )
    part(zip, 'ppt/slideMasters/slideMaster1.xml', '')
    part(
      zip,
      'ppt/slideLayouts/slideLayout1.xml',
      '<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sldLayout>',
    )
    part(zip, 'ppt/slides/slide1.xml', '<p:timing/>')
    const result = await analyzePptx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    expect(result.extractedFeatures).toMatchObject({
      colors: ['FF0000'],
      masters: 1,
      slides: 1,
      animations: true,
      layouts: [{ placeholders: [{ type: 'title', name: 'Title 1' }] }],
    })
    expect(result.candidateLayouts).toHaveLength(1)
    expect(result.candidateLayouts[0]).toMatchObject({
      source: {
        part: 'ppt/slideLayouts/slideLayout1.xml',
        master: 'ppt/slideMasters/slideMaster1.xml',
        theme: 'ppt/theme/theme1.xml',
        provenance: 'extracted',
      },
      semanticEvidence: expect.arrayContaining([
        expect.objectContaining({ kind: 'placeholder', value: 'title' }),
        expect.objectContaining({ kind: 'master-link' }),
      ]),
      completeness: {
        geometry: 'unresolved',
        placeholders: 'unresolved',
        fixedObjects: 'complete',
        styles: 'partial',
      },
      provenance: 'derived',
    })
  })
})

it('uses presentation order and follows each page to its own master and theme', async () => {
  const zip = new JSZip()
  const order = [12, 2, 10, 1, 11, 3, 4, 5, 6, 7, 8, 9]
  part(
    zip,
    'ppt/presentation.xml',
    `<p:presentation><p:sldIdLst>${order.map((id) => `<p:sldId id="${256 + id}" r:id="r${id}"/>`).join('')}</p:sldIdLst></p:presentation>`,
  )
  part(
    zip,
    'ppt/_rels/presentation.xml.rels',
    `<Relationships>${order.map((id) => `<Relationship Id="r${id}" Type="slide" Target="slides/slide${id}.xml"/>`).join('')}</Relationships>`,
  )
  for (const id of order) {
    part(zip, `ppt/slides/slide${id}.xml`, '<p:sld/>')
    part(
      zip,
      `ppt/slides/_rels/slide${id}.xml.rels`,
      `<Relationships><Relationship Id="layout" Type="slideLayout" Target="../slideLayouts/slideLayout${(id % 2) + 1}.xml"/></Relationships>`,
    )
  }
  for (const id of [1, 2]) {
    part(zip, `ppt/slideLayouts/slideLayout${id}.xml`, '<p:sldLayout/>')
    part(
      zip,
      `ppt/slideLayouts/_rels/slideLayout${id}.xml.rels`,
      `<Relationships><Relationship Id="master" Type="slideMaster" Target="../slideMasters/slideMaster${id}.xml"/></Relationships>`,
    )
    part(zip, `ppt/slideMasters/slideMaster${id}.xml`, '<p:sldMaster/>')
    part(
      zip,
      `ppt/slideMasters/_rels/slideMaster${id}.xml.rels`,
      `<Relationships><Relationship Id="theme" Type="theme" Target="../theme/theme${id}.xml"/></Relationships>`,
    )
    part(
      zip,
      `ppt/theme/theme${id}.xml`,
      `<a:theme><a:latin typeface="Font${id}"/></a:theme>`,
    )
  }
  const result = await analyzePptx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  expect(result.extractedFeatures.slideRelationships).toEqual(
    order.map((id, index) => ({
      index: index + 1,
      part: `ppt/slides/slide${id}.xml`,
      layout: `ppt/slideLayouts/slideLayout${(id % 2) + 1}.xml`,
      master: `ppt/slideMasters/slideMaster${(id % 2) + 1}.xml`,
      theme: `ppt/theme/theme${(id % 2) + 1}.xml`,
      provenance: 'extracted',
    })),
  )
  expect(result.extractedFeatures.fonts).toEqual(['Font1', 'Font2'])
})

it('resolves namespaces independently of prefixes and ignores foreign lookalike elements', () => {
  const xml = `<q:presentation xmlns:q="${PRESENTATION_NS}" xmlns:rel="${DOCUMENT_REL_NS}" xmlns:foreign="urn:foreign"><q:sldId id="1" rel:id="actual"/><foreign:sldId id="2" rel:id="ignored"/></q:presentation>`
  expect(tags(xml, 'sldId')).toEqual([
    expect.objectContaining({ 'r:id': 'actual' }),
  ])
  expect(
    tags(
      `<d:theme xmlns:d="${DRAWING_NS}"><d:latin typeface="A&#x26;B"/></d:theme>`,
      'latin',
      DRAWING_NS,
    ),
  ).toEqual([{ typeface: 'A&B' }])
  expect(
    relationships(
      `<z:Relationships xmlns:z="${PACKAGE_REL_NS}"><z:Relationship Id="r1" Type="slide" Target="slides/a.xml"/></z:Relationships>`,
      'ppt/presentation.xml',
    )[0]?.target,
  ).toBe('ppt/slides/a.xml')
})

it.each([
  '<p:root/>',
  '<root><child></root>',
  '<root/><other/>',
  '<root garbage/>',
  '<root bad:id="1"/>',
  '<root/>trailing',
  '<!DOCTYPE root><root/>',
])('rejects malformed or unsupported XML: %s', (xml) => {
  expect(() => tags(xml, 'sldId')).toThrow()
})

it('recognizes Strict namespaces while counting only reachable notes', async () => {
  const zip = new JSZip()
  const strictP = 'http://purl.oclc.org/ooxml/presentationml/main'
  const strictR = 'http://purl.oclc.org/ooxml/officeDocument/relationships'
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${strictP}" xmlns:r="${strictR}"><p:sldIdLst><p:sldId id="256" r:id="s1"/></p:sldIdLst></p:presentation>`,
  )
  part(
    zip,
    'ppt/_rels/presentation.xml.rels',
    `<Relationships><Relationship Id="s1" Type="${strictR}/slide" Target="slides/slide12.xml"/></Relationships>`,
  )
  zip.file(
    'ppt/slides/slide12.xml',
    `<p:sld xmlns:p="${strictP}"><p:timing/></p:sld>`,
  )
  part(
    zip,
    'ppt/slides/_rels/slide12.xml.rels',
    `<Relationships><Relationship Id="note" Type="${strictR}/notesSlide" Target="../notesSlides/named-note.xml"/></Relationships>`,
  )
  zip.file(
    'ppt/notesSlides/named-note.xml',
    `<p:notes xmlns:p="${strictP}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Presenter note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  )
  zip.file('ppt/notesSlides/notesSlide99.xml', '<unused/>')
  const result = await analyzePptx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  expect(result.extractedFeatures).toMatchObject({
    slides: 1,
    animations: true,
    notes: 1,
    noteParts: ['ppt/notesSlides/named-note.xml'],
    noteTexts: [
      { part: 'ppt/notesSlides/named-note.xml', text: 'Presenter note' },
    ],
    slideRelationships: [{ notes: 'ppt/notesSlides/named-note.xml' }],
  })
  expect(
    tags(
      '<a:theme xmlns:a="http://purl.oclc.org/ooxml/drawingml/main"><a:latin typeface="Strict Font"/></a:theme>',
      'latin',
      DRAWING_NS,
    ),
  ).toEqual([{ typeface: 'Strict Font' }])
})

it('does not identify foreign relationships by a matching final segment', () => {
  const xml = `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="r1" Type="urn:foreign/slide" Target="slides/a.xml"/></Relationships>`
  expect(relationships(xml, 'ppt/presentation.xml')[0]?.type).toBe(
    'urn:foreign/slide',
  )
})

it('locates nonstandard package parts and includes registered unused layouts without orphan files', async () => {
  const zip = new JSZip()
  part(
    zip,
    '_rels/.rels',
    `<Relationships><Relationship Id="root" Type="${DOCUMENT_REL_NS}/officeDocument" Target="custom/deck.xml"/></Relationships>`,
  )
  part(
    zip,
    'custom/deck.xml',
    '<p:presentation><p:sldMasterIdLst><p:sldMasterId id="1" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="page"/></p:sldIdLst></p:presentation>',
  )
  part(
    zip,
    'custom/_rels/deck.xml.rels',
    '<Relationships><Relationship Id="page" Type="slide" Target="page.xml"/><Relationship Id="master" Type="slideMaster" Target="brand.xml"/></Relationships>',
  )
  part(zip, 'custom/page.xml', '<p:sld/>')
  part(
    zip,
    'custom/_rels/page.xml.rels',
    '<Relationships><Relationship Id="layout" Type="slideLayout" Target="used.xml"/></Relationships>',
  )
  part(
    zip,
    'custom/brand.xml',
    '<p:sldMaster><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="used"/><p:sldLayoutId id="2" r:id="unused"/></p:sldLayoutIdLst></p:sldMaster>',
  )
  part(
    zip,
    'custom/_rels/brand.xml.rels',
    '<Relationships><Relationship Id="used" Type="slideLayout" Target="used.xml"/><Relationship Id="unused" Type="slideLayout" Target="unused.xml"/></Relationships>',
  )
  for (const name of ['used', 'unused']) {
    part(zip, `custom/${name}.xml`, '<p:sldLayout/>')
    part(
      zip,
      `custom/_rels/${name}.xml.rels`,
      '<Relationships><Relationship Id="master" Type="slideMaster" Target="brand.xml"/></Relationships>',
    )
  }
  part(zip, 'ppt/slideLayouts/slideLayout999.xml', '<p:sldLayout/>')
  const result = await analyzePptx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  expect(result.extractedFeatures).toMatchObject({
    presentationPart: 'custom/deck.xml',
    slides: 1,
    masters: 1,
    masterParts: ['custom/brand.xml'],
  })
  expect(result.candidateLayouts.map((layout) => layout.id)).toEqual([
    'custom/used.xml',
    'custom/unused.xml',
  ])
  expect(result.sourceGraph).toMatchObject({
    presentationPart: 'custom/deck.xml',
    slides: [{ index: 1, part: 'custom/page.xml', layout: 'custom/used.xml' }],
    masters: [
      {
        part: 'custom/brand.xml',
        layouts: ['custom/used.xml', 'custom/unused.xml'],
      },
    ],
  })
})

it('distinguishes embedded, missing and unverified external picture resources', async () => {
  const zip = new JSZip()
  part(
    zip,
    'ppt/presentation.xml',
    '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="page"/></p:sldIdLst></p:presentation>',
  )
  part(
    zip,
    'ppt/_rels/presentation.xml.rels',
    '<Relationships><Relationship Id="page" Type="slide" Target="slides/page.xml"/></Relationships>',
  )
  part(
    zip,
    'ppt/slides/page.xml',
    '<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="4"/></p:nvPicPr><p:blipFill><a:blip r:embed="inside" r:link="outside"/><a:srcRect l="10000"/></p:blipFill></p:pic><p:pic><p:nvPicPr><p:cNvPr id="5"/></p:nvPicPr><p:blipFill><a:blip r:embed="missing"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>',
  )
  part(
    zip,
    'ppt/slides/_rels/page.xml.rels',
    `<Relationships><Relationship Id="inside" Type="${DOCUMENT_REL_NS}/image" Target="../media/photo.png"/><Relationship Id="outside" Type="${DOCUMENT_REL_NS}/image" Target="https://example.invalid/photo.png" TargetMode="External"/></Relationships>`,
  )
  zip.file('ppt/media/photo.png', new Uint8Array([1, 2, 3]))
  const result = await analyzePptx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  expect(result.extractedFeatures.imageResources).toEqual([
    expect.objectContaining({
      shapeId: '4',
      status: 'embedded',
      available: true,
      target: 'ppt/media/photo.png',
      crop: { l: '10000' },
    }),
    expect.objectContaining({
      shapeId: '4',
      status: 'external-unverified',
      available: false,
    }),
    expect.objectContaining({
      shapeId: '5',
      status: 'missing',
      available: false,
    }),
  ])
})

it.each([
  ['6858000', '9144000', true],
  ['0', '9144000', false],
  ['not-a-number', '9144000', false],
])('validates namespace-aware source canvas %s × %s', async (cx, cy, valid) => {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    `<q:presentation xmlns:q="${PRESENTATION_NS}"><q:sldSz cy="${cy}" cx="${cx}"/></q:presentation>`,
  )
  const result = analyzePptx(await zip.generateAsync({ type: 'uint8array' }))
  if (valid)
    expect((await result).extractedFeatures.canvas).toEqual({
      widthEmu: 6858000,
      heightEmu: 9144000,
      part: 'ppt/presentation.xml',
      provenance: 'extracted',
    })
  else await expect(result).rejects.toThrow('Invalid presentation canvas')
})
