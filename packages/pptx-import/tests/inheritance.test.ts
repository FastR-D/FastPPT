import { expect, it } from 'vitest'
import { resolvePlaceholderGeometry } from '../src/inheritance.js'
import type { SourceObject } from '../src/objects.js'

const placeholder = (
  part: string,
  id: string,
  type: string,
  idx: string,
  transform?: SourceObject['transform'],
): SourceObject => ({
  part,
  shapeId: id,
  kind: 'sp',
  order: 0,
  sourceXml: '',
  provenance: 'extracted',
  placeholder: { type, idx, explicit: {} },
  ...(transform ? { transform } : {}),
})
const master = placeholder('master.xml', '2', 'body', '99', {
  units: 'emu',
  attributes: {},
  offset: { x: '100', y: '200' },
  extent: { cx: '300', cy: '400' },
})

it('resolves idx then type while preserving per-property local overrides and origin', () => {
  const layout = placeholder('layout.xml', '3', 'obj', '7', {
    units: 'emu',
    attributes: {},
    extent: { cx: '500', cy: '600' },
  })
  const slide = placeholder('slide.xml', '8', 'obj', '07', {
    units: 'emu',
    attributes: {},
    offset: { x: '0', y: '-20' },
  })
  const resolved = resolvePlaceholderGeometry(
    slide,
    [layout],
    [master],
    'slide',
  )
  expect(resolved).toMatchObject({
    complete: true,
    geometry: { x: '0', y: '-20', cx: '500', cy: '600' },
    origins: {
      x: { part: 'slide.xml', shapeId: '8' },
      cx: { part: 'layout.xml', shapeId: '3' },
    },
    chain: [
      { part: 'slide.xml' },
      { part: 'layout.xml' },
      { part: 'master.xml' },
    ],
    issues: [],
  })
  expect(
    resolvePlaceholderGeometry(layout, [], [master], 'layout'),
  ).toMatchObject({
    geometry: { x: '100', y: '200', cx: '500', cy: '600' },
    origins: { x: { part: 'master.xml', shapeId: '2' } },
  })
})

it('does not guess between duplicate placeholder indices', () => {
  const slide = placeholder('slide.xml', '8', 'obj', '7')
  const layouts = [
    placeholder('layout.xml', '3', 'obj', '7'),
    placeholder('layout.xml', '4', 'obj', '7'),
  ]
  const result = resolvePlaceholderGeometry(slide, layouts, [master], 'slide')
  expect(result.complete).toBe(false)
  expect(result.geometry).toEqual({})
  expect(result.issues[0]).toContain('Ambiguous layout')
})

it('does not inherit ancestor transforms when the local placeholder has a complete frame', () => {
  const layout = placeholder('layout.xml', '3', 'body', '0', {
    units: 'emu',
    attributes: {},
    offset: { x: '20', y: '40' },
    extent: { cx: '200', cy: '80' },
  })
  const parent = {
    ...master,
    transform: {
      ...master.transform!,
      attributes: { rot: '5400000', flipH: 'true' },
    },
  }
  expect(
    resolvePlaceholderGeometry(layout, [], [parent], 'layout'),
  ).toMatchObject({
    complete: true,
    geometry: { x: '20', y: '40', cx: '200', cy: '80' },
  })
})

it('tracks each inherited appearance attribute instead of assigning merged properties to one XML fragment', () => {
  const layout = placeholder('layout.xml', '3', 'body', '0')
  layout.appearance = {
    textBody: {
      attributes: { lIns: '0' },
      sourceXml: '<a:bodyPr lIns="0"/>',
      provenance: 'extracted',
    },
    line: {
      attributes: { w: '12700' },
      sourceXml: '<a:ln w="12700"/>',
      provenance: 'extracted',
    },
  }
  const parent = {
    ...master,
    appearance: {
      textBody: {
        attributes: { lIns: '100', anchor: 'ctr' },
        sourceXml: '<a:bodyPr lIns="100" anchor="ctr"/>',
        provenance: 'extracted' as const,
      },
      line: {
        attributes: { w: '25400', cap: 'rnd' },
        sourceXml: '<a:ln w="25400" cap="rnd"/>',
        provenance: 'extracted' as const,
      },
    },
  }
  const appearance = resolvePlaceholderGeometry(
    layout,
    [],
    [parent],
    'layout',
  ).appearance!
  expect(appearance.textBody).toMatchObject({
    attributes: { lIns: '0', anchor: 'ctr' },
    attributeOrigins: {
      lIns: { part: 'layout.xml' },
      anchor: { part: 'master.xml' },
    },
    sources: [{ part: 'layout.xml' }, { part: 'master.xml' }],
  })
  expect(appearance.line).toMatchObject({
    attributes: { w: '12700', cap: 'rnd' },
    attributeOrigins: {
      w: { part: 'layout.xml' },
      cap: { part: 'master.xml' },
    },
  })
  expect(appearance.textBody).not.toHaveProperty('sourceXml')
})

it('resolves the nearest autofit choice while retaining raw parent evidence and ambiguity', () => {
  const layout = placeholder('layout.xml', '3', 'body', '0')
  const node = (kind: string) => ({ kind, namespace: 'http://schemas.openxmlformats.org/drawingml/2006/main', attributes: {}, children: [] })
  layout.appearance = { textBody: { attributes: { lIns: '0' }, properties: [node('noAutofit')], sourceXml: '<a:bodyPr lIns="0"><a:noAutofit/></a:bodyPr>', provenance: 'extracted' } }
  const parent: SourceObject = { ...master, appearance: { textBody: { attributes: { rIns: '100', anchor: 'b' }, properties: [{ ...node('normAutofit'), attributes: { fontScale: '90000' } }], sourceXml: '<a:bodyPr rIns="100" anchor="b"><a:normAutofit fontScale="90000"/></a:bodyPr>', provenance: 'extracted' } } }
  const original = structuredClone([layout, parent])
  const appearance = resolvePlaceholderGeometry(layout, [], [parent], 'layout').appearance!
  expect(appearance.textBody).toMatchObject({ attributes: { lIns: '0', rIns: '100', anchor: 'b' }, autoFit: { kind: 'noAutofit', origin: { part: 'layout.xml' } }, sources: [{ part: 'layout.xml' }, { part: 'master.xml' }] })
  expect(appearance.unsupported).toBeUndefined()
  expect([layout, parent]).toEqual(original)
  layout.appearance.textBody!.properties = []
  expect(resolvePlaceholderGeometry(layout, [], [parent], 'layout').appearance!.textBody?.autoFit).toMatchObject({ kind: 'normAutofit', attributes: { fontScale: '90000' }, origin: { part: 'master.xml' } })
  layout.appearance.textBody!.properties = [node('noAutofit'), node('spAutoFit')]
  const ambiguous = resolvePlaceholderGeometry(layout, [], [parent], 'layout').appearance!
  expect(ambiguous.textBody?.autoFit).toBeUndefined()
  expect(ambiguous.unsupported).toContain('Ambiguous text body autofit at layout.xml#3')
})

it('keeps grouped placeholder coordinates unresolved rather than treating them as slide coordinates', () => {
  const groupChild = { ...master, parentShapeId: 'group' }
  const result = resolvePlaceholderGeometry(
    placeholder('layout.xml', '3', 'obj', '7'),
    [],
    [groupChild],
    'layout',
  )
  expect(result.complete).toBe(false)
  expect(result.issues[0]).toContain('group transform')
})

it('resolves an axis-aligned group coordinate system and preserves its provenance', () => {
  const group: SourceObject = {
    part: 'layout.xml',
    shapeId: 'group',
    kind: 'grpSp',
    order: 0,
    sourceXml: '',
    provenance: 'extracted',
    transform: {
      units: 'emu',
      attributes: {},
      offset: { x: '1000', y: '2000' },
      extent: { cx: '8000', cy: '4000' },
      childOffset: { x: '0', y: '0' },
      childExtent: { cx: '800', cy: '400' },
    },
  }
  const child = placeholder('layout.xml', 'child', 'body', '7', {
    units: 'emu',
    attributes: {},
    offset: { x: '80', y: '40' },
    extent: { cx: '200', cy: '100' },
  })
  child.parentShapeId = 'group'
  const masterPlaceholder = placeholder(
    'master.xml',
    'master-body',
    'body',
    '99',
    {
      units: 'emu',
      attributes: {},
      offset: { x: '0', y: '0' },
      extent: { cx: '8000', cy: '4000' },
    },
  )
  const resolved = resolvePlaceholderGeometry(
    child,
    [group, child],
    [masterPlaceholder],
    'layout',
    [group, child],
  )
  expect(resolved).toMatchObject({
    complete: true,
    geometry: { x: '1800', y: '2400', cx: '2000', cy: '1000' },
  })
  expect(resolved.issues).toEqual([])
})
