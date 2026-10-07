#!/usr/bin/env python3
"""Export denser object cells directly from their retained original cutouts.

Historical families retain their exact 16–256 PNGs and registration. Renewed
families are reconstructed with their retained source and measured packing
recipe, including every shipping mip and source cell. Every level samples the
original independently in premultiplied alpha. A larger display cell can
enlarge source pixels without adding painted detail.

Run without arguments to export all supported families; --verify checks the
source, registration, outputs and unchanged historical PNGs without writing.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import shutil
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'assets' / 'world'
FAMILIES = {
    'nature-mountains': {'levels': (512, 1024), 'anchor': 'bottom'},
    'nature-rocks': {'levels': (512, 1024), 'anchor': 'bottom'},
    'isometric-infrastructure-v2': {'levels': (512,), 'anchor': 'bottom'},
    'vehicle-bus-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-express-bus-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-truck-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-locomotive-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-coach-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-wagon-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-ferry-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-cargo-ship-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicle-tanker-dimetric-v2': {'levels': (256,), 'anchor': 'center'},
    'vehicles-dimetric-v2': {'levels': (256,), 'anchor': 'exact'},
    'city-ground-v3': {'levels': (256, 512), 'anchor': 'bottom', 'centerFromCell': 4},
}
spec = importlib.util.spec_from_file_location('house_pipeline', Path(__file__).with_name('build-house-atlases.py'))
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def renewal_packer(family, metadata):
    if family in ('nature-mountains', 'nature-rocks') and metadata.get('artRevision') == 'from-scratch-2026-10-07':
        return 'pack-nature-renewal.py'
    if family == 'isometric-infrastructure-v2' and metadata.get('regenerationDate') == '2026-10-07':
        return 'pack-station-cutouts.py'
    return None


@lru_cache(maxsize=None)
def load_packer(filename):
    spec = importlib.util.spec_from_file_location(filename.removesuffix('.py').replace('-', '_'), Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def renewed_cell_details(metadata, size):
    """Report actual original-pixel sampling, without assuming a source grid."""
    details = []
    for record in metadata['sprites']:
        left, top, right, bottom = record['sourceBounds']
        crop = [right-left, bottom-top]
        entry = {'id': record['id'], 'sourceBoundsSheet': record['sourceBounds'], 'sourceCropPixels': crop}
        if 'sourceScaleToMaster' in record:
            factor = record['sourceScaleToMaster'] * size / 256
            draw = [max(1, round(dimension*factor)) for dimension in crop]
            scales = [draw[i]/crop[i] for i in range(2)]
            entry.update(drawPixels=draw,
                         offsetPixels=[round(value*size/256) for value in record['masterOffsetPixels']],
                         nativeEquivalentCellPixels=256/record['sourceScaleToMaster'])
        else:
            # Architecture samples a measured world frame, including transparent
            # space outside the crop. It does not fit the cutout to the cell.
            extent = metadata['worldFramePixels'] * record['sourcePixelsPerWorldPixel']
            scales = [size/extent, size/extent]
            entry.update(originalSamplingWindowPixels=[extent, extent], nativeEquivalentCellPixels=extent)
        entry.update(sourcePixelScale=scales, enlargesOriginalPixels=any(scale > 1 for scale in scales))
        details.append(entry)
    return details


def build_renewed(folder, family, metadata, source_path, verify):
    """Re-run the retained packing recipe; never reinterpret new art as old cells."""
    filename = renewal_packer(family, metadata)
    packer = load_packer(filename)
    with tempfile.TemporaryDirectory(prefix='transport-object-density-') as directory:
        output = Path(directory)
        if filename == 'pack-nature-renewal.py':
            generation = json.loads((folder / 'generation.json').read_text())
            if generation.get('sourceSha256') != metadata['sourceSha256']:
                raise ValueError(f'{folder}: generation source hash no longer matches its registration')
            with contextlib.redirect_stdout(io.StringIO()):
                packer.build(generation['job'], source_path, output)
            metadata_files = ('atlas.json', 'generation.json')
        else:
            packer.pack(source_path, folder / 'registration-measurements.json', output)
            metadata_files = ('atlas.json',)
        for name in metadata_files:
            if json.loads((folder / name).read_text()) != json.loads((output / name).read_text()):
                raise ValueError(f'{folder / name}: renewed source registration differs from its packing recipe')
        if not set(FAMILIES[family]['levels']).issubset(metadata['cellSizes']):
            raise ValueError(f'{folder}: renewed recipe omits a required density')
        # Check low mips and isolated master cells as well as high densities.
        # Exact PNG bytes also detect source-cell drift or altered file payloads.
        pngs = sorted(path for path in output.rglob('*.png') if path.name != metadata['source'])
        for generated in pngs:
            target = folder / generated.relative_to(output)
            if verify:
                if not target.exists() or digest(target) != digest(generated):
                    raise ValueError(f'{target}: PNG differs from the renewed original-source export')
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(generated, target)
    with Image.open(source_path) as source:
        source_size = list(source.size)
    exports = []
    for size in FAMILIES[family]['levels']:
        details = renewed_cell_details(metadata, size)
        exports.append({'cell': size, 'bytes': (folder / f'atlas-{size}.png').stat().st_size,
                        'enlargedOriginalCutouts': sum(entry['enlargesOriginalPixels'] for entry in details)})
    return {'family': family, 'originalSheetPixels': source_size,
            'sourceCellPixels': sorted({tuple(entry['sourceCropPixels']) for entry in details}),
            'registrationVerification': f'Exact original-source regeneration with {filename}',
            'noAdditionalPaintedDetail': True, 'exports': exports, 'verified': verify}


def historical_hashes(folder, metadata):
    names = ['atlas.png', *(f'atlas-{size}.png' for size in (16, 32, 64, 128, 256) if (folder / f'atlas-{size}.png').exists())]
    hashes = {name: digest(folder / name) for name in names}
    published = metadata.get('sourceDetailLimits', {}).get('historicalAtlasSha256')
    if published is not None and any(hashes.get(name) != checksum for name, checksum in published.items()):
        raise ValueError(f'{folder}: a historical atlas changed after density publication')
    return published or hashes


def registered_cutout(source, record, metadata, policy, index):
    """Recover a stored historical mapping; never fit a newly observed silhouette."""
    columns, rows = metadata['columns'], metadata['rows']
    source_box = tuple(record.get('sourceBounds') or (
        index % columns * 256, index // columns * 256,
        (index % columns + 1) * 256, (index // columns + 1) * 256,
    ))
    if len(source_box) != 4 or source_box[0] < 0 or source_box[1] < 0 or source_box[2] > source.width or source_box[3] > source.height:
        raise ValueError('Registered source cell is outside the original sheet')
    cell = source.crop(source_box)
    if policy['anchor'] == 'exact':
        if cell.size != (256, 256):
            raise ValueError('Exact fallback masters must retain their original 256px cells')
        crop = (0, 0, 256, 256)
        draw_size, offset = (256, 256), (0, 0)
    else:
        crop = tuple(record['normalization']['sourceBounds'])
        if crop != house.trim_bounds(cell):
            raise ValueError(f"{record['id']}: original alpha crop changed")
        if tuple(record['normalization']['originalSize']) != cell.size:
            raise ValueError(f"{record['id']}: original cell dimensions changed")
        cutout_size = (crop[2] - crop[0], crop[3] - crop[1])
        if policy['anchor'] == 'center':
            scale = metadata.get('sharedScale')
            if not isinstance(scale, (int, float)) or not 0 < scale < 4:
                raise ValueError('Directional frames require their published common family scale')
        else:
            # These older families were registered against a 232px envelope.
            # Reuse that historical mapping, verified against the published
            # master below, rather than optimizing or refitting a new output.
            scale = min(232 / cutout_size[0], 232 / cutout_size[1])
        draw_size = tuple(max(1, round(dimension * scale)) for dimension in cutout_size)
        centered = policy['anchor'] == 'center' or index >= policy.get('centerFromCell', float('inf'))
        offset = ((256 - draw_size[0]) // 2,
                  (256 - draw_size[1]) // 2 if centered else 244 - draw_size[1])
    cutout = cell.crop(crop)
    return cutout, {
        'id': record['id'], 'cell': index,
        'originalCellPixels': list(cell.size),
        'sourceCellBoundsSheet': list(source_box),
        'sourceCropBoundsCell': list(crop),
        'sourceCropPixels': list(cutout.size),
        'masterDrawPixels': list(draw_size), 'masterOffsetPixels': list(offset),
        'nativeEquivalentCellPixels': min(256 * cutout.width / draw_size[0], 256 * cutout.height / draw_size[1]),
    }


def render_cell(cutout, registration, size):
    """One independent source-to-level resample, keeping the exact 256px mapping."""
    factor = size / 256
    draw_size = tuple(round(value * factor) for value in registration['masterDrawPixels'])
    offset = tuple(round(value * factor) for value in registration['masterOffsetPixels'])
    output = Image.new('RGBA', (size, size))
    output.paste(house.resize_alpha(cutout, draw_size), offset)
    sx, sy = draw_size[0] / cutout.width, draw_size[1] / cutout.height
    crop = registration['sourceCropBoundsCell']
    details = {
        **registration, 'drawPixels': list(draw_size), 'offsetPixels': list(offset),
        'sourceToCellAffine': [sx, 0, 0, sy, offset[0] - crop[0] * sx, offset[1] - crop[1] * sy],
        'sourceCoordinateSpace': 'original cell pixels',
        'sourcePixelScale': [sx, sy], 'enlargesOriginalPixels': sx > 1 or sy > 1,
    }
    return output, details


def validate_fallback_sources(folder, metadata, source):
    """The fallback composition must still be the exact active SE master cells."""
    if metadata.get('registration') != 'Exact active SE master cells; no per-frame renormalization':
        raise ValueError('Fallback source registration is not an exact master composition')
    provenance = []
    for index, record in enumerate(metadata['sprites']):
        family = folder / record['sourceFamily']
        family_metadata = json.loads((family / 'atlas.json').read_text())
        if record['sourceHeading'] != 'SE':
            raise ValueError('Fallback source heading changed')
        direction_index = family_metadata['order'].index(record['id'] + ':SE')
        master = Image.open(family / 'atlas.png').convert('RGBA')
        x, y = direction_index % 3 * 256, direction_index // 3 * 256
        fallback_x, fallback_y = index % 3 * 256, index // 3 * 256
        if master.crop((x, y, x + 256, y + 256)).tobytes() != source.crop((fallback_x, fallback_y, fallback_x + 256, fallback_y + 256)).tobytes():
            raise ValueError(f"{record['id']}: fallback no longer matches the active directional master")
        provenance.append({'id': record['id'], 'sourceFamily': record['sourceFamily'],
                           'sourceHeading': 'SE', 'directionalMasterSha256': digest(family / 'atlas.png'),
                           'directionalOriginalSource': family_metadata['source'],
                           'directionalOriginalSourceSha256': family_metadata['sourceSha256']})
    return provenance


def build(folder, family=None, verify=False):
    family = family or folder.name
    if family not in FAMILIES:
        raise ValueError(f'Unsupported registered family: {family}')
    policy = FAMILIES[family]
    metadata_path = folder / 'atlas.json'
    metadata = json.loads(metadata_path.read_text())
    source_path = folder / metadata['source']
    if digest(source_path) != metadata['sourceSha256']:
        raise ValueError(f'{source_path}: original source hash no longer matches its registration')
    if renewal_packer(family, metadata):
        return build_renewed(folder, family, metadata, source_path, verify)
    source = Image.open(source_path).convert('RGBA')
    master = Image.open(folder / 'atlas.png').convert('RGBA')
    columns, rows = metadata['columns'], metadata['rows']
    if master.size != (columns * 256, rows * 256) or len(metadata['sprites']) != columns * rows or len(metadata['order']) != columns * rows:
        raise ValueError(f'{folder}: master grid changed')
    original_hashes = historical_hashes(folder, metadata)
    fallback_sources = validate_fallback_sources(folder, metadata, source) if policy['anchor'] == 'exact' else None
    cutouts = []
    for index, record in enumerate(metadata['sprites']):
        if record.get('id') != metadata['order'][index] or record.get('cell', index) != index:
            raise ValueError(f'{folder}: identity or source cell order changed')
        if not record.get('id'):
            cutouts.append(None)
            cell = Image.new('RGBA', (256, 256))
        else:
            cutout, registration = registered_cutout(source, record, metadata, policy, index)
            cutouts.append((cutout, registration))
            cell, _ = render_cell(cutout, registration, 256)
        x, y = index % columns * 256, index // columns * 256
        if cell.tobytes() != master.crop((x, y, x + 256, y + 256)).tobytes():
            raise ValueError(f'{folder}: original source cannot reconstruct the 256px registration in cell {index}')
    source_limits = {
        'originalSource': metadata['source'], 'originalSourceSha256': metadata['sourceSha256'],
        'originalSheetPixels': list(source.size),
        'registeredSourceCellPixels': sorted({tuple(entry[1]['originalCellPixels']) for entry in cutouts if entry}),
        'registrationVerification': 'Exact RGBA pixel reconstruction of every published 256px master cell',
        'historicalAtlasSha256': original_hashes,
        'noAdditionalPaintedDetail': True,
        'resolutionNote': 'Display cell sizes include transparent framing. Enlarging original pixels retains existing detail and does not create additional painted detail.',
    }
    # JSON round-trip gives the comparison and serialized form identical arrays.
    source_limits = json.loads(json.dumps(source_limits))
    if fallback_sources:
        source_limits['fallbackDirectionalSources'] = fallback_sources
    exports = []
    for size in policy['levels']:
        atlas = Image.new('RGBA', (columns * size, rows * size))
        details = []
        for index, entry in enumerate(cutouts):
            if entry is None:
                continue
            cell, registration = render_cell(*entry, size)
            atlas.paste(cell, (index % columns * size, index // columns * size))
            details.append(registration)
        output = folder / f'atlas-{size}.png'
        record = {
            'source': metadata['source'], 'sourceSha256': metadata['sourceSha256'],
            'operation': 'Independent original-cutout premultiplied-alpha Lanczos; unchanged historical scale and anchor; no sharpening or recoloring',
            'tool': Path(__file__).name, 'sprites': details,
        }
        if verify:
            if Image.open(output).convert('RGBA').tobytes() != atlas.tobytes():
                raise ValueError(f'{output}: pixels differ from the original-source export')
            record['atlasSha256'] = digest(output)
            if metadata.get('highDensityCells', {}).get(str(size)) != record or size not in metadata['cellSizes']:
                raise ValueError(f'{metadata_path}: missing or inaccurate density provenance for {size}')
        else:
            if size == 256 and output.exists() and Image.open(output).convert('RGBA').tobytes() != atlas.tobytes():
                raise ValueError(f'{output}: cannot replace a differing historical density')
            if not output.exists() or size != 256:
                house.save_png(atlas, output)
            record['atlasSha256'] = digest(output)
            metadata['cellSizes'] = sorted(set(metadata['cellSizes']) | {size})
            metadata.setdefault('highDensityCells', {})[str(size)] = record
        exports.append({'cell': size, 'bytes': output.stat().st_size,
                        'enlargedOriginalCutouts': sum(entry['enlargesOriginalPixels'] for entry in details)})
    if verify:
        if metadata.get('sourceDetailLimits') != source_limits:
            raise ValueError(f'{metadata_path}: source-resolution limits no longer match the originals')
    else:
        metadata['sourceDetailLimits'] = source_limits
        metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    if any(digest(folder / name) != checksum for name, checksum in original_hashes.items()):
        raise ValueError(f'{folder}: an existing PNG changed during density export')
    return {'family': family, 'sourceCellPixels': source_limits['registeredSourceCellPixels'],
            'exports': exports, 'verified': verify}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('families', nargs='*', default=list(FAMILIES))
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    for family in args.families:
        print(json.dumps(build(ROOT / family, family, args.verify)))
