#!/usr/bin/env python3
"""Pack full registered plot cells without silhouette fitting or ground keying.

python3 tools/pack-plot-cutouts.py generated.png job.json [output] --qa-dir /tmp/qa

The source must have the job grid's aspect ratio and genuine RGBA transparency.
Every square source cell is resampled in full with premultiplied-alpha Lanczos;
no silhouette fitting, recolouring, matte removal, per-sprite scale, sharpening
or background replacement is performed. Optional --measurements JSON records observed ground
vertices, door endpoints and source ground centres for geometric validation.
Without observed measurements, reports explicitly leave physical review pending.
Ground-centre measurements produce a translation plan; --register-ground applies
only observed translations. Optional sourceBoundsSheet rectangles isolate complete
cutouts beyond their nominal cell without changing source pixel density. Every
meaningful alpha>8 pixel must be retained with a2px master filtering gutter;
only source alpha1/2 encoding noise may clip and its pixel count/energy is reported.
--sheet-scale changes the common density only with an observed physical-edge
calibration JSON or measurements.sheetScaleCalibration; no automatic fits.
All jobs emit 512px levels directly from original source cells; upsampled levels
are identified explicitly and do not imply additional generated source detail.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

MASTER = 256
BASE_LEVELS = (16, 32, 64, 128, 256, 512)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resize_alpha(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.copy() if image.size == size else image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def save_png(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format='PNG', optimize=False, compress_level=9)


def alpha_bounds(image: Image.Image, threshold=0):
    result = image.getchannel('A').point(lambda alpha: 255 if alpha > threshold else 0).getbbox()
    return list(result) if result else None


def alpha_metrics(image: Image.Image):
    alpha = image.getchannel('A')
    histogram = alpha.histogram()
    width, height = image.size
    bounds = alpha_bounds(image, 8)
    edges = [alpha.crop((0, 0, width, 1)), alpha.crop((0, height-1, width, height)),
             alpha.crop((0, 0, 1, height)), alpha.crop((width-1, 0, width, height))]
    return {'alphaBounds': alpha_bounds(image), 'meaningfulAlphaBounds': bounds,
            'transparentFraction': sum(histogram[:3]) / (width*height),
            'nontransparentPixels': sum(histogram[1:]), 'meaningfulPixels': sum(histogram[9:]),
            'fractionalAlphaPixels': sum(histogram[1:255]),
            'edgeMeaningfulFractions': [sum(edge.histogram()[9:])/(edge.width*edge.height) for edge in edges],
            'minimumFilteringGutterPixels': None if bounds is None else min(bounds[0], bounds[1], width-bounds[2], height-bounds[3])}


def expected_points(job, footprint, cell=MASTER):
    scale = job['scale']
    registration = job['registration']
    ppm = scale['worldPixelsPerMetre']*cell/(scale['billboardPixelsPerTile']*footprint)
    center = [value*cell/scale['masterCellPixels'] for value in registration['groundCenterMaster']]
    half = registration['architecturalEnvelopeMetresPerTile']*footprint/2
    vertices = [[center[0]+(east-north)*ppm, center[1]+(east+north)*ppm/2]
                for east,north in [(-half,-half),(half,-half),(half,half),(-half,half)]]
    return {'groundCenterMaster':center, 'groundEnvelopeMaster':vertices,
            'personnelDoorMasterPixels':scale['doorHeightMetres']*ppm,
            'personnelDoorMasterWidthPixels':scale['doorWidthMetres']*ppm,
            'storeyMasterPixels':scale['storeyHeightMetres']*ppm,
            'fenceMasterPixels':scale['fenceHeightMetres']*ppm,
            'loadingBayMasterPixels':scale['loadingBayHeightMetres']*ppm,
            'worldPixelsPerMasterPixel':scale['billboardPixelsPerTile']*footprint/cell}


def ground_alpha_metrics(image, vertices, center):
    """Report real alpha over the expected ground; do not infer bare lawn by hue."""
    mask=Image.new('L',image.size)
    ImageDraw.Draw(mask).polygon([tuple(point) for point in vertices],fill=255)
    alpha=image.getchannel('A')
    pixels=[value for value,inside in zip(alpha.tobytes(),mask.tobytes()) if inside]
    front=[alpha.getpixel((x,y)) for y in range(max(0,math.ceil(center[1])),image.height)
           for x in range(image.width) if mask.getpixel((x,y))]
    return {'envelopePixels':len(pixels),'envelopeZeroAlphaFraction':sum(value==0 for value in pixels)/len(pixels) if pixels else None,
            'frontGroundPixels':len(front),'frontGroundZeroAlphaFraction':sum(value==0 for value in front)/len(front) if front else None,
            'method':'Observed PNG alpha inside the canonical projected envelope; plants, walls and paving remain occupied. Bare-ground identity requires source review.'}


def measured_geometry(measurement, expected, source_scale, translation=(0, 0)):
    if not measurement:
        return {'status':'pending-source-review','groundEdgeSlopesMeasured':None,'personnelDoorHeightMasterMeasured':None,
                'reason':'A scale contract is not a measured camera or door. Review guide-comparison.png and record observed pixel endpoints.'}
    result={'status':'pending-source-review','measurement':measurement}
    vertices=measurement.get('groundVerticesSource')
    segments=measurement.get('groundEdgeSegmentsSource') or measurement.get('visibleGroundEdgesSource')
    if segments:
        if len(segments)<2 or any(len(segment)!=2 or any(len(point)!=2 or not all(isinstance(value,(int,float)) and math.isfinite(value) for value in point) for point in segment) for segment in segments):
            raise ValueError('Observed ground edges need at least two segments of finite[[x,y],[x,y]] endpoints')
        result['groundEdgeObservationMethod']='Actual visible ground-edge segments; hidden rear corner is not required'
        result['groundEdgeSegmentsMasterMeasured']=[[[point[axis]*source_scale+translation[axis] for axis in (0,1)] for point in segment] for segment in segments]
    elif vertices:
        if len(vertices)!=4:raise ValueError('groundVerticesSource needs four ordered projected ground corners')
        segments=list(zip(vertices,vertices[1:]+vertices[:1]))
        result['groundEdgeObservationMethod']='Four supplied ground-plane vertices'
        result['groundVerticesMasterMeasured']=[[point[axis]*source_scale+translation[axis] for axis in (0,1)] for point in vertices]
    if segments:
        slopes=[]
        for a,b in segments:
            dx=b[0]-a[0]
            if not dx:raise ValueError('Ground edge has vertical screen projection; expected camera slope+/-0.5')
            slopes.append((b[1]-a[1])/dx)
        result['groundEdgeSlopesMeasured']=slopes
        result['groundSlopeMaximumAbsoluteError']=max(abs(abs(value)-.5) for value in slopes)
        result['bothGroundAxesObserved']=any(value>0 for value in slopes) and any(value<0 for value in slopes)
    center,center_method=source_ground_center(measurement)
    if center:
        observed=[value*source_scale+translation[axis] for axis,value in enumerate(center)]
        result['groundCenterMethod']=center_method
        result['groundCenterMasterMeasured']=observed
        result['groundCenterErrorMasterPixels']=math.dist(observed,expected['groundCenterMaster'])
    door=measurement.get('personnelDoorEndpointsSource')
    if door:
        observed=abs(door[1][1]-door[0][1])*source_scale
        result['personnelDoorHeightMasterMeasured']=observed
        result['personnelDoorEndpointsMasterMeasured']=[[point[axis]*source_scale+translation[axis] for axis in (0,1)] for point in door]
        result['personnelDoorHeightRelativeError']=abs(observed-expected['personnelDoorMasterPixels'])/expected['personnelDoorMasterPixels']
    observable=measurement.get('personnelDoorObservable',True)
    if segments and center and (door or observable is False):
        result['status']='measured'
        if not result.get('bothGroundAxesObserved') or result.get('groundSlopeMaximumAbsoluteError',0)>.11 or result.get('groundCenterErrorMasterPixels',0)>3 or result.get('personnelDoorHeightRelativeError',0)>.25:
            result['status']='measured-outside-contract'
            result['reason']='Observed camera axes, registration or door scale exceed the review tolerance; correct source evidence before acceptance.'
    else:
        result['reason']='Record two actual visible ground-axis segments, observed centre and personnel-door endpoints, or explicitly mark the entrance unobservable. Hidden rear corners are not required.'
    return result


def source_ground_center(measurement):
    """Resolve observed physical landmarks; alpha bounds never provide a datum."""
    if not measurement:
        return None, None
    explicit = measurement.get('groundCenterSource')
    opposite = measurement.get('visibleOppositeGroundVerticesSource')
    vertices = measurement.get('groundVerticesSource')
    if explicit is not None:
        center = explicit
        method = 'Observed physical ground centre, local source-cell pixel coordinates'
    elif opposite is not None:
        if len(opposite) != 2:
            raise ValueError('visibleOppositeGroundVerticesSource needs exactly two observed opposite ground corners')
        center = [(opposite[0][axis]+opposite[1][axis])/2 for axis in (0,1)]
        method = 'Midpoint of two observed opposite ground-plane vertices; independent of shadow and silhouette'
    elif vertices is not None:
        if len(vertices) != 4:
            raise ValueError('groundVerticesSource needs four ordered projected ground corners')
        center = [(vertices[1][axis]+vertices[3][axis])/2 for axis in (0,1)]
        method = 'Midpoint of observed right/left ground-plane vertices1,3; hidden back excluded'
    else:
        return None, None
    if len(center) != 2 or not all(isinstance(value, (int,float)) and math.isfinite(value) for value in center):
        raise ValueError('Observed ground centres must be two finite source-cell coordinates')
    return list(center), method


def registration_plan(measurement, expected, metrics, source_scale):
    """Plan measured translation at the sheet scale; do not alter delivered pixels."""
    center, method = source_ground_center(measurement)
    if center is None:
        return {'status':'pending-observed-landmarks','applied':False,
                'uniformSourceToMasterScale':source_scale,
                'reason':'Supply local groundCenterSource or two observed visibleOppositeGroundVerticesSource. No silhouette fitting is allowed.'}
    target=expected['groundCenterMaster']
    translation=[target[axis]-center[axis]*source_scale for axis in (0,1)]
    bounds=metrics['alphaBounds']
    translated=[bounds[index]*source_scale+translation[index%2] for index in range(4)]
    gutter=min(translated[0],translated[1],MASTER-translated[2],MASTER-translated[3])
    return {'status':'translation-proposed','applied':False,'sourceGroundCenter':center,'sourceGroundCenterMethod':method,
            'uniformSourceToMasterScale':source_scale,'scalePolicy':'One full-cell source scale for the entire sheet; never per-silhouette or per-cell feature fitting',
            'translationMaster':translation,'targetGroundCenterMaster':target,'translatedAllAlphaBoundsMaster':translated,
            'minimumAllAlphaFilteringGutterMasterPixels':gutter,
            'canPreserveEveryNonzeroAlphaPixel':gutter>=0,'hasTwoMasterPixelFilteringGutter':gutter>=2,
            'reason':'Review observed landmarks and alpha retention before applying packing translation; this run leaves original registration unchanged.'}


def qa_images(cells, entries, job, folder):
    cols,rows=job['columns'],job['rows']
    tile=MASTER
    guides=Image.new('RGB',(cols*tile,rows*tile),'#eee9d8')
    backgrounds=('#78934d','#b6c2ad','#cba869','#355468')
    for index,cell in enumerate(cells):
        x,y=index%cols*tile,index//cols*tile
        for row in range(0,tile,16):
            for col in range(0,tile,16):
                color=backgrounds[(col//16+row//16)%len(backgrounds)]
                ImageDraw.Draw(guides).rectangle((x+col,y+row,x+col+15,y+row+15),fill=color)
        guides.paste(cell,(x,y),cell)
        entry=entries[index]
        if not entry: continue
        expected=expected_points(job,entry['footprint'])
        draw=ImageDraw.Draw(guides)
        vertices=[(x+point[0],y+point[1]) for point in expected['groundEnvelopeMaster']]
        draw.line(vertices+[vertices[0]],fill='#f5ef9a',width=1)
        cx,cy=expected['groundCenterMaster'];cx+=x;cy+=y
        draw.line((cx-4,cy,cx+4,cy),fill='#faf8ee',width=1)
        draw.line((cx,cy-4,cx,cy+4),fill='#faf8ee',width=1)
        # An actual calibrated door ruler, for direct measured feature comparison.
        dx=x+MASTER-12;bottom=y+MASTER-16;top=bottom-expected['personnelDoorMasterPixels']
        draw.line((dx,top,dx,bottom),fill='#f5ef9a',width=2)
        draw.text((x+6,y+6),entry['kind'],fill='#faf8ee')
    save_png(guides,folder/'guide-comparison.png')
    # Same complete cutout is composited over four distinct terrain colours.
    width=cols*MASTER
    image=Image.new('RGB',(width,rows*MASTER*len(backgrounds)))
    for variant,color in enumerate(backgrounds):
        yy=variant*rows*MASTER
        ImageDraw.Draw(image).rectangle((0,yy,width-1,yy+rows*MASTER-1),fill=color)
        for index,cell in enumerate(cells):image.paste(cell,(index%cols*MASTER,yy+index//cols*MASTER),cell)
    save_png(image,folder/'ground-comparison.png')
    strip=Image.new('RGB',(max(640,len(cells)*132),400),'#91a77a')
    draw=ImageDraw.Draw(strip)
    yy=0
    for size in (128,64,32,16):
        draw.text((4,yy+3),f'{size}px complete cell',fill='#263b30')
        for index,cell in enumerate(cells):
            small=resize_alpha(cell,(size,size))
            strip.paste(small,(4+index*132,yy+20),small)
        yy+=size+40
    save_png(strip,folder/'lod-comparison.png')


def resample_registered(raw, cell_pixels, source_scale, translation):
    """Direct original-pixel uniform affine resampling with transparent padding."""
    left, top = [-value/source_scale for value in translation]
    extent = MASTER/source_scale
    box = (left, top, left+extent, top+extent)
    # Integer1:1 packing translations preserve exact delivered RGBA samples.
    if cell_pixels == MASTER and source_scale == 1 and all(value.is_integer() for value in box):
        return raw.crop(tuple(int(value) for value in box))
    if translation == [0,0] and raw.width == raw.height and raw.width == extent:
        return resize_alpha(raw,(cell_pixels,cell_pixels))
    pads = [max(0,math.ceil(-box[0])),max(0,math.ceil(-box[1])),
            max(0,math.ceil(box[2]-raw.width)),max(0,math.ceil(box[3]-raw.height))]
    premultiplied=raw.convert('RGBa')
    padded=Image.new('RGBa',(raw.width+pads[0]+pads[2],raw.height+pads[1]+pads[3]))
    padded.paste(premultiplied,(pads[0],pads[1]))
    window=(box[0]+pads[0],box[1]+pads[1],box[2]+pads[0],box[3]+pads[1])
    return padded.resize((cell_pixels,cell_pixels),Image.Resampling.LANCZOS,box=window).convert('RGBA')


def clipping_metrics(raw, source_scale, translation):
    """Count original source alpha whose pixel centres leave the target frame."""
    count=energy=non_noise=non_noise_energy=0
    alpha=raw.getchannel('A')
    for y in range(raw.height):
        py=(y+.5)*source_scale+translation[1]
        for x in range(raw.width):
            value=alpha.getpixel((x,y))
            if not value:continue
            px=(x+.5)*source_scale+translation[0]
            if not(0<=px<MASTER and 0<=py<MASTER):
                count+=1;energy+=value
                if value>2:non_noise+=1;non_noise_energy+=value
    return {'clippedSourcePixels':count,'clippedSourceAlphaEnergy':energy,
            'clippedNonNoiseSourcePixels':non_noise,'clippedNonNoiseSourceAlphaEnergy':non_noise_energy,
            'maximumAllowedClippedAlpha':2,'method':'Observed source pixel centres transformed to master; alpha1/2 encoding noise only may leave frame'}


def calibrated_sheet_scale(requested, evidence, job, nominal_scale, sheet_pixels=None):
    """Validate one explicit sheet density against observed physical edge spans."""
    if not isinstance(requested,(int,float)) or not math.isfinite(requested) or requested<=0:
        raise ValueError('--sheet-scale must be a finite positive source-pixel-to-master scalar')
    if not isinstance(evidence,dict) or not evidence.get('observations'):
        raise ValueError('--sheet-scale requires calibration evidence with observed physical ground-edge spans')
    allowed_footprints={entry['footprint'] for entry in job['entries'] if entry}
    records=[]
    for observation in evidence['observations']:
        points=observation.get('sourceEdgeEndpoints')
        metres=observation.get('physicalSpanMetres')
        footprint=observation.get('footprint')
        if not points or len(points)!=2 or any(len(point)!=2 or not all(isinstance(value,(int,float)) and math.isfinite(value) for value in point) for point in points):
            raise ValueError('Sheet calibration requires two actual finite sourceEdgeEndpoints per physical span')
        if not isinstance(metres,(int,float)) or not math.isfinite(metres) or metres<=0 or footprint not in allowed_footprints:
            raise ValueError('Sheet calibration needs positive physicalSpanMetres and a footprint present in this job')
        if metres>job['scale']['tileMetres']*footprint:
            raise ValueError('Observed calibration edge cannot be longer than its physical parcel axis')
        if sheet_pixels and any(not(0<=point[axis]<=sheet_pixels[axis]) for point in points for axis in (0,1)):
            raise ValueError('Observed calibration endpoints must lie within the original source sheet')
        if not observation.get('note'):
            raise ValueError('Sheet calibration must describe the actually observed fence, parcel or ground-edge span in note')
        dx,dy=[points[1][axis]-points[0][axis] for axis in (0,1)]
        if not dx or abs(abs(dy/dx)-.5)>.11:
            raise ValueError('Sheet calibration must measure an observed canonical ground-axis edge, not silhouette or bounding-box width')
        source_length=math.hypot(dx,dy)
        scale=job['scale']
        target_length=metres*scale['worldPixelsPerMetre']*MASTER/(scale['billboardPixelsPerTile']*footprint)*math.sqrt(1.25)
        observed_scale=target_length/source_length
        relative_error=abs(requested-observed_scale)/observed_scale
        if relative_error>.02:
            raise ValueError(f'Requested sheet scale{requested} differs from observed physical-span density{observed_scale:.6f} by{relative_error:.1%}; review measurements')
        records.append({'observation':observation,'sourceSpanPixels':source_length,'targetMasterSpanPixels':target_length,
                        'observedSourceToMasterScale':observed_scale,'requestedScaleRelativeError':relative_error,
                        'observedGroundEdgeSlope':dy/dx})
    return {'status':'observed-whole-sheet-density','requestedSourceToMasterScale':requested,'defaultNominalSourceToMasterScale':nominal_scale,
            'relativeScaleToNominal':requested/nominal_scale,'observations':records,'originalEvidence':evidence,
            'validationToleranceRelative':.02,'policy':'One explicitly measured source-pixel density for the whole sheet; no automatic alpha/silhouette fitting and no per-entry scale'}


def pack(source: Path, manifest: Path, destination: Path | None=None, qa_dir: Path | None=None, measurements: Path | None=None, register_ground=False, sheet_scale=None, scale_calibration: Path | None=None, minimum_gutter=2, sheet_offset_y=0, registration_note=''):
    if minimum_gutter not in (1,2):raise ValueError('Minimum filtering gutter must be one or two master pixels')
    if not math.isfinite(sheet_offset_y) or abs(sheet_offset_y)>3:raise ValueError('A whole-sheet registration offset must stay within the three-master-pixel ground-centre tolerance')
    if sheet_offset_y and (not register_ground or not registration_note):raise ValueError('A whole-sheet registration offset needs measured registration and an explicit review note')
    job=json.loads(manifest.read_text())
    cols,rows=job['columns'],job['rows'];entries=job['entries']
    if len(entries)!=cols*rows:raise ValueError('Exactly one entry is required per grid cell')
    destination=destination or Path(job['destination'])
    with Image.open(source) as opened:
        if opened.format!='PNG' or opened.mode not in ('RGBA','LA','P'):raise ValueError('Supply a PNG with genuine alpha; RGB backgrounds cannot be keyed by this packer')
        image=opened.convert('RGBA')
    if image.width%cols or image.height%rows or image.width//cols!=image.height//rows:
        raise ValueError(f'Full-cell packing requires equal square cells: source {image.size}, grid {cols}x{rows}; regenerate framing, never stretch/fill silhouettes')
    source_cell=image.width//cols
    if source_cell<MASTER:raise ValueError('Generated cells must be at least256px to preserve human-scale features')
    uniform_scale=MASTER/source_cell
    measurement_data=json.loads(measurements.read_text()) if measurements else {}
    measured_by_id={entry['id']:entry for entry in measurement_data.get('entries',[])}
    if register_ground and not measurements:raise ValueError('--register-ground requires observed ground-centre measurements')
    sheet_calibration=None
    if sheet_scale is not None:
        if not register_ground:raise ValueError('--sheet-scale requires --register-ground so observed centres and retention gates apply')
        evidence=json.loads(scale_calibration.read_text()) if scale_calibration else measurement_data.get('sheetScaleCalibration')
        sheet_calibration=calibrated_sheet_scale(sheet_scale,evidence,job,uniform_scale,image.size)
        uniform_scale=float(sheet_scale)
    destination.mkdir(parents=True,exist_ok=True)
    records=[];raw_cells=[];masters=[];crop_translations=[]
    ownership=Image.new('L',image.size)
    crop_coverage=Image.new('L',image.size)
    isolation_noise=None
    source_owned_meaningful=0
    for index,entry in enumerate(entries):
        nominal=(index%cols*source_cell,index//cols*source_cell,(index%cols+1)*source_cell,(index//cols+1)*source_cell)
        measurement=measured_by_id.get(entry['id']) if entry else None
        box=tuple(measurement.get('sourceBoundsSheet',nominal)) if measurement else nominal
        if len(box)!=4 or any(not isinstance(value,int) for value in box) or not(0<=box[0]<box[2]<=image.width and 0<=box[1]<box[3]<=image.height):
            raise ValueError(f'Slot{index}: sourceBoundsSheet must be an in-sheet integer[left,top,right,bottom] rectangle')
        if box!=nominal and not register_ground:raise ValueError('Observed sourceBoundsSheet crops require --register-ground; full-cell API remains unchanged')
        if register_ground and not entry:
            raw=Image.new('RGBA',(source_cell,source_cell));box=nominal
        else:raw=image.crop(box)
        metrics=alpha_metrics(raw)
        expected=expected_points(job,entry['footprint']) if entry else None
        nominal_translation=[0,0];crop_translation=[0,0];registration=None
        if entry:
            if metrics['meaningfulPixels']==0:raise ValueError(f"{entry['id']}: empty occupied source cell")
            if metrics['transparentFraction']<.05:raise ValueError(f"{entry['id']}: source cell has no usable transparent ground")
            if not register_ground and max(metrics['edgeMeaningfulFractions'])>.12:raise ValueError(f"{entry['id']}: source artwork crosses a cell border; regenerate its full-cell registration")
            if register_ground:
                center,method=source_ground_center(measurement)
                if center is None:raise ValueError(f"{entry['id']}: --register-ground needs observed physical ground-centre landmarks")
                nominal_translation=[expected['groundCenterMaster'][axis]-center[axis]*uniform_scale for axis in (0,1)]
                nominal_translation[1]+=sheet_offset_y
                crop_offset=[box[axis]-nominal[axis] for axis in (0,1)]
                crop_translation=[nominal_translation[axis]+crop_offset[axis]*uniform_scale for axis in (0,1)]
                meaningful=metrics['meaningfulAlphaBounds']
                transformed=[meaningful[i]*uniform_scale+crop_translation[i%2] for i in range(4)]
                gutter=min(transformed[0],transformed[1],MASTER-transformed[2],MASTER-transformed[3])
                if gutter<minimum_gutter:raise ValueError(f"{entry['id']}: measured registration leaves{gutter:.3f}px meaningful-alpha gutter; need>={minimum_gutter}px without fitting or clipping")
                clipping=clipping_metrics(raw,uniform_scale,crop_translation)
                if clipping['clippedNonNoiseSourcePixels']:raise ValueError(f"{entry['id']}: registration would clip non-noise alpha; correct observed crop/centre or regenerate")
                mask=raw.getchannel('A').point(lambda value:255 if value>8 else 0)
                if ImageChops.multiply(ownership.crop(box),mask).getbbox():raise ValueError(f"{entry['id']}: sourceBoundsSheet duplicates meaningful pixels from another sprite")
                ownership.paste(ImageChops.lighter(ownership.crop(box),mask),box[:2])
                ImageDraw.Draw(crop_coverage).rectangle((box[0],box[1],box[2]-1,box[3]-1),fill=255)
                source_owned_meaningful+=metrics['meaningfulPixels']
                registration={'status':'measured-translation-applied','applied':True,'sourceGroundCenter':center,'sourceGroundCenterMethod':method,
                              'uniformSourceToMasterScale':uniform_scale,'translationMaster':nominal_translation,
                              'targetGroundCenterMaster':[expected['groundCenterMaster'][0],expected['groundCenterMaster'][1]+sheet_offset_y],
                              'wholeSheetRegistrationOffsetMaster':[0,sheet_offset_y],'registrationOffsetReview':registration_note,
                              'transformedMeaningfulAlphaBoundsMaster':transformed,
                              'minimumMeaningfulFilteringGutterMasterPixels':gutter,'requiredMinimumGutterMasterPixels':minimum_gutter,'clipping':clipping,
                              'sourceCropToMasterAffine':[uniform_scale,0,crop_translation[0],0,uniform_scale,crop_translation[1]],
                              'sourceSheetToMasterAffine':[uniform_scale,0,nominal_translation[0]-nominal[0]*uniform_scale,0,uniform_scale,nominal_translation[1]-nominal[1]*uniform_scale],
                              'sourceNominalCellToMasterAffine':[uniform_scale,0,nominal_translation[0],0,uniform_scale,nominal_translation[1]],
                              'scalePolicy':'ONE observed or default source pixel-to-master density for the entire sheet; no silhouette or per-entry scale fitting'}
        elif metrics['meaningfulPixels']:raise ValueError(f'Empty slot{index} contains nontransparent imagery')
        master=resample_registered(raw,MASTER,uniform_scale,crop_translation)
        if entry and register_ground and alpha_metrics(master)['minimumFilteringGutterPixels']<minimum_gutter:
            raise ValueError(f"{entry['id']}: filtered meaningful-alpha master violates{minimum_gutter}px gutter")
        raw_cells.append(raw);masters.append(master);crop_translations.append(crop_translation)
        if not entry:records.append({'id':None,'cell':index});continue
        safe=entry['id'].replace(':','_').replace('/','_')
        master_path=destination/'sources'/f'{safe}.png';save_png(master,master_path)
        records.append({'id':entry['id'],'kind':entry['kind'],'cell':index,'footprint':entry['footprint'],
                        'runtimeIds':entry.get('runtimeIds',[]),'eligibleBiomes':entry.get('eligibleBiomes',[]),
                        'sourceBounds':list(box),'sourceBoundsSheet':list(box),'sourceNominalCellBoundsSheet':list(nominal),
                        'sourceCellPixels':source_cell,'observedSourceCropPixels':list(raw.size),'sourceScale':uniform_scale,
                        'normalization':'Observed ground-centre translation, explicit complete source crop, ONE uniform sheet density; no silhouette fitting' if register_ground else 'Full registered square source cell; one common scale; no fitting or translation',
                        'sourceAlpha':metrics,'masterAlpha':alpha_metrics(master),'groundAlpha':ground_alpha_metrics(master,expected['groundEnvelopeMaster'],expected['groundCenterMaster']),
                        'expectedGeometry':expected,'measuredGeometry':measured_geometry(measurement,expected,uniform_scale,nominal_translation),
                        'registrationPlan':registration or registration_plan(measurement,expected,metrics,uniform_scale),
                        'originalMeasurements':measurement,'masterSha256':digest(master_path)})
    if register_ground:
        all_meaningful=sum(image.getchannel('A').histogram()[9:])
        if source_owned_meaningful!=all_meaningful:raise ValueError(f'Observed crop rectangles retain{source_owned_meaningful}/{all_meaningful} meaningful source pixels; correct explicit isolation rectangles')
        isolated_out=ImageChops.multiply(image.getchannel('A'),ImageChops.invert(crop_coverage))
        omitted=isolated_out.histogram()
        if sum(omitted[3:]):raise ValueError('Observed sourceBoundsSheet crops omit non-noise alpha>2; complete the isolation rectangles')
        isolation_noise={'omittedSourcePixels':sum(omitted[1:]),'omittedSourceAlphaEnergy':sum(index*count for index,count in enumerate(omitted)),
                         'maximumAllowedOmittedAlpha':2,'method':'Original sheet alpha outside the union of explicit occupied-slot crop rectangles'}
    levels=list(BASE_LEVELS);outputs={}
    for level in levels:
        atlas=Image.new('RGBA',(cols*level,rows*level))
        for index,raw in enumerate(raw_cells):
            atlas.paste(resample_registered(raw,level,uniform_scale,crop_translations[index]),(index%cols*level,index//cols*level))
        path=destination/f'atlas-{level}.png';save_png(atlas,path);outputs[str(level)]={'path':path.name,'sha256':digest(path),'dimensions':list(atlas.size),
                'generatedSourceCellPixels':source_cell,'sourceToLevelScale':uniform_scale*level/MASTER,'upsampledFromGeneratedSource':uniform_scale*level/MASTER>1,
                'sourceDetailPolicy':'Direct affine resampling of original generated pixels; upsampled levels add no source detail'}
        if level==MASTER:save_png(atlas,destination/'atlas.png')
    source_copy=destination/'generated-source.png'
    if source.resolve()!=source_copy.resolve():shutil.copyfile(source,source_copy)
    manifest_copy=destination/'generation-job.json'
    if manifest.resolve()!=manifest_copy.resolve():shutil.copyfile(manifest,manifest_copy)
    measurement_copy=None
    if measurements:
        measurement_copy=destination/'registration-measurements.json'
        if measurements.resolve()!=measurement_copy.resolve():shutil.copyfile(measurements,measurement_copy)
    calibration_copy=None
    if scale_calibration:
        calibration_copy=destination/'sheet-scale-calibration.json'
        if scale_calibration.resolve()!=calibration_copy.resolve():shutil.copyfile(scale_calibration,calibration_copy)
    contract=Path(__file__).resolve().parent.parent/'sprite-art-direction.js'
    metadata={'version':2,'jobId':job['id'],'type':job['type'],'columns':cols,'rows':rows,'cellSizes':levels,'masterCell':MASTER,
              'order':[entry['id'] if entry else None for entry in entries],'sprites':records,
              'registration':'Observed ground-centre translation of complete RGBA crops atONE explicit whole-sheet density; never silhouette fit' if register_ground else 'Full physical plot cells, uniform source-cell scale, alpha preserved; never silhouette fit',
              'groundRegistrationApplied':register_ground,
              'source':source_copy.name,'sourceSha256':digest(source_copy),'generationJobSha256':digest(manifest_copy),
              'measurements':measurement_copy.name if measurement_copy else None,'measurementsSha256':digest(measurement_copy) if measurement_copy else None,
              'originalSourceResolution':{'sheetPixels':list(image.size),'squareCellPixels':source_cell,'columns':cols,'rows':rows},
              'originalMeasurements':measurement_data,'sheetScaleCalibration':sheet_calibration,
              'sheetScaleCalibrationFile':calibration_copy.name if calibration_copy else None,
              'sheetScaleCalibrationSha256':digest(calibration_copy) if calibration_copy else None,
              'physicalCalibration':{'scale':job['scale'],'registration':job['registration'],'contractSha256':digest(contract),
                                     'sourceCellPixels':source_cell,'sourceToMasterScale':uniform_scale,
                                     'meaningfulSourcePixelsRetained':source_owned_meaningful if register_ground else None,
                                     'sourceIsolationNoise':isolation_noise,
                                     'measuredGeometryVerified':all(record.get('measuredGeometry',{}).get('status')=='measured' for record in records if record['id']),
                                     'minimumFilteringGutterMasterPixels':minimum_gutter,'measurementTolerances':{'groundSlopeAbsoluteError':.11,'groundCenterMasterPixels':3,'personnelDoorRelativeError':.25}},
              'mipFilter':'Independent original-cutout premultiplied-alpha Lanczos affine; no sharpening','mipSharpening':False,
              'groundKey':'RGBA alpha, bare ground must be authored transparent; no colour keying','outputs':outputs,
              'provenance':{'operation':'Uniform source pixel density and measured registration only; generator output preserved verbatim',
                            'generator':'image_gen','styleReference':job.get('reference'),'sourceReview':('Measured camera, physical registration, observable personnel scale and original RGBA isolation accepted' if all(record.get('measuredGeometry',{}).get('status')=='measured' for record in records if record['id']) else 'Pending measured camera or personnel-scale acceptance; inspect per-sprite measuredGeometry')}}
    (destination/'atlas.json').write_text(json.dumps(metadata,indent=2)+'\n')
    if qa_dir:qa_images(masters,entries,job,qa_dir)
    return {'job':job['id'],'output':str(destination),'sourceCellPixels':source_cell,'occupied':sum(bool(entry) for entry in entries),
            'cellSizes':levels,'sourceSha256':metadata['sourceSha256'],'groundRegistrationApplied':register_ground,
            'physicalReview':metadata['provenance']['sourceReview']}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('job',type=Path);parser.add_argument('output',type=Path,nargs='?')
    parser.add_argument('--qa-dir',type=Path);parser.add_argument('--measurements',type=Path)
    parser.add_argument('--register-ground',action='store_true',help='Apply observed ground-centre translations and optional explicit sourceBoundsSheet crops at ONE nominal sheet scale')
    parser.add_argument('--sheet-scale',type=float,help='Explicit source-pixel-to-master density for the WHOLE sheet; requires observed physical-span calibration evidence')
    parser.add_argument('--scale-calibration',type=Path,help='JSON observations:[{sourceEdgeEndpoints,physicalSpanMetres,footprint,note}]; alternatively measurements.sheetScaleCalibration')
    parser.add_argument('--min-gutter',type=int,choices=[1,2],default=2,help='Required master-cell gutter; one pixel is allowed only for reviewed full-plot sources')
    parser.add_argument('--sheet-offset-y',type=float,default=0,help='Explicit vertical registration offset shared by every cell, within the measured3px centre tolerance; never a per-silhouette adjustment')
    parser.add_argument('--registration-note',default='',help='Required review evidence for a nonzero whole-sheet registration offset')
    args=parser.parse_args()
    print(json.dumps(pack(args.source,args.job,args.output,args.qa_dir,args.measurements,args.register_ground,args.sheet_scale,args.scale_calibration,args.min_gutter,args.sheet_offset_y,args.registration_note),indent=2))
