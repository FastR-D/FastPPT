import {test,expect} from '@playwright/test'
import {readFile,writeFile}from'node:fs/promises'
import {fileURLToPath}from'node:url'
import JSZip from 'jszip'
import {writeEditablePptx}from'@fastppt/slidewave/server'
import {HtmlDeckSnapshotSchema}from'@fastppt/slidewave/snapshot'
import {validateSlideAnimationXml}from'@fastppt/slidewave/xml'
import {CreativeAnimationDetailSchema}from'@fastppt/protocol'
import type{AnimationDocumentV1}from'@fastppt/protocol'
import type{HtmlSlideSnapshot}from'@fastppt/slidewave/snapshot'
const root=fileURLToPath(new URL('../../../',import.meta.url))
test('searches creative effects and scrubs executable motion in an opaque sandbox',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('tab',{name:'动画',exact:true}).click()
 await expect(page.getByRole('heading',{name:'创意动效工作台'})).toBeVisible()
 const card=page.locator('[data-animation-id="c9f1632d31e4-0006"]');await card.getByRole('button',{name:'应用此效果',exact:true}).click()
 const frame=page.frameLocator('iframe[title="柔性伸展-上 / 柔性伸展-下 动效演示"]');await expect(frame.locator('main')).toHaveAttribute('data-motion-playing','true')
 const seek=frame.getByRole('slider',{name:'动画进度'});await seek.evaluate(el=>{const input=el as HTMLInputElement;input.value='500';input.dispatchEvent(new Event('input',{bubbles:true}))})
 await expect(frame.locator('#status')).toBeEmpty();await expect.poll(()=>frame.locator('[data-fastppt-group="s3"]').evaluate(el=>getComputedStyle(el).transform)).not.toBe('none')
 await page.screenshot({path:'/tmp/fastppt-creative-animations.png'});const cycles=Number(await frame.locator('main').getAttribute('data-motion-cycles'));await frame.getByRole('button',{name:'播放',exact:true}).click();await expect.poll(async()=>Number(await frame.locator('main').getAttribute('data-motion-cycles'))).toBeGreaterThan(cycles);expect(errors).toEqual([])
})
test('exports captured creative objects as native animated groups with original formulas',async({page})=>{
 const response=await page.request.get('http://127.0.0.1:4317/api/v1/animations/c9f1632d31e4-0006');const value=CreativeAnimationDetailSchema.parse(await response.json())
 const body=String(value.markdown).replace(/^---\n[\s\S]*?\n---\n/,'')
 await page.goto('/');await page.setContent(`<style>body{margin:0}#creative-root{position:relative;width:960px;height:540px;font:20px Arial}</style><div id="creative-root">${body}</div>`)
 const path=`http://127.0.0.1:4318/@fs${root}packages/slidewave/src/slidev/capture.ts`
 const slide=await page.evaluate(async path=>{const{captureHtmlSlide}=await import(path) as {captureHtmlSlide:(el:HTMLElement,opts:{snapshotVersion:number})=>Promise<HtmlSlideSnapshot>};return captureHtmlSlide(document.querySelector<HTMLElement>('#creative-root')!,{snapshotVersion:2})},path)
 const snapshot=HtmlDeckSnapshotSchema.parse({version:2,source:'slidev',slides:[slide],warnings:[]})
 const effects=value.motion.groups.flatMap(group=>group.effects).map(effect=>{
   const {nativeXml,sourceDurationMs}=effect.params
   if(effect.kind!=='native'||typeof nativeXml!=='string'||typeof sourceDurationMs!=='number')throw new Error('Expected native animation metadata')
   return{slide:1,target:effect.target,kind:effect.kind,nativeXml,nativeDurationMs:sourceDurationMs,durationMs:effect.durationMs,delayMs:effect.delayMs,trigger:effect.trigger}
 })
 const output='/tmp/fastppt-creative-native.pptx',result=await writeEditablePptx(snapshot,output,{embedFonts:false,policy:'editable',objectAnimations:effects})
 expect(result.qa.ok).toBe(true)
 const zip=await JSZip.loadAsync(await readFile(output)),xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
 expect(validateSlideAnimationXml(xml)).toEqual([]);expect(xml).toContain('presetID="17"');expect(xml).toContain('#ppt_h');expect(xml).toContain('<p:grpSp>');expect(xml).toContain('<p:iterate');expect(xml).not.toContain('spid="3"')
 await writeFile('/tmp/fastppt-creative-native-slide.xml',xml);await page.locator('#creative-root').screenshot({path:'/tmp/fastppt-creative-slidewave-base.png'})
})

test('plays imported metadata inside the actual Slidev runtime and restores geometry for capture',async({page})=>{
 const {SlidevHost}=await import('@fastppt/slidev-host')
 const {mkdir}=await import('node:fs/promises')
 const directory=root+'.fastppt/creative-motion-qa';await mkdir(directory,{recursive:true})
 const md=(await readFile(root+'packages/animations/pages/c9f1632d31e4-0006.md','utf8')).replace('layout: none','theme: slidev-theme-academy\nlayout: none')
 await writeFile(directory+'/slides.md',md)
 const logs:string[]=[],host=new SlidevHost({readyTimeoutMs:60000,onLog:e=>logs.push(e.message)})
 try{
  const state=await host.start({deckId:'creative-runtime',entryFile:directory+'/slides.md',themePackageRoot:root+'themes/slidev-theme-academy'})
  expect(state.status,logs.slice(-10).join('\n')).toBe('ready')
  const port=state.port!;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/api/v1/preview/p${port}/1?embedded=true`)
  await expect(page.locator('[data-fastppt-group="s3"]').first()).toBeVisible()
  await expect.poll(()=>page.locator('[data-fastppt-group="s3"]').first().evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0)
  await page.screenshot({path:'/tmp/fastppt-creative-slidev-runtime.png'})
  await page.evaluate(()=>{
    const motion=JSON.parse(document.querySelector('[data-fastppt-motion]')!.getAttribute('data-fastppt-motion')!) as AnimationDocumentV1
    const effect=motion.groups[0]!.effects[0]!
    window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:location.origin,data:{target:'fastppt-preview',type:'fastppt.slidewave.animation.preview',version:1,slide:1,effect,elapsedMs:500}}))
  })
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:location.origin,data:{target:'fastppt-preview',type:'fastppt.slidewave.animation.preview',version:1,slide:1,effect:{id:'mixed-basic',target:'s3',kind:'entrance_fade',durationMs:400},elapsedMs:200}})))
  await expect.poll(()=>page.locator('[data-fastppt-group="s3"]').first().evaluate(el=>el.getAnimations().map(animation=>animation.constructor.name))).toEqual(['CSSAnimation'])
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:location.origin,data:{target:'fastppt-preview',type:'fastppt.slidewave.animation.preview',version:1,reset:true}})))
  await expect.poll(()=>page.locator('[data-fastppt-group="s3"]').first().evaluate(el=>el.getAnimations().length)).toBe(0)
  expect(errors).toEqual([])
 }finally{await host.close()}
})
