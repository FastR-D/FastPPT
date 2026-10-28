#!/usr/bin/env python3
import importlib.util,pathlib,re,unittest,html,json
sp=importlib.util.spec_from_file_location('native',pathlib.Path(__file__).with_name('native-html.py'));n=importlib.util.module_from_spec(sp);sp.loader.exec_module(n)
def svg(body):return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" data-fastppt-group="paint-1" style="position:absolute;inset:0">'+body+'</svg>'
class Native(unittest.TestCase):
 def test_rectangle_and_text_bytes(self):
  text='<span data-fastppt-group="text-7" style="font-family:Arial"> A &amp; B </span>';out,r=n.convert(svg('<path d="M10 10H30V40H10Z" fill="#abcdef"/>')+text);self.assertIn(text,out);self.assertIn('data-fastppt-native="rect"',out)
 def test_hole(self):
  out,r=n.convert(svg('<path d="M0 0H100V100H0Z M25 25H75V75H25Z" fill-rule="evenodd" fill="#123456"/>'));payload=json.loads(html.unescape(re.search('data-fastppt-geometry="([^"]*)"',out)[1]));self.assertEqual(len(payload['paths']),2);self.assertEqual(payload['fillRule'],'evenodd')
 def test_fallback_idempotent(self):
  a,r=n.convert(svg('<path d="M1 1A10 10 0 0 0 20 20"/>'));b,r=n.convert(a);self.assertEqual(a,b);self.assertIn('path-command-A',a)
 def test_existing_fallback_keeps_original_reason(self):
  a=svg('<use href="#previously-converted-object"/>').replace('<svg ','<svg data-fastppt-fallback="translated-use" ',1);b,r=n.convert(a);self.assertEqual(a,b);self.assertEqual(r['fallbackReasons'],{'translated-use':1})
 def test_shared_image_use_keeps_source_id_and_transforms(self):
  source=svg('<g transform="matrix(0.5,0,0,0.5,20,30)"><image id="shared" width="100" height="80" href="../assets/test.png"/></g>');repeat=svg('<g transform="matrix(0,1,-1,0,200,40)"><use href="#shared"/></g>').replace('paint-1','paint-2');fallback=svg('<g transform="matrix(1,0,0,1,400,50)"><use href="#shared" x="0" y="0"/></g>').replace('paint-1','paint-3');out,r=n.convert(source+repeat+fallback);self.assertIn('id="shared"',out);self.assertEqual(r['fallbackReasons']['referenced-svg-definition'],1);self.assertIn('transform:matrix(0,1,-1,0,0,0)',out);self.assertIn('left:20.83333333%',out);self.assertIn('transform="matrix(1,0,0,1,400,50)"',out);self.assertEqual(n.convert(out)[0],out)
 def test_shared_geometry_use_keeps_source_definition(self):
  out,r=n.convert(svg('<path id="shared-path" d="M0 0H10V10H0Z" fill="#abcdef"/>')+svg('<use href="#shared-path" x="0"/>').replace('paint-1','paint-2'));self.assertIn('id="shared-path"',out);self.assertEqual(r['fallbackReasons']['referenced-svg-definition'],1)
 def test_clip_boolean(self):
  defs='<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><path d="M0 0H30V30H0Z M40 40H50V50H40Z"/></clipPath></defs></svg>';a,r=n.convert(defs+svg('<g clip-path="url(#c)"><path d="M0 0H100V100H0Z" fill="#abcdef"/></g>'));self.assertEqual(r['native'].get('geometry'),1)
 def test_collinear_curve_overshoot(self):
  paths,curved=n.path('M0 0C100 0 100 0 10 0');self.assertGreater(max(x for x,y in paths[0][0]),50)
 def test_geometry_opacity_not_multiplied_in_metadata(self):
  out,r=n.convert(svg('<g opacity="0.5"><path d="M0 0L100 0L50 50Z" fill="#123456" fill-opacity="0.4" stroke="#ffffff" stroke-opacity="0.6"/></g>'));payload=json.loads(html.unescape(re.search('data-fastppt-geometry="([^"]*)"',out)[1]));self.assertEqual(payload['fillOpacity'],.4);self.assertEqual(payload['strokeOpacity'],.6);self.assertIn('opacity:0.5;',out)
 def test_self_crossing_evenodd_native_contours(self):
  out,r=n.convert(svg('<path d="M0 0L100 100L0 100L100 0Z" fill="#123456" fill-rule="evenodd"/>'));payload=json.loads(html.unescape(re.search('data-fastppt-geometry="([^"]*)"',out)[1]));self.assertEqual(len(payload['paths']),2)
  for p in payload['paths']:self.assertTrue(n.LineString(p['points']+[p['points'][0]]).is_simple)
 def test_self_crossing_evenodd_stroke_fallback(self):
  out,r=n.convert(svg('<path d="M0 0L100 100L0 100L100 0Z" fill="#123456" fill-rule="evenodd" stroke="#abcdef"/>'));self.assertEqual(r['fallbackReasons'].get('self-intersecting-evenodd-stroke'),1)
if __name__=='__main__':unittest.main()
