"""A fixed-camera turnaround keeps its source foreshortening during packing."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('atlas_builder', Path(__file__).parents[1] / 'tools' / 'build-world-atlases.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

with tempfile.TemporaryDirectory(prefix='transport-vehicle-packing-') as temporary:
    root = Path(temporary)
    source = Image.new('RGBA', (768, 768))
    draw = ImageDraw.Draw(source)
    # The same 200-unit vehicle points horizontally, then into depth. Its
    # projected ground length becomes 100; width remains 60 in this fixture.
    draw.rectangle((28, 98, 227, 157), fill='#496d78')
    draw.rectangle((354, 78, 413, 177), fill='#496d78')
    source.save(root / 'source.png')
    ids = 'vehicle:test:E,vehicle:test:N,-,-,-,-,-,-,-'
    for shared in (False, True):
        destination = root / ('shared' if shared else 'legacy')
        builder.build(argparse.Namespace(atlas=str(root / 'source.png'), columns=3, rows=3, ids=ids,
                      output_dir=str(destination), aligned=False, shared_scale=shared,
                      width=232, height=232, vehicle=True, anchor='center', max_cell=128, qa=None))
        metadata = json.loads((destination / 'atlas.json').read_text())
        east = Image.open(destination / 'sources' / 'vehicle_test_E.png').getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
        north = Image.open(destination / 'sources' / 'vehicle_test_N.png').getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
        ratio = (north[3] - north[1]) / (east[2] - east[0])
        assert abs(ratio - (.5 if shared else 1)) < .02, (shared, ratio)
        assert metadata['vehicleLengthNormalized'] is not shared
        assert ('sharedScale' in metadata) is shared
        atlas = Image.open(destination / 'atlas.png')
        assert atlas.crop((256, 256, 512, 512)).getbbox() is None
        for cell in (16, 32, 64, 128):
            assert Image.open(destination / f'atlas-{cell}.png').size == (cell * 3, cell * 3)

print('Vehicle atlas packing: shared-scale foreshortening and legacy behavior passed.')
