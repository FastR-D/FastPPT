#!/usr/bin/env python3
"""Remove reviewed template branding objects, never paint over slide content.

Original PPTX/PDF/images and source attribution remain immutable. Exact object
edits and their normalized bounds are recorded for reproducible visual QA.
"""
import argparse
import collections
import hashlib
import html.entities
import json
import math
import pathlib
import re

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from lxml import etree

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'visual-comparison'
# Visually inspected image/mask pairs. A mask is part of the same logo object;
# deleting only the RGB paint can otherwise leave its duplicate visible.
LOGO_ASSETS = {
    '7ae945fa69b8f2bc2374c975.png', 'f640ae39c0d86d0b19a546e7.jpg',
    '78888e411931e5b21ef19e93.png', '4f444153157250da6ec13bb2.jpg',
    'db7a399111cc0b7251568c0e.png', '7479742042eb18b009e38a3c.jpg',
    '1a54e56137920b891cccfbdf.png', '551ae5edf29fa46b7469bdc4.jpg',
    '94781e4d8555d473a68f708c.png', 'eb81fc62bf2fec42e2727f6b.jpg',
    '117b8499cca42b514f3c32a1.jpg', '475429faa32df119ffe76fd9.jpg',
    '89b8ddb9f9c263c3933c5e42.png', 'b8d412dcd45ede39ec1c2dad.jpg',
    'a11e74b6ce5694dc45636f40.png',
    '75828448d5c49a4d71420b0d.jpg', '6c8ec71f8ad69a47dded9700.png',
    '43cee0a0e03639184f3fd9ff.jpg', '9a9d1d8637400e842925d5ec.jpg',
    'c6395bd0e06daafd83e3f611.jpg',
}


def read(path):
    return json.loads(path.read_text())


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse(markdown):
    start, end = markdown.index('<div'), markdown.rindex('</div>') + 6
    markup = markdown[start:end].replace(' v-pre ', ' v-pre="" ')
    markup = re.sub(r'&([A-Za-z]+);', lambda m: '&#' + str(html.entities.name2codepoint[m[1]]) + ';'
                    if m[1] not in ('amp', 'lt', 'gt', 'quot', 'apos') and m[1] in html.entities.name2codepoint
                    else m[0], markup)
    return etree.fromstring(markup.encode()), start, end


def transform(value):
    result = Transform()
    for name, args in re.findall(r'([A-Za-z]+)\(([^)]*)\)', value or ''):
        values = [float(n) for n in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?', args)]
        if name == 'matrix': result = result.transform(Transform(*values))
        elif name == 'translate': result = result.translate(values[0], values[1] if len(values) > 1 else 0)
        elif name == 'scale': result = result.scale(values[0], values[1] if len(values) > 1 else values[0])
        elif name == 'rotate':
            if len(values) == 3: result = result.translate(*values[1:])
            result = result.rotate(math.radians(values[0]))
            if len(values) == 3: result = result.translate(-values[1], -values[2])
        else: raise ValueError('Unsupported SVG transform: ' + name)
    return result


def graphic_box(node, definitions):
    """Bounds in the outer SVG coordinate system, including nested transforms."""
    boxes = []

    def visit(el, matrix, seen):
        tag = etree.QName(el).localname
        if tag in ('defs', 'clipPath', 'mask', 'filter'): return
        matrix = matrix.transform(transform(el.get('transform', '')))
        if tag == 'path':
            pen = BoundsPen(None)
            parse_path(el.get('d', ''), TransformPen(pen, matrix))
            if pen.bounds: boxes.append(pen.bounds)
        elif tag in ('image', 'rect'):
            x, y, w, h = [float(el.get(k, '0')) for k in ('x', 'y', 'width', 'height')]
            points = [matrix.transformPoint(p) for p in ((x, y), (x+w, y), (x+w, y+h), (x, y+h))]
            boxes.append((min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)))
        elif tag == 'use':
            href = el.get('href') or el.get('{http://www.w3.org/1999/xlink}href', '')
            key = href.lstrip('#')
            if href.startswith('#') and key in definitions and key not in seen:
                visit(definitions[key], matrix.translate(float(el.get('x', 0)), float(el.get('y', 0))), seen | {key})
        else:
            for child in el: visit(child, matrix, seen)

    visit(node, Transform(), set())
    if not boxes: return None
    width, height = [float(v) for v in node.get('viewBox').split()][2:]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    return [x0 / width, y0 / height, (x1-x0) / width, (y1-y0) / height]


def replacement(text):
    text = re.sub('旁门左道|旁门', lambda m: '企业名称' if m[0] == '旁门左道' else '企业', text)
    text = re.sub(r'PMZDPPT', 'COMPANY', text, flags=re.I)
    text = re.sub(r'PMZD', lambda m: 'DEMO' if m[0].isupper() else 'demo', text, flags=re.I)
    return text


def clean(markdown, entry):
    tree, start, end = parse(markdown)
    definitions = {el.get('id'): el for el in tree.xpath('.//*[@id]')}
    edits, removed, replaced = [], set(), {}

    def record(node, reason, box, old=None, new=None):
        item = {'anchor': node.get('data-fastppt-group'), 'reason': reason, 'box': box}
        if old is not None: item['before'] = old
        if new is not None: item['after'] = new
        edits.append(item)

    # PDF spans can split a wordmark into four independent glyphs. Match exact
    # reviewed names across consecutive text spans, then remove only those
    # glyphs; single common Chinese characters elsewhere remain untouched.
    text_nodes = tree.xpath('.//*[@data-resource-text]')
    combined, offsets = '', []
    for node in text_nodes:
        value = ''.join(node.itertext())
        normalized = re.sub(r'\s+', '', value)
        offsets.append((len(combined), len(combined) + len(normalized), node))
        combined += normalized
    for match in re.finditer('方能演亦', combined):
        matching = [(a, b, n) for a, b, n in offsets if a < match.end() and b > match.start()]
        if all(a >= match.start() and b <= match.end() for a, b, n in matching):
            for a, b, node in matching:
                if node.getparent() is None: continue
                box = [float(v) for v in node.get('data-reference-box').split(',')]
                record(node, 'copyright-author-wordmark', box, ''.join(node.itertext()))
                removed.add(node.get('data-fastppt-group'))
                node.getparent().remove(node)

    def branded(node, visited=None):
        visited = set() if visited is None else visited
        markup = etree.tostring(node, encoding='unicode')
        if any(name in markup for name in LOGO_ASSETS): return True
        keys = re.findall(r'url\(#([^)]*)\)|(?:href|xlink:href)="#([^"]+)"', markup)
        for pair in keys:
            key = pair[0] or pair[1]
            if key not in visited and key in definitions:
                visited.add(key)
                if branded(definitions[key], visited): return True
        return False

    for node in list(tree.xpath('.//*[local-name()="svg" and @data-fastppt-group]')):
        reason, box = None, None
        if branded(node):
            reason = 'template-logo-image'
        elif entry['id'].startswith('c9f1632d31e4-'):
            box = graphic_box(node, definitions)
            if box:
                x, y, w, h = box
                # Reviewed outline lettering only: retain the gold frame, tab
                # and the black texture behind the vertical/footer wordmarks.
                if x >= .975 and x+w <= .991 and y >= .30 and y+h <= .70:
                    reason = 'template-vertical-wordmark'
                elif x >= .76 and y >= .957 and w < .25 and h < .09:
                    reason = 'template-footer-wordmark'
                elif .88 <= x <= .90 and .075 <= y <= .125 and w < .002 and h < .04:
                    reason = 'template-logo-separator'
        if reason:
            box = box or graphic_box(node, definitions)
            record(node, reason, box)
            removed.add(node.get('data-fastppt-group'))
            node.getparent().remove(node)

    for node in list(tree.xpath('.//*[@data-resource-text]')):
        text = ''.join(node.itertext())
        box = [float(v) for v in node.get('data-reference-box', '0,0,0,0').split(',')]
        x, y, w, h = box
        is_logo = bool(re.fullmatch(r'\s*(?:(?:YOUR\s*)?LOGO|PMZDPPT)\s*', text, re.I))
        if entry['id'] == 'd63a197fd23d-0131' and text == 'COMPANY': is_logo = True
        is_your = text.strip().upper() == 'YOUR' and (x > .75 or x < .2) and y < .2
        is_rights = bool(re.search(r'方能演亦|版权已登记|侵权必究|私自传播|保留所有权利|all rights reserved|copyright', text, re.I))
        is_symbol = text.strip() in ('©', '®', '™')
        if is_logo or is_your or is_rights or is_symbol:
            record(node, 'template-logo-text' if is_logo or is_your else 'copyright-notice', box, text)
            removed.add(node.get('data-fastppt-group'))
            node.getparent().remove(node)
        else:
            new = replacement(text)
            if new != text:
                # WordArt can have a character span per glyph. Replacing its
                # individual glyph children would break character-origin layout;
                # ordinary runs here have a single text node.
                if len(node): raise RuntimeError('Unexpected nested text run: ' + entry['id'])
                node.text = new
                record(node, 'neutral-sample-company', box, text, new)
                replaced[node.get('data-fastppt-group')] = new

    if not edits: return markdown, [], removed, replaced
    # Strip unused logo mask/image definitions as well, so resource reuse does
    # not carry dormant branding assets. Definitions used by retained objects
    # are protected by the closure check above.
    for node in list(tree.xpath('.//*[local-name()="defs"]//*[@id]')):
        if node.getparent() is not None and branded(node): node.getparent().remove(node)
    html = etree.tostring(tree, encoding='unicode', method='xml')
    html = re.sub(r'<(div|span|template)(\s[^<>]*?)?\s*/>', lambda m: '<'+m[1]+(m[2] or '')+'></'+m[1]+'>', html)
    return markdown[:start] + html + markdown[end:], edits, removed, replaced


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--ids-file', type=pathlib.Path)
    args = parser.parse_args()
    selected = set(read(args.ids_file)) if args.ids_file else None
    index = read(ROOT / 'index.json')
    report_path = OUT / 'branding-cleanup.json'
    previous = read(report_path) if report_path.exists() else {'records': []}
    records = {row['id']: row for row in previous['records']}
    changed = []
    for entry in index['entries']:
        if selected is not None and entry['id'] not in selected: continue
        for field in ('title', 'description', 'scenarios', 'searchText'):
            entry[field] = replacement(entry[field]).replace('旁友圈', '示例企业').replace('©方能演亦标识页', '三列目标概览')
        path = ROOT / entry['file']
        before = path.read_bytes()
        after, edits, removed, replaced = clean(before.decode(), entry)
        if not edits: continue
        changed.append(entry['id'])
        record = {'id': entry['id'], 'beforeMarkdownSha256': digest(before), 'afterMarkdownSha256': digest(after.encode()), 'edits': edits}
        old = records.get(entry['id'])
        if old:
            record['beforeMarkdownSha256'] = old['beforeMarkdownSha256']
            combined = {edit['anchor']: edit for edit in old['edits']}
            for edit in edits:
                original = combined.get(edit['anchor'])
                combined[edit['anchor']] = {**edit, **({'before': original['before']} if original and 'before' in original else {})}
            record['edits'] = list(combined.values())
        if not args.apply:
            records[entry['id']] = record
            continue
        backup = OUT / 'before-branding' / (entry['id'] + '.md')
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists(): backup.write_bytes(before)
        path.write_text(after)
        evidence_path = ROOT / 'evidence' / (entry['id'] + '.json')
        evidence = read(evidence_path)
        slots = evidence['reconstructedSlots']
        evidence['sourceReconstructedSlots'] = evidence.get('sourceReconstructedSlots', slots)
        evidence['reconstructedSlots'] = [{**s, 'text': replaced.get(s['anchor'], s['text'])} for s in slots if s['anchor'] not in removed]
        evidence['brandingCleanup'] = record
        write(evidence_path, evidence)
        entry['searchText'] = replacement(entry['searchText'])
        for edit in edits:
            if 'before' in edit and 'after' not in edit:
                entry['searchText'] = entry['searchText'].replace(edit['before'], '')
        records[entry['id']] = record
    report = {'version': 1, 'operation': 'Remove reviewed template branding objects; neutralize sample company names; retain immutable originals/provenance',
              'pages': len(records), 'edits': sum(len(r['edits']) for r in records.values()),
              'reasonCounts': dict(collections.Counter(e['reason'] for r in records.values() for e in r['edits'])),
              'records': list(records.values())}
    if args.apply:
        write(report_path, report)
        write(OUT / 'branding-cleaned-ids.json', sorted(records))
        write(OUT / 'branding-changed-this-run-ids.json', changed)
        (ROOT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')
    else:
        write(pathlib.Path('/tmp/fastppt-branding-cleanup-plan.json'), report)
    print(json.dumps({**{k:v for k,v in report.items() if k != 'records'}, 'changedThisRun':len(changed)}, ensure_ascii=False), flush=True)


if __name__ == '__main__': main()
