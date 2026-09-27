#!/usr/bin/env python3
"""Rebuild only the three corrected identities; retain all other LOD pixels."""
import hashlib
import importlib.util
import json
import shutil
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
TRANSPORT = HERE.parents[2]
spec = importlib.util.spec_from_file_location('house_pipeline', TRANSPORT / 'tools/build-house-atlases.py')
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)
IDS = ('shop-hardware', 'service-bank', 'service-garage')
for biome in ('taiga', 'tundra', 'desert'):
    previous = HERE.parent / 'buildings-commerce' / biome
    target = HERE / biome
    metadata = json.loads((previous / 'atlas.json').read_text())
    cells = {}
    for identity in IDS:
        path = target / 'generated' / f'{identity}.png'
        source = Image.open(path).convert('RGBA')
        validation = house.validate_source(source, identity)
        bounds = house.trim_bounds(source)
        trimmed = source.crop(bounds)
        scale = min(232 / trimmed.width, 232 / trimmed.height)
        width, height = round(trimmed.width * scale), round(trimmed.height * scale)
        cell = Image.new('RGBA', (256, 256))
        cell.paste(house.resize_alpha(trimmed, (width, height)), ((256 - width) // 2, 244 - height))
        cells[identity] = cell
        house.save_png(cell, target / 'sources' / f'{identity}.png')
        index = metadata['order'].index(identity)
        metadata['sprites'][index] = {
            'id': identity, 'cell': index, 'source': f'generated/{identity}.png',
            'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'sourceBounds': list(bounds), 'normalization': validation,
            'bounds': list(house.alpha_bbox(cell)),
        }
    for identity in metadata['order']:
        if identity and identity not in cells:
            shutil.copy2(previous / 'sources' / f'{identity}.png', target / 'sources' / f'{identity}.png')
    for size in (16, 32, 64, 128, 256):
        name = 'atlas.png' if size == 256 else f'atlas-{size}.png'
        atlas = Image.open(previous / name).convert('RGBA')
        for identity, cell in cells.items():
            index = metadata['order'].index(identity)
            sprite = cell if size == 256 else house.sharpen_interior(house.resize_alpha(cell, (size, size)), size)
            atlas.paste(sprite, (index % 3 * size, index // 3 * size))
        house.save_png(atlas, target / name)
        if size == 256:
            house.save_png(atlas, target / 'atlas-256.png')
    metadata['source'] = 'Individual generated camera corrections; unchanged cells from ../buildings-commerce/' + biome
    metadata.pop('sourceSha256', None)
    metadata['selectiveReplacement'] = {
        'indices': [1, 4, 6], 'ids': list(IDS),
        'unchangedCells': 'Original pixels copied at each existing LOD; no regeneration or resampling',
        'previousFamily': 'buildings-commerce',
    }
    (target / 'atlas.json').write_text(json.dumps(metadata, indent=2) + '\n')
