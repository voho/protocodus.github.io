"""Meteora — rebuild every model, js/anchors.js and the previews.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
    --python fun/meteora/tools/blender/build_all.py

Runs build_asteroids, then build_ships, then render_previews. Each step is
deterministic, so re-running reproduces the files. The previews render in
Eevee, which needs a GPU context (Metal on macOS).
"""
import importlib, os, sys, time

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

start = time.time()
for module in ('build_asteroids', 'build_ships', 'render_previews'):
    t = time.time()
    importlib.import_module(module).main()
    C.log(f'{module} done in {time.time() - t:.0f} s')
C.log(f'build_all done in {time.time() - start:.0f} s')
