"""Regression coverage for removing branding without erasing useful artwork."""
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / 'scripts' / 'clean-branding.py'
SPEC = importlib.util.spec_from_file_location('clean_branding', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def page(body):
    return '---\nlayout: none\n---\n<div v-pre class="sample">' + body + '</div>\n'


def text(anchor, value, box='0.1,0.2,0.3,0.1'):
    return f'<span data-resource-text="true" data-fastppt-group="{anchor}" data-reference-box="{box}">{value}</span>'


class BrandingCleanupTest(unittest.TestCase):
    def test_logo_mask_dependency_is_removed_but_photo_and_heading_survive(self):
        source = page('''<svg aria-hidden="true"><defs><mask id="brand-mask"><image href="../assets/7ae945fa69b8f2bc2374c975.png" width="354" height="69"/></mask></defs></svg>
<svg data-fastppt-group="logo" viewBox="0 0 960 540"><g mask="url(#brand-mask)"><image href="../assets/f640ae39c0d86d0b19a546e7.jpg" x="800" y="20" width="100" height="20"/></g></svg>
<svg data-fastppt-group="photo" viewBox="0 0 960 540"><image href="../assets/photo.jpg" width="960" height="540"/></svg>''' + text('heading', '工作总结'))
        after, edits, removed, _ = MODULE.clean(source, {'id': 'sample'})
        self.assertEqual(removed, {'logo'})
        self.assertEqual(edits[0]['box'], [800/960, 20/540, 100/960, 20/540])
        self.assertNotIn('brand-mask', after)
        self.assertIn('photo.jpg', after)
        self.assertIn('工作总结', after)
        self.assertEqual(MODULE.clean(after, {'id': 'sample'})[0], after)

    def test_consecutive_author_glyphs_are_removed_but_common_characters_survive(self):
        source = page(''.join(text(str(i), t) for i, t in enumerate(['方法', '©', '方', '能', '演', '亦', '能力提升', '汇报人：旁门左道'])))
        after, edits, removed, replaced = MODULE.clean(source, {'id': 'sample'})
        self.assertEqual(removed, {'1', '2', '3', '4', '5'})
        self.assertEqual(replaced, {'7': '汇报人：企业名称'})
        self.assertIn('能力提升', after)
        self.assertIn('方法', after)
        self.assertEqual(len(edits), 6)

    def test_corner_geometry_never_removes_a_line_crossing_the_page(self):
        source = page('''<svg data-fastppt-group="wordmark" viewBox="0 0 960 540"><path transform="matrix(1,0,0,-1,0,540)" d="M938 300H948V310H938Z"/></svg>
<svg data-fastppt-group="border" viewBox="0 0 960 540"><path d="M0 300H950V301H0Z"/></svg>''')
        after, _, removed, _ = MODULE.clean(source, {'id': 'c9f1632d31e4-0006'})
        self.assertEqual(removed, {'wordmark'})
        self.assertIn('data-fastppt-group="border"', after)


if __name__ == '__main__': unittest.main()
