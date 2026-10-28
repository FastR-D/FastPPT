#!/usr/bin/env python3
"""Image-space comparison for every source/Slidev page, with reviewable evidence."""
import argparse,hashlib,json,pathlib,re
import numpy as np
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
p=argparse.ArgumentParser();p.add_argument('--source-id');args=p.parse_args()
report=OUT/(args.source_id+'-browser-comparison.json' if args.source_id else 'browser-comparison.json')
browser=json.loads(report.read_text());source={e['id']:e for e in json.loads((ROOT/'index.json').read_text())['entries']}
path=OUT/(args.source_id+'-comparison.json' if args.source_id else 'comparison.json')
previous={r['id']:r for r in json.loads(path.read_text())['records']}if path.exists()else{}
branding_path=OUT/'branding-cleanup.json'
branding={r['id']:r for r in json.loads(branding_path.read_text())['records']}if branding_path.exists()else{}
changed=set()

def metrics(a,b):
 a=np.asarray(a.resize((480,272),Image.Resampling.LANCZOS),dtype=np.float32)
 b=np.asarray(b.resize((480,272),Image.Resampling.LANCZOS),dtype=np.float32)
 mae=float(np.abs(a-b).mean()/255)
 gray=lambda x:(x[...,0]*.2126+x[...,1]*.7152+x[...,2]*.0722).reshape(34,8,60,8).transpose(0,2,1,3).reshape(-1,64)
 x=gray(a);y=gray(b);mx=x.mean(axis=1);my=y.mean(axis=1);vx=x.var(axis=1);vy=y.var(axis=1);cov=((x-mx[:,None])*(y-my[:,None])).mean(axis=1)
 ssim=float((((2*mx*my+6.5025)*(2*cov+58.5225))/((mx*mx+my*my+6.5025)*(vx+vy+58.5225))).mean())
 return {'normalizedMae':round(mae,6),'blockSsim':round(ssim,6),'changedPixelRatio':round(float((np.max(np.abs(a-b),axis=2)>24).mean()),6)}

results=[]
for record in browser['records']:
 if 'error' in record:results.append(record);continue
 try:
  orig=OUT/record['original'];replica=OUT/record['replica']
  original_hash=hashlib.sha256(orig.read_bytes()).hexdigest();replica_hash=hashlib.sha256(replica.read_bytes()).hexdigest();old=previous.get(record['id'],{})
  cleanup=branding.get(record['id']);cleanup_hash=hashlib.sha256(json.dumps(cleanup,sort_keys=True).encode()).hexdigest()if cleanup else None
  if old.get('sourceImageSha256')==original_hash and old.get('replicaImageSha256')==replica_hash and old.get('brandingCleanupSha256')==cleanup_hash and 'blockSsim'in old:
   measured={k:old[k]for k in ['normalizedMae','blockSsim','changedPixelRatio']}
   if 'rawComparison'in old:measured['rawComparison']=old['rawComparison']
  else:
   a=Image.open(orig).convert('RGB');b=Image.open(replica).convert('RGB');measured=metrics(a,b);changed.add(record['id'])
   if cleanup:
    if cleanup['afterMarkdownSha256']!=record['markdownSha256']:raise RuntimeError('Branding edit evidence is stale')
    raw=measured.copy()
    # Compare the original design outside the exact, authorized logo/text edits.
    # Keep the unmasked metric alongside it; no full-slide or broad corner masks.
    reference=a.copy();fitted=b.resize(a.size)
    for edit in cleanup['edits']:
     if not edit.get('box'):raise RuntimeError('Branding edit lacks geometric evidence')
     x,y,w,h=edit['box'];width,height=a.size
     box=(max(0,int(x*width)-3),max(0,int(y*height)-3),min(width,int((x+w)*width)+4),min(height,int((y+h)*height)+4))
     if box[2]>box[0]and box[3]>box[1]:reference.paste(fitted.crop(box),box)
    measured={**metrics(reference,b),'rawComparison':raw}
  data={**record,**measured,'sourceImageSha256':original_hash,'replicaImageSha256':replica_hash}
  if cleanup:data['brandingCleanupSha256']=cleanup_hash;data['intentionalBrandingEdits']=len(cleanup['edits'])
  data['reviewRequired']=bool(data['blockSsim']<.92 or data['normalizedMae']>.035 or data['textOverflow'] or data['textOutsidePage'] or data['missingImages'])
  results.append(data)
 except Exception as error:results.append({**record,'comparisonError':str(error),'reviewRequired':True})
summary={'version':1,'comparison':'Independent source PPTX -> LibreOffice PDF raster vs actual browser-rendered Slidev page; 8x8-block SSIM and normalized RGB MAE at 480x272. Exact authorized branding edit bounds are excluded; rawComparison retains the unmasked metrics.','sourceIndexSha256':browser['sourceIndexSha256'],'pages':len(results),'errors':sum(bool(r.get('error') or r.get('comparisonError')) for r in results),'medianBlockSsim':round(float(np.median([r['blockSsim'] for r in results if 'blockSsim'in r])),6),'medianNormalizedMae':round(float(np.median([r['normalizedMae'] for r in results if 'normalizedMae'in r])),6),'textOverflowPages':sum(bool(r.get('textOverflow')) for r in results),'textOutsidePagePages':sum(bool(r.get('textOutsidePage')) for r in results),'reviewRequiredPages':sum(bool(r.get('reviewRequired')) for r in results),'records':results}
path.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
# Each contact cell shows ORIGINAL above REPLICA, so every source page has an
# actual pair. Individual images remain available for high-resolution review.
contact=OUT/'contacts';contact.mkdir(exist_ok=True)
contact_index=contact/'index.json';old_order=json.loads(contact_index.read_text())if contact_index.exists()else[]
new_order=[r['id']for r in results]
for start in range(0,len(results),12):
 subset=results[start:start+12];target=contact/(f'{args.source_id or "all"}-{start//12+1:03d}.jpg')
 if target.exists()and old_order[start:start+12]==new_order[start:start+12]and not any(r['id']in changed or r.get('textOverflow')!=previous.get(r['id'],{}).get('textOverflow')or r.get('textOutsidePage')!=previous.get(r['id'],{}).get('textOutsidePage')for r in subset):continue
 sheet=Image.new('RGB',(1440,4*460),'#e4e9ee');draw=ImageDraw.Draw(sheet)
 for i,record in enumerate(subset):
  if 'comparisonError'in record or 'error'in record:continue
  x=i%3*480;y=i//3*460
  for row,key in enumerate(['original','replica']):
   im=Image.open(OUT/record[key]).convert('RGB');im.thumbnail((472,205));sheet.paste(im,(x,y+row*205))
  draw.text((x+5,y+413),record['id']+'  SSIM '+str(record['blockSsim']),fill='#132737')
  draw.text((x+5,y+432),'O/R | overflow '+str(record['textOverflow'])+' | outside '+str(record['textOutsidePage']),fill='#7c2424' if record['reviewRequired'] else '#246749')
 sheet.save(target,quality=85)
contact_index.write_text(json.dumps(new_order)+'\n')
for stale in contact.glob(f'{args.source_id or "all"}-*.jpg'):
 if int(stale.stem.rsplit('-',1)[1])>(len(results)+11)//12:stale.unlink()
# A self-contained, local review UI supports sequential inspection of all pairs.
metadata=[{k:r.get(k) for k in ['id','source','sourcePage','original','replica','blockSsim','normalizedMae','textOverflow','textOutsidePage','reviewRequired','error','comparisonError']}for r in results]
review='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>原稿 / Slidev 逐页对比</title><style>body{margin:0;background:#111916;color:#edf5f0;font:14px system-ui}header{position:sticky;top:0;background:#14251e;padding:14px;display:flex;gap:12px;align-items:center}button,input,select{padding:8px;background:#1f352b;color:white;border:1px solid #426351;border-radius:6px}main{padding:18px}section{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;background:white}figure{margin:0}figcaption{padding:8px}p{color:#aebfb5}a{color:#7de4b8}#status{margin-left:auto}</style><header><button id="prev">上一页</button><input id="page" type="number" min="1"><button id="next">下一页</button><select id="filter"><option value="all">全部页面</option><option value="issues">待复核页面</option></select><span id="status"></span></header><main><h2 id="title"></h2><p id="meta"></p><section><figure><figcaption>原始 PPT 渲染</figcaption><img id="original"></figure><figure><figcaption>Slidev 复刻</figcaption><img id="replica"></figure></section></main><script>const rows=DATA;let items=rows,index=0;function render(){const r=items[index];if(!r)return;document.querySelector('#title').textContent=r.id+' · '+r.sourcePage;document.querySelector('#meta').textContent=r.source+' | SSIM '+r.blockSsim+' | MAE '+r.normalizedMae+' | 文字框溢出 '+r.textOverflow+' | 文字出界 '+r.textOutsidePage;document.querySelector('#original').src=r.original;document.querySelector('#replica').src=r.replica;document.querySelector('#page').value=index+1;document.querySelector('#status').textContent=(index+1)+' / '+items.length}function go(delta){index=Math.max(0,Math.min(items.length-1,index+delta));render()}document.querySelector('#prev').onclick=()=>go(-1);document.querySelector('#next').onclick=()=>go(1);document.querySelector('#page').onchange=e=>{index=Math.max(0,Math.min(items.length-1,Number(e.target.value)-1));render()};document.querySelector('#filter').onchange=e=>{items=e.target.value==='issues'?rows.filter(r=>r.reviewRequired):rows;index=0;render()};onkeydown=e=>{if(e.target.tagName==='INPUT')return;if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)};render();</script></html>'''.replace('DATA',json.dumps(metadata,ensure_ascii=False).replace('</','<\\/'))
(OUT/(args.source_id+'-review.html' if args.source_id else 'review.html')).write_text(review)
print(json.dumps({k:v for k,v in summary.items() if k!='records'},ensure_ascii=False))
