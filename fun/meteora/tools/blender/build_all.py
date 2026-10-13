"""Meteora — rebuild every model, the anchors modules and the previews.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
    --python fun/meteora/tools/blender/build_all.py

Runs build_asteroids and build_ships (the original rocks, Kestrel and
Thorn, and js/anchors.js), then the campaign groups — build_craft,
build_harrow, build_mother, build_perpetua, build_civil and build_fleet,
each writing its models and js/anchors/<model>.js — then build_hangar (the
bay behind the hangar screen), then render_previews for every model. Each step is deterministic, so re-running reproduces the
files. The whole run takes about half an hour on an idle Apple-silicon
Mac, most of it texture bakes. The previews render in Eevee, which needs a
GPU context (Metal on macOS); METEORA_PREVIEW_ENGINE=CYCLES renders them on
the CPU instead.
"""
import importlib, os, sys, time

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

start = time.time()
for module in ('build_asteroids', 'build_ships', 'build_craft', 'build_harrow', 'build_mother',
               'build_perpetua', 'build_civil', 'build_fleet', 'build_hangar', 'render_previews'):
    t = time.time()
    importlib.import_module(module).main()
    C.log(f'{module} done in {time.time() - t:.0f} s')
C.log(f'build_all done in {time.time() - start:.0f} s')
