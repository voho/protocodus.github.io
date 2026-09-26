#!/usr/bin/env python3
"""Losslessly pad separately drawn ship frames into equal cells without clipping.

Image generation let some ships extend into the unused center cell. These
rectangles isolate each complete vessel through transparent gaps. No frame is
rotated, flipped, resampled, recolored, or repainted by this preparation step.
"""
from pathlib import Path
import json
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
BOXES = [(0, 0, 450, 480), (450, 0, 810, 480), (810, 0, 1254, 480),
         (0, 480, 490, 745), None, (760, 480, 1254, 745),
         (0, 735, 450, 1254), (450, 735, 810, 1254), (810, 735, 1254, 1254)]
CELL = 640
source = Image.open(ROOT / 'source-generated.png').convert('RGBA')
assert source.size == (1254, 1254), source.size
out = Image.new('RGBA', (CELL * 3, CELL * 3))
covered = Image.new('L', source.size)
records = []
for index, box in enumerate(BOXES):
    if box is None:
        records.append(None)
        continue
    crop = source.crop(box)
    mask = crop.getchannel('A').point(lambda value: 255 if value > 8 else 0)
    bounds = mask.getbbox()
    assert bounds and min(bounds[0], bounds[1], crop.width - bounds[2], crop.height - bounds[3]) >= 8, (index, bounds)
    covered.paste(mask, box[:2])
    offset = ((CELL - crop.width) // 2, (CELL - crop.height) // 2)
    out.paste(crop, (index % 3 * CELL + offset[0], index // 3 * CELL + offset[1]))
    records.append({'originalCrop': list(box), 'paddedCellOffset': list(offset), 'meaningfulBounds': list(bounds)})
original_mask = source.getchannel('A').point(lambda value: 255 if value > 8 else 0)
assert ImageChops.subtract(original_mask, covered).getbbox() is None, 'Meaningful source pixels omitted'
out.save(ROOT / 'source-packed.png', optimize=True)
(ROOT / 'source-layout.json').write_text(json.dumps({'sourceSize': list(source.size), 'paddedCellSize': CELL, 'operations': 'RGBA crop and integer translation only; no resampling or rotation', 'cells': records}, indent=2) + '\n')
print(ROOT / 'source-packed.png')
