#!/usr/bin/env python3
"""Pack the generated sprite sheets into the trimmed atlases the game loads.

    python3 tools/pack-atlases.py [--lossless]

assets/sprites/source/ holds the original lossless grid sheets, which the game
never requests. Each grid cell is cropped exactly as the game used to crop it at
every startup, the crops are packed tightly into assets/sprites/, and the
rectangles are written to sprite-cells.js. The game then only copies rectangles.

Colour is stored lossy (quality 90) and alpha lossless, so silhouettes, crops
and hit shapes are bit-identical to the sources. --lossless keeps colour exact
too, which is how the packing itself is verified against the old runtime crop.

Requires Pillow and numpy.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LAYOUTS = {
    'fleet': (4, 3), 'nature': (4, 4), 'structures': (4, 4), 'materials': (8, 5),
    'effects': (4, 4), 'projectiles': (4, 3), 'structureLight': (4, 4), 'structureHeavy': (4, 4),
    **{f'fleet{name}': (4, 3) for name in
       ('Jungle', 'Snow', 'Desert', 'Paradise', 'Asteroid', 'Mars', 'Volcanic', 'Neon', 'Alien', 'Void')},
}
SOLID = 8          # alpha below this is treated as empty
GUTTER = 2         # transparent pixels between packed crops
OPAQUE_BLEED = 4   # opaque crops repeat their edge so lossy blocks do not mix neighbours
MAX_WIDTH = 2048
QUALITY = 90


def js_round(value):
    return math.floor(value + 0.5)


def file_name(name):
    return ''.join(f'-{c.lower()}' if c.isupper() else c for c in name) + '.webp'


def components(solid):
    """Eight-connected components as (sum_x, sum_y, count, runs); runs are (y, x0, x1)."""
    parent = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    runs, previous = [], []
    for y in range(solid.shape[0]):
        row = np.concatenate(([0], solid[y].astype(np.int8), [0]))
        edges = np.flatnonzero(np.diff(row))
        current = []
        for x0, x1 in zip(edges[::2], edges[1::2] - 1):
            index = len(runs)
            parent.append(index)
            runs.append((y, int(x0), int(x1)))
            for other in previous:
                _, o0, o1 = runs[other]
                if o0 <= x1 + 1 and o1 >= x0 - 1:
                    parent[find(other)] = find(index)
            current.append(index)
        previous = current
    groups = {}
    for index, run in enumerate(runs):
        groups.setdefault(find(index), []).append(run)
    out = []
    for members in groups.values():
        sum_x = sum((x0 + x1) * (x1 - x0 + 1) // 2 for _, x0, x1 in members)
        sum_y = sum(y * (x1 - x0 + 1) for y, x0, x1 in members)
        count = sum(x1 - x0 + 1 for _, x0, x1 in members)
        out.append((sum_x, sum_y, count, members))
    return out


def connected_cells(name, pixels, columns, rows):
    """Hulls and antennas may cross their cell: each connected piece goes to the cell holding its centre."""
    height, width = pixels.shape[:2]
    owned = [[] for _ in range(columns * rows)]
    for sum_x, sum_y, count, members in components(pixels[..., 3] >= SOLID):
        col = min(columns - 1, math.floor(sum_x / count / width * columns))
        row = min(rows - 1, math.floor(sum_y / count / height * rows))
        owned[row * columns + col].extend(members)
    crops = []
    for index, members in enumerate(owned):
        # Sector sheets repeat the player hull in cell 0; the game always uses fleet:0.
        unused_player = index == 0 and name.startswith('fleet') and name != 'fleet'
        if unused_player or not members:
            crops.append(None)
            continue
        left = min(x0 for _, x0, _ in members)
        right = max(x1 for _, _, x1 in members)
        top = min(y for y, _, _ in members)
        bottom = max(y for y, _, _ in members)
        crop = np.zeros((bottom - top + 5, right - left + 5, 4), np.uint8)
        for y, x0, x1 in members:
            crop[y - top + 2, x0 - left + 2:x1 - left + 3] = pixels[y, x0:x1 + 1]
        crops.append(crop)
    return crops


def grid_cells(name, pixels, columns, rows):
    height, width = pixels.shape[:2]
    crops = []
    for index in range(columns * rows):
        # Retired metal, masonry and scorch cells.
        if name == 'effects' and 10 <= index <= 13:
            crops.append(None)
            continue
        col, row = index % columns, index // columns
        x, y = js_round(col * width / columns), js_round(row * height / rows)
        cell = pixels[y:js_round((row + 1) * height / rows), x:js_round((col + 1) * width / columns)]
        solid = cell[..., 3] >= SOLID
        if not solid.any():
            crops.append(None)
            continue
        ys, xs = np.flatnonzero(solid.any(axis=1)), np.flatnonzero(solid.any(axis=0))
        top, bottom = max(0, ys[0] - 2), min(cell.shape[0] - 1, ys[-1] + 2)
        left, right = max(0, xs[0] - 2), min(cell.shape[1] - 1, xs[-1] + 2)
        crops.append(cell[top:bottom + 1, left:right + 1].copy())
    return crops


def pack(crops):
    """Shelf packing, tallest first. Returns the sheet and one [x, y, w, h] or None per crop."""
    opaque = all(crop is None or (crop[..., 3] == 255).all() for crop in crops)
    margin = OPAQUE_BLEED if opaque else GUTTER
    order = sorted((i for i, crop in enumerate(crops) if crop is not None), key=lambda i: -crops[i].shape[0])
    rects, x, y, shelf, sheet_width = [None] * len(crops), margin, margin, 0, 0
    for i in order:
        h, w = crops[i].shape[:2]
        if x + w + margin > MAX_WIDTH:
            x, y, shelf = margin, y + shelf + margin, 0
        rects[i] = [x, y, w, h]
        x += w + margin
        shelf = max(shelf, h)
        sheet_width = max(sheet_width, x)
    sheet = np.zeros((y + shelf + margin, sheet_width, 4), np.uint8)
    for i in order:
        x, y, w, h = rects[i]
        if opaque:
            sheet[y - margin:y + h + margin, x - margin:x + w + margin] = np.pad(
                crops[i], ((margin, margin), (margin, margin), (0, 0)), mode='edge')
        else:
            sheet[y:y + h, x:x + w] = crops[i]
    return sheet, rects, opaque


def main():
    lossless = '--lossless' in sys.argv
    target = ROOT / 'assets' / 'sprites'
    source = target / 'source'
    table = {}
    for name, (columns, rows) in LAYOUTS.items():
        pixels = np.asarray(Image.open(source / file_name(name)).convert('RGBA'))
        connected = name.startswith('fleet') or name == 'structures'
        crops = (connected_cells if connected else grid_cells)(name, pixels, columns, rows)
        sheet, rects, opaque = pack(crops)
        image = Image.fromarray(sheet).convert('RGB' if opaque else 'RGBA')
        if lossless:
            image.save(target / file_name(name), 'WEBP', lossless=True, quality=100, method=6, exact=True)
        else:
            image.save(target / file_name(name), 'WEBP', quality=QUALITY, method=6, alpha_quality=100,
                       use_sharp_yuv=True)
        table[name] = rects
        print(f'{name}: {sheet.shape[1]}x{sheet.shape[0]}, {(target / file_name(name)).stat().st_size // 1024} KiB')
    lines = ',\n'.join(f'  {name}: {json.dumps(rects, separators=(",", ":"))}' for name, rects in table.items())
    (ROOT / 'sprite-cells.js').write_text(
        '// Generated by tools/pack-atlases.py: [x, y, width, height] of every sprite in its packed atlas.\n'
        f'export const SPRITE_CELLS = Object.freeze({{\n{lines},\n}});\n')


if __name__ == '__main__':
    main()
