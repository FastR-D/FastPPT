#!/usr/bin/env python3
"""Remove generated raster previews, retaining all page content assets and sources."""
import hashlib,json,pathlib

REPO=pathlib.Path(__file__).resolve().parents[3]
records=[]
for name in ['resources','animations']:
    root=REPO/'packages'/name
    removed=[]
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in {'.png','.jpg','.jpeg','.webp','.gif'}:
            continue
        relative=path.relative_to(root)
        if 'assets' in relative.parts or 'node_modules' in relative.parts:
            continue
        removed.append({'path':str(relative),'bytes':path.stat().st_size})
        path.unlink()
    # The old paired-image viewer cannot function without its stored screenshots.
    for path in root.rglob('review.html'):
        if 'visual-comparison' in path.parts:path.unlink()
    records.append({'library':name,'files':len(removed),'bytes':sum(r['bytes']for r in removed),'pathsSha256':hashlib.sha256(json.dumps(removed,sort_keys=True).encode()).hexdigest()})
report={'version':1,'policy':'Generated screenshots and thumbnails removed; page assets and source PPTX/PDF preserved. Gallery previews render source HTML on demand. Existing visual measurements are historical records, not stored screenshots.','libraries':records}
if any(row['files']for row in records):
    (REPO/'packages/resources/screenshot-cleanup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
