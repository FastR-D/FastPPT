#!/usr/bin/env python3
"""Verify each authorized edit and byte-equivalent retained leaf objects."""
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'visual-comparison'
spec = importlib.util.spec_from_file_location('clean_branding', pathlib.Path(__file__).with_name('clean-branding.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

report = module.read(OUT / 'branding-cleanup.json')
errors, verified = [], 0
for row in report['records']:
    before_path = OUT / 'before-branding' / (row['id'] + '.md')
    after_path = ROOT / 'pages' / (row['id'] + '.md')
    assert module.digest(before_path.read_bytes()) == row['beforeMarkdownSha256'], 'Changed backup: ' + row['id']
    assert module.digest(after_path.read_bytes()) == row['afterMarkdownSha256'], 'Stale edit evidence: ' + row['id']
    before, _, _ = module.parse(before_path.read_text())
    after, _, _ = module.parse(after_path.read_text())
    edits = {edit['anchor']: edit for edit in row['edits']}
    actual = {n.get('data-fastppt-group'): n for n in after.xpath('.//*[@data-fastppt-group]')}
    for node in before.xpath('.//*[@data-fastppt-group]'):
        key = node.get('data-fastppt-group')
        if module.etree.QName(node).localname not in ('svg', 'span') or key in edits: continue
        retained = actual.get(key)
        if retained is None: errors.append([row['id'], key, 'unexpected removal'])
        elif module.etree.tostring(node, method='c14n') != module.etree.tostring(retained, method='c14n'):
            errors.append([row['id'], key, 'unexpected mutation'])
        verified += 1
    for key, edit in edits.items():
        node = actual.get(key)
        if 'after' in edit:
            if node is None or ''.join(node.itertext()) != edit['after']:
                errors.append([row['id'], key, 'replacement mismatch'])
        elif node is not None: errors.append([row['id'], key, 'removal not applied'])
result = {'pages': len(report['records']), 'unchangedObjectsVerified': verified, 'errors': len(errors), 'details': errors}
module.write(OUT / 'branding-structure-check.json', result)
print(json.dumps({k:v for k,v in result.items() if k != 'details'}))
assert not errors, str(errors[:10])
