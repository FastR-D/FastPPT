import { expect, it } from 'vitest'
import {
  layoutDiagram,
  type DiagramLayoutInput,
} from '../src/primitives/diagram-layout.js'
import { NodePresentation } from '../src/server/presentation.js'

it.each(['gantt', 'timeline', 'flowchart'] as const)(
  'uses shared canvas geometry in native %s output at non-default aspect ratio',
  (kind) => {
    const document: DiagramLayoutInput = {
      kind,
      style: { width: 800, height: 600, direction: 'tb', fontFamily: 'Arial' },
      nodes: [
        { id: 'start', label: '开始' },
        { id: 'end', label: '结束' },
      ],
      edges: [{ from: 'start', to: 'end', label: '继续' }],
      tasks: [
        {
          id: 'task',
          label: '交付',
          start: '2026-01-01T00:00:00Z',
          end: '2026-01-03T00:00:00Z',
        },
      ],
    }
    const presentation = new NodePresentation({ layout: 'LAYOUT_4x3' })
    const slide = presentation.addSlide()
    slide.addDiagram(document)
    const geometry = layoutDiagram(document)
    expect(slide._ops).toHaveLength(geometry.length)
    geometry.forEach((primitive, index) => {
      const op = slide._ops[index]!
      if (primitive.kind === 'text' && op.kind === 'text') {
        expect(op.text).toBe(primitive.text)
        expect(op.opts.x).toBeCloseTo(primitive.x / 80)
        expect(op.opts.y).toBeCloseTo(primitive.y / 80)
        expect(op.opts.w).toBeCloseTo(primitive.width / 80)
      } else if (primitive.kind === 'line' && op.kind === 'line') {
        expect(op.x1).toBeCloseTo(primitive.x1 / 80)
        expect(op.y2).toBeCloseTo(primitive.y2 / 80)
      } else if (
        (primitive.kind === 'rect' || primitive.kind === 'ellipse') &&
        op.kind === 'shape'
      ) {
        expect(op.opts.x).toBeCloseTo(primitive.x / 80)
        expect(op.opts.h).toBeCloseTo(primitive.height / 80)
      } else throw new Error('Native geometry primitive was dropped or changed')
    })
  },
)

it('places native diagram primitives inside the captured image frame', () => {
  const document: DiagramLayoutInput = {
    style: { width: 800, height: 600, direction: 'lr', fontFamily: 'Arial' },
    nodes: [{ id: 'a', label: 'A' }], edges: [],
  }
  const presentation = new NodePresentation({ layout: 'LAYOUT_WIDE' })
  const slide = presentation.addSlide()
  slide.addDiagram(document, { x: 2, y: 3, width: 4, height: 3 })
  layoutDiagram(document).forEach((primitive, index) => {
    const operation = slide._ops[index]!
    if (operation.kind === 'text' && primitive.kind === 'text') {
      expect(operation.opts.x).toBeCloseTo(2 + primitive.x / 200)
      expect(operation.opts.y).toBeCloseTo(3 + primitive.y / 200)
      expect(operation.opts.w).toBeCloseTo(primitive.width / 200)
    } else if (operation.kind === 'shape' && primitive.kind === 'rect') {
      expect(operation.opts.x).toBeCloseTo(2 + primitive.x / 200)
      expect(operation.opts.y).toBeCloseTo(3 + primitive.y / 200)
    } else throw new Error('Unexpected primitive')
  })
})
