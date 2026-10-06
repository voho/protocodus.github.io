#!/usr/bin/env python3
"""Rebuild current physically calibrated commerce and city workshop art."""
import subprocess
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / 'tools'
subprocess.run([sys.executable, str(TOOLS / 'calibrate-city-atlases.py'), str(HERE)], check=True)
