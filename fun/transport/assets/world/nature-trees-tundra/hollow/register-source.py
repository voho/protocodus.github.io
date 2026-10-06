#!/usr/bin/env python3
"""Register complete imagegen cutouts to the recorded physical scale.

Run this file directly, then execute generation.json's buildCommand from the
repository root. No botanical artwork is drawn or altered here: only whole
cutout cropping, premultiplied-alpha uniform resampling and root translation.
Pixel factors are immutable artwork registration; current metre fields describe
the 1:1 world envelope, with the historical 1.5x assumption recorded separately.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
from PIL import Image

base = Path(__file__).resolve().parent
transport = next(path for path in base.parents if (path / 'tools/build-house-atlases.py').exists())
spec = importlib.util.spec_from_file_location('house_pipeline', transport / 'tools/build-house-atlases.py')
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)
job = json.loads((base / 'generation.json').read_text())
source_path = base / job['source']
assert hashlib.sha256(source_path.read_bytes()).hexdigest() == job['sourceSha256']
source = Image.open(source_path).convert('RGBA')
out = Image.new('RGBA', (256 * job['columns'], 256 * job['rows']))
measurements = []
for index, record in enumerate(job['records']):
    source_box = tuple(record['sourceBox'])
    source_cell = source.crop(source_box)
    house.validate_source(source_cell, record['logicalId'])
    trim = house.trim_bounds(source_cell)
    clean = source_cell.crop(trim)
    scale = record['uniformWholeCutoutScale']
    width, height = round(clean.width * scale), round(clean.height * scale)
    calibrated = house.resize_alpha(clean, (width, height))
    # Rounding the raster size changes the declared uniform scale by <1 source
    # pixel. The horizontal root and vertical foot still register to the fixed
    # centre and 95.5% baseline of the complete 256px native envelope.
    root_x = record['rootFoot'][0] - source_box[0] - trim[0]
    root_y = record['rootFoot'][1] - source_box[1] - trim[1]
    position = (round(128 - root_x * width / clean.width),
                round(256 * job['rootAnchor'] - root_y * height / clean.height))
    cell = Image.new('RGBA', (256, 256))
    cell.paste(calibrated, position)
    assert position[0] >= 0 and position[1] >= 0
    assert position[0] + width <= 256 and position[1] + height <= 256
    assert house.alpha_bbox(cell) is not None
    opaque = house.alpha_bbox(cell, 32)
    assert opaque[0] >= 30 and opaque[2] <= 226, (record['id'], opaque)
    assert opaque[1] >= 25 and opaque[3] <= 253, (record['id'], opaque)
    out.paste(cell, (index % job['columns'] * 256, index // job['columns'] * 256))
    measurements.append({'id':record['logicalId'], 'sourceBox':list(source_box),
                         'retainedSourceBounds':list(trim),
                         'uniformWholeCutoutScale':scale,
                         'resampledSize':[width,height],
                         'registeredOffset':list(position),
                         'registeredRootFoot':[position[0] + root_x * width / clean.width,
                                               position[1] + root_y * height / clean.height],
                         'opaqueBounds':list(opaque),
                         'heightMetres':record['heightMetres'],
                         'registeredMeasuredHeightMetres':record['registeredPlantHeightPixels'] / job['pixelsPerMetre']})
registered = base / 'source-registered-2026-10-06.png'
house.save_png(out, registered)
report = {'sourceSha256':job['sourceSha256'], 'registeredSource':registered.name,
          'registeredSourceSha256':hashlib.sha256(registered.read_bytes()).hexdigest(),
          'artworkMutation':'No painting, redraw, object removal or independent axis stretching; complete source cutouts calibrated and translated.',
          'pixelsPerMetre':job['pixelsPerMetre'],
          'projectionCorrection':job['projectionCorrection'],
          'records':measurements}
(base / 'registration.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'registered':str(registered),'count':len(measurements)}))
