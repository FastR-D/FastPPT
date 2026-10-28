/* global document, requestAnimationFrame, getComputedStyle */
import{createRequire}from'node:module'
import{readFile,writeFile,mkdir}from'node:fs/promises'
import{fileURLToPath}from'node:url'
import{createHash}from'node:crypto'
const root=fileURLToPath(new URL('../',import.meta.url)),index=JSON.parse(await readFile(root+'index.json','utf8')),entries=index.entries.filter(e=>e.origin==='creative-library'),out=root+'validation/'
await mkdir(out,{recursive:true})
const{chromium}=createRequire(new URL('../../../tests/e2e/package.json',import.meta.url))('@playwright/test')
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}),records=[];let cursor=0
try{await Promise.all(Array.from({length:2},async()=>{
 const page=await browser.newPage({viewport:{width:960,height:600}})
 try{await page.goto('http://127.0.0.1:4317/health');while(cursor<entries.length){const entry=entries[cursor++];const errors=[];const listener=error=>errors.push(error.message);page.on('pageerror',listener)
  try{
   await page.setContent(`<iframe sandbox="allow-scripts" title="creative-audit" style="position:fixed;inset:0;width:960px;height:600px;border:0" src="http://127.0.0.1:4317/api/v1/animations/preview/${entry.id}"></iframe>`)
   const frame=page.frameLocator('iframe'),slider=frame.locator('input[type="range"]')
   await frame.locator('main[data-motion-ready="true"]').waitFor({timeout:15000})
   await slider.waitFor({timeout:15000})
   await frame.locator('[data-fastppt-motion]').evaluate(async()=>{await document.fonts.ready})
   await page.waitForFunction(()=>{const f=document.querySelector('iframe');return f?.contentWindow!==null})
   await slider.evaluate(input=>{input.value=String(Number(input.max)*.5);input.dispatchEvent(new Event('input',{bubbles:true}))})
   // Module initialization is observable through a created Web Animation.
   await frame.locator('[data-fastppt-group]').first().evaluate(async el=>{for(let i=0;i<60&&!el.getAnimations().length;i++)await new Promise(requestAnimationFrame)})
   const measured=await frame.locator('main').evaluate(main=>({status:document.querySelector('#status').textContent,objects:main.querySelectorAll('[data-fastppt-group]').length,svgElements:main.querySelectorAll('svg').length,animated:[...main.querySelectorAll('[data-fastppt-group]')].filter(el=>el.getAnimations().length>0).length,invalid:[...main.querySelectorAll('[data-fastppt-group]')].filter(el=>/NaN|Infinity/.test(getComputedStyle(el).transform)).length}))
   const error=errors.length||measured.status||measured.invalid||measured.objects!==entry.targets.length?JSON.stringify({errors,...measured}):undefined
   records.push({id:entry.id,...measured,...(error?{error}:{})})
   if(process.argv.includes('--save-screenshots')&&(cursor<=10||entry.category==='路径运动'||entry.category==='文字创意'))await page.screenshot({path:out+entry.id+'.jpg',type:'jpeg',quality:80})
  }catch(error){records.push({id:entry.id,error:String(error)})}finally{page.off('pageerror',listener)}
  if(records.length%50===0)console.log(`${records.length}/${entries.length} creative demos checked`)
 }}finally{await page.close()}
}))}finally{await browser.close()}
const report={version:1,sourceIndexSha256:createHash('sha256').update(await readFile(root+'index.json')).digest('hex'),pages:records.length,errors:records.filter(r=>r.error).length,scope:'Actual opaque-sandbox browser render and mid-timeline seek of every dedicated creative-motion reference; not a claim of PowerPoint visual parity.',records}
await writeFile(out+'browser-audit.json',JSON.stringify(report,null,2)+'\n');console.log({pages:report.pages,errors:report.errors});if(report.errors)process.exitCode=1
