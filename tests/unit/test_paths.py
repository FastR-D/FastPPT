from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastppt_core.paths import UnsafePathError, resolve_inside, validate_logical_path


class PathTests(TestCase):
    def test_logical_path_uses_posix_segments(self) -> None:
        self.assertEqual(validate_logical_path("project/artifact.bin").as_posix(), "project/artifact.bin")

    def test_rejects_absolute_and_traversal_paths(self) -> None:
        for value in ("../secret", "/etc/passwd", "C:/secret", "C:\\secret", "folder\\file"):  # hygiene: allow-test-fixture
            with self.subTest(value=value), self.assertRaises(UnsafePathError):
                validate_logical_path(value)

    def test_resolves_only_inside_workspace(self) -> None:
        with TemporaryDirectory(prefix="fastppt path test ") as temp_name:
            root = Path(temp_name)
            self.assertEqual(resolve_inside(root, "one/two").parent, (root / "one").resolve())
