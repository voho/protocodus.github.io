#!/usr/bin/env python3
"""Reproduce registered isolated imagegen frames inside a retained source sheet.

A recipe supplies measured physical scale and ground translation for each entire
original frame. No silhouette fitting, repainting, alpha key or axis distortion.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageChops


def affine_frame(raw, size, scale, translation):
    box = (-translation[0] / scale, -translation[1] / scale,
           (size[0] - translation[0]) / scale, (size[1] - translation[1]) / scale)
    pads = [max(0, math.ceil(-box[0])), max(0, math.ceil(-box[1])),
            max(0, math.ceil(box[2] - raw.width)), max(0, math.ceil(box[3] - raw.height))]
    padded = Image.new('RGBa', (raw.width + pads[0] + pads[2], raw.height + pads[1] + pads[3]))
    padded.paste(raw.convert('RGBa'), (pads[0], pads[1]))
    window = (box[0] + pads[0], box[1] + pads[1], box[2] + pads[0], box[3] + pads[1])
    return padded.resize(size, Image.Resampling.LANCZOS, box=window).convert('RGBA')


def assemble(recipe_path, output):
    recipe = json.loads(recipe_path.read_text())
    root = recipe_path.parent
    sheet = Image.open(root / recipe['baseSource']).convert('RGBA')
    for cell in recipe['replacements']:
        sheet.paste((0, 0, 0, 0), tuple(cell['clearSourceBounds']))
    for cell in recipe['replacements']:
        raw = Image.open(root / cell['source']).convert('RGBA')
        if list(raw.size) != cell['originalSourceDimensions']:
            raise ValueError('Original source dimensions changed')
        scale, translation = cell['sourceToSheetScale'], cell['sourceToSheetTranslation']
        meaningful = raw.getchannel('A').point(lambda alpha: 255 if alpha > 2 else 0).getbbox()
        if meaningful:
            projected = [meaningful[i] * scale + translation[i % 2] for i in range(4)]
            if projected[0] < 0 or projected[1] < 0 or projected[2] > sheet.width or projected[3] > sheet.height:
                raise ValueError('Entire generated frame must retain all meaningful source pixels')
        layer = affine_frame(raw, sheet.size, scale, translation)
        overlap = ImageChops.multiply(sheet.getchannel('A'), layer.getchannel('A'))
        if sum(overlap.histogram()[9:]):
            raise ValueError('Replacement overlaps a neighboring retained sprite')
        sheet.alpha_composite(layer)
    sheet.save(output, optimize=True)
    return {'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'replacements': len(recipe['replacements'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(assemble(args.recipe, args.output), indent=2))
