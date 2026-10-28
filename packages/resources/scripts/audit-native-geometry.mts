import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join,resolve } from 'node:path'
import { parseNativeGeometry } from '../../slidewave/src/primitives/native-geometry.js'
import { parseCssColor } from '../../slidewave/src/slidev/css.js'
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const records:unknown[]=[],errors:unknown[]=[];let shapes=0,points=0
for(const pack of ['resources','animations/reference']){
  const library=join(root,'packages',pack),index=JSON.parse(await readFile(join(library,'index.json'),'utf8')) as {entries:Array<{id:string;file:string}>}
  for(const entry of index.entries){
    const markdown=await readFile(join(library,entry.file),'utf8');let count=0
    for(const match of markdown.matchAll(/data-fastppt-geometry="([^"]*)"/g)){
      try{
        const geometry=parseNativeGeometry(match[1]!.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&'))
        if(geometry.fill!=='none'&&!parseCssColor(geometry.fill)||geometry.stroke!=='none'&&!parseCssColor(geometry.stroke))throw new Error('Invalid geometry paint color')
        count++;shapes++;points+=geometry.paths.reduce((sum,path)=>sum+path.points.length,0)
      }catch(error){errors.push({id:entry.id,object:count,error:String(error)})}
    }
    records.push({id:entry.id,pack,geometryShapes:count,markdownSha256:createHash('sha256').update(markdown).digest('hex')})
  }
}
await writeFile(join(root,'packages/resources/native-geometry-audit.json'),JSON.stringify({version:1,pages:records.length,shapes,points,errors:errors.length,scope:'Native geometry metadata bounds, paint colors and point budgets; browser and export delivery are checked separately.',records,details:errors},null,2)+'\n')
console.log({pages:records.length,shapes,points,errors:errors.length});if(errors.length)process.exitCode=1
