#!/usr/bin/env python3
"""Repackage embedded Type1/TrueType subsets as webfonts for editable HTML text.
Uses original glyph outlines/widths and PDF ToUnicode mappings, never screenshots.
"""
import argparse,hashlib,io,json,pathlib,re,tempfile
import pymupdf as fitz
from lxml import etree
from fontTools import t1Lib
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.boundsPen import BoundsPen
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
p=argparse.ArgumentParser();p.add_argument('--ids-file',required=True);args=p.parse_args();ids=set(json.loads(pathlib.Path(args.ids_file).read_text()));entries=json.loads((ROOT/'index.json').read_text())['entries'];records=[]
normalize=lambda name:re.sub('[^a-z0-9]','',re.sub(r'^[A-Z]{6}\+|[-]VK.*','',name).lower()).replace('regular','').removesuffix('mt')
for source in json.loads((ROOT/'scan-report.json').read_text())['sources']:
    selected=[e for e in entries if e['source']==source['path']and e['id']in ids]
    if not selected:continue
    pdf=fitz.open(next((OUT/'originals'/source['id']).glob('*.pdf')));fonts={}
    for xref,ext,subtype,base,*_ in sorted({f for e in selected for f in pdf[e['sourcePage']-1].get_fonts()},key=lambda item:item[0]):
        if ext not in ('pfa','ttf')or(ext=='ttf'and subtype!='TrueType'):continue
        name,_,_,blob=pdf.extract_font(xref);unicode_ref=pdf.xref_get_key(xref,'ToUnicode')
        if unicode_ref[0]!='xref':continue
        cmap_data=pdf.xref_stream(int(unicode_ref[1].split()[0])).decode();mapping={}
        for block in re.findall(r'beginbfchar(.*?)endbfchar',cmap_data,re.S):
            for code,unicode in re.findall(r'<([a-fA-F0-9]+)>\s*<([a-fA-F0-9]+)>',block):
                text=bytes.fromhex(unicode).decode('utf-16-be')
                if len(text)==1:mapping[int(code,16)]=ord(text)
        if not mapping:continue
        if ext=='ttf':
            font=TTFont(io.BytesIO(blob));glyphs=font.getGlyphOrder()
            # PDF character codes are not glyph indices. LibreOffice subsets
            # often retain a MacRoman code map with deliberate non-identity GIDs.
            encoded=next((table.cmap for table in font['cmap'].tables if table.platformID==1 and table.platEncID==0),font['cmap'].tables[0].cmap)
            cmap={u:encoded[c]for c,u in mapping.items()if c in encoded};builder=FontBuilder(font=font);builder.setupCharacterMap(cmap);units=font['head'].unitsPerEm;glyph_set=font.getGlyphSet();bounds_map={}
            for u,glyph in cmap.items():
                pen=BoundsPen(glyph_set);glyph_set[glyph].draw(pen);bounds_map[str(u)]=[v*1000/units for v in (pen.bounds or (0,0,0,0))]
            font['hhea'].ascent=round(units*.8);font['hhea'].descent=-round(units*.2);font['hhea'].lineGap=0
            if 'OS/2'not in font:builder.setupOS2(version=4)
            os2=font['OS/2'];os2.version=max(4,os2.version);os2.sTypoAscender=round(units*.8);os2.sTypoDescender=-round(units*.2);os2.sTypoLineGap=0;os2.usWinAscent=round(units*.8);os2.usWinDescent=round(units*.2);os2.fsSelection=192
            font['head'].created=3406620150;font['head'].modified=3406620150;font.recalcTimestamp=False;font.flavor='woff2';output=io.BytesIO();font.save(output);data=output.getvalue();asset=hashlib.sha256(data).hexdigest()[:24]+'.woff2';(ROOT/'assets'/asset).write_bytes(data);family='fp-'+source['id']+'-'+normalize(base)
            fonts.setdefault(normalize(base),[]).append({'family':family,'asset':asset,'unicode':sorted(cmap),'fontXref':xref,'glyphBounds':bounds_map});continue
        with tempfile.NamedTemporaryFile(suffix='.pfa')as temporary:
            temporary.write(blob);temporary.flush();font=t1Lib.T1Font(temporary.name);font.parse()
        charset=font['CharStrings'];encoding=font['Encoding'];cmap={u:encoding[c]for c,u in mapping.items()if c<len(encoding)and encoding[c]in charset};glyphs=list(dict.fromkeys(['.notdef',*cmap.values()]));strings={};metrics={}
        glyph_bounds={}
        for glyph in glyphs:
            original=charset[glyph];pen=T2CharStringPen(1000,charset);original.draw(pen);advance=round(getattr(original,'width',1000));pen._width=advance;strings[glyph]=pen.getCharString();metrics[glyph]=(advance,0)
            bounds=BoundsPen(charset);original.draw(bounds);glyph_bounds[glyph]=bounds.bounds or (0,0,advance,0)
        family='fp-'+source['id']+'-'+normalize(base);builder=FontBuilder(1000,isTTF=False);builder.setupGlyphOrder(glyphs);builder.setupCharacterMap(cmap);builder.setupCFF('FP'+hashlib.sha256(blob).hexdigest()[:20],{'FullName':family,'FamilyName':family,'Weight':'Regular'},strings,{});builder.setupHorizontalMetrics(metrics);builder.setupHorizontalHeader(ascent=800,descent=-200);builder.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':family+str(xref),'fullName':family,'psName':'FP'+str(xref)});builder.setupOS2(version=4,sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200,fsSelection=192);builder.setupPost();builder.font['head'].created=3406620150;builder.font['head'].modified=3406620150;builder.font.recalcTimestamp=False;builder.font.flavor='woff2';output=io.BytesIO();builder.font.save(output);data=output.getvalue();asset=hashlib.sha256(data).hexdigest()[:24]+'.woff2';(ROOT/'assets'/asset).write_bytes(data)
        fonts.setdefault(normalize(base),[]).append({'family':family,'asset':asset,'unicode':sorted(cmap),'fontXref':xref,'glyphBounds':{str(u):glyph_bounds[glyph]for u,glyph in cmap.items()}})
    for entry in selected:
        path=ROOT/entry['file'];md=re.sub(r'\n<style[^>]*>\s*/\* fastppt-source-fonts \*/.*?</style>\s*','',path.read_text(),flags=re.S);start=md.index('<div');end=md.rindex('</div>')+6;root=etree.fromstring(md[start:end].replace(' v-pre ',' v-pre="" ').encode());used={};count=0
        for span in root.xpath('.//*[@data-source-font]'):
            key=normalize(span.get('data-source-font'));original_style=span.get('style','')
            if 'bold'not in key and re.search(r'font-weight:\s*(?:700|bold)',original_style)and key+'bold'in fonts:key+='bold'
            if 'italic'not in key and re.search(r'font-style:\s*italic',original_style)and key+'italic'in fonts:key+='italic'
            candidates=fonts.get(key,[])
            if not candidates:continue
            used[key]=candidates;family=candidates[0]['family'];style=span.get('style','');style=re.sub(r'font-family:[^;]+',f'font-family:"{family}",sans-serif',style);style=re.sub(r'font-weight:[^;]+','font-weight:400',style);style=re.sub(r'font-style:[^;]+','font-style:normal',style)
            # Source-origin runs use a CSS baseline translation. Match the new
            # font's explicit 800/-200 metrics, retaining all original matrices.
            size=re.search(r'font-size:\s*([\d.]+)cqw',style)
            if size and 'translateY('in style:style=re.sub(r'translateY\([^)]*\)',f'translateY({-float(size[1])*.8}cqw)',style)
            char=span.text or ''
            if len(char)==1 and size and 'translateY('in style:
                matched=next((font for font in reversed(candidates)if str(ord(char))in font['glyphBounds']),None)
                if matched:
                    xmin,ymin,xmax,ymax=matched['glyphBounds'][str(ord(char))];scale=float(size[1])/100
                    left=float(re.search(r'left:\s*([-\d.]+)%',style)[1])/100;top=float(re.search(r'top:\s*([-\d.]+)%',style)[1])/100
                    a,b,c,d,_,_=map(float,re.search(r'matrix\(([^)]+)\)',style)[1].split(','))
                    points=[(left+(a*x-c*y)*scale/1000,top+(b*x-d*y)*scale*entry['aspect']/1000)for x,y in [(xmin,ymin),(xmin,ymax),(xmax,ymin),(xmax,ymax)]]
                    box=[min(v[0]for v in points),min(v[1]for v in points),max(v[0]for v in points)-min(v[0]for v in points),max(v[1]for v in points)-min(v[1]for v in points)]
                    span.set('data-reference-box',','.join(map(str,box)));span.set('data-reference-kind','source-glyph-outline')
            span.set('style',style);count+=1
        if used:
            for old in root.xpath('.//style[@data-source-fonts]'):old.getparent().remove(old)
            css=''.join('@font-face{font-family:"'+font['family']+'";src:url("../assets/'+font['asset']+'");font-weight:400;font-style:normal;font-display:block;unicode-range:'+','.join('U+'+format(u,'X')for u in font['unicode'])+'}'for values in used.values()for font in values)
            style_block='\n\n<style>\n/* fastppt-source-fonts */\n'+css+'\n</style>\n'
            html=etree.tostring(root,encoding='unicode');html=re.sub(r'<(div|span|template)(\s[^<>]*?)?\s*/>',lambda m:'<'+m[1]+(m[2]or'')+'></'+m[1]+'>',html);path.write_text(md[:start]+html+md[end:]+style_block);records.append({'id':entry['id'],'textSpans':count,'fonts':[f for values in used.values()for f in values]})
            print(entry['id'],count,'text spans use original glyphs',flush=True)
report=OUT/'source-fonts.json';previous={r['id']:r for r in json.loads(report.read_text())['records']}if report.exists()else{};previous.update({r['id']:r for r in records});report.write_text(json.dumps({'version':1,'records':sorted(previous.values(),key=lambda r:r['id'])},ensure_ascii=False,indent=2)+'\n')

manifest=OUT/'source-font-restored-ids.json';previous=set(json.loads(manifest.read_text()))if manifest.exists()else set();manifest.write_text(json.dumps(sorted(previous|ids))+'\n')
