import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeEditablePptx, EditablePptxPolicyError } from '../../src/server/index.js'
import { htmlDeckToPresentation } from '../../src/slidev/render.js'
import { HtmlDeckSnapshotSchema } from '../../src/snapshot.js'
import { landingContentDeck } from '../slidev/fixtures/landingContentSlide.js'

describe('object export evidence and policy', () => {
  it('retains asset identity and reports image output without claiming native editability', () => {
    const deck = structuredClone(landingContentDeck)
    deck.slides[0]!.elements = [{
      id: 'photo', kind: 'image', box: { x: 0, y: 0, width: 10, height: 10 },
      order: 0, zIndex: 0, opacity: 1, source: { tag: 'img', path: 'root/img' },
      assetKey: 'assets/generated/chart.svg',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+QWc9WQAAAABJRU5ErkJggg==',
    }]
    const parsed = HtmlDeckSnapshotSchema.parse(deck)
    expect(parsed.slides[0]!.elements[0]).toHaveProperty('assetKey', 'assets/generated/chart.svg')
    expect(htmlDeckToPresentation(parsed).objects[0]).toMatchObject({ status: 'image', editableRequired: false, nativeCount: 0, imageCount: 1, imageKinds: { vector: 0, raster: 1, unknown: 0 } })
  })

  it.each([0, 1, 999])('blocks an orphan animation on slide %s without writing an artifact', async (slide) => {
    const directory = await mkdtemp(join(tmpdir(), 'fastppt-orphan-animation-'))
    try {
      const output = join(directory, 'orphan.pptx')
      await expect(writeEditablePptx(landingContentDeck, output, { embedFonts: false, objectAnimations: [
        { slide, target: 'deleted-object', kind: 'entrance_fade' },
      ] })).rejects.toThrow(slide === 0 ? 'Invalid animation slide' : slide === 999 ? 'does not exist' : 'deleted-object')
      await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('blocks missing content under every policy without writing an artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fastppt-policy-'))
    try {
      const deck = structuredClone(landingContentDeck)
      deck.slides[0]!.elements = [{
        id: 'missing', kind: 'image', box: { x: 0, y: 0, width: 10, height: 10 },
        order: 0, zIndex: 0, opacity: 1, source: { tag: 'img', path: 'root/img' },
      }]
      for (const policy of ['editable', 'strict-editable', 'visual-fidelity'] as const) {
        const output = join(directory, `${policy}.pptx`)
        await expect(writeEditablePptx(deck, output, { policy })).rejects.toMatchObject({ name: 'EditablePptxPolicyError', objects: [expect.objectContaining({ status: 'missing' })] })
        await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.each(['image-embed-failed', 'unsupported-media', 'invalid-snapshot'] as const)('blocks capture loss reported as %s even when no element was emitted', async (code) => {
    const deck = structuredClone(landingContentDeck)
    deck.slides[0]!.elements = []
    deck.slides[0]!.warnings = [{ code, message: 'Source content was skipped', elementId: 'root/lost' }]
    const report = htmlDeckToPresentation(deck).objects
    expect(report).toEqual([expect.objectContaining({ status: 'missing', source: { tag: 'capture-failure', path: 'root/lost' }, reasons: ['Source content was skipped'] })])
    await expect(writeEditablePptx(deck, '/unused-capture-rejected.pptx')).rejects.toBeInstanceOf(EditablePptxPolicyError)
  })

  it('rejects precise-radius shape image fallback in strict mode', async () => {
    const deck = structuredClone(landingContentDeck)
    const shape = deck.slides[0]!.elements.find((element) => element.kind === 'shape' && element.shape === 'roundRect')!
    if (shape.kind !== 'shape') throw new Error('Missing shape fixture')
    shape.preciseRadius = true
    deck.slides[0]!.elements = [shape]
    expect(htmlDeckToPresentation(deck).objects[0]).toMatchObject({ editableRequired: true, imageCount: 1, imageKinds: { vector: 1, raster: 0, unknown: 0 } })
    await expect(writeEditablePptx(deck, '/unused-policy-rejected.pptx', { policy: 'strict-editable' })).rejects.toBeInstanceOf(EditablePptxPolicyError)
  })
})
