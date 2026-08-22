from unittest import TestCase

from fastppt_core.svg import render_page_svg


class SvgRenderingTests(TestCase):
    def test_long_title_is_wrapped_into_editable_tspans(self) -> None:
        title = "A very long title that exceeds the slide width and should remain editable"
        svg = render_page_svg(title, "Body", page_number=1)

        self.assertGreaterEqual(svg.count("<tspan"), 2)
        self.assertIn("A very long title", svg)
        self.assertIn("should remain", svg)
        self.assertIn("editable", svg)
