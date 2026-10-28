import { expect, it } from 'vitest'
import { transitionXml } from '../src/server/transitions.js'
import { parseXml, setSlideChild, validateSlideAnimationXml, PRESENTATION_NS } from '../src/server/slide-xml.js'
it('writes precise duration with a directional fallback and replaces it in schema order', () => {
  const fragment = transitionXml({ kind: 'push', direction: 'right', durationMs: 1250 })!
  expect(fragment).toContain('p14:dur="1250"')
  expect(fragment.match(/<p:push dir="r"\/>/g)).toHaveLength(2)
  const original = `<p:sld xmlns:p="${PRESENTATION_NS}"><p:cSld/><p:timing/><p:extLst/></p:sld>`
  const xml = setSlideChild(original, 'transition', fragment)
  expect(parseXml(xml).children.map(node => node.local)).toEqual(['cSld', 'AlternateContent', 'timing', 'extLst'])
  expect(validateSlideAnimationXml(xml)).toEqual([])
  const replaced = setSlideChild(xml, 'transition', transitionXml('fade')!)
  expect(replaced).not.toContain('AlternateContent')
  expect(replaced.match(/<p:transition/g)).toHaveLength(1)
})
it('rejects invalid timing and directions and keeps legacy names', () => {
  expect(transitionXml('none')).toBeUndefined()
  expect(transitionXml('wipe')).toContain('dir="l"')
  expect(() => transitionXml({ kind: 'fade', durationMs: NaN })).toThrow('duration')
  expect(() => transitionXml({ kind: 'push', direction: 'diagonal' })).toThrow('direction')
})
