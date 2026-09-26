#!/usr/bin/env python3
"""Lossless grid padding: split the generated sheet only through empty gaps."""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parent
image = Image.open(ROOT / 'source-generated.png').convert('RGBA')
assert image.size == (1254, 1254)
row_cuts = [0, 455, 843, 1254]
column_cuts = [0, 418, 836, 1254]
canvas = Image.new('RGBA', (1536, 1536))
for row in range(3):
    for column in range(3):
        cell = image.crop((column_cuts[column], row_cuts[row], column_cuts[column + 1], row_cuts[row + 1]))
        canvas.paste(cell, (column * 512 + (512 - cell.width) // 2, row * 512 + (512 - cell.height) // 2))
canvas.save(ROOT / 'source-packed.png', compress_level=9)
