#!/usr/bin/env python3
"""Extract creative object motion from local PPTX; keep original timing, no video flattening."""
import collections,copy,csv,hashlib,html,json,math,pathlib,re,shutil,zipfile
from lxml import etree
from pptx import Presentation
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'packages/animations';RES=ROOT/'packages/resources'
P='http://schemas.openxmlformats.org/presentationml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';NS={'p':P,'a':A}
DEDICATED='c9f1632d31e4'
USES={'文字创意':['标题逐字出现','关键词强调','数字与标语揭示'],'图片创意':['产品展示','照片切换','局部细节揭示'],'遮罩揭示':['产品发布揭幕','图片从中心展开','分区擦除与节奏切换'],'路径运动':['视线引导','流程演进','轨迹与粒子效果'],'旋转与强调':['焦点强调','旋转展示','装饰元素律动'],'缩放与弹性':['弹性标题','数据放大强调','图片生长与展开'],'组合编排':['多对象交错','分镜叙事','图文组合进入'],'对象进出':['渐入与退出','顺序揭示','内容节奏控制']}
def read(p):return json.loads(p.read_text())
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def clean(t):return re.sub(r'旁门左道|旁友圈|PMZDPPT|Cappuccino','创意效果',t,flags=re.I)
def value(n):
 if n is None:return None
 if n.get('val')is not None:return n.get('val')
 if n.get('x')is not None:return {'x':float(n.get('x'))/100000,'y':float(n.get('y'))/100000}
 if len(n):return value(n[0])
 return n.text

def extract(tree,rid):
 effects=[];warnings=[]
 for i,n in enumerate(tree.xpath('.//p:timing//p:cTn[@presetClass]',namespaces=NS)):
  targets=list(dict.fromkeys(n.xpath('.//p:spTgt/@spid',namespaces=NS)))
  if len(targets)!=1:warnings.append('multiple-source-targets');continue
  spid=targets[0];behaviors=[];durations=[]
  original_xml=etree.tostring(n,encoding='unicode');n=copy.deepcopy(n);normalized_loop=False
  for timing in n.xpath('.//p:cTn|self::p:cTn',namespaces=NS):
   repeat=timing.get('repeatCount')
   if repeat=='indefinite' or repeat and repeat.isdigit() and int(repeat)>16000:
    timing.set('repeatCount','2000');normalized_loop=True
  if normalized_loop:warnings.append('creative-loop-normalized-to-two-cycles')
  for b in n.xpath('./p:childTnLst/*|./p:subTnLst/*',namespaces=NS):
   tag=etree.QName(b).localname
   if tag not in ['anim','set','animEffect','animScale','animRot','animMotion','animClr']:
    warnings.append('browser-unsupported-'+tag);continue
   time=b.find('p:cBhvr/p:cTn',NS)
   if time is None:continue
   dur=time.get('dur','1');duration=float(dur)if dur.isdigit()else 1000;durations.append(duration)
   delay=b.xpath('./p:cBhvr/p:cTn/p:stCondLst/p:cond/@delay',namespaces=NS)
   attrs=b.xpath('./p:cBhvr/p:attrNameLst/p:attrName/text()',namespaces=NS)
   frames=[]
   for f in b.xpath('./p:tavLst/p:tav',namespaces=NS):
    frames.append({'at':float(f.get('tm','0'))/100000,'value':value(f.find('p:val',NS)),'formula':f.get('fmla')})
   behaviors.append({'type':tag,'attribute':attrs[0]if attrs else None,'durationMs':duration,'delayMs':float(delay[0])if delay and delay[0].isdigit()else 0,'frames':frames,
    'from':value(b.find('p:from',NS))or b.get('from'),'to':value(b.find('p:to',NS))or b.get('to'),'by':value(b.find('p:by',NS))or b.get('by'),
    'filter':b.get('filter'),'transition':b.get('transition'),'path':b.get('path'),'autoReverse':time.get('autoRev')=='1','repeat':float(time.get('repeatCount','1000'))/1000 if time.get('repeatCount','1000').isdigit()else 1,
    'accel':float(time.get('accel','0'))/100000,'decel':float(time.get('decel','0'))/100000})
  if not behaviors:continue
  root=copy.deepcopy(n)
  for cond in root.findall('p:stCondLst',NS):root.remove(cond)
  # Graphic/text range selectors refer to Office chart/text internals; a generic
  # editable object uses the whole target. Preserve originals as evidence only.
  if root.xpath('.//p:graphicEl|.//p:txEl',namespaces=NS):warnings.append('source-subobject-range-adapted-to-whole-object')
  for child in root.xpath('.//p:spTgt/*',namespaces=NS):child.getparent().remove(child)
  etree.cleanup_namespaces(root)
  trigger={'withEffect':'with-previous','afterEffect':'after-previous','clickEffect':'on-click'}.get(n.get('nodeType'),'with-previous')
  delays=n.xpath('./p:stCondLst/p:cond/@delay',namespaces=NS);delay=float(delays[0])if delays and delays[0].isdigit()else 0
  klass=n.get('presetClass','entr')
  base_duration=max([b['delayMs']+b['durationMs']*max(.001,b['repeat'])*(2 if b['autoReverse']else 1)for b in behaviors]or[400])
  root_timing={'baseDurationMs':base_duration,'repeat':float(n.get('repeatCount','1000'))/1000,'autoReverse':n.get('autoRev')=='1','accel':float(n.get('accel','0'))/100000,'decel':float(n.get('decel','0'))/100000}
  source_duration=base_duration*root_timing['repeat']*(2 if root_timing['autoReverse']else 1)
  if 'rand('in etree.tostring(n,encoding='unicode'):warnings.append('browser-random-motion-is-seeded')
  ignored={b['attribute']for b in behaviors if b['type']=='anim' and b['attribute']not in ['ppt_x','ppt_y','ppt_w','ppt_h','ppt_r','style.rotation','transform.rotation_z','style.opacity','style.fontSize']}
  if ignored:warnings.append('browser-unsupported-properties:'+','.join(sorted(ignored)))
  params={'rootTiming':root_timing,'sourceDurationMs':source_duration,'nativeXml':etree.tostring(root,encoding='unicode'),'sourceSpid':spid,'sourceOrder':i,'class':klass,'presetId':n.get('presetID'),'behaviors':behaviors}
  if normalized_loop:params['nativeOriginalXml']=original_xml
  if n.find('p:iterate',NS)is not None:warnings.append('browser-whole-object-iteration; native-pptx-retains-iterate')
  effects.append({'id':f'{rid}-effect-{i+1}','kind':'native','target':'s'+spid,'trigger':trigger,'delayMs':delay,'durationMs':source_duration,'params':params})
 return effects,sorted(set(warnings))

def timeline_duration(effects):
 offset=group_end=previous_start=previous_end=total=0
 for e in effects:
  if e['trigger']=='on-click':offset+=group_end;group_end=previous_start=previous_end=0
  start=e['delayMs']+(previous_start if e['trigger']=='with-previous'else previous_end if e['trigger']=='after-previous'else 0)
  previous_start=start;previous_end=start+e['durationMs'];group_end=max(group_end,previous_end);total=max(total,offset+previous_end)
 return total

def category(effects,title):
 text=title.lower();types={b['type']for e in effects for b in e['params']['behaviors']};filters=' '.join(b.get('filter')or'' for e in effects for b in e['params']['behaviors'])
 if any(k in text for k in ['文字','文本','字体','打字','逐字','字母']):return '文字创意'
 if any(k in text for k in ['伸展','生长','弹','缩放','拉伸','放大','缩小']):return '缩放与弹性'
 if 'animMotion'in types:return '路径运动'
 if any(k in filters for k in ['wipe','barn','strips','circle','wheel','randombar']):return '遮罩揭示'
 if 'animRot'in types:return '旋转与强调'
 if 'animScale'in types:return '缩放与弹性'
 if any(k in text for k in ['图片','图像','照片']):return '图片创意'
 return '组合编排'if len(effects)>1 else '对象进出'

def migrate(sources):
 if (OUT/'migration.json').exists():return
 index=read(RES/'index.json');moving=[e for e in index['entries']if e['id'].startswith(DEDICATED+'-')];ids={e['id']for e in moving};moved_assets=set();kept_assets=set()
 for e in index['entries']:
  assets=set(re.findall(r'\.\./assets/([a-f0-9]+\.[a-z0-9]+)',(RES/e['file']).read_text()))
  (moved_assets if e['id']in ids else kept_assets).update(assets)
 for e in moving:
  for sub in ['pages','evidence','thumbnails']:
   suffix='.md'if sub=='pages'else'.json'if sub=='evidence'else'.jpg';p=RES/sub/(e['id']+suffix)
   if p.exists():dest=OUT/'reference'/sub/p.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.move(p,dest)
 for name in moved_assets:
  p=RES/'assets'/name;dest=OUT/'reference/assets'/name;dest.parent.mkdir(parents=True,exist_ok=True)
  if name in kept_assets:shutil.copy2(p,dest)
  else:shutil.move(p,dest)
 visual=RES/'visual-comparison'
 for p in list(visual.rglob(DEDICATED+'*')):
  if p.exists():dest=OUT/'reference/visual-comparison'/p.relative_to(visual);dest.parent.mkdir(parents=True,exist_ok=True);shutil.move(p,dest)
 for p in visual.glob('*.json'):
  data=read(p)
  if not isinstance(data,dict):continue
  changed=False
  for k in ['records','results']:
   if k in data and isinstance(data[k],list):
    kept=[row for row in data[k]if not isinstance(row,dict)or row.get('id')not in ids]
    if len(kept)!=len(data[k]):data[k]=kept;changed=True
  if changed:
   if 'pages'in data:data['pages']=len(data.get('records',data.get('results',[])))
   if 'edits'in data:data['edits']=sum(len(row.get('edits',[]))for row in data['records']);data['reasonCounts']=dict(collections.Counter(e['reason']for row in data['records']for e in row['edits']))
   write(p,data)
 index['entries']=[e for e in index['entries']if e['id']not in ids];write(RES/'index.json',index)
 scan=read(RES/'scan-report.json');source=next(s for s in sources if s['id']==DEDICATED);scan['sources']=[s for s in scan['sources']if s['id']!=DEDICATED];scan['pageCount']=len(index['entries']);scan['sourceCount']=len(scan['sources']);scan['statusCounts']=dict(collections.Counter(e['status']for e in index['entries']));write(RES/'scan-report.json',scan)
 write(OUT/'reference/index.json',{'version':1,'entries':moving})
 write(OUT/'migration.json',{'version':1,'sources':[source],'movedPages':len(moving),'destination':'packages/animations','purpose':'Creative effect references and object-level motion; static originals are audit references only'})

def source_objects(slide):
 result={}
 def visit(shapes):
  for shape in shapes:
   text=clean(shape.text.strip())if shape.has_text_frame else ''
   result['s'+str(shape.shape_id)]={'sourceShapeId':str(shape.shape_id),'sourceName':clean(shape.name),'sourceType':str(shape.shape_type),'sourceText':text[:240],'bounds':{'x':shape.left,'y':shape.top,'width':shape.width,'height':shape.height}}
   if hasattr(shape,'shapes'):visit(shape.shapes)
 visit(slide.shapes)
 return result

def demo_page(rid,title,cat,targets,objects,doc):
 body=[];slots=[];count=len(targets);dense=count>12
 columns=math.ceil(math.sqrt(count*16/9))if dense else min(4,count)
 rows=math.ceil(count/columns)
 colors=['#245e79','#b55f3e','#547d62','#826b98']
 for j,target in enumerate(targets):
  source=objects.get(target,{'sourceShapeId':target[1:],'sourceType':'unknown','sourceName':'','sourceText':'','bounds':{}})
  text=source.get('sourceText','');kind=source.get('sourceType','');color=colors[j%4]
  role='particle'if dense else 'product-image'if 'PICTURE'in kind or cat=='图片创意'else 'headline'if text or cat=='文字创意'else 'path-node'if cat=='路径运动'else 'metric'if cat=='缩放与弹性'else 'accent-shape'if cat=='旋转与强调'else ['headline','product-image','metric','path-node'][j%4]
  label={'particle':'轨迹粒子','product-image':'产品视觉','headline':'标题文本','path-node':'流程节点','metric':'关键数字','accent-shape':'强调图形'}[role]
  slot={'target':target,'slot':f'{role}-{j+1}','role':role,'replaceWith':{'headline':'替换标题或短段落，保留原生文字以复用逐字动画','product-image':'替换为原生 img 或 figure，绑定外层锚点','metric':'替换数字与单位','path-node':'替换节点文字，保留路径动画','accent-shape':'替换 CSS 几何形状','particle':'替换粒子颜色或形状，保留全部目标参与编排'}[role],**source}
  slots.append(slot)
  x=7+(j%columns)*(86/columns);y=20+(j//columns)*(68/rows);w=86/columns*.88;h=68/rows*.82
  style=f'position:absolute;left:{x:.4f}%;top:{y:.4f}%;width:{w:.4f}%;height:{h:.4f}%;box-sizing:border-box;'
  if dense:
   inner=f'<span aria-hidden="true" style="display:block;width:60%;height:60%;margin:10% auto;border-radius:{"50%"if j%3 else "15%"};background:{color}"></span>'
  elif role=='headline':
   content=html.escape((text.split('\n')[0][:(8 if count>4 else 24)]if text else '让想法被看见'))
   inner=f'<h2 style="margin:0;color:{color};overflow-wrap:anywhere;font:650 {min(4.2,w*.12):.3f}cqw/1.25 Arial,sans-serif">{content}</h2><p style="margin:1.4cqh 0 0;color:#5a6670;font:400 {min(1.6,w*.07):.3f}cqw/1.5 Arial,sans-serif">让重点自然浮现。</p>'
  elif role=='product-image':
   inner=f'<figure style="margin:0;width:100%;height:100%;background:#e7edf0;border-radius:1.5cqw;display:flex;align-items:center;justify-content:center;flex-direction:column"><div aria-hidden="true" style="width:38%;height:52%;border-radius:1cqw;background:{color};box-shadow:1cqw 1cqw 0 #cad7de"></div><figcaption style="margin-top:2cqh;font:500 {min(1.5,w*.07):.3f}cqw Arial;color:#354f60">PRODUCT / 替换产品图片</figcaption></figure>'
  elif role=='metric':
   inner=f'<div style="color:{color};font:650 {min(8,w*.30):.3f}cqw/1 Arial,sans-serif">{72+j}<span style="font-size:.4em">%</span></div><p style="margin:1.8cqh 0;font:500 {min(1.6,w*.07):.3f}cqw Arial;color:#53616b">关键指标 · 增长表现</p>'
  elif role=='path-node':
   inner=f'<div style="width:5cqw;height:5cqw;max-width:60%;border:0.35cqw solid {color};border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 1.6cqw Arial;color:{color}">{j+1:02d}</div><p style="font:500 {min(1.6,w*.07):.3f}cqw Arial;color:#53616b">发现 → 连接 → 抵达</p>'
  else:
   inner=f'<div aria-hidden="true" style="width:65%;height:80%;background:{color};border-radius:{"50%"if j%2 else "12%"};transform:rotate(-12deg)"></div>'
  body.append(f'<div data-fastppt-group="{target}" data-animation-slot="{slot["slot"]}" data-animation-role="{role}" aria-label="{label} {j+1}" style="{style}">{inner}</div>')
 payload=html.escape(json.dumps(doc,ensure_ascii=False,separators=(',',':')),quote=True)
 metadata=html.escape(json.dumps({'version':1,'purpose':cat,'objects':slots},ensure_ascii=False,separators=(',',':')),quote=True)
 header='<header style="position:absolute;left:7%;top:6%;color:#53616b;font:500 1.4cqw Arial,sans-serif">OBJECT MOTION / '+html.escape(cat)+f' · {count} 个可替换对象</header>'
 md='---\nlayout: none\ntitle: '+json.dumps(title,ensure_ascii=False)+'\n---\n\n<div v-pre style="position:absolute;inset:0;container-type:size;background:#f7f6f2;overflow:visible">'+header+''.join(body)+f'<template data-animation-objects="{metadata}"></template><template data-fastppt-motion="{payload}"></template></div>\n'
 audit={'id':rid,'htmlObjects':count,'svgElements':0,'targetCount':count,'coveredTargets':targets,'missingTargets':[],'denseComposition':dense,'overflowRisk':'motion-may-leave-stage; base geometry fits stage','roles':dict(collections.Counter(o['role']for o in slots))}
 return md,slots,audit

sources=read(RES/'scan-report.json')['sources']
if (OUT/'migration.json').exists():sources+=read(OUT/'migration.json')['sources']
migrate(sources)
entries=[];stats=collections.Counter();source_records=[];page_records=[]
for s in sources:
 with zipfile.ZipFile(ROOT/s['path'])as archive:
  prs=Presentation(ROOT/s['path']);animated=0
  for page,slide in enumerate(prs.slides,1):
   tree=etree.fromstring(etree.tostring(slide._element));rid=f'{s["id"]}-{page:04d}'
   effects,warnings=extract(tree,rid)
   if not effects:continue
   animated+=1;stats['effects']+=len(effects)
   labels=[clean(sh.text.strip())for sh in slide.shapes if sh.has_text_frame and sh.text.strip() and not re.fullmatch(r'Cappuccino|旁门左道|PPT',sh.text.strip(),re.I)]
   title=' / '.join(dict.fromkeys(labels))[:120]or f'创意效果 {page}'
   cat=category(effects,title);targets=list(dict.fromkeys(e['target']for e in effects));groups=[{'id':target,'label':target,'static':False,'effects':[e for e in effects if e['target']==target]}for target in targets]
   doc={'version':1,'slideId':rid,'transition':{'kind':'none','durationMs':500},'groups':groups,'source':'system','diagnostics':warnings}
   if '--samples'not in __import__('sys').argv:write(OUT/'motions'/(rid+'.json'),doc)
   count=len(targets);md,slots,page_audit=demo_page(rid,title,cat,targets,source_objects(slide),doc);page_records.append(page_audit)
   path=(pathlib.Path('/tmp/animation-samples')if '--samples'in __import__('sys').argv else OUT/'pages')/(rid+'.md');path.parent.mkdir(exist_ok=True);
   if '--samples'not in __import__('sys').argv or len(entries) in [0,15,40]:path.write_text(md)
   entry={'useCases':USES[cat],'id':rid,'title':title,'category':cat,'scope':'multi-object'if count>1 else'object','source':s['path'],'sourcePage':page,'file':'pages/'+rid+'.md','motionFile':'motions/'+rid+'.json','aspect':16/9,'targets':targets,'effects':len(effects),'durationMs':timeline_duration(effects),'warnings':warnings,'origin':'creative-library'if s['id']==DEDICATED else'layout-motion','tags':[cat,'创意效果','对象动画',*sorted(set(e['params']['class']for e in effects))],'revision':hashlib.sha256(md.encode()).hexdigest()[:16]}
   entry['objects']=slots;entry['objectCount']=count;entry['objectRoles']=sorted(set(o['role']for o in slots));entry['tags']+=entry['objectRoles'];entries.append(entry)
  source_records.append({**s,'animatedPages':animated});print(s['id'],animated,'motion references',flush=True)
if '--samples'in __import__('sys').argv:
 write(pathlib.Path('/tmp/animation-samples/report.json'),{'samples':[entries[i]for i in [0,15,40]],'audit':page_records});raise SystemExit(0)
write(OUT/'index.json',{'version':1,'entries':entries});write(OUT/'scan-report.json',{'version':1,'sources':source_records,'motionPages':len(entries),'effects':stats['effects'],'creativePages':sum(e['origin']=='creative-library'for e in entries),'nativeDemoAudit':{'pages':len(page_records),'htmlObjects':sum(r['htmlObjects']for r in page_records),'svgElements':0,'missingTargets':0},'records':page_records})
fields=['id','title','category','scope','objectCount','objectRoles','effects','durationMs','source','sourcePage','file','motionFile','useCases','warnings']
with (OUT/'manifest.csv').open('w',newline='')as f:
 writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
 for e in entries:writer.writerow({k:' | '.join(e[k])if isinstance(e[k],list)else e[k]for k in fields})
print(json.dumps({'motionReferences':len(entries),'effects':stats['effects'],'movedDedicatedPages':211},ensure_ascii=False))
