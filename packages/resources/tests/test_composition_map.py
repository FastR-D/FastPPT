import importlib.util
import pathlib
import tempfile
import json
import hashlib
import csv
import unittest
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('composition_map',pathlib.Path(__file__).parents[1]/'scripts/composition-map.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MappingTests(unittest.TestCase):
 def test_fragments_map_many_to_one_but_duplicate_text_is_ambiguous(self):
  o={'id':'shape-1','sourceShapeId':'1','text':'Alpha Beta','box':[0,0,1,1],'children':[]}
  a={'anchor':'text-0','sourceShapeId':None,'kind':'text','text':'Alpha','box':[.1,.1,.2,.1]}
  maps,used=m.mapping([o],[a]);self.assertEqual(used,{'shape-1'});self.assertEqual(maps[0]['confidence'],.82)
  maps,used=m.mapping([o,{**o,'id':'shape-2'}],[a]);self.assertFalse(used);self.assertEqual(maps[0]['status'],'ambiguous')
 def test_geometry_is_candidate_not_identity(self):
  o={'id':'shape-1','sourceShapeId':'1','text':'','box':[0,0,1,1],'children':[]}
  a={'anchor':'paint-0','sourceShapeId':None,'kind':'native','text':'','box':[0,0,1,1]}
  maps,used=m.mapping([o],[a]);self.assertFalse(used);self.assertIsNone(maps[0]['sourceObject'])
 def test_flipped_coordinate_box_is_positive_and_rotated_candidates_are_not_asserted(self):
  shape=SimpleNamespace(left=10,top=20,width=30,height=40)
  self.assertEqual(m.bbox(shape,(-1,1,100,0),100,100),[.6,.2,.3,.4])
  o={'id':'shape-1','sourceShapeId':'1','text':'Alpha','box':[0,0,1,1],'children':[],'limitations':['box is unrotated layout rectangle; rotated geometry needs visual inspection']}
  a={'anchor':'text-0','sourceShapeId':None,'kind':'text','text':'Alpha','box':[.1,.1,.2,.1]}
  maps,used=m.mapping([o],[a]);self.assertFalse(used);self.assertFalse(maps)
 def test_text_reference_box_survives_html_parsing(self):
  a=m.anchors('<span data-fastppt-group="text-1" data-resource-text="true" data-reference-box="0.1,0.2,0.3,0.4">A &amp; B</span>')[0]
  self.assertEqual(a['text'],'A & B');self.assertEqual(a['box'],[.1,.2,.3,.4])
 def test_incremental_report_keeps_full_coverage_and_recomputes_totals(self):
  previous={'pageCount':2,'sourceCount':1,'sources':[{'source':'a.pptx','sha256':'old','pages':2}],'totals':{'slots':5},'pages':[{'id':'a','slots':2,'pageSha256':'a-old'},{'id':'b','slots':3,'pageSha256':'b-unchanged'}]}
  partial={'sources':[{'source':'a.pptx','sha256':'new','pages':1}],'totals':{'slots':4},'pages':[{'id':'a','slots':4,'pageSha256':'a-new'}]}
  merged=m.merge_report(previous,partial)
  self.assertEqual(merged['pageCount'],2);self.assertEqual(merged['totals']['slots'],7)
  self.assertEqual(merged['pages'][1],previous['pages'][1]);self.assertEqual(merged['pages'][0]['pageSha256'],'a-new')
  self.assertEqual(merged['sources'][0],{'source':'a.pptx','sha256':'new','pages':2})
 def test_publish_updates_revision_and_retains_historical_evidence(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'evidence').mkdir()
   original={'reconstruction':'source-rendered baseline','reconstructedSlots':[{'text':'Original'}],'visualQa':{'markdownSha256':'old','blockSsim':.99}}
   (root/'evidence/x.json').write_text(json.dumps(original));(root/'index.json').write_text(json.dumps({'version':1,'entries':[]}))
   (root/'manifest.csv').write_text('id,textOverflow,textOutsidePage,blockSsim,normalizedMae\nx,0,0,0.99,0.01\n')
   entry={'id':'x','renderQa':{'blockSsim':.99}};sha=hashlib.sha256(b'new page').hexdigest()
   m.publish(root,[entry],[{'id':'x','pageSha256':sha,'stats':{}}])
   evidence=json.loads((root/'evidence/x.json').read_text())
   self.assertEqual(evidence['reconstructedSlots'],original['reconstructedSlots']);self.assertEqual(evidence['reconstruction'],original['reconstruction'])
   self.assertNotIn('visualQa',evidence);self.assertEqual(evidence['historicalVisualQa'],original['visualQa']);self.assertEqual(evidence['currentPageSha256'],sha)
   self.assertEqual(entry['revision'],sha[:16]);self.assertNotIn('renderQa',entry)
   with (root/'manifest.csv').open() as f:row=next(csv.DictReader(f))
   self.assertEqual(row['revision'],sha[:16]);self.assertEqual(row['blockSsim'],'');self.assertEqual(row['historicalBlockSsim'],'0.99')
if __name__=='__main__':unittest.main()
