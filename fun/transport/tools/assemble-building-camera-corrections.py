#!/usr/bin/env python3
"""Reproduce accepted 2026-10-08 building camera source corrections.

Requires Pillow, NumPy and SciPy (offline packing only). Full generator sources,
canonical prompts, observed scale, ground and door landmarks remain alongside
both families. Only accepted identities are extracted; all other source pixels
remain exact. Use pack-plot-cutouts.py afterward with the family's retained
sheet-scale-calibration.json and original whole-sheet density.

Usage: python3 tools/assemble-building-camera-corrections.py [staging-directory]
"""
import hashlib,json,math,shutil,sys,importlib.util
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/transport-camera-stage')
spec=importlib.util.spec_from_file_location('assembly',ROOT/'tools/assemble-building-source-cells.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def isolate(path, pick, count):
 raw=Image.open(path).convert('RGBA');a=np.array(raw);labels,n=ndimage.label(a[:,:,3]>230);sizes=np.bincount(labels.ravel());ids=np.argsort(sizes[1:])[-count:]+1
 cores=np.zeros(labels.shape,dtype=np.uint8)
 centroids=[]
 for j,ident in enumerate(ids,1):
  cores[labels==ident]=j;ys,xs=np.where(labels==ident);centroids.append((j,float(xs.mean()),float(ys.mean())))
 chosen=min(centroids,key=lambda c:(c[1]-pick[0])**2+(c[2]-pick[1])**2)[0]
 nearest=ndimage.distance_transform_edt(cores==0,return_distances=False,return_indices=True);owners=cores[tuple(nearest)]
 a[owners!=chosen]=0
 return Image.fromarray(a),{'method':'Lossless RGBA assignment to nearest of the major alpha>230 connected components; no silhouette fitting, alpha editing, rotation or shear. Every original pixel belongs to exactly one component, including detached details and soft shadows.','componentCount':count,'selectedComponentCentroid':next(list(c[1:]) for c in centroids if c[0]==chosen)}

def fit(path,box,ranges):
 a=np.array(Image.open(path))[:,:,3];x0,y0,x1,y1=box;a=a[y0:y1,x0:x1];out=[]
 for lo,hi in ranges:
  v=[]
  for x in range(lo,hi):
   ys=np.where(a[:,x]>180)[0]
   if len(ys):v.append([x,int(ys[-1])])
  v=np.array(v);s,b=np.polyfit(v[:,0],v[:,1],1)
  for _ in range(3):
   good=np.abs(v[:,1]-v[:,0]*s-b)<2;s,b=np.polyfit(v[good,0],v[good,1],1)
  out.append((float(s),float(b+y0-s*x0),[[lo+x0,float(lo*s+b+y0)],[hi+x0,float(hi*s+b+y0)]]))
 return out

families={
 'city-commerce':{
 'sources':{'camera-targets.png':None,'door-targets.png':None,'garage-door-final.png':None},
 'entries':[
  {'index':6,'source':'garage-door-final.png','pick':[300,450],'box':[0,0,624,704],'ranges':[[40,310],[410,585]],'cornersX':[10,619],'door':[[405,566],[405,596]]},
  {'index':8,'source':'door-targets.png','pick':[970,450],'box':[620,0,1254,695],'ranges':[[30,300],[430,600]],'cornersX':[607,1253],'door':None},
  {'index':0,'source':'door-targets.png','pick':[300,950],'box':[0,695,638,1254],'ranges':[[90,280],[400,580]],'cornersX':[46,638],'door':[[294,1049],[294,1089]]},
  {'index':7,'source':'door-targets.png','pick':[950,950],'box':[638,695,1254,1254],'ranges':[[40,270],[350,550]],'cornersX':[644,1243],'door':[[904,1049],[904,1095]]}
 ]},
 'houses-design-0-rotation-0':{
 'sources':{'camera-targets.png':None},
 'entries':[
  {'index':8,'source':'camera-targets.png','pick':[1050,1090],'box':[840,850,1254,1254],'ranges':[[25,160],[230,380]],'cornersX':[849,1244],'door':None}
 ]}}
for family,cfg in families.items():
 base=ROOT/'assets/world/plot-buildings-v2'/family;archive=base/'camera-correction-2026-10-08';archive.mkdir(exist_ok=True)
 for name in cfg['sources']:
  if not (archive/name).is_file():raise ValueError(f'Missing retained generator source: {archive/name}')
 old_meta=json.loads((archive/'before-atlas.json').read_text());old_scale=old_meta['sprites'][0]['sourceScale'];measure=json.loads((archive/'before-source-measurements.json').read_text());sheet=Image.open(archive/'before-generated-source.png').convert('RGBA')
 for e in cfg['entries']:sheet.paste((0,0,0,0),tuple(measure['entries'][e['index']]['sourceBoundsSheet']))
 if family.startswith('houses'):
  source_scale=old_scale
 else:
  edges=fit(archive/cfg['entries'][0]['source'],cfg['entries'][0]['box'],cfg['entries'][0]['ranges']);leftx=10;frontx=(edges[1][1]-edges[0][1])/(edges[0][0]-edges[1][0]);edge=[[leftx,edges[0][0]*leftx+edges[0][1]],[frontx,edges[0][0]*frontx+edges[0][1]]];source_scale=(math.hypot(30*256/(72*2)*2,30*256/(72*2)))/math.dist(*edge)
  cfg['scaleCalibration']={'source':'garage-door-final.png','sourceEdgeEndpoints':edge,'physicalSpanMetres':30,'footprint':2,'sourceToMasterScale':source_scale,'note':'Observed complete left/front paved garage parcel edge assigned the 30m architectural span. This one camera density is used for ALL four 2x2 repaint slots; no individual silhouette scaling.'}
 evidence=[]
 for e in cfg['entries']:
  idx=e['index'];record=measure['entries'][idx];old_record=old_meta['sprites'][idx];path=archive/e['source'];raw,iso=isolate(path,e['pick'],9 if family.startswith('houses') else 4);edges=fit(path,e['box'],e['ranges']);corners=[[x,edges[i][0]*x+edges[i][1]] for i,x in enumerate(e['cornersX'])];center=[sum(p[i] for p in corners)/2 for i in (0,1)]
  bounds=e.get('sourceBoundsSheet',record['sourceBoundsSheet']);target_center=[record['groundCenterSource'][0]+record['sourceBoundsSheet'][0],record['groundCenterSource'][1]+record['sourceBoundsSheet'][1]]
  if family=='city-commerce':
   if idx in [6,7,8]:bounds=[(idx-6)*418,844,(idx-5)*418,1254];target_center[0]=209+(idx-6)*418
   elif idx==0:target_center[0]=188
  if family.startswith('houses') and idx==6:bounds=[0,837,417,1254];target_center[0]-=4
  ratio=source_scale/old_scale;translation=[target_center[i]-center[i]*ratio for i in (0,1)]
  layer=mod.affine_frame(raw,sheet.size,ratio,translation)
  outside=layer.getchannel('A').copy();outside.paste(0,tuple(bounds));hist=outside.histogram()
  if sum(hist[3:]):raise ValueError(f'Meaningful source outside registered isolation: {family} {idx} {sum(hist[3:])} pixels')
  isolated_layer=Image.new('RGBA',sheet.size);isolated_layer.paste(layer.crop(tuple(bounds)),tuple(bounds[:2]));layer=isolated_layer
  overlap=ImageChops.multiply(sheet.getchannel('A'),layer.getchannel('A'))
  if sum(overlap.histogram()[9:]):raise ValueError(f'Overlap {family} {idx}')
  sheet.alpha_composite(layer)
  def transform(pt):return [pt[i]*ratio+translation[i]-bounds[i] for i in (0,1)]
  record['sourceBoundsSheet']=bounds;record['groundEdgeSegmentsSource']=[[transform(p) for p in edge[2]] for edge in edges];record['visibleOppositeGroundVerticesSource']=[transform(p) for p in corners];record['groundCenterSource']=transform(center);record['observationMethod']='Visible paved parcel or fence-base boundaries fitted to original alpha>180 pixels, residual <2 source pixels; opposite physical edge endpoints manually identified. No silhouette anchor. See retained repaint measurements.'
  for key in ['personnelDoorEndpointsSource','personnelDoorObservable','personnelDoorNotes','personnelDoorObservationMethod']:record.pop(key,None)
  if e['door']:
   record['personnelDoorEndpointsSource']=[transform(p) for p in e['door']];record['personnelDoorNotes']='Observed ordinary door leaf head to sill, excluding the frame, threshold, and clearly separate fixed glazed transom on shop entries. Source-pixel review uncertainty approximately 2px.'
  else:
   record['personnelDoorObservable']=False;record['personnelDoorNotes']='No complete ordinary personnel door leaf is visible; factory loading bays and courtyard open arcades are not personnel doors.'
  evidence.append({'id':record['id'],'source':e['source'],'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'originalGroundEdgeSlopes':old_record['measuredGeometry']['groundEdgeSlopesMeasured'],'correctedGroundEdgeSlopes':[v[0] for v in edges],'observedGroundEdges':[v[2] for v in edges],'observedGroundVertices':corners,'observedGroundCenter':center,'observedPersonnelDoor':e['door'],'sourceToMasterScale':source_scale,'sourceToSheetScale':ratio,'sourceToSheetTranslation':translation,'isolation':iso,'discardedEncodingNoiseAfterResampling':{'alpha1Pixels':hist[1],'alpha2Pixels':hist[2],'meaningfulPixelsDiscarded':sum(hist[3:])},'clearSourceBounds':old_record['sourceBoundsSheet'],'newSourceBounds':bounds})
 out=OUTPUT/family;out.mkdir(parents=True,exist_ok=True);sheet.save(out/'generated-source.png',optimize=True);(out/'source-measurements.json').write_text(json.dumps(measure,indent=2)+'\n');(archive/'assembly-recipe.json').write_text(json.dumps({'baseSource':'before-generated-source.png','sourcePolicy':'Canonical buildingGenerationPrompt() imagegen repaints; accepted target cutouts only, original unedited identities retained. Repaint isolation preserves original RGBA. One measured camera density per generated sheet, uniform scale and ground-centre translation only.','scaleCalibration':cfg.get('scaleCalibration'),'replacements':evidence},indent=2)+'\n')
 print(family,'stage',out,'source_scale',source_scale,'original_scale',old_scale)
 for e in evidence:print(e['id'],e['correctedGroundEdgeSlopes'],'doorMaster',None if not e['observedPersonnelDoor'] else abs(e['observedPersonnelDoor'][1][1]-e['observedPersonnelDoor'][0][1])*source_scale)
