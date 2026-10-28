#!/usr/bin/env python3
"""Source semantic object inventory plus conservative, auditable HTML anchor mapping.
Does not mutate Markdown, source presentations or revision/evidence unless --publish.
"""
import argparse, collections, csv, hashlib, json, pathlib, re
from pptx import Presentation
from lxml import html, etree
ROOT=pathlib.Path(__file__).resolve().parents[3]
LIB=ROOT/'packages/resources'
NS={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
def norm(t):return re.sub(r'\s+','',t).casefold()
def bbox(shape,t,W,H):
 sx,sy,tx,ty=t
 x0,y0=shape.left*sx+tx,shape.top*sy+ty;x1,y1=x0+shape.width*sx,y0+shape.height*sy
 return [round(min(x0,x1)/W,7),round(min(y0,y1)/H,7),round(abs(x1-x0)/W,7),round(abs(y1-y0)/H,7)]
def objects(slide,W,H):
 out=[]
 def walk(shapes,parent=None,t=(1,1,0,0),ancestors=()):
  for z,s in enumerate(shapes):
   sid=str(s.shape_id);key='shape-'+sid;box=bbox(s,t,W,H);el=s._element;tag=etree.QName(el).localname
   text=s.text if s.has_text_frame else ''
   row={'id':key,'sourceShapeId':sid,'name':s.name,'type':str(s.shape_type).split(' (')[0].lower(),'xmlType':tag,'parent':parent,'zOrder':z,'box':box,'rotation':float(s.rotation),'text':text,'geometry':None,'children':[],'slots':[],'connections':[],'limitations':[]}
   gs=el.xpath('./p:spPr/a:prstGeom');cs=el.xpath('./p:spPr/a:custGeom')
   row['geometry']=gs[0].get('prst') if gs else 'custom' if cs else None
   for conn in ([] if tag=='grpSp' else el.xpath('.//a:stCxn|.//a:endCxn')):
    row['connections'].append({'end':etree.QName(conn).localname,'target':'shape-'+conn.get('id'),'site':conn.get('idx')})
   if s.has_text_frame and (text.strip() or s.is_placeholder):
    row['paragraphs']=[{'text':p.text,'level':p.level,'runs':[{'text':r.text,'font':r.font.name,'sizePt':r.font.size.pt if r.font.size else None,'bold':r.font.bold,'italic':r.font.italic} for r in p.runs]} for p in s.text_frame.paragraphs]
   if s.is_placeholder:row['placeholder']={'index':s.placeholder_format.idx,'type':str(s.placeholder_format.type)}
   if text.strip() or (s.is_placeholder and s.has_text_frame):row['slots'].append({'id':key+'-text','kind':'text','value':text,'replacement':'preserve paragraphs and inspect text fit'})
   if s.has_table:
    row['table']=[[c.text for c in r.cells] for r in s.table.rows]
    row['text']='\n'.join('\t'.join(r) for r in row['table'])
    row['slots'].extend({'id':f'{key}-cell-{ri}-{ci}','kind':'table-cell','value':c.text} for ri,r in enumerate(s.table.rows) for ci,c in enumerate(r.cells))
   if tag=='pic':
    row['slots'].append({'id':key+'-image','kind':'image','replacement':'retain source crop and aspect; inspect asset licensing'})
    try:
     image=s.image;row['image']={'sha256':hashlib.sha256(image.blob).hexdigest(),'extension':image.ext,'pixelSize':list(image.size),'crop':[s.crop_left,s.crop_top,s.crop_right,s.crop_bottom]}
    except Exception as e:row['limitations'].append('image-metadata: '+str(e))
   if s.has_chart:
    try:row['chart']={'type':str(s.chart.chart_type),'series':[{'name':x.name,'values':list(x.values)} for x in s.chart.series]}
    except Exception as e:row['limitations'].append('chart-data: '+str(e))
    row['slots'].append({'id':key+'-data','kind':'chart-data'})
   if s.rotation or any(ancestors):row['limitations'].append('box is unrotated layout rectangle; rotated geometry needs visual inspection')
   out.append(row)
   if hasattr(s,'shapes'):
    x=el.xpath('./p:grpSpPr/a:xfrm');nt=t
    if x:
     def pt(name):
      e=x[0].find('a:'+name,NS);return (float(e.get('x',e.get('cx',0))),float(e.get('y',e.get('cy',0)))) if e is not None else (0,0)
     off,ext,chOff,chExt=pt('off'),pt('ext'),pt('chOff'),pt('chExt');sx,sy,tx,ty=t;gx=ext[0]/chExt[0] if chExt[0] else 1;gy=ext[1]/chExt[1] if chExt[1] else 1
     flipx=x[0].get('flipH') in ('1','true');flipy=x[0].get('flipV') in ('1','true')
     ox=off[0]+ext[0] if flipx else off[0];oy=off[1]+ext[1] if flipy else off[1]
     gx=-gx if flipx else gx;gy=-gy if flipy else gy
     nt=(sx*gx,sy*gy,tx+sx*(ox-chOff[0]*gx),ty+sy*(oy-chOff[1]*gy))
    row['children']=['shape-'+str(c.shape_id) for c in s.shapes]
    walk(s.shapes,key,nt,(*ancestors,bool(s.rotation)))
 walk(slide.shapes)
 return out

def anchors(markdown):
 doc=html.fragment_fromstring(markdown,create_parent='main');out=[]
 for el in doc.iter():
  a=el.attrib;anchor=a.get('data-fastppt-group') or a.get('data-object-id') or a.get('data-source-shape-id')
  if not anchor:continue
  box=None;raw=a.get('data-reference-box');provenance='unavailable'
  if raw:
   try:box=list(map(float,raw.split(',')));provenance='source-PDF-reference-glyph-box'
   except ValueError:pass
  # Native conversion wrappers use full-page boxes; inspect their child geometry.
  target=el
  if a.get('data-fastppt-native') and len(el):
   target=next((child for child in el.iterdescendants() if re.search(r'left:[^;]+%;',child.get('style','')) and re.search(r'width:[^;]+%;',child.get('style',''))),el[0])
  if box is None:
   style=dict(re.findall(r'([\w-]+)\s*:\s*([^;]+)',target.get('style','')))
   try:box=[float(style[k].rstrip('%'))/100 for k in ('left','top','width','height') if style[k].endswith('%')]
   except (KeyError,ValueError):box=None
   if box is not None and len(box)!=4:box=None
   if box is not None:provenance='native-CSS-percentages'
  out.append({'anchor':anchor,'tag':el.tag,'kind':'text' if a.get('data-resource-text') else 'fallback' if a.get('data-fastppt-fallback') else 'native' if a.get('data-fastppt-native') else 'paint','box':box,'boxProvenance':provenance,'text':el.text_content() if a.get('data-resource-text') else '', 'sourceShapeId':a.get('data-source-shape-id'),'fallback':a.get('data-fastppt-fallback')})
 return out

def overlap(inner,outer):
 x,y,w,h=inner;X,Y,W,H=outer
 area=max(0,min(x+w,X+W)-max(x,X))*max(0,min(y+h,Y+H)-max(y,Y))
 return area/max(w*h,1e-10)
def mapping(obs,ans):
 result=[];used=set()
 for a in ans:
  candidates=[]
  for o in obs:
   if a['sourceShapeId']==o['sourceShapeId']:candidates.append((1.,o,'explicit-source-id'))
   elif any('rotated geometry' in limitation for limitation in o.get('limitations',[])):continue
   elif a['kind']=='text' and norm(a['text']) and norm(a['text']) in norm(o['text']) and a['box']:
    contain=overlap(a['box'],o['box'])
    if contain>=.65:candidates.append((.92 if norm(a['text'])==norm(o['text']) else .82,o,'text-and-box-containment'))
   elif a['kind']=='native' and a['box'] and not o['children']:
    b=o['box'];err=max(abs(i-j) for i,j in zip(a['box'],b))
    if err<.002:candidates.append((.7,o,'geometry-only-candidate'))
  candidates.sort(key=lambda x:(-x[0],x[1]['id']))
  if not candidates:continue
  top=candidates[0];amb=[x[1]['id'] for x in candidates if x[0]>=top[0]-.06]
  accepted=len(amb)==1 and top[2]!='geometry-only-candidate'
  if accepted:used.add(top[1]['id'])
  result.append({'anchor':a['anchor'],'sourceObject':top[1]['id'] if accepted else None,'method':top[2],'confidence':top[0] if accepted else min(top[0],.49),'status':'mapped' if accepted else 'ambiguous','candidates':amb,'limitation':'Geometry-only candidates are not identity proof.' if top[2]=='geometry-only-candidate' else 'Text fragments can map many-to-one; source box is not glyph bounds.'})
 return result,used

def build(entry,slide,pres,library):
 md=(library/entry['file']).read_text();obs=objects(slide,pres.slide_width,pres.slide_height);ans=anchors(md);maps,used=mapping(obs,ans)
 for o in obs:
  o['htmlAnchors']=[m['anchor'] for m in maps if m['sourceObject']==o['id'] and m['status']=='mapped']
  o['candidateAnchors']=[m['anchor'] for m in maps if m['status']=='ambiguous' and o['id'] in m['candidates']]
 stats={'sourceObjects':len(obs),'sourceLeafObjects':sum(not o['children'] for o in obs),'slots':sum(len(o['slots']) for o in obs),'mappedSourceObjects':len(used),'unmappedSourceObjects':len(obs)-len(used),'htmlAnchors':len(ans),'unmappedAnchors':len(ans)-len(maps),'unknownBoxAnchors':sum(a['box'] is None for a in ans),'mappedAnchors':sum(m['status']=='mapped' for m in maps),'ambiguousAnchors':sum(m['status']=='ambiguous' for m in maps),'nativeAnchors':sum(a['kind']=='native' for a in ans),'fallbackAnchors':sum(a['kind']=='fallback' for a in ans),'unclassifiedPaintAnchors':sum(a['kind']=='paint' for a in ans)}
 return {'version':1,'id':entry['id'],'source':entry['source'],'sourcePage':entry['sourcePage'],'sourceStatus':entry['status'],'sourceSlideXmlSha256':hashlib.sha256(slide._element.xml.encode()).hexdigest(),'pageSha256':hashlib.sha256(md.encode()).hexdigest(),'revision':hashlib.sha256(md.encode()).hexdigest()[:16],'coordinates':'top-left normalized, unrotated layout rectangles; group scaling and flips applied','limitations':['Slide-owned objects only; inherited master/layout decorations are not source slide semantic objects.','Anonymous PDF paint may split or combine source objects; unmapped paint must not be treated as a semantic slot.','Mapping confidence is a rule score, not a calibrated probability.'],'objects':obs,'htmlAnchors':ans,'mapping':maps,'stats':stats}

def publish(library,entries,records):
 # Opt-in after all native page conversions. Revisions describe the actual Markdown.
 lookup={r['id']:r for r in records}
 for e in entries:
  if e['id'] not in lookup:continue
  r=lookup[e['id']];e['revision']=r['pageSha256'][:16]
  if 'renderQa' in e:e['historicalRenderQa']=e.pop('renderQa')
  e['composition']={'file':'compositions/'+e['id']+'.json','pageSha256':r['pageSha256'],'revision':r['pageSha256'][:16],'stats':r['stats']}
  path=library/'evidence'/f"{e['id']}.json"
  if path.exists():
   data=json.loads(path.read_text());data['composition']=e['composition']
   if 'visualQa' in data:data['historicalVisualQa']=data.pop('visualQa')
   data['currentPageSha256']=r['pageSha256'];data['nativeHtml']={'representation':'native HTML text, CSS geometry and bounded SVG fallback','pageSha256':r['pageSha256'],'revision':e['revision'],'visualQaStatus':'pending-current-render-audit'}
   write(path,data)
 index=json.loads((library/'index.json').read_text());index['entries']=entries;write(library/'index.json',index)
 manifest=library/'manifest.csv'
 if manifest.exists():
  with manifest.open(newline='') as f:reader=csv.DictReader(f);fields=list(reader.fieldnames or []);rows=list(reader)
  for field in ('historicalTextOverflow','historicalTextOutsidePage','historicalBlockSsim','historicalNormalizedMae'):
   if field not in fields:fields.append(field)
  for field in ('revision','compositionFile','sourceObjects','mappedSourceObjects','unmappedSourceObjects','nativeAnchors','fallbackAnchors'):
   if field not in fields:fields.append(field)
  for row in rows:
   r=lookup.get(row.get('id'))
   if r:
    for field in ('textOverflow','textOutsidePage','blockSsim','normalizedMae'):
     historical='historical'+field[0].upper()+field[1:]
     if row.get(field):row[historical]=row[field]
     row[field]=''
   if r:row.update(revision=r['pageSha256'][:16],compositionFile='compositions/'+r['id']+'.json',**{k:r['stats'][k] for k in fields if k in r['stats']})
  with manifest.open('w',newline='') as f:writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)

def merge_report(previous,partial):
 """Replace selected page rows while preserving full coverage and source counts."""
 replacements={p['id']:p for p in partial['pages']}
 known={p['id'] for p in previous['pages']}
 if not set(replacements)<=known:raise ValueError('Incremental report contains unknown pages')
 report={**previous,'pages':[replacements.get(p['id'],p) for p in previous['pages']]}
 report['pageCount']=len(report['pages'])
 report['totals']={k:sum(p[k] for p in report['pages']) for k in partial['totals']}
 updated_sources={s['source']:s for s in partial['sources']}
 report['sources']=[{**s,'sha256':updated_sources[s['source']]['sha256']} if s['source'] in updated_sources else s for s in previous['sources']]
 return report

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--id',action='append');ap.add_argument('--publish',action='store_true');args=ap.parse_args()
 for library in (LIB,ROOT/'packages/animations/reference'):
  entries=json.loads((library/'index.json').read_text())['entries'];selected=[e for e in entries if not args.id or e['id'] in args.id];by=collections.defaultdict(list);records=[];sources=[]
  for e in selected:by[e['source']].append(e)
  for source,items in by.items():
   source_path=ROOT/source
   source_digest=hashlib.sha256()
   with source_path.open('rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''):source_digest.update(chunk)
   source_hash=source_digest.hexdigest()
   sources.append({'source':source,'sha256':source_hash,'pages':len(items)})
   pres=Presentation(source_path)
   for e in items:
    r=build(e,pres.slides[e['sourcePage']-1],pres,library);r['sourceSha256']=source_hash;write(library/'compositions'/f"{e['id']}.json",r);records.append(r)
   print(source,len(items),flush=True)
  if not records:continue
  totals={k:sum(r['stats'][k] for r in records) for k in records[0]['stats']}
  report={'version':1,'pageCount':len(records),'sourceCount':len(by),'includesExcluded':True,'sources':sources,'totals':totals,'pages':[{'id':r['id'],'status':r['sourceStatus'],'file':'compositions/'+r['id']+'.json','pageSha256':r['pageSha256'],'revision':r['pageSha256'][:16],**r['stats']} for r in records]}
  if args.id and args.publish:
   report=merge_report(json.loads((library/'composition-report.json').read_text()),report)
  write(library/('composition-report.sample.json' if args.id and not args.publish else 'composition-report.json'),report)
  if args.publish:publish(library,entries,records)
if __name__=='__main__':main()
