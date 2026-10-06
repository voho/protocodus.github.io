#!/usr/bin/env python3
"""Register city artwork by measured doorway scale, never by silhouette size.

Generated art stays untouched. Each complete source cell receives the same
uniform physical calibration as every other cell in its footprint tier, then
the shared atlas packer preserves that complete calibrated parcel grid.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from PIL import Image

TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('house_pipeline', TOOLS / 'build-house-atlases.py')
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)

def rebuild(folder, biomes=None):
    folder = Path(folder)
    manifest = json.loads((folder / 'scale-2026-10-06.json').read_text())
    records = []
    for biome in biomes or ('taiga', 'tundra', 'desert'):
        target = folder / biome
        source = target / 'source-style-2026-10-06.png'
        original = Image.open(source).convert('RGBA')
        registered_source = target / 'source-registered-2026-10-06.png'
        subprocess.run([sys.executable, str(TOOLS / 'prepare-building-atlas.py'), str(source), str(registered_source), '--expected-objects', str(sum(bool(e) for e in manifest['entries'])), '--core-alpha', '16'], check=True)
        image = Image.open(registered_source).convert('RGBA')
        calibrated = Image.new('RGBA', (768, 768))
        entries = manifest['entries']
        slots = []
        ids = []
        for index, entry in enumerate(entries):
            if entry is None:
                ids.append('-')
                slots.append({'cell': index, 'empty': True})
                continue
            footprint = entry['footprint']
            tier = manifest['tiers'][str(footprint)]
            factor = tier['targetDoorMasterPixels'] / tier['referenceDoorMasterPixels']
            col, row = index % 3, index // 3
            box = (round(col * image.width / 3), round(row * image.height / 3), round((col + 1) * image.width / 3), round((row + 1) * image.height / 3))
            # Original pixels were only moved into safe cells. Alpha bounds
            # locate the complete contact cutout; they NEVER determine scale.
            cell = image.crop(box)
            bounds = house.trim_bounds(cell)
            cutout = cell.crop(bounds)
            pixel_scale = 256 / (original.width / 3) * factor
            width, height = round(cutout.width * pixel_scale), round(cutout.height * pixel_scale)
            registered = house.resize_alpha(cutout, (width, height))
            x, y = round(128 - width / 2), 244 - height
            complete = Image.new('RGBA', (256, 256))
            complete.paste(registered, (x, y))
            calibrated.paste(complete, (col * 256, row * 256))
            key = entry['id'].replace('{biome}', biome)
            ids.append(key)
            slots.append({'cell': index, 'id': key, 'footprint': footprint, 'uniformTierFactor': factor, 'sourceCell': list(box), 'originalPixelScale': pixel_scale, 'contactAnchor': [128, 244]})
        packed = target / 'source-calibrated-2026-10-06.png'
        house.save_png(calibrated, packed)
        subprocess.run([sys.executable, str(TOOLS / 'build-world-atlases.py'), '--atlas', str(packed), '--columns', '3', '--rows', '3', '--ids', ','.join(ids), '--output-dir', str(target), '--aligned', '--preserve-grid-scale', '--no-sharpen', '--max-cell', '256'], check=True)
        meta_path = target / 'atlas.json'
        metadata = json.loads(meta_path.read_text())
        metadata['physicalCalibration'] = {'contract': os.path.relpath(TOOLS.parent / 'sprite-art-direction.js', target), 'doorHeightMetres': 2.1, 'tiers': manifest['tiers'], 'cells': slots}
        meta_path.write_text(json.dumps(metadata, indent=2) + '\n')
        records.append({'biome': biome, 'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'calibratedSha256': hashlib.sha256(packed.read_bytes()).hexdigest(), 'cells': slots})
    (folder / 'packing-2026-10-06.json').write_text(json.dumps({'operation': 'Measured human-door scale; uniform complete-cell calibration within footprint tiers, fixed contact anchor, no silhouette fitting, premultiplied-alpha mipmaps without sharpening', 'sheets': records}, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--biome', action='append')
    args = parser.parse_args()
    rebuild(args.folder, args.biome)
