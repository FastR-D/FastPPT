import { describe, expect, it } from 'vitest'
import { diagramDigest, renderDiagram, validateDiagram } from '../src/index.js'

const doc = {
  version: 1 as const,
  kind: 'flowchart' as const,
  nodes: [
    { id: 'a', label: 'Start' },
    { id: 'b', label: 'End' },
  ],
  edges: [{ from: 'a', to: 'b' }],
}
describe('diagram engine', () => {
  it('validates and renders deterministic safe SVG', () => {
    expect(validateDiagram(doc).ok).toBe(true)
    const svg = renderDiagram(doc)
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('<script')
    expect(diagramDigest(doc)).toBe(
      diagramDigest({ ...doc, nodes: [...doc.nodes] }),
    )
  })
  it('reports unknown endpoints', () =>
    expect(
      validateDiagram({ ...doc, edges: [{ from: 'a', to: 'missing' }] }).ok,
    ).toBe(false))
  it('reports cycles, overflow labels, and out-of-bounds nodes', () => {
    const result = validateDiagram({
      ...doc,
      nodes: [
        { id: 'a', label: 'x'.repeat(81), x: 1100, y: 0 },
        { id: 'b', label: 'End' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Node exceeds diagram bounds: a',
        'Node label may overflow: a',
        'Cyclic dependency detected at: a',
      ]),
    )
  })
  it('reports low contrast node colors', () => {
    const result = validateDiagram({
      ...doc,
      nodes: [
        { id: 'a', label: 'Low', color: '#334155' },
        { id: 'b', label: 'End' },
      ],
    })
    expect(result.issues).toContain('Node text contrast is low: a')
  })
  it('validates task dates and dependency cycles', () => {
    const result = validateDiagram({
      ...doc,
      tasks: [
        {
          id: 'a',
          label: 'A',
          start: '2026-01-02T00:00:00.000Z',
          end: '2026-01-01T00:00:00.000Z',
          dependsOn: ['b'],
        },
        {
          id: 'b',
          label: 'B',
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-02T00:00:00.000Z',
          dependsOn: ['a'],
        },
      ],
    })
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Task ends before it starts: a',
        'Cyclic task dependency detected at: a',
      ]),
    )
  })
})

it.each(['gantt', 'timeline'])(
  'renders task content for %s deterministically',
  (kind) => {
    const input = {
      version: 1,
      kind,
      nodes: [],
      tasks: [
        {
          id: 'delivery',
          label: '交付 <release>',
          start: '2026-01-01T00:00:00Z',
          end: '2026-02-01T00:00:00Z',
        },
      ],
    }
    const svg = renderDiagram(input)
    expect(svg).toContain('交付 &lt;release&gt;')
    expect(svg).toContain('data-id="delivery"')
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect(svg).toBe(renderDiagram(input))
  },
)
