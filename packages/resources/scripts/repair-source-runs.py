#!/usr/bin/env python3
"""Repair merged/affine text runs using independently editable source glyphs.
Usage: python3 repair-source-runs.py --ids-file visual-comparison/browser-comparison.json
Only flagged reference-bound differences are changed; source paint order is kept.
"""
import argparse,copy,importlib.util,json,math,pathlib,re
import pymupdf as fitz
from lxml import etree
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
spec=importlib.util.spec_from_file_location('pdf_rebuild',pathlib.Path(__file__).with_name('pdf-rebuild.py'));pdf_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(pdf_module)
p=argparse.ArgumentParser();p.add_argument('--ids-file',default=str(OUT/'browser-comparison.json'));args=p.parse_args()
records=json.loads(pathlib.Path(args.ids_file).read_text())['records'];entries={e['id']:e for e in json.loads((ROOT/'index.json').read_text())['entries']};changed=[]
for record in records:
    if not record.get('textOverflow'):continue
    entry=entries[record['id']];sid=entry['id'].split('-')[0];pdf=fitz.open(next((OUT/'originals'/sid).glob('*.pdf')));page=pdf[entry['sourcePage']-1];w,h=page.rect.width,page.rect.height
    tree=etree.fromstring(page.get_svg_image(text_as_path=False).encode());position=[0];source_text=[]
    def visit(node):
        tag=etree.QName(node).localname
        if tag=='defs':return
        if tag=='text':source_text.append((position[0],node))
        if tag in {'text','path','rect','circle','ellipse','line','polyline','polygon','image','use'}:position[0]+=1;return
        for child in node:visit(child)
    visit(tree)
    path=ROOT/entry['file'];md=path.read_text();start=md.index('<div');end=md.rindex('</div>')+6;root=etree.fromstring(md[start:end].replace(' v-pre ',' v-pre="" ').encode())
    for issue in record['overflowDetails']:
        target=root.xpath('.//*[@data-fastppt-group="'+issue['anchor']+'"]')[0];full=target.text or '';box=list(map(float,target.get('data-reference-box').split(',')));box=[box[0]*w,box[1]*h,box[2]*w,box[3]*h]
        replacement=[]
        for z,node in source_text:
            text=''.join(node.itertext()).strip()
            if not text or text not in full:continue
            values=list(map(float,re.findall(r'-?[\d.]+',node.get('transform','matrix(1 0 0 1 0 0)'))));a,b,c,d,e,f=values
            size=float(node.get('font-size'));fm=pdf_module.resolve_font(node.get('font-family','Arial'),(16 if node.get('font-weight')=='bold'else 0)|(2 if node.get('font-style')=='italic'else 0));baseline=size*fm['baselineEm']
            for tspan in node:
                word=tspan.text or '';xs=list(map(float,tspan.get('x','0').split()));ys=list(map(float,tspan.get('y','0').split()))
                for i,char in enumerate(word):
                    x=xs[min(i,len(xs)-1)]+(i-len(xs)+1)*size if i>=len(xs)else xs[i];y=ys[min(i,len(ys)-1)];gx=a*x+c*y+e;gy=b*x+d*y+f
                    if not(box[0]-30<=gx<=box[0]+box[2]+30 and box[1]-30<=gy<=box[1]+box[3]+30):continue
                    new=copy.deepcopy(target);new.text=char;new.set('data-reference-width','0');new.set('data-fastppt-group',issue['anchor']+'-source-'+str(z)+'-'+str(i))
                    style=target.get('style','');style=re.sub(r'(?:^|;)\s*(?:left|top|font-size|font-family|font-weight|font-style|transform|transform-origin|letter-spacing|z-index|height)\s*:[^;]*','',style)
                    style+=f';left:{gx/w*100}%;top:{gy/h*100}%;font-size:{size/w*100}cqw;font-family:{json.dumps(fm["family"])},sans-serif;font-weight:{700 if fm["bold"]else 400};font-style:{"italic"if fm["italic"]else "normal"};transform-origin:0 0;transform:matrix({a},{b},{c},{d},{-c*baseline/w*960},{-d*baseline/w*960});height:{size/w*100}cqw;z-index:{z}'
                    # Matrix translations use cqw-independent CSS translate to
                    # remain proportional when the resource preview is resized.
                    style=re.sub(r'transform:matrix\([^;]+',f'transform:matrix({a},{b},{c},{d},0,0) translateY({-baseline/w*100}cqw)',style)
                    new.set('style',style);replacement.append(new)
        if replacement:
            # Paint indices are global. Insert source runs at root so later
            # opaque objects still occlude animation states from earlier draws.
            target.getparent().remove(target)
            for new in replacement:root.append(new)
    html=etree.tostring(root,encoding='unicode')
    html=re.sub(r'<(div|span|template)(\s[^<>]*?)?\s*/>',lambda m:'<'+m[1]+(m[2]or'')+'></'+m[1]+'>',html)
    path.write_text(md[:start]+html+md[end:]);changed.append(entry['id'])
(OUT/'source-runs-repaired-ids.json').write_text(json.dumps(changed)+'\n');print('Repaired affine/merged source runs',len(changed))
