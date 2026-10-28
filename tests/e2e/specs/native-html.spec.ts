import { test,expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { writeEditablePptx } from '@fastppt/slidewave/server'
import type { HtmlSlideSnapshot } from '@fastppt/slidewave/snapshot'
import { ResourceLibrary } from '../../../packages/resources/src/index.ts'

const root=fileURLToPath(new URL('../../../',import.meta.url))
test('captures an HTML compound polygon once and exports an editable hole with correct opacity',async({page})=>{
  await page.goto('/')
  const metadata={version:1,fillRule:'evenodd',paths:[{closed:true,points:[[0,0],[1,0],[1,1],[0,1]]},{closed:true,points:[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]}],fill:'#123456',stroke:'none',strokeWidthRatio:0,fillOpacity:.5}
  const payload=JSON.stringify(metadata).replaceAll('"','&quot;')
  await page.setContent(`<style>body{margin:0}#capture-root{width:960px;height:540px;position:relative;background:white}</style><main id="capture-root"><div data-fastppt-group="target" style="position:absolute;inset:0"><div data-fastppt-geometry="${payload}" style="position:absolute;left:100px;top:100px;width:300px;height:250px;opacity:.5"><div style="position:absolute;inset:0;background:#123456;opacity:.5;clip-path:polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,25% 25%,75% 25%,75% 75%,25% 75%,25% 25%,0% 0%)"></div></div></div></main>`)
  const path=`http://127.0.0.1:4318/@fs${root}packages/slidewave/src/slidev/capture.ts`
  const slide=await page.evaluate(async path=>{const {captureHtmlSlide}=await import(path) as {captureHtmlSlide:(node:HTMLElement,options:{snapshotVersion:number})=>Promise<HtmlSlideSnapshot>};return captureHtmlSlide(document.querySelector<HTMLElement>('#capture-root')!,{snapshotVersion:2})},path)
  const targets=slide.elements.filter(e=>e.source.anchor==='target')
  expect(targets).toHaveLength(1)
  expect(targets[0]).toMatchObject({kind:'shape',shape:'freeform',fill:{hex:'123456',alpha:.25},geometry:{paths:metadata.paths}})
  await page.locator('[data-fastppt-geometry] > div').evaluate(element=>{(element as HTMLElement).style.backgroundColor='#aabbcc'})
  const recolored=await page.evaluate(async path=>{const {captureHtmlSlide}=await import(path) as {captureHtmlSlide:(node:HTMLElement,options:{snapshotVersion:number})=>Promise<HtmlSlideSnapshot>};return captureHtmlSlide(document.querySelector<HTMLElement>('#capture-root')!,{snapshotVersion:2})},path)
  expect(recolored.elements.find(e=>e.source.anchor==='target')).toMatchObject({fill:{hex:'AABBCC',alpha:.25}})
  const snapshot=HtmlDeckSnapshotSchema.parse({version:2,source:'slidev',slides:[slide],warnings:[]})
  const result=await writeEditablePptx(snapshot,'/tmp/fastppt-native-html.pptx',{embedFonts:false,policy:'strict-editable'})
  expect(result.qa.ok).toBe(true)
  const zip=await JSZip.loadAsync(await readFile('/tmp/fastppt-native-html.pptx')),xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(xml).toContain('<a:custGeom>');expect(xml).toContain('<a:alpha val="25000"/>');expect(xml).not.toContain('<p:pic>')
  await page.locator('#capture-root').screenshot({path:'/tmp/fastppt-native-html-capture.png'})
})

test('exports a converted library page as separate editable geometry and text',async({page})=>{
  const library=new ResourceLibrary(`${root}packages/resources`)
  await page.route('**/assets/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)!
    await route.fulfill({path:await library.filePath(`assets/${name}`)})
  })
  await page.goto('/')
  await page.setContent((await library.preview('11ebacee969e-0010'))!)
  await page.evaluate(()=>document.fonts.ready)
  const sourceCount=await page.locator('[data-fastppt-geometry]').count()
  const path=`http://127.0.0.1:4318/@fs${root}packages/slidewave/src/slidev/capture.ts`
  const slide=await page.evaluate(async path=>{
    const {captureHtmlSlide}=await import(path) as {captureHtmlSlide:(node:HTMLElement,options:{snapshotVersion:number})=>Promise<HtmlSlideSnapshot>}
    return captureHtmlSlide(document.querySelector<HTMLElement>('main > div')!,{snapshotVersion:2})
  },path)
  expect(sourceCount).toBe(35)
  expect(slide.elements.filter(element=>element.kind==='shape'&&element.shape==='freeform')).toHaveLength(sourceCount)
  expect(slide.elements.some(element=>element.kind==='text')).toBe(true)
  const snapshot=HtmlDeckSnapshotSchema.parse({version:2,source:'slidev',slides:[slide],warnings:[]})
  const result=await writeEditablePptx(snapshot,'/tmp/fastppt-native-library.pptx',{embedFonts:false,policy:'strict-editable'})
  expect(result.qa.ok).toBe(true)
  const zip=await JSZip.loadAsync(await readFile('/tmp/fastppt-native-library.pptx'))
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
  expect(xml.match(/<a:custGeom>/g)).toHaveLength(sourceCount)
  expect(xml).not.toContain('<p:pic>')
  await page.locator('main').screenshot({path:'/tmp/fastppt-native-library-capture.png'})
})
