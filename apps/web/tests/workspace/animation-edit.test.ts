import { describe, expect, it } from 'vitest'
import type { AnimationDocumentV1 } from '@fastppt/protocol'
import { rebindAnimationEffect } from '../../src/workspace/animation-edit.js'

function fixture(): AnimationDocumentV1 {
  return { version: 1, slideId: 'page', source: 'user', diagnostics: [], transition: { kind: 'none', durationMs: 500 }, groups: [
    { id: 'old', label: 'Old', static: false, effects: [{ id: 'effect', target: 'old', kind: 'entrance_fade', trigger: 'after-previous', delayMs: 25, durationMs: 350, params: { custom: 'retained' } }] },
    { id: 'new', label: 'New', static: false, effects: [] },
  ] }
}
describe('animation rebinding', () => {
  it('moves an effect into the target group without mutating the source or timing', () => {
    const source = fixture()
    const result = rebindAnimationEffect(source, 'old', 'effect', { target: 'new' })
    expect(source.groups[0]?.effects).toHaveLength(1)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.id).toBe('new')
    expect(result.groups[0]?.effects[0]).toEqual({ ...source.groups[0]?.effects[0], target: 'new' })
  })
  it('preserves unrelated groups with matching effect IDs', () => {
    const source = fixture()
    source.groups.push({ ...source.groups[0]!, id: 'other', effects: [{ ...source.groups[0]!.effects[0]!, target: 'other' }] })
    const result = rebindAnimationEffect(source, 'old', 'effect', { target: 'new' })
    expect(result.groups.find(group => group.id === 'other')?.effects).toHaveLength(1)
  })
  it('rejects a static target and duplicate effect IDs in the destination', () => {
    const source = fixture()
    source.groups[1]!.static = true
    expect(() => rebindAnimationEffect(source, 'old', 'effect', { target: 'new' })).toThrow('静态')
    source.groups[1]!.static = false
    source.groups[1]!.effects.push({ ...source.groups[0]!.effects[0]!, target: 'new' })
    expect(() => rebindAnimationEffect(source, 'old', 'effect', { target: 'new' })).toThrow('同名')
  })
})
