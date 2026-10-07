#!/usr/bin/env python3
"""Pack farm art at one measured doorway scale and actual ground datum per biome.

The registration manifest records source landmarks. Alpha bounds only delimit
RGBA copying: they never choose the physical scale or the ground registration.
512px density comes directly from calibrated source pixels without upscaling.
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

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
spec = importlib.util.spec_from_file_location('house_pipeline', TOOLS / 'build-house-atlases.py')
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(biome):
    dest = ROOT / 'assets/world/farm-cores-v1' / biome
    manifest = json.loads((dest / 'registration-camera-v4.json').read_text())
    source_path = dest / manifest['source']
    raw = Image.open(source_path).convert('RGBA')
    cols, rows = manifest['columns'], manifest['rows']
    reference_door = manifest['referenceDoorSourcePixels']
    source_ppm = reference_door / 2.1
    scale_master = 11.2 / reference_door
    scale_registered = scale_master * 2
    if scale_registered > 1:
        raise ValueError('A 512px export cannot enlarge source artwork')
    registered = Image.new('RGBA', (cols * 512, rows * 512))
    records, ids = [], []
    for index, entry in enumerate(manifest['entries']):
        if entry is None:
            records.append({'cell': index, 'empty': True})
            ids.append('-')
            continue
        box = entry['sourceBounds']
        original_cell = raw.crop(box)
        if original_cell.getchannel('A').getextrema()[1] < 32:
            raise ValueError(f"{entry['id']}: missing source artwork")
        # Raw barnyard grass can reach a generator grid boundary; the complete
        # cell is copied. Validate filtering gutters after physical registration.
        copy_box = house.trim_bounds(original_cell)
        crop = original_cell.crop(copy_box)
        corners = np.array(entry['oppositeGroundCornersSource'], dtype=float)
        structural_center = corners.mean(axis=0)
        east, north = entry['measuredStructureCenterMetres']
        center = structural_center - np.array([(east - north) * source_ppm, (east + north) * source_ppm / 2])
        local_center = center - np.array(box[:2]) - np.array(copy_box[:2])
        size = [round(value * scale_registered) for value in crop.size]
        offset = [round(256 - local_center[0] * scale_registered), round(384 - local_center[1] * scale_registered)]
        if offset[0] < 2 or offset[1] < 2 or offset[0] + size[0] > 510 or offset[1] + size[1] > 510:
            raise ValueError(f"{entry['id']}: calibrated complete art exceeds 512px gutters")
        cell = Image.new('RGBA', (512, 512))
        cell.paste(house.resize_alpha(crop, tuple(size)), tuple(offset))
        registered.paste(cell, (index % cols * 512, index // cols * 512))
        lines = entry['cameraLinesSource']
        slopes = [(line[1][1] - line[0][1]) / (line[1][0] - line[0][0]) for line in lines]
        master = house.resize_alpha(cell, (256, 256))
        measured_door = entry['sourceDoorMeasurement']
        records.append({
            'cell': index, 'id': entry['id'], 'footprint': 2,
            'sourceBounds': box, 'copyBoundsWithinSourceCell': list(copy_box),
            'groundVerticesSource': entry['groundVerticesSource'],
            'groundVertexVisibility': entry['groundVertexVisibility'],
            'groundVertexMeasured': entry['groundVertexMeasured'],
            'oppositeGroundCornersSource': entry['oppositeGroundCornersSource'],
            'measuredStructureCenterMetres': entry['measuredStructureCenterMetres'],
            'groundCenterSource': center.tolist(), 'groundCenterMaster': [128, 192],
            'groundCenterAfterPackingMaster': ((local_center * scale_registered + np.asarray(offset)) / 2).round(6).tolist(),
            'groundCenterMethod': 'Measured opposite planar barn-floor corners, then inverse projection of the known physical barn centre from the canonical construction guide; never alpha/shadow extent',
            'cameraLinesSource': lines,
            'measuredGroundEdgeSlopes': [round(value, 6) for value in slopes],
            'uniformScale': scale_master, 'uniformScaleToRegistered512': scale_registered,
            'translationRegistered512': offset,
            'sourceDoorMeasurement': measured_door,
            'masterDoorHeightPixels': round(measured_door['heightPixels'] * scale_master, 4),
            'normalizedBounds': list(house.alpha_bbox(master)),
        })
        ids.append(entry['id'])
    registered_path = dest / 'source-camera-v4-registered.png'
    house.save_png(registered, registered_path)
    subprocess.run([
        sys.executable, str(TOOLS / 'build-world-atlases.py'),
        '--atlas', str(registered_path), '--columns', str(cols), '--rows', str(rows),
        '--ids', ','.join(ids), '--output-dir', str(dest), '--aligned',
        '--preserve-grid-scale', '--no-sharpen', '--max-cell', '256',
    ], check=True)
    meta_path = dest / 'atlas.json'
    metadata = json.loads(meta_path.read_text())
    physical = {
        'contract': '../../../../sprite-art-direction.js', 'visualFootprint': 2,
        'tileMetres': 16, 'coreMetres': 32, 'architecturalEnvelopeMetres': 20,
        'architecturalGroundEnvelopeMasterPixels': [213.333333, 106.666667],
        'doorHeightMetres': 2.1, 'targetDoorMasterPixels': 11.2,
        'referenceDoorSourcePixels': reference_door,
        'referenceDoorMethod': 'Joint arithmetic mean of ten measured personnel-opening frame head-to-sill heights across both generated climate families; one common pixel-to-metre scale',
        'groundCenterMaster': [128, 192], 'expectedGroundEdgeSlope': .5,
        'uniformScale': scale_master, 'cells': records,
    }
    metadata['visualFootprint'] = 2
    metadata['physicalCalibration'] = physical
    metadata['cellSizes'].append(512)
    metadata['highDensityCells'] = {'512': {
        'source': registered_path.name, 'sourceSha256': digest(registered_path),
        'registeredSourceCellPixels': [512],
        'operation': 'Direct complete physically registered 512px cell; original source uniformly downsampled once from measured physical scale; no thumbnail enlargement, independent silhouette fitting or sharpening',
        'tool': 'repack-farm-cores-registered.py',
    }}
    house.save_png(registered, dest / 'atlas-512.png')
    meta_path.write_text(json.dumps(metadata, indent=2) + '\n')
    packing = {
        'source': source_path.name, 'sourceSha256': digest(source_path),
        'registered': registered_path.name, 'registeredSha256': digest(registered_path),
        'operation': 'Complete RGBA cutouts, one measured personnel-door scale for the whole biome family, uniform downsampling, actual planar-ground-centre translation, aligned full-cell density packing; no camera shear, painting, recoloring or sharpening',
        'physicalCalibration': physical,
    }
    (dest / 'packing-v4.json').write_text(json.dumps(packing, indent=2) + '\n')
    print(json.dumps({'biome': biome, 'uniformScale': scale_master, 'doorMasterPixels': [r.get('masterDoorHeightPixels') for r in records if not r.get('empty')]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--biome', action='append', choices=['taiga', 'desert'])
    args = parser.parse_args()
    for biome in args.biome or ['taiga', 'desert']:
        build(biome)
