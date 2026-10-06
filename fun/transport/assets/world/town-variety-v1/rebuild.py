#!/usr/bin/env python3
"""Pack the generated town varieties; retain alpha and prefilter isolated cells."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / 'tools'
SHOPS = ['shop-grocery', 'shop-bakery', 'shop-butcher', 'shop-hardware', 'shop-florist']
LANDMARKS = ['park-village', 'park-formal', 'park-woodland', 'mall-neighborhood', 'mall-shopping', 'mall-modern']
FAMILIES = {
    'civic-retail': [(k, 0) for k in LANDMARKS] + [(k, 1) for k in SHOPS[:3]],
    'shop-alternates': [(k, 1) for k in SHOPS[3:]] + [(k, 2) for k in SHOPS] + [None, None],
}

def rebuild():
    records = []
    for family, identities in FAMILIES.items():
        for biome in ['taiga', 'tundra', 'desert']:
            target = HERE / family / biome
            source = target / 'source-generated.png'
            packed_source = source
            if family == 'civic-retail':
                # Climate edits can widen faint detached edge details. Register
                # their original RGBA pixels without splitting any cutout.
                packed_source = target / 'source-registered.png'
                subprocess.run([sys.executable, str(TOOLS/'prepare-building-atlas.py'), str(source), str(packed_source)], check=True)
            ids = [f'civic:{k}:{biome}' + (f':design-{d}' if d else '') if item else '-' for item in identities for k, d in [item or ('', 0)]]
            # The generated gutter repair makes each whole cutout fit its grid.
            # Reject meaningful pixels at cell boundaries before any resampling.
            im = Image.open(packed_source).convert('RGBA')
            for index, item in enumerate(identities):
                col, row = index % 3, index // 3
                cell = im.crop((round(col*im.width/3), round(row*im.height/3), round((col+1)*im.width/3), round((row+1)*im.height/3)))
                alpha = cell.getchannel('A')
                if item:
                    bounds = alpha.point(lambda n: 255 if n > 8 else 0).getbbox()
                    assert bounds and min(bounds[0], bounds[1], cell.width-bounds[2], cell.height-bounds[3]) >= 8, f'Unsafe source gutter: {family}/{biome}/{index}'
                else:
                    assert alpha.getextrema()[1] <= 8, f'Occupied empty cell: {family}/{biome}/{index}'
            subprocess.run([sys.executable, str(TOOLS/'build-world-atlases.py'), '--atlas', str(packed_source), '--columns', '3', '--rows', '3', '--ids', ','.join(ids), '--output-dir', str(target), '--anchor', 'bottom', '--width', '232', '--height', '232', '--max-cell', '256'], check=True)
            records.append({'family': family, 'biome': biome, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'packedSourceSha256': hashlib.sha256(packed_source.read_bytes()).hexdigest(), 'sourceSize': list(Image.open(source).size), 'objects': sum(bool(i) for i in identities)})
    (HERE/'packing.json').write_text(json.dumps({'operation':'Isolated alpha-preserving atlas normalization; premultiplied-alpha LOD resampling; no generated art painted or recolored', 'sheets':records}, indent=2)+'\n')

if __name__ == '__main__':
    rebuild()
