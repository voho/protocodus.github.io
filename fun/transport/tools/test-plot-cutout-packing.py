#!/usr/bin/env python3
"""Reproducible pixel/geometry regressions for registered architectural packing.

Run: python3 tools/test-plot-cutout-packing.py
Requires the asset pipeline's existing Pillow dependency and Node for reading
its canonical scale contract. Synthetic sources test packing, never replace art.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import math
import subprocess
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

TOOLS=Path(__file__).resolve().parent
CONTRACT=TOOLS.parent/'sprite-art-direction.js'
spec=importlib.util.spec_from_file_location('plot_packer',TOOLS/'pack-plot-cutouts.py')
packer=importlib.util.module_from_spec(spec);spec.loader.exec_module(packer)


def shared_contract():
    script=f"import{{SPRITE_SCALE,BUILDING_REGISTRATION}}from{json.dumps(CONTRACT.as_uri())};process.stdout.write(JSON.stringify({{scale:SPRITE_SCALE,registration:BUILDING_REGISTRATION}}));"
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',script],text=True))


class PlotCutoutPackingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.contract=shared_contract()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='transport-plot-packing-')
        self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)

    def job(self,footprints=(2,),columns=1,rows=2):
        entries=[{'id':f'fixture:{index}','kind':f'fixture-{index}','footprint':footprint,
                  'runtimeIds':[f'fixture:{index}'],'eligibleBiomes':['taiga']} for index,footprint in enumerate(footprints)]
        while len(entries)<columns*rows:entries.append(None)
        job={**self.contract,'id':'packing-fixture','type':'city','columns':columns,'rows':rows,'entries':entries,'reference':'measured synthetic fixture'}
        path=self.root/'job.json';path.write_text(json.dumps(job));return job,path

    def spill_fixture(self,common_scale=.5,visible_edges=False):
        job,path=self.job();expected=packer.expected_points(job,2)
        center=[256,500 if common_scale==.5 else 400]
        vertices=[[center[axis]+(point[axis]-expected['groundCenterMaster'][axis])/common_scale for axis in (0,1)] for point in expected['groundEnvelopeMaster']]
        image=Image.new('RGBA',(512,1024));draw=ImageDraw.Draw(image)
        draw.line([tuple(point) for point in vertices]+[tuple(vertices[0])],fill=(101,117,77,255),width=2)
        draw.rectangle((168,center[1]-104,332,center[1]),fill=(195,176,143,255))
        door_height=round(expected['personnelDoorMasterPixels']/common_scale)
        draw.rectangle((220,center[1]-door_height,228,center[1]-1),fill=(45,55,64,255))
        source=self.root/'source.png'
        crop=[0,300,512,650] if common_scale==.5 else[0,250,512,540]
        if common_scale==.5:
            # One clipped and one unowned alpha1/2 encoding speck must be counted.
            image.putpixel((10,648),(4,5,3,2));image.putpixel((2,900),(8,5,8,1))
        image.save(source)
        measurement={'id':job['entries'][0]['id'],'sourceBoundsSheet':crop,
                     'personnelDoorEndpointsSource':[[224,center[1]],[224,center[1]-door_height]]}
        if visible_edges:
            measurement.update(visibleOppositeGroundVerticesSource=[vertices[1],vertices[3]],
                               visibleGroundEdgesSource=[[vertices[0],vertices[1]],[vertices[1],vertices[2]]])
        else:measurement.update(groundCenterSource=center,groundVerticesSource=vertices)
        measurements=self.root/'measurements.json';measurements.write_text(json.dumps({'entries':[measurement]}))
        return job,path,image,source,measurement,measurements,expected

    def metadata(self,folder='out'):return json.loads((self.root/folder/'atlas.json').read_text())

    def test_reviewed_uniform_registration_offset_preserves_physical_features_and_pixels(self):
        job,path,image,source,measurement,measurements,expected=self.spill_fixture()
        packer.pack(source,path,self.root/'baseline',measurements=measurements,register_ground=True)
        packer.pack(source,path,self.root/'out',measurements=measurements,register_ground=True,
                    sheet_offset_y=-1,registration_note='One uniform pixel of filtering clearance; actual observed centre reported separately')
        baseline=self.metadata('baseline');meta=self.metadata();record=meta['sprites'][0]
        self.assertTrue(meta['physicalCalibration']['measuredGeometryVerified'])
        self.assertEqual(record['measuredGeometry']['groundCenterMasterMeasured'],[128,191])
        self.assertEqual(record['measuredGeometry']['groundCenterErrorMasterPixels'],1)
        self.assertEqual(record['measuredGeometry']['personnelDoorHeightMasterMeasured'],baseline['sprites'][0]['measuredGeometry']['personnelDoorHeightMasterMeasured'])
        self.assertEqual(record['originalMeasurements'],measurement)
        self.assertEqual(meta['sourceSha256'],baseline['sourceSha256'])
        self.assertEqual(record['registrationPlan']['wholeSheetRegistrationOffsetMaster'],[0,-1])
        original=Image.open(self.root/'baseline/atlas-512.png').convert('RGBA')
        shifted=Image.new('RGBA',original.size);shifted.paste(original,(0,-2))
        actual=Image.open(self.root/'out/atlas-512.png').convert('RGBA')
        self.assertEqual(shifted.tobytes(),actual.tobytes())
        for options in ({'sheet_offset_y':-1},{'sheet_offset_y':4,'registration_note':'out of bounds'}):
            with self.assertRaises(ValueError):
                packer.pack(source,path,self.root/'invalid',measurements=measurements,register_ground=True,**options)

    def test_registered_crop_restores_spill_and_preserves_observed_geometry(self):
        job,path,image,source,measurement,measurements,expected=self.spill_fixture()
        packer.pack(source,path,self.root/'out',measurements=measurements,register_ground=True)
        meta=self.metadata();record=meta['sprites'][0];plan=record['registrationPlan']
        self.assertTrue(meta['physicalCalibration']['measuredGeometryVerified'])
        self.assertEqual(plan['sourceSheetToMasterAffine'],[.5,0,0.,0,.5,-58.])
        self.assertEqual(plan['sourceCropToMasterAffine'],[.5,0,0.,0,.5,92.])
        self.assertEqual(record['sourceBoundsSheet'],measurement['sourceBoundsSheet'])
        self.assertEqual(record['measuredGeometry']['groundCenterMasterMeasured'],[128,192])
        self.assertLess(record['measuredGeometry']['groundSlopeMaximumAbsoluteError'],1e-12)
        self.assertLess(record['measuredGeometry']['personnelDoorHeightRelativeError'],.01)
        self.assertEqual(record['sourceAlpha']['meaningfulPixels'],sum(image.getchannel('A').histogram()[9:]))
        #512px output has1:1 source density: compare actual alpha against direct
        #sheet placement, independently of the packer's affine resampler.
        expected_pixels=Image.new('RGBA',(512,512));expected_pixels.paste(image,(0,-116))
        packed=Image.open(self.root/'out/atlas-512.png').crop((0,0,512,512))
        self.assertEqual(packed.getchannel('A').tobytes(),expected_pixels.getchannel('A').tobytes())
        # Observe the delivered doorway pixels, rather than accepting metadata.
        dark=[y for y in range(320,400) if packed.getpixel((224,y))[:3]==(45,55,64)]
        self.assertEqual(len(dark),15)
        self.assertEqual((min(dark),max(dark)),(369,383))
        self.assertGreaterEqual(record['masterAlpha']['minimumFilteringGutterPixels'],2)
        self.assertEqual(Image.open(self.root/'out/atlas.png').crop((0,256,256,512)).getchannel('A').getextrema(),(0,0))

    def test_weak_alpha_noise_is_quantified_and_source_hash_preserved(self):
        _,path,image,source,_,measurements,_=self.spill_fixture()
        packer.pack(source,path,self.root/'out',measurements=measurements,register_ground=True)
        meta=self.metadata();clip=meta['sprites'][0]['registrationPlan']['clipping']
        self.assertEqual((clip['clippedSourcePixels'],clip['clippedSourceAlphaEnergy']),(1,2))
        self.assertEqual(clip['clippedNonNoiseSourcePixels'],0)
        omitted=meta['physicalCalibration']['sourceIsolationNoise']
        self.assertEqual((omitted['omittedSourcePixels'],omitted['omittedSourceAlphaEnergy']),(1,1))
        self.assertEqual((self.root/'out/generated-source.png').read_bytes(),source.read_bytes())
        self.assertEqual(meta['sourceSha256'],hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(meta['originalMeasurements'],json.loads(measurements.read_text()))
        self.assertEqual(meta['measurementsSha256'],hashlib.sha256(measurements.read_bytes()).hexdigest())

    def test_visible_actual_edges_and_centre_need_no_hidden_corner(self):
        _,path,_,source,measurement,measurements,expected=self.spill_fixture(visible_edges=True)
        packer.pack(source,path,self.root/'out',measurements=measurements,register_ground=True)
        measured=self.metadata()['sprites'][0]['measuredGeometry']
        self.assertEqual(measured['status'],'measured');self.assertTrue(measured['bothGroundAxesObserved'])
        alternative=dict(measurement);alternative['groundEdgeSegmentsSource']=alternative.pop('visibleGroundEdgesSource')
        self.assertEqual(packer.measured_geometry(alternative,expected,.5,[0,-58])['status'],'measured')
        no_door=dict(alternative,personnelDoorObservable=False);no_door.pop('personnelDoorEndpointsSource')
        self.assertEqual(packer.measured_geometry(no_door,expected,.5,[0,-58])['status'],'measured')
        one_axis=dict(alternative,groundEdgeSegmentsSource=[alternative['groundEdgeSegmentsSource'][0]]*2)
        self.assertEqual(packer.measured_geometry(one_axis,expected,.5,[0,-58])['status'],'measured-outside-contract')

    def test_whole_sheet_density_requires_actual_physical_edge_evidence(self):
        job,path,_,source,measurement,measurements,expected=self.spill_fixture(.45,True)
        evidence={'observations':[{'sourceEdgeEndpoints':measurement['visibleGroundEdgesSource'][0],
                  'physicalSpanMetres':30,'footprint':2,'note':'Observed30m physical fence axis'}]}
        measurements.write_text(json.dumps({'entries':[measurement],'sheetScaleCalibration':evidence}))
        packer.pack(source,path,self.root/'out',measurements=measurements,register_ground=True,sheet_scale=.45)
        meta=self.metadata();self.assertTrue(meta['physicalCalibration']['measuredGeometryVerified'])
        self.assertEqual(meta['physicalCalibration']['sourceToMasterScale'],.45)
        self.assertLess(meta['sheetScaleCalibration']['observations'][0]['requestedScaleRelativeError'],1e-12)
        self.assertEqual(meta['outputs']['512']['sourceToLevelScale'],.9)
        self.assertFalse(meta['outputs']['512']['upsampledFromGeneratedSource'])
        for invalid in [None,{}, {'observations':[dict(evidence['observations'][0],physicalSpanMetres=10)]},
                        {'observations':[dict(evidence['observations'][0],note='')]}]:
            with self.subTest(evidence=invalid),self.assertRaises(ValueError):
                packer.calibrated_sheet_scale(.45,invalid,job,.5,(512,1024))
        with self.assertRaises(ValueError):packer.pack(source,path,self.root/'invalid-scale',sheet_scale=.45)

    def test_six_lods_premultiply_original_pixels_without_colour_halo(self):
        job,path=self.job(footprints=(1,),columns=1,rows=1)
        source=self.root/'lod-source.png';image=Image.new('RGBA',(256,256),(255,0,255,0))
        draw=ImageDraw.Draw(image);draw.rectangle((80,80,175,175),fill=(50,100,150,255));image.save(source)
        packer.pack(source,path,self.root/'out')
        meta=self.metadata();self.assertEqual(meta['cellSizes'],[16,32,64,128,256,512])
        self.assertEqual(meta['originalSourceResolution']['squareCellPixels'],256)
        self.assertTrue(meta['outputs']['512']['upsampledFromGeneratedSource'])
        self.assertEqual(Image.open(self.root/'out/atlas.png').tobytes(),image.tobytes())
        for level in (16,32,64,128,512):
            mip=Image.open(self.root/f'out/atlas-{level}.png')
            visible=[pixel for pixel in zip(*[iter(mip.tobytes())]*4) if pixel[3]>64]
            self.assertTrue(visible)
            # Hostile magenta RGB under zero alpha cannot pollute visible edges.
            self.assertTrue(all(abs(pixel[1]-2*pixel[0])<=4 and abs(pixel[2]-3*pixel[0])<=4 for pixel in visible))
        hashes={path.name:packer.digest(path) for path in (self.root/'out').glob('atlas*.png')}
        packer.pack(source,path,self.root/'out')
        self.assertEqual(hashes,{path.name:packer.digest(path) for path in (self.root/'out').glob('atlas*.png')})

    def test_actual_door_pixels_keep_common_world_height_across_footprint_tiers(self):
        job,path=self.job((1,2,5),3,1);source=self.root/'tier-source.png'
        image=Image.new('RGBA',(1536,512));draw=ImageDraw.Draw(image)
        for index,entry in enumerate(job['entries']):
            expected=packer.expected_points(job,entry['footprint']);height=round(expected['personnelDoorMasterPixels']*2)
            x=index*512
            draw.rectangle((x+180,250,x+330,383),fill=(195,176,143,255))
            draw.rectangle((x+220,384-height,x+228,383),fill=(45,55,64,255))
        image.save(source);packer.pack(source,path,self.root/'out')
        packed=Image.open(self.root/'out/atlas-512.png')
        measured_world_heights=[]
        for index,entry in enumerate(job['entries']):
            door_pixels=sum(packed.getpixel((index*512+224,y))[:3]==(45,55,64) for y in range(300,400))
            world_pixels=door_pixels*job['scale']['billboardPixelsPerTile']*entry['footprint']/512
            measured_world_heights.append(world_pixels)
            self.assertLess(abs(world_pixels-job['scale']['doorHeightMetres']*job['scale']['worldPixelsPerMetre']),.03)
        self.assertLess(max(measured_world_heights)-min(measured_world_heights),.01)

    def test_invalid_landmarks_crop_clipping_overlap_and_background_reject(self):
        job,path,image,source,measurement,measurements,_=self.spill_fixture()
        mutations=[dict(measurement,groundCenterSource=[256,950]),dict(measurement,sourceBoundsSheet=[0,300,512,512]),
                   {'id':measurement['id'],'sourceBoundsSheet':measurement['sourceBoundsSheet']}]
        for index,altered in enumerate(mutations):
            measurements.write_text(json.dumps({'entries':[altered]}))
            with self.subTest(case=index),self.assertRaises(ValueError):
                packer.pack(source,path,self.root/f'invalid-{index}',measurements=measurements,register_ground=True)
        # Cropping away an entire opaque portion cannot pass the globalretention check.
        measurements.write_text(json.dumps({'entries':[measurement]}));rogue=image.copy()
        rogue.putpixel((12,800),(80,90,70,255));rogue_path=self.root/'rogue.png';rogue.save(rogue_path)
        with self.assertRaises(ValueError):packer.pack(rogue_path,path,self.root/'invalid-rogue',measurements=measurements,register_ground=True)
        image.convert('RGB').save(self.root/'flattened.png')
        with self.assertRaises(ValueError):packer.pack(self.root/'flattened.png',path,self.root/'invalid-background')
        Image.new('RGBA',(512,768)).save(self.root/'wrong-grid.png')
        with self.assertRaises(ValueError):packer.pack(self.root/'wrong-grid.png',path,self.root/'invalid-grid')
        # Another entry claiming the same occupied source pixels is rejected.
        overlap_job=dict(job,entries=[job['entries'][0],dict(job['entries'][0],id='fixture:second',kind='fixture-second')])
        path.write_text(json.dumps(overlap_job))
        other=dict(measurement,id='fixture:second',groundCenterSource=[256,-12])
        measurements.write_text(json.dumps({'entries':[measurement,other]}))
        with self.assertRaises(ValueError):packer.pack(source,path,self.root/'invalid-overlap',measurements=measurements,register_ground=True)


if __name__=='__main__':unittest.main(verbosity=2)
