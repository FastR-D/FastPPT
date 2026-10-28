import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { freeformGeometryXml } from '../../src/server/freeform.js'
import { parseNativeGeometry, type NativePaths } from '../../src/primitives/native-geometry.js'
import { writeEditablePptx } from '../../src/server/index.js'
import { HtmlDeckSnapshotSchema } from '../../src/snapshot.js'
import type { HtmlDeckSnapshot } from '../../src/snapshot-types.js'

const geometry:NativePaths={fillRule:'evenodd',paths:[
  {closed:true,points:[[0,0],[1,0],[1,1],[0,1]]},
  {closed:true,points:[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]},
]}
describe('native HTML geometry delivery',()=>{
  it('keeps an even-odd hole within one DrawingML path with opposite winding',()=>{
    const xml=freeformGeometryXml(geometry)
    expect(xml.match(/<a:path /g)).toHaveLength(1)
    expect(xml.match(/<a:moveTo>/g)).toHaveLength(2)
    expect(xml).toContain('<a:moveTo><a:pt x="250000" y="750000"/></a:moveTo>')
  })
  it('rejects unbounded, malformed and executable metadata',()=>{
    const base={version:1,...geometry,fill:'#123456',stroke:'none',strokeWidthRatio:0}
    expect(()=>parseNativeGeometry(JSON.stringify({...base,paths:[{closed:true,points:[[Infinity,0],[0,1]]}]}))).toThrow()
    expect(()=>parseNativeGeometry(JSON.stringify({...base,paths:[{closed:true,points:[[0,0]]}]}))).toThrow()
    expect(()=>parseNativeGeometry(JSON.stringify({...base,onload:'fetch("/private")'}))).toThrow()
  })
  it('normalizes implicitly closed fill holes without closing their strokes',()=>{
    const xml=freeformGeometryXml({...geometry,paths:geometry.paths.map(path=>({...path,closed:false}))})
    expect(xml).toContain('<a:moveTo><a:pt x="250000" y="750000"/></a:moveTo>')
    expect(xml).not.toContain('<a:close/>')
  })
  it('exports HTML polygon geometry as editable shapes with no image parts',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'fastppt-native-html-'))
    try{
      const snapshot:HtmlDeckSnapshot={version:2,source:'slidev',warnings:[],slides:[{version:2,id:'1',width:960,height:540,warnings:[],elements:[{
        id:'diagram',kind:'shape',shape:'freeform',geometry,source:{tag:'div',path:'root/div',anchor:'diagram'},box:{x:100,y:100,width:300,height:250},order:1,zIndex:1,opacity:1,fill:{hex:'123456',alpha:1},
      }]}]}
      HtmlDeckSnapshotSchema.parse(snapshot)
      const result=await writeEditablePptx(snapshot,join(directory,'native.pptx'),{embedFonts:false,policy:'strict-editable'})
      expect(result.qa.ok).toBe(true)
      const zip=await JSZip.loadAsync(await readFile(join(directory,'native.pptx')))
      const xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(xml).toContain('<a:custGeom>')
      expect(xml).not.toContain('<p:pic>')
      expect(Object.keys(zip.files).filter(path=>/^ppt\/media\//.test(path)&&!path.endsWith('/'))).toEqual([])
    }finally{await rm(directory,{recursive:true,force:true})}
  })
})
