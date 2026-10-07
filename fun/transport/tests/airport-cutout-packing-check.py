"""Synthetic regressions for measured airport registration and alpha retention."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw

TOOL = Path(__file__).parents[1]/'tools'/'pack-airport-cutouts.py'
spec = importlib.util.spec_from_file_location('airport_packer', TOOL)
packer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packer)


class AirportPacking(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='transport-airport-packing-')
        self.root = Path(self.temporary.name)
        self.source = self.root/'source.png'
        self.job_path = self.root/'job.json'
        self.measurements_path = self.root/'measurements.json'
        self.output = self.root/'packed'
        # A deliberately fractional square grid: 73.5 source pixels per cell.
        # Hidden red RGB must never bleed through the transparent ground.
        self.image = Image.new('RGBA', (294, 147), (255, 0, 0, 0))
        draw = ImageDraw.Draw(self.image)
        entries, measured, observations = [], [], []
        for index in range(8):
            kind = ('tower', 'terminal', 'hangar', 'depot')[index % 4]
            axis = 'xy'[index//4]
            x0, y0 = index % 4*73.5, index//4*73.5
            cx, cy = x0+36.25, y0+58.25
            width = 14+index % 4*6
            height = 42 if kind == 'tower' else 18
            left, top = int(cx-width/2), int(cy-height)
            draw.rectangle((left, top, left+width-1, int(cy)+3), fill=(0, 180, 0, 255))
            draw.line((left, top, left+width-1, top), fill=(0, 180, 0, 100))
            # Alpha 3 is meaningful, despite being almost invisible.
            draw.point((left-2, top+2), fill=(0, 180, 0, 3))
            identity = f'airport-building:{kind}:axis-{axis}'
            entries.append({'id': identity, 'kind': kind, 'axis': axis,
                            'localCenter': {'u': .3+index % 4, 'v': .46},
                            'physicalDimensions': {'widthMetres': width/2.5}})
            record = {'id': kind, 'rotation': index//4, 'groundCenterSheet': [cx, cy],
                      'groundEdgeSegmentsSheet': [[[cx-8, cy], [cx, cy+4]], [[cx, cy+4], [cx+8, cy]]],
                      'personnelDoorObservable': False, 'personnelDoorNotes': 'Synthetic shape has no personnel door'}
            if index == 1:
                record.update(personnelDoorObservable=True,
                              personnelDoorEndpointsSheet=[[cx, cy-5.25], [cx, cy]])
            measured.append(record)
            observations.append({'sourceEdgeEndpointsSheet': [[cx-width/2, cy], [cx+width/2, cy]],
                                 'physicalSpanWorldPixels': width/1.25,
                                 'note': 'Known synthetic base width, independent of alpha bounds'})
        self.image.save(self.source)
        self.job = {'id': 'airport-buildings-v2', 'columns': 4, 'rows': 2,
                    'cellPixels': 384, 'sourcePixelsPerWorldPixel': 4,
                    'componentFrame': {'worldPixels': 96, 'groundCenterCell': [192, 304]},
                    'entries': entries, 'destination': str(self.output), 'prompt': 'Synthetic registration fixture'}
        self.measurements = {'sourceDimensions': [294, 147], 'sourcePixelsPerWorldPixel': 1.25,
                             'densityCalibration': {'observations': observations}, 'entries': measured}
        self.write_inputs()

    def tearDown(self):
        self.temporary.cleanup()

    def write_inputs(self):
        self.job_path.write_text(json.dumps(self.job))
        self.measurements_path.write_text(json.dumps(self.measurements))

    def pack(self):
        self.write_inputs()
        return packer.pack(self.source, self.job_path, self.measurements_path)

    def test_fractional_grid_has_one_scale_exact_pixel_ownership_and_ground_registration(self):
        metadata = self.pack()
        self.assertEqual(metadata['sourceCellPixels'], 73.5)
        self.assertEqual(metadata['sourcePixelsPerWorldPixel'], 1.25)
        self.assertEqual(metadata['generationRequestedSourcePixelsPerWorldPixel'], 4)
        self.assertEqual(metadata['groundCenterWorld'], [48, 76])
        total_source = sum(self.image.getchannel('A').histogram()[3:])
        self.assertEqual(sum(e['meaningfulSourcePixels'] for e in metadata['entries']), total_source)
        for entry in metadata['entries']:
            self.assertEqual(entry['sourceToWorldScale'], .8)
            self.assertEqual(entry['geometry']['groundCenterWorldMeasured'], [48, 76])
            self.assertEqual(entry['clippedMeaningfulSourcePixels'], 0)
            self.assertGreaterEqual(entry['minimum512FilteringGutterPixels'], 2)
            for axis in (0, 1):
                measured_world = entry['groundCenterSheet'][axis]*entry['sourceToWorldScale']+entry['translationWorldFromSheet'][axis]
                self.assertAlmostEqual(measured_world, [48, 76][axis])
            local = entry['meaningfulAlphaBoundsWorldRelativeToGroundCentre']
            projected = entry['projectedCentreRelativeToAirportAnchor']
            expected = [local[i]+projected[i % 2] for i in range(4)]
            self.assertEqual(entry['airportAnchorAlphaBoundsWorld'], expected)
        self.assertAlmostEqual(metadata['entries'][1]['geometry']['personnelDoorHeightMetresMeasured'], 2.1)
        self.assertIsNone(metadata['entries'][0]['geometry']['personnelDoorHeightMetresMeasured'])
        self.assertEqual((self.output/'generated-source.png').read_bytes(), self.source.read_bytes())

    def test_each_level_samples_original_fractional_registration_and_has_no_hidden_rgb_halo(self):
        metadata = self.pack()
        for level in packer.LEVELS:
            atlas = Image.open(self.output/f'airport-buildings-{level}.png')
            self.assertEqual(atlas.size, (level*4, level*2))
            for index, entry in enumerate(metadata['entries']):
                bounds = entry['sourceBoundsSheet']
                raw = self.image.crop(tuple(bounds))
                box = [entry['physicalFrameBoundsSheet'][i]-bounds[i % 2] for i in range(4)]
                direct = packer.sample_original(raw, level, box)
                packed = atlas.crop((index % 4*level, index//4*level, (index % 4+1)*level, (index//4+1)*level))
                self.assertEqual(direct.tobytes(), packed.tobytes())
                self.assertEqual(packed.getchannel('R').getextrema(), (0, 0))
                self.assertEqual(packed.getchannel('B').getextrema(), (0, 0))
        master = Image.open(self.output/'airport-buildings-256.png')
        naive = master.convert('RGBa').resize((128*4, 128*2), Image.Resampling.LANCZOS).convert('RGBA')
        self.assertNotEqual(naive.tobytes(), Image.open(self.output/'airport-buildings-128.png').tobytes())

    def test_rejects_frame_clipping_instead_of_resizing_the_component(self):
        self.measurements['entries'][0]['groundCenterSheet'][0] += 120
        with self.assertRaisesRegex(ValueError, 'fixed physical frame'):
            self.pack()
        self.assertFalse(self.output.exists())

    def test_rejects_unowned_meaningful_pixel_and_overlapping_component(self):
        # A narrower ownership crop drops the first tower's alpha-3 landmark.
        self.measurements['entries'][0]['sourceBoundsSheet'] = [31, 0, 74, 74]
        with self.assertRaisesRegex(ValueError, 'no component ownership'):
            self.pack()
        self.measurements['entries'][0].pop('sourceBoundsSheet')
        self.measurements['entries'][1]['sourceBoundsSheet'] = [0, 0, 147, 74]
        with self.assertRaisesRegex(ValueError, 'overlapping component'):
            self.pack()

    def test_rejects_per_component_scale_missing_landmark_and_uncalibrated_density(self):
        original = copy.deepcopy(self.measurements)
        self.measurements['entries'][0]['sourcePixelsPerWorldPixel'] = 2
        with self.assertRaisesRegex(ValueError, 'Per-entry density'):
            self.pack()
        self.measurements = copy.deepcopy(original)
        self.measurements['entries'][0].pop('groundCenterSheet')
        with self.assertRaisesRegex(ValueError, 'groundCenterSheet'):
            self.pack()
        self.measurements = copy.deepcopy(original)
        self.measurements.pop('densityCalibration')
        with self.assertRaisesRegex(ValueError, 'calibration evidence'):
            self.pack()
        self.measurements = copy.deepcopy(original)
        self.measurements['sourcePixelsPerWorldPixel'] = 2
        with self.assertRaisesRegex(ValueError, 'pooled observed physical-span fit'):
            self.pack()

    def test_rejects_source_without_alpha_or_nonsquare_grid(self):
        self.image.convert('RGB').save(self.source)
        with self.assertRaisesRegex(ValueError, 'genuine alpha'):
            self.pack()
        Image.new('RGBA', (295, 147)).save(self.source)
        with self.assertRaisesRegex(ValueError, 'equal square cells'):
            self.pack()

    def test_cli_help_and_pack(self):
        help_result = subprocess.run([sys.executable, str(TOOL), '--help'], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertIn('measurements', help_result.stdout)
        result = subprocess.run([sys.executable, str(TOOL), str(self.source), str(self.job_path), str(self.measurements_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['clippedMeaningfulSourcePixels'], 0)


if __name__ == '__main__':
    unittest.main()
