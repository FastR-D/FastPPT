import { describe,it,expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { AnimationLibrary } from '../src/index.js'
import { compileDeck } from '@fastppt/presentation-compiler'
import { nativeEffectXml } from '@fastppt/slidewave/native-animation'
import { nativeMotionFrame,motionFormula } from '@fastppt/slidewave/native-motion'
const library=new AnimationLibrary()
describe('creative animation library',()=>{
  it('moves the dedicated source out of layouts and retrieves actual object effects',async()=>{
    const layouts=JSON.parse(await readFile(new URL('../../resources/index.json',import.meta.url),'utf8')) as {entries:{id:string}[]}
    expect(layouts.entries.some(e=>e.id.startsWith('c9f1632d31e4-'))).toBe(false)
    const entries=await library.entries()
    expect(entries.filter(e=>e.origin==='creative-library')).toHaveLength(206)
    expect((await library.search({query:'伸展'})).items[0]?.category).toBe('缩放与弹性')
    expect((await library.search({query:'不存在的效果abcdefgh'})).total).toBe(0)
    await expect(library.filePath('../resources/index.json')).rejects.toThrow('Invalid')
  })
  it('compiles portable demo metadata and exports every imported behavior with fresh native timing IDs',async()=>{
    let effects=0
    for(const entry of await library.entries()){
      const value=(await library.read(entry.id))!
      const compiled=compileDeck(value.markdown)[0]!
      const all=value.motion.groups.flatMap(g=>g.effects)
      expect(compiled.animation.groups.flatMap(g=>g.effects)).toHaveLength(all.length)
      for(const effect of all){
        let id=100000
        const xml=nativeEffectXml(String(effect.params.nativeXml),'999',()=>id++)
        expect(xml).toContain('spid="999"')
        for(const progress of [0,.25,.5,.75,1])expect(()=>nativeMotionFrame(effect,{x:.5,y:.5,width:.3,height:.25,canvasWidth:960,canvasHeight:540},progress)).not.toThrow()
        effects++
      }
    }
    expect(effects).toBe(13326)
  },120_000)
  it('covers every native source target with a replaceable semantic HTML object',async()=>{
    const roles=new Set<string>()
    for(const entry of await library.entries()){
      const value=(await library.read(entry.id))!
      const sourceTargets=new Set(value.motion.groups.flatMap(g=>g.effects.map(e=>e.target)))
      const anchors=[...value.markdown.matchAll(/data-fastppt-group="([^"]+)"/g)].map(m=>m[1])
      expect(new Set(anchors)).toEqual(sourceTargets)
      expect(anchors).toHaveLength(sourceTargets.size)
      expect(value.markdown).not.toMatch(/<svg|<image|<canvas|<video/i)
      expect(entry.objects?.map(o=>o.target).sort()).toEqual([...sourceTargets].sort())
      for(const object of entry.objects??[]){
        expect(object.replaceWith.length).toBeGreaterThan(5)
        expect(object.sourceShapeId).toBe(object.target.slice(1))
        expect(value.markdown).toContain(`data-animation-slot="${object.slot}"`)
        roles.add(object.role)
      }
    }
    expect(roles.has('headline')).toBe(true)
    expect(roles.has('product-image')).toBe(true)
    expect(roles.has('particle')).toBe(true)
  },120_000)
  it('never evaluates JavaScript and keeps random scrubbing deterministic',()=>{
    expect(motionFormula('#ppt_x+sin(pi/2)*$',{ppt_x:.4,$:.5})).toBeCloseTo(.9)
    expect(motionFormula('rand(720*$)',{$:.5,seed:123})).toBe(motionFormula('rand(720*$)',{$:.5,seed:123}))
    expect(()=>motionFormula('globalThis.fetch("/private")')).toThrow()
    expect(()=>nativeEffectXml('<p:cmd xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>','1',()=>2)).toThrow()
  })
  it('applies root easing, repeats and fractional reverse endpoints to child behavior',()=>{
    const metrics={x:.5,y:.5,width:.3,height:.25,canvasWidth:960,canvasHeight:540}
    const effect={id:'timing',target:'object',kind:'native',durationMs:2000,params:{sourceDurationMs:2000,rootTiming:{baseDurationMs:1000,repeat:2,accel:.5},behaviors:[{type:'anim',attribute:'style.opacity',durationMs:1000,from:'0',to:'1'}]}}
    expect(nativeMotionFrame(effect,metrics,.125).opacity).toBeCloseTo(1/12)
    expect(nativeMotionFrame(effect,metrics,.625).opacity).toBeCloseTo(1/12)
    expect(nativeMotionFrame(effect,metrics,1).opacity).toBe(1)
    const fractional={...effect,durationMs:1800,params:{...effect.params,sourceDurationMs:1800,rootTiming:{baseDurationMs:1000,repeat:.9,autoReverse:true,accel:0}}}
    expect(nativeMotionFrame(fractional,metrics,1).opacity).toBeCloseTo(.2)
  })
})
