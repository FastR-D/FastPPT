#!/usr/bin/env python3
"""Render source PPTX via LibreOffice, retaining original slide order (incl hidden).
Only generated PDFs/JPEGs are written. Source packages are never rewritten.
"""
import argparse,hashlib,json,pathlib,subprocess,tempfile,time,zipfile,re
from lxml import etree
import pymupdf as fitz
import importlib.util
spec=importlib.util.spec_from_file_location("pptx_chunks",pathlib.Path(__file__).with_name("pptx-chunks.py"));chunks=importlib.util.module_from_spec(spec);spec.loader.exec_module(chunks)
import os,signal
ROOT=pathlib.Path(__file__).resolve().parents[3]
LIB=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--source-id');p.add_argument('--save-screenshots',action='store_true');args=p.parse_args()
sources=json.loads((LIB/'scan-report.json').read_text())['sources']
results=[]
for source in sources:
 if args.source_id and source['id'] not in args.source_id.split(','):continue
 dest=LIB/'visual-comparison'/'originals'/source['id'];dest.mkdir(parents=True,exist_ok=True)
 input=ROOT/source['path'];pdf=dest/(input.stem+'.pdf')
 try:
  receipt=dest/'receipt.json'
  cached=pdf.exists() and receipt.exists() and json.loads(receipt.read_text()).get('sourceSha256')==source['sha256']
  if not cached:
   pdf.unlink(missing_ok=True)
   with tempfile.TemporaryDirectory(prefix='fastppt-lo-') as profile:
    source_input=input
    def export_file(input_path,out_dir):
     cmd=['/usr/bin/soffice','-env:UserInstallation='+pathlib.Path(profile).as_uri(),'--headless','--norestore','--nologo','--nofirststartwizard','--convert-to','pdf','--outdir',str(out_dir),str(input_path)]
     proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
     try:stdout,stderr=proc.communicate(timeout=180)
     except subprocess.TimeoutExpired:
      os.killpg(proc.pid,signal.SIGKILL);proc.communicate();raise RuntimeError('Source renderer timed out; process group terminated')
     result_pdf=out_dir/(input_path.stem+'.pdf')
     if proc.returncode or not result_pdf.exists():raise RuntimeError(stderr.decode(errors='replace')[-1500:])
     return result_pdf
    with zipfile.ZipFile(input) as archive:
     if source['pages']>300:
      merged=fitz.open()
      for start in range(0,source['pages'],32):
       part=pathlib.Path(profile)/f'source-{start:04d}.pptx';expected=chunks.subset(archive,part,start,start+32)
       rendered=export_file(part,pathlib.Path(profile));doc_part=fitz.open(rendered)
       if len(doc_part)!=expected:raise RuntimeError('Chunk page count mismatch')
       merged.insert_pdf(doc_part);doc_part.close();part.unlink();rendered.unlink()
       print(f'  {source["id"]}: original {min(start+32,source["pages"])}/{source["pages"]}',flush=True)
      merged.save(pdf,garbage=3,deflate=True);merged.close()
     else:
      hidden=[name for name in archive.namelist() if re.match(r'ppt/slides/slide\d+\.xml$',name) and etree.fromstring(archive.read(name)).get('show') in ('0','false')]
      if hidden:
       source_input=pathlib.Path(profile)/input.name
       with zipfile.ZipFile(source_input,'w',compression=zipfile.ZIP_DEFLATED) as copy:
        for member in archive.infolist():
         data=archive.read(member.filename)
         if member.filename in hidden:
          xml=etree.fromstring(data);xml.set('show','1');data=etree.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
         copy.writestr(member,data)
      rendered=export_file(source_input,dest)
  doc=fitz.open(pdf)
  if len(doc)!=source['pages']:raise RuntimeError(f'Original page count {len(doc)} != {source["pages"]}')
  if not cached:
   for stale in dest.glob('*.jpg'):stale.unlink()
  for index,page in enumerate(doc,1) if args.save_screenshots else []:
   image=dest/f'{index:04d}.jpg'
   if not image.exists():
    scale=960/page.rect.width
    pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
    pix.pil_save(str(image),format='JPEG',quality=82)
  result={'id':source['id'],'source':source['path'],'sourceSha256':source['sha256'],'pages':len(doc),'pdf':pdf.name,'renderer':'LibreOffice Impress PDF export; hidden slide visibility enabled in a temporary copy when required','rasterizer':'PyMuPDF at 960px width'if args.save_screenshots else'not retained; source PDF only'}
  receipt.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');results.append(result)
  print(f'{source["id"]} {len(doc)} pages {source["path"]}',flush=True)
 except Exception as error:
  results.append({'id':source['id'],'source':source['path'],'error':str(error)});print(f'ERROR {source["path"]}: {error}',flush=True)
 (LIB/'visual-comparison'/('partial-original-render-report.json' if args.source_id else 'original-render-report.json')).write_text(json.dumps({'version':1,'sources':results},ensure_ascii=False,indent=2)+'\n')
