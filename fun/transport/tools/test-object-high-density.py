#!/usr/bin/env python3
"""Verify original detail, exact registration and transparent object exports.

Run: python3 tools/test-object-high-density.py
No browser, network, generated artwork or shipping-file mutation is needed.
"""
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('object_density', Path(__file__).with_name('build-object-high-density.py'))
density = importlib.util.module_from_spec(spec)
spec.loader.exec_module(density)


class SourceDensityTests(unittest.TestCase):
    def test_shipping_exports_reconstruct_originals_and_preserve_historical_pngs(self):
        for family in density.FAMILIES:
            with self.subTest(family=family):
                result = density.build(density.ROOT / family, family, verify=True)
                self.assertTrue(result['verified'])
                metadata = json.loads((density.ROOT / family / 'atlas.json').read_text())
                if density.renewal_packer(family, metadata):
                    self.assertTrue(result['noAdditionalPaintedDetail'])
                    self.assertIn('Exact original-source regeneration', result['registrationVerification'])
                    self.assertEqual(density.digest(density.ROOT / family / metadata['source']), metadata['sourceSha256'])
                    continue
                limits = metadata['sourceDetailLimits']
                self.assertTrue(limits['noAdditionalPaintedDetail'])
                for filename, checksum in limits['historicalAtlasSha256'].items():
                    self.assertEqual(density.digest(density.ROOT / family / filename), checksum)
                self.assertEqual(limits['originalSourceSha256'], metadata['sourceSha256'])

    def test_manifest_discloses_true_original_resolution_and_enlargement(self):
        expected_cells = {
            **{f'vehicle-{kind}-dimetric-v2': 640 for kind in ['bus', 'express-bus', 'truck', 'locomotive', 'coach', 'wagon']},
            'vehicle-ferry-dimetric-v2': 418, 'vehicle-cargo-ship-dimetric-v2': 418,
            'vehicle-tanker-dimetric-v2': 418, 'vehicles-dimetric-v2': 256,
            'city-ground-v3': 640,
        }
        for family, original_cell in expected_cells.items():
            with self.subTest(family=family):
                metadata = json.loads((density.ROOT / family / 'atlas.json').read_text())
                self.assertEqual(metadata['sourceDetailLimits']['registeredSourceCellPixels'], [[original_cell, original_cell]])
                for size in density.FAMILIES[family]['levels']:
                    for entry in metadata['highDensityCells'][str(size)]['sprites']:
                        crop_w, crop_h = entry['sourceCropPixels']
                        draw_w, draw_h = entry['drawPixels']
                        self.assertEqual(entry['sourcePixelScale'], [draw_w / crop_w, draw_h / crop_h])
                        self.assertEqual(entry['enlargesOriginalPixels'], draw_w > crop_w or draw_h > crop_h)
                        self.assertAlmostEqual(entry['nativeEquivalentCellPixels'],
                            min(256 * crop_w / entry['masterDrawPixels'][0], 256 * crop_h / entry['masterDrawPixels'][1]))
                        self.assertEqual(entry['drawPixels'], [value * size / 256 for value in entry['masterDrawPixels']])
                        self.assertEqual(entry['offsetPixels'], [value * size / 256 for value in entry['masterOffsetPixels']])
                if family.startswith('vehicle-'):
                    self.assertTrue(all(not entry['enlargesOriginalPixels'] for entry in metadata['highDensityCells']['256']['sprites']))

    def test_renewed_sources_disclose_observed_crops_and_real_enlargement(self):
        for family in ('nature-mountains', 'nature-rocks', 'isometric-infrastructure-v2'):
            with self.subTest(family=family):
                folder = density.ROOT / family
                metadata = json.loads((folder / 'atlas.json').read_text())
                with Image.open(folder / metadata['source']) as source:
                    width, height = source.size
                for size in density.FAMILIES[family]['levels']:
                    for record, entry in zip(metadata['sprites'], density.renewed_cell_details(metadata, size)):
                        left, top, right, bottom = record['sourceBounds']
                        self.assertTrue(0 <= left < right <= width and 0 <= top < bottom <= height)
                        self.assertEqual(entry['sourceCropPixels'], [right-left, bottom-top])
                        self.assertEqual(entry['enlargesOriginalPixels'], any(value > 1 for value in entry['sourcePixelScale']))
                        if family.startswith('nature-'):
                            self.assertEqual(record['normalization']['originalSize'], [width, height])
                            self.assertEqual(record['sourceCropPixels'], entry['sourceCropPixels'])
                            factor = record['sourceScaleToMaster'] * size / 256
                            self.assertEqual(entry['drawPixels'], [round(value*factor) for value in entry['sourceCropPixels']])
                            self.assertEqual(entry['sourcePixelScale'], [entry['drawPixels'][i]/entry['sourceCropPixels'][i] for i in range(2)])
                            self.assertEqual(entry['offsetPixels'], [round(value*size/256) for value in record['masterOffsetPixels']])
                            self.assertAlmostEqual(entry['nativeEquivalentCellPixels'], 256/record['sourceScaleToMaster'])
                            if size == 1024:
                                self.assertTrue(entry['enlargesOriginalPixels'], 'large display frames must disclose enlargement of these original crops')
                        else:
                            extent = metadata['worldFramePixels']*record['sourcePixelsPerWorldPixel']
                            self.assertEqual(entry['originalSamplingWindowPixels'], [extent, extent])
                            self.assertEqual(entry['sourcePixelScale'], [size/extent, size/extent])
                            self.assertEqual(entry['nativeEquivalentCellPixels'], extent)

    def test_renewed_registration_and_source_changes_are_rejected_without_writing(self):
        for family in ('nature-mountains', 'isometric-infrastructure-v2'):
            with self.subTest(family=family), tempfile.TemporaryDirectory() as directory:
                original = density.ROOT / family
                folder = Path(directory) / family
                shutil.copytree(original, folder)
                metadata_path = folder / 'atlas.json'
                metadata = json.loads(metadata_path.read_text())
                source = folder / metadata['source']
                source.write_bytes(source.read_bytes() + b'changed source')
                with self.assertRaisesRegex(ValueError, 'original source hash'):
                    density.build(folder, verify=True)
                shutil.copyfile(original / metadata['source'], source)
                if family.startswith('nature-'):
                    metadata['sprites'][0]['sourceScaleToMaster'] *= 1.01
                else:
                    metadata['sprites'][0]['groundCenterMaster'][1] += 1
                metadata_path.write_text(json.dumps(metadata))
                before = {path.relative_to(folder): density.digest(path) for path in folder.rglob('*') if path.is_file()}
                with self.assertRaisesRegex(ValueError, 'renewed source registration'):
                    density.build(folder, verify=True)
                self.assertEqual(before, {path.relative_to(folder): density.digest(path) for path in folder.rglob('*') if path.is_file()})

    def test_renewed_low_mips_cells_and_high_density_are_exact_regenerations(self):
        with tempfile.TemporaryDirectory() as directory:
            family = 'nature-rocks'
            original = density.ROOT / family
            folder = Path(directory) / family
            shutil.copytree(original, folder)
            metadata = json.loads((folder / 'atlas.json').read_text())
            paths = ['atlas-32.png', 'atlas-1024.png', f'sources/{metadata["order"][0].replace(":", "_")}.png']
            for name in paths:
                with self.subTest(file=name):
                    target = folder / name
                    target.write_bytes(target.read_bytes() + b'changed regenerated file')
                    with self.assertRaisesRegex(ValueError, 'PNG differs from the renewed original-source export'):
                        density.build(folder, verify=True)
                    shutil.copyfile(original / name, target)
            target = folder / 'atlas-1024.png'
            target.write_bytes(target.read_bytes() + b'changed export')
            metadata_before = (folder / 'atlas.json').read_bytes()
            result = density.build(folder)
            self.assertFalse(result['verified'])
            self.assertEqual(density.digest(target), density.digest(original / target.name))
            self.assertEqual((folder / 'atlas.json').read_bytes(), metadata_before)

    def test_original_high_frequency_detail_survives_without_changing_scale(self):
        source = Image.new('RGBA', (640, 640))
        draw = ImageDraw.Draw(source)
        draw.rectangle((22, 32, 617, 427), fill=(30, 70, 100, 255))
        for x in range(24, 617, 3):
            draw.line((x, 32, x, 427), fill=(220, 180, 30, 255))
        record = {'id': 'fixture', 'sourceBounds': [0, 0, 640, 640],
                  'normalization': {'sourceBounds': [20, 30, 620, 430], 'originalSize': [640, 640]}}
        cutout, registration = density.registered_cutout(source, record, {'columns': 1, 'rows': 1}, {'anchor': 'bottom'}, 0)
        master, master_geometry = density.render_cell(cutout, registration, 256)
        dense, geometry = density.render_cell(cutout, registration, 512)
        enlarged_master = density.house.resize_alpha(master, (512, 512))
        self.assertNotEqual(dense.tobytes(), enlarged_master.tobytes(), 'resizing the old master discards original high-frequency information')
        self.assertEqual(geometry['drawPixels'], [464, 310])
        self.assertEqual(geometry['offsetPixels'], [24, 178])
        self.assertEqual(geometry['offsetPixels'][1] + geometry['drawPixels'][1], 488,
                         'the source registration retains the 244/256 ground anchor')
        self.assertEqual(geometry['sourceToCellAffine'], [464 / 600, 0, 0, 310 / 400, 24 - 20 * 464 / 600, 178 - 30 * 310 / 400])
        self.assertEqual(master_geometry['offsetPixels'], [12, 89])
        self.assertFalse(geometry['enlargesOriginalPixels'])

    def test_premultiplied_original_sampling_does_not_bleed_hidden_rgb(self):
        source = Image.new('RGBA', (512, 512), (255, 0, 0, 0))
        ImageDraw.Draw(source).ellipse((82, 93, 441, 419), fill=(60, 120, 180, 255))
        clean_source = Image.new('RGBA', (512, 512))
        ImageDraw.Draw(clean_source).ellipse((82, 93, 441, 419), fill=(60, 120, 180, 255))
        registration = {'id': 'edge-fixture', 'cell': 0, 'originalCellPixels': [512, 512],
                        'sourceCellBoundsSheet': [0, 0, 512, 512], 'sourceCropBoundsCell': [0, 0, 512, 512],
                        'sourceCropPixels': [512, 512], 'masterDrawPixels': [232, 232],
                        'masterOffsetPixels': [12, 12], 'nativeEquivalentCellPixels': 256 * 512 / 232}
        for size in [256, 512, 1024]:
            cell, _ = density.render_cell(source, registration, size)
            reference, _ = density.render_cell(clean_source, registration, size)
            self.assertEqual(cell.tobytes(), reference.tobytes(),
                             f'{size}: hidden background RGB must have no effect on the sampled output')
            flattened = getattr(cell, 'get_flattened_data', cell.getdata)
            pixels = list(flattened())
            edges = [pixel for pixel in pixels if 16 < pixel[3] < 240]
            self.assertTrue(edges, f'{size}: fixture must exercise partially transparent edges')
            self.assertTrue(all(pixel[0] < pixel[1] < pixel[2] for pixel in edges),
                            f'{size}: invisible red pixels must not contaminate blue edge colors')
            # Lanczos can retain a few blue RGB values where alpha rounds to
            # zero. Those invisible values are harmless; the hidden red source
            # matte must not survive or bleed into a subsequent composite.
            self.assertTrue(all(pixel[0] <= pixel[2] for pixel in pixels if pixel[3] == 0))

    def test_rejects_source_and_historical_density_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'vehicle-cargo-ship-dimetric-v2'
            shutil.copytree(density.ROOT / folder.name, folder)
            metadata = json.loads((folder / 'atlas.json').read_text())
            source = folder / metadata['source']
            source.write_bytes(source.read_bytes() + b'not the registered original')
            before = hashlib.sha256((folder / 'atlas.json').read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'original source hash'):
                density.build(folder, verify=True)
            self.assertEqual(before, hashlib.sha256((folder / 'atlas.json').read_bytes()).hexdigest())
            shutil.copyfile(density.ROOT / folder.name / metadata['source'], source)
            old_lod = folder / 'atlas-32.png'
            old_lod.write_bytes(old_lod.read_bytes() + b'changed historical file')
            with self.assertRaisesRegex(ValueError, 'historical atlas changed'):
                density.build(folder, verify=True)

    def test_rejects_registration_drift_and_unsupported_fits(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'vehicle-cargo-ship-dimetric-v2'
            shutil.copytree(density.ROOT / folder.name, folder)
            metadata = json.loads((folder / 'atlas.json').read_text())
            metadata['sharedScale'] *= 1.05
            (folder / 'atlas.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, 'cannot reconstruct the 256px registration'):
                density.build(folder, verify=True)
            with self.assertRaisesRegex(ValueError, 'Unsupported registered family'):
                density.build(folder, family='unknown-auto-fit', verify=True)


if __name__ == '__main__':
    unittest.main()
