import { NativePathsSchema, type NativePaths } from '../primitives/native-geometry.js'
import { parseXml, PRESENTATION_NS } from './slide-xml.js'

type Point = [number, number]
function signedArea(points: Point[]): number { return points.reduce((sum, p, i) => { const q=points[(i+1)%points.length]!;return sum+p[0]*q[1]-q[0]*p[1] },0)/2 }
function contains(points: Point[], point: Point): boolean {
  let inside=false
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i]!,b=points[j]!
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
  }
  return inside
}
/** Normalize even/odd holes to DrawingML's nonzero winding without rasterization. */
export function freeformGeometryXml(input: NativePaths): string {
  const geometry=NativePathsSchema.parse(input)
  const contours=geometry.paths.filter(path=>path.points.length>=3)
  const paths=geometry.paths.map(path=>{
    let points=path.points
    // Fill implicitly closes open contours; preserve the open stroke below.
    if(geometry.fillRule==='evenodd'&&points.length>=3){
      const depth=contours.filter(other=>other!==path&&Math.abs(signedArea(other.points))>Math.abs(signedArea(points))&&contains(other.points,points[0]!)).length
      if((signedArea(points)>0)!==(depth%2===0))points=[...points].reverse()
    }
    const coordinate=(n:number)=>Math.round(n*1_000_000)
    return `<a:moveTo><a:pt x="${coordinate(points[0]![0])}" y="${coordinate(points[0]![1])}"/></a:moveTo>${points.slice(1).map(p=>`<a:lnTo><a:pt x="${coordinate(p[0])}" y="${coordinate(p[1])}"/></a:lnTo>`).join('')}${path.closed?'<a:close/>':''}`
  }).join('')
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="1000000" h="1000000">${paths}</a:path></a:pathLst></a:custGeom>`
}

export function finalizeFreeforms(xml:string,records:Array<{name:string;geometry:NativePaths}>):string {
  if(!records.length)return xml
  const nodes:ReturnType<typeof parseXml>[]=[]
  const visit=(node:ReturnType<typeof parseXml>)=>{nodes.push(node);node.children.forEach(visit)}
  visit(parseXml(xml))
  const edits=records.map(record=>{
    const shapes=nodes.filter(node=>node.namespace===PRESENTATION_NS&&node.local==='sp'&&node.children.some(child=>child.local==='nvSpPr'&&child.children.some(value=>value.local==='cNvPr'&&value.attributes.name===record.name)))
    if(shapes.length!==1)throw new Error(`Expected exactly one native freeform: ${record.name}`)
    const properties=shapes[0]!.children.find(node=>node.local==='spPr')!
    const geometry=properties.children.find(node=>node.local==='prstGeom'||node.local==='custGeom')
    if(!geometry)throw new Error(`Native freeform has no geometry: ${record.name}`)
    return {start:geometry.start,end:geometry.end,text:freeformGeometryXml(record.geometry)}
  })
  for(const edit of edits.sort((a,b)=>b.start-a.start))xml=xml.slice(0,edit.start)+edit.text+xml.slice(edit.end)
  return xml
}
