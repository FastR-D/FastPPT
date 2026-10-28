#!/usr/bin/env python3
"""Deterministic page-by-page PPTX inventory and editable Slidev reconstruction.
No remote code, no changes to references. Unsupported features are evidence, never
silently called faithful. Re-run from any cwd; IDs use relative source paths.
"""
import argparse, collections, csv, hashlib, html, json, math, pathlib, re, sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from lxml import etree

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(__file__).resolve().parents[1]
NS = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main', 'p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
A = '{'+NS['a']+'}'
esc = lambda x: html.escape(str(x), quote=True)
num = lambda x: f'{x:.4f}'.rstrip('0').rstrip('.') or '0'

def children(el, query): return el.xpath(query)
def first(el, query):
    found = children(el, query)
    return found[0] if found else None

def color(el, palette, fallback='#263449'):
    if el is None: return fallback
    tag = etree.QName(el).localname
    value = el.get('val', '')
    if tag == 'srgbClr': result = '#'+value
    elif tag == 'schemeClr': result = palette.get(value, fallback)
    elif tag == 'sysClr': result = '#'+el.get('lastClr', '263449')
    else: return fallback
    try:
        rgb = [int(result[i:i+2],16) for i in (1,3,5)]
        for t in el:
            kind=etree.QName(t).localname; val=int(t.get('val','100000'))/100000
            if kind in ('lumMod','shade'): rgb=[v*val for v in rgb]
            elif kind in ('tint','lumOff'): rgb=[v+(255-v)*val if kind=='tint' else v+255*val for v in rgb]
        alpha=next((int(t.get('val','100000'))/100000 for t in el if etree.QName(t).localname=='alpha'),1)
        return '#'+''.join(f'{max(0,min(255,round(v))):02x}' for v in rgb)+(f'{max(0,min(255,round(alpha*255))):02x}' if alpha<1 else '')
    except ValueError: return fallback

def fill(el, palette, fallback='transparent'):
    if el is None: return fallback
    if first(el,'./a:noFill') is not None: return 'transparent'
    solid=first(el,'./a:solidFill/*')
    if solid is not None: return color(solid,palette)
    gradient=first(el,'./a:gradFill')
    if gradient is not None:
        stops=[color(gs[0],palette)+' '+num(int(gs.get('pos','0'))/1000)+'%' for gs in gradient.findall(A+'gsLst/'+A+'gs') if len(gs)]
        if stops: return 'linear-gradient(135deg,'+','.join(stops)+')'
    return fallback

def palette_for(slide):
    palette={'bg1':'#ffffff','tx1':'#17212e','bg2':'#e9edf3','tx2':'#263449','accent1':'#4472c4','accent2':'#ed7d31'}
    master=slide.slide_layout.slide_master
    for rel in master.part.rels.values():
        if rel.reltype.endswith('/theme'):
            xml=etree.fromstring(rel.target_part.blob)
            for entry in xml.findall('.//'+A+'clrScheme/*'):
                palette[etree.QName(entry).localname]=color(entry[0],palette) if len(entry) else '#263449'
    palette.update(bg1=palette.get('lt1','#fff'),tx1=palette.get('dk1','#17212e'),bg2=palette.get('lt2','#eee'),tx2=palette.get('dk2','#263449'))
    cmap=first(master._element,'./p:clrMap')
    override=first(slide._element,'./p:clrMapOvr/a:overrideClrMapping')
    for mapping in [cmap,override]:
        if mapping is not None:
            for key,value in mapping.attrib.items(): palette[key]=palette.get(value,palette.get(key,'#263449'))
    return palette

# Native geometries: each remains an independently addressable HTML element.
CLIPS={
 'triangle':'polygon(50% 0,100% 100%,0 100%)','rtTriangle':'polygon(0 0,100% 100%,0 100%)',
 'diamond':'polygon(50% 0,100% 50%,50% 100%,0 50%)','parallelogram':'polygon(20% 0,100% 0,80% 100%,0 100%)',
 'trapezoid':'polygon(20% 0,80% 0,100% 100%,0 100%)','hexagon':'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)',
 'pentagon':'polygon(50% 0,100% 38%,81% 100%,19% 100%,0 38%)',
 'chevron':'polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)',
 'rightArrow':'polygon(0 30%,65% 30%,65% 0,100% 50%,65% 100%,65% 70%,0 70%)',
 'leftArrow':'polygon(35% 0,35% 30%,100% 30%,100% 70%,35% 70%,35% 100%,0 50%)',
 'downArrow':'polygon(30% 0,70% 0,70% 65%,100% 65%,50% 100%,0 65%,30% 65%)',
 'upArrow':'polygon(50% 0,100% 35%,70% 35%,70% 100%,30% 100%,30% 35%,0 35%)',
 'homePlate':'polygon(0 0,75% 0,100% 50%,75% 100%,0 100%)'
}

def chart_html(shape,palette,warnings):
    warnings.add('chart-style-reconstructed')
    try:
        chart=shape.chart; kind=str(chart.chart_type).lower()
        categories=[str(c.label) for c in chart.plots[0].categories]
        series=[{'name':str(s.name),'values':[v if isinstance(v,(float,int)) and math.isfinite(v) else None for v in s.values]} for s in chart.series]
        colors=[palette.get('accent'+str(i+1),palette['accent1']) for i in range(6)]
        all_values=[v for s in series for v in s['values'] if v is not None]
        maximum=max([abs(v) for v in all_values]+[1]); minimum=min(all_values+[0]); maximum_y=max(all_values+[1])
        data=esc(json.dumps({'type':kind,'categories':categories,'series':series},ensure_ascii=False,separators=(',',':')))
        legend='<div style="position:absolute;left:5%;right:5%;bottom:0;display:flex;flex-wrap:wrap;gap:1cqw;font-size:.9cqw">'+''.join('<span style="color:'+colors[i%6]+'">'+esc(s['name'])+'</span>' for i,s in enumerate(series))+'</div>'
        if ('pie' in kind or 'doughnut' in kind) and series:
            values=series[0]['values']; total=sum(max(0,v or 0) for v in values) or 1; acc=0; stops=[]; labels=[]
            for i,value in enumerate(values):
                end=acc+max(0,value or 0)/total*100
                stops.append(colors[i%6]+' '+num(acc)+'% '+num(end)+'%'); acc=end
                labels.append('<span style="color:'+colors[i%6]+'">'+esc(categories[i] if i<len(categories) else i+1)+' '+esc(value)+'</span>')
            hole='<div style="position:absolute;inset:25%;border-radius:50%;background:white"></div>' if 'doughnut' in kind else ''
            graphic='<div style="position:absolute;left:5%;top:5%;width:55%;height:80%;border-radius:50%;background:conic-gradient('+','.join(stops)+')">'+hole+'</div><div style="position:absolute;left:65%;top:5%;width:35%;font-size:.9cqw;display:grid;gap:.5cqw">'+''.join(labels)+'</div>'
        elif 'line' in kind or 'scatter' in kind or len(categories)>24:
            graphics=[]
            for si,series_item in enumerate(series):
                points=[]
                for i,value in enumerate(series_item['values']):
                    if value is not None: points.append(num(50+i*880/max(1,len(series_item['values'])-1))+','+num(430-(value-minimum)/max(1,maximum_y-minimum)*390))
                graphics.append('<polyline points="'+' '.join(points)+'" fill="none" stroke="'+colors[si%6]+'" stroke-width="3"/>')
            graphic='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 500" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:90%"><path d="M50 20V430H930" fill="none" stroke="#b9c3d0"/>'+''.join(graphics)+'</svg>'
            warnings.add('chart-vector-plot-with-editable-labels')
            for i,label in enumerate(categories):
                if i % max(1,math.ceil(len(categories)/6))==0: graphic+='<span style="position:absolute;left:'+num(5+i*90/max(1,len(categories)-1))+'%;top:82%;font-size:.8cqw">'+esc(label)+'</span>'
        else:
            # Data remains attached in full; bar heights are computed from values.
            cols=[]
            for i,label in enumerate(categories):
                bars=[]
                for si,series_item in enumerate(series):
                    value=series_item['values'][i] if i<len(series_item['values']) else None
                    height=max(0,abs(value or 0)/maximum*75)
                    bars.append('<div style="position:relative;flex:1;height:'+num(height)+'%;background:'+colors[si%6]+'"><span style="position:absolute;bottom:100%;left:0;width:100%;text-align:center;font-size:.8cqw">'+esc(value if value is not None else '')+'</span></div>')
                cols.append('<div style="position:relative;display:flex;align-items:flex-end;gap:2px;flex:1;height:100%">'+''.join(bars)+'<span style="position:absolute;top:102%;left:0;width:100%;text-align:center;font-size:.8cqw">'+esc(label)+'</span></div>')
            graphic='<div style="position:absolute;left:5%;top:5%;width:90%;height:70%;display:flex;align-items:flex-end;gap:2%;border-bottom:1px solid #b9c3d0">'+''.join(cols)+'</div>'
            if minimum<0: warnings.add('chart-negative-axis-requires-review')
        return '<div data-fastppt-chart="'+data+'" style="position:absolute;inset:0">'+graphic+legend+'</div>'
    except Exception:
        warnings.add('chart-data-unavailable'); return ''

def text_html(shape,palette,scale,warnings):
    tf=shape.text_frame
    paragraphs=[]
    for p in tf.paragraphs:
        ppr=p._p.pPr
        default=first(p._p,'./a:pPr/a:defRPr')
        if default is None: default=first(p._p,'./a:endParaRPr')
        spans=[]
        for run in p.runs:
            rp=run._r.rPr
            sz=(rp.get('sz') if rp is not None else None) or (default.get('sz') if default is not None else None)
            size=float(sz)/100 if sz else 18
            font=first(run._r,'./a:rPr/a:ea')
            if font is None: font=first(run._r,'./a:rPr/a:latin')
            styles=[f'font-size:{num(size*12700*scale/960*100)}cqw']
            if font is not None:
                name=font.get('typeface','').replace('"','').replace("'",'').replace(';','')
                if not name.startswith('+'): styles.append(f"font-family:'{esc(name)}',sans-serif")
            for attr,css,value in [('b','font-weight','700'),('i','font-style','italic'),('u','text-decoration','underline')]:
                if rp is not None and rp.get(attr) not in (None,'0','false','none'): styles.append(css+':'+value)
            col=first(run._r,'./a:rPr/a:solidFill/*')
            if col is None and default is not None: col=first(default,'./a:solidFill/*')
            styles.append('color:'+color(col,palette,palette['tx1']))
            spans.append('<span style="'+';'.join(styles)+'">'+esc(run.text)+'</span>')
        align={'ctr':'center','r':'right','just':'justify'}.get(ppr.get('algn') if ppr is not None else '', 'left')
        if not spans and p.text: spans=[esc(p.text)]
        paragraphs.append('<p style="margin:0;min-height:.4em;line-height:1.15;text-align:'+align+'">'+''.join(spans)+'</p>')
    margins=[tf.margin_top,tf.margin_right,tf.margin_bottom,tf.margin_left]
    pad=' '.join(num(v*scale/960*100)+'cqw' for v in margins)
    anchor=str(tf.vertical_anchor or '')
    justify='center' if 'MIDDLE' in anchor else 'flex-end' if 'BOTTOM' in anchor else 'flex-start'
    return '<div data-resource-text="true" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:'+justify+';padding:'+pad+';white-space:pre-wrap;overflow-wrap:break-word">'+''.join(paragraphs)+'</div>'

def custom_svg(shape,palette,warnings):
    geometry=first(shape._element,'./p:spPr/a:custGeom')
    if geometry is None: return ''
    paths=[]
    for path in geometry.findall(A+'pathLst/'+A+'path'):
        commands=[]
        try:
            for cmd in path:
                tag=etree.QName(cmd).localname
                pts=[(float(p.get('x')),float(p.get('y'))) for p in cmd.findall(A+'pt')]
                if tag in ('moveTo','lnTo'): commands.append(('M' if tag=='moveTo' else 'L')+' '.join(num(v) for v in pts[0]))
                elif tag in ('cubicBezTo','quadBezTo'): commands.append(('C' if tag=='cubicBezTo' else 'Q')+' '.join(num(v) for pt in pts for v in pt))
                elif tag=='close': commands.append('Z')
                else: warnings.add('custom-geometry-formula-or-arc'); return ''
            width=float(path.get('w',shape.width)); height=float(path.get('h',shape.height))
            sp=first(shape._element,'./p:spPr')
            reference=first(shape._element,'./p:style/a:fillRef/*')
            col=fill(sp,palette,color(reference,palette,'transparent'))
            if col=='transparent': col='none'
            elif not col.startswith('#'): col=color(first(shape._element,'./p:spPr/a:gradFill/a:gsLst/a:gs/*'),palette,palette['accent1']); warnings.add('vector-fill-approximation')
            line=first(shape._element,'./p:spPr/a:ln')
            stroke=color(first(shape._element,'./p:spPr/a:ln/a:solidFill/*'),palette,'none')
            stroke_width=float(line.get('w','12700'))/max(1,shape.width)*width if line is not None else 0
            stroke_attrs=' stroke="'+stroke+'" stroke-width="'+num(stroke_width)+'"'

            paths.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+num(width)+' '+num(height)+'" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"><path d="'+esc(' '.join(commands))+'" fill="'+('none' if path.get('fill')=='none' else col)+'"'+(stroke_attrs if path.get('stroke')!='0' else '')+'/></svg>')
        except (ValueError,TypeError,IndexError): warnings.add('custom-geometry-formula-or-arc'); return ''
    warnings.add('vector-shapes-require-export-review')
    return ''.join(paths)

def shape_html(shape,palette,scale,sw,sh,assets,warnings,stats,slots,transform=(1,1,0,0),prefix=''):
    sx,sy,ox,oy=transform
    try: x=shape.left*sx+ox; y=shape.top*sy+oy; w=shape.width*sx; h=shape.height*sy
    except (TypeError,AttributeError): warnings.add('missing-geometry'); return ''
    anchor=prefix+'s'+str(shape.shape_id)
    stats['objects']+=1
    if shape.shape_type==MSO_SHAPE_TYPE.GROUP:
        t=shape._element.grpSpPr.xfrm
        if t is None: warnings.add('group-missing-transform'); return ''
        if getattr(shape,'rotation',0): warnings.add('rotated-group')
        # xfrm child coordinates are absolute in their own group coordinate system.
        gx=sx*shape.width/(t.chExt.cx or shape.width or 1); gy=sy*shape.height/(t.chExt.cy or shape.height or 1)
        transform=(gx,gy,x-t.chOff.x*gx,y-t.chOff.y*gy)
        return ''.join(shape_html(s,palette,scale,sw,sh,assets,warnings,stats,slots,transform,anchor+'-') for s in shape.shapes)
    style=f'position:absolute;left:{num(x/sw*100)}%;top:{num(y/sh*100)}%;width:{num(max(w,1)/sw*100)}%;height:{num(max(h,1)/sh*100)}%;box-sizing:border-box'
    rotation=getattr(shape,'rotation',0)
    xfrm=first(shape._element,'./p:spPr/a:xfrm')
    transforms=[]
    if rotation: transforms.append('rotate('+num(rotation)+'deg)')
    if xfrm is not None:
        if xfrm.get('flipH') in ('1','true'): transforms.append('scaleX(-1)')
        if xfrm.get('flipV') in ('1','true'): transforms.append('scaleY(-1)')
    if transforms: style+=';transform:'+' '.join(transforms)
    body=''
    if shape.shape_type==MSO_SHAPE_TYPE.PICTURE:
        stats['images']+=1
        try:
            image=shape.image; blob=image.blob; ext=image.ext.lower(); digest=hashlib.sha256(blob).hexdigest()[:24]
            if ext not in ('png','jpg','jpeg','gif','webp','svg'):
                warnings.add('unsupported-image-'+ext)
            else:
                name=digest+'.'+ext
                (assets/name).write_bytes(blob) if not (assets/name).exists() else None
                l,r,t,b=shape.crop_left,shape.crop_right,shape.crop_top,shape.crop_bottom
                iw=100/max(.01,1-l-r); ih=100/max(.01,1-t-b)
                body='<div style="position:absolute;inset:0;overflow:hidden"><img src="../assets/'+name+'" alt="" style="position:absolute;max-width:none;width:'+num(iw)+'%;height:'+num(ih)+'%;left:'+num(-l*iw)+'%;top:'+num(-t*ih)+'%"/></div>'
        except Exception as error: warnings.add('image-error-'+type(error).__name__)
    elif shape.has_table:
        stats['tables']+=1
        table=shape.table
        body='<table style="width:100%;height:100%;border-collapse:collapse;font-size:1.2cqw">'+''.join('<tr>'+''.join('<td style="border:1px solid #b9c3d0;padding:.35cqw">'+esc(cell.text)+'</td>' for cell in row.cells)+'</tr>' for row in table.rows)+'</table>'
        warnings.add('table-style-reconstructed')
    elif shape.has_chart:
        stats['charts']+=1; body=chart_html(shape,palette,warnings)
    else:
        sp=first(shape._element,'./p:spPr')
        prst=first(shape._element,'./p:spPr/a:prstGeom')
        preset=prst.get('prst') if prst is not None else 'rect'
        bg=fill(sp,palette,color(first(shape._element,'./p:style/a:fillRef/*'),palette,'transparent'))
        style+=';background:'+bg
        line=first(shape._element,'./p:spPr/a:ln')
        if line is not None and first(line,'./a:noFill') is None:
            lc=first(line,'./a:solidFill/*')
            style+=';border:'+num(max(.5,float(line.get('w','12700'))*scale))+'px solid '+color(lc,palette)
        if preset in ('ellipse','arc','pie','donut'): style+=';border-radius:50%'
        elif preset in ('roundRect','round2SameRect','round1Rect'): style+=';border-radius:1.2cqw'
        elif preset in CLIPS: style+=';clip-path:'+CLIPS[preset]; warnings.add('preset-adjustments-approximated')
        elif preset in ('line','straightConnector1') or shape.shape_type==MSO_SHAPE_TYPE.LINE:
            style+=';background:'+color(first(shape._element,'./p:spPr/a:ln/a:solidFill/*'),palette,palette['accent1'])+';height:.15%;transform-origin:left center;transform:rotate('+num(math.degrees(math.atan2(h,w)))+'deg)'
            warnings.add('connector-routing-approximated')
        elif preset not in ('rect',): warnings.add('unsupported-preset-'+preset)
        if preset in ('arc','pie','donut'): warnings.add('unsupported-preset-'+preset)
        if first(shape._element,'./p:spPr/a:custGeom') is not None:
            vector=custom_svg(shape,palette,warnings)
            if vector: style+=';background:transparent'; body+=vector
        if shape.shape_type==MSO_SHAPE_TYPE.EMBEDDED_OLE_OBJECT: warnings.add('embedded-ole-object')
        if children(shape._element,'.//a:effectLst/*'): warnings.add('effects-not-reconstructed')
    if shape.has_text_frame and shape.text.strip():
        stats['textBlocks']+=1
        slots.append({'anchor':anchor,'text':shape.text,'box':[round(x/sw,4),round(y/sh,4),round(w/sw,4),round(h/sh,4)]})
        body+=text_html(shape,palette,scale,warnings)
    return '<div data-fastppt-group="'+anchor+'" style="'+esc(style)+'">'+body+'</div>'

def classify(text,stats,page):
    patterns=[('cycle',r'闭环|循环|PDCA|cycle'),('swot',r'SWOT|优势.{0,10}劣势'),('timeline',r'时间轴|里程碑|历程|甘特|timeline'),('pyramid',r'金字塔|层级|pyramid'),('matrix',r'矩阵|四象限|matrix'),('comparison',r'对比|比较|VS|优劣|comparison'),('process',r'流程|步骤|STEP|工序|process'),('hierarchy',r'架构|组织|体系|结构|hierarchy'),('relationship',r'关系|逻辑|关联|递进|并列'),('metrics',r'数据|指标|增长|占比|业绩'),('agenda',r'目录|CONTENTS|AGENDA'),('closing',r'谢谢|感谢聆听|THANKS'),('cover',r'汇报人|答辩人|演讲人')]
    tags=[name for name,pat in patterns if re.search(pat,text,re.I)]
    if stats['charts']: tags.append('chart')
    if stats['tables']: tags.append('table')
    if stats['images']: tags.append('image-text')
    if not tags: tags=['diagram' if stats['objects']>12 and stats['textBlocks']<12 else 'content']
    return list(dict.fromkeys(tags))

ZH={'cycle':'循环闭环','swot':'SWOT 分析','timeline':'时间轴与里程碑','pyramid':'金字塔与层级','matrix':'矩阵与象限','comparison':'对比分析','process':'流程步骤','hierarchy':'组织架构与体系','relationship':'逻辑关系','metrics':'指标数据','agenda':'目录','closing':'结束页','cover':'封面','chart':'数据图表','table':'表格','image-text':'图文编排','diagram':'逻辑图形','content':'内容排版'}
PROMO=re.compile(r'扫码|扫描二维码|购买模板|版权声明|使用须知|关注公众号|未经授权|禁止商用|模板使用说明|素材来源|感谢下载')

def scan(args):
    out=pathlib.Path(args.output).resolve(); pages=out/'pages'; assets=out/'assets'; evidence=out/'evidence'
    for path in [pages,assets,evidence]: path.mkdir(parents=True,exist_ok=True)
    entries=[]; sources=[]
    files=sorted(p for root in args.roots for p in (ROOT/root).rglob('*.pptx'))
    migration=ROOT/'packages/animations/migration.json'
    if migration.exists():
        moved={s['path']for s in json.loads(migration.read_text())['sources']}
        files=[p for p in files if p.relative_to(ROOT).as_posix()not in moved]
    # A metadata rescan must never silently replace visually repaired pages with
    # the deliberately simpler XML baseline. An explicit flag is destructive.
    if not args.rebuild_baseline and (out/'scan-report.json').exists():
        existing=json.loads((out/'scan-report.json').read_text())
        if any(p.name.endswith('-pdf-rebuild.json') for p in (out/'visual-comparison').glob('*.json')):
            previous={s['path']:s['sha256'] for s in existing['sources']}
            current={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
            if previous!=current:
                raise RuntimeError('Source pack changed; use a separate --output or explicit --rebuild-baseline, then rerun visual reconstruction and comparison.')
            print('Source pack unchanged; preserving visually reconstructed pages and their audit evidence.');return
    for source in files:
        rel=source.relative_to(ROOT).as_posix(); sid=hashlib.sha256(rel.encode()).hexdigest()[:12]
        prs=Presentation(source); sw,sh=prs.slide_width,prs.slide_height; scale=960/sw
        detail_path=source.with_name('detail.json'); detail=json.loads(detail_path.read_text()) if detail_path.exists() else {}
        details={p['slide_number']:p for p in detail.get('pages',[])}
        source_info={'path':rel,'id':sid,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pages':len(prs.slides),'entries':[]}
        for index,slide in enumerate(prs.slides,1):
            rid=f'{sid}-{index:04d}'; warnings=set(); stats=collections.Counter(); slots=[]; palette=palette_for(slide)
            background='white'
            for node in [slide.slide_layout.slide_master._element,slide.slide_layout._element,slide._element]:
                bg=first(node,'./p:cSld/p:bg/p:bgPr')
                if bg is not None:
                    background=fill(bg,palette,background)
                    if first(bg,'./a:blipFill') is not None: warnings.add('background-image-not-reconstructed')
            body=[]
            # Draw inherited fixed decoration before slide-local objects. Placeholders
            # are rendered only from the slide; copying master placeholders duplicates content.
            if slide._element.get('showMasterSp','1') not in ('0','false'):
                for mi,node in enumerate([slide.slide_layout.slide_master,slide.slide_layout]):
                    if mi==0 and slide.slide_layout._element.get('showMasterSp','1') in ('0','false'): continue
                    for inherited in node.shapes:
                        if not inherited.is_placeholder:
                            try: body.append(shape_html(inherited,palette,scale,sw,sh,assets,warnings,collections.Counter(),[],prefix=f'inherited{mi}-'))
                            except Exception as error: warnings.add('inherited-object-error-'+type(error).__name__)
            for shape in slide.shapes:
                try: body.append(shape_html(shape,palette,scale,sw,sh,assets,warnings,stats,slots))
                except Exception as error: warnings.add('object-error-'+type(error).__name__)
            text=' '.join(s['text'] for s in slots); d=details.get(index,{})
            tags=classify(text+' '+d.get('layout',''),stats,index)
            title=d.get('layout') or next((s['text'].replace('\n',' ')[:65] for s in slots if len(s['text'].strip())>2),ZH[tags[0]])
            excluded=bool(d.get('auto_promo_flag') or index in detail.get('skip_pages',[]) or (PROMO.search(text) and len(text)<1600) or not stats['objects'] or (rel.startswith('references/pptset/') and (index==1 or (index<=5 and not stats['textBlocks'] and stats['images']==1))) or (len(text)<1500 and re.search(r'\d{2,4}\s*页.{0,40}(模板|逻辑图形)',text)))
            kind='diagram' if any(t in tags for t in ['cycle','swot','timeline','pyramid','matrix','process','hierarchy','relationship','diagram']) else 'layout'
            description=d.get('use_for') or ' / '.join(ZH[t] for t in tags)+f"；{stats['textBlocks']} 个文字区，{stats['images']} 个图片区"
            note=''
            body_html='<div v-pre class="fp-resource-'+rid+'" style="position:absolute;inset:0;container-type:size;background:'+esc(background)+';font-family:Arial,\'Noto Sans CJK SC\',sans-serif">'+''.join(body)+'</div>'
            md='---\nlayout: none\ntitle: '+json.dumps(title,ensure_ascii=False)+'\n---\n\n'+body_html+'\n\n<!-- Source: '+rel+' #'+str(index)+'; reconstruction, not a fidelity guarantee. -->\n'
            (pages/(rid+'.md')).write_text(md)
            item={'id':rid,'title':title,'kind':kind,'description':description,'tags':tags+[ZH[t] for t in tags], 'style':detail.get('style',source.stem), 'scenarios':description,'source':rel,'sourcePage':index,'file':'pages/'+rid+'.md','aspect':round(sw/sh,5),'density':'dense' if stats['textBlocks']>16 else 'balanced' if stats['textBlocks']>6 else 'airy','status':'excluded' if excluded else 'needs-review' if warnings else 'reconstructed','warnings':sorted(warnings),'license':note,'stats':dict(stats),'searchText':text[:6000]}
            entries.append(item); source_info['entries'].append(rid)
            if index % 50 == 0: print(f'  {index}/{len(prs.slides)} pages', flush=True)
            (evidence/(rid+'.json')).write_text(json.dumps({'id':rid,'source':rel,'sourcePage':index,'slideXmlSha256':hashlib.sha256(etree.tostring(slide._element)).hexdigest(),'slots':slots,'warnings':sorted(warnings),'stats':dict(stats)},ensure_ascii=False))
        sources.append(source_info); print(f'{len(prs.slides):4d} pages {rel}',flush=True)
    (out/'index.json').write_text(json.dumps({'version':1,'entries':entries},ensure_ascii=False,separators=(',',':'))+'\n')
    with (out/'manifest.csv').open('w',newline='') as f:
        fields=['id','file','title','kind','description','style','scenarios','tags','density','source','sourcePage','status','warnings','license']
        writer=csv.DictWriter(f,fieldnames=fields); writer.writeheader()
        for e in entries: writer.writerow({key:' | '.join(e[key]) if isinstance(e[key],list) else e[key] for key in fields})
    report={'version':1,'sourceCount':len(sources),'pageCount':len(entries),'statusCounts':dict(collections.Counter(e['status'] for e in entries)),'warningCounts':dict(collections.Counter(w for e in entries for w in e['warnings'])),'sources':sources,'manualVisualReview':'pending; structural inventory covers every page; render audit is separate'}
    (out/'scan-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('sources','warningCounts')},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--roots',nargs='+',default=['references/GordenPPTSkill','references/pptset']); p.add_argument('--output',default=str(OUT)); p.add_argument('--rebuild-baseline',action='store_true'); scan(p.parse_args())
