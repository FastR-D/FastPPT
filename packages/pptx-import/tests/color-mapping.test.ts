import { expect, it } from 'vitest'
import { extractColorMap, resolveColorMap } from '../src/color-mapping.js'
import { DRAWING_NS, PRESENTATION_NS } from '../src/relationships.js'
const wrap = (content: string) => `<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}">${content}</p:sld>`

it('preserves layout overrides and explicit page reset to the master mapping', () => {
  const master = extractColorMap(wrap('<p:clrMap bg1="lt1" tx1="dk1" accent1="accent1"/>'), 'master')!
  const layout = extractColorMap(wrap('<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" accent1="accent2"/></p:clrMapOvr>'), 'layout')!
  const reset = extractColorMap(wrap('<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'), 'page')!
  expect(resolveColorMap('page', [master, layout], 'layout', 'master')).toMatchObject({ sourcePart: 'layout', mapping: { bg1: 'dk1', accent1: 'accent2' } })
  expect(resolveColorMap('page', [master, layout, reset], 'layout', 'master')).toMatchObject({ sourcePart: 'master', resetBy: 'page', mapping: { bg1: 'lt1', accent1: 'accent1' } })
  expect(resolveColorMap('page', [], 'layout', 'master').status).toBe('unspecified')
})

it('rejects conflicting mapping choices', () => {
  expect(() => extractColorMap(wrap('<p:clrMapOvr><a:masterClrMapping/><a:overrideClrMapping/></p:clrMapOvr>'), 'page')).toThrow('Invalid color mapping')
})
