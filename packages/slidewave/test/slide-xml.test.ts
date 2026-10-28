import { describe, expect, it } from 'vitest'
import {
  PRESENTATION_NS,
  animationShapeIds,
  parseXml,
  setSlideChild,
  validateSlideAnimationXml,
} from '../src/server/slide-xml.js'

const source = `<p:sld xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:cNvPr id="4" name="hero"/></p:spTree></p:cSld><p:clrMapOvr/><p:extLst/></p:sld>`
describe('PresentationML animation structure', () => {
  it('writes transition and timing after content and color mapping, before extensions', () => {
    const timing = '<p:timing><p:cTn id="1"/><p:spTgt spid="4"/></p:timing>'
    const result = setSlideChild(
      setSlideChild(source, 'timing', timing),
      'transition',
      '<p:transition><p:fade/></p:transition>',
    )
    expect(parseXml(result).children.map((child) => child.local)).toEqual([
      'cSld',
      'clrMapOvr',
      'transition',
      'timing',
      'extLst',
    ])
    expect(validateSlideAnimationXml(result)).toEqual([])
    expect(result).toContain('<p:cNvPr id="4" name="hero"/>')
  })
  it('replaces existing nodes and handles a different presentation prefix', () => {
    const alternate = source
      .replace(/(<\/?)p:/g, '$1pres:')
      .replace('xmlns:p=', 'xmlns:pres=')
    const first = setSlideChild(
      alternate,
      'transition',
      '<p:transition><p:fade/></p:transition>',
    )
    const second = setSlideChild(
      first,
      'transition',
      '<p:transition><p:wipe dir="l"/></p:transition>',
    )
    expect(
      parseXml(second).children.filter((c) => c.local === 'transition'),
    ).toHaveLength(1)
    expect(second).not.toContain('<p:fade')
    expect(validateSlideAnimationXml(second)).toEqual([])
  })
  it('rejects invalid references, duplicate timing IDs and out-of-order children', () => {
    const xml = source.replace(
      '<p:cSld>',
      '<p:timing><p:cTn id="1"/><p:cTn id="1"/><p:spTgt spid="99"/></p:timing><p:cSld>',
    )
    expect(validateSlideAnimationXml(xml)).toEqual(
      expect.arrayContaining([
        'Slide child out of schema order: cSld',
        'Missing or duplicate timing ID: 1',
        'Animation references missing shape: 99',
      ]),
    )
  })
  it('checks timing references after collecting all nodes, including forward references', () => {
    const valid = setSlideChild(source, 'timing', '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:stCondLst><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="2"/></p:par></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')
    expect(validateSlideAnimationXml(valid)).toEqual([])
    expect(validateSlideAnimationXml(valid.replace('<p:tn val="2"/>', '<p:tn val="99"/>'))).toContain('Animation references missing timing node: 99')
  })
  it('rejects malformed XML and entity declarations', () => {
    expect(() => parseXml('<a><b></a>')).toThrow('Unbalanced')
    expect(() => parseXml('<!DOCTYPE a><a/>')).toThrow('DTD')
    expect(() => parseXml('<p:a/>')).toThrow('Unbound')
  })
})

it('resolves animation shapes by namespace, decoded anchor and attribute value', () => {
  const xml = `<q:sld xmlns:q="${PRESENTATION_NS}"><q:cNvPr name="fastppt:a&amp;b:first" id="7"/><q:cNvPr id="8" name="fastppt:a&amp;b:second"/><q:cNvPr id="9" name="fastppt:a&amp;bc:other"/></q:sld>`
  expect(animationShapeIds(xml, 'a&b')).toEqual(['7', '8'])
})
