#!/usr/bin/env python3
"""Copy generated industry RGBA sprites into one uniformly calibrated grid.

Usage: register-industry-atlas.py source.png generation-job.json registered.png
No artwork, colours or alpha are reconstructed. Every family member shares one
source-cell scale; square output framing preserves the dimetric camera when the
generator supplies a rectangular atlas. The widest parcel determines a common
filtering gutter, never an independent per-silhouette fit.
"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy.ndimage import label,find_objects,distance_transform_edt
import json,sys,math
source_path=Path(sys.argv[1]);job_path=Path(sys.argv[2]);output=Path(sys.argv[3])
job=json.loads(job_path.read_text());cols,rows=job['columns'],job['rows'];image=Image.open(source_path).convert('RGBA');source=np.asarray(image);height,width=source.shape[:2];stride=width/cols;cell=math.ceil(stride*1.125);groundline=round(cell*.952)
meaningful=source[:,:,3]>8;labels,count=label(meaningful,np.ones((3,3)));counts=np.bincount(labels.ravel());slices=find_objects(labels);large=[i for i in range(1,count+1) if counts[i]>width*height*.003]
owner=np.zeros(labels.shape,np.int16);assigned=set();expected=sum(e is not None for e in job['entries'])
if len(large)==expected:
 # One common frame includes the widest full parcel, with a filtering gutter.
 # All siblings retain exactly the same pixel-to-metre scale.
 widest=max(slices[component-1][1].stop-slices[component-1][1].start+6 for component in large)
 cell=max(cell,math.ceil(widest*256/232));groundline=round(cell*.952)
if len(large)==expected:
 for component in large:
  yy,xx=slices[component-1];col=min(cols-1,int((xx.start+xx.stop)/2/width*cols));row=min(rows-1,int((yy.start+yy.stop)/2/height*rows));identity=row*cols+col+1
  if identity in assigned:raise ValueError('Two complete components in same slot')
  assigned.add(identity);owner[labels==component]=identity
 _,nearest=distance_transform_edt(owner==0,return_indices=True);owner=owner[nearest[0],nearest[1]]
else:
 # Generated farm parcels may meet at their transparent planting fringe. Their
 # explicit grid boundaries still keep each complete yard in the correct slot.
 xx=np.minimum(cols-1,np.arange(width)*cols//width);yy=np.minimum(rows-1,np.arange(height)*rows//height);owner=yy[:,None]*cols+xx[None,:]+1
result=Image.new('RGBA',(cols*cell,rows*cell));records=[];preserved=0
for index,entry in enumerate(job['entries']):
 if entry is None:records.append({'cell':index,'empty':True});continue
 mask=meaningful&(owner==index+1)
 if not mask.any():raise ValueError('Missing occupied cell')
 ys,xs=np.nonzero(mask);x0,y0,x1,y1=max(0,xs.min()-3),max(0,ys.min()-3),min(width,xs.max()+4),min(height,ys.max()+4)
 crop=source[y0:y1,x0:x1].copy();crop[owner[y0:y1,x0:x1]!=index+1]=0
 if crop.shape[1]>=cell-16 or crop.shape[0]>=groundline-8:raise ValueError('Calibration needs larger shared cell; source cannot be clipped')
 dx,dy=(cell-crop.shape[1])//2,groundline-crop.shape[0];result.paste(Image.fromarray(crop),(index%cols*cell+dx,index//cols*cell+dy));preserved+=int((crop[:,:,3]>8).sum());records.append({'cell':index,'id':entry['id'],'sourceBounds':[int(x0),int(y0),int(x1),int(y1)],'offset':[dx,dy],'pixels':int(mask.sum())})
if preserved!=int(meaningful.sum()):raise ValueError('Source artwork extends into an unused slot; inspect or regenerate')
output.parent.mkdir(parents=True,exist_ok=True);result.save(output,compress_level=9)
output.with_suffix('.json').write_text(json.dumps({'source':source_path.name,'cell':cell,'operation':'Original RGBA pixels copied into fixed uniform cells. One shared family pixel scale; no independent bounding-box fitting, painting, recoloring or alpha reconstruction.','calibrationScale':256/cell,'sourceColumnPixels':stride,'meaningfulPixelsPreserved':preserved,'cells':records},indent=2)+'\n')
print(json.dumps({'output':str(output),'cell':cell,'sprites':expected,'preserved':preserved}))
