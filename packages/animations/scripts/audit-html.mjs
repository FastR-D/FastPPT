/* global document, getComputedStyle */
import{createRequire}from'node:module'
import{readFile,writeFile}from'node:fs/promises'
import{fileURLToPath}from'node:url'
import{createHash}from'node:crypto'
const root=fileURLToPath(new URL('../',import.meta.url)),raw=await readFile(root+'index.json','utf8'),{entries}=JSON.parse(raw)
const{chromium}=createRequire(new URL('../../../tests/e2e/package.json',import.meta.url))('@playwright/test')
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}),records=[]
try{const page=await browser.newPage({viewport:{width:960,height:540}})
for(const entry of entries){
 const md=await readFile(root+entry.file,'utf8')
 await page.setContent('<html><body style="margin:0">'+md.slice(md.indexOf('<div'))+'</body></html>')
 const result=await page.evaluate(()=>{
  const stage=document.body.firstElementChild.getBoundingClientRect(),objects=[...document.querySelectorAll('[data-fastppt-group]')]
  const outside=objects.filter(o=>{const b=o.getBoundingClientRect();return b.left<stage.left-.5||b.top<stage.top-.5||b.right>stage.right+.5||b.bottom>stage.bottom+.5}).map(o=>o.getAttribute('data-fastppt-group'))
  const contentOverflow=objects.filter(o=>{const b=o.getBoundingClientRect();return [...o.querySelectorAll('h2,p,figure,figcaption')].some(c=>{const r=c.getBoundingClientRect();return r.right>b.right+1||r.bottom>b.bottom+1})}).map(o=>o.getAttribute('data-fastppt-group'))
  return{htmlObjects:objects.length,svgElements:document.querySelectorAll('svg').length,targets:objects.map(o=>o.getAttribute('data-fastppt-group')),outside,contentOverflow}
 })
 const missing=entry.targets.filter(t=>!result.targets.includes(t));records.push({id:entry.id,...result,missingTargets:missing})
 if(records.length%200===0)console.log(`${records.length}/${entries.length} HTML demos checked`)
}}finally{await browser.close()}
const errors=records.filter(r=>r.missingTargets.length||r.outside.length||r.contentOverflow.length||r.svgElements).length
await writeFile(root+'validation/html-audit.json',JSON.stringify({version:1,sourceIndexSha256:createHash('sha256').update(raw).digest('hex'),pages:records.length,errors,scope:'Base HTML geometry and content at 960×540 before animation; native paths can intentionally leave stage.',records},null,2)+'\n')
console.log({pages:records.length,errors});if(errors)process.exitCode=1
