import { expect, it } from 'vitest'
import { applyMotionPreset, mergeSourceAnimations, type PresetPage } from '../../src/workspace/motion-presets.js'

const pages: PresetPage[] = [{ slideId: 'one', targets: [
  { anchor: 'title', role: 'title' }, { anchor: 'body', role: 'content' },
  { anchor: 'brand', role: 'logo' }, { anchor: 'bg', role: 'background' },
  { anchor: 'footer', role: 'inherited' }, { anchor: 'page', role: 'page-number' },
  { anchor: 'locked', role: 'content', static: true }, { anchor: 'body', role: 'content' },
] }]
it('applies teaching only to eligible content and leaves brand framework static', () => {
  const result = applyMotionPreset({ version: 1, animations: [] }, pages, 'teaching')
  expect(result.document.animations[0]?.groups.map(group => group.id)).toEqual(['title', 'body'])
  expect(result.document.animations[0]?.groups.every(group => group.effects[0]?.trigger === 'on-click')).toBe(true)
})
it('preserves user and agent overrides unless replacement was explicitly requested', () => {
  const input = applyMotionPreset({ version: 1, animations: [] }, pages, 'business').document
  input.animations[0]!.source = 'user'
  const original = structuredClone(input)
  const kept = applyMotionPreset(input, pages, 'static')
  expect(kept.preserved).toEqual(['one'])
  expect(kept.document).toEqual(original)
  const replaced = applyMotionPreset(input, pages, 'static', true)
  expect(replaced.document.animations[0]?.groups).toEqual([])
  expect(replaced.document.animations[0]?.transition.kind).toBe('none')
  expect(input).toEqual(original)
})
it('changes only supplied pages and replaces earlier system presets', () => {
  const input = applyMotionPreset({ version: 1, animations: [] }, [...pages, { slideId: 'two', targets: [] }], 'business').document
  const result = applyMotionPreset(input, pages, 'reveal').document
  expect(result.animations[0]?.groups[0]?.effects[0]?.trigger).toBe('after-previous')
  expect(result.animations[1]).toEqual(input.animations[1])
})

it('preserves Markdown effects before preset application while honoring explicit sidecar overrides', () => {
  const source = applyMotionPreset({ version: 1, animations: [] }, pages, 'teaching').document.animations[0]!
  const empty = { ...source, slideId: 'empty', transition: { kind: 'none' as const, durationMs: 500 }, groups: [] }
  const merged = mergeSourceAnimations({ version: 1, animations: [] }, [{ animation: source }, { animation: empty }])
  expect(merged.animations).toHaveLength(1)
  expect(merged.animations[0]?.source).toBe('user')
  expect(applyMotionPreset(merged, pages, 'static').preserved).toEqual(['one'])
  const explicitStatic = { ...empty, slideId: 'one' }
  expect(mergeSourceAnimations({ version: 1, animations: [explicitStatic] }, [{ animation: source }]).animations).toEqual([explicitStatic])
  const transitionOnly = { ...empty, slideId: 'transition', transition: { kind: 'fade' as const, durationMs: 500 } }
  expect(mergeSourceAnimations({ version: 1, animations: [] }, [{ animation: transitionOnly }]).animations[0]?.source).toBe('user')
  expect(source.source).toBe('system')
})
