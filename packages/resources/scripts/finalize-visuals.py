#!/usr/bin/env python3
"""Publish a hash-verified comparison into the catalog; never bless stale renders."""
import collections,csv,hashlib,json,pathlib,re

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'visual-comparison'
digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
read=lambda path:json.loads(path.read_text())
write=lambda path,data:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

def finalize():
    index=read(ROOT/'index.json');scan=read(ROOT/'scan-report.json')
    comparison=read(OUT/'comparison.json');rows={r['id']:r for r in comparison['records']}
    branding_path=OUT/'branding-cleanup.json'
    branding={r['id']:r for r in read(branding_path)['records']}if branding_path.exists()else{}
    if set(rows)!={e['id']for e in index['entries']}:
        raise RuntimeError('Comparison does not cover every catalog page')
    originals=[]
    for source in scan['sources']:
        receipt=read(OUT/'originals'/source['id']/'receipt.json')
        if receipt['sourceSha256']!=source['sha256'] or receipt['pages']!=source['pages']:
            raise RuntimeError('Original receipt mismatch: '+source['id'])
        if digest(ROOT.parents[1]/source['path'])!=source['sha256']:
            raise RuntimeError('Original source file changed: '+source['id'])
        originals.append(receipt)
    assets_checked=set()
    for entry in index['entries']:
        r=rows[entry['id']]
        if r.get('error') or r.get('comparisonError'):
            raise RuntimeError('Render/comparison failure: '+entry['id'])
        for path,key in [(ROOT/entry['file'],'markdownSha256'),(OUT/r['original'],'sourceImageSha256'),(OUT/r['replica'],'replicaImageSha256')]:
            if digest(path)!=r[key]:raise RuntimeError('Stale comparison: '+str(path))
        evidence_path=ROOT/'evidence'/(entry['id']+'.json');evidence=read(evidence_path)
        if evidence.get('reconstruction')!='source-rendered independent vector layers + HTML text':
            raise RuntimeError('Missing vector reconstruction: '+entry['id'])
        if r['textBlocks']<len(evidence['reconstructedSlots']):
            raise RuntimeError('Missing rendered HTML text: '+entry['id'])
        for name in set(re.findall(r'\.\./assets/([a-f0-9]+\.(?:png|jpe?g|svg|gif|webp|woff2))',(ROOT/entry['file']).read_text())):
            if name not in assets_checked:
                if not digest(ROOT/'assets'/name).startswith(name.split('.')[0]):raise RuntimeError('Asset digest mismatch: '+name)
                assets_checked.add(name)
        # The earlier XML scanner's geometry approximations no longer describe
        # this representation. Preserve them as historical evidence, not active QA.
        evidence.setdefault('baselineWarnings',evidence.get('warnings',[]))
        warnings=[]
        if r['textOverflow']:warnings.append('reference-text-bounds-differ')
        if r['textOutsidePage']:warnings.append('render-text-outside-page')
        if r['missingImages']:warnings.append('render-missing-images')
        if r['blockSsim']<.92 or r['normalizedMae']>.035:warnings.append('visual-difference-review')
        entry['license']='';entry['warnings']=warnings;entry['revision']=r['markdownSha256'][:16]
        if entry['status']!='excluded':entry['status']='needs-review' if warnings else 'reconstructed'
        qa={k:r[k]for k in ['textOverflow','textOutsidePage','missingImages','blockSsim','normalizedMae']}
        entry['renderQa']=qa
        evidence['warnings']=warnings;evidence['visualQa']={**qa,'markdownSha256':r['markdownSha256'],'original':r['original'],'replica':r['replica'],'adjustments':r['adjustments']}
        if 'brandingCleanupSha256'in r:
            cleanup=branding[entry['id']]
            if cleanup['afterMarkdownSha256']!=r['markdownSha256'] or hashlib.sha256(json.dumps(cleanup,sort_keys=True).encode()).hexdigest()!=r['brandingCleanupSha256']:
                raise RuntimeError('Stale branding edit evidence: '+entry['id'])
            evidence['brandingCleanup']=cleanup
            evidence['visualQa'].update({k:r[k]for k in ['brandingCleanupSha256','intentionalBrandingEdits','rawComparison']})
        write(evidence_path,evidence)
    # Only the per-page artifact hashes prove currency; changing catalog status
    # is safe after all actual Markdown/image bytes above have been verified.
    (ROOT/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
    index_hash=digest(ROOT/'index.json')
    fields=['id','file','title','kind','description','style','scenarios','tags','density','source','sourcePage','status','warnings','license','textOverflow','textOutsidePage','blockSsim','normalizedMae']
    with (ROOT/'manifest.csv').open('w',newline='')as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for entry in index['entries']:
            data={**entry,**entry['renderQa']}
            writer.writerow({key:' | '.join(data[key])if isinstance(data[key],list)else data[key]for key in fields})
    scan['statusCounts']=dict(collections.Counter(e['status']for e in index['entries']))
    scan['warningCounts']=dict(collections.Counter(w for e in index['entries']for w in e['warnings']))
    scan['visualComparison']='visual-comparison/comparison.json; all pages paired against source PDF render; model visual spot checks are documented separately'
    scan['manualVisualReview']=f'Automated image comparison covers every page; model visual review covers documented representative/problem pages, not a claim of {len(rows)} manual approvals.'
    write(ROOT/'scan-report.json',scan)
    comparison['sourceIndexSha256']=index_hash;write(OUT/'comparison.json',comparison)
    browser=read(OUT/'browser-comparison.json');browser['sourceIndexSha256']=index_hash;write(OUT/'browser-comparison.json',browser)
    write(OUT/'original-render-report.json',{'version':1,'sourceCount':len(originals),'pageCount':sum(r['pages']for r in originals),'sources':originals})
    audit={'version':1,'sourceIndexSha256':index_hash,'pages':len(rows),'errors':0,'pagesWithMissingImages':sum(bool(r['missingImages'])for r in rows.values()),'pagesWithTextOverflow':sum(bool(r['textOverflow'])for r in rows.values()),'pagesWithTextOutsidePage':sum(bool(r['textOutsidePage'])for r in rows.values()),'comparison':'visual-comparison/comparison.json','manualVisualReview':scan['manualVisualReview'],'results':[{k:r[k]for k in ['id','markdownSha256','textOverflow','textOutsidePage','missingImages','blockSsim','normalizedMae']}for r in rows.values()]}
    write(ROOT/'render-audit.json',audit)
    print(json.dumps({k:v for k,v in audit.items()if k!='results'},ensure_ascii=False))

if __name__=='__main__':finalize()
