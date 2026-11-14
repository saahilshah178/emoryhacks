"""Check video normalisation by hand. No Gemini calls.

  cd backend
  uv run python -m scripts.try_recording normalize FILE [FILE ...]
      Show, for each file, why it would be remuxed or re-encoded, the result's probe
      info, its largest keyframe gap and whether its index is at the front.
"""
from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

from app import media


def normalize_files(paths: list[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for path in paths:
            print(f"== {path}")
            try:
                before = media.probe(path)
                reason = media.transcode_reason(path, before)
                started = time.time()
                out = Path(tmp) / "out.mp4"
                after = media.normalize(path, out)
            except media.MediaError as exc:
                print(f"   rejected: {exc}")
                continue
            keys, end = media.keyframe_times(out)
            gap = max(b - a for a, b in zip([0.0, *keys], [*keys, end]))
            boxes = media.mp4_boxes(out)
            print(f"   input:  {before}")
            print(f"   action: {'re-encode (' + reason + ')' if reason else 'remux'} in {time.time() - started:.1f}s")
            print(f"   output: {after}")
            print(f"   keyframe gap max {gap:.2f}s, faststart={boxes.index('moov') < boxes.index('mdat')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("normalize")
    n.add_argument("files", nargs="+")
    normalize_files(parser.parse_args().files)
