#!/usr/bin/env python3
"""Rebuild current town varieties from measured human-scale source tiers."""
import subprocess
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / 'tools'
for family in ('civic-retail', 'shop-alternates'):
    subprocess.run([sys.executable, str(TOOLS / 'calibrate-city-atlases.py'), str(HERE / family)], check=True)
