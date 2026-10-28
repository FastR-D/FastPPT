import { access, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnimationDocumentV1Schema } from '@fastppt/presentation-ir'
export interface AnimationDemoObject {
  target:string; slot:string; role:string; replaceWith:string; sourceShapeId:string; sourceName:string; sourceType:string; sourceText:string; bounds:Record<string,number>
}
export interface CreativeAnimation {
  id:string; title:string; category:string; scope:'object'|'multi-object'; source:string; sourcePage:number;
  file:string; motionFile:string; aspect:number; targets:string[]; effects:number; durationMs:number;
  warnings:string[]; useCases:string[]; origin:'creative-library'|'layout-motion'; tags:string[]; revision:string; objects?:AnimationDemoObject[]; objectRoles?:string[]; objectCount?:number
}
export async function resolveAnimationsRoot():Promise<string>{
  const here=dirname(fileURLToPath(import.meta.url)),candidates=process.env.FASTPPT_ANIMATIONS_ROOT?[resolve(process.env.FASTPPT_ANIMATIONS_ROOT)]:[resolve(here,'..'),resolve(here,'../animations'),resolve(here,'../../animations')]
  for(const root of candidates)try{await access(join(root,'index.json'));return root}catch{ /* next installed pack */ }
  throw new Error('Animation library unavailable; set FASTPPT_ANIMATIONS_ROOT to a creative motion pack')
}
export class AnimationLibrary {
  private root: Promise<string> | undefined
  private readonly suppliedRoot: string | undefined
  private signature = ''
  private cache: CreativeAnimation[] = []
  constructor(root?:string) { this.suppliedRoot=root }
  private rootPath():Promise<string>{ return this.root??=this.suppliedRoot?Promise.resolve(resolve(this.suppliedRoot)):resolveAnimationsRoot() }
  async entries():Promise<CreativeAnimation[]> {
    const path=join(await this.rootPath(),'index.json'),info=await stat(path),signature=`${info.mtimeMs}:${info.size}`
    if(signature!==this.signature){this.cache=(JSON.parse(await readFile(path,'utf8')) as {entries:CreativeAnimation[]}).entries;this.signature=signature}
    return this.cache
  }
  async filePath(path:string):Promise<string>{
    if(!/^(?:pages\/[a-f\d]{12}-\d{4}\.md|motions\/[a-f\d]{12}-\d{4}\.json)$/.test(path))throw new Error('Invalid animation path')
    const root=await realpath(await this.rootPath()),target=await realpath(join(root,path)),offset=relative(root,target)
    if(offset.startsWith('..')||isAbsolute(offset))throw new Error('Animation escaped library')
    return target
  }
  async search(input:{query?:string|undefined;category?:string|undefined;scope?:string|undefined;offset?:number|undefined;limit?:number|undefined}={}) {
    const query=(input.query??'').normalize('NFKC').toLowerCase().trim()
    const ignored=new Set(['我','想','让','的','一个','一些','把','和','与','用','请','帮我','动画','效果'])
    const terms=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(query)].filter(part=>part.isWordLike&&!ignored.has(part.segment)).map(part=>part.segment)
    const synonyms:Record<string,string[]>={文字:['文字创意','文本','逐字','字母'],图片:['图片创意','照片','图像'],揭示:['遮罩揭示','擦除','wipe','strips'],弹性:['缩放与弹性','伸展','弹跳','bounce'],旋转:['旋转与强调','spin','旋转'],路径:['路径运动','移动','motion'],组合:['组合编排','多对象','交错']}
    const expansions=terms.flatMap(term=>[term,...Object.entries(synonyms).filter(([k,v])=>[k,...v].some(value=>query.includes(value))).flatMap(([,v])=>v)])
    const ranked=(await this.entries()).filter(e=>(!input.category||e.category===input.category)&&(!input.scope||e.scope===input.scope)).map(e=>{
      const text=[e.title,e.category,...e.tags,...(e.useCases??[]),...(e.objectRoles??[]),...(e.objects??[]).flatMap(o=>[o.role,o.replaceWith,o.sourceName,o.sourceText])].join(' ').toLowerCase();const score=(e.origin==='creative-library'?30:0)+expansions.reduce((sum,t)=>sum+(text.includes(t)?e.title.toLowerCase().includes(t)?10:3:0),0)
      return {e,score,matched:!terms.length||expansions.some(t=>text.includes(t))}
    }).filter(row=>row.matched).sort((a,b)=>b.score-a.score||a.e.id.localeCompare(b.e.id))
    const offset=Math.max(0,Math.floor(input.offset??0)),limit=Math.min(60,Math.max(1,Math.floor(input.limit??12)))
    return {total:ranked.length,offset,limit,items:ranked.slice(offset,offset+limit).map(row=>row.e)}
  }
  async read(id:string){
    const resource=(await this.entries()).find(e=>e.id===id)
    if(!resource)return undefined
    const motion=AnimationDocumentV1Schema.parse(JSON.parse(await readFile(await this.filePath(resource.motionFile),'utf8')))
    return {resource,motion,markdown:await readFile(await this.filePath(resource.file),'utf8')}
  }
}
export const ANIMATION_AUTHORING_GUIDANCE=`Search animations for creative visual effects, not whole-slide layouts. Identify the desired text/image/reveal/path/rotation/elastic/choreography effect, inspect 2–3 candidates, and bind an effect to actual object anchors. Reference demo pages are only demonstrations. Inspect resource.objects for semantic role, replaceWith instructions, source shape type/text/bounds and target anchors. The HTML data-animation-slot and data-animation-role attributes identify replaceable native text, figure, metric, shape or path-node objects. For dense choreography keep all particle targets and their relative composition; do not collapse many targets into one label. Rebind one source target for a single-object effect; map every distinct source target explicitly for multi-object choreography. Keep the user's current theme and factual content. Preserve native timing/parameters when exporting through Slidewave. Browser approximation warnings do not imply identical PowerPoint playback. Do not restore template trademarks. Never use a video or screenshot as an editable-animation substitute.`
