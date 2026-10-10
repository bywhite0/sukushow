import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = pathlib.Path(__file__).with_name('link-assets.py')
SPEC = importlib.util.spec_from_file_location('link_assets', SCRIPT)
link_assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(link_assets)


class RemuxMvTests(unittest.TestCase):
    def test_converts_usm_to_mp4_without_reencoding_and_skips_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / 'music_lyric_video_103103.usm'
            target = pathlib.Path(directory) / '103103.mp4'
            source.write_bytes(b'usm')

            def write_output(args, **kwargs):
                self.assertIn('copy', args)
                self.assertIn('+faststart', args)
                pathlib.Path(args[-1]).write_bytes(b'mp4')

            with patch.object(link_assets.subprocess, 'run', side_effect=write_output) as run:
                self.assertEqual(link_assets.remux_mv(source, target), 'convert')
                self.assertEqual(target.read_bytes(), b'mp4')
                self.assertEqual(link_assets.remux_mv(source, target), 'skip')
                self.assertEqual(run.call_count, 1)

    def test_failed_conversion_does_not_leave_an_incomplete_mp4(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / 'music_lyric_video_103103.usm'
            target = pathlib.Path(directory) / '103103.mp4'
            source.write_bytes(b'usm')
            with patch.object(link_assets.subprocess, 'run', side_effect=RuntimeError('ffmpeg failed')):
                with self.assertRaisesRegex(RuntimeError, 'ffmpeg failed'):
                    link_assets.remux_mv(source, target)
            self.assertFalse(target.exists())
            self.assertFalse((target.with_suffix('.mp4.part')).exists())


if __name__ == '__main__':
    unittest.main()
