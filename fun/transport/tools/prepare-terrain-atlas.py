#!/usr/bin/env python3
"""Losslessly register a generated 3×3 sheet through its transparent gutters.

Only RGBA crops and integer translations: no painting, alpha edits or resampling.
The shared atlas packer subsequently produces the normal display resolutions.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops


def separator(counts, near):
    runs, start = [], None
    for i in range(max(1, near - 60), min(len(counts) - 1, near + 61)):
        if counts[i] == 0:
            if start is None:
                start = i
        elif start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, min(len(counts) - 1, near + 61)))
    assert runs, 'No transparent separation; inspect or regenerate the sheet.'
    left, right = max(runs, key=lambda r: (r[1] - r[0], -abs((r[0] + r[1]) / 2 - near)))
    return (left + right) // 2


def prepare(source_path, dest):
    source = Image.open(source_path).convert('RGBA')
    mask = source.getchannel('A').point(lambda a: 255 if a > 8 else 0)
    y_counts = [sum(mask.crop((0, y, source.width, y + 1)).histogram()[1:]) for y in range(source.height)]
    ys = [0, separator(y_counts, source.height // 3), separator(y_counts, source.height * 2 // 3), source.height]
    cell = 640
    out = Image.new('RGBA', (cell * 3, cell * 3)); covered = Image.new('L', source.size)
    records = []
    for row in range(3):
        y0, y1 = ys[row:row + 2]
        counts = [sum(mask.crop((x, y0, x + 1, y1)).histogram()[1:]) for x in range(source.width)]
        xs = [0, separator(counts, source.width // 3), separator(counts, source.width * 2 // 3), source.width]
        for col in range(3):
            box = (xs[col], y0, xs[col + 1], y1)
            crop = source.crop(box)
            assert crop.width < cell and crop.height < cell
            offset = ((cell - crop.width) // 2, (cell - crop.height) // 2)
            out.paste(crop, (col * cell + offset[0], row * cell + offset[1]))
            covered.paste(mask.crop(box), box[:2])
            records.append({'sourceCrop': list(box), 'integerOffset': list(offset)})
    assert ImageChops.subtract(mask, covered).getbbox() is None, 'Source pixels omitted'
    out.save(dest, optimize=True)
    Path(dest).with_suffix('.json').write_text(json.dumps({'source': str(source_path), 'sourceSize': source.size, 'cell': cell, 'operation': 'RGBA crop and integer translation only', 'cells': records}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args(); prepare(args.source, args.output)
