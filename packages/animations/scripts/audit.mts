import{readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{AnimationLibrary}from'../src/index.js'
import{nativeMotionFrame}from'../../slidewave/src/primitives/native-motion.mjs'
import{nativeEffectXml}from'../../slidewave/src/server/native-animation.js'
const library=new AnimationLibrary(),records:unknown[]=[],errors:unknown[]=[],warnings:Record<string,number>={};let effects=0
for(const entry of await library.entries()){
 const value=(await library.read(entry.id))!
 for(const warning of entry.warnings)warnings[warning]=(warnings[warning]??0)+1
 for(const effect of value.motion.groups.flatMap(g=>g.effects)){
  effects++
  try{let id=100000;nativeEffectXml(String(effect.params.nativeXml),'999',()=>id++);for(const t of Array.from({length:61},(_,i)=>i/60))nativeMotionFrame(effect,{x:.5,y:.5,width:.3,height:.25,canvasWidth:960,canvasHeight:540},t)}catch(error){errors.push({id:entry.id,effect:effect.id,error:String(error)})}
 }
 records.push({id:entry.id,revision:entry.revision,sourceSha256:createHash('sha256').update(await readFile(await library.filePath(entry.motionFile))).digest('hex')})
}
const audit={version:1,sourceIndexSha256:createHash('sha256').update(await readFile(new URL('../index.json',import.meta.url))).digest('hex'),references:records.length,effects,formulaSampleProgress:Array.from({length:61},(_,i)=>i/60),errors:errors.length,previewAdaptationCounts:warnings,records,details:errors}
await writeFile(new URL('../audit.json',import.meta.url),JSON.stringify(audit,null,2)+'\n');await writeFile(new URL('../browser-compatibility.json',import.meta.url),JSON.stringify({sourceIndexSha256:audit.sourceIndexSha256,effects,errors:errors.length,records:errors},null,2)+'\n');console.log({references:audit.references,effects,errors:errors.length});if(errors.length)process.exitCode=1
