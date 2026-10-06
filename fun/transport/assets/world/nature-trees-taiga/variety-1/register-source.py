#!/usr/bin/env python3
"""Register complete generated taiga trees at their measured physical scale.

Run from any directory: python register-source.py ../variety-2
Artwork is not painted or recoloured. Only transparent-fringe cropping,
uniform complete-tree physical calibration and integer translation are used.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from PIL import Image

package = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).parent
transport = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location('house_pipeline', transport / 'tools/build-house-atlases.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
metadata_path = package / 'generation.json'
metadata = json.loads(metadata_path.read_text())
source = Image.open(package / metadata['acceptedSource']).convert('RGBA')
cell_size = metadata['scale']['masterCellPixels']
pixels_per_metre = metadata['scale']['normalizedMasterPixelsPerVerticalMetre']
root_target = (cell_size / 2, metadata['scale']['rootAnchor'] * cell_size)
side_limit = cell_size / 2 - metadata['scale']['minimumSideGutterPixels']
registered = Image.new('RGBA', (cell_size * 3, cell_size * 3))
results = []
for index, record in enumerate(metadata['measurements']):
    box = record['sourceCell']
    original = source.crop(box)
    alpha = original.getchannel('A')
    visible = alpha.point(lambda value: 255 if value >= 8 else 0).getbbox()
    if not visible:
        raise ValueError(record['id'] + ': empty generated tree')
    # Match the existing atlas pipeline's alpha>=8 plus two-pixel fringe.
    trim = (max(0, visible[0]-2), max(0, visible[1]-2), min(original.width, visible[2]+2), min(original.height, visible[3]+2))
    whole_tree = original.crop(trim)
    root_global = record['sourceRootFoot']
    root = (root_global[0] - box[0] - trim[0], root_global[1] - box[1] - trim[1])
    source_crown_top = box[1] + visible[1]
    source_height = root_global[1] - source_crown_top
    requested_factor = record['heightMetres'] * pixels_per_metre / source_height
    side_factor = side_limit / max(root[0], whole_tree.width-root[0])
    factor = min(requested_factor, side_factor)
    dimensions = (round(whole_tree.width*factor), round(whole_tree.height*factor))
    calibrated = pipeline.resize_alpha(whole_tree, dimensions)
    actual_factor = (dimensions[0]/whole_tree.width, dimensions[1]/whole_tree.height)
    offset = (round(root_target[0]-root[0]*actual_factor[0]), round(root_target[1]-root[1]*actual_factor[1]))
    cell = Image.new('RGBA', (cell_size, cell_size))
    if offset[0] < 0 or offset[1] < 0 or offset[0]+dimensions[0] > cell_size or offset[1]+dimensions[1] > cell_size:
        raise ValueError(record['id'] + ': complete tree would clip')
    cell.paste(calibrated, offset)
    final_bounds = cell.getchannel('A').getbbox()
    edges = [cell.getchannel('A').crop(edge).getextrema()[1] for edge in [(0,0,cell_size,1),(0,cell_size-1,cell_size,cell_size),(0,0,1,cell_size),(cell_size-1,0,cell_size,cell_size)]]
    if any(edges):
        raise ValueError(record['id'] + ': nontransparent cell edge')
    actual_root = [offset[0]+root[0]*actual_factor[0], offset[1]+root[1]*actual_factor[1]]
    height_metres = source_height*actual_factor[1]/pixels_per_metre
    variance = height_metres/record['heightMetres'] - 1
    if abs(variance) > .15:
        raise ValueError(record['id'] + ': height exceeds natural15% allowance')
    result = dict(record, sourceCrownTop=source_crown_top, sourceCrownToRootPixels=source_height, sourceTrimBounds=list(trim), requestedPhysicalFactor=requested_factor, wholeTreeUniformFactor=factor, actualResampleFactors=list(actual_factor), registeredOffset=list(offset), calibratedRootFoot=actual_root, calibratedCrownToRootPixels=source_height*actual_factor[1], calibratedHeightMetres=height_metres, heightVariancePercent=variance*100, sideGutterCalibration=factor < requested_factor, registeredAlphaBounds=list(final_bounds), edgeAlpha=edges)
    results.append(result)
    registered.paste(cell, ((index%3)*cell_size, (index//3)*cell_size))
pipeline.save_png(registered, package / metadata['registeredSource'])
metadata['measurements'] = results
metadata['registeredSourceSha256'] = hashlib.sha256((package / metadata['registeredSource']).read_bytes()).hexdigest()
metadata['registration'] = 'Every complete source tree uniformly physically calibrated, then translated to the measured exposed-root anchor. Source silhouettes and RGBA materials are preserved; no paint edits or colour substitutions.'
metadata['packing']['command'] = metadata['packing']['command'].replace('--columns3','--columns 3').replace('--rows3','--rows 3').replace('--max-cell256','--max-cell 256')
metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps({'sheet':metadata['sheet'], 'source':str(package / metadata['registeredSource']), 'trees':[{'id':r['id'],'heightMetres':round(r['calibratedHeightMetres'],3),'heightVariancePercent':round(r['heightVariancePercent'],2),'root':r['calibratedRootFoot']} for r in results]}, indent=2))
