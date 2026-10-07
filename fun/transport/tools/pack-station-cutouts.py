#!/usr/bin/env python3
"""Register architectural transport cutouts against observed metre spans.

Usage: pack-station-cutouts.py source.png measurements.json output-directory
Every density group is calibrated by a visible physical ground edge. Different
source paintings can have different magnification; all outputs use the same
72 world-pixel frame and [128,192] master ground datum. Nothing fits alpha bounds.
"""
import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

LEVELS = [16, 32, 64, 128, 256, 512]
FRAME = 72
ANCHOR = [36, 54]


def pack(source, measurements, destination):
    data = json.loads(measurements.read_text())
    original = Image.open(source)
    if original.mode != 'RGBA':
        raise ValueError('Original source must have a genuine RGBA channel')
    if list(original.size) != data['sourceDimensions']:
        raise ValueError('Wrong source dimensions')
    groups = {}
    for group, observed in data['densityGroups'].items():
        a, b = observed['sourceEdgeEndpointsSheet']
        dx, dy = b[0]-a[0], b[1]-a[1]
        if not dx or abs(abs(dy/dx)-.5) > .11:
            raise ValueError('Calibration must be a visible canonical ground edge')
        if not 0 < observed['physicalSpanMetres'] <= 16 or not observed['note']:
            raise ValueError('Physical span and source observation note required')
        groups[group] = {'sourcePixelsPerWorldPixel': abs(dx)/(2*observed['physicalSpanMetres']),
                         'observation': observed}
    columns, rows = data['columns'], data['rows']
    atlases = {level: Image.new('RGBA', (columns*level, rows*level)) for level in LEVELS}
    records = []
    destination.mkdir(parents=True, exist_ok=True)
    ownership = Image.new('1', original.size)
    for i, entry in enumerate(data['entries']):
        density = groups[entry['densityGroup']]['sourcePixelsPerWorldPixel']
        x0, y0, x1, y1 = entry['sourceBoundsSheet']
        raw = original.crop((x0, y0, x1, y1))
        mask = raw.getchannel('A').point(lambda a: 255 if a > 2 else 0).convert('1')
        seen = ownership.crop((x0, y0, x1, y1))
        if any(a and b for a, b in zip(mask.getdata(), seen.getdata())):
            raise ValueError('Overlapping pixel ownership')
        ownership.paste(mask, (x0, y0))
        cx, cy = entry['groundCenterSheet']
        left, top = cx-ANCHOR[0]*density-x0, cy-ANCHOR[1]*density-y0
        extent = FRAME*density
        box = [left, top, left+extent, top+extent]
        alpha = mask.getbbox()
        gutter = min(alpha[0]-box[0], alpha[1]-box[1], box[2]-alpha[2], box[3]-alpha[3])
        if gutter < 2:
            raise ValueError(f'{entry["id"]}: meaningful pixels outside fixed frame/gutter: {gutter}')
        pads = [max(0, math.ceil(-box[0])), max(0, math.ceil(-box[1])), max(0, math.ceil(box[2]-raw.width)), max(0, math.ceil(box[3]-raw.height))]
        padded = Image.new('RGBa', (raw.width+pads[0]+pads[2], raw.height+pads[1]+pads[3]))
        padded.paste(raw.convert('RGBa'), (pads[0], pads[1]))
        window = tuple(box[a]+pads[a%2] for a in range(4))
        sample_bounds = {}
        for level in LEVELS:
            sample = padded.resize((level, level), Image.Resampling.LANCZOS, box=window).convert('RGBA')
            bounds = sample.getchannel('A').point(lambda a: 255 if a > 2 else 0).getbbox()
            if level == 512 and min(bounds[0], bounds[1], level-bounds[2], level-bounds[3]) < 2:
                raise ValueError('Filtered high-density source needs two transparent gutter pixels')
            sample_bounds[str(level)] = list(bounds)
            atlases[level].paste(sample, (i%columns*level, i//columns*level))
        slopes = [(b[1]-a[1])/(b[0]-a[0]) for a,b in entry['groundEdgeSegmentsSheet']]
        door = entry.get('personnelDoorEndpointsSheet')
        height = abs(door[1][1]-door[0][1])/(2*density) if door else None
        geometry = {'groundEdgeSlopesMeasured': slopes, 'groundSlopeMaximumAbsoluteError': max(abs(abs(s)-.5) for s in slopes),
                    'personnelDoorHeightMetresMeasured': height, 'personnelDoorObservable': entry.get('personnelDoorObservable', door is not None),
                    'status': 'measured' if (door or entry.get('personnelDoorObservable') is False) else 'pending-source-review'}
        if geometry['groundSlopeMaximumAbsoluteError'] > .11 or height is not None and abs(height/2.1-1) > .25:
            geometry['status'] = 'measured-outside-contract'
        records.append({'id': entry['id'], 'cell': i, 'sourceBounds': entry['sourceBoundsSheet'], 'sourcePixelsPerWorldPixel': density,
                        'sourceToMasterScale': 256/extent, 'groundCenterSheet': entry['groundCenterSheet'],
                        'groundCenterMaster': [128,192], 'clippedMeaningfulSourcePixels': 0,
                        'minimumSourceFilteringGutterPixels': gutter, 'bounds': sample_bounds['256'],
                        'levelAlphaBounds': sample_bounds, 'geometry': geometry, 'measurement': entry})
    meaningful = original.getchannel('A').point(lambda a:255 if a>2 else 0).convert('1')
    if meaningful.tobytes() != ownership.tobytes():
        raise ValueError('Every meaningful source pixel needs ownership')
    for level, atlas in atlases.items():
        atlas.save(destination/f'atlas-{level}.png', compress_level=9)
    shutil.copyfile(destination/'atlas-256.png', destination/'atlas.png')
    shutil.copyfile(source, destination/'generated-source.png')
    shutil.copyfile(measurements, destination/'registration-measurements.json')
    metadata = {'columns':columns,'rows':rows,'cellSizes':LEVELS,'masterCell':256,'order':[e['id'] for e in data['entries']],
                'source':'generated-source.png','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                'worldFramePixels':FRAME,'groundCenterMaster':[128,192],'sprites':records,'densityGroups':groups,
                'processing':{'sampling':'Every level from original RGBA via premultiplied-alpha Lanczos','colourKey':False,'recolouring':False,'silhouetteFitting':False,
                              'scalePolicy':'Observed physical platform/deck edges calibrate distinct generated bus, rail and dock paintings to shared world metres. Four dock orientations share one density.'},
                'generator':'built-in image_gen','regenerationDate':'2026-10-07'}
    (destination/'atlas.json').write_text(json.dumps(metadata,indent=2)+'\n')
    composite = Image.new('RGBA', atlases[256].size, '#829278');composite.alpha_composite(atlases[256]);composite.save(destination/'registration-preview.png')
    return metadata

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('measurements',type=Path);parser.add_argument('destination',type=Path)
    args=parser.parse_args();result=pack(args.source,args.measurements,args.destination)
    print(json.dumps({'output':str(args.destination),'sprites':len(result['sprites']),'review':[s['geometry'] for s in result['sprites']]}))
