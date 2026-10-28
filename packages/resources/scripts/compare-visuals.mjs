#!/usr/bin/env node
/* global document, Image, getComputedStyle, DOMMatrix, DOMPoint */
/** Render every actual Slidev resource HTML at reference size and measure content
 * bounds. Images are compared independently by compare-images.py; no metric here
 * silently upgrades a page into manual visual acceptance. */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile,writeFile,mkdir,rename } from 'node:fs/promises'
import { join,dirname,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { ResourceLibrary } from '../src/index.ts'
const packageRoot=join(dirname(fileURLToPath(import.meta.url)),'..'), root=join(packageRoot,'../..')
const args=process.argv.slice(2), val=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1]}
const lib=val('--library-root')?resolve(val('--library-root')):packageRoot
const saveScreenshots=args.includes('--save-screenshots')
const only=val('--source-id'), limit=Number(val('--limit')??Infinity), repair=args.includes('--repair')
const idsFile=val('--ids-file'), selectedIds=idsFile?new Set(JSON.parse(await readFile(idsFile,'utf8'))):undefined
const index=JSON.parse(await readFile(join(lib,'index.json'),'utf8'))
const entries=index.entries.filter(e=>(!only||e.id.startsWith(only+'-'))&&(!selectedIds||selectedIds.has(e.id))).slice(0,limit)
const library=new ResourceLibrary(lib), out=join(lib,'visual-comparison')
await mkdir(out,{recursive:true})
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname.startsWith('/preview/')){res.setHeader('content-type','text/html');res.end(await library.preview(url.pathname.split('/').at(-1)))}
  else if(url.pathname.startsWith('/assets/')){const path=await library.filePath(url.pathname.slice(1));res.setHeader('content-type',path.endsWith('.woff2')?'font/woff2':path.endsWith('.svg')?'image/svg+xml':'image/'+(path.endsWith('.jpg')?'jpeg':path.split('.').at(-1)));createReadStream(path).pipe(res)}
  else{res.statusCode=404;res.end()}
 }catch(error){res.statusCode=500;res.end(String(error))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`
const {chromium}=createRequire(join(root,'tests/e2e/package.json'))('@playwright/test')
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']})
let cursor=0;const records=[]
try{
 await Promise.all(Array.from({length:Math.max(1,Math.min(4,Number(val('--workers')??2)))},async()=>{
  let page=await browser.newPage({viewport:{width:960,height:540}}), visited=0
  try{
   while(cursor<entries.length){
    if(visited++&&visited%20===0){await page.close();page=await browser.newPage({viewport:{width:960,height:540}})}
    const entry=entries[cursor++];const pagePath=join(lib,entry.file)
    try{
     await page.setViewportSize({width:960,height:Math.round(960/entry.aspect)})
     await page.goto(`${base}/preview/${entry.id}`,{waitUntil:'load',timeout:30000})
     await page.evaluate(()=>document.fonts.ready)
     const result=await page.evaluate(async repair=>{
      const root=document.querySelector('main>div'), bounds=root.getBoundingClientRect()
      const blocks=[...document.querySelectorAll('[data-resource-text]')]
      const imageSources=[...new Set([...document.querySelectorAll('svg image')].map(node=>node.getAttribute('href')||node.getAttributeNS('http://www.w3.org/1999/xlink','href')).filter(Boolean))]
      const svgImages=[]
      // Check load events in small batches. Hundreds of simultaneous decode()
      // calls can reject valid loaded pictures under decoder memory pressure.
      for(let start=0;start<imageSources.length;start+=4){
       svgImages.push(...await Promise.all(imageSources.slice(start,start+4).map(source=>new Promise(resolve=>{
        const image=new Image(),timer=setTimeout(()=>resolve(source),10000)
        image.onload=()=>{clearTimeout(timer);resolve(image.naturalWidth?null:source)}
        image.onerror=()=>{clearTimeout(timer);resolve(source)}
        image.src=new URL(source,document.baseURI).href
       }))))
      }
      const adjustments=[]
      if(repair)for(const block of blocks){
       const ref=Number(block.dataset.referenceWidth)*bounds.width
       const rect=block.getBoundingClientRect(), style=getComputedStyle(block), fs=parseFloat(style.fontSize)
       const count=[...block.textContent].length
       if(ref>0&&rect.width>0&&count>1&&Math.abs(ref-rect.width)>.7){
        const delta=(ref-rect.width)/(count-1)
        if(style.transform==='none'&&Math.abs(delta)<=fs*.5){block.style.letterSpacing=`${((parseFloat(style.letterSpacing)||0)+delta)/bounds.width*100}cqw`;adjustments.push({anchor:block.dataset.fastpptGroup,kind:'reference-letter-spacing',from:rect.width,to:ref,delta})}
       }
      }
      const inkContext=document.createElement('canvas').getContext('2d')
      const inkBounds=block=>{
       const cs=getComputedStyle(block),fs=parseFloat(cs.fontSize),lh=parseFloat(cs.lineHeight)||fs
       inkContext.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
       if('letterSpacing' in inkContext)inkContext.letterSpacing=cs.letterSpacing==='normal'?'0px':cs.letterSpacing
       const metrics=inkContext.measureText(block.textContent)
       const baseline=(lh-metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2+metrics.fontBoundingBoxAscent
       const left=-metrics.actualBoundingBoxLeft,right=metrics.actualBoundingBoxRight
       const top=baseline-metrics.actualBoundingBoxAscent,bottom=baseline+metrics.actualBoundingBoxDescent
       const matrix=cs.transform==='none'?new DOMMatrix():new DOMMatrix(cs.transform)
       const [ox,oy]=cs.transformOrigin.split(' ').map(parseFloat)
       const x=bounds.left+parseFloat(cs.left),y=bounds.top+parseFloat(cs.top)
       const corners=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([px,py])=>{const p=new DOMPoint(px-ox,py-oy).matrixTransform(matrix);return{x:x+p.x+ox,y:y+p.y+oy}})
       return{left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))}
      }
      const measure=()=>{
       const overflow=[], outside=[], intentionalBleed=[]
       for(const block of blocks){
        const rect=block.dataset.referenceBox?inkBounds(block):block.getBoundingClientRect()
        const reference=block.dataset.referenceBox?.split(',').map(Number)
        if(reference?.length===4){
         const [x,y,w,h]=reference
         const expected={left:bounds.left+x*bounds.width,top:bounds.top+y*bounds.height,right:bounds.left+(x+w)*bounds.width,bottom:bounds.top+(y+h)*bounds.height}
         // Compare the visible intersection when the original intentionally
         // crops oversized lettering at the slide edge.
         const actualVisible={left:expected.left<bounds.left?Math.max(rect.left,bounds.left):rect.left,top:expected.top<bounds.top?Math.max(rect.top,bounds.top):rect.top,right:expected.right>bounds.right?Math.min(rect.right,bounds.right):rect.right,bottom:expected.bottom>bounds.bottom?Math.min(rect.bottom,bounds.bottom):rect.bottom}
         const expectedVisible={left:Math.max(expected.left,bounds.left),top:Math.max(expected.top,bounds.top),right:Math.min(expected.right,bounds.right),bottom:Math.min(expected.bottom,bounds.bottom)}
         if(actualVisible.left<expectedVisible.left-3||actualVisible.top<expectedVisible.top-3||actualVisible.right>expectedVisible.right+3||actualVisible.bottom>expectedVisible.bottom+3)overflow.push({anchor:block.dataset.fastpptGroup,text:block.textContent,actual:{left:rect.left-bounds.left,top:rect.top-bounds.top,right:rect.right-bounds.left,bottom:rect.bottom-bounds.top},expected,font:getComputedStyle(block).fontFamily})
        }else if(block.scrollHeight>block.clientHeight+3||block.scrollWidth>block.clientWidth+3)overflow.push(block.dataset.fastpptGroup)
        if(rect.left<bounds.left-2||rect.top<bounds.top-2||rect.right>bounds.right+2||rect.bottom>bounds.bottom+2){
         const item={anchor:block.dataset.fastpptGroup,text:block.textContent,box:[rect.left-bounds.left,rect.top-bounds.top,rect.right-rect.left,rect.bottom-rect.top]}
         // Large cropped section numerals intentionally bleed in the original.
         // Keep that design and report it separately from newly introduced spill.
         if(reference&&(reference[0]<0||reference[1]<0||reference[0]+reference[2]>1.002||reference[1]+reference[3]>1.002))intentionalBleed.push(item)
         else outside.push(item)
        }
       }
       return{overflow,outside,intentionalBleed}
      }
      let measured=measure()
      if(repair)for(const item of measured.overflow){
       if(typeof item==='string')continue
       const block=blocks.find(el=>el.dataset.fastpptGroup===item.anchor)
       let actual=inkBounds(block);const expected=item.expected
       const count=[...block.textContent].length,cs=getComputedStyle(block),fs=parseFloat(cs.fontSize)
       if(cs.transform==='none'&&count>1&&actual.right-actual.left>expected.right-expected.left+3){
        const delta=((expected.right-expected.left)-(actual.right-actual.left))/(count-1)
        if(Math.abs(delta)<=fs*.5){
         block.style.letterSpacing=`${((parseFloat(cs.letterSpacing)||0)+delta)/bounds.width*100}cqw`
         adjustments.push({anchor:item.anchor,kind:'reference-ink-spacing',delta});actual=inkBounds(block)
        }
       }
       let dx=0,dy=0
       if(actual.left<expected.left-3)dx=expected.left-actual.left
       if(actual.right>expected.right+3)dx=expected.right-actual.right
       if(actual.top<expected.top-3)dy=expected.top-actual.top
       if(actual.bottom>expected.bottom+3)dy=expected.bottom-actual.bottom
       // Correct substituted-font baselines/bearings within 1em. No clipping,
       // font shrinking or content removal is used to suppress a failed check.
       if(Math.abs(dx)<=fs&&Math.abs(dy)<=fs){
        block.style.left=`${parseFloat(block.style.left)+dx/bounds.width*100}%`
        block.style.top=`${parseFloat(block.style.top)+dy/bounds.height*100}%`
        adjustments.push({anchor:item.anchor,kind:'reference-ink-alignment',dx,dy})
       }
      }
      measured=measure()
      // Source lines are separate editable objects. Move a substituted-font line
      // back inside the page only when that requires <=2% of a page dimension.
      if(repair)for(const item of measured.outside){
       const block=blocks.find(el=>el.dataset.fastpptGroup===item.anchor)
       const rect=block.dataset.referenceBox?inkBounds(block):block.getBoundingClientRect();let dx=0,dy=0
       if(rect.left<bounds.left)dx=bounds.left-rect.left
       if(rect.right>bounds.right)dx=bounds.right-rect.right
       if(rect.top<bounds.top)dy=bounds.top-rect.top
       if(rect.bottom>bounds.bottom)dy=bounds.bottom-rect.bottom
       if(Math.abs(dx)<=bounds.width*.02&&Math.abs(dy)<=bounds.height*.02){
        block.style.left=`${(parseFloat(block.style.left)/100+dx/bounds.width)*100}%`;block.style.top=`${(parseFloat(block.style.top)/100+dy/bounds.height)*100}%`
        adjustments.push({anchor:item.anchor,kind:'page-boundary-repair',dx,dy})
       }
      }
      measured=measure()
      const serializer=root.outerHTML
      return{textBlocks:blocks.length,textOverflow:measured.overflow.length,overflowDetails:measured.overflow,textOutsidePage:measured.outside.length,outside:measured.outside,intentionalBleed:measured.intentionalBleed,missingImages:[...document.images].filter(image=>!image.complete||!image.naturalWidth).length+svgImages.filter(Boolean).length,missingImageDetails:svgImages.filter(Boolean),missingFonts:[...document.fonts].filter(font=>font.status==='error').length,adjustments,html:repair?serializer:undefined}
     },repair)
     const evidence=JSON.parse(await readFile(join(lib,'evidence',entry.id+'.json'),'utf8'))
     if(result.textBlocks<(evidence.reconstructedSlots?.length??0))throw new Error(`Missing HTML text: expected ${evidence.reconstructedSlots.length}, found ${result.textBlocks}`)
     if(result.missingFonts)throw new Error(`Failed to load ${result.missingFonts} source webfonts`)
     if(repair&&result.adjustments.length){
      const old=await readFile(pagePath,'utf8'), start=old.indexOf('<div'), end=old.lastIndexOf('</div>')+6
      const updated=old.slice(0,start)+result.html+old.slice(end)
      await writeFile(pagePath+'.tmp',updated);await rename(pagePath+'.tmp',pagePath)
     }
     if(saveScreenshots)await page.screenshot({path:join(out,entry.id+'.jpg'),type:'jpeg',quality:86})
     const {html,...qa}=result
     void html
     records.push({id:entry.id,source:entry.source,sourcePage:entry.sourcePage,markdownSha256:createHash('sha256').update(await readFile(pagePath)).digest('hex'),...qa,...(saveScreenshots?{replica:entry.id+'.jpg',original:`originals/${entry.id.split('-')[0]}/${String(entry.sourcePage).padStart(4,'0')}.jpg`}:{})})
    }catch(error){records.push({id:entry.id,error:String(error)});if(page.isClosed()){page=await browser.newPage({viewport:{width:960,height:540}})}}
    if(records.length%100===0){console.log(`${records.length}/${entries.length} pages visually rendered`);await writeFile(join(out,'browser-comparison-progress.json'),JSON.stringify(records)+'\n')}
   }
  }finally{await page.close()}
 }))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
records.sort((a,b)=>a.id.localeCompare(b.id))
const path=join(out,idsFile?'repair-browser-comparison.json':only?`${only}-browser-comparison.json`:saveScreenshots?'browser-comparison.json':'live-dom-audit.json')
await writeFile(path,JSON.stringify({version:1,sourceIndexSha256:createHash('sha256').update(await readFile(join(lib,'index.json'))).digest('hex'),records},null,2)+'\n')
console.log(JSON.stringify({pages:records.length,errors:records.filter(r=>r.error).length,textOverflow:records.filter(r=>r.textOverflow).length,textOutsidePage:records.filter(r=>r.textOutsidePage).length,missingImages:records.filter(r=>r.missingImages).length}))
