import { describe, expect, it } from 'vitest'

import { HtmlDeckSnapshotSchema } from '../src/snapshot.js'

describe('HtmlDeckSnapshotSchema', () => {
  it('validates the serializable browser-to-server contract', () => {
    expect(
      HtmlDeckSnapshotSchema.parse({
        version: 1,
        source: 'slidev',
        slides: [
          {
            version: 1,
            id: 'slide-1',
            width: 1920,
            height: 1080,
            elements: [],
            warnings: [],
          },
        ],
        warnings: [],
      }).slides,
    ).toHaveLength(1)
  })

  it('rejects malformed nested elements', () => {
    expect(() =>
      HtmlDeckSnapshotSchema.parse({
        version: 1,
        source: 'slidev',
        slides: [
          {
            version: 1,
            id: 'slide-1',
            width: 1920,
            height: 1080,
            elements: [{ kind: 'text', id: 'broken' }],
            warnings: [],
          },
        ],
        warnings: [],
      }),
    ).toThrow()
  })

  it('accepts optional Pretext measurement metadata', () => {
    const parsed = HtmlDeckSnapshotSchema.parse({
      version: 1,
      source: 'slidev',
      slides: [
        {
          version: 1,
          id: 'slide-1',
          width: 1280,
          height: 720,
          elements: [
            {
              id: 'text-1',
              kind: 'text',
              text: 'é 👨‍👩‍👧‍👦',
              metrics: { advancePx: 92.5, graphemeCount: 3 },
              box: { x: 10, y: 10, width: 90, height: 24 },
              order: 0,
              zIndex: 1,
              opacity: 1,
              source: { tag: 'span', path: 'root/span' },
              style: {
                fontFamily: 'Inter',
                fontSizePx: 20,
                fontWeight: 400,
                fontStyle: 'normal',
                lineHeightPx: 24,
                letterSpacingPx: 0,
                color: { hex: '000000', alpha: 1 },
                align: 'left',
                decoration: [],
                direction: 'ltr',
              },
            },
          ],
          warnings: [],
        },
      ],
      warnings: [],
    })
    const element = parsed.slides[0]?.elements[0]
    expect(element?.kind).toBe('text')
    if (!element || element.kind !== 'text') throw new Error('Missing text')
    expect(element.metrics).toEqual({ advancePx: 92.5, graphemeCount: 3 })
  })
})
