#!/usr/bin/env python3
"""Restore positioned WordArt/merged text as editable HTML source runs.
Select pages with --ids-file (JSON array). Each character keeps its PDF origin,
affine matrix, source paint order and inherited alpha; no text is rasterized.
"""
import argparse,collections,copy,importlib.util,json,pathlib,re
import pymupdf as fitz
from lxml import etree
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
spec=importlib.util.spec_from_file_location('pdf_rebuild',pathlib.Path(__file__).with_name('pdf-rebuild.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
p=argparse.ArgumentParser();p.add_argument('--ids-file',required=True);args=p.parse_args();ids=set(json.loads(pathlib.Path(args.ids_file).read_text()));entries=json.loads((ROOT/'index.json').read_text())['entries'];backup=OUT/'before-source-text';backup.mkdir(exist_ok=True)
for source in json.loads((ROOT/'scan-report.json').read_text())['sources']:
    selected=[e for e in entries if e['id']in ids and e['source']==source['path']]
    if not selected:continue
    pdf=fitz.open(next((OUT/'originals'/source['id']).glob('*.pdf')))
    for entry in selected:
        page=pdf[entry['sourcePage']-1];w,h=page.rect.width,page.rect.height;path=ROOT/entry['file'];md=path.read_text();saved=backup/path.name
        if not saved.exists():saved.write_text(md)
        start=md.index('<div');end=md.rindex('</div>')+6;root=etree.fromstring(md[start:end].replace(' v-pre ',' v-pre="" ').encode());tree=etree.fromstring(page.get_svg_image(text_as_path=False).encode());position=[0];texts=[]
        def visit(node):
            tag=etree.QName(node).localname
            if tag=='defs':return
            if tag=='text':texts.append((position[0],node))
            if tag in {'text','path','rect','circle','ellipse','line','polyline','polygon','image','use'}:position[0]+=1;return
            for child in node:visit(child)
        visit(tree)
        raw=collections.defaultdict(list)
        for block in page.get_text('rawdict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    for char in span['chars']:raw[char['c']].append(char)
        for node in root.xpath('.//*[@data-resource-text]'):node.getparent().remove(node)
        count=0
        for z,node in texts:
            matrix=fitz.Matrix(1,0,0,1,0,0)
            for ancestor in [node,*node.iterancestors()]:
                value=ancestor.get('transform','')
                if value.startswith('matrix('):matrix=matrix*fitz.Matrix(*map(float,re.findall(r'-?[\d.]+',value)))
            a,b,c,d,e,f=tuple(matrix);size=float(node.get('font-size'));fm=module.resolve_font(node.get('font-family','Arial'),(16 if node.get('font-weight')=='bold'else 0)|(2 if node.get('font-style')=='italic'else 0));baseline=size*fm['baselineEm'];opacity=1
            for ancestor in [node,*node.iterancestors()]:opacity*=float(ancestor.get('opacity','1'))
            opacity*=float(node.get('fill-opacity','1'));color=node.get('fill','#000000')
            group=etree.SubElement(root,'div',{'data-fastppt-group':'source-text-'+str(z),'aria-label':''.join(node.itertext()),'style':f'position:absolute;inset:0;z-index:{z}'})
            for tspan in node:
                xs=list(map(float,re.findall(r'-?[\d.]+',tspan.get('x','0'))));ys=list(map(float,re.findall(r'-?[\d.]+',tspan.get('y','0'))))
                for i,char in enumerate(tspan.text or ''):
                    x=xs[i]if i<len(xs)else xs[-1]+(i-len(xs)+1)*size;y=ys[min(i,len(ys)-1)];point=fitz.Point(x,y)*matrix;gx,gy=point.x,point.y
                    candidates=raw.get(char,[]);nearest=min(candidates,key=lambda v:(v['origin'][0]-gx)**2+(v['origin'][1]-gy)**2)if candidates else None
                    if nearest and (nearest['origin'][0]-gx)**2+(nearest['origin'][1]-gy)**2<16:box=nearest['bbox']
                    else:
                        points=[fitz.Point(x+px*size,y+py*size)*matrix for px,py in [(0,-.85),(1,-.85),(1,.25),(0,.25)]];box=[min(p.x for p in points),min(p.y for p in points),max(p.x for p in points),max(p.y for p in points)]
                    style=f'position:absolute;left:{gx/w*100}%;top:{gy/h*100}%;font-size:{size/w*100}cqw;font-family:{json.dumps(fm["family"])},sans-serif;font-weight:{700 if fm["bold"]else 400};font-style:{"italic"if fm["italic"]else "normal"};color:{color};opacity:{opacity};line-height:1;white-space:pre;margin:0;padding:0;border:0;box-sizing:content-box;overflow:visible;transform-origin:0 0;transform:matrix({a},{b},{c},{d},0,0) translateY({-baseline/w*100}cqw);width:max-content;height:{size/w*100}cqw'
                    span=etree.SubElement(group,'span',{'data-resource-text':'true','data-reference-width':'0','data-reference-box':','.join(str(v)for v in [box[0]/w,box[1]/h,(box[2]-box[0])/w,(box[3]-box[1])/h]),'data-fastppt-group':'source-char-'+str(count),'data-source-font':node.get('font-family','Arial'),'style':style});span.text=char;count+=1
        html=etree.tostring(root,encoding='unicode');html=re.sub(r'<(div|span|template)(\s[^<>]*?)?\s*/>',lambda m:'<'+m[1]+(m[2]or'')+'></'+m[1]+'>',html);path.write_text(md[:start]+html+md[end:]);print(entry['id'],count,'source characters restored',flush=True)
manifest=OUT/'source-text-restored-ids.json'
previous=set(json.loads(manifest.read_text()))if manifest.exists()else set()
manifest.write_text(json.dumps(sorted(previous|ids))+'\n')
