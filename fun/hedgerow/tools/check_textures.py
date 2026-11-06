"""Validate the shipped texture contract, decoded bytes and rendering budget.

python3 fun/hedgerow/tools/check_textures.py [--json report.json]

Checks the actual WebP bytes (not just the generator): dimensions/channels,
normal hemisphere and length, height/normal agreement, plausible roughness,
periodic boundary statistics, download bytes and uncompressed mip memory.
Requires the same Pillow + NumPy dependencies as textures.py.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DETAIL = ('stone', 'plaster', 'brick', 'tile', 'slate', 'planks', 'bark', 'fabric', 'concrete', 'metal', 'rock', 'foliage')
GROUND = {'mud': (13.0, .54, .94), 'grass': (5.5, .76, .96),
          'forest': (6.0, .64, .97), 'cobble': (7.0, .46, .92)}


def boundary_ratio(a):
    """An edge need not equal its opposite pixel: they are adjacent samples.

    A valid periodic field has a boundary step comparable to its interior
    sample steps. Report X/Y separately so a single bad edge cannot hide.
    """
    a = a.astype(np.float32)
    out = []
    for axis in (1, 0):
        interior = np.diff(a, axis=axis)
        boundary = np.take(a, 0, axis=axis) - np.take(a, -1, axis=axis)
        out.append(float(np.sqrt(np.mean(boundary ** 2)) / max(np.sqrt(np.mean(interior ** 2)), .25)))
    return out


def check():
    maps = {}
    failures = []
    path = ROOT / 'assets' / 'textures'
    expected = set(DETAIL) | set(GROUND) | {k + '_n' for k in GROUND} | {'landscape'}
    files = {p.stem: p for p in path.glob('*.webp')}
    if set(files) != expected:
        failures.append(f'texture set changed: {sorted(set(files) ^ expected)}')
    arrays = {}
    for name in sorted(expected):
        p = files.get(name)
        if p is None:
            continue
        with Image.open(p) as im:
            size = 1024 if name.removesuffix('_n') in GROUND else 256 if name == 'landscape' else 512
            if im.size != (size, size) or im.mode != 'RGBA' or im.format != 'WEBP':
                failures.append(f'{name}: expected {size}² RGBA WebP, got {im.size} {im.mode} {im.format}')
            a = np.asarray(im.convert('RGBA')).copy()
        arrays[name] = a
        maps[name] = {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                      'width': a.shape[1], 'height': a.shape[0],
                      'alphaRange': [int(a[..., 3].min()), int(a[..., 3].max())]}
        if name not in GROUND and name != 'landscape':
            n = a[..., :3].astype(np.float32) / 127.5 - 1
            length = np.linalg.norm(n, axis=-1)
            maps[name]['normalLengthP01P99'] = np.percentile(length, [1, 99]).round(4).tolist()
            # Legacy model-detail maps are lossy WebP and the material shader
            # normalizes their vectors. The new ground vectors are lossless
            # linear data and have a tighter unit-length requirement below.
            if np.percentile(n[..., 2], .1) < .25 or np.percentile(length, 99.9) > 1.30 or np.percentile(length, .1) < .40:
                failures.append(f'{name}: invalid decoded tangent normal')
            if name.endswith('_n') and (np.percentile(length, 1) < .985 or np.percentile(length, 99) > 1.015):
                failures.append(f'{name}: linear vector encoding lost unit length')
    for name, (strength, rough_min, rough_max) in GROUND.items():
        if name not in arrays or name + '_n' not in arrays:
            continue
        a, b = arrays[name], arrays[name + '_n']
        height = a[..., 3].astype(np.float32) / 255
        n = b[..., :3].astype(np.float32) / 127.5 - 1
        n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-8)
        # Reconstruct from the shipped height, using the documented OpenGL
        # convention. An accidental DirectX green flip fails the angle test.
        dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .5
        dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * .5
        ref = np.stack((-dx * strength, -dy * strength, np.ones_like(dx)), axis=-1)
        ref /= np.linalg.norm(ref, axis=-1, keepdims=True)
        angle = np.degrees(np.arccos(np.clip(np.sum(n * ref, axis=-1), -1, 1)))
        rough = b[..., 3] / 255
        seams = {'albedo': boundary_ratio(a[..., :3]), 'height': boundary_ratio(a[..., 3]),
                 'normal': boundary_ratio(b[..., :3]), 'roughness': boundary_ratio(b[..., 3])}
        maps[name].update({'heightMean': round(float(height.mean()), 4),
                           'normalErrorDegreesP50P95P99': np.percentile(angle, [50, 95, 99]).round(3).tolist(),
                           'roughnessRange': [round(float(rough.min()), 4), round(float(rough.max()), 4)],
                           'boundaryStepRatiosXY': seams})
        if np.percentile(angle, 95) > 1.5 or np.percentile(angle, 99) > 2.0:
            failures.append(f'{name}: decoded normal disagrees with height (P95 {np.percentile(angle,95):.2f}°)')
        if rough.min() < rough_min or rough.max() > rough_max:
            failures.append(f'{name}: roughness outside {rough_min}..{rough_max}')
        if height.mean() < .30 or height.mean() > .76:
            failures.append(f'{name}: height biases terrain blending')
        if any(max(v) > 3.0 for v in seams.values()):
            failures.append(f'{name}: suspicious periodic boundary step')
    if 'landscape' in arrays:
        a = arrays['landscape'].astype(np.float32) / 255
        calibration_path = ROOT / 'tools' / 'texture-sources' / 'landscape-calibration.json'
        calibration = json.loads(calibration_path.read_text())
        channels = {}
        for i, key in enumerate(('R', 'G', 'B', 'A')):
            value = a[..., i]
            spec = calibration['channels'][key]
            quantiles = np.percentile(value, [1, 5, 50, 95, 99])
            channels[key] = {'meaning': spec['meaning'], 'mean': round(float(value.mean()), 5),
                             'std': round(float(value.std()), 5), 'P1P5P50P95P99': quantiles.round(5).tolist(),
                             'boundaryStepRatiosXY': boundary_ratio(arrays['landscape'][..., i]),
                             'suggestedWorldPeriodMetres': spec['suggestedWorldPeriodMetres']}
            if abs(value.mean() - spec['targetMean']) > .012 or abs(value.std() - spec['targetStd']) > .012:
                failures.append(f'landscape {key}: distribution no longer matches calibration')
            if max(channels[key]['boundaryStepRatiosXY']) > 2:
                failures.append(f'landscape {key}: suspicious periodic boundary')
        correlation = np.corrcoef(a.reshape(-1, 4), rowvar=False)
        if np.max(np.abs(correlation - np.eye(4))) > .11:
            failures.append('landscape fields have become correlated')
        maps['landscape'].update({'channels': channels, 'channelCorrelation': correlation.round(5).tolist(),
                                  'packing': 'linear RGBA scalar fields, six effective bits/channel, lossless WebP'})
    download = sum(p.stat().st_size for p in files.values())
    mip_bytes = 0
    for a in arrays.values():
        w, h = a.shape[1], a.shape[0]
        while True:
            mip_bytes += w * h * 4
            if w == h == 1:
                break
            w, h = max(w // 2, 1), max(h // 2, 1)
    source_receipt = ROOT / 'tools' / 'texture-sources' / 'provenance.json'
    if source_receipt.exists():
        receipt = json.loads(source_receipt.read_text())
        for name, spec in receipt['sources'].items():
            source = source_receipt.parent / spec['retainedFilename']
            prompt = source_receipt.parent / spec['promptFile']
            if not source.exists() or hashlib.sha256(source.read_bytes()).hexdigest() != spec['retainedSha256']:
                failures.append(f'{name}: retained source is missing or hash changed')
            else:
                with Image.open(source) as im:
                    if list(im.size) != spec['dimensions'] or im.mode != spec['channels']:
                        failures.append(f'{name}: retained source dimensions/channels changed')
            if not prompt.exists() or not prompt.read_text().strip():
                failures.append(f'{name}: generation prompt is missing')
            elif spec.get('promptSha256') != hashlib.sha256(prompt.read_bytes()).hexdigest():
                failures.append(f'{name}: generation prompt hash changed')
        for name, spec in receipt.get('proceduralFields', {}).items():
            calibration = source_receipt.parent / spec['calibrationFile']
            if not calibration.exists() or hashlib.sha256(calibration.read_bytes()).hexdigest() != spec['calibrationSha256']:
                failures.append(f'{name}: procedural calibration is missing or hash changed')
    else:
        failures.append('retained diffuse-source provenance is missing')
    if download > 8 * 1024 ** 2:
        failures.append(f'{download} download bytes exceeds 8 MiB')
    if mip_bytes > 59 * 1024 ** 2:
        failures.append(f'{mip_bytes} decoded mip bytes exceeds 59 MiB')
    return {'schema': 'hedgerow-texture-validation-v1', 'maps': maps,
            'budget': {'downloadBytes': download, 'downloadLimitBytes': 8 * 1024 ** 2,
                       'rgba8FullMipBytes': round(mip_bytes), 'rgba8FullMipLimitBytes': 59 * 1024 ** 2,
                       'textureCount': len(files)}, 'failures': failures}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    report = check()
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2) + '\n')
    for name in GROUND:
        m = report['maps'].get(name, {})
        print(f"{name:7} height={m.get('heightMean')} normal P95={m.get('normalErrorDegreesP50P95P99', [0,0])[1]}° roughness={m.get('roughnessRange')}")
    print(f"{report['budget']['textureCount']} maps, {report['budget']['downloadBytes']/1024**2:.2f} MiB download, {report['budget']['rgba8FullMipBytes']/1024**2:.2f} MiB RGBA8 mip budget")
    for failure in report['failures']:
        print('FAIL:', failure)
    raise SystemExit(bool(report['failures']))
