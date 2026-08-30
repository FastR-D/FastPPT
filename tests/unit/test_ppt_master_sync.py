import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch, sentinel


SYNC_PATH = Path(__file__).resolve().parents[2] / "kernel" / "ppt-master" / "sync.py"
SYNC_SPEC = importlib.util.spec_from_file_location("fastppt_kernel_sync", SYNC_PATH)
if SYNC_SPEC is None or SYNC_SPEC.loader is None:
    raise RuntimeError(f"Unable to load kernel sync module from {SYNC_PATH}")
sync = importlib.util.module_from_spec(SYNC_SPEC)
SYNC_SPEC.loader.exec_module(sync)


class KernelSyncTests(TestCase):
    def test_sync_workspace_is_anchored_to_kernel_volume(self) -> None:
        with patch.object(
            sync.tempfile,
            "TemporaryDirectory",
            return_value=sentinel.workspace,
        ) as temporary_directory:
            self.assertIs(sync._temporary_workspace(), sentinel.workspace)

        temporary_directory.assert_called_once_with(
            prefix="fastppt-kernel-sync-",
            dir=sync.WRAPPER_ROOT.parent,
        )

    def test_failed_snapshot_copy_restores_original(self) -> None:
        with TemporaryDirectory(prefix="fastppt kernel sync test ") as temp_name:
            root = Path(temp_name)
            current = root / "upstream"
            current.mkdir()
            (current / "original.txt").write_text("original", encoding="utf-8")
            candidate = root / "candidate"
            candidate.mkdir()
            (candidate / "updated.txt").write_text("updated", encoding="utf-8")
            backup = root / "workspace" / "previous"
            backup.parent.mkdir()

            def fail_after_partial_copy(_source: Path, destination: Path) -> None:
                destination.mkdir()
                (destination / "partial.txt").write_text("partial", encoding="utf-8")
                raise OSError("injected copy failure")

            with (
                patch.object(sync, "KERNEL_ROOT", current),
                patch.object(sync.shutil, "copytree", side_effect=fail_after_partial_copy),
                self.assertRaisesRegex(OSError, "injected copy failure"),
            ):
                sync._replace_snapshot(candidate, backup)

            self.assertEqual((current / "original.txt").read_text(encoding="utf-8"), "original")
            self.assertFalse((current / "partial.txt").exists())
            self.assertFalse(backup.exists())
