#!/usr/bin/env python3
"""Make a side-by-side reference/current image for human acceptance review.

Optional: Pillow (python3 -m pip install pillow). No threshold claims full fidelity.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('current', type=Path, help='Screenshot captured from the running Hermes Life frontend')
    ap.add_argument('--reference', type=Path, default=HERE/'reference.jpg')
    ap.add_argument('--output', type=Path, default=HERE/'phase6-visual-comparison.png')
    args = ap.parse_args()
    try:
        from PIL import Image, ImageOps, ImageDraw
    except ImportError:
        print('Pillow is required for visual comparison: python3 -m pip install pillow', file=sys.stderr)
        return 2
    if not args.current.is_file() or not args.reference.is_file():
        print('Missing current screenshot or bundled user reference.', file=sys.stderr); return 2
    ref = Image.open(args.reference).convert('RGB'); live = Image.open(args.current).convert('RGB')
    width = 1200
    height = max(360, round(width * ref.height/ref.width), round(width * live.height/live.width))
    def letterbox(im):
        return ImageOps.pad(im, (width, height), color='#08111c', method=Image.Resampling.LANCZOS)
    pad = 48
    out = Image.new('RGB', (width*2+32, height+pad), '#08111c')
    out.paste(letterbox(ref), (0,pad));out.paste(letterbox(live), (width+32,pad))
    d=ImageDraw.Draw(out);d.text((15,15),'USER REFERENCE — target composition', fill='#e2f2fc')
    d.text((width+47,15),'LIVE BROWSER — current implementation', fill='#e2f2fc')
    args.output.parent.mkdir(parents=True,exist_ok=True);out.save(args.output)
    print('Human visual review:', args.output)
    print('Verify all eight spaces, center silhouette, right/left rails, live data, room labels and only one Hermesha Command Centre.')
    return 0
if __name__ == '__main__':raise SystemExit(main())
