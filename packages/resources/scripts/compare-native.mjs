#!/usr/bin/env node
/* global document, Image */
/** Browser pixel comparison of archived HTML and native replacements. No alignment,
 * resampling, or screenshot assets are written into the reference library. */
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {resolve,join,extname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url))),args=process.argv.slice(2)
const valueOptions=new Set(['--baseline','--review','--id','--limit','--output','--reuse']),flagOptions=new Set(['--help','--checkpoint','--allow-incomplete','--save-samples'])
if(args.includes('--help')){console.log(`Usage: node packages/resources/scripts/compare-native.mjs [options]
  --baseline DIR       Archived original repository root (default /tmp/native-html-baseline)
  --review DIR         Temporary review/progress directory (default /tmp/native-visual-review)
  --reuse FILE         Reuse successful records only when both page hashes and viewport match
  --checkpoint         Compare only completed, hash-verified JSONL checkpoint pages
  --allow-incomplete   Permit samples without the final conversion report
  --id ID              Compare one page
  --limit COUNT        Limit selected pages
  --output FILE        Report path (samples/checkpoints default to the review directory)
  --save-samples       Save before/after PNGs in the temporary review directory; requires --id or --limit <=12
  --help               Print usage without starting a browser
Full runs require the complete conversion report. Exit is nonzero on errors or pixel anomalies.`);process.exit(0)}
for(let i=0;i<args.length;i++){if(valueOptions.has(args[i])){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing value for ${args[i]}`);i++}else if(!flagOptions.has(args[i]))throw new Error(`Unknown option: ${args[i]}`)}
const option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]}
if(args.includes('--save-samples')&&!option('--id','')&&!(Number(option('--limit',Infinity))<=12))throw new Error('--save-samples requires --id or --limit <=12')
const baseline=resolve(option('--baseline','/tmp/native-html-baseline')),review=resolve(option('--review','/tmp/native-visual-review'))
if(args.includes('--save-samples')&&!review.startsWith('/tmp/'))throw new Error('--save-samples requires a review directory under /tmp')
const req=createRequire(join(root,'tests/e2e/package.json')),{chromium}=req('@playwright/test')
const sharpPath=(await readdir(join(root,'node_modules/.pnpm'))).find(n=>/^sharp@/.test(n))
if(!sharpPath)throw new Error('PNG decoder sharp is unavailable')
const sharp=req(join(root,'node_modules/.pnpm',sharpPath,'node_modules/sharp'))
const packs=['resources','animations/reference'],entries=[]
for(const pack of packs){const index=JSON.parse(await readFile(join(baseline,'packages',pack,'index.json'),'utf8'));entries.push(...index.entries.map(e=>({...e,pack})))}
let selected=entries.filter(e=>!option('--id','')||e.id===option('--id','')).slice(0,Number(option('--limit',Infinity)))
if(!selected.length)throw new Error('No pages selected')
let conversionPages
if(args.includes('--checkpoint')){
 conversionPages=new Map()
 for(const line of (await readFile(join(root,'packages/resources/native-html-report.json.jsonl'),'utf8')).split('\n')){try{const row=JSON.parse(line);conversionPages.set(row.page,row)}catch{ /* In-progress final line is never eligible. */ }}
 const completed=[]
 for(const entry of selected){const row=conversionPages.get(`packages/${entry.pack}/${entry.file}`);if(!row||row.preservedOutsideSvg!==true)continue
  const [before,after]=await Promise.all([readFile(join(baseline,'packages',entry.pack,entry.file)),readFile(join(root,'packages',entry.pack,entry.file))])
  if(createHash('sha256').update(before).digest('hex')===row.beforeHash&&createHash('sha256').update(after).digest('hex')===row.afterHash)completed.push(entry)
 }
 selected=completed
}else if(!args.includes('--allow-incomplete')){
 const ready=JSON.parse(await readFile(join(root,'packages/resources/native-html-report.json'),'utf8'))
 conversionPages=new Map((ready.pages??[]).map(row=>[row.page,row]))
 if(conversionPages.size!==entries.length||ready.pages.length!==entries.length)throw new Error('Native conversion report is incomplete or contains duplicate pages')
 for(const entry of entries)if(!conversionPages.has(`packages/${entry.pack}/${entry.file}`))throw new Error(`Native conversion report omits ${entry.id}`)
}
await mkdir(review,{recursive:true})
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff'}
const server=createServer(async(request,response)=>{
 try{
  const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname),match=path.match(/^\/(old|new)\/(resources|animations\/reference)\/(.*)$/)
  if(!match){response.writeHead(404);response.end();return}
  const[,version,pack,tail]=match,base=version==='old'?baseline:root
  if(tail.startsWith('pages/')&&tail.endsWith('.md')){
   const target=resolve(base,'packages',pack,tail)
   if(!target.startsWith(resolve(base,'packages',pack)+sep))throw new Error('Unsafe page path')
   const markdown=await readFile(target,'utf8'),entry=entries.find(e=>e.pack===pack&&e.file===tail)
   if(!entry)throw new Error('Unknown page')
   const body=markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'')
   response.setHeader('content-type','text/html; charset=utf-8')
   response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:#eef1f4}main{position:relative;width:min(100vw,${entry.aspect*100}vh);height:min(100vh,${100/entry.aspect}vw)}</style><main>${body}</main></html>`)
  }else{
   // Assets are unchanged by conversion; both versions load identical local files.
   const target=resolve(root,'packages',pack,tail)
   if(!target.startsWith(resolve(root,'packages',pack)+sep))throw new Error('Unsafe asset path')
   await readFile(target).then(()=>{})
   response.setHeader('content-type',mime[extname(target)]??'application/octet-stream');createReadStream(target).pipe(response)
  }
 }catch(error){response.writeHead(404);response.end(String(error))}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
const launchBrowser=()=>chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']}),records=[];let cursor=0,saved=0
const hash=value=>createHash('sha256').update(value).digest('hex')
const reused=new Map()
if(option('--reuse','')){const prior=JSON.parse(await readFile(resolve(option('--reuse','')),'utf8'));for(const record of Array.isArray(prior)?prior:prior.records??[])reused.set(`${record.pack}/${record.id}`,record)}
try{await Promise.all(Array.from({length:2},async()=>{
 let browser=await launchBrowser(),page,rendered=0,browserRendered=0;const loading=[]
 const freshPage=async()=>{
  if(page)await page.close().catch(()=>{})
  if(!browser.isConnected()||browserRendered>=100){await browser.close().catch(()=>{});browser=await launchBrowser();browserRendered=0}
  try{page=await browser.newPage({deviceScaleFactor:1})}catch{await browser.close().catch(()=>{});browser=await launchBrowser();browserRendered=0;page=await browser.newPage({deviceScaleFactor:1})}
  rendered=0
  page.on('pageerror',error=>loading.push(String(error)))
  page.on('response',response=>{if(response.status()>=400)loading.push(`${response.status()} ${response.url()}`)})
  page.on('requestfailed',request=>loading.push(`${request.failure()?.errorText} ${request.url()}`))
 }
 await freshPage()
 try{while(cursor<selected.length){const entry=selected[cursor++],errors=[];let oldImage,newImage
  const record={id:entry.id,pack:entry.pack,width:960,height:Math.round(960/entry.aspect)}
  try{
   const before=await readFile(join(baseline,'packages',entry.pack,entry.file)),after=await readFile(join(root,'packages',entry.pack,entry.file))
   record.beforeMarkdownSha256=hash(before);record.afterMarkdownSha256=hash(after)
   const converted=conversionPages?.get(`packages/${entry.pack}/${entry.file}`)
   if(converted&&(converted.beforeHash!==record.beforeMarkdownSha256||converted.afterHash!==record.afterMarkdownSha256||converted.preservedOutsideSvg!==true))throw new Error('Page hashes or preservedOutsideSvg do not match the completed conversion report')
   const previous=reused.get(`${entry.pack}/${entry.id}`)
   if(previous&&previous.beforeMarkdownSha256===record.beforeMarkdownSha256&&previous.afterMarkdownSha256===record.afterMarkdownSha256&&previous.width===record.width&&previous.height===record.height&&Number.isFinite(previous.mae)&&Number.isFinite(previous.highDifferencePixelRatio)&&previous.loadingErrors?.length===0){records.push(previous);continue}
   // Retire contexts regularly so detached SVG/image resources cannot accumulate
   // across thousands of heavy source pages. A failed page never poisons a worker.
   if(rendered>=20)await freshPage()
   rendered++;browserRendered++
   await page.setViewportSize({width:record.width,height:record.height})
   for(const version of ['old','new']){
    loading.length=0;await page.goto(`${base}/${version}/${entry.pack}/${entry.file}`,{waitUntil:'load',timeout:60000})
    const missingImages=await page.evaluate(async()=>{
     await document.fonts.ready
     const sources=[...new Set([...document.querySelectorAll('img,svg image')].map(n=>n.getAttribute('src')||n.getAttribute('href')||n.getAttributeNS('http://www.w3.org/1999/xlink','href')).filter(Boolean))],missing=[]
     for(let i=0;i<sources.length;i+=4)await Promise.all(sources.slice(i,i+4).map(source=>new Promise(done=>{
      const image=new Image(),timer=setTimeout(()=>{missing.push(source);done()},15000)
      image.onload=()=>{clearTimeout(timer);if(!image.naturalWidth)missing.push(source);done()}
      image.onerror=()=>{clearTimeout(timer);missing.push(source);done()};image.src=new URL(source,document.baseURI).href
     })))
     return missing
    })
    if(missingImages.length)loading.push(...missingImages.map(s=>'image: '+s))
    if(version==='old')oldImage=await page.screenshot({type:'png'});else newImage=await page.screenshot({type:'png'})
    errors.push(...loading.map(error=>({version,error})))
   }
   const [a,b]=await Promise.all([sharp(oldImage).removeAlpha().raw().toBuffer({resolveWithObject:true}),sharp(newImage).removeAlpha().raw().toBuffer({resolveWithObject:true})])
   if(a.info.width!==b.info.width||a.info.height!==b.info.height||a.data.length!==b.data.length)throw new Error('Screenshot dimensions differ; comparison cannot align or rescale')
   let total=0,high=0;for(let i=0;i<a.data.length;i+=3){let max=0;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-b.data[i+c]);total+=d;max=Math.max(max,d)}if(max>32)high++}
   record.mae=total/a.data.length/255;record.highDifferencePixelRatio=high/(a.info.width*a.info.height)
   record.anomaly=record.mae>.02||record.highDifferencePixelRatio>.05
   if((record.anomaly||args.includes('--save-samples'))&&saved<12){saved++;const prefix=join(review,entry.id);await Promise.all([writeFile(prefix+'-before.png',oldImage),writeFile(prefix+'-after.png',newImage)]);record.reviewFiles=[prefix+'-before.png',prefix+'-after.png']}
  }catch(error){errors.push({error:String(error)});await freshPage()}
  record.loadingErrors=errors;records.push(record)
  if(records.length%100===0){console.log(`${records.length}/${selected.length} compared`);await writeFile(join(review,'progress.json'),JSON.stringify(records))}
 }}finally{await browser.close()}
}))}finally{await new Promise(r=>server.close(r))}
records.sort((a,b)=>a.pack.localeCompare(b.pack)||a.id.localeCompare(b.id))
const report={version:1,baselineCommit:'2c0f5b8d8f6f67ca46fa31a8b7d20f38ccd290d2',pages:records.length,expectedPages:entries.length,workers:2,viewportWidth:960,thresholds:{mae:.02,highDifferencePixelRatio:.05,highDifferenceChannelDelta:32},anomalies:records.filter(r=>r.anomaly).length,loadingErrors:records.filter(r=>r.loadingErrors.length).length,scope:'Automated page-by-page browser pixel comparison with identical local assets and aspect ratios. No image alignment or scaling. Visual review covers samples and flagged pages only.',records}
const output=resolve(option('--output',args.includes('--checkpoint')||args.includes('--allow-incomplete')||selected.length!==entries.length?join(review,'sample-audit.json'):join(root,'packages/resources/native-visual-audit.json')))
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log({pages:report.pages,anomalies:report.anomalies,loadingErrors:report.loadingErrors,output})
if(report.loadingErrors||report.anomalies)process.exitCode=1
