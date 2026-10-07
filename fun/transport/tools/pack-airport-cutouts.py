#!/usr/bin/env python3
"""Register airport cutouts at one measured source/world density.

python3 tools/pack-airport-cutouts.py source.png job.json measurements.json [output]

Fractional source-grid boundaries are rounded outward only for pixel ownership.
The physical 96px frame is translated from observed ground landmarks, never
fitted to a silhouette. All levels are independently sampled from original RGBA
pixels using premultiplied-alpha Lanczos. No colour key or sharpening is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

LEVELS = (16, 32, 64, 128, 256, 512)
MASTER = 256
MEANINGFUL_ALPHA = 2
PREFIX = 'airport-buildings'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f'{name} must be a finite positive number')
    return float(value)


def point(value, name):
    if not isinstance(value, (list, tuple)) or len(value) != 2 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in value):
        raise ValueError(f'{name} must contain two finite coordinates')
    return [float(v) for v in value]


def alpha_bounds(image, threshold=MEANINGFUL_ALPHA):
    bounds = image.getchannel('A').point(lambda a: 255 if a > threshold else 0).getbbox()
    return list(bounds) if bounds else None


def save_png(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format='PNG', compress_level=9)


def sample_original(raw, pixels, frame_box):
    """Sample a fractional physical window without pulling adjacent cells in."""
    pads = [max(0, math.ceil(-frame_box[0])), max(0, math.ceil(-frame_box[1])),
            max(0, math.ceil(frame_box[2]-raw.width)), max(0, math.ceil(frame_box[3]-raw.height))]
    padded = Image.new('RGBa', (raw.width+pads[0]+pads[2], raw.height+pads[1]+pads[3]))
    padded.paste(raw.convert('RGBa'), (pads[0], pads[1]))
    window = tuple(frame_box[i]+pads[i % 2] for i in range(4))
    return padded.resize((pixels, pixels), Image.Resampling.LANCZOS, box=window).convert('RGBA')


def measured_id(entry):
    value = entry.get('id', '')
    if value.startswith('airport-building:'):
        return value
    kind = entry.get('kind', value)
    axis = entry.get('axis')
    if axis is None and entry.get('rotation') in (0, 1):
        axis = 'xy'[entry['rotation']]
    if not kind or axis not in ('x', 'y'):
        raise ValueError('Measured entries need a runtime id, or kind/id with axis or rotation 0/1')
    return f'airport-building:{kind}:axis-{axis}'


def projected_centre(entry):
    centre = entry['localCenter']
    u, v = point([centre['u'], centre['v']], 'localCenter')
    if entry['axis'] == 'y':
        u, v = v, u
    return [(u-v)*32, (u+v)*16]


def geometry(measured, centre, density, anchor):
    def world(p):
        p = point(p, 'observed landmark')
        return [anchor[a]+(p[a]-centre[a])/density for a in (0, 1)]

    segments = measured.get('groundEdgeSegmentsSheet')
    if not isinstance(segments, list) or len(segments) < 2:
        raise ValueError('At least two actual groundEdgeSegmentsSheet observations are required')
    slopes, transformed = [], []
    for segment in segments:
        if len(segment) != 2:
            raise ValueError('Ground segments need two endpoints')
        a, b = [point(p, 'ground-edge endpoint') for p in segment]
        if a[0] == b[0]:
            raise ValueError('Ground edges must not have a vertical screen projection')
        slopes.append((b[1]-a[1])/(b[0]-a[0]))
        transformed.append([world(a), world(b)])
    if not any(s > 0 for s in slopes) or not any(s < 0 for s in slopes):
        raise ValueError('Both actual ground axes must be observed')
    if max(abs(abs(s)-.5) for s in slopes) > .11:
        raise ValueError('Observed ground edges exceed the canonical +/-0.5 slope tolerance')
    result = {
        'status': 'measured', 'groundCenterSheet': centre,
        'groundCenterWorldMeasured': anchor, 'groundCenterErrorWorldPixels': 0,
        'groundEdgeSegmentsWorldMeasured': transformed, 'groundEdgeSlopesMeasured': slopes,
        'groundSlopeMaximumAbsoluteError': max(abs(abs(s)-.5) for s in slopes),
        'originalMeasurement': measured,
    }
    door = measured.get('personnelDoorEndpointsSheet')
    observable = measured.get('personnelDoorObservable', door is not None)
    result['personnelDoorObservable'] = observable
    if door is not None:
        if len(door) != 2:
            raise ValueError('Personnel-door endpoints need two points')
        endpoints = [point(p, 'personnel-door endpoint') for p in door]
        result['personnelDoorEndpointsWorldMeasured'] = [world(p) for p in endpoints]
        result['personnelDoorHeightWorldPixelsMeasured'] = abs(endpoints[1][1]-endpoints[0][1])/density
        result['personnelDoorHeightMetresMeasured'] = result['personnelDoorHeightWorldPixelsMeasured']/2
    elif observable:
        raise ValueError('An observable personnel door needs actual head/sill endpoints')
    else:
        result['personnelDoorHeightWorldPixelsMeasured'] = None
        result['personnelDoorHeightMetresMeasured'] = None
        result['personnelDoorReview'] = measured.get('personnelDoorNotes', 'No complete ordinary entrance is observable')
    return result


def validate_calibration(measurements, density, source_size):
    evidence = measurements.get('densityCalibration', {})
    observations = evidence.get('observations')
    if not isinstance(observations, list) or not observations:
        raise ValueError('Shared source density needs observed physical-span calibration evidence')
    records = []
    numerator = denominator = 0
    for observation in observations:
        endpoints = observation.get('sourceEdgeEndpointsSheet')
        if not isinstance(endpoints, list) or len(endpoints) != 2:
            raise ValueError('Density calibration needs observed sourceEdgeEndpointsSheet')
        a, b = [point(p, 'calibration endpoint') for p in endpoints]
        if any(not 0 <= p[axis] <= source_size[axis] for p in (a, b) for axis in (0, 1)):
            raise ValueError('Calibration endpoints must be within the original source')
        span = number(observation.get('physicalSpanWorldPixels'), 'physicalSpanWorldPixels')
        if not observation.get('note') or a[0] == b[0]:
            raise ValueError('Calibration needs a physical-span note and a nonzero projected width')
        source_span = abs(b[0]-a[0])
        observed = source_span/span
        numerator += source_span*span
        denominator += span*span
        records.append({'observation': observation, 'observedSourcePixelsPerWorldPixel': observed,
                        'relativeDifferenceFromSharedDensity': (observed-density)/density})
    fitted_density = numerator/denominator
    relative_error = abs(density-fitted_density)/fitted_density
    if relative_error > .02:
        raise ValueError('Shared density differs from the pooled observed physical-span fit by more than 2%; review calibration')
    return {'status': 'observed-whole-sheet-density', 'sourcePixelsPerWorldPixel': density,
            'fittedSourcePixelsPerWorldPixel': fitted_density,
            'relativeDifferenceFromPooledFit': relative_error, 'pooledFitToleranceRelative': .02,
            'observations': records, 'originalEvidence': evidence,
            'policy': 'One explicitly chosen common density; measured component-size deviations remain documented, never individually fitted'}


def pack(source, job_path, measurements_path, destination=None, qa_dir=None):
    source, job_path, measurements_path = map(Path, (source, job_path, measurements_path))
    job = json.loads(job_path.read_text())
    measurements = json.loads(measurements_path.read_text())
    destination = Path(destination or job['destination'])
    density = number(measurements.get('sourcePixelsPerWorldPixel'), 'sourcePixelsPerWorldPixel')
    with Image.open(source) as original:
        if original.mode not in ('RGBA', 'LA') and not (original.mode == 'P' and 'transparency' in original.info):
            raise ValueError('The original source must have genuine alpha transparency')
        image = original.convert('RGBA')
    cols, rows = job['columns'], job['rows']
    if not isinstance(cols, int) or not isinstance(rows, int) or min(cols, rows) <= 0:
        raise ValueError('Grid dimensions must be positive integers')
    cw, ch = image.width/cols, image.height/rows
    if abs(cw-ch) > 1e-8:
        raise ValueError('The source grid must contain equal square cells, including fractional boundaries')
    entries = job['entries']
    if len(entries) != cols*rows or any(not e for e in entries):
        raise ValueError('Every airport component cell needs an explicit entry')
    if measurements.get('sourceDimensions') and list(image.size) != measurements['sourceDimensions']:
        raise ValueError('Measured source dimensions do not match the supplied original')
    if measurements.get('source') and Path(measurements['source']).name != source.name:
        raise ValueError('Measurements identify a different generated source')
    by_id = {}
    for measured in measurements['entries']:
        identity = measured_id(measured)
        if identity in by_id:
            raise ValueError(f'Duplicate measured entry: {identity}')
        if 'sourcePixelsPerWorldPixel' in measured and measured['sourcePixelsPerWorldPixel'] != density:
            raise ValueError('Per-entry density is prohibited; use one explicit shared scale')
        by_id[identity] = measured
    if set(by_id) != {e['id'] for e in entries}:
        raise ValueError('Measured entries must exactly cover the job entries')
    frame = job['componentFrame']
    world_pixels = number(frame['worldPixels'], 'componentFrame.worldPixels')
    anchor = point(frame.get('groundCenterWorld') or [v*world_pixels/job['cellPixels'] for v in frame['groundCenterCell']], 'groundCenterWorld')
    calibration = validate_calibration(measurements, density, image.size)
    meaningful = image.getchannel('A').point(lambda a: 255 if a > MEANINGFUL_ALPHA else 0)
    ownership = Image.new('L', image.size)
    prepared, records = [], []
    for index, entry in enumerate(entries):
        measured = by_id[entry['id']]
        centre = point(measured.get('groundCenterSheet'), 'groundCenterSheet')
        nominal = [index % cols*cw, index//cols*ch, (index % cols+1)*cw, (index//cols+1)*ch]
        bounds = measured.get('sourceBoundsSheet') or [math.floor(nominal[0]), math.floor(nominal[1]), math.ceil(nominal[2]), math.ceil(nominal[3])]
        if len(bounds) != 4 or any(isinstance(v, bool) or not isinstance(v, int) for v in bounds):
            raise ValueError('Source bounds must contain four whole-pixel coordinates')
        if not (0 <= bounds[0] < bounds[2] <= image.width and 0 <= bounds[1] < bounds[3] <= image.height):
            raise ValueError('Source bounds must be a nonempty rectangle within the original source')
        part_mask = meaningful.crop(tuple(bounds))
        seen = ownership.crop(tuple(bounds))
        if any(a and b for a, b in zip(part_mask.tobytes(), seen.tobytes())):
            raise ValueError('Meaningful alpha is owned by overlapping component source bounds')
        ownership.paste(part_mask, (bounds[0], bounds[1]))
        raw = image.crop(tuple(bounds))
        alpha = alpha_bounds(raw)
        if alpha is None:
            raise ValueError(f'{entry["id"]} has no meaningful source alpha')
        extent = world_pixels*density
        left = centre[0]-anchor[0]*density-bounds[0]
        top = centre[1]-anchor[1]*density-bounds[1]
        window = [left, top, left+extent, top+extent]
        source_gutter = min(alpha[0]-window[0], alpha[1]-window[1], window[2]-alpha[2], window[3]-alpha[3])
        if source_gutter < 2:
            raise ValueError(f'{entry["id"]}: meaningful source alpha leaves the fixed physical frame or its 2px filter gutter ({source_gutter:.3f}px)')
        samples = {level: sample_original(raw, level, window) for level in LEVELS}
        filtered_bounds = alpha_bounds(samples[512])
        filtered_gutter = min(filtered_bounds[0], filtered_bounds[1], 512-filtered_bounds[2], 512-filtered_bounds[3])
        if filtered_gutter < 2:
            raise ValueError(f'{entry["id"]}: filtered 512px level needs a 2px transparent gutter')
        sheet_alpha = [alpha[i]+bounds[i % 2] for i in range(4)]
        relative = [(sheet_alpha[i]-centre[i % 2])/density for i in range(4)]
        frame_alpha = [relative[i]+anchor[i % 2] for i in range(4)]
        projected = projected_centre(entry)
        airport_alpha = [relative[i]+projected[i % 2] for i in range(4)]
        noise_count = noise_energy = 0
        for y in range(raw.height):
            for x in range(raw.width):
                a = raw.getpixel((x, y))[3]
                if a and not (window[0] <= x+.5 < window[2] and window[1] <= y+.5 < window[3]):
                    noise_count += 1
                    noise_energy += a
                    if a > MEANINGFUL_ALPHA:
                        raise ValueError('Meaningful original pixel would be clipped')
        record = {'id': entry['id'], 'kind': entry['kind'], 'axis': entry['axis'], 'slot': index,
                  'nominalSourceCellBoundsSheet': nominal, 'sourceBoundsSheet': bounds,
                  'groundCenterSheet': centre, 'physicalFrameBoundsSheet': [window[i]+bounds[i % 2] for i in range(4)],
                  'sourceToWorldScale': 1/density, 'sourceToMasterScale': MASTER/extent,
                  'translationWorldFromSheet': [anchor[a]-centre[a]/density for a in (0, 1)],
                  'meaningfulAlphaBoundsSheet': sheet_alpha, 'meaningfulAlphaBoundsWorldFrame': frame_alpha,
                  'meaningfulAlphaBoundsWorldRelativeToGroundCentre': relative,
                  'projectedCentreRelativeToAirportAnchor': projected,
                  'airportAnchorAlphaBoundsWorld': airport_alpha,
                  'minimumSourceFilteringGutterPixels': source_gutter,
                  'minimum512FilteringGutterPixels': filtered_gutter,
                  'meaningfulSourcePixels': sum(part_mask.histogram()[1:]),
                  'clippedMeaningfulSourcePixels': 0, 'clippedEncodingNoisePixels': noise_count,
                  'clippedEncodingNoiseAlphaEnergy': noise_energy,
                  'physicalDimensions': entry.get('physicalDimensions'),
                  'geometry': geometry(measured, centre, density, anchor)}
        prepared.append(samples)
        records.append(record)
    if ownership.tobytes() != meaningful.tobytes():
        raise ValueError('Some meaningful original alpha pixels have no component ownership')
    destination.mkdir(parents=True, exist_ok=True)
    outputs = []
    for level in LEVELS:
        atlas = Image.new('RGBA', (cols*level, rows*level))
        for index, samples in enumerate(prepared):
            atlas.paste(samples[level], (index % cols*level, index//cols*level))
        path = destination/f'{PREFIX}-{level}.png'
        save_png(atlas, path)
        outputs.append({'path': path.name, 'cellPixels': level, 'dimensions': list(atlas.size), 'sha256': digest(path), 'samplingSource': 'original-generated-source'})
        if level == MASTER:
            shutil.copyfile(path, destination/f'{PREFIX}.png')
    provenance = [('generated-source.png', source), ('generation-job.json', job_path), ('registration-measurements.json', measurements_path)]
    for name, path in provenance:
        target = destination/name
        if path.resolve() != target.resolve():
            shutil.copyfile(path, target)
    (destination/'generation-prompt.txt').write_text(job.get('prompt', '')+'\n')
    reference = Path(job.get('reference', ''))
    if reference.is_file():
        shutil.copyfile(reference, destination/'generation-reference.png')
    metadata = {
        'id': job['id'], 'columns': cols, 'rows': rows, 'masterCellPixels': MASTER, 'levels': list(LEVELS),
        'sourceDimensions': list(image.size), 'sourceCellPixels': cw, 'sourcePixelsPerWorldPixel': density,
        'worldFramePixels': world_pixels, 'groundCenterWorld': anchor,
        'source': {'path': 'generated-source.png', 'originalPath': str(source), 'sha256': digest(source)},
        'generationJobSha256': digest(job_path), 'measurementsSha256': digest(measurements_path),
        'sourceCalibration': calibration, 'generationRequestedSourcePixelsPerWorldPixel': job.get('sourcePixelsPerWorldPixel'),
        'processing': {'sampling': 'premultiplied-alpha Lanczos, every level independently from original registered pixels',
                       'meaningfulAlphaThresholdExclusive': MEANINGFUL_ALPHA, 'silhouetteFitting': False,
                       'perEntryScale': False, 'sharpening': False, 'colourKey': False, 'recolouring': False,
                       'sourceCropPolicy': 'Outward whole-pixel fractional-grid crops, or explicit measured ownership bounds',
                       'registrationPolicy': 'Measured physical ground-centre translation at one shared source/world density'},
        'entries': records, 'outputs': outputs,
    }
    (destination/'atlas.json').write_text(json.dumps(metadata, indent=2)+'\n')
    if qa_dir:
        qa_dir = Path(qa_dir)
        qa_dir.mkdir(parents=True, exist_ok=True)
        comparison = Image.new('RGB', (cols*MASTER, rows*MASTER*4))
        for variant, colour in enumerate(('#78934d', '#b6c2ad', '#cba869', '#355468')):
            background = Image.new('RGBA', (cols*MASTER, rows*MASTER), colour)
            for index, samples in enumerate(prepared):
                background.alpha_composite(samples[MASTER], (index % cols*MASTER, index//cols*MASTER))
            comparison.paste(background.convert('RGB'), (0, variant*rows*MASTER))
        save_png(comparison, qa_dir/'terrain-comparison.png')
        overlay = comparison.crop((0, 0, cols*MASTER, rows*MASTER))
        draw = ImageDraw.Draw(overlay)
        for index, record in enumerate(records):
            dx, dy = index % cols*MASTER, index//cols*MASTER
            for segment in record['geometry']['groundEdgeSegmentsWorldMeasured']:
                draw.line([(dx+p[0]*MASTER/world_pixels, dy+p[1]*MASTER/world_pixels) for p in segment], fill='#ffdd81', width=1)
            cx, cy = dx+anchor[0]*MASTER/world_pixels, dy+anchor[1]*MASTER/world_pixels
            draw.line((cx-4, cy, cx+4, cy), fill='#fafafa', width=1)
            draw.line((cx, cy-4, cx, cy+4), fill='#fafafa', width=1)
        save_png(overlay, qa_dir/'registration-comparison.png')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', type=Path)
    parser.add_argument('job', type=Path)
    parser.add_argument('measurements', type=Path)
    parser.add_argument('destination', type=Path, nargs='?')
    parser.add_argument('--qa-dir', type=Path)
    args = parser.parse_args()
    result = pack(args.source, args.job, args.measurements, args.destination, args.qa_dir)
    print(json.dumps({'destination': str(args.destination or json.loads(args.job.read_text())['destination']),
                      'sourcePixelsPerWorldPixel': result['sourcePixelsPerWorldPixel'], 'components': len(result['entries']),
                      'clippedMeaningfulSourcePixels': sum(e['clippedMeaningfulSourcePixels'] for e in result['entries'])}))


if __name__ == '__main__':
    main()
