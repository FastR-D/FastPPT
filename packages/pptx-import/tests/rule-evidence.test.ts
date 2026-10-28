import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { readPptxRuleEvidence } from '../src/rule-evidence.js'

async function artifact(animated = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-readback-'))
  try {
    const output = join(directory, 'deck.pptx')
    const snapshot = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'html',
      warnings: [],
      slides: [1, 2].map((index) => ({
        version: 1,
        id: `stable-${index}`,
        width: 100,
        height: 100,
        warnings: [],
        elements:
          animated && index === 1
            ? [
                {
                  id: 'logo',
                  kind: 'shape',
                  shape: 'rect',
                  box: { x: 1, y: 1, width: 20, height: 20 },
                  opacity: 1,
                  order: 1,
                  zIndex: 1,
                  source: {
                    tag: 'div',
                    path: 'logo',
                    anchor: 'logo',
                    nativeLayoutObject: {
                      layout: 'cover',
                      name: 'Logo',
                      scope: 'master',
                    },
                  },
                  fill: { hex: '112233', alpha: 1 },
                },
              ]
            : [],
      })),
    })
    await writeEditablePptx(snapshot, output, {
      embedFonts: false,
      slideLayouts: ['cover', 'body'],
      masterLayoutDefinitions: [
        {
          name: 'cover',
          masterId: 'brand-a',
          placeholders: [
            { type: 'title', index: 0, x: 10, y: 10, width: 1000, height: 500 },
          ],
          masterObjects: {
            objects: [{ name: 'Logo', x: 0, y: 0, width: 100, height: 100 }],
          },
        },
        {
          name: 'body',
          masterId: 'brand-b',
          placeholders: [],
          fixedObjects: [
            { name: 'Footer', x: 0, y: 100, width: 100, height: 20 },
          ],
        },
      ],
      ...(animated
        ? {
            objectAnimations: [
              { slide: 1, target: 'logo', kind: 'appear' as const },
            ],
          }
        : {}),
    })
    return await readFile(output)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('reads actual logical layouts, master relations, placeholder definitions and fixed owners', async () => {
  const result = await readPptxRuleEvidence(await artifact())
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.slides).toMatchObject([
    {
      index: 1,
      slideId: 'stable-1',
      layout: 'cover',
      master: 'brand-a',
      placeholders: [{ type: 'title', index: 0 }],
      fixedObjects: [{ name: 'Logo', owner: 'master', overridden: false }],
    },
    {
      index: 2,
      slideId: 'stable-2',
      layout: 'body',
      master: 'brand-b',
      placeholders: [],
      fixedObjects: [{ name: 'Footer', owner: 'layout', overridden: false }],
    },
  ])
})

it('validates the presentation root and rejects ambiguous slide ids', async () => {
  const zip = await JSZip.loadAsync(await artifact())
  const path = 'ppt/presentation.xml'
  const xml = await zip.file(path)!.async('string')
  zip.file(path, xml.replace(/p:presentation/g, 'p:unknown'))
  await expect(
    readPptxRuleEvidence(await zip.generateAsync({ type: 'uint8array' })),
  ).rejects.toThrow('Invalid presentation part')
  zip.file(
    path,
    xml.replace(
      /(<p:sldId\s+id=")[^"]+/g,
      (_match, prefix: string) => `${prefix}256`,
    ),
  )
  await expect(
    readPptxRuleEvidence(await zip.generateAsync({ type: 'uint8array' })),
  ).rejects.toThrow('duplicate presentation slide id')
})

it('follows presentation order and detects deleted definitions instead of trusting expected inputs', async () => {
  const zip = await JSZip.loadAsync(await artifact())
  const before = await readPptxRuleEvidence(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  const presentation = await zip.file('ppt/presentation.xml')!.async('string')
  const rows = presentation.match(/<p:sldId\s[^>]*\/>/g)!
  zip.file(
    'ppt/presentation.xml',
    presentation.replace(rows.join(''), [...rows].reverse().join('')),
  )
  const first = before.slides[0]!
  const layout = await zip.file(first.layoutPart!)!.async('string')
  zip.file(first.layoutPart!, layout.replace(/<p:ph[^>]*\/>/, ''))
  const result = await readPptxRuleEvidence(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  expect(result.slides.map((slide) => slide.slideId)).toEqual([
    'stable-2',
    'stable-1',
  ])
  expect(result.slides[1]?.placeholders).toEqual([])
})

it('retains logical ownership for an animated variant and checks that overridden page shapes exist', async () => {
  const bytes = await artifact(true)
  const result = await readPptxRuleEvidence(bytes)
  expect(result.slides[0]).toMatchObject({
    layout: 'cover',
    master: 'brand-a',
    fixedObjects: [
      {
        name: 'Logo',
        owner: 'master',
        overridden: true,
        part: 'ppt/slides/slide1.xml',
      },
    ],
  })
  const zip = await JSZip.loadAsync(bytes)
  const path = result.slides[0]!.part
  zip.file(
    path,
    (await zip.file(path)!.async('string')).replace(
      /shapeIds="[^"]+"/,
      'shapeIds="999999"',
    ),
  )
  await expect(
    readPptxRuleEvidence(await zip.generateAsync({ type: 'uint8array' })),
  ).rejects.toThrow('override evidence')
})

it('does not count hidden inherited objects and rejects missing master relationships', async () => {
  const zip = await JSZip.loadAsync(await artifact())
  const first = (
    await readPptxRuleEvidence(await zip.generateAsync({ type: 'uint8array' }))
  ).slides[0]!
  zip.file(
    first.part,
    (await zip.file(first.part)!.async('string')).replace(
      '<p:sld ',
      '<p:sld showMasterSp="0" ',
    ),
  )
  expect(
    (
      await readPptxRuleEvidence(
        await zip.generateAsync({ type: 'uint8array' }),
      )
    ).slides[0]?.fixedObjects,
  ).toEqual([])
  zip.remove(first.masterPart!)
  await expect(
    readPptxRuleEvidence(await zip.generateAsync({ type: 'uint8array' })),
  ).rejects.toThrow('Missing slideMaster part')
})
