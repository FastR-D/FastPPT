import { describe, expect, it } from 'vitest'
import { regionFromPoints, visualEditInstruction } from '../../src/workspace/visual-edit.js'
import { SlideRegionSchema } from '@fastppt/protocol'
describe('visual editing coordinates and scope', () => {
  it('normalizes dragging in every direction and clamps outside the slide', () => {
    expect(regionFromPoints({ x: .8, y: .7 }, { x: .2, y: .1 })).toEqual({ x: .2, y: .1, width: .6000000000000001, height: .6 })
    expect(regionFromPoints({ x: -.2, y: .5 }, { x: 1.3, y: .9 })).toEqual({ x: 0, y: .5, width: 1, height: .4 })
    expect(regionFromPoints({ x: .1, y: .1 }, { x: .101, y: .1 })).toBeUndefined()
    expect(SlideRegionSchema.safeParse({ x: .8, y: .1, width: .4, height: .2 }).success).toBe(false)
  })
  it('carries exact coordinates and constrains the requested scope', () => {
    const region = { x: .1, y: .2, width: .3, height: .4 }
    const text = visualEditInstruction({ instruction: '改成三步流程', region })
    expect(text).toContain(JSON.stringify(region))
    expect(text).toContain('slide-normalized-top-left')
    expect(text).toContain('不扩大修改范围')
  })
})
