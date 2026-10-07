#!/usr/bin/env python3
"""Replace full farm portraits with the game's fields and painted 2-tile cores.

Run render-farm-compounds.mjs first, then:
  python3 tools/assemble-farm-atlases.py /tmp/transport-farm-compounds industries-1 industries-3

This only assembles registered 512px cutouts. Processor cells retain their exact
registered samples; their original generated source, observations and affine
calibration remain archived. No colour key, creative edit or silhouette fit.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets/world/plot-buildings-v2'
spec = importlib.util.spec_from_file_location('plot_packer', Path(__file__).with_name('pack-plot-cutouts.py'))
packer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packer)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def assemble(compounds, job_id):
    dest = ASSETS / job_id
    original = json.loads((dest / 'atlas.json').read_text())
    if original.get('farmComposition'):
        raise ValueError(f'{job_id} is already assembled; restore its original source pack before rebuilding')
    job = json.loads((dest / 'generation-job.json').read_text())
    geometry = {item['kind']: item for item in json.loads((compounds / 'geometry.json').read_text())}
    cores = json.loads((ASSETS / 'farm-cores/atlas.json').read_text())
    core_by_kind = {item['kind']: item for item in cores['sprites'] if item['id']}
    original_atlas = Image.open(dest / 'atlas-512.png').convert('RGBA')
    sheet = original_atlas.copy()
    observations = []
    farm_cells = []
    for record in original['sprites']:
        if not record['id']:
            continue
        kind, index = record['kind'], record['cell']
        measurement = {'id': record['id']}
        if kind in geometry:
            farm = geometry[kind]
            image = Image.open(compounds / f'{kind}.png').convert('RGBA')
            if image.size != (512, 512):
                raise ValueError('Farm compounds must be registered 512px cells')
            sheet.paste(image, (index % job['columns'] * 512, index // job['columns'] * 512))
            measurement.update({key: farm[key] for key in ('groundVerticesSource', 'groundCenterSource')})
            measurement['groundObservationMethod'] = 'Actual game-renderer fence ground contacts on the 5-tile plot; 16m tiles and 1.2m fence height'
            core = core_by_kind[kind]
            door = core['measuredGeometry'].get('personnelDoorEndpointsMasterMeasured')
            if door:
                measurement['personnelDoorEndpointsSource'] = [
                    [farm['coreSourceOrigin'][axis] + point[axis] * farm['coreMasterToCompoundSourceScale'] for axis in (0, 1)]
                    for point in door
                ]
                measurement['personnelDoorObservable'] = True
                measurement['doorObservationMethod'] = 'Observed painted core door endpoints transformed by its actual game-renderer placement'
            else:
                measurement['personnelDoorObservable'] = False
                measurement['entranceReview'] = core['originalMeasurements'].get('entranceReview', 'No exposed ordinary personnel entrance in the painted core')
            farm_cells.append({'kind': kind, 'cell': index, 'compoundSha256': packer.digest(compounds / f'{kind}.png'),
                               'geometry': farm, 'coreOriginalSourceSha256': cores['sourceSha256'],
                               'coreRegisteredMasterSha256': core['masterSha256'],
                               'coreOriginalMeasurements': core['originalMeasurements'],
                               'coreSourceRegistration': core['registrationPlan']})
        else:
            # These are observations of the same pixels, moved by the recorded
            # registration affine, then multiplied by the canonical 512 density.
            measured = record['measuredGeometry']
            if measured['status'] != 'measured':
                raise ValueError(f'{kind}: processor source review must finish before assembly')
            measurement['groundCenterSource'] = [value * 2 for value in measured['groundCenterMasterMeasured']]
            edges = measured.get('groundEdgeSegmentsMasterMeasured')
            if edges:
                measurement['groundEdgeSegmentsSource'] = [[[value * 2 for value in point] for point in edge] for edge in edges]
            else:
                measurement['groundVerticesSource'] = [[value * 2 for value in point] for point in measured['groundVerticesMasterMeasured']]
            door = measured.get('personnelDoorEndpointsMasterMeasured')
            if door:
                measurement['personnelDoorEndpointsSource'] = [[value * 2 for value in point] for point in door]
                measurement['personnelDoorObservable'] = True
            else:
                measurement['personnelDoorObservable'] = False
                measurement['entranceReview'] = record['originalMeasurements'].get('entranceReview', 'No exposed ordinary personnel entrance')
            measurement['observationProvenance'] = 'Actual generator pixel observations transformed through the archived registration affine; exact registered 512px processor samples retained'
        observations.append(measurement)
    if not farm_cells:
        raise ValueError(f'{job_id}: no farm cells to assemble')
    # Archive generator pixels and measured source registration before the pack
    # writes its canonical composition source and metadata.
    for current, retained in [('generated-source.png', 'painted-source.png'),
                              ('atlas.json', 'painted-source-atlas.json'),
                              ('registration-measurements.json', 'painted-source-measurements.json')]:
        shutil.copyfile(dest / current, dest / retained)
    source = dest / 'farm-composition-source.png'
    packer.save_png(sheet, source)
    measurements = dest / 'farm-composition-measurements.json'
    write_json(measurements, {'entries': observations, 'observationPolicy': 'Game-renderer geometry for farm plots; measured generator observations for unchanged registered processors'})
    summary = packer.pack(source, dest / 'generation-job.json', dest,
                          compounds / job_id / 'qa', measurements, register_ground=True)
    result = json.loads((dest / 'atlas.json').read_text())
    if not result['physicalCalibration']['measuredGeometryVerified']:
        raise ValueError('Composed atlas does not pass actual geometry checks')
    # The largest processor level is an exact packing operation, with no filter.
    final = Image.open(dest / 'atlas-512.png').convert('RGBA')
    replaced = {item['cell'] for item in farm_cells}
    for index in range(job['columns'] * job['rows']):
        if index not in replaced:
            box = (index % job['columns'] * 512, index // job['columns'] * 512,
                   (index % job['columns'] + 1) * 512, (index // job['columns'] + 1) * 512)
            if final.crop(box).tobytes() != original_atlas.crop(box).tobytes():
                raise ValueError('Atlas assembly changed registered processor pixels')
    result['farmComposition'] = {'method': 'Actual native field/fence/animal geometry with painted 2-tile cores; unchanged registered processor cells',
                                  'canonicalCellPixels': 512, 'bareMeadowGround': 'RGBA transparent', 'farmCells': farm_cells,
                                  'paintedSource': 'painted-source.png', 'paintedSourceSha256': original['sourceSha256'],
                                  'paintedSourceMetadata': 'painted-source-atlas.json', 'paintedSourceMeasurements': 'painted-source-measurements.json',
                                  'coreAtlasMetadata': '../farm-cores/atlas.json', 'coreAtlas512Sha256': cores['outputs']['512']['sha256']}
    result['provenance'].update({'generator': 'image_gen painted cutouts + game renderer farm geometry',
                                 'operation': 'Registered 512px atlas assembly, then uniform premultiplied-alpha mip packing; original processor and core sources retained',
                                 'sourceReview': 'Measured farm field, fence, core entrance and processor source geometry verified'})
    result['mipFilter'] = 'Independent canonical 512px cutout premultiplied-alpha Lanczos; processor 512px samples copied exactly from original source registration'
    for output in result['outputs'].values():
        output['sourceDetailPolicy'] = 'Direct canonical composition resampling; retained original generator calibration records describe painted source resolution'
    write_json(dest / 'atlas.json', result)
    return {**summary, 'farmCells': len(farm_cells), 'registeredProcessor512SamplesUnchanged': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('compounds', type=Path)
    parser.add_argument('jobs', nargs='+', choices=['industries-1', 'industries-3'])
    args = parser.parse_args()
    for job_id in args.jobs:
        print(json.dumps(assemble(args.compounds, job_id)))
