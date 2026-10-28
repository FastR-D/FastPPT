"""Make temporary, relationship-complete source slide subsets for bounded LO rendering.
The selected slide parts and their styles/media are copied byte-for-byte, except
hidden flags needed to render every requested source page. Originals are immutable.
"""
import pathlib,posixpath,re,zipfile
from lxml import etree
P='http://schemas.openxmlformats.org/presentationml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';PKG='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'

def subset(archive,destination,start,end):
 presentation=etree.fromstring(archive.read('ppt/presentation.xml'));lst=presentation.find('{'+P+'}sldIdLst');all_slides=list(lst);selected=all_slides[start:end];ids={node.get('{'+R+'}id') for node in selected}
 for node in all_slides:
  if node not in selected:lst.remove(node)
 changed={'ppt/presentation.xml':etree.tostring(presentation,xml_declaration=True,encoding='UTF-8',standalone=True)}
 included={'[Content_Types].xml'};pending=[''];members=set(archive.namelist())
 def relation_path(part):return posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels') if part else '_rels/.rels'
 while pending:
  part=pending.pop()
  if part and part in included:continue
  if part:included.add(part)
  relations=relation_path(part)
  if relations not in members:continue
  xml=etree.fromstring(archive.read(relations));included.add(relations);modified=False
  for rel in list(xml):
   kind=rel.get('Type','').rsplit('/',1)[-1]
   if (part=='ppt/presentation.xml' and kind=='slide' and rel.get('Id') not in ids) or (part.startswith('ppt/slides/') and kind=='slide') or kind in ('notesSlide','comments','commentAuthors'):
    xml.remove(rel);modified=True;continue
   if rel.get('TargetMode','').lower()=='external':continue
   target=rel.get('Target','').split('#')[0]
   path=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part),target))
   if path in members and path not in included:pending.append(path)
  if modified:changed[relations]=etree.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
 types=etree.fromstring(archive.read('[Content_Types].xml'))
 for node in list(types):
  if node.tag=='{'+CT+'}Override' and node.get('PartName','').lstrip('/') not in included:types.remove(node)
 changed['[Content_Types].xml']=etree.tostring(types,xml_declaration=True,encoding='UTF-8',standalone=True)
 with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as out:
  for name in sorted(included):
   data=changed.get(name)
   if data is None:data=archive.read(name)
   if re.match(r'ppt/slides/slide\d+\.xml$',name):
    xml=etree.fromstring(data)
    if xml.get('show') in ('0','false'):xml.set('show','1');data=etree.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
   out.writestr(name,data)
 return len(selected)
