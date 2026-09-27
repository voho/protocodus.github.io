#!/usr/bin/env python3
"""Install selected normalized house variants without changing other cells.

Run build-house-atlases.py into a staging directory first. This operation copies
selected source masters and their metadata, then regenerates their mip cells.
Every unselected source file and atlas pixel is verified unchanged.
"""
import argparse
import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location('house_atlases', Path(__file__).with_name('build-house-atlases.py'))
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)


def replace(base, replacement, selected):
    current = json.loads((base / 'atlas.json').read_text())
    updated = json.loads((replacement / 'atlas.json').read_text())
    if current['order'] != updated['order'] or not selected or not selected.issubset(current['order']):
        raise ValueError('Atlas orders must match and selected house IDs must exist')
    report = {'selectedIds': sorted(selected), 'unchangedSourceSha256': {}, 'changedSourceSha256': {}, 'preservedCells': {}}
    for kind in current['order']:
        path = base / 'sources' / f'{kind}.png'
        if kind in selected:
            source = replacement / 'sources' / f'{kind}.png'
            if Image.open(source).size != (256, 256):
                raise ValueError('Replacement source must already be a normalized 256px master')
            shutil.copy2(source, path)
            report['changedSourceSha256'][kind] = hashlib.sha256(path.read_bytes()).hexdigest()
            index = current['order'].index(kind)
            current['houses'][index] = updated['houses'][index]
        else:
            report['unchangedSourceSha256'][kind] = hashlib.sha256(path.read_bytes()).hexdigest()
    for size in house.CELL_SIZES:
        path = base / house.atlas_name(size)
        atlas = Image.open(path).convert('RGBA')
        before = atlas.copy()
        replacement_atlas = Image.open(replacement / house.atlas_name(size)).convert('RGBA')
        preserved = 0
        for index, kind in enumerate(current['order']):
            box = (index % 3 * size, index // 3 * size, (index % 3 + 1) * size, (index // 3 + 1) * size)
            if kind in selected:
                atlas.paste(replacement_atlas.crop(box), box[:2])
            else:
                assert atlas.crop(box).tobytes() == before.crop(box).tobytes()
                preserved += 1
        house.save_png(atlas, path)
        report['preservedCells'][str(size)] = preserved
    for kind, digest in report['unchangedSourceSha256'].items():
        assert hashlib.sha256((base / 'sources' / f'{kind}.png').read_bytes()).hexdigest() == digest
    (base / 'atlas.json').write_text(json.dumps(current, indent=2) + '\n')
    (base / 'garden-packing.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(base), 'replaced': len(selected), 'preserved': len(current['order']) - len(selected), 'densities': list(house.CELL_SIZES)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--replacement', type=Path, required=True)
    parser.add_argument('--ids', required=True)
    args = parser.parse_args()
    replace(args.base, args.replacement, set(args.ids.split(',')))
