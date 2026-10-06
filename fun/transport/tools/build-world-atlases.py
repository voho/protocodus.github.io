#!/usr/bin/env python3
"""Pack a generated transparent sprite sheet into isolated 256px masters and LODs.

Example: --atlas image.png --columns 3 --rows 3 --ids 'pine,birch,oak,...'
         --output-dir assets/world/trees-taiga --anchor bottom --max-cell 128
Use '-' for an unused cell. --aligned preserves the sheet's cell registration.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('house_pipeline', Path(__file__).with_name('build-house-atlases.py'))
house = importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)

def principal_length(image):
    """Measure a hull along its principal axis; diagonal views must not grow."""
    alpha = image.getchannel('A')
    points = [(x, y) for y in range(0, image.height, 2) for x in range(0, image.width, 2) if alpha.getpixel((x, y)) >= 64]
    if not points:
        raise ValueError('Vehicle has no opaque body')
    mx = sum(x for x, y in points) / len(points)
    my = sum(y for x, y in points) / len(points)
    xx = sum((x-mx)**2 for x, y in points)
    yy = sum((y-my)**2 for x, y in points)
    xy = sum((x-mx)*(y-my) for x, y in points)
    angle = .5 * math.atan2(2*xy, xx-yy)
    ux, uy = math.cos(angle), math.sin(angle)
    projected = [x*ux+y*uy for x, y in points]
    return max(projected)-min(projected)+2

def build(args):
    if args.preserve_grid_scale and not args.aligned:
        raise ValueError('--preserve-grid-scale requires --aligned')
    image = Image.open(args.atlas).convert('RGBA')
    ids = args.ids.split(',')
    if len(ids) != args.columns * args.rows or len(set(i for i in ids if i != '-')) != len([i for i in ids if i != '-']):
        raise ValueError('Provide one unique ID per grid cell; use - for unused cells')
    dest = Path(args.output_dir)
    dest.mkdir(parents=True, exist_ok=True)
    shared_scale = None
    if args.shared_scale:
        if args.aligned:
            raise ValueError('--shared-scale and --aligned are separate registration modes')
        # A fixed-camera turnaround has one world-to-pixel scale. In particular,
        # its north/south views must retain the source's depth foreshortening.
        # Fit the entire family once, never normalize each silhouette's length.
        scales = []
        for index, key in enumerate(ids):
            if key == '-':
                continue
            x, y = index % args.columns, index // args.columns
            source = image.crop((round(x * image.width / args.columns), round(y * image.height / args.rows), round((x+1)*image.width/args.columns), round((y+1)*image.height/args.rows)))
            left, top, right, bottom = house.trim_bounds(source)
            scales.extend((args.width / (right-left), args.height / (bottom-top)))
        shared_scale = min(scales)
    cells, records = [], []
    for index, key in enumerate(ids):
        x, y = index % args.columns, index // args.columns
        box = (round(x * image.width / args.columns), round(y * image.height / args.rows), round((x+1)*image.width/args.columns), round((y+1)*image.height/args.rows))
        source = image.crop(box)
        out = Image.new('RGBA', (256,256))
        if key == '-':
            cells.append(out); records.append({'id':None}); continue
        info = house.validate_source(source, key)
        bounds = house.trim_bounds(source)
        if args.aligned:
            clean = Image.new('RGBA', source.size)
            clean.paste(source.crop(bounds), bounds[:2])
            inset = 0 if args.preserve_grid_scale else 8
            size = 256 - inset * 2
            out.paste(house.resize_alpha(clean, (size,size)), (inset,inset))
        else:
            trimmed = source.crop(bounds)
            scale = shared_scale if shared_scale is not None else min(args.width / trimmed.width, args.height / trimmed.height)
            if args.vehicle and shared_scale is None:
                scale = min(scale, args.width / principal_length(trimmed))
            w,h = max(1,round(trimmed.width*scale)),max(1,round(trimmed.height*scale))
            top = 244-h if args.anchor == 'bottom' else (256-h)//2
            out.paste(house.resize_alpha(trimmed,(w,h)), ((256-w)//2,top))
        cells.append(out)
        safe = key.replace(':','_').replace('/','_')
        house.save_png(out, dest / 'sources' / f'{safe}.png')
        records.append({'id':key,'cell':index,'sourceBounds':list(box),'normalization':info,'bounds':list(house.alpha_bbox(out))})
    sizes = [16,32,64,128,256]
    for size in sizes:
        atlas = Image.new('RGBA',(args.columns*size,args.rows*size))
        for index,cell in enumerate(cells):
            sprite = cell if size==256 else house.resize_alpha(cell,(size,size))
            if size != 256 and not args.no_sharpen:
                sprite = house.sharpen_interior(sprite,size)
            atlas.paste(sprite,(index%args.columns*size,index//args.columns*size))
        house.save_png(atlas,dest / ('atlas.png' if size==256 else f'atlas-{size}.png'))
        if size == 256 and args.max_cell == 256:
            house.save_png(atlas,dest / 'atlas-256.png')
    metadata={'columns':args.columns,'rows':args.rows,'cellSizes':[s for s in sizes if s<=args.max_cell], 'masterCell':256,'vehicleLengthNormalized':args.vehicle and shared_scale is None,'order':[None if i=='-' else i for i in ids], 'source':Path(args.atlas).name,'sourceSha256':hashlib.sha256(Path(args.atlas).read_bytes()).hexdigest(),'sprites':records}
    if shared_scale is not None:
        metadata['sharedScale'] = shared_scale
        metadata['registration'] = 'One uniform family scale, centered per frame; source foreshortening preserved'
    if args.preserve_grid_scale:
        metadata['registration'] = 'Full parcel grid preserved; one source-cell scale, no per-silhouette fitting'
    metadata['mipSharpening'] = not args.no_sharpen
    (dest/'atlas.json').write_text(json.dumps(metadata,indent=2)+'\n')
    if args.qa:
        # Actual scale strips on the game's ground, with a magnified master row.
        qa=Image.new('RGB',(max(768,len(cells)*140),580),args.background)
        draw=ImageDraw.Draw(qa)
        for row,size in enumerate([128,64,32,16]):
            draw.text((8,row*144+4),f'{size}px',fill='#263b30')
            for index,cell in enumerate(cells):
                sprite=house.resize_alpha(cell,(size,size))
                qa.paste(sprite,(8+index*140,row*144+18),sprite)
        house.save_png(qa,Path(args.qa))
    print(json.dumps({'output':str(dest),'count':len([i for i in ids if i!='-']),'columns':args.columns,'rows':args.rows}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--atlas',required=True);p.add_argument('--columns',type=int,default=3);p.add_argument('--rows',type=int,default=3)
    p.add_argument('--ids',required=True);p.add_argument('--output-dir',required=True)
    p.add_argument('--anchor',choices=['bottom','center'],default='bottom');p.add_argument('--width',type=int,default=232);p.add_argument('--height',type=int,default=232)
    p.add_argument('--aligned',action='store_true');p.add_argument('--max-cell',type=int,choices=[128,256],default=128)
    p.add_argument('--preserve-grid-scale',action='store_true',help='With --aligned, preserve the complete physically calibrated parcel cell')
    p.add_argument('--no-sharpen',action='store_true',help='Prefilter clean low-detail artwork without sharpening tiny mip features')
    p.add_argument('--vehicle',action='store_true',help='Normalize body length along its principal axis across headings')
    p.add_argument('--shared-scale',action='store_true',help='Fit all frames with one common scale, preserving fixed-camera foreshortening')
    p.add_argument('--qa');p.add_argument('--background',default='#91a77a')
    build(p.parse_args())
