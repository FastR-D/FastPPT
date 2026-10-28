#!/usr/bin/env node
/** Full live DOM audit of layouts and archived motion-reference pages; no screenshots. */
import { spawn } from 'node:child_process'
import { readFile,writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve,join } from 'node:path'
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
for(const pack of ['resources','animations/reference']){
  const library=join(root,'packages',pack)
  const status=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,['--experimental-strip-types',join(root,'packages/resources/scripts/compare-visuals.mjs'),'--library-root',library,'--workers','1'],{stdio:'inherit'})
    child.once('error',reject);child.once('exit',done)
  })
  if(status!==0)throw new Error(`DOM audit process failed for ${pack}: ${status}`)
  const report=JSON.parse(await readFile(join(library,'visual-comparison/live-dom-audit.json'),'utf8'))
  const results=report.records.map(({id,markdownSha256,textOverflow,textOutsidePage,missingImages,error})=>({id,markdownSha256,textOverflow,textOutsidePage,missingImages,...(error?{error}:{})}))
  const audit={version:1,sourceIndexSha256:report.sourceIndexSha256,pages:results.length,mode:'native-html-live-dom-without-screenshots',errors:results.filter(r=>r.error).length,pagesWithMissingImages:results.filter(r=>r.missingImages).length,pagesWithTextOverflow:results.filter(r=>r.textOverflow).length,pagesWithTextOutsidePage:results.filter(r=>r.textOutsidePage).length,results}
  await writeFile(join(library,'render-audit.json'),JSON.stringify(audit,null,2)+'\n')
  console.log(pack,JSON.stringify({...audit,results:undefined}))
  if(audit.errors||audit.pagesWithMissingImages||audit.pagesWithTextOverflow||audit.pagesWithTextOutsidePage)process.exitCode=1
}
