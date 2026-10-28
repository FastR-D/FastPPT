import { animationShapeIds, parseXml, PRESENTATION_NS } from './slide-xml.js'
type XmlElement=ReturnType<typeof parseXml>
const DRAWING_NS='http://schemas.openxmlformats.org/drawingml/2006/main'
const OFFICE_NS='http://schemas.microsoft.com/office/powerpoint/2010/main'
const allowed=new Set('cTn childTnLst subTnLst stCondLst endCondLst cond tn tgtEl spTgt sldTgt cBhvr attrNameLst attrName anim set animEffect animScale animRot animMotion animClr tavLst tav val from to by strVal fltVal intVal boolVal clrVal srgbClr schemeClr iterate tmPct tmAbs rCtr'.split(' '))
const walk=(node:XmlElement):XmlElement[]=>[node,...node.children.flatMap(walk)]
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
/** Accept only inert PresentationML animation behaviors, without external actions. */
export function nativeEffectXml(source:string,targetId:string,allocate:()=>number,durationScale=1):string {
  if(!Number.isFinite(durationScale)||durationScale<=0)throw new Error('Invalid native motion duration scale')
  if(source.length>500_000||/<!|<\?/.test(source))throw new Error('Invalid native animation XML')
  const root=parseXml(source)
  if(root.local!=='cTn'||root.namespace!==PRESENTATION_NS)throw new Error('Expected native animation cTn')
  const nodes=walk(root),ids=new Map<string,string>(),ownIds=new Map<XmlElement,string>()
  for(const node of nodes){
    if(!allowed.has(node.local)||![PRESENTATION_NS,DRAWING_NS].includes(node.namespace??''))throw new Error(`Unsupported native animation element: ${node.name}`)
    for(const key of Object.keys(node.attributes)){
      if(key==='xmlns'||key.startsWith('xmlns:'))continue
      if(key.includes(':')&&node.namespaces[key.split(':')[0]!]!==OFFICE_NS)throw new Error('External native animation attribute is not allowed')
      if(/^(href|embed|link|rId)$/i.test(key))throw new Error('External native animation reference is not allowed')
    }
    if(node.local==='cTn'){
      if(node.attributes.id&&ids.has(node.attributes.id))throw new Error('Duplicate native timing identity')
      const identity=String(allocate());ownIds.set(node,identity)
      if(node.attributes.id)ids.set(node.attributes.id,identity)
    }
  }
  const edits:Array<{start:number;end:number;value:string}>=[]
  for(const node of nodes){
    let opening=source.slice(node.start,source.indexOf('>',node.start)+1)
    const replace=(name:string,value:string)=>{const token=new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`);if(!token.test(opening))throw new Error(`Missing native animation attribute: ${name}`);opening=opening.replace(token,(_m,prefix:string,quote:string)=>prefix+quote+escape(value)+quote)}
    if(node.local==='cTn'){if(node.attributes.id)replace('id',ownIds.get(node)!);else opening=opening.replace(/^<[\w:.-]+/,match=>match+` id="${ownIds.get(node)!}"`)}
    if(node.local==='spTgt')replace('spid',targetId)
    if(durationScale!==1)for(const name of ['dur','delay'])if(/^\d+$/.test(node.attributes[name]??''))replace(name,String(Math.max(name==='dur'?1:0,Math.round(Number(node.attributes[name])*durationScale))))
    if(node.local==='tn'){
      const id=ids.get(node.attributes.val!)
      if(!id)throw new Error('Native animation depends on a timing node outside its effect')
      replace('val',id)
    }
    edits.push({start:node.start,end:source.indexOf('>',node.start)+1,value:opening})
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.value+source.slice(edit.end)
  return `<p:par>${source}</p:par>`
}
/** A single source object may capture as several native primitives. Make them a
 * real PowerPoint group so scale/rotation/path motion preserves object geometry. */
export function groupNativeAnimationTarget(xml:string,anchor:string):string {
  const targets=new Set(animationShapeIds(xml,anchor));if(targets.size<2)return xml
  const root=parseXml(xml),tree=root.children.find(n=>n.local==='cSld')?.children.find(n=>n.local==='spTree')
  if(!tree)throw new Error('Missing slide shape tree')
  const shapes=tree.children.filter(n=>['sp','pic','grpSp','graphicFrame','cxnSp'].includes(n.local))
  const selected=shapes.filter(n=>walk(n).some(c=>c.local==='cNvPr'&&targets.has(c.attributes.id??'')))
  if(selected.length!==targets.size)throw new Error(`Cannot group nested animation target: ${anchor}`)
  const first=shapes.indexOf(selected[0]!),last=shapes.indexOf(selected.at(-1)!)
  if(last-first+1!==selected.length)throw new Error(`Animation object overlaps interleaved object identities: ${anchor}`)
  const boxes=selected.map(n=>{
    const xf=walk(n).find(c=>c.local==='xfrm'),off=xf?.children.find(c=>c.local==='off'),ext=xf?.children.find(c=>c.local==='ext')
    if(!off||!ext)throw new Error('Animation primitive has no geometry')
    return {x:Number(off.attributes.x),y:Number(off.attributes.y),w:Number(ext.attributes.cx),h:Number(ext.attributes.cy)}
  })
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),w=Math.max(1,Math.max(...boxes.map(b=>b.x+b.w))-x),h=Math.max(1,Math.max(...boxes.map(b=>b.y+b.h))-y)
  if(![x,y,w,h].every(Number.isFinite))throw new Error('Invalid animation group geometry')
  const id=Math.max(...walk(root).filter(n=>n.local==='cNvPr').map(n=>Number(n.attributes.id)||0))+1
  const content=selected.map(n=>xml.slice(n.start,n.end).replaceAll(`name="fastppt:${escape(anchor)}"`, `name="fastppt:${escape(anchor)}:part:${n.start}"`)).join('')
  const group=`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="fastppt:${escape(anchor)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="${x}" y="${y}"/><a:chExt cx="${w}" cy="${h}"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`
  for(const n of [...selected].reverse())xml=xml.slice(0,n.start)+(n===selected[0]?group:'')+xml.slice(n.end)
  return xml
}
