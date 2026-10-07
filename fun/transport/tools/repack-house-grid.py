#!/usr/bin/env python3
"""Pack generated houses from measured ground centres and human scale.

Input JSON records source-pixel ground centres, measured vertical door heights
and one shared source-to-master factor for each footprint tier. Resampling and
translation preserve the complete RGBA cutout; artwork is never warped,
repainted, sharpened or fitted to its silhouette. Use the atlas builder's
premultiplied-alpha mip packing after registration.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from PIL import Image

_spec = importlib.util.spec_from_file_location("house_atlas_builder", Path(__file__).with_name("build-house-atlases.py"))
builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(builder)


def repack(measurements: Path, destination: Path, qa_dir: Path | None = None):
    job = json.loads(measurements.read_text())
    source = Path(job["source"])
    if not source.is_absolute():
        source = measurements.parent / source
    with Image.open(source) as opened:
        if opened.format != "PNG":
            raise ValueError("source must be a PNG")
        image = opened.convert("RGBA")
    if image.width != image.height or image.width < 768:
        raise ValueError("source must be a square nine-cell atlas at least768px wide")
    entries = job["entries"]
    if [entry["id"] for entry in entries] != list(builder.HOUSE_IDS):
        raise ValueError("measurements must contain all nine house IDs in atlas order")
    scales = job["tierSourceScales"]
    regions = [entry.get("sourceRegion", [round(index % 3 * image.width / 3), round(index // 3 * image.height / 3),
                                         round((index % 3 + 1) * image.width / 3), round((index // 3 + 1) * image.height / 3)])
               for index, entry in enumerate(entries)]
    # A generated plot can cross a nominal atlas-row boundary. Measured empty
    # gutter partitions retain complete cutouts; all share one square source
    # canvas so integer raster sizes keep each footprint tier uniform.
    source_square = max(max(region[2] - region[0], region[3] - region[1]) for region in regions)
    cells, records = [], []
    preserved = 0
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    for index, entry in enumerate(entries):
        bounds = regions[index]
        raw = image.crop(bounds)
        source_info = builder.validate_source(raw, f"{source}/{entry['id']}")
        # Keep every meaningful edge/shadow pixel. Discard only distant
        # alpha1-7 generation matte exactly as the existing atlas packer does.
        visible = builder.trim_bounds(raw)
        clean = Image.new("RGBA", (source_square, source_square), (0, 0, 0, 0))
        clean.paste(raw.crop(visible), visible[:2])
        meaningful_source_pixels = sum(raw.getchannel("A").histogram()[builder.TRIM_ALPHA_THRESHOLD + 1:])
        preserved += meaningful_source_pixels
        footprint = 1 if index < 6 else 2
        intended_scale = float(scales[str(footprint)])
        if intended_scale <= 0:
            raise ValueError("tier scales must be positive")
        draw_size = max(1, round(source_square * intended_scale))
        actual_scale = draw_size / source_square
        centre = entry["groundCenterSource"]
        offset = (round(128 - centre[0] * actual_scale), round(192 - centre[1] * actual_scale))
        resampled = builder.resize_alpha(clean, (draw_size, draw_size))
        occupied = builder.alpha_bbox(resampled, builder.TRIM_ALPHA_THRESHOLD)
        placed_bounds = [occupied[0] + offset[0], occupied[1] + offset[1],
                         occupied[2] + offset[0], occupied[3] + offset[1]]
        if min(placed_bounds[0], placed_bounds[1], 256 - placed_bounds[2], 256 - placed_bounds[3]) < builder.MIN_MARGIN:
            raise ValueError(f"{entry['id']}: measured registration needs more gutter; do not fit/crop the silhouette")
        cell = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        cell.paste(resampled, offset)
        cells.append(cell)
        source_door_height = entry.get("doorHeightSourceMeasured")
        if source_door_height is None and entry.get("doorMeasurement", {}).get("personnelDoorObservable") is not False:
            raise ValueError(f"{entry['id']}: absent door measurement requires an explicitly unobservable entrance")
        records.append({**entry, **source_info, "source": source.name, "sourceSha256": digest,
                        "footprint": footprint, "atlasBounds": list(bounds),
                        "sourceRegion": list(bounds), "sourceSquareSize": source_square,
                        "meaningfulSourcePixels": meaningful_source_pixels,
                        "inputMode": "measured-ground-and-human-scale", "tierSourceScale": intended_scale,
                        "actualSourceScale": actual_scale, "drawSize": [draw_size, draw_size], "offset": list(offset),
                        "registeredGroundCenter": [centre[0] * actual_scale + offset[0], centre[1] * actual_scale + offset[1]],
                        "doorHeightMasterMeasured": None if source_door_height is None else round(source_door_height * actual_scale, 3),
                        "normalizedBounds": list(builder.alpha_bbox(cell)),
                        "normalizedMeaningfulBounds": list(builder.alpha_bbox(cell, builder.TRIM_ALPHA_THRESHOLD))})
    if preserved != sum(image.getchannel("A").histogram()[builder.TRIM_ALPHA_THRESHOLD + 1:]):
        raise ValueError("source region partitions lost or duplicated meaningful pixels")
    levels = {}
    destination.mkdir(parents=True, exist_ok=True)
    for size in builder.CELL_SIZES:
        atlas, levels[size] = builder.pack_cells(cells, size)
        builder.save_png(atlas, destination / builder.atlas_name(size))
    for house_id, cell in zip(builder.HOUSE_IDS, cells):
        builder.save_png(cell, destination / "sources" / f"{house_id}.png")
    metadata = {"version": 3, "biome": job["biome"], "design": job["design"], "rotation": job["rotation"],
                "columns": 3, "rows": 3, "cellSizes": list(builder.CELL_SIZES), "masterCellSize": 256,
                "groundCenterMaster": [128, 192], "order": list(builder.HOUSE_IDS), "houses": records,
                "registration": "measured physical garden centre; shared personnel-door calibration per footprint tier",
                "gardenGround": "transparent" if all(entry.get("bareGroundTransparent") for entry in entries) else "needs-source-review",
                "mipFilter": "independent premultiplied-alpha Lanczos; no sharpening", "measurements": measurements.name,
                "physicalCalibration": {"groundCenterMaster": [128, 192], "tileMetres": 16,
                                        "doorHeightMetres": 2.1, "sourceScalePolicy": "one uniform scale per footprint tier",
                                        "cells": [{"id": record["id"], "footprint": record["footprint"],
                                                   "sourceGroundCenter": record["groundCenterSource"],
                                                   "sourceRegion": record["sourceRegion"],
                                                   "sourceGroundVertices": record.get("groundVerticesSourceMeasured"),
                                                   "groundEdgeSlopesMeasured": record.get("groundEdgeSlopesMeasured"),
                                                   "sourceDoorMeasurement": record.get("doorMeasurement"),
                                                   "doorHeightSourceMeasured": record["doorHeightSourceMeasured"],
                                                   "doorHeightMasterMeasured": record["doorHeightMasterMeasured"],
                                                   "uniformScale": record["actualSourceScale"],
                                                   "translationMaster": record["offset"],
                                                   "registeredGroundCenter": record["registeredGroundCenter"],
                                                   "bareGroundTransparent": record.get("bareGroundTransparent", False),
                                                   "gardenGround": record.get("gardenGround", "needs-source-review"),
                                                   "foregroundGroundTransparentFraction": record.get("foregroundGroundTransparentFraction"),
                                                   "bounds": record["normalizedMeaningfulBounds"]} for record in records]}}
    (destination / "atlas.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if qa_dir:
        builder.save_png(builder.contact_sheet(job["biome"], levels), qa_dir / "contact-sheet.png")
        for size in (128, 64, 32, 16):
            builder.save_png(builder.physical_strip(job["biome"], levels, size), qa_dir / f"{size}px.png")
    return {"output": str(destination), "houses": len(cells), "groundCenterMaster": [128, 192],
            "sourceScales": scales, "doorHeightsMaster": [record["doorHeightMasterMeasured"] for record in records]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("measurements", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--qa-dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(repack(args.measurements, args.output, args.qa_dir), indent=2))
