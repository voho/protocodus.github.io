#!/usr/bin/env python3
"""Register image-generated town features by shared measured physical scale.

Original RGBA cutouts are preserved; only alpha-preserving uniform resampling
and transparent registration are performed. One doorway factor per footprint
tier is applied to every full cutout, never a fit to its silhouette bounds.
"""
import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, find_objects, label

TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('house_pipeline', TOOLS / 'build-house-atlases.py')
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)


def pack(folder, biome):
    folder = Path(folder)
    manifest = json.loads((folder / 'scale-2026-10-06.json').read_text())
    dest = folder / biome
    source_path = dest / 'source-generated-2026-10-06.png'
    image = Image.open(source_path).convert('RGBA')
    rgba = np.asarray(image)
    height, width = rgba.shape[:2]
    cols, rows = manifest['columns'], manifest['rows']
    meaningful = rgba[:, :, 3] > 8
    components, count = label(meaningful, np.ones((3, 3)))
    counts = np.bincount(components.ravel())
    slices = find_objects(components)
    large = [i for i in range(1, count + 1) if counts[i] > width * height * .001]
    entries = manifest['entries']
    if len(large) != sum(bool(entry) for entry in entries):
        raise ValueError('Expected eleven separate complete sprites; inspect or regenerate')
    owner = np.zeros(components.shape, np.int16)
    assigned = set()
    for component in large:
        yy, xx = slices[component - 1]
        col = min(cols - 1, int((xx.start + xx.stop) / 2 / width * cols))
        row = min(rows - 1, int((yy.start + yy.stop) / 2 / height * rows))
        identity = row * cols + col + 1
        if identity in assigned or not entries[identity - 1]:
            raise ValueError('Two sprites occupy one slot or artwork occupies empty slot')
        assigned.add(identity)
        owner[components == component] = identity
    # Assign detached antialias pixels without reconstructing alpha or colour.
    _, nearest = distance_transform_edt(owner == 0, return_indices=True)
    owner = owner[nearest[0], nearest[1]]
    calibrated = Image.new('RGBA', (cols * 256, rows * 256))
    preserved, records, ids = 0, [], []
    for index, entry in enumerate(entries):
        if not entry:
            records.append({'cell': index, 'empty': True})
            ids.append('-')
            continue
        mask = meaningful & (owner == index + 1)
        ys, xs = np.nonzero(mask)
        x0, y0 = max(0, xs.min() - 3), max(0, ys.min() - 3)
        x1, y1 = min(width, xs.max() + 4), min(height, ys.max() + 4)
        crop = rgba[y0:y1, x0:x1].copy()
        crop[owner[y0:y1, x0:x1] != index + 1] = 0
        preserved += int((crop[:, :, 3] > 8).sum())
        tier = manifest['tiers'][str(entry['footprint'])]
        # Climate sheets are edits of the accepted base and must retain geometry.
        # The source width adjustment handles API resolutions uniformly.
        pixel_scale = tier['targetDoorMasterPixels'] / tier['referenceDoorSourcePixels'] * manifest['referenceSourceWidth'] / width
        w, h = round(crop.shape[1] * pixel_scale), round(crop.shape[0] * pixel_scale)
        if w > 240 or h > 232:
            raise ValueError('Calibrated full parcel exceeds filtering margin; inspect physical scale')
        registered = house.resize_alpha(Image.fromarray(crop), (w, h))
        dx, dy = round(128 - w / 2), 244 - h
        complete = Image.new('RGBA', (256, 256))
        complete.paste(registered, (dx, dy))
        calibrated.paste(complete, (index % cols * 256, index // cols * 256))
        key = f"civic:{entry['id']}:{biome}"
        ids.append(key)
        records.append({'cell': index, 'id': key, 'footprint': entry['footprint'], 'sourceBounds': [int(x0), int(y0), int(x1), int(y1)], 'originalPixelScale': pixel_scale, 'contactAnchor': [128, 244], 'preservedSourcePixels': int(mask.sum())})
    assert preserved == int(meaningful.sum()), 'Meaningful source pixel lost or duplicated'
    packed_path = dest / 'source-calibrated-2026-10-06.png'
    house.save_png(calibrated, packed_path)
    subprocess.run([sys.executable, str(TOOLS / 'build-world-atlases.py'), '--atlas', str(packed_path), '--columns', str(cols), '--rows', str(rows), '--ids', ','.join(ids), '--output-dir', str(dest), '--aligned', '--preserve-grid-scale', '--no-sharpen', '--max-cell', '256'], check=True)
    meta_path = dest / 'atlas.json'
    meta = json.loads(meta_path.read_text())
    meta['physicalCalibration'] = {'contract': '../../../../sprite-art-direction.js', 'doorHeightMetres': 2.1, 'tiers': manifest['tiers'], 'cells': records}
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    (dest / 'packing-2026-10-06.json').write_text(json.dumps({'source': source_path.name, 'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'operation': 'Original RGBA complete cutouts; one measured doorway scale per footprint tier, fixed ground-contact anchor, alpha-preserving mip filtering without sharpening', 'meaningfulPixelsPreserved': preserved, 'cells': records}, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--biome', action='append')
    args = parser.parse_args()
    for climate in args.biome or ('taiga', 'tundra', 'desert'):
        pack(args.folder, climate)
