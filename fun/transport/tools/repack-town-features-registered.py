#!/usr/bin/env python3
"""Pack complete generated town cutouts at measured physical scale and datum.

The manifest supplies actual planar ground vertices and a shared doorway scale
for each footprint tier. Alpha bounds identify pixels only, never the physical
scale or ground centre. All resampling is uniform and alpha preserving.
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


def build(folder, biome):
    dest = folder / biome
    manifest = json.loads((dest / 'registration-2026-10-07.json').read_text())
    source_path = dest / manifest['source']
    raw = Image.open(source_path).convert('RGBA')
    cols, rows = manifest['columns'], manifest['rows']
    rgba = np.asarray(raw)
    components, count = label(rgba[:, :, 3] > manifest.get('sourceOwnershipAlphaThreshold', 32), np.ones((3, 3)))
    counts = np.bincount(components.ravel())
    slices = find_objects(components)
    owner = np.zeros(components.shape, np.int16)
    occupied = set()
    for component in range(1, count + 1):
        if counts[component] < 1000:
            continue
        yy, xx = slices[component - 1]
        col = min(cols - 1, int((xx.start + xx.stop) / 2 / raw.width * cols))
        row = min(rows - 1, int((yy.start + yy.stop) / 2 / raw.height * rows))
        index = row * cols + col
        if index in occupied or manifest['entries'][index] is None:
            raise ValueError('Expected one complete alpha component per occupied slot')
        occupied.add(index)
        owner[components == component] = index + 1
    if len(occupied) != 11:
        raise ValueError('Expected eleven complete alpha components')
    # Retain every original RGBA pixel, including detached antialiasing and the
    # weak alpha-matte bridges between a few raw sprites. Nearest solid ownership
    # separates those bridges without repainting, clipping or reconstructing art.
    _, nearest = distance_transform_edt(owner == 0, return_indices=True)
    owner = owner[nearest[0], nearest[1]]
    out = Image.new('RGBA', (cols * 256, rows * 256))
    records, ids = [], []
    for index, entry in enumerate(manifest['entries']):
        if entry is None:
            records.append({'cell': index, 'empty': True})
            ids.append('-')
            continue
        meaningful = (rgba[:, :, 3] > 8) & (owner == index + 1)
        ys, xs = np.nonzero(meaningful)
        bounds = [max(0, int(xs.min()) - 2), max(0, int(ys.min()) - 2),
                  min(raw.width, int(xs.max()) + 3), min(raw.height, int(ys.max()) + 3)]
        x0, y0, x1, y1 = bounds
        pixels = rgba[y0:y1, x0:x1].copy()
        pixels[owner[y0:y1, x0:x1] != index + 1] = 0
        crop = Image.fromarray(pixels)
        tier = manifest['tiers'][str(entry['footprint'])]
        scale = tier['targetDoorMasterPixels'] / tier['referenceDoorSourcePixels'] * tier.get('filteringGutterScale', 1)
        vertices = entry['groundVerticesSource']
        # Opposite right/left corners are actually visible. The hidden back
        # corner remains useful provenance, but must not bias registration.
        centre = np.mean(np.asarray([vertices[1], vertices[3]], dtype=float), axis=0)
        local_centre = centre - np.asarray(bounds[:2], dtype=float)
        w, h = [max(1, round(value * scale)) for value in crop.size]
        offset = [round(128 - local_centre[0] * scale), round(192 - local_centre[1] * scale)]
        if offset[0] < 8 or offset[1] < 8 or offset[0] + w > 248 or offset[1] + h > 248:
            raise ValueError(f"{biome}:{entry['id']} exceeds complete-cell filtering gutter: {(w,h,offset)}")
        cell = Image.new('RGBA', (256, 256))
        # PIL expands a mutable two-item box list in place. Use a tuple so the
        # recorded translation remains the physical [dx,dy] offset.
        cell.paste(house.resize_alpha(crop, (w, h)), tuple(offset))
        out.paste(cell, (index % cols * 256, index // cols * 256))
        identity = f"civic:{entry['id']}:{biome}"
        ids.append(identity)
        slopes = []
        for a, b in zip(vertices, vertices[1:] + vertices[:1]):
            slopes.append(round((b[1] - a[1]) / (b[0] - a[0]), 6))
        records.append({
            'cell': index, 'id': identity, 'footprint': entry['footprint'],
            'sourceBounds': bounds, 'groundVerticesSource': vertices,
            'groundVertexMeasured': entry.get('groundVertexMeasured', [False, True, True, True]),
            'groundVerticesMethod': entry.get('groundVerticesMethod'),
            'preservedSourcePixels': int(meaningful.sum()),
            'groundCenterSource': centre.tolist(), 'groundCenterMaster': [128, 192],
            'groundCenterMethod': 'Midpoint of observed opposite right/left ground-plane vertices (indices1,3); inferred back excluded; independent of alpha/shadow bounds',
            'measuredGroundEdgeSlopes': slopes, 'uniformScale': scale,
            'translationMaster': offset, 'normalizedBounds': list(house.alpha_bbox(cell)),
            'sourceDoorMeasurement': entry.get('sourceDoorMeasurement'),
            'masterDoorHeightPixels': (entry.get('sourceDoorMeasurement') or {}).get('heightPixels', 0) * scale or None,
        })
    registered = dest / 'source-registered-2026-10-07.png'
    assert sum(record.get('preservedSourcePixels', 0) for record in records) == int((rgba[:, :, 3] > 8).sum())
    house.save_png(out, registered)
    subprocess.run([
        sys.executable, str(TOOLS / 'build-world-atlases.py'),
        '--atlas', str(registered), '--columns', str(cols), '--rows', str(rows),
        '--ids', ','.join(ids), '--output-dir', str(dest), '--aligned',
        '--preserve-grid-scale', '--no-sharpen', '--max-cell', '256',
    ], check=True)
    physical = {
        'contract': '../../../../sprite-art-direction.js', 'doorHeightMetres': 2.1,
        'groundCenterMaster': [128, 192], 'expectedGroundEdgeSlope': .5,
        'paintedGroundSlopeTolerance': .11, 'groundEndpointUncertaintySourcePixels': 3,
        'minimumMasterFilteringGutterPixels': 8,
        'architecturalEnvelopeMetresPerTile': 10, 'tiers': manifest['tiers'],
        'cells': records,
    }
    metadata_path = dest / 'atlas.json'
    metadata = json.loads(metadata_path.read_text())
    metadata['physicalCalibration'] = physical
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    packing = {
        'source': source_path.name,
        'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'operation': 'Complete RGBA cutouts, shared measured personnel-door scale per footprint tier, uniform resampling, measured physical ground-centre translation, aligned full-cell packing; no sharpening',
        'physicalCalibration': physical,
    }
    (dest / 'packing-2026-10-07.json').write_text(json.dumps(packing, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--biome', action='append')
    args = parser.parse_args()
    for biome in args.biome or ('taiga', 'tundra', 'desert'):
        build(args.folder, biome)
