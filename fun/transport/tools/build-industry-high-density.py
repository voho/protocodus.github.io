#!/usr/bin/env python3
"""Add 512px industry cells directly from physically registered source artwork.

Run without arguments to export all industry families, or pass family folders
relative to assets/world. --verify checks the exports without writing. Existing
16–256px atlases and their 256px master registration stay unchanged.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'assets' / 'world'
FAMILIES = (
    'industries-taiga', 'industries-taiga-extra',
    'industries-tundra', 'industries-tundra-extra',
    'industries-desert', 'industries-desert-extra',
    'food-industry-v1/taiga', 'food-industry-v1/desert',
)
spec = importlib.util.spec_from_file_location('house_pipeline', Path(__file__).with_name('build-house-atlases.py'))
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(folder, verify=False):
    metadata_path = folder / 'atlas.json'
    metadata = json.loads(metadata_path.read_text())
    if metadata.get('visualFootprint') != 5 or not metadata.get('registration', '').startswith('Full parcel grid preserved;'):
        raise ValueError(f'{folder}: expected a uniformly registered five-tile industry atlas')
    source_path = folder / metadata['source']
    if digest(source_path) != metadata['sourceSha256']:
        raise ValueError(f'{source_path}: source does not match published registration')
    source = Image.open(source_path).convert('RGBA')
    columns, rows = metadata['columns'], metadata['rows']
    original_files = [folder / 'atlas.png', *(folder / f'atlas-{cell}.png' for cell in (16, 32, 64, 128, 256))]
    original_hashes = {path: digest(path) for path in original_files}
    published = Image.open(folder / 'atlas-256.png').convert('RGBA')
    atlas = Image.new('RGBA', (columns * 512, rows * 512))
    source_sizes = set()
    for index, record in enumerate(metadata['sprites']):
        if not record.get('id'):
            continue
        if record['cell'] != index or metadata['order'][index] != record['id']:
            raise ValueError(f'{folder}: sprite order no longer matches the registered grid')
        cell = source.crop(record['sourceBounds'])
        if cell.width != cell.height or cell.width < 512:
            raise ValueError(f'{folder}: a 512px density must not enlarge a smaller source cell')
        source_sizes.add(cell.width)
        bounds = house.trim_bounds(cell)
        if bounds != tuple(record['normalization']['sourceBounds']):
            raise ValueError(f'{folder}: source alpha registration no longer matches the published master')
        clean = Image.new('RGBA', cell.size)
        clean.paste(cell.crop(bounds), bounds[:2])
        # The same full-cell mapping must reconstruct the existing 256px art
        # pixel for pixel before it can serve as the source of a denser export.
        x, y = index % columns * 256, index // columns * 256
        if house.resize_alpha(clean, (256, 256)).tobytes() != published.crop((x, y, x + 256, y + 256)).tobytes():
            raise ValueError(f'{folder}: 256px registration mismatch in cell {index}')
        atlas.paste(house.resize_alpha(clean, (512, 512)), (index % columns * 512, index // columns * 512))
    output = folder / 'atlas-512.png'
    density_record = {
        'source': metadata['source'],
        'sourceSha256': metadata['sourceSha256'],
        'registeredSourceCellPixels': sorted(source_sizes),
        'operation': 'Direct premultiplied-alpha Lanczos from full registered source cells; identical physical grid; no sharpening or upscaling',
        'tool': 'build-industry-high-density.py',
    }
    if verify:
        if Image.open(output).convert('RGBA').tobytes() != atlas.tobytes():
            raise ValueError(f'{output}: export differs from its registered source')
        if metadata.get('highDensityCells', {}).get('512') != density_record or 512 not in metadata['cellSizes']:
            raise ValueError(f'{metadata_path}: missing high-density provenance')
    else:
        house.save_png(atlas, output)
        metadata['cellSizes'] = sorted(set(metadata['cellSizes']) | {512})
        metadata.setdefault('highDensityCells', {})['512'] = density_record
        metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    if any(digest(path) != checksum for path, checksum in original_hashes.items()):
        raise ValueError(f'{folder}: an existing atlas changed during the export')
    return {'family': str(folder.relative_to(ROOT)), 'sourceCellPixels': sorted(source_sizes), 'cell': 512, 'sprites': sum(bool(record.get('id')) for record in metadata['sprites']), 'bytes': output.stat().st_size, 'verified': verify}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('families', nargs='*', default=FAMILIES)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    for family in args.families:
        print(json.dumps(build(ROOT / family, args.verify)))
