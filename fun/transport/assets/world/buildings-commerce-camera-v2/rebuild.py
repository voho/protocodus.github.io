#!/usr/bin/env python3
"""Register and pack all nine regenerated commerce/workshop identities.

Registration preserves source RGBA pixels through disconnected alpha cutouts.
The shared world packer builds transparent masters and prefiltered runtime LODs.
No generated artwork is repainted or recolored by this script.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / 'tools'
IDS = (
    'shop-butcher', 'shop-hardware', 'shop-florist',
    'service-post-office', 'service-bank', 'service-hotel',
    'service-garage', 'service-barber',
)


def rebuild():
    for biome in ('taiga', 'tundra', 'desert'):
        target = HERE / biome
        generated = target / 'source-generated-2026-10-05.png'
        registered = target / 'source-registered-2026-10-05.png'
        subprocess.run([
            sys.executable, str(TOOLS / 'prepare-building-atlas.py'),
            str(generated), str(registered),
        ], check=True)
        subprocess.run([
            sys.executable, str(TOOLS / 'build-world-atlases.py'),
            '--atlas', str(registered), '--columns', '3', '--rows', '3',
            '--ids', ','.join((*IDS, f'civic:factory:{biome}')),
            '--output-dir', str(target), '--anchor', 'bottom',
            '--width', '232', '--height', '232', '--max-cell', '256',
        ], check=True)


if __name__ == '__main__':
    rebuild()
