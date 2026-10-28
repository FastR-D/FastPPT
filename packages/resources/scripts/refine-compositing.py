#!/usr/bin/env python3
"""Preserve PDF transparency-group isolation across independent HTML/SVG objects."""
import argparse,json,pathlib,re
import pymupdf as fitz
from lxml import etree
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
index=json.loads((ROOT/'index.json').read_text());changed=[]
p=argparse.ArgumentParser();p.add_argument('--ids-file');args=p.parse_args();selected_ids=set(json.loads(pathlib.Path(args.ids_file).read_text()))if args.ids_file else None
PAINT={'text','path','rect','circle','ellipse','line','polyline','polygon','image','use'}
for source in json.loads((ROOT/'scan-report.json').read_text())['sources']:
    pdf=fitz.open(next((OUT/'originals'/source['id']).glob('*.pdf')))
    for entry in [e for e in index['entries']if e['source']==source['path']]:
        if selected_ids is not None and entry['id']not in selected_ids:continue
        path=ROOT/entry['file'];md=path.read_text()
        if 'data-fastppt-group="transparency-'not in md and len(re.findall(r'<g[^>]*\bopacity="(?!1")',md))<2:continue
        tree=etree.fromstring(pdf[entry['sourcePage']-1].get_svg_image(text_as_path=False).encode())
        position=[0];groups=[];own_text_opacity={}
        def visit(node,parent_group=None):
            tag=etree.QName(node).localname
            if tag=='defs':return
            group=None
            if tag=='g' and float(node.get('opacity','1'))<1:
                group={'start':position[0],'opacity':float(node.get('opacity')),'parent':parent_group};groups.append(group)
            if tag=='text':own_text_opacity[position[0]]=float(node.get('opacity','1'))*float(node.get('fill-opacity','1'))
            if tag in PAINT:position[0]+=1;return
            for child in node:visit(child,group if group is not None else parent_group)
            if group is not None:group['end']=position[0]
        visit(tree)
        groups=[g for g in groups if g['end']>g['start']]
        if not any(g['end']-g['start']>1 for g in groups):continue
        start=md.index('<div');end=md.rindex('</div>')+6
        root=etree.fromstring(md[start:end].replace(' v-pre ',' v-pre="" ').encode())
        objects=[]
        # Flatten previous compositing parents, including any hierarchy repaired
        # by the HTML parser after an earlier invalid self-closing div/template.
        for node in root.xpath('.//*[@data-fastppt-group]'):
            tag=etree.QName(node).localname
            if tag not in ('svg','span')and not(tag=='div'and node.get('data-fastppt-group','').startswith('source-text-')):continue
            if any(parent.get('data-fastppt-group','').startswith('source-text-')for parent in node.iterancestors()):continue
            z=re.search(r'z-index:\s*(\d+)',node.get('style',''))
            if z:objects.append((int(z[1]),node))
        definitions=root.xpath('.//*[local-name()="svg" and @aria-hidden="true" and not(@data-fastppt-group)]')+root.xpath('.//template')+root.xpath('.//style[@data-source-fonts]')
        for node in list(root):root.remove(node)
        for _,node in objects:
            if etree.QName(node).localname=='svg':
                for ancestor in node.xpath('.//*[local-name()="g"]'):
                    ancestor.attrib.pop('opacity',None)
        # HTML parents preserve opacity compositing once across all overlapping
        # paints. Each leaf SVG and each real text span remains independently named.
        containers={id(g):etree.Element('div',{'data-fastppt-group':'transparency-'+str(i),'style':f'position:absolute;inset:0;opacity:{g["opacity"]};isolation:isolate;z-index:{g["start"]}'})for i,g in enumerate(groups)}
        for node in definitions:root.append(node)
        events=[(z,1,node,None)for z,node in objects]+[(g['start'],0,containers[id(g)],g)for g in groups]
        for z,kind,node,group in sorted(events,key=lambda e:(e[0],e[1])):
            if kind==0:
                parent=containers[id(group['parent'])]if group['parent']is not None else root
            else:
                active=[g for g in groups if g['start']<=z<g['end']]
                parent=containers[id(active[-1])]if active else root
                if etree.QName(node).localname=='span' and z in own_text_opacity:
                    node.set('style',re.sub(r'opacity:\s*[\d.]+',f'opacity:{own_text_opacity[z]}',node.get('style','')))
                if etree.QName(node).localname=='div'and node.get('data-fastppt-group','').startswith('source-text-')and z in own_text_opacity:
                    for span in node.xpath('.//*[@data-resource-text]'):span.set('style',re.sub(r'opacity:\s*[\d.]+',f'opacity:{own_text_opacity[z]}',span.get('style','')))
            parent.append(node)
        html=etree.tostring(root,encoding='unicode',method='xml')
        html=re.sub(r'<(div|span|template)(\s[^<>]*?)?\s*/>',lambda m:'<'+m[1]+(m[2]or'')+'></'+m[1]+'>',html)
        updated=md[:start]+html+md[end:]
        path.write_text(updated);changed.append(entry['id'])
    print(source['id'],'compositing checked',flush=True)
manifest=OUT/'compositing-refined-ids.json';previous=set(json.loads(manifest.read_text()))if manifest.exists()else set();manifest.write_text(json.dumps(sorted(previous|set(changed)))+'\n');print('Changed',len(changed),'pages')
