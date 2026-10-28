#!/usr/bin/env python3
"""Restore inherited PDF transparency on real HTML text without rebuilding pages."""
import collections,json,pathlib,re
import pymupdf as fitz
from lxml import etree
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
index=json.loads((ROOT/'index.json').read_text());changed=[]
for source in json.loads((ROOT/'scan-report.json').read_text())['sources']:
    pdf=fitz.open(next((OUT/'originals'/source['id']).glob('*.pdf')))
    for entry in [e for e in index['entries']if e['source']==source['path']]:
        tree=etree.fromstring(pdf[entry['sourcePage']-1].get_svg_image(text_as_path=False).encode());position=[0];opacities={}
        def visit(node):
            tag=etree.QName(node).localname
            if tag=='defs':return
            if tag=='text':
                opacity=1
                for parent in [node,*node.iterancestors()]:opacity*=float(parent.get('opacity','1'))
                opacity*=float(node.get('fill-opacity','1'));opacities[position[0]]=opacity
            if tag in ('text','path','rect','circle','ellipse','line','polyline','polygon','image','use'):position[0]+=1;return
            for child in node:visit(child)
        visit(tree)
        path=ROOT/entry['file'];md=path.read_text()
        def replace(match):
            span=match[0];z=re.search(r'z-index:\s*(\d+)',span)
            if not z or int(z[1])not in opacities:return span
            opacity=opacities[int(z[1])]
            return re.sub(r'opacity:\s*[\d.]+',f'opacity:{opacity:.7f}',span)
        updated=re.sub(r'<span\b[^>]*data-resource-text[^>]*>[^<]*</span>',replace,md)
        # Do not rewrite equivalent numeric formatting, keeping audit hashes stable.
        if re.sub(r'opacity:1\.0+(?=[;"\s])','opacity:1',updated)!=re.sub(r'opacity:1\.0+(?=[;"\s])','opacity:1',md):
            path.write_text(updated);changed.append(entry['id'])
    print(source['id'],'opacity checked',flush=True)
(OUT/'opacity-refined-ids.json').write_text(json.dumps(changed)+'\n');print('Changed',len(changed),'pages')
