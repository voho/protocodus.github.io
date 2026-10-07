#!/usr/bin/env python3
"""Pack registered generation sources without repainting or color-keying pixels.

Usage: python3 fun/transport/tools/rebuild-transport-art.py <generation-jobs.json>
The job file contains built-in image_gen outputs (name, path, prompt).
"""
import argparse, hashlib, importlib.util, json, shutil
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage
ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('world',Path(__file__).with_name('build-world-atlases.py'))
world=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(world)
ORDER=['NW','N','NE','W',None,'E','SW','S','SE']
KINDS=['bus','express-bus','truck','locomotive','coach','wagon','ferry','cargo-ship','tanker']
# Inspection of pointed bows, windshields, cabs and red rear lamps determines
# the order, not the image prompt's labels. All source pixels remain unchanged.
OBSERVED={k:['SE','S','SW','W',None,'E','NE','N','NW'] for k in KINDS}
OBSERVED['ferry']=ORDER
for k in ['cargo-ship','tanker']:OBSERVED[k]=['SE','S','SW','E',None,'W','NE','N','NW']

def record_source(job,dest,name='source-generated.png'):
    dest.mkdir(parents=True,exist_ok=True)
    if Path(job['path']).resolve()!=(dest/name).resolve():shutil.copyfile(job['path'],dest/name)
    return {'tool':'built-in image_gen','prompt':job.get('prompt'),'source':name,'sha256':hashlib.sha256((dest/name).read_bytes()).hexdigest()}

def pack(source,dest,ids,shared=True):
    world.build(argparse.Namespace(atlas=str(source),columns=3,rows=3,ids=','.join(x or '-' for x in ids),output_dir=str(dest),aligned=False,preserve_grid_scale=False,shared_scale=shared,width=232,height=232,vehicle=shared,anchor='center',max_cell=256,qa=None,no_sharpen=True))


def main(jobfile):
    jobs={j['name']:j for j in json.loads(Path(jobfile).read_text())}
    for job in jobs.values():
        if not Path(job['path']).is_absolute():job['path']=str(Path(jobfile).resolve().parent/job['path'])
    for kind in KINDS:
        name={'ferry':'ferry-repaired','tanker':'tanker-repaired'}.get(kind,kind)
        dest=ROOT/'assets/world'/f'vehicle-{kind}-regenerated-v3'
        provenance=record_source(jobs[name],dest)
        source=Image.open(dest/'source-generated.png').convert('RGBA');source_cell=source.width//3;gutter=32;cell=source_cell+gutter*2
        sheet=Image.new('RGBA',(cell*3,cell*3));extra=[]
        for index,heading in enumerate(ORDER):
            if not heading:continue
            old=OBSERVED[kind].index(heading);ox,oy=old%3,old//3
            # Only borrow gutter from the empty centre, never from a neighbour.
            left=gutter if old==5 else 0;right=gutter if old==3 else 0;top=gutter if old==7 else 0;bottom=gutter if old==1 else 0
            cut=source.crop((ox*source_cell-left,oy*source_cell-top,(ox+1)*source_cell+right,(oy+1)*source_cell+bottom))
            frame=Image.new('RGBA',(cell,cell));frame.paste(cut,(gutter-left,gutter-top))
            if kind=='ferry' and heading in ['SW','SE']:
                job=jobs['ferry-'+heading];filename=f'source-{heading}.png';extra.append(record_source(job,dest,filename))
                single=Image.open(dest/filename).convert('RGBA');bounds=single.getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox()
                # A separate source density is registered to the hull width of
                # the existing diagonal. Uniform scaling preserves its camera.
                target=source.crop((0,0,source_cell,source_cell)).getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox()
                scale=(target[2]-target[0])/(bounds[2]-bounds[0]);raw=world.house.trim_bounds(single);cut=single.crop(raw)
                cut=world.house.resize_alpha(cut,(round(cut.width*scale),round(cut.height*scale)))
                frame=Image.new('RGBA',(cell,cell));frame.paste(cut,((cell-cut.width)//2,(cell-cut.height)//2))
            if kind=='tanker':
                # Tight rectangular extraction excludes the neighbouring boat's
                # shadow that crosses a generated grid boundary. Retained RGBA
                # pixels are untouched; no mask reconstruction or colour key.
                labels,count=ndimage.label(np.asarray(frame.getchannel('A'))>=8)
                sizes=np.bincount(labels.ravel());sizes[0]=0;component=int(sizes.argmax());ys,xs=ndimage.find_objects(labels)[component-1]
                box=(max(0,xs.start-3),max(0,ys.start-3),min(cell,xs.stop+3),min(cell,ys.stop+3));isolated=Image.new('RGBA',frame.size);isolated.paste(frame.crop(box),box[:2]);frame=isolated
            sheet.paste(frame,(index%3*cell,index//3*cell))
        sheet.save(dest/'source-registered.png');pack(dest/'source-registered.png',dest,[f'vehicle:{kind}:{h}' if h else None for h in ORDER])
        provenance.update({'observedSourceOrder':OBSERVED[kind],'registeredOrder':ORDER,'additionalSources':extra,'camera':'fixed 2:1 dimetric; NW sunlight; compact down-right shadow','normalization':'One family scale, no per-heading silhouette stretching; premultiplied alpha mipmaps','review':'front/rear identity and transparent composition visually inspected'})
        (dest/'generation.json').write_text(json.dumps(provenance,indent=2)+'\n')
    fallback=ROOT/'assets/world/vehicles-regenerated-v3';fallback.mkdir(exist_ok=True)
    for size in [16,32,64,128,256]:
        sheet=Image.new('RGBA',(size*3,size*3))
        for index,kind in enumerate(['bus','truck','locomotive','coach','wagon','express-bus','ferry','cargo-ship','tanker']):
            im=Image.open(ROOT/'assets/world'/f'vehicle-{kind}-regenerated-v3'/f'atlas-{size}.png');sheet.paste(im.crop((size*2,size*2,size*3,size*3)),(index%3*size,index//3*size))
        sheet.save(fallback/f'atlas-{size}.png')
        if size==256:sheet.save(fallback/'atlas.png')
    (fallback/'atlas.json').write_text(json.dumps({'columns':3,'rows':3,'cellSizes':[16,32,64,128,256],'masterCell':256,'order':['vehicle:'+k for k in ['bus','truck','locomotive','coach','wagon','express-bus','ferry','cargo-ship','tanker']]},indent=2)+'\n')
    (fallback/'generation.json').write_text(json.dumps({'source':'SE cells of the nine newly generated directional vehicle atlases','operation':'lossless cell copy','date':'2026-10-07'},indent=2)+'\n')
    for name,folder,ids,shared in [
      ('cargo','cargo-regenerated-v3',['cargo:'+k for k in ['coal','ore','timber','grain','crates','steel','barrels','glass','fish']],False),
      ('portals-transparent','isometric-portals-regenerated-v3',['portal:'+k for k in ['road-e','road-s','road-w','road-n','rail-e','rail-s','rail-w','rail-n']]+[None],True)]:
        dest=ROOT/'assets/world'/folder;provenance=record_source(jobs[name],dest);source=dest/'source-generated.png'
        if name=='cargo':
            im=Image.open(source).convert('RGBA');registered=Image.new('RGBA',(1536,1536))
            xs=[0,440,870,1300];ys=[0,450,835,1210]
            for row in range(3):
                for col in range(3):
                    cut=im.crop((xs[col],ys[row],xs[col+1],ys[row+1]));registered.paste(cut,(col*512+(512-cut.width)//2,row*512+(512-cut.height)//2))
            source=dest/'source-registered.png';registered.save(source)
        pack(source,dest,ids,shared)
        (dest/'generation.json').write_text(json.dumps(provenance,indent=2)+'\n')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('jobs',nargs='?',default=str(ROOT/'assets/world/transport-regeneration-jobs.json'));main(parser.parse_args().jobs)
