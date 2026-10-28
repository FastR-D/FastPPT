import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { parseXml } from '@fastppt/slidewave/xml'
import {
  NativeMasterLayoutSchema,
  ImportLayoutCandidateSchema,
} from '@fastppt/presentation-ir'
import { analyzePptx } from '../src/index.js'
import type { resolveObjectText } from '../src/text-inheritance.js'

type TextEvidence = Array<{
  part: string
  objects: ReturnType<typeof resolveObjectText>[]
}>

function parseCandidates(json: string) {
  return ImportLayoutCandidateSchema.array().parse(
    (JSON.parse(json) as { candidates: unknown }).candidates,
  )
}

function replaceTitleBody(
  xml: string,
  body: string,
  addMissing = false,
): string {
  const tree = parseXml(xml)
    .children.find((node) => node.local === 'cSld')
    ?.children.find((node) => node.local === 'spTree')
  const title = tree?.children.find(
    (node) =>
      node.local === 'sp' &&
      node.children.some(
        (child) =>
          child.children.some(
            (property) =>
              property.local === 'ph' && property.attributes.type === 'title',
          ) ||
          child.children.some((property) =>
            property.children.some(
              (value) =>
                value.local === 'ph' && value.attributes.type === 'title',
            ),
          ),
      ),
  )
  const properties = title?.children
    .find((node) => node.local === 'txBody')
    ?.children.find((node) => node.local === 'bodyPr')
  if (properties)
    return xml.slice(0, properties.start) + body + xml.slice(properties.end)
  if (!addMissing) return xml
  if (!tree) throw new Error('Fixture source has no shape tree')
  const placeholder = `<p:sp><p:nvSpPr><p:cNvPr id="900" name="Source title defaults"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="42"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${body}<a:lstStyle/><a:p/></p:txBody></p:sp>`
  return (
    xml.slice(0, tree.closeStart) + placeholder + xml.slice(tree.closeStart)
  )
}

it('feeds nonstandard source part selection into the actual theme generator', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-generation-'))
  try {
    const zip = new JSZip()
    zip.file(
      'custom/deck.xml',
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    )
    zip.file(
      'custom/brand.xml',
      '<a:theme><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
    )
    zip.file('custom/page12.xml', '<p:sld/>')
    zip.file('custom/layout.xml', '<p:sldLayout/>')
    zip.file('custom/master.xml', '<p:sldMaster/>')
    const input = join(directory, 'source.pptx')
    const analysis = join(directory, 'analysis.json')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(input, bytes)
    await writeFile(
      analysis,
      JSON.stringify({
        sourceHash: createHash('sha256').update(bytes).digest('hex'),
        extractedFeatures: {
          canvas: { widthEmu: 6858000, heightEmu: 9144000 },
          themeDefinitions: [
            {
              part: 'custom/brand.xml',
              colors: [
                {
                  role: 'accent1',
                  kind: 'sysClr',
                  attributes: { lastClr: 'CC5533' },
                  transforms: [],
                },
                {
                  role: 'accent2',
                  kind: 'hslClr',
                  attributes: { hue: '0' },
                  transforms: [],
                },
              ],
              majorFonts: { latin: { typeface: 'Source Serif' } },
              minorFonts: {
                latin: { typeface: 'Source Sans' },
                eastAsian: { typeface: '' },
                scripts: [{ script: 'Hans', typeface: 'Source CJK' }],
              },
            },
          ],
          layouts: [
            {
              id: 'custom/layout.xml',
              placeholders: [{ type: 'title', idx: '0', shapeId: '2' }],
              objects: [],
            },
          ],
          resolvedGeometry: [
            {
              part: 'custom/layout.xml',
              placeholders: [
                {
                  shapeId: '2',
                  geometry: { x: '100', y: '200', cx: '3000', cy: '400' },
                  complete: true,
                },
              ],
            },
          ],
          masterRelationships: [
            { part: 'custom/master.xml', layouts: ['custom/layout.xml'] },
          ],
          sourceObjects: [
            {
              part: 'custom/master.xml',
              objects: [
                {
                  part: 'custom/master.xml',
                  kind: 'sp',
                  shapeId: '9',
                  name: 'Brand',
                  transform: {
                    units: 'emu',
                    attributes: {},
                    offset: { x: '1000', y: '500' },
                    extent: { cx: '2000', cy: '500' },
                  },
                  appearance: {
                    fill: {
                      kind: 'solid',
                      color: {
                        kind: 'srgbClr',
                        attributes: { val: '112233' },
                        transforms: [],
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
        sourceGraph: {
          presentationPart: 'custom/deck.xml',
          slides: [
            {
              part: 'custom/page12.xml',
              layout: 'custom/layout.xml',
              master: 'custom/master.xml',
              theme: 'custom/brand.xml',
            },
          ],
          masters: [
            {
              part: 'custom/master.xml',
              theme: 'custom/brand.xml',
              layouts: ['custom/layout.xml'],
            },
          ],
        },
      }),
    )
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      input,
      '--name',
      'source-test',
      '--out',
      directory,
      '--analysis',
      analysis,
    ])
    const selection = JSON.parse(
      await readFile(
        join(directory, 'slidev-theme-source-test', 'SOURCE_SELECTION.json'),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(selection).toMatchObject({
      presentation: 'custom/deck.xml',
      primaryTheme: 'custom/brand.xml',
      firstSlide: 'custom/page12.xml',
      firstLayout: 'custom/layout.xml',
      firstMaster: 'custom/master.xml',
    })
    const machineRules = JSON.parse(
      await readFile(
        join(directory, 'slidev-theme-source-test', 'agent/theme-rules.json'),
        'utf8',
      ),
    ) as { rules: Array<{ id: string; provenance: string; severity: string }> }
    expect(machineRules.rules).toMatchObject([
      {
        id: 'proposal.registered-layouts',
        provenance: 'generated',
        severity: 'warning',
      },
      {
        id: 'proposal.first-cover',
        provenance: 'generated',
        severity: 'warning',
      },
      { id: 'proposal.last-end', provenance: 'generated', severity: 'warning' },
    ])
    expect(
      await readFile(
        join(directory, 'slidev-theme-source-test', 'EXTRACTION_ANALYSIS.md'),
        'utf8',
      ),
    ).toContain('CC5533')
    expect(
      await readFile(
        join(directory, 'slidev-theme-source-test', 'EXTRACTION_ANALYSIS.md'),
        'utf8',
      ),
    ).toContain('Unresolved source color accent2')
    expect(
      await readFile(
        join(directory, 'slidev-theme-source-test', 'EXTRACTION_ANALYSIS.md'),
        'utf8',
      ),
    ).toContain('720×960')
    const nativeLayouts = JSON.parse(
      await readFile(
        join(
          directory,
          'slidev-theme-source-test',
          'agent',
          'native-layouts.json',
        ),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>
    expect(nativeLayouts).toHaveLength(1)
    expect(nativeLayouts[0]).toMatchObject({
      name: 'source-layout-1',
      placeholders: [
        { index: 0, type: 'title', x: 100, y: 200, width: 3000, height: 400 },
      ],
      masterObjects: {
        objects: [
          {
            name: 'Brand',
            x: 1000,
            y: 500,
            width: 2000,
            height: 500,
            fill: '112233',
          },
        ],
      },
    })
    expect(
      await readFile(
        join(
          directory,
          'slidev-theme-source-test',
          'layouts',
          'source-layout-1.vue',
        ),
        'utf8',
      ),
    ).toContain('data-fastppt-layout-object="Brand"')
    expect(
      JSON.parse(
        await readFile(
          join(
            directory,
            'slidev-theme-source-test',
            'agent',
            'layout-candidates.json',
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({
      candidates: [
        {
          id: 'custom/layout.xml',
          name: 'source-layout-1',
          generated: { status: 'complete' },
        },
      ],
    })
    await writeFile(analysis, JSON.stringify({ sourceHash: '0'.repeat(64) }))
    await expect(
      promisify(execFile)(process.execPath, [
        resolve('../../scripts/extract-theme.mjs'),
        input,
        '--name',
        'stale',
        '--out',
        directory,
        '--analysis',
        analysis,
      ]),
    ).rejects.toThrow('Source analysis hash does not match')
    expect(selection.tokenEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'font',
          role: 'minorEa',
          value: 'Source CJK',
        }),
        expect.objectContaining({
          kind: 'color',
          role: 'accent1',
          value: '#CC5533',
        }),
      ]),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('round trips actual analysis through theme generation and native master/layout export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-roundtrip-'))
  try {
    const snapshot = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      warnings: [],
      slides: [1, 2, 3].map((index) => ({
        version: 1,
        id: `slide-${index}`,
        width: 960,
        height: 540,
        warnings: [],
        elements: [
          {
            id: 'title',
            kind: 'text',
            text: `标题 ${index}`,
            box: { x: 50, y: 50, width: 500, height: 60 },
            order: 1,
            zIndex: 1,
            opacity: 1,
            source: { tag: 'h1', path: 'h1', anchor: 'title' },
            style: {
              fontFamily: 'Arial',
              fontSizePx: 32,
              fontWeight: 400,
              fontStyle: 'normal',
              lineHeightPx: 38.4,
              letterSpacingPx: 0,
              color: { hex: '112233', alpha: 1 },
              align: 'left',
              decoration: [],
              direction: 'ltr',
              language: 'zh-CN',
            },
          },
        ],
      })),
    })
    const canvas = { width: 12192000, height: 6858000 }
    const source = join(directory, 'source.pptx')
    await writeEditablePptx(snapshot, source, {
      embedFonts: false,
      slideLayouts: ['cover', 'body', 'complex'],
      masterLayoutDefinitions: ['cover', 'body', 'complex'].map(
        (name, index) => ({
          name,
          canvas,
          masterId: index === 1 ? 'secondary' : 'primary',
          masterTheme: {
            fontFamily: index === 1 ? 'Courier New' : 'Arial',
            colors: [index === 1 ? 'AA3300' : '2255AA'],
          },
          masterObjects: {
            canvas,
            objects: [
              {
                name: 'Brand',
                x: 100,
                y: 200,
                width: 3000,
                height: 400,
                fill: index === 1 ? 'AA3300' : '2255AA',
              },
            ],
          },
          fixedObjects: [
            {
              name: 'Footer',
              x: 1000,
              y: 4000000,
              width: 3000000,
              height: 500000,
              text: 'Company',
              language: 'de-DE',
              alternativeLanguage: '',
              fontFamily: 'Arial',
              fontSize: 16,
              color: '224466',
            },
          ],
          placeholders: [
            {
              index: 0,
              type: 'title' as const,
              x: 100000 + index * 100000,
              y: 200000,
              width: 5000000,
              height: 800000,
              textStyle: {
                fontFamily: index === 1 ? 'Courier New' : 'Arial',
                fontSize: 24,
                color: '112233',
                bold: false,
                italic: false,
              },
            },
          ],
        }),
      ),
      placeholderBindings: [1, 2, 3].map((slide) => ({
        slide,
        target: 'title',
        index: 0,
        geometry: 'layout' as const,
      })),
    })
    const sourceZip = await JSZip.loadAsync(await readFile(source))
    for (const path of Object.keys(sourceZip.files).filter((path) =>
      /^ppt\/slideMasters\/.*\.xml$/.test(path),
    )) {
      const xml = await sourceZip.file(path)!.async('string')
      // Move reusable character defaults onto the master. The source layout
      // keeps its paragraph geometry, but has to inherit size, fonts and color.
      sourceZip.file(
        path,
        replaceTitleBody(
          xml,
          '<a:bodyPr lIns="180000" rIns="240000" tIns="120000" bIns="360000" anchor="b" wrap="none"><a:normAutofit fontScale="90000"/></a:bodyPr>',
          true,
        )
          .replace(
            '<a:srgbClr val="2255AA"/>',
            '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>',
          )
          .replace(
            /<p:titleStyle>[\s\S]*?<\/p:titleStyle>/,
            `<p:titleStyle><a:defPPr><a:defRPr sz="2400" lang="en-GB" altLang="fr-FR"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="${xml.includes('2255AA') ? 'Noto Serif SC' : '+mn-ea'}"/><a:cs typeface="${xml.includes('2255AA') ? 'Noto Sans Arabic' : '+mn-cs'}"/></a:defRPr></a:defPPr></p:titleStyle>`,
          ),
      )
    }
    // An unsupported fixed object must survive as a located loss, never vanish
    // while its candidate is advertised as fully materialized.
    for (const path of Object.keys(sourceZip.files).filter((path) =>
      /^ppt\/slideLayouts\/.*\.xml$/.test(path),
    )) {
      const xml = replaceTitleBody(
        await sourceZip.file(path)!.async('string'),
        '<a:bodyPr lIns="0"><a:noAutofit/></a:bodyPr>',
      )
        .replace(/(<a:defRPr[^>]*) sz="2400"/g, '$1')
        .replace(/(<a:defRPr[^>]*>)[\s\S]*?(<\/a:defRPr>)/g, '$1$2')
      sourceZip.file(path, xml)
      if (xml.includes('name="body"'))
        sourceZip.file(
          path,
          xml.replace(/<a:lvl2pPr[\s\S]*?<\/a:lvl2pPr>/, (level) =>
            level
              .replace('algn="l"', 'algn="r"')
              .replace('marL="0"', 'marL="400000"')
              .replace('indent="0"', 'indent="-120000"')
              .replace('val="120000"', 'val="150000"')
              .replace('<a:spcPts val="0"/>', '<a:spcPts val="400"/>')
              .replace('<a:defRPr', '<a:defRPr sz="1400" lang=""')
              .replace('b="0"', 'b="1"')
              .replace('i="0"', 'i="1"'),
          ),
        )
      if (xml.includes('name="complex"'))
        sourceZip.file(
          path,
          xml
            .replace('<a:noAutofit/>', '<a:normAutofit fontScale="85000"/>')
            .replace(
              /(<a:lvl2pPr[^>]*>[\s\S]*?<a:defRPr[^>]*>)/,
              '$1<a:ea typeface="Different CJK"/>',
            )
            .replace(
              '</p:spTree>',
              '<p:pic><p:nvPicPr><p:cNvPr id="99" name="Unsupported image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr></p:pic></p:spTree>',
            ),
        )
    }
    const bytes = await sourceZip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, bytes)
    const analysis = await analyzePptx(bytes)
    const inherited = (
      analysis.extractedFeatures.resolvedObjectText as TextEvidence
    )
      .find((entry) => entry.part === analysis.sourceGraph!.slides[0]!.layout)!
      .objects.find((entry) => entry.category === 'titleStyle')!
    expect(inherited.levels[0]!.defaultRun.attributes.sz).toBe('2400')
    expect(inherited.levels[0]!.defaultRun.attributes).toMatchObject({
      lang: 'en-GB',
      altLang: 'fr-FR',
    })
    expect(
      inherited.levels[0]!.defaultRun.origins['attributes.lang']?.part,
    ).toBe(analysis.sourceGraph!.slides[0]!.master)
    expect(
      inherited.levels[0]!.defaultRun.origins['attributes.sz'],
    ).toMatchObject({
      part: analysis.sourceGraph!.slides[0]!.master,
      scope: 'master/txStyles/titleStyle/defRPr',
    })
    const analysisFile = join(directory, 'analysis.json')
    await writeFile(analysisFile, JSON.stringify(analysis))
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'roundtrip',
      '--out',
      directory,
      '--analysis',
      analysisFile,
    ])
    const generated = join(directory, 'slidev-theme-roundtrip')
    const definitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(generated, 'agent/native-layouts.json'), 'utf8'),
      ),
    )
    const candidates = parseCandidates(
      await readFile(join(generated, 'agent/layout-candidates.json'), 'utf8'),
    )
    expect(
      definitions,
      JSON.stringify(
        candidates.map((entry) => ({ id: entry.id, issues: entry.issues })),
      ),
    ).toHaveLength(2)
    const firstPart = analysis.sourceGraph!.slides[0]!.layout!
    const secondPart = analysis.sourceGraph!.slides[1]!.layout!
    const partialPart = analysis.sourceGraph!.slides[2]!.layout!
    const first = definitions.find(
      (entry) =>
        entry.name === candidates.find((entry) => entry.id === firstPart)!.name,
    )!
    const second = definitions.find(
      (entry) =>
        entry.name ===
        candidates.find((entry) => entry.id === secondPart)!.name,
    )!
    expect(first.masterId).not.toBe(second.masterId)
    expect(first.placeholders[0]?.textBody).toEqual({
      insets: { left: 0, right: 240000, top: 120000, bottom: 360000 },
      verticalAlign: 'bottom',
      wrap: false,
      autoFit: 'none',
    })
    expect(first.placeholders[0]?.textStyle).toEqual({
      underline: false,
      strike: false,
      letterSpacing: 0,
      baselinePercent: 0,
      kerningThreshold: 0,
      language: 'en-GB',
      alternativeLanguage: 'fr-FR',
      fontFamilies: {
        latin: 'Arial',
        ea: 'Noto Serif SC',
        cs: 'Noto Sans Arabic',
      },
      fontSize: 24,
      color: '112233',
      bold: false,
      italic: false,
      paragraph: {
        defaultTabSize: 914400,
        bullet: { kind: 'none' },
        bulletFont: { kind: 'text' },
        bulletColor: { kind: 'text' },
        bulletSize: { kind: 'text' },
        direction: 'ltr',
        align: 'left',
        marginLeft: 0,
        marginRight: 0,
        indent: 0,
        lineSpacing: { unit: 'percent', value: 120 },
        spaceBefore: { unit: 'points', value: 0 },
        spaceAfter: { unit: 'points', value: 0 },
      },
    })
    expect(first.masterTheme).toMatchObject({
      fontFamily: 'Arial',
      colors: [
        '2255AA',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ],
    })
    expect(second.masterTheme?.fontFamily).toBe('Courier New')
    expect(second.masterTheme?.colors?.[0]).toBe('AA3300')
    expect(first.masterObjects?.objects).toMatchObject([
      { name: 'Brand', fill: '112B55' },
    ])
    expect(first.fixedObjects).toMatchObject([
      {
        name: 'Footer',
        text: 'Company',
        language: 'de-DE',
        alternativeLanguage: '',
        fontSize: 16,
        fontFamily: 'Arial',
        color: '224466',
      },
    ])
    const partialCandidate = candidates.find(
      (entry) => entry.id === partialPart,
    )
    expect(partialCandidate?.generated?.status).toBe('partial')
    for (const reason of [
      'unsupported fixed object pic',
      'unsupported text body autofit normAutofit',
    ])
      expect(
        partialCandidate?.issues.some((issue) => issue.includes(reason)),
      ).toBe(true)
    expect(
      second.placeholders[0]?.textStyle?.levels?.find(
        (entry) => entry.level === 2,
      ),
    ).toMatchObject({
      textStyle: { fontSize: 14, bold: true, italic: true },
      paragraph: {
        align: 'right',
        marginLeft: 400000,
        indent: -120000,
        lineSpacing: { unit: 'percent', value: 150 },
        spaceBefore: { unit: 'points', value: 4 },
      },
    })
    expect(
      candidates
        .find((entry) => entry.id === partialPart)
        ?.generated?.definition?.placeholders[0]?.textStyle?.levels?.find(
          (entry) => entry.level === 2,
        )?.textStyle?.fontFamilies?.ea,
    ).toBe('Different CJK')
    const vue = await readFile(
      join(generated, 'layouts', `${first.name}.vue`),
      'utf8',
    )
    expect(vue).toContain('data-fastppt-object-scope="master"')
    expect(vue).toContain('data-fastppt-object-scope="layout"')
    expect(vue).toContain(
      `data-fastppt-group="${first.masterObjects!.objects[0]!.anchor}"`,
    )
    expect(vue).toContain('<slot name="ph-0" />')
    const output = join(directory, 'exported.pptx')
    await writeEditablePptx(
      {
        ...snapshot,
        slides: snapshot.slides
          .slice(0, 2)
          .map((slide, index) => ({
            ...slide,
            elements: slide.elements.map((element) =>
              element.kind === 'text'
                ? { ...element, paragraphLevel: index + 1 }
                : element,
            ),
          })),
      },
      output,
      {
        embedFonts: false,
        slideLayouts: [first.name, second.name],
        masterLayoutDefinitions: definitions,
        placeholderBindings: [1, 2].map((slide) => ({
          slide,
          target: 'title',
          index: 0,
          geometry: 'layout' as const,
          textStyle: 'layout' as const,
          textBody: 'layout' as const,
        })),
      },
    )
    const readback = await analyzePptx(await readFile(output))
    const readText = readback.extractedFeatures
      .resolvedObjectText as TextEvidence
    for (const [index, expected] of [first, second].entries()) {
      const slide = readback.sourceGraph!.slides[index]!
      const run = readText.find((entry) => entry.part === slide.part)!
        .objects[0]!.paragraphs[0]!.runs[0]!
      expect(run.attributes).toMatchObject({
        lang: index === 0 ? 'en-GB' : '',
        altLang: 'fr-FR',
      })
      expect(run.origins['attributes.lang']?.part).toBe(slide.layout)
      expect(run.origins['attributes.altLang']?.part).toBe(slide.layout)
      const footer = readText
        .find((entry) => entry.part === slide.layout)!
        .objects.find((object) =>
          object.paragraphs.some((p) =>
            p.runs.some((r) => r.text === 'Company'),
          ),
        )!.paragraphs[0]!.runs[0]!
      expect(footer.attributes).toMatchObject({ lang: 'de-DE', altLang: '' })
      expect(run.attributes).toMatchObject(
        index === 0
          ? { sz: '2400', b: '0', i: '0' }
          : { sz: '1400', b: '1', i: '1' },
      )
      const paragraph = readText.find((entry) => entry.part === slide.part)!
        .objects[0]!.paragraphs[0]!
      expect(paragraph.level).toBe(index + 1)
      expect(paragraph.attributes).toMatchObject(
        index === 0
          ? { algn: 'l', marL: '0', indent: '0' }
          : { algn: 'r', marL: '400000', indent: '-120000' },
      )
      expect(paragraph.origins['attributes.marL']?.part).toBe(slide.layout)
      expect(run.resolvedFonts.latin?.family).toBe(
        expected.placeholders[0]!.textStyle!.fontFamilies?.latin ??
          expected.placeholders[0]!.textStyle!.fontFamily,
      )
      expect(run.resolvedFonts.eastAsian?.family).toBe(
        expected.placeholders[0]!.textStyle!.fontFamilies?.ea ??
          expected.placeholders[0]!.textStyle!.fontFamily,
      )
      expect(run.resolvedFonts.complexScript?.family).toBe(
        expected.placeholders[0]!.textStyle!.fontFamilies?.cs ??
          expected.placeholders[0]!.textStyle!.fontFamily,
      )
      expect(run.origins['fonts.eastAsian.typeface']?.part).toBe(slide.layout)
      expect(run.color?.value).toBe('#112233')
      expect(run.origins['attributes.sz']?.part).toBe(slide.layout)
      expect(
        readText
          .find((entry) => entry.part === slide.layout)!
          .objects.find((entry) => entry.category === 'titleStyle')!
          .levels.every(
            (level) =>
              level.attributes.algn ===
                (index === 1 && level.level === 2 ? 'r' : 'l') &&
              level.attributes.marL ===
                (index === 1 && level.level === 2 ? '400000' : '0') &&
              level.defaultRun.attributes.kern === '0',
          ),
      ).toBe(true)
    }
    expect(readback.sourceGraph!.slides[0]!.master).not.toBe(
      readback.sourceGraph!.slides[1]!.master,
    )
    const geometry = readback.extractedFeatures.resolvedGeometry as Array<{
      part: string
      placeholders: Array<{
        geometry: Record<string, string>
        complete: boolean
        appearance?: {
          textBody?: {
            attributes: Record<string, string>
            attributeOrigins: Record<string, { part: string }>
          }
        }
      }>
    }>
    for (const [index, definition] of [first, second].entries()) {
      const slide = readback.sourceGraph!.slides[index]!
      const slot = definition.placeholders[0]!
      expect(
        geometry.find((entry) => entry.part === slide.part)?.placeholders[0],
      ).toMatchObject({
        complete: true,
        geometry: {
          x: String(slot.x),
          y: String(slot.y),
          cx: String(slot.width),
          cy: String(slot.height),
        },
      })
      const body = geometry.find((entry) => entry.part === slide.part)!
        .placeholders[0]!.appearance!.textBody!
      expect(body.attributes).toMatchObject({
        lIns: '0',
        rIns: '240000',
        tIns: '120000',
        bIns: '360000',
        anchor: 'b',
        wrap: 'none',
      })
      expect(body.attributeOrigins.lIns?.part).toBe(slide.layout)
      const zip = await JSZip.loadAsync(await readFile(output))
      expect(await zip.file(slide.master!)!.async('string')).toContain(
        'name="Brand"',
      )
      expect(await zip.file(slide.layout!)!.async('string')).toContain(
        'Company',
      )
      expect(await zip.file(slide.part)!.async('string')).not.toContain(
        'Company',
      )
    }
    // Invalid declarations remain located losses and cannot enter registered layouts.
    const invalidZip = await JSZip.loadAsync(bytes)
    invalidZip.file(
      firstPart,
      (await invalidZip.file(firstPart)!.async('string')).replace(
        '<a:defRPr',
        '<a:defRPr lang="en_US"',
      ),
    )
    const invalidBytes = await invalidZip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, invalidBytes)
    await writeFile(
      analysisFile,
      JSON.stringify(await analyzePptx(invalidBytes)),
    )
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'invalid-language',
      '--out',
      directory,
      '--analysis',
      analysisFile,
    ])
    const invalidCandidates = parseCandidates(
      await readFile(
        join(
          directory,
          'slidev-theme-invalid-language/agent/layout-candidates.json',
        ),
        'utf8',
      ),
    )
    const invalidCandidate = invalidCandidates.find(
      (candidate) => candidate.id === firstPart,
    )!
    expect(invalidCandidate.generated?.status).toBe('partial')
    expect(
      invalidCandidate.issues.some((issue) =>
        issue.includes('invalid lang language identifier'),
      ),
    ).toBe(true)

    // The last local choice used to win, so buNone hid an earlier unsupported
    // bullet and published an invalid source layout as complete.
    const ambiguousSource = (
      await sourceZip.file(firstPart)!.async('string')
    ).replace('<a:buNone/>', '<a:buChar char="•"/><a:buNone/>')
    sourceZip.file(firstPart, ambiguousSource)
    const ambiguousBytes = await sourceZip.generateAsync({ type: 'nodebuffer' })
    const ambiguousAnalysis = await analyzePptx(ambiguousBytes)
    await writeFile(source, ambiguousBytes)
    await writeFile(analysisFile, JSON.stringify(ambiguousAnalysis))
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'ambiguous',
      '--out',
      directory,
      '--analysis',
      analysisFile,
    ])
    const ambiguousTheme = join(directory, 'slidev-theme-ambiguous', 'agent')
    const ambiguousCandidates = parseCandidates(
      await readFile(join(ambiguousTheme, 'layout-candidates.json'), 'utf8'),
    )
    const ambiguousCandidate = ambiguousCandidates.find(
      (entry) => entry.id === firstPart,
    )
    expect(ambiguousCandidate?.generated?.status).toBe('partial')
    expect(
      ambiguousCandidate?.issues.some((issue) =>
        issue.includes(
          `Ambiguous text property bullet (buChar, buNone) at ${firstPart}`,
        ),
      ),
    ).toBe(true)
    const allowed = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(ambiguousTheme, 'native-layouts.json'), 'utf8'),
      ),
    )
    expect(allowed.map((entry) => entry.name)).toEqual([second.name])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('projects actual source bullet theme properties into an editable layout and preserves cancellations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-bullet-roundtrip-'))
  try {
    const canvas = { width: 12192000, height: 6858000 }
    const style = {
      fontFamily: 'Arial',
      fontSizePx: 24,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeightPx: 30,
      letterSpacingPx: 0,
      color: { hex: '112233', alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
    }
    const snapshot = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      warnings: [],
      slides: [1, 2].map((index) => ({
        version: 1,
        id: `slide-${index}`,
        width: 960,
        height: 540,
        warnings: [],
        elements: [
          {
            id: 'body',
            kind: 'text',
            text: 'Body text',
            paragraphLevel: index,
            box: { x: 50, y: 50, width: 600, height: 100 },
            order: 0,
            zIndex: 0,
            opacity: 1,
            source: { tag: 'p', path: 'p', anchor: 'body' },
            style,
          },
        ],
      })),
    })
    const definition = NativeMasterLayoutSchema.parse({
      name: 'bullets',
      canvas,
      masterTheme: { fontFamily: 'Arial', colors: ['224466'] },
      placeholders: [
        {
          index: 0,
          type: 'body',
          x: 100000,
          y: 200000,
          width: 10000000,
          height: 5000000,
          textBody: { autoFit: 'none' },
          textStyle: {
            fontFamily: 'Arial',
            fontSize: 24,
            color: '112233',
            paragraph: {
              marginLeft: 500000,
              indent: -250000,
              bullet: { kind: 'character', character: '•' },
              bulletFont: { kind: 'font', fontFamily: 'Bullet Face' },
              bulletSize: { kind: 'percent', value: 80 },
              bulletColor: { kind: 'color', color: 'CC3300' },
            },
            levels: [
              {
                level: 2,
                paragraph: {
                  bullet: { kind: 'none' },
                  bulletFont: { kind: 'text' },
                  bulletColor: { kind: 'text' },
                  bulletSize: { kind: 'points', value: 16 },
                },
              },
            ],
          },
        },
      ],
    })
    const source = join(directory, 'source.pptx')
    const bindings = [1, 2].map((slide) => ({
      slide,
      target: 'body',
      index: 0,
      textStyle: 'layout' as const,
      geometry: 'layout' as const,
    }))
    await writeEditablePptx(snapshot, source, {
      embedFonts: false,
      slideLayouts: ['bullets', 'bullets'],
      masterLayoutDefinitions: [definition],
      placeholderBindings: bindings,
    })
    const zip = await JSZip.loadAsync(await readFile(source))
    for (const path of Object.keys(zip.files).filter((path) =>
      /^ppt\/slideLayouts\/.*\.xml$/.test(path),
    )) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="bullets"'))
        zip.file(
          path,
          xml
            .replaceAll('typeface="Bullet Face"', 'typeface="+mn-lt"')
            .replaceAll(
              '<a:buClr><a:srgbClr val="CC3300"/></a:buClr>',
              '<a:buClr><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:buClr>',
            ),
        )
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, bytes)
    const analysis = await analyzePptx(bytes),
      analysisPath = join(directory, 'analysis.json')
    await writeFile(analysisPath, JSON.stringify(analysis))
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'bullets',
      '--out',
      directory,
      '--analysis',
      analysisPath,
    ])
    const generated = join(directory, 'slidev-theme-bullets')
    const candidates = JSON.parse(
      await readFile(join(generated, 'agent/layout-candidates.json'), 'utf8'),
    ) as { candidates: unknown[] }
    const definitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(generated, 'agent/native-layouts.json'), 'utf8'),
      ),
    )
    expect(definitions, JSON.stringify(candidates)).toHaveLength(1)
    const textStyle = definitions[0]!.placeholders[0]!.textStyle!
    expect(
      textStyle.levels!.find((entry) => entry.level === 1)!.paragraph,
    ).toMatchObject({
      bullet: { kind: 'character', character: '•' },
      bulletFont: { kind: 'font', fontFamily: 'Arial' },
      bulletSize: { kind: 'percent', value: 80 },
      bulletColor: { kind: 'color', color: '112233' },
    })
    expect(
      textStyle.levels!.find((entry) => entry.level === 2)!.paragraph,
    ).toMatchObject({
      bullet: { kind: 'none' },
      bulletFont: { kind: 'text' },
      bulletSize: { kind: 'points', value: 16 },
      bulletColor: { kind: 'text' },
    })
    expect(
      await readFile(
        join(generated, 'layouts', `${definitions[0]!.name}.vue`),
        'utf8',
      ),
    ).toContain('data-fastppt-bullet-marker')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: [definitions[0]!.name, definitions[0]!.name],
      masterLayoutDefinitions: definitions,
      placeholderBindings: bindings,
    })
    const readback = await analyzePptx(await readFile(output))
    const evidence = readback.extractedFeatures
      .resolvedObjectText as TextEvidence
    const paragraphs = readback.sourceGraph!.slides.map(
      (slide) =>
        evidence
          .find((entry) => entry.part === slide.part)!
          .objects.find((object) => object.paragraphs.length)!.paragraphs[0]!,
    )
    expect(paragraphs[0]!.children.bullet!.attributes.char).toBe('•')
    expect(paragraphs[0]!.resolvedBulletFont!.family).toBe('Arial')
    expect(paragraphs[0]!.resolvedBulletColor!.value).toBe('#112233')
    expect(paragraphs[0]!.origins['children.bullet']!.part).toBe(
      readback.sourceGraph!.slides[0]!.layout,
    )
    expect(paragraphs[1]!.children.bullet!.kind).toBe('buNone')
    expect(paragraphs[1]!.children.bulletSize!.attributes.val).toBe('1600')
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['Body text', 'Body text'])
    for (const path of Object.keys(zip.files).filter((path) =>
      /^ppt\/slideLayouts\/.*\.xml$/.test(path),
    )) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="bullets"'))
        zip.file(
          path,
          xml
            .replaceAll('algn="l"', 'algn="ctr"')
            .replace(/indent="-\d+"/g, 'indent="250000"'),
        )
    }
    const centered = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, centered)
    await writeFile(analysisPath, JSON.stringify(await analyzePptx(centered)))
    await promisify(execFile)(process.execPath, [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'centered-bullets',
      '--out',
      directory,
      '--analysis',
      analysisPath,
    ])
    const centeredTheme = join(
      directory,
      'slidev-theme-centered-bullets',
      'agent',
    )
    const centeredDefinitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(centeredTheme, 'native-layouts.json'), 'utf8'),
      ),
    )
    expect(centeredDefinitions).toHaveLength(1)
    expect({
      ...centeredDefinitions[0]!.placeholders[0]!.textStyle!.paragraph,
      ...centeredDefinitions[0]!.placeholders[0]!.textStyle!.levels![0]!
        .paragraph,
    }).toMatchObject({ align: 'center', indent: 250000 })
    const centeredWritten = await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: [
        centeredDefinitions[0]!.name,
        centeredDefinitions[0]!.name,
      ],
      masterLayoutDefinitions: centeredDefinitions,
      placeholderBindings: bindings,
    })
    expect(
      centeredWritten.warnings.some(
        (warning) => warning.code === 'text-bullet-compatibility',
      ),
    ).toBe(true)
    const centeredReadback = await analyzePptx(await readFile(output))
    const centeredText = centeredReadback.extractedFeatures
      .resolvedObjectText as TextEvidence
    expect(
      centeredText
        .find(
          (entry) =>
            entry.part === centeredReadback.sourceGraph!.slides[0]!.part,
        )!
        .objects.find((object) => object.paragraphs.length)!.paragraphs[0]!
        .attributes,
    ).toMatchObject({ algn: 'ctr', indent: '250000' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('roundtrips source numbering defaults and keeps unsupported numbering candidates partial', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'fastppt-numbering-roundtrip-'),
  )
  try {
    const canvas = { width: 12192000, height: 6858000 }
    const style = {
      fontFamily: 'Arial',
      fontSizePx: 24,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeightPx: 30,
      letterSpacingPx: 0,
      color: { hex: '112233', alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
    }
    const snapshot = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      warnings: [],
      slides: [1, 2].map((index) => ({
        version: 1,
        id: `slide-${index}`,
        width: 960,
        height: 540,
        warnings: [],
        elements: [
          {
            id: 'body',
            kind: 'text',
            text: 'Body text',
            paragraphLevel: index,
            box: { x: 50, y: 50, width: 600, height: 100 },
            order: 0,
            zIndex: 0,
            opacity: 1,
            source: { tag: 'p', path: 'p', anchor: 'body' },
            style,
          },
        ],
      })),
    })
    const definition = NativeMasterLayoutSchema.parse({
      name: 'numbering',
      canvas,
      masterTheme: { fontFamily: 'Arial', colors: ['224466'] },
      placeholders: [
        {
          index: 0,
          type: 'body',
          x: 100000,
          y: 200000,
          width: 10000000,
          height: 5000000,
          textStyle: {
            fontFamily: 'Arial',
            fontSize: 24,
            paragraph: {
              marginLeft: 1000000,
              indent: -800000,
              bullet: {
                kind: 'auto-number',
                scheme: 'arabicPeriod',
                startAt: 5,
              },
            },
            levels: [
              {
                level: 2,
                paragraph: {
                  bullet: {
                    kind: 'auto-number',
                    scheme: 'alphaUcParenR',
                    startAt: 27,
                  },
                },
              },
            ],
          },
        },
      ],
    })
    const source = join(directory, 'source.pptx'),
      analysisPath = join(directory, 'analysis.json')
    const bindings = [1, 2].map((slide) => ({
      slide,
      target: 'body',
      index: 0,
      textStyle: 'layout' as const,
      geometry: 'layout' as const,
    }))
    await writeEditablePptx(snapshot, source, {
      embedFonts: false,
      slideLayouts: ['numbering', 'numbering'],
      masterLayoutDefinitions: [definition],
      placeholderBindings: bindings,
    })
    const bytes = await readFile(source)
    await writeFile(analysisPath, JSON.stringify(await analyzePptx(bytes)))
    const generate = async (name: string) => {
      await promisify(execFile)(process.execPath, [
        resolve('../../scripts/extract-theme.mjs'),
        source,
        '--name',
        name,
        '--out',
        directory,
        '--analysis',
        analysisPath,
      ])
      return join(directory, `slidev-theme-${name}`, 'agent')
    }
    const generated = await generate('numbering')
    const definitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(generated, 'native-layouts.json'), 'utf8'),
      ),
    )
    expect(definitions).toHaveLength(1)
    const levels = definitions[0]!.placeholders[0]!.textStyle!.levels!
    expect(
      levels.find((entry) => entry.level === 1)!.paragraph!.bullet,
    ).toEqual({ kind: 'auto-number', scheme: 'arabicPeriod', startAt: 5 })
    expect(
      levels.find((entry) => entry.level === 2)!.paragraph!.bullet,
    ).toEqual({ kind: 'auto-number', scheme: 'alphaUcParenR', startAt: 27 })
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: [definitions[0]!.name, definitions[0]!.name],
      masterLayoutDefinitions: definitions,
      placeholderBindings: bindings,
    })
    const readback = await analyzePptx(await readFile(output)),
      evidence = readback.extractedFeatures.resolvedObjectText as TextEvidence
    const paragraphs = readback.sourceGraph!.slides.map(
      (slide) =>
        evidence
          .find((entry) => entry.part === slide.part)!
          .objects.find((object) => object.paragraphs.length)!.paragraphs[0]!,
    )
    expect(
      paragraphs.map((paragraph) => paragraph.children.bullet!.attributes),
    ).toEqual([
      { type: 'arabicPeriod', startAt: '5' },
      { type: 'alphaUcParenR', startAt: '27' },
    ])
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['Body text', 'Body text'])
    const zip = await JSZip.loadAsync(bytes)
    for (const path of Object.keys(zip.files).filter((path) =>
      /^ppt\/slideLayouts\/.*\.xml$/.test(path),
    )) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="numbering"'))
        zip.file(
          path,
          xml.replaceAll('type="arabicPeriod"', 'type="ea1ChsPeriod"'),
        )
    }
    const unsupported = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, unsupported)
    await writeFile(
      analysisPath,
      JSON.stringify(await analyzePptx(unsupported)),
    )
    const partial = await generate('unsupported-numbering')
    expect(
      JSON.parse(await readFile(join(partial, 'native-layouts.json'), 'utf8')),
    ).toEqual([])
    const partialCandidates = parseCandidates(
      await readFile(join(partial, 'layout-candidates.json'), 'utf8'),
    )
    expect(
      partialCandidates.some(
        (candidate) =>
          candidate.generated?.status === 'partial' &&
          candidate.issues.some((issue) => issue.includes('buAutoNum')),
      ),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('materializes source tab spacing and explicit clearing without replacing text tabs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-tab-roundtrip-'))
  try {
    const style = {
      fontFamily: 'Arial',
      fontSizePx: 20,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeightPx: 26,
      letterSpacingPx: 0,
      color: { hex: '112233', alpha: 1 },
      align: 'left',
      decoration: [],
      direction: 'ltr',
    }
    const snapshot = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      warnings: [],
      slides: [1, 2].map((index) => ({
        version: 1,
        id: `slide-${index}`,
        width: 960,
        height: 540,
        warnings: [],
        elements: [
          {
            id: 'body',
            kind: 'text',
            text: 'A\tB\tC',
            paragraphLevel: index,
            box: { x: 50, y: 50, width: 600, height: 100 },
            order: 0,
            zIndex: 0,
            opacity: 1,
            source: { tag: 'p', path: 'p', anchor: 'body' },
            style,
          },
        ],
      })),
    })
    const definition = NativeMasterLayoutSchema.parse({
      name: 'tabs',
      canvas: { width: 12191695, height: 6857829 },
      placeholders: [
        {
          index: 0,
          type: 'body',
          x: 100000,
          y: 200000,
          width: 8000000,
          height: 4500000,
          textStyle: {
            fontFamily: 'Arial',
            fontSize: 20,
            paragraph: {
              defaultTabSize: 700000,
              tabStops: [
                { position: 0, align: 'left' },
                { position: 1000000, align: 'center' },
                { position: 3000000, align: 'right' },
              ],
            },
            levels: [
              { level: 2, paragraph: { defaultTabSize: 0, tabStops: [] } },
            ],
          },
        },
      ],
    })
    const source = join(directory, 'source.pptx'),
      analysisPath = join(directory, 'analysis.json')
    const bindings = [1, 2].map((slide) => ({
      slide,
      target: 'body',
      index: 0,
      textStyle: 'layout' as const,
      geometry: 'layout' as const,
    }))
    await writeEditablePptx(snapshot, source, {
      embedFonts: false,
      slideLayouts: ['tabs', 'tabs'],
      masterLayoutDefinitions: [definition],
      placeholderBindings: bindings,
    })
    const bytes = await readFile(source)
    await writeFile(analysisPath, JSON.stringify(await analyzePptx(bytes)))
    const generate = async (name: string) => {
      await promisify(execFile)(process.execPath, [
        resolve('../../scripts/extract-theme.mjs'),
        source,
        '--name',
        name,
        '--out',
        directory,
        '--analysis',
        analysisPath,
      ])
      return join(directory, `slidev-theme-${name}`)
    }
    const generated = await generate('tabs')
    const definitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(generated, 'agent/native-layouts.json'), 'utf8'),
      ),
    )
    expect(definitions).toHaveLength(1)
    const levels = definitions[0]!.placeholders[0]!.textStyle!.levels!
    expect(levels.find((entry) => entry.level === 1)!.paragraph).toMatchObject({
      defaultTabSize: 700000,
      tabStops: [
        { position: 0, align: 'left' },
        { position: 1000000, align: 'center' },
        { position: 3000000, align: 'right' },
      ],
    })
    expect(levels.find((entry) => entry.level === 2)!.paragraph).toMatchObject({
      defaultTabSize: 0,
      tabStops: [],
    })
    expect(
      await readFile(join(generated, 'setup/vite-plugins.ts'), 'utf8'),
    ).toContain('preserveTextFrameTabs')
    const output = join(directory, 'output.pptx')
    await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: [definitions[0]!.name, definitions[0]!.name],
      masterLayoutDefinitions: definitions,
      placeholderBindings: bindings,
    })
    const readback = await analyzePptx(await readFile(output)),
      evidence = readback.extractedFeatures.resolvedObjectText as TextEvidence
    const paragraphs = readback.sourceGraph!.slides.map(
      (slide) =>
        evidence
          .find((entry) => entry.part === slide.part)!
          .objects.find((object) => object.paragraphs.length)!.paragraphs[0]!,
    )
    expect(
      paragraphs.map((paragraph) => paragraph.attributes.defTabSz),
    ).toEqual(['700000', '0'])
    expect(
      paragraphs[0]!.children.tabLst!.children.map((child) => child.attributes),
    ).toEqual([
      { pos: '0', algn: 'l' },
      { pos: '1000000', algn: 'ctr' },
      { pos: '3000000', algn: 'r' },
    ])
    expect(paragraphs[1]!.children.tabLst!.children).toHaveLength(0)
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['A\tB\tC', 'A\tB\tC'])
    const zip = await JSZip.loadAsync(bytes)
    for (const path of Object.keys(zip.files).filter((path) =>
      /^ppt\/slideLayouts\/.*\.xml$/.test(path),
    )) {
      const xml = await zip.file(path)!.async('string')
      if (xml.includes('name="tabs"'))
        zip.file(
          path,
          xml.replace(
            '<a:tab pos="1000000" algn="ctr"',
            '<a:tab pos="1000000" algn="dec"',
          ),
        )
    }
    const unsupported = await zip.generateAsync({ type: 'nodebuffer' })
    await writeFile(source, unsupported)
    await writeFile(
      analysisPath,
      JSON.stringify(await analyzePptx(unsupported)),
    )
    const decimalAnalysis = await analyzePptx(unsupported)
    expect(decimalAnalysis.decimalTabConvention).toEqual({
      status: 'unknown',
      reason: 'drawingml-has-no-decimal-separator',
    })
    const partial = await generate('decimal-tabs')
    expect(
      JSON.parse(
        await readFile(join(partial, 'SOURCE_SELECTION.json'), 'utf8'),
      ),
    ).toMatchObject({
      decimalTabConvention: decimalAnalysis.decimalTabConvention,
    })
    expect(
      JSON.parse(
        await readFile(join(partial, 'agent/native-layouts.json'), 'utf8'),
      ),
    ).toEqual([])
    expect(
      parseCandidates(
        await readFile(join(partial, 'agent/layout-candidates.json'), 'utf8'),
      ).some(
        (candidate) =>
          candidate.generated?.status === 'partial' &&
          candidate.issues.some((issue) =>
            issue.includes('separator convention'),
          ),
      ),
    ).toBe(true)
    const declarationPath = join(directory, 'decimal-tabs.json')
    const decimalTab = {
      separator: ',',
      targetProfile: 'libreoffice-7.3.7.2-linux-de-DE',
      provenance: 'user-declared',
      reason: 'Source author confirms comma alignment for all decimal fields',
    }
    const declaration = {
      version: 1,
      sourcePptxSha256: decimalAnalysis.sourceHash,
      decimalTab,
    }
    await writeFile(declarationPath, JSON.stringify(declaration))
    const command = [
      resolve('../../scripts/extract-theme.mjs'),
      source,
      '--name',
      'declared-decimal',
      '--out',
      directory,
      '--analysis',
      analysisPath,
      '--decimal-tabs',
      declarationPath,
    ]
    await promisify(execFile)(process.execPath, command)
    const declared = join(directory, 'slidev-theme-declared-decimal')
    expect(
      JSON.parse(
        await readFile(join(declared, 'SOURCE_SELECTION.json'), 'utf8'),
      ),
    ).toMatchObject({
      decimalTabConvention: decimalAnalysis.decimalTabConvention,
      decimalTabDeclaration: declaration,
    })
    const declaredDefinitions = NativeMasterLayoutSchema.array().parse(
      JSON.parse(
        await readFile(join(declared, 'agent/native-layouts.json'), 'utf8'),
      ),
    )
    expect(declaredDefinitions).toHaveLength(1)
    expect(
      declaredDefinitions[0]!.placeholders[0]!.textStyle!.levels!.find(
        (entry) => entry.level === 1,
      )!.paragraph,
    ).toMatchObject({
      decimalTab,
      tabStops: [
        { position: 0, align: 'left' },
        { position: 1000000, align: 'decimal' },
        { position: 3000000, align: 'right' },
      ],
    })
    expect(
      declaredDefinitions[0]!.placeholders[0]!.textStyle!.levels!.find(
        (entry) => entry.level === 2,
      )!.paragraph,
    ).not.toHaveProperty('decimalTab')
    const native = await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: [
        declaredDefinitions[0]!.name,
        declaredDefinitions[0]!.name,
      ],
      masterLayoutDefinitions: declaredDefinitions,
      placeholderBindings: bindings,
    })
    expect(
      native.warnings.some(
        (warning) =>
          warning.code === 'text-tab-compatibility' &&
          warning.message.includes(decimalTab.targetProfile),
      ),
    ).toBe(true)
    const decimalReadback = await analyzePptx(await readFile(output))
    // This declaration lives in the template/sidecar. Native DrawingML cannot store it.
    expect(decimalReadback.decimalTabConvention).toEqual(
      decimalAnalysis.decimalTabConvention,
    )
    const decimalParagraph = (
      decimalReadback.extractedFeatures.resolvedObjectText as TextEvidence
    )
      .find(
        (entry) => entry.part === decimalReadback.sourceGraph!.slides[0]!.part,
      )!
      .objects.find((object) => object.paragraphs.length)!.paragraphs[0]!
    expect(decimalParagraph.children.tabLst!.children[1]!.attributes).toEqual({
      pos: '1000000',
      algn: 'dec',
    })
    expect(decimalParagraph.runs.map((run) => run.text).join('')).toBe(
      'A\tB\tC',
    )
    for (const invalid of [
      { ...declaration, sourcePptxSha256: '0'.repeat(64) },
      { ...declaration, decimalTab: { ...decimalTab, separator: '.' } },
      { ...declaration, decimalTab: null },
    ]) {
      await writeFile(declarationPath, JSON.stringify(invalid))
      await expect(
        promisify(execFile)(process.execPath, command),
      ).rejects.toThrow()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
