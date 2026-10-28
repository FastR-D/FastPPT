import {describe,it,expect} from 'vitest'
import {bindCreativeAnimation} from './creative-animation.js'
import type {AnimationDocumentV1} from '@fastppt/protocol'
const source:AnimationDocumentV1={version:1,slideId:'source',transition:{kind:'none',durationMs:500},groups:[{id:'s3',static:false,effects:[{id:'e',kind:'native',target:'s3',trigger:'with-previous',delayMs:0,durationMs:800,params:{nativeXml:'<p:cTn/>',sourceOrder:0}}]}],source:'system',diagnostics:[]}
describe('creative motion binding',()=>{
 it('binds actual objects while preserving motion and keeping source immutable',()=>{const bound=bindCreativeAnimation(source,'destination',{'s3':'hero'},['hero']);expect(bound.groups[0]?.id).toBe('hero');expect(bound.groups[0]?.effects[0]?.target).toBe('hero');expect(bound.groups[0]?.effects[0]?.params.nativeXml).toBe('<p:cTn/>');expect(source.groups[0]?.id).toBe('s3')})
 it('rejects missing targets and colliding choreography bindings',()=>{expect(()=>bindCreativeAnimation(source,'slide',{},['hero'])).toThrow();const multi={...source,groups:[...source.groups,{...source.groups[0]!,id:'s4',effects:source.groups[0]!.effects.map(e=>({...e,target:'s4'}))}]};expect(()=>bindCreativeAnimation(multi,'slide',{s3:'hero',s4:'hero'},['hero'])).toThrow('分别绑定')})
})
