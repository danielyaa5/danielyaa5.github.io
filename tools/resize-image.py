#!/usr/bin/env python3
"""Make the display copy of an image that the pages load.

    python3 tools/resize-image.py assets/illustrations/hero.webp 800

writes assets/illustrations/hero-800.webp: the image scaled to 800 pixels wide,
as WebP at quality 85, keeping transparency and any color profile. The full-size
file stays as the source. Pick the width as the larger of twice the widest size
the image is shown at on desktop and three times the widest on phones.

With --replace and no width, the file is re-encoded in place at --quality
(default 80), keeping its size and color profile. Use it for photos, and bump
the ?v= on the image's address afterwards.
"""
import argparse
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('width', nargs='?', type=int)
parser.add_argument('--quality', type=int)
parser.add_argument('--replace', action='store_true')
args = parser.parse_args()

source = Path(args.source)
image = Image.open(source)
image.load()
options = {'quality': args.quality or (80 if args.replace else 85), 'method': 6}
if image.info.get('icc_profile'):
    options['icc_profile'] = image.info['icc_profile']

if args.replace:
    if args.width:
        parser.error('--replace keeps the size; leave out the width')
    target = source
else:
    if not args.width:
        parser.error('give the width to scale to')
    if args.width >= image.width:
        parser.error(f'{source} is only {image.width} pixels wide')
    height = round(image.height * args.width / image.width)
    image = image.resize((args.width, height), Image.LANCZOS)
    target = source.with_name(f'{source.stem}-{args.width}.webp')

image.save(target, 'WEBP', **options)
print(f'{target}: {image.width}x{image.height}, {target.stat().st_size // 1024} KB')
