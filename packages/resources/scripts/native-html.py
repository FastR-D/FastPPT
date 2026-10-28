#!/usr/bin/env python3
"""Conservative, repeatable SVG paint to native HTML conversion. Unsupported paint is retained.
Curve flattening uses recursive control-polygon flatness <= .04 source units;
affine output error <= .08 source units (checked after transformation).
"""
import argparse,collections,hashlib,html,json,math,pathlib,re
from lxml import etree as E
from shapely.geometry import Polygon,LineString,GeometryCollection
from shapely.ops import unary_union,polygonize,substring
ROOT=pathlib.Path(__file__).resolve().parents[3]
SVG_RE=re.compile(r'<svg\b[^>]*>.*?</svg>',re.S)
N=r'[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?'
def fmt(x):return f'{x:.8f}'.rstrip('0').rstrip('.') or '0'
def matrix(s):
 if not s:return (1,0,0,1,0,0)
 m=re.fullmatch(r'\s*matrix\(([^)]+)\)\s*',s)
 if not m:raise ValueError('unsupported-transform')
 v=list(map(float,re.findall(N,m[1])))
 if len(v)!=6:raise ValueError('invalid-transform')
 return v
def mul(a,b):
 A,B,C,D,X,Y=a;e,f,g,h,u,v=b
 return A*e+C*f,B*e+D*f,A*g+C*h,B*g+D*h,A*u+C*v+X,B*u+D*v+Y
def point(m,p):a,b,c,d,e,f=m;x,y=p;return (a*x+c*y+e,b*x+d*y+f)
def path(d):
 tokens=re.findall('[A-Za-z]|'+N,d);i=0;cmd=None;p=(0,0);start=None;paths=[];pts=[];curved=False
 def nums(k):
  nonlocal i
  v=list(map(float,tokens[i:i+k]));i+=k
  if len(v)!=k:raise ValueError('invalid-path')
  return v
 def flatten(points,depth=0):
  nonlocal curved
  curved=True;a,z=points[0],points[-1];dx=z[0]-a[0];dy=z[1]-a[1];length=math.hypot(dx,dy)
  dist=max(math.dist(q,(a[0]+dx*max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(length*length))),a[1]+dy*max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(length*length))))) if length else math.dist(a,q) for q in points[1:-1])
  if dist<=.04:return [z]
  if depth>=18:raise ValueError('curve-error-budget')
  levels=[points]
  while len(levels[-1])>1:levels.append([((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in zip(levels[-1],levels[-1][1:])])
  return flatten([v[0] for v in levels],depth+1)+flatten([v[-1] for v in reversed(levels)],depth+1)
 while i<len(tokens):
  if tokens[i].isalpha():cmd=tokens[i];i+=1
  if cmd is None:raise ValueError('invalid-path')
  rel=cmd.islower();c=cmd.upper();base=p
  def xy(v):return (v[0]+(base[0] if rel else 0),v[1]+(base[1] if rel else 0))
  if c=='Z':
   if pts:paths.append((pts,True));pts=[]
   p=start;cmd=None;continue
  if c=='M':
   if pts:paths.append((pts,False))
   p=xy(nums(2));start=p;pts=[p];cmd='l' if rel else 'L'
  elif c=='L':p=xy(nums(2));pts.append(p)
  elif c=='H':p=(nums(1)[0]+(p[0] if rel else 0),p[1]);pts.append(p)
  elif c=='V':p=(p[0],nums(1)[0]+(p[1] if rel else 0));pts.append(p)
  elif c in ('C','Q'):
   v=nums(6 if c=='C' else 4);q=[xy(v[j:j+2]) for j in range(0,len(v),2)];pts+=flatten([p]+q);p=q[-1]
  else:raise ValueError('path-command-'+c)
 if pts:paths.append((pts,False))
 return paths,curved
def geometry(el,m):
 t=E.QName(el).localname;curved=False
 if t=='path':
  if len(el.get('d',''))>150000:raise ValueError('path-character-budget')
  paths,curved=path(el.get('d',''))
 elif t=='rect':
  if float(el.get('rx','0')) or float(el.get('ry','0')):raise ValueError('rounded-rect')
  x,y,w,h=[float(el.get(k,'0')) for k in ('x','y','width','height')];paths=[([(x,y),(x+w,y),(x+w,y+h),(x,y+h)],True)]
 elif t in ('polygon','polyline'):
  v=list(map(float,re.findall(N,el.get('points',''))));paths=[(list(zip(v[::2],v[1::2])),t=='polygon')]
 elif t=='line':paths=[([(float(el.get('x1',0)),float(el.get('y1',0))),(float(el.get('x2',0)),float(el.get('y2',0)))],False)]
 elif t in ('circle','ellipse'):
  x,y=float(el.get('cx',0)),float(el.get('cy',0));rx=float(el.get('r',el.get('rx',0)));ry=float(el.get('r',el.get('ry',0)));r=max(rx,ry);count=max(16,math.ceil(math.pi/math.acos(max(-1,1-.04/max(r,.04)))));paths=[([(x+rx*math.cos(i*2*math.pi/count),y+ry*math.sin(i*2*math.pi/count)) for i in range(count)],True)];curved=True
 else:raise ValueError('element-'+t)
 if curved and max(math.hypot(m[0],m[1]),math.hypot(m[2],m[3]))>1.414:raise ValueError('curve-transform-error-budget')
 if len(paths)>128 or sum(len(ps) for ps,c in paths)>8192 or any(len(ps)>4096 for ps,c in paths):raise ValueError('source-point-budget')
 return [([point(m,p) for p in ps],closed) for ps,closed in paths]

def fill_geometry(paths,rule='nonzero'):
 rings=[ps for ps,closed in paths if len(ps)>=3]
 if not rings:return GeometryCollection()
 if len(rings)*sum(map(len,rings))>250000:raise ValueError('intersection-complexity-budget')
 lines=unary_union([LineString(ps+[ps[0]]) for ps in rings]);pieces=[]
 for poly in polygonize(lines):
  q=poly.representative_point();x,y=q.x,q.y;winding=0
  for ps in rings:
   for a,b in zip(ps,ps[1:]+ps[:1]):
    cross=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1])
    if a[1]<=y<b[1] and cross>0:winding+=1
    elif b[1]<=y<a[1] and cross<0:winding-=1
  if (winding%2 if rule=='evenodd' else winding!=0):pieces.append(poly)
 return unary_union(pieces)
def contours(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [(list(g.exterior.coords)[:-1],True)]+[(list(r.coords)[:-1],True) for r in g.interiors]
 if hasattr(g,'geoms'):return [p for item in g.geoms for p in contours(item)]
 return []
def css_polygon(paths,x,y,w,h):
 # Doubled bridges connect rings without changing even-odd filled area.
 points=[]
 for ps,closed in paths:
  if not ps:continue
  if points:points.append(ps[0])
  points+=ps+[ps[0]]
  if len(points)>len(ps)+1:points.append(points[0])
 return 'polygon(evenodd,'+','.join(f'{fmt((px-x)/w*100)}% {fmt((py-y)/h*100)}%' for px,py in points)+')'

def convert_svg(raw,defs):
 root=E.fromstring(raw.encode());group=root.get('data-fastppt-group')
 if not group:return raw,'definitions'
 vb=list(map(float,root.get('viewBox','').split()));W,H=vb[2:];draw=[];clips=[]
 def walk(el,m=(1,0,0,1,0,0),attrs=None,opacity=1):
  attrs=dict(attrs or {});m=mul(m,matrix(el.get('transform')));opacity*=float(el.get('opacity','1'));tag=E.QName(el).localname
  for k in ('fill','stroke','stroke-width','fill-rule','fill-opacity','stroke-opacity','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit'): 
   if el.get(k) is not None:attrs[k]=el.get(k)
  for k in ('mask','filter','style'): 
   if el.get(k) and not (el is root and k=='style'):raise ValueError('unsupported-'+k)
  cp=el.get('clip-path')
  if cp:
   match=re.fullmatch(r'url\(#([^)]*)\)',cp);clip=defs.get(match[1]) if match else None
   if clip is None or len(clip)!=1:raise ValueError('complex-clip')
   ce=clip[0];ps=geometry(ce,mul(m,matrix(ce.get('transform'))))
   cg=fill_geometry(ps,ce.get('clip-rule','nonzero'))
   clips.append(cg)
  if tag in ('svg','g'):
   for child in el:walk(child,m,attrs,opacity)
  elif tag in ('defs','title','desc'):pass
  elif tag=='use':
   ref=el.get('href',el.get('{http://www.w3.org/1999/xlink}href',''))
   if not ref.startswith('#') or ref[1:] not in defs:raise ValueError('unresolved-use')
   if el.get('x') or el.get('y'):raise ValueError('translated-use')
   walk(defs[ref[1:]],m,attrs,opacity)
  else:draw.append((el,m,attrs,opacity))
 walk(root)
 if len(draw)!=1:raise ValueError('multiple-paint-objects')
 el,m,a,opacity=draw[0];tag=E.QName(el).localname
 if tag=='image':
  if clips:
   iw0,ih0=float(el.get('width',0)),float(el.get('height',0));ix0,iy0=float(el.get('x',0)),float(el.get('y',0));imagebox=Polygon([point(m,q) for q in [(ix0,iy0),(ix0+iw0,iy0),(ix0+iw0,iy0+ih0),(ix0,iy0+ih0)]])
   if any(not cg.buffer(.001).covers(imagebox) for cg in clips):raise ValueError('clipped-image')
  href=el.get('href',el.get('{http://www.w3.org/1999/xlink}href',''))
  if not href or href.startswith('#'):raise ValueError('image-reference')
  if el.get('preserveAspectRatio','xMidYMid meet') not in ('none','xMidYMid meet'):raise ValueError('image-aspect-ratio')
  ix,iy,iw,ih=[float(el.get(k,'0')) for k in ('x','y','width','height')];ix,iy=point(m,(ix,iy))
  style=f'position:absolute;left:{fmt(ix/W*100)}%;top:{fmt(iy/H*100)}%;width:{fmt(iw/W*100)}%;height:{fmt(ih/H*100)}%;transform-origin:0 0;transform:matrix({fmt(m[0])},{fmt(m[1])},{fmt(m[2])},{fmt(m[3])},0,0);opacity:{fmt(opacity)};object-fit:'+('fill' if el.get('preserveAspectRatio')=='none' else 'contain')+';'
  return '<div data-fastppt-group="'+html.escape(group)+'" data-fastppt-native="image" style="'+html.escape(root.get('style',''),quote=True)+'"><img src="'+html.escape(href,quote=True)+'" style="'+style+'" /></div>','image'
 paths=geometry(el,m)
 fill=a.get('fill','#000000');stroke=a.get('stroke','none');sw=float(a.get('stroke-width','1'))
 if not re.fullmatch(r'#[0-9a-fA-F]{3,8}|none|black|white',fill):raise ValueError('complex-fill')
 if not re.fullmatch(r'#[0-9a-fA-F]{3,8}|none|black|white',stroke):raise ValueError('complex-stroke')
 rule=a.get('fill-rule','nonzero');fg=fill_geometry(paths,rule) if fill!='none' else GeometryCollection();sg=GeometryCollection()
 self_crossing_evenodd=fill!='none' and rule=='evenodd' and any(len(ps)>=3 and not LineString(ps+[ps[0]]).is_simple for ps,closed in paths)
 if self_crossing_evenodd and stroke!='none':raise ValueError('self-intersecting-evenodd-stroke')
 if stroke!='none':
  if abs(m[0]*m[2]+m[1]*m[3])>1e-6 or abs(math.hypot(m[0],m[1])-math.hypot(m[2],m[3]))>1e-6:raise ValueError('nonuniform-stroke')
  dash=a.get('stroke-dasharray')
  if dash:
   if any(closed or len(ps)!=2 for ps,closed in paths):raise ValueError('dashed-complex-path')
   values=[float(v)*math.hypot(m[0],m[1]) for v in re.findall(N,dash)]
   if len(values)%2:values*=2
   if not values or min(values)<=0:raise ValueError('dashed-pattern')
   split=[];offset=float(a.get('stroke-dashoffset','0'))*math.hypot(m[0],m[1])
   for ps,closed in paths:
    line=LineString(ps);idx=0;phase=offset%sum(values)
    while phase>=values[idx]:phase-=values[idx];idx=(idx+1)%len(values)
    pos=-phase
    while pos<line.length:
     end=pos+values[idx]
     if idx%2==0 and end>0:
      segment=substring(line,max(0,pos),min(line.length,end))
      if segment.geom_type=='LineString':split.append((list(segment.coords),False))
     pos=end;idx=(idx+1)%len(values)
   paths=split
  sw*=math.hypot(m[0],m[1]);join={'round':1,'miter':2,'bevel':3}.get(a.get('stroke-linejoin','miter'));cap={'round':1,'butt':2,'square':3}.get(a.get('stroke-linecap','butt'))
  sg=unary_union([LineString(ps+([ps[0]] if closed else [])).buffer(sw/2,quad_segs=max(8,math.ceil(math.pi/(4*math.acos(max(-1,1-.04/max(sw/2,.04)))))),cap_style=cap,join_style=join,mitre_limit=float(a.get('stroke-miterlimit',4))) for ps,closed in paths if len(ps)>1])
 bounds=unary_union([fg,sg])
 if bounds.is_empty:raise ValueError('empty-paint')
 changed_clip=False
 for cg in clips:
  if not cg.covers(bounds):changed_clip=True
  fg=fg.intersection(cg);sg=sg.intersection(cg)
 if changed_clip and stroke!='none':raise ValueError('clipped-stroke')
 bounds=unary_union([fg,sg])
 if bounds.is_empty:raise ValueError('fully-clipped-paint')
 x,y,x2,y2=bounds.bounds;w,h=x2-x,y2-y
 if w<1e-8 or h<1e-8:raise ValueError('degenerate-box')
 if changed_clip:paths=contours(fg);rule='evenodd'
 nativepaths=contours(fg) if self_crossing_evenodd else paths
 if len(nativepaths)>128 or sum(len(ps) for ps,c in nativepaths)>32768 or any(len(ps)>4096 for ps,c in nativepaths):raise ValueError('geometry-point-limit')
 rect=stroke=='none' and fg.geom_type=='Polygon' and not fg.interiors and abs(fg.area-w*h)<1e-7
 st=f'position:absolute;left:{fmt(x/W*100)}%;top:{fmt(y/H*100)}%;width:{fmt(w/W*100)}%;height:{fmt(h/H*100)}%;'
 if rect:
  inner='<div style="'+st+f'background:{fill};opacity:{fmt(opacity*float(a.get("fill-opacity",1)))};"></div>';kind='rect'
 else:
  payload={'version':1,'paths':[{'points':[[round((px-x)/w,9),round((py-y)/h,9)] for px,py in ps],'closed':closed} for ps,closed in nativepaths],'fill':fill,'stroke':stroke,'strokeWidthRatio':sw/w if stroke!='none' else 0,'fillRule':rule,'fillOpacity':float(a.get('fill-opacity',1)),'strokeOpacity':float(a.get('stroke-opacity',1))}
  inner='<div data-fastppt-geometry="'+html.escape(json.dumps(payload,separators=(',',':')),quote=True)+'" style="'+st+'opacity:'+fmt(opacity)+';">'
  for g,color,alpha in [(fg,fill,float(a.get('fill-opacity',1))),(sg,stroke,float(a.get('stroke-opacity',1)))]:
   if not g.is_empty:inner+='<div style="position:absolute;inset:0;background:'+color+';opacity:'+fmt(alpha)+';clip-path:'+css_polygon(contours(g),x,y,w,h)+';"></div>'
  inner+='</div>';kind='geometry'
 return '<div data-fastppt-group="'+html.escape(group)+'" data-fastppt-native="'+kind+'" style="'+html.escape(root.get('style',''),quote=True)+'">'+inner+'</div>',kind

def convert(text):
 defs={};matches=list(SVG_RE.finditer(text))
 references=set(re.findall(r'(?:href|xlink:href)="#([^"]+)"',text))|set(re.findall(r'url\(#([^)]*)\)',text))
 for match in matches:
  root=E.fromstring(match[0].encode())
  for el in root.iter():
   if el.get('id'):defs[el.get('id')]=el
 counts=collections.Counter();fallback=collections.Counter();out=[];pos=0
 for match in matches:
  raw=match[0];out.append(text[pos:match.start()]);pos=match.end()
  retained=re.search(r' data-fastppt-fallback="([^"]*)"',raw)
  if retained:
   counts['fallback']+=1;fallback[html.unescape(retained[1])]+=1;out.append(raw);continue
  try:
   new,kind=convert_svg(raw,defs)
   # SVG use/clip/mask references can cross paint containers. HTML conversion
   # must not remove their target IDs, including a source image reused later.
   if kind in ('rect','geometry','image') and references.intersection(re.findall(r'\bid="([^"]+)"',raw)):raise ValueError('referenced-svg-definition')
   counts[kind]+=1
  except Exception as e:
   reason=str(e) if isinstance(e,ValueError) else type(e).__name__+':'+str(e)[:160];fallback[reason]+=1;new=re.sub(r' data-fastppt-fallback="[^"]*"','',raw).replace('<svg ','<svg data-fastppt-fallback="'+html.escape(reason,quote=True)+'" ',1);counts['fallback']+=1
  out.append(new)
 out.append(text[pos:]);result=''.join(out)
 assert ''.join(out[0::2])==SVG_RE.sub('',text),'non-SVG/text bytes changed'
 assert re.findall(r'data-fastppt-group="([^"]*)"',text)==re.findall(r'data-fastppt-group="([^"]*)"',result),'paint/text anchor order changed'
 after_references=set(re.findall(r'(?:href|xlink:href)="#([^"]+)"',result))|set(re.findall(r'url\(#([^)]*)\)',result))
 assert after_references-set(re.findall(r'\bid="([^"]+)"',result)) <= references-set(re.findall(r'\bid="([^"]+)"',text)),'new dangling SVG reference'
 return result,{'originalSvg':len(matches),'newSvg':len(SVG_RE.findall(result)),'preservedOutsideSvg':True,'native':dict(counts),'fallbackReasons':dict(fallback),'beforeHash':hashlib.sha256(text.encode()).hexdigest(),'afterHash':hashlib.sha256(result.encode()).hexdigest()}
def main():
 p=argparse.ArgumentParser();p.add_argument('paths',nargs='*');p.add_argument('--output-dir');p.add_argument('--report',required=True);p.add_argument('--source-root');p.add_argument('--resume',action='store_true',help='Reuse checkpoint entries only when source and output hashes still match');args=p.parse_args();files=[pathlib.Path(x).resolve() for x in args.paths] or sorted((ROOT/'packages/resources/pages').glob('*.md'))+sorted((ROOT/'packages/animations/reference/pages').glob('*.md'));rows=[]
 checkpoint=pathlib.Path(args.report+'.jsonl');checkpoint.parent.mkdir(parents=True,exist_ok=True);cached={}
 if args.resume and checkpoint.exists():
  for line in checkpoint.read_text().splitlines():
   try:
    row=json.loads(line);cached[row['page']]=row
   except (ValueError,KeyError):pass # An interrupted final append is safe to recompute.
 if not args.resume:checkpoint.write_text('')
 for file in files:
  source=pathlib.Path(args.source_root)/file.relative_to(ROOT) if args.source_root else file
  text=source.read_text();page=str(file.relative_to(ROOT)) if file.is_relative_to(ROOT) else str(file);target=pathlib.Path(args.output_dir)/file.name if args.output_dir else file;row=cached.get(page)
  reusable=bool(row and row.get('preservedOutsideSvg') is True and row.get('beforeHash')==hashlib.sha256(text.encode()).hexdigest() and target.exists() and row.get('afterHash')==hashlib.sha256(target.read_bytes()).hexdigest())
  if reusable:
   assert re.findall(r'data-fastppt-group="([^"]*)"',text)==re.findall(r'data-fastppt-group="([^"]*)"',target.read_text()),'cached paint/text anchor order changed'
  else:
   result,row=convert(text);row['page']=page;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(result)
  rows.append(row)
  if not reusable:
   with checkpoint.open('a') as log:log.write(json.dumps(row,ensure_ascii=False)+'\n')
  if len(rows)%100==0:print(json.dumps({'progress':len(rows),'total':len(files)}),flush=True)
 pathlib.Path(args.report).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(args.report).write_text(json.dumps({'version':1,'curveErrorBudgetSourceUnits':.08,'budgets':{'pathCharacters':150000,'paths':128,'pointsPerPath':4096,'sourcePointsTotal':8192,'geometryPointsTotal':32768,'ringsTimesPoints':250000},'pages':rows},ensure_ascii=False,indent=2));print(json.dumps({'pages':len(rows),'counts':dict(sum((collections.Counter(r['native']) for r in rows),collections.Counter()))}))
if __name__=='__main__':main()
