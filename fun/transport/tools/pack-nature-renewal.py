#!/usr/bin/env python3
"""Register a newly authored nature sheet without retaining old sprite pixels.

Usage: pack-nature-renewal.py JOB_JSON SOURCE_PNG OUTPUT_DIR
The job records observed source landmarks; every mip samples the source anew.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def isolate(image, count, columns):
    """Separate disconnected atlas subjects using meaningful alpha, never RGB."""
    rgba = np.asarray(image)
    labels, _ = ndimage.label(rgba[:, :, 3] >= 16)
    populations = np.bincount(labels.ravel())
    populations[0] = 0
    main = np.argsort(populations)[-count:]
    if min(populations[main]) < 100:
        raise ValueError('Missing atlas subject')
    objects = ndimage.find_objects(labels)
    centers = {int(i): ((objects[i-1][1].start+objects[i-1][1].stop)/2,
                         (objects[i-1][0].start+objects[i-1][0].stop)/2) for i in main}
    # Sort rows before columns; unequal-height trees do not move to another row.
    vertical = sorted(main, key=lambda i: centers[int(i)][1])
    ordered = [int(i) for start in range(0, count, columns)
               for i in sorted(vertical[start:start+columns], key=lambda i: centers[int(i)][0])]
    seed = np.where(np.isin(labels, main), labels, 0)
    indices = ndimage.distance_transform_edt(seed == 0, return_distances=False, return_indices=True)
    owners = seed[tuple(indices)]
    cutouts = []
    for owner in ordered:
        selected = (owners == owner) & (rgba[:, :, 3] >= 8)
        ys, xs = np.nonzero(selected)
        bounds = [max(0, int(xs.min())-3), max(0, int(ys.min())-3),
                  min(image.width, int(xs.max())+4), min(image.height, int(ys.max())+4)]
        left, top, right, bottom = bounds
        crop = rgba[top:bottom, left:right].copy()
        crop[owners[top:bottom, left:right] != owner] = 0
        # Alpha 1–2 at remote empty pixels is generator encoding noise, not foliage.
        crop[crop[:, :, 3] <= 2] = 0
        cutouts.append((Image.fromarray(crop), bounds))
    return cutouts


def resize_alpha(image, size):
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def isolate_grid(image, columns, rows):
    """Keep every disconnected clump within the authored patch's grid cell."""
    alpha = np.asarray(image)[:, :, 3]
    def cuts(length, count, counts):
        result = [0]
        for i in range(1, count):
            center = length*i/count
            candidates = range(round(center-length/count*.09), round(center+length/count*.09)+1)
            # Prefer a clear gutter closest to its intended grid coordinate.
            result.append(min(candidates, key=lambda p:(int(counts[p-1:p+2].sum()),abs(p-center))))
        return result+[length]
    ys = cuts(image.height, rows, (alpha >= 8).sum(axis=1))
    output = []
    for row in range(rows):
        xs = cuts(image.width, columns, (alpha[ys[row]:ys[row+1]] >= 8).sum(axis=0))
        for col in range(columns):
            bounds = [xs[col],ys[row],xs[col+1],ys[row+1]]
            cutout = image.crop(bounds)
            # Keep a complete source cell; shared scale preserves sparse gaps.
            output.append((cutout,bounds))
    return output


def build(job, source, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert('RGBA')
    if np.mean(np.asarray(image)[:, :, 3] == 0) < .15:
        raise ValueError('Source lacks genuine transparent margins')
    columns, rows = job['columns'], job['rows']
    cutouts = isolate_grid(image, columns, rows) if job.get('gridCells') else isolate(image, len(job['order']), columns)
    ppm = 32 if job['kind'] == 'cactus' else 512 / (22 * 1.18)
    records = []
    for index, (cutout, bounds) in enumerate(cutouts):
        alpha = np.asarray(cutout)[:, :, 3]
        ys, xs = np.nonzero(alpha >= 160)
        if job.get('landmarks') and job['landmarks'][index]:
            landmark = job['landmarks'][index]
            root = [landmark['root'][0]-bounds[0], landmark['root'][1]-bounds[1]]
            top = landmark['crownTop']-bounds[1]
        else:
            # Source observation, explicitly disclosed as an estimate for review.
            root_y = int(ys.max()) - max(1, round((ys.max()-ys.min())*.018))
            base = (alpha >= 160) & (np.indices(alpha.shape)[0] >= root_y-5)
            root = [float(np.median(np.nonzero(base)[1])), float(root_y)]
            top = float(np.nonzero(alpha >= 32)[0].min())
        observed = root[1]-top
        if job.get('heights'):
            scale = job['heights'][index]*ppm/observed
            anchor = [128, 256*.955]
        else:
            scale = min(232/cutout.width, 222/cutout.height)
            if job.get('gridCells'):
                # One source-sheet scale, never magnify sparse clumps independently.
                scale = min(232/(image.width/columns), 222/(image.height/rows))
            # Ground clusters/rock masses retain the established bottom anchor.
            anchor = [128, 244]
            root = [cutout.width/2, cutout.height]
        offset = [anchor[0]-root[0]*scale, anchor[1]-root[1]*scale]
        target = [round(cutout.width*scale), round(cutout.height*scale)]
        # Validate the actual rounded paste, retaining a transparent edge pixel.
        if any(round(origin) < 1 or round(origin)+length > 255 for origin,length in zip(offset,target)):
            raise ValueError(f'{job["order"][index]} does not fit physical frame: {offset}, {target}; review source proportions')
        records.append({'id': job['order'][index], 'cell':index, 'sourceBounds':bounds,
                        'observedRootSource':[root[0]+bounds[0],root[1]+bounds[1]],
                        'observedCrownTopSource':top+bounds[1],
                        'observedRootMethod':'reviewed source landmark' if job.get('landmarks') and job['landmarks'][index] else 'opaque trunk-base estimate, 1.8% above contact-shadow bound',
                        'measuredSourceHeightPixels':observed,
                        'registeredPlantHeightPixels':observed*scale,
                        'calibratedHeightMetres':observed*scale/ppm,
                        'sourceScaleToMaster':scale,'masterOffsetPixels':offset,
                        'sourceCropPixels':list(cutout.size), 'masterDrawPixels':target,
                        'normalization':{'originalSize':list(image.size),'sourceBounds':bounds,
                                         'transparentFraction':float(np.mean(alpha == 0))}})
        if not job.get('heights'):
            # Geological patches and ground cover have footprint registration,
            # not measured tree-height or personnel-scale observations.
            for key in ['observedRootSource','observedCrownTopSource','observedRootMethod',
                        'measuredSourceHeightPixels','registeredPlantHeightPixels','calibratedHeightMetres']:
                records[-1].pop(key)
            records[-1]['registrationAnchorSource']=[root[0]+bounds[0],root[1]+bounds[1]]
            records[-1]['registrationMethod']='complete source-cell bottom centre' if job.get('gridCells') else 'isolated geological-patch bottom centre'
    source_name = 'source-renewal-2026-10-07.png'
    if Path(source).resolve() != (output/source_name).resolve():
        (output/source_name).write_bytes(Path(source).read_bytes())
    levels = sorted(set(job['cellSizes']+[256]))
    for size in levels:
        atlas = Image.new('RGBA', (columns*size, rows*size))
        for index, ((cutout, _), record) in enumerate(zip(cutouts, records)):
            factor = record['sourceScaleToMaster']*size/256
            scaled = resize_alpha(cutout, (max(1,round(cutout.width*factor)), max(1,round(cutout.height*factor))))
            cell = Image.new('RGBA',(size,size))
            xy = tuple(round(v*size/256) for v in record['masterOffsetPixels'])
            cell.paste(scaled, xy)
            atlas.paste(cell,(index%columns*size,index//columns*size))
            if size == 256:
                (output/'sources').mkdir(exist_ok=True)
                cell.save(output/'sources'/f'{record["id"].replace(":","_")}.png',optimize=True)
                record['bounds'] = list(cell.getchannel('A').point(lambda a:255 if a>=8 else 0).getbbox())
        atlas.save(output/f'atlas-{size}.png',optimize=True)
        if size == 256:
            atlas.save(output/'atlas.png',optimize=True)
    meta = {'columns':columns,'rows':rows,'cellSizes':levels,'masterCell':256,
            'order':job['order'],'source':source_name,'sourceSha256':digest(output/source_name),
            'artRevision':'from-scratch-2026-10-07','generator':'built-in image_gen',
            'mipSharpening':False,'registration':('Shared physical metre scale, root anchored; source anatomy preserved' if job.get('heights') else 'Complete footprint patch, common sheet scale for ground cover; source aspect ratio preserved'),
            'sprites':records,'sourceDetailLimits':{'noAdditionalPaintedDetail':True,
                'originalSourceSha256':digest(output/source_name),
                'description':'Every mip samples isolated original RGBA pixels; larger exports may enlarge source detail.'}}
    (output/'atlas.json').write_text(json.dumps(meta,indent=2)+'\n')
    generation = {'tool':'built-in image_gen','date':'2026-10-07','prompt':job['prompt'],
                  'sourceSha256':meta['sourceSha256'],'scale':({'normalizedMasterPixelsPerVerticalMetre':ppm,'rootAnchor':.955} if job.get('heights') else {'bottomAnchor':244/256,'calibration':'authored footprint patch; no measured physical height'}),
                  'measurements':records,'job':job}
    (output/'generation.json').write_text(json.dumps(generation,indent=2)+'\n')
    print(json.dumps({'family':str(output),'sprites':len(records),'source':source_name}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job'); parser.add_argument('source'); parser.add_argument('output')
    args = parser.parse_args()
    build(json.loads(Path(args.job).read_text()),args.source,args.output)
