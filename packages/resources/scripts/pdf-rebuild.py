#!/usr/bin/env python3
"""Source-rendered vector geometry plus independently editable HTML text.
No slide screenshot substitution: SVG paint layers, image assets and text runs
remain separate. Text/font metrics and every page are measured against originals.
"""
import argparse,base64,collections,hashlib,io,json,math,pathlib,re,subprocess,copy
import pymupdf as fitz
from lxml import etree
from PIL import Image
from fontTools.ttLib import TTFont
ROOT=pathlib.Path(__file__).resolve().parents[3];LIB=pathlib.Path(__file__).resolve().parents[1]
SVG='http://www.w3.org/2000/svg';XLINK='http://www.w3.org/1999/xlink'
ns={'s':SVG}; esc=lambda value: __import__('html').escape(str(value),quote=True)
num=lambda value:f'{value:.7f}'.rstrip('0').rstrip('.') or '0'
font_cache={}

def resolve_font(name,flags):
 key=(name,flags&18)
 if key in font_cache:return font_cache[key]
 plain=re.sub(r'^[A-Z]{6}\+','',name).replace('-VKana','')
 target=plain
 families={'NotoSansCJKjp':'Noto Sans CJK JP','NotoSansCJKsc':'Noto Sans CJK SC','NotoSerifCJKjp':'Noto Serif CJK JP','NotoSerifCJKsc':'Noto Serif CJK SC','DejaVuSans':'DejaVu Sans','DejaVuSerif':'DejaVu Serif','LiberationSans':'Liberation Sans','LiberationSerif':'Liberation Serif','Arial':'Arial','MicrosoftYaHei':'Microsoft YaHei','MSYaHei':'Microsoft YaHei','SimSun':'SimSun','Calibri':'Calibri','TimesNewRoman':'Times New Roman'}
 for prefix,family in families.items():
  if plain.startswith(prefix):target=family;break
 bold=bool(flags&16 or re.search('Bold|Heavy|Black',plain,re.I));italic=bool(flags&2 or re.search('Italic|Oblique',plain,re.I))
 pattern=target+(':weight=200' if bold else '')+(':slant=100' if italic else '')
 match=subprocess.check_output(['fc-match','-f','%{family[0]}|%{file}|%{index}','--',pattern],text=True).split('|')
 family,file,index=match[0],match[1],int(match[2] or 0)
 ascent=.93;descent=.24
 try:
  f=TTFont(file,fontNumber=index,lazy=True);units=f['head'].unitsPerEm;metrics=f['hhea'];ascent=metrics.ascent/units;descent=-metrics.descent/units
  if 'OS/2' in f and f['OS/2'].fsSelection&(1<<7):ascent=f['OS/2'].sTypoAscender/units;descent=-f['OS/2'].sTypoDescender/units
  f.close()
 except Exception:pass
 result={'family':family,'file':file,'bold':bold,'italic':italic,'baselineEm':(1-ascent-descent)/2+ascent}
 font_cache[key]=result;return result

def convert(entry,page):
 width,height=page.rect.width,page.rect.height
 source_svg=etree.fromstring(page.get_svg_image(text_as_path=False).encode())
 # Remove only PDF text paint; HTML runs below retain all extracted wording.
 for text in source_svg.xpath('.//s:text',namespaces=ns):text.getparent().remove(text)
 for image in source_svg.xpath('.//s:image',namespaces=ns):
  attr='{'+XLINK+'}href' if image.get('{'+XLINK+'}href') else 'href';href=image.get(attr,'')
  if not href.startswith('data:'):continue
  meta,data=href.split(',',1);blob=base64.b64decode(data);ext=meta.split('/')[1].split(';')[0]
  if ext=='jpeg':ext='jpg'
  # Retain alpha/vector diagrams. Opaque PDF raster pictures use JPEG to avoid
  # re-encoding source JPEGs as multi-megabyte PNGs during SVG extraction.
  try:
   image_data=Image.open(io.BytesIO(blob))
   if image_data.mode in ('RGB','L') and len(blob)>200000:
    out=io.BytesIO();image_data.convert('RGB').save(out,format='JPEG',quality=92);blob=out.getvalue();ext='jpg'
  except Exception:pass
  name=hashlib.sha256(blob).hexdigest()[:24]+'.'+ext;asset=LIB/'assets'/name
  if not asset.exists():asset.write_bytes(blob)
  image.set(attr,'../assets/'+name)
 # Scope every SVG reference. Each paint layer remains a separate selectable
 # vector group, rather than flattening an entire slide into a single image.
 ids={el.get('id'):entry['id']+'-'+el.get('id') for el in source_svg.xpath('.//*[@id]')}
 for el in source_svg.iter():
  for key,value in list(el.attrib.items()):
   if key=='id':value=ids.get(value,value)
   else:
    value=re.sub(r'url\(#([^)]*)\)',lambda m:'url(#'+ids.get(m[1],m[1])+')',value)
    if key in ('href','{'+XLINK+'}href') and value.startswith('#'):value='#'+ids.get(value[1:],value[1:])
   el.set(key,value)
 defs=source_svg.find('{'+SVG+'}defs');definitions=etree.tostring(defs,encoding='unicode') if defs is not None else ''
 # One shared, non-painted definitions block; no repeated image data per layer.
 body=['<svg xmlns="'+SVG+'" style="position:absolute;width:0;height:0;pointer-events:none" aria-hidden="true">'+definitions+'</svg>']
 layers=[];paint_counter=[0];text_paints=collections.defaultdict(collections.deque);text_opacity={}
 normalize=lambda value:re.sub(r'\s+','',value)
 def visit(node,ancestors):
  tag=etree.QName(node).localname
  if tag=='defs':return
  if tag=='text':
   text_paints[normalize(''.join(node.itertext()))].append(paint_counter[0]);paint_counter[0]+=1;return
  if tag in ('path','rect','circle','ellipse','line','polyline','polygon','image','use'):
   child=copy.deepcopy(node)
   for parent in reversed(ancestors):
    wrapper=etree.Element(parent.tag,attrib=dict(parent.attrib),nsmap=parent.nsmap);wrapper.append(child);child=wrapper
   layers.append((paint_counter[0],child));paint_counter[0]+=1;return
  for child in node:visit(child,ancestors+[node] if tag not in ('svg',) else ancestors)
 # Traverse paint order before deleting SVG text. A label stays between the same
 # foreground/background objects; later opaque shapes still cover earlier labels.
 original_tree=etree.fromstring(page.get_svg_image(text_as_path=False).encode())
 # Reuse the safely externalized/scoped paint tree, but collect source text paint
 # ordering separately; PDF text extraction itself preserves content-stream order.
 def text_order(node):
  tag=etree.QName(node).localname
  if tag=='defs':return
  if tag=='text':
   opacity=1
   for parent in [node,*node.iterancestors()]:opacity*=float(parent.get('opacity','1'))
   opacity*=float(node.get('fill-opacity','1'))
   text_opacity[paint_counter[0]]=opacity
   text_paints[normalize(''.join(node.itertext()))].append(paint_counter[0]);paint_counter[0]+=1;return
  if tag in ('path','rect','circle','ellipse','line','polyline','polygon','image','use'):paint_counter[0]+=1;return
  for child in node:text_order(child)
 text_order(original_tree);max_paint=paint_counter[0];paint_counter[0]=0
 # Scoped tree no longer has text nodes, so match graphics paint order against the
 # original traversal's interleaving by collecting those original graphic indices.
 graphic_indices=[];position=[0]
 def graphic_order(node):
  tag=etree.QName(node).localname
  if tag=='defs':return
  if tag in ('text','path','rect','circle','ellipse','line','polyline','polygon','image','use'):
   if tag!='text':graphic_indices.append(position[0])
   position[0]+=1;return
  for child in node:graphic_order(child)
 graphic_order(original_tree)
 visit(source_svg,[])
 for index,(_,child) in enumerate(layers):
  order=graphic_indices[index] if index<len(graphic_indices) else index
  body.append('<svg xmlns="'+SVG+'" xmlns:xlink="'+XLINK+'" viewBox="0 0 '+num(width)+' '+num(height)+'" width="100%" height="100%" data-fastppt-group="paint-'+str(index)+'" style="position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:'+str(order)+'">'+etree.tostring(child,encoding='unicode')+'</svg>')
 slots=[]
 for block in page.get_text('dict',flags=fitz.TEXT_PRESERVE_WHITESPACE|fitz.TEXT_PRESERVE_LIGATURES)['blocks']:
  if 'lines' not in block:continue
  for line in block['lines']:
   dx,dy=line['dir'];angle=math.degrees(math.atan2(dy,dx))
   for span in line['spans']:
    text=span['text']
    if not text:continue
    fm=resolve_font(span['font'],span['flags']);size=span['size'];origin=span['origin'];box=span['bbox'];x=origin[0];y=origin[1]-fm['baselineEm']*size
    anchor='text-'+str(len(slots));style=f'position:absolute;left:{num(x/width*100)}%;top:{num(y/height*100)}%;font-size:{num(size/width*100)}cqw;font-family:{esc(json.dumps(fm["family"],ensure_ascii=False))},sans-serif;font-weight:{700 if fm["bold"] else 400};font-style:{"italic" if fm["italic"] else "normal"};line-height:1;white-space:pre;color:#{span["color"]:06x};margin:0;padding:0;border:0;box-sizing:content-box;overflow:visible;transform-origin:{num(0)} {num(fm["baselineEm"]*size/width*100)}cqw'
    queue=text_paints.get(normalize(text));order=queue.popleft() if queue else max_paint+len(slots)
    style+=';z-index:'+str(order)
    if angle:style+=';transform:rotate('+num(angle)+'deg)'
    # The reference bbox is evidence, not a clipping frame. Content may be
    # modestly wider because fonts were substituted; the browser repair handles it.
    style+=';width:max-content;height:'+num(size/width*100)+'cqw;opacity:'+num(text_opacity.get(order,span.get('alpha',255)/255))
    body.append('<span data-reference-box="'+','.join(num(v) for v in [box[0]/width,box[1]/height,(box[2]-box[0])/width,(box[3]-box[1])/height])+'" data-resource-text="true" data-source-font="'+esc(span['font'])+'" data-reference-width="'+num((box[2]-box[0])/width)+'" data-fastppt-group="'+anchor+'" style="'+style+'">'+esc(text)+'</span>')
    slots.append({'anchor':anchor,'text':text,'box':[box[0]/width,box[1]/height,(box[2]-box[0])/width,(box[3]-box[1])/height],'origin':[origin[0]/width,origin[1]/height],'font':span['font'],'size':size,'resolvedFamily':fm['family']})
 html='<div v-pre class="fp-resource-'+entry['id']+'" style="position:absolute;inset:0;container-type:size;background:white;font-family:Arial,sans-serif;font-size:1cqw;overflow:visible">'+''.join(body)+'</div>'
 markdown='---\nlayout: none\ntitle: '+json.dumps(entry['title'],ensure_ascii=False)+'\n---\n\n'+html+'\n\n<!-- Source: '+entry['source']+' #'+str(entry['sourcePage'])+'; independent vector paint layers and editable HTML text reconstructed from the source rendering. -->\n'
 return markdown,slots,len(layers)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-id');p.add_argument('--limit',type=int,default=10000);args=p.parse_args()
 index=json.loads((LIB/'index.json').read_text());sources=json.loads((LIB/'scan-report.json').read_text())['sources'];out=LIB/'visual-comparison';(out/'before').mkdir(exist_ok=True,parents=True)
 records=[]
 for source in sources:
  if args.source_id and source['id'] not in args.source_id.split(','):continue
  pdfs=list((out/'originals'/source['id']).glob('*.pdf'))
  if not pdfs:print('MISSING ORIGINAL',source['id'],flush=True);continue
  doc=fitz.open(pdfs[0])
  if len(doc)!=source['pages']:print('PAGE COUNT MISMATCH',source['id'],flush=True);continue
  for entry in [e for e in index['entries'] if e['source']==source['path']][:args.limit]:
   path=LIB/entry['file'];backup=out/'before'/(entry['id']+'.md')
   if not backup.exists():backup.write_bytes(path.read_bytes())
   try:
    md,slots,layers=convert(entry,doc[entry['sourcePage']-1]);temp=path.with_suffix('.tmp');temp.write_text(md);temp.replace(path)
    charts=re.findall(r'data-fastppt-chart="([^"]+)"',backup.read_text())
    if charts:
     at=md.rindex('</div>');md=md[:at]+''.join('<template data-fastppt-chart="'+data+'"></template>'for data in charts)+md[at:];path.write_text(md)
    evidence_path=LIB/'evidence'/(entry['id']+'.json');evidence=json.loads(evidence_path.read_text());evidence['reconstructedSlots']=slots;evidence['reconstruction']='source-rendered independent vector layers + HTML text';evidence_path.write_text(json.dumps(evidence,ensure_ascii=False)+'\n')
    record={'id':entry['id'],'source':entry['source'],'sourcePage':entry['sourcePage'],'markdownSha256':hashlib.sha256(md.encode()).hexdigest(),'layers':layers,'textSpans':len(slots),'original':f'originals/{source["id"]}/{entry["sourcePage"]:04d}.jpg','renderer':'source-pdf-vector-html','changed':True}
   except Exception as error:record={'id':entry['id'],'error':str(error),'changed':False}
   records.append(record)
  (out/(source['id']+'-pdf-rebuild.json')).write_text(json.dumps({'source':source,'records':[r for r in records if r['id'].startswith(source['id'])]},ensure_ascii=False,indent=2)+'\n')
  print(source['id'],len(doc),'pages converted',flush=True)
 (out/'font-resolution.json').write_text(json.dumps([{'name':k[0],'flags':k[1],**v} for k,v in font_cache.items()],ensure_ascii=False,indent=2)+'\n')
