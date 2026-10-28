#!/usr/bin/env python3
"""Verify derived webfont Unicode mappings against each source PDF font encoding."""
import io,json,pathlib,re
import pymupdf as fitz
from fontTools.ttLib import TTFont
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'visual-comparison'
report=json.loads((OUT/'source-fonts.json').read_text());checked=set();fonts=0;characters=0
for record in report['records']:
    sid=record['id'].split('-')[0];pdf=fitz.open(next((OUT/'originals'/sid).glob('*.pdf')))
    for font in record['fonts']:
        key=(sid,font['fontXref'],font['asset'])
        if key in checked:continue
        checked.add(key);name,extension,_,blob=pdf.extract_font(font['fontXref']);derived=TTFont(ROOT/'assets'/font['asset']);cmap=derived.getBestCmap()
        assert set(font['unicode'])<=set(cmap),'Webfont lost Unicode coverage: '+font['asset']
        if extension=='ttf':
            original=TTFont(io.BytesIO(blob));tables=original['cmap'].tables;encoded=next((t.cmap for t in tables if t.platformID==1 and t.platEncID==0),tables[0].cmap);ref=pdf.xref_get_key(font['fontXref'],'ToUnicode');text=pdf.xref_stream(int(ref[1].split()[0])).decode()
            for block in re.findall(r'beginbfchar(.*?)endbfchar',text,re.S):
                for code,unicode in re.findall(r'<([a-fA-F0-9]+)>\s*<([a-fA-F0-9]+)>',block):
                    char=bytes.fromhex(unicode).decode('utf-16-be');code=int(code,16)
                    if len(char)!=1 or code not in encoded:continue
                    expected=original.getGlyphID(encoded[code]);actual=derived.getGlyphID(cmap[ord(char)])
                    assert expected==actual,f'Unicode/glyph mismatch {name}: {char!r}, {expected} != {actual}'
        characters+=len(font['unicode']);fonts+=1
print(json.dumps({'fonts':fonts,'unicodeMappings':characters,'errors':0}))
