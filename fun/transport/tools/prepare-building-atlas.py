#!/usr/bin/env python3
"""Register isolated generated buildings without cutting uneven grid gutters.

Uses the existing alpha channel to find disconnected sprites, then copies their
original RGBA pixels into separate padded cells. No painting, recoloring,
resizing, or alpha reconstruction. The ordinary atlas builders normalize later.
Dependencies: Pillow, NumPy, SciPy.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, find_objects, label


def prepare(source_path, output_path):
    source = np.asarray(Image.open(source_path).convert('RGBA'))
    height, width = source.shape[:2]
    meaningful = source[:, :, 3] > 8
    labels, _ = label(meaningful, np.ones((3, 3)))
    counts = np.bincount(labels.ravel())
    slices = find_objects(labels)
    objects = [index for index in range(1, len(counts)) if counts[index] > width * height * .001]
    if len(objects) not in (8, 9):
        raise ValueError(f'Expected eight or nine separate buildings, found {len(objects)}; inspect or regenerate.')
    owner = np.zeros(labels.shape, np.int16)
    ids = set()
    for component in objects:
        y, x = slices[component - 1]
        col = min(2, int((x.start + x.stop) / 2 / width * 3))
        row = min(2, int((y.start + y.stop) / 2 / height * 3))
        identity = row * 3 + col + 1
        if identity in ids:
            raise ValueError('Two buildings occupy the same atlas cell; inspect or regenerate.')
        ids.add(identity)
        owner[labels == component] = identity
    # Assign detached details and the original faint antialiased perimeter to
    # the nearest building. The alpha values themselves remain unmodified.
    _, nearest = distance_transform_edt(owner == 0, return_indices=True)
    owner = owner[nearest[0], nearest[1]]
    cell = 640
    result = Image.new('RGBA', (cell * 3, cell * 3))
    records, preserved = [], 0
    for identity in range(1, 10):
        mask = meaningful & (owner == identity) if identity in ids else np.zeros_like(meaningful)
        if not mask.any():
            records.append({'cell': identity - 1, 'empty': True})
            continue
        ys, xs = np.nonzero(mask)
        x0, y0, x1, y1 = max(0, xs.min() - 3), max(0, ys.min() - 3), min(width, xs.max() + 4), min(height, ys.max() + 4)
        crop = source[y0:y1, x0:x1].copy()
        crop[owner[y0:y1, x0:x1] != identity] = 0
        if max(crop.shape[:2]) >= cell - 20:
            raise ValueError('Building or detached pixels exceed safety margin; inspect source.')
        dx, dy = (cell - crop.shape[1]) // 2, (cell - crop.shape[0]) // 2
        result.paste(Image.fromarray(crop), ((identity - 1) % 3 * cell + dx, (identity - 1) // 3 * cell + dy))
        preserved += int((crop[:, :, 3] > 8).sum())
        records.append({'cell': identity - 1, 'sourceBounds': [int(x0), int(y0), int(x1), int(y1)], 'offset': [dx, dy], 'pixels': int(mask.sum())})
    assert preserved == int(meaningful.sum()), 'A meaningful source pixel was lost or duplicated'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path, optimize=True)
    output_path.with_suffix('.json').write_text(json.dumps({'source': source_path.name, 'cell': cell, 'operation': 'Original RGBA pixels registered by disconnected alpha components; no resampling', 'meaningfulPixelsPreserved': preserved, 'cells': records}, indent=2) + '\n')
    print(json.dumps({'source': source_path.name, 'output': str(output_path), 'objects': len(objects), 'preservedPixels': preserved}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output)
