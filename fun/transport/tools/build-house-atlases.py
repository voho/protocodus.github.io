#!/usr/bin/env python3
"""Normalize nine transparent house sprites and build isolated mip atlases.

Usage:
  python3 tools/build-house-atlases.py --manifest /tmp/houses.json \
      --output-dir assets/houses --qa-dir /tmp/house-qa

Manifest (paths are relative to the manifest, or absolute):
  {"biomes": {"taiga": [
    {"id": "house-cheap-1", "path": "cottage.png"}, ... nine entries ...
  ]}}
Each biome can instead contain nine path strings in cheap/normal/expensive order.
Outputs are deterministic; source imagery must already have genuine transparency.
No colour keying, background removal, or artwork generation is performed here.
Cropping uses alpha > 8 plus two source pixels of padding, ignoring distant
invisible matte noise while preserving edge transparency and contact shadows.

For a generated biome variant of an existing aligned 3 × 3 master:
  python3 tools/build-house-atlases.py --atlas /tmp/tundra.png --biome tundra \
      --output-dir assets/houses --qa-dir /tmp/house-qa
This mode preserves full-cell framing and only resizes the individual cells.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import tempfile

from PIL import Image, ImageChops, ImageDraw

HOUSE_IDS = tuple(f"house-{tier}-{variant}" for tier in ("cheap", "normal", "expensive") for variant in (1, 2, 3))
BIOMES = {"taiga": "#78934d", "tundra": "#b6c2ad", "desert": "#cba869"}
WIDTHS = {"cheap": 208, "normal": 224, "expensive": 240}
CELL_SIZES = (256, 128, 64, 32, 16)
MASTER_SIZE = 256
GROUNDLINE = 240
MIN_MARGIN = 8
TRIM_ALPHA_THRESHOLD = 8
TRIM_SOURCE_PADDING = 2


def alpha_bbox(image: Image.Image, threshold: int = 0):
    return image.getchannel("A").point(lambda value: 255 if value > threshold else 0).getbbox()


def trim_bounds(image: Image.Image):
    """Ignore invisible alpha-matte specks while retaining a small edge cushion."""
    bounds = alpha_bbox(image, TRIM_ALPHA_THRESHOLD)
    if bounds is None:
        return None
    left, top, right, bottom = bounds
    return (max(0, left - TRIM_SOURCE_PADDING), max(0, top - TRIM_SOURCE_PADDING),
            min(image.width, right + TRIM_SOURCE_PADDING), min(image.height, bottom + TRIM_SOURCE_PADDING))


def validate_source(image: Image.Image, source: str) -> dict:
    """Fail obvious flattened backgrounds or cropped silhouettes before packing."""
    alpha = image.getchannel("A")
    bounds = alpha_bbox(image)
    if bounds is None or alpha.getextrema()[1] < 32:
        raise ValueError(f"{source}: the sprite is empty or nearly invisible")
    width, height = image.size
    if min(width, height) < 32:
        raise ValueError(f"{source}: source must be at least 32 × 32 pixels")
    histogram = alpha.histogram()
    transparent_fraction = sum(histogram[:3]) / (width * height)
    if transparent_fraction < .02:
        raise ValueError(f"{source}: no usable transparent background; supply a transparent PNG")
    # Genuine shadows can reach an edge. A mostly opaque edge, including white
    # frame/opaque sheet artifacts, is not a transparent standalone sprite.
    edges = [alpha.crop((0, 0, width, 1)), alpha.crop((0, height - 1, width, height)),
             alpha.crop((0, 0, 1, height)), alpha.crop((width - 1, 0, width, height))]
    if any(sum(edge.histogram()[32:]) > edge.width * edge.height * .12 for edge in edges):
        raise ValueError(f"{source}: artwork/background touches too much of an outer edge; inspect the alpha silhouette")
    if any(alpha.getpixel(point) > 8 for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))):
        raise ValueError(f"{source}: opaque corners suggest a flattened background or border")
    return {"originalSize": [width, height], "sourceBounds": list(trim_bounds(image)), "rawAlphaBounds": list(bounds), "trimAlphaThreshold": TRIM_ALPHA_THRESHOLD, "trimPadding": TRIM_SOURCE_PADDING, "transparentFraction": round(transparent_fraction, 6)}


def resize_alpha(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Filter premultiplied colours so transparent RGB cannot bleed into edges."""
    if image.size == size:
        return image.copy()
    return image.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def sharpen_interior(image: Image.Image, cell_size: int) -> Image.Image:
    """Keep painted masses quiet: mip filtering must not amplify tiny detail.

    Retain this helper for callers of the original preparation API. Independent
    premultiplied-alpha resampling already preserves the useful silhouette;
    sharpening made roof seams and planting specks compete at Region zoom.
    """
    return image.copy()


def normalize(image: Image.Image, house_id: str) -> tuple[Image.Image, dict]:
    bounds = trim_bounds(image)
    cropped = image.crop(bounds)
    width_limit = WIDTHS[house_id.split("-")[1]]
    scale = min(width_limit / cropped.width, (GROUNDLINE - MIN_MARGIN) / cropped.height)
    target = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    sprite = sharpen_interior(resize_alpha(cropped, target), MASTER_SIZE)
    offset = ((MASTER_SIZE - target[0]) // 2, GROUNDLINE - target[1])
    result = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    # Paste without an alpha mask. Supplying the same alpha as a mask would
    # square the transparency and weaken the integrated shadows.
    result.paste(sprite, offset)
    occupied = alpha_bbox(result)
    margins = [occupied[0], occupied[1], MASTER_SIZE - occupied[2], MASTER_SIZE - occupied[3]]
    if min(margins) < MIN_MARGIN:
        raise ValueError(f"{house_id}: normalized sprite violates the {MIN_MARGIN}-pixel safety margin")
    return result, {"normalizedBounds": list(occupied), "drawSize": list(target), "offset": list(offset), "groundline": GROUNDLINE, "widthLimit": width_limit}


def pack_cells(cells: list[Image.Image], cell_size: int) -> tuple[Image.Image, list[Image.Image]]:
    atlas = Image.new("RGBA", (cell_size * 3, cell_size * 3), (0, 0, 0, 0))
    mip_cells = []
    for index, cell in enumerate(cells):
        mip = cell.copy() if cell_size == MASTER_SIZE else sharpen_interior(resize_alpha(cell, (cell_size, cell_size)), cell_size)
        if alpha_bbox(mip, 16) is None:
            raise ValueError(f"{HOUSE_IDS[index]}: empty {cell_size}-pixel mip cell")
        mip_cells.append(mip)
        atlas.paste(mip, ((index % 3) * cell_size, (index // 3) * cell_size))
    return atlas, mip_cells


def save_png(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=False, compress_level=9)


def contact_sheet(biome: str, levels: dict[int, list[Image.Image]]) -> Image.Image:
    """Show each mip at its physical pixel size, without browser interpolation."""
    margin, gap = 20, 16
    width = margin * 2 + MASTER_SIZE * 3 + gap * 2
    master_height = 38 + 3 * (MASTER_SIZE + 27)
    lower_height = sum(size + 58 for size in (64, 32, 16))
    sheet = Image.new("RGB", (width, master_height + lower_height + margin), "#1c252a")
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 12), f"{biome.upper()} / 256 px source cells / actual pixel sizes", fill="#f2eedf")
    for index, cell in enumerate(levels[256]):
        x, y = margin + (index % 3) * (256 + gap), 38 + (index // 3) * (256 + 27)
        draw.rectangle((x, y, x + 255, y + 255), fill=BIOMES[biome])
        sheet.paste(cell, (x, y), cell.getchannel("A"))
        draw.text((x, y + 261), HOUSE_IDS[index], fill="#e1dfd2")
    y = master_height
    for size in (64, 32, 16):
        draw.text((margin, y + 8), f"{size} px per cell / cheap 1-3, normal 1-3, expensive 1-3", fill="#f2eedf")
        y += 28
        x = margin
        for index in range(9):
            cell = levels[size][index]
            draw.rectangle((x, y, x + size - 1, y + size - 1), fill=BIOMES[biome])
            sheet.paste(cell, (x, y), cell.getchannel("A"))
            x += size + gap
        y += size + 30
    return sheet


def physical_strip(biome: str, levels: dict[int, list[Image.Image]], size: int) -> Image.Image:
    gap, margin = 12, 16
    image = Image.new("RGB", (margin * 2 + 9 * size + 8 * gap, size + 70), "#1c252a")
    draw = ImageDraw.Draw(image)
    draw.text((margin, 12), f"{biome.upper()} / {size} px / cheap 1-3, normal 1-3, expensive 1-3", fill="#f2eedf")
    for index, cell in enumerate(levels[size]):
        x = margin + index * (size + gap)
        draw.rectangle((x, 36, x + size - 1, 36 + size - 1), fill=BIOMES[biome])
        image.paste(cell, (x, 36), cell.getchannel("A"))
    return image


def load_manifest(path: Path) -> dict[str, list[tuple[str, Path]]]:
    manifest = json.loads(path.read_text())
    entries = manifest.get("biomes")
    if not isinstance(entries, dict) or not entries:
        raise ValueError("manifest must contain a nonempty 'biomes' object")
    output = {}
    for biome, houses in entries.items():
        if biome not in BIOMES:
            raise ValueError(f"unknown biome: {biome}")
        if not isinstance(houses, list) or len(houses) != len(HOUSE_IDS):
            raise ValueError(f"{biome}: expected exactly nine house entries")
        by_id = {}
        for index, entry in enumerate(houses):
            if not isinstance(entry, (str, dict)):
                raise ValueError(f"{biome}: entry {index + 1} must be a path or an id/path object")
            house_id, filename = (HOUSE_IDS[index], entry) if isinstance(entry, str) else (entry.get("id"), entry.get("path"))
            if house_id not in HOUSE_IDS or house_id in by_id or not isinstance(filename, str):
                raise ValueError(f"{biome}: invalid, duplicate or missing house id/path at entry {index + 1}")
            source = Path(filename).expanduser()
            by_id[house_id] = source if source.is_absolute() else path.parent / source
        output[biome] = [(house_id, by_id[house_id]) for house_id in HOUSE_IDS]
    return output


def atlas_name(size: int) -> str:
    return "house-atlas.png" if size == MASTER_SIZE else f"house-atlas-{size}.png"


def aligned_atlas_cells(path: Path, normalize_cells=False, preserve_grid_scale=False) -> tuple[list[Image.Image], list[dict]]:
    """Split an edited atlas and preserve common framing across its nine cells."""
    with Image.open(path) as opened:
        if opened.format != "PNG":
            raise ValueError(f"{path}: expected PNG input")
        image = opened.convert("RGBA")
    if image.width != image.height or image.width < 768:
        raise ValueError(f"{path}: aligned 3 × 3 atlas must be square and at least 768 pixels wide")
    inputs, records = [], []
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    for index, house_id in enumerate(HOUSE_IDS):
        column, row = index % 3, index // 3
        bounds = (round(column * image.width / 3), round(row * image.height / 3), round((column + 1) * image.width / 3), round((row + 1) * image.height / 3))
        cell = image.crop(bounds)
        info = validate_source(cell, f"{path} / {house_id}")
        raw = alpha_bbox(cell)
        raw_margin = min(raw[0], raw[1], cell.width - raw[2], cell.height - raw[3])
        trimmed_matte = raw_margin < MIN_MARGIN * cell.width / MASTER_SIZE
        if trimmed_matte:
            # Generated edits may scatter alpha 1–7 specks into empty padding.
            # Clear only outside the meaningful bounds, retaining the complete
            # crop (including all its original shadow/edge alpha) in place.
            visible = trim_bounds(cell)
            clean = Image.new("RGBA", cell.size, (0, 0, 0, 0))
            clean.paste(cell.crop(visible), visible[:2])
            cell = clean
        inputs.append(cell)
        records.append({"id": house_id, "source": path.name, "sourceSha256": digest, **info, "inputMode": "aligned-atlas", "atlasBounds": list(bounds), "trimmedInvisibleMatte": trimmed_matte, "groundline": GROUNDLINE, "widthLimit": WIDTHS[house_id.split("-")[1]]})
    if normalize_cells:
        cells = []
        for cell, house_id, record in zip(inputs, HOUSE_IDS, records):
            normalized, placement = normalize(cell, house_id)
            cells.append(normalized)
            record.update({**placement, "inputMode": "normalized-atlas"})
        return cells, records
    if preserve_grid_scale:
        cells = [resize_alpha(cell, (MASTER_SIZE, MASTER_SIZE)) for cell in inputs]
        for normalized, record in zip(cells, records):
            occupied = alpha_bbox(normalized, TRIM_ALPHA_THRESHOLD)
            margins = [occupied[0], occupied[1], MASTER_SIZE - occupied[2], MASTER_SIZE - occupied[3]]
            if min(margins) < MIN_MARGIN:
                raise ValueError(f"{path} / {record['id']}: calibrated grid has insufficient padding; register full silhouettes without per-object fitting")
            record.update({"normalizedBounds": list(alpha_bbox(normalized)), "drawSize": [MASTER_SIZE, MASTER_SIZE], "offset": [0, 0], "atlasCellTransform": {"scale": 1, "translate": [0, 0]}, "preserveGridScale": True})
        return cells, records
    # Keep one shared affine transform for every house in a biome. This avoids
    # moving individual windows around when new snow/foliage expands a sprite.
    for inset in range(17):
        draw_size = MASTER_SIZE - inset * 2
        cells = []
        for cell in inputs:
            sprite = cell.copy() if cell.size == (draw_size, draw_size) else sharpen_interior(resize_alpha(cell, (draw_size, draw_size)), MASTER_SIZE)
            normalized = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
            normalized.paste(sprite, (inset, inset))
            occupied = alpha_bbox(normalized)
            margins = [occupied[0], occupied[1], MASTER_SIZE - occupied[2], MASTER_SIZE - occupied[3]]
            if min(margins) < MIN_MARGIN:
                break
            cells.append(normalized)
        if len(cells) == len(HOUSE_IDS):
            for normalized, record in zip(cells, records):
                record.update({"normalizedBounds": list(alpha_bbox(normalized)), "drawSize": [draw_size, draw_size], "offset": [inset, inset], "atlasCellTransform": {"scale": draw_size / MASTER_SIZE, "translate": [inset, inset]}})
            return cells, records
    raise ValueError(f"{path}: the biome atlas requires more than a 16-pixel common inset; inspect source framing")


def generated_atlas_cells(path: Path, source_grid_padding=1.1) -> tuple[list[Image.Image], list[dict]]:
    """Register complete generated silhouettes using one physical grid scale.

    Generation sometimes places a fence a few pixels across a nominal gutter.
    Disconnected alpha assigns those pixels to their original plot. Only
    translation varies per plot; all nine retain the same scale, including the
    smaller doors painted for two-tile prestige gardens. Declared source-grid
    padding protects fences and their antialiased edges without bounding-box
    fitting. No artwork colours or alpha values are reconstructed.
    """
    import numpy as np
    from scipy.ndimage import distance_transform_edt, find_objects, label

    with Image.open(path) as opened:
        if opened.format != "PNG":
            raise ValueError(f"{path}: expected PNG input")
        source = np.asarray(opened.convert("RGBA"))
    height, width = source.shape[:2]
    if width != height or width < 768:
        raise ValueError(f"{path}: generated house sheet must be a square 3 × 3 atlas")
    meaningful = source[:, :, 3] > TRIM_ALPHA_THRESHOLD
    labels, _ = label(meaningful, np.ones((3, 3)))
    counts = np.bincount(labels.ravel())
    slices = find_objects(labels)
    components = [i for i in range(1, len(counts)) if counts[i] > width * height * .001]
    owner = np.zeros(labels.shape, np.int16)
    slots = set()
    partitions = []
    if len(components) == 9:
        for component in components:
            ys, xs = slices[component - 1]
            column = min(2, int((xs.start + xs.stop) / 2 / width * 3))
            row = min(2, int((ys.start + ys.stop) / 2 / height * 3))
            identity = row * 3 + column + 1
            if identity in slots:
                raise ValueError(f"{path}: two plots occupy slot {identity}")
            slots.add(identity)
            owner[labels == component] = identity
    elif 6 <= len(components) < 9:
        # Two complete perimeter fence tips can touch through a one-pixel alpha
        # bridge. Partition at the least occupied vertical gutter in that row,
        # without deleting, duplicating, repainting or scaling any source pixel.
        # Broad overlapping plots remain invalid and require generation repair.
        rows = [[] for _ in range(3)]
        for component in components:
            ys, _ = slices[component - 1]
            if ys.stop - ys.start > height / 3:
                raise ValueError(f"{path}: overlapping atlas rows require generation repair")
            rows[min(2, int((ys.start + ys.stop) / 2 / height * 3))].append(component)
        for row, row_components in enumerate(rows):
            if not row_components:
                raise ValueError(f"{path}: row {row + 1} contains no complete garden plots")
            major = np.isin(labels, row_components)
            occupancy = major.sum(axis=0)
            seams = []
            for column in (1, 2):
                nominal = width * column / 3
                candidates = range(round(nominal-width/18), round(nominal+width/18))
                seam = min(candidates, key=lambda x: (occupancy[x], abs(x-nominal)))
                if occupancy[seam] > 12:
                    raise ValueError(f"{path}: broad joined plots in row {row + 1} require generation repair")
                seams.append(seam)
            partitions.append({"row": row, "verticalSeams": seams, "bridgePixels": [int(occupancy[x]) for x in seams]})
            for column, (left, right) in enumerate(zip([0, *seams], [*seams, width])):
                segment = major[:, left:right]
                identity = row * 3 + column + 1
                if int(segment.sum()) < width * height * .001:
                    raise ValueError(f"{path}: slot {identity} is not a complete plot")
                owner[:, left:right][segment] = identity
                slots.add(identity)
    else:
        raise ValueError(f"{path}: expected nine garden plots, found {len(components)} major silhouettes")
    _, nearest = distance_transform_edt(owner == 0, return_indices=True)
    owner = owner[nearest[0], nearest[1]]
    if not 1 <= source_grid_padding <= 1.25:
        raise ValueError("source grid padding must be between 1 and 1.25")
    source_cell = width / 3
    registered_cell = round(source_cell * source_grid_padding)
    shared_scale = MASTER_SIZE / registered_cell
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    cells, records, preserved = [], [], 0
    for index, house_id in enumerate(HOUSE_IDS):
        mask = meaningful & (owner == index + 1)
        ys, xs = np.nonzero(mask)
        x0, y0 = max(0, int(xs.min()) - 2), max(0, int(ys.min()) - 2)
        x1, y1 = min(width, int(xs.max()) + 3), min(height, int(ys.max()) + 3)
        crop = source[y0:y1, x0:x1].copy()
        crop[owner[y0:y1, x0:x1] != index + 1] = 0
        preserved += int((crop[:, :, 3] > TRIM_ALPHA_THRESHOLD).sum())
        original = Image.fromarray(crop)
        target = (round(original.width * shared_scale), round(original.height * shared_scale))
        sprite = resize_alpha(original, target)
        offset = ((MASTER_SIZE - target[0]) // 2, GROUNDLINE - target[1])
        cell = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE))
        cell.paste(sprite, offset)
        bounds = alpha_bbox(cell, TRIM_ALPHA_THRESHOLD)
        margins = [bounds[0], bounds[1], MASTER_SIZE - bounds[2], MASTER_SIZE - bounds[3]]
        if min(margins) < MIN_MARGIN:
            raise ValueError(f"{path} / {house_id}: full plot exceeds calibrated grid; regenerate generous gutters")
        cells.append(cell)
        records.append({"id": house_id, "source": path.name, "sourceSha256": digest,
                        "inputMode": "registered-generated-grid", "sourceBounds": [x0, y0, x1, y1],
                        "originalSize": [width, height], "sourceCellSize": source_cell,
                        "sourceGridPadding": source_grid_padding,
                        "registeredCellSize": registered_cell, "sharedSourceScale": shared_scale,
                        "drawSize": list(target), "offset": list(offset), "groundline": GROUNDLINE,
                        "normalizedBounds": list(alpha_bbox(cell)), "preserveGridScale": True,
                        "atlasCellTransform": {"scale": 1, "translate": [0, 0]},
                        "meaningfulSourcePixels": int(mask.sum())})
        if partitions:
            records[-1]["sourceGutterPartitions"] = partitions
    if preserved != int(meaningful.sum()):
        raise ValueError(f"{path}: a meaningful generated pixel was lost or duplicated during registration")
    return cells, records


def build(manifest_path: Path | None, output_dir: Path, qa_dir: Path | None, validate_only=False, atlas_path: Path | None = None, atlas_biome: str | None = None, normalize_atlas=False, preserve_grid_scale=False, generated_atlas=False, source_grid_padding=1.1) -> dict:
    jobs = {atlas_biome: []} if atlas_path else load_manifest(manifest_path)
    reports = {}
    for biome, houses in jobs.items():
        cells, records = (generated_atlas_cells(atlas_path, source_grid_padding) if generated_atlas else aligned_atlas_cells(atlas_path, normalize_atlas, preserve_grid_scale)) if atlas_path else ([], [])
        for house_id, source in houses:
            with Image.open(source) as opened:
                if opened.format != "PNG":
                    raise ValueError(f"{source}: expected PNG input")
                image = opened.convert("RGBA")
            info = validate_source(image, str(source))
            normalized, placement = normalize(image, house_id)
            records.append({"id": house_id, "source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), **info, **placement})
            cells.append(normalized)
        levels, atlases = {}, {}
        for size in CELL_SIZES:
            atlases[size], levels[size] = pack_cells(cells, size)
        metadata = {"version": 2 if preserve_grid_scale else 1, "biome": biome, "columns": 3, "rows": 3, "cellSizes": list(CELL_SIZES), "groundline": GROUNDLINE, "masterCellSize": MASTER_SIZE, "order": list(HOUSE_IDS), "houses": records, "mipFilter": "independent premultiplied-alpha Lanczos; no sharpening"}
        if not validate_only:
            destination = output_dir / biome
            for house_id, cell in zip(HOUSE_IDS, cells):
                save_png(cell, destination / "sources" / f"{house_id}.png")
            for size, atlas in atlases.items():
                save_png(atlas, destination / atlas_name(size))
            (destination / "atlas.json").write_text(json.dumps(metadata, indent=2) + "\n")
            if qa_dir:
                save_png(contact_sheet(biome, levels), qa_dir / f"{biome}-contact-sheet.png")
                for size in (128, 64, 32, 16):
                    save_png(physical_strip(biome, levels, size), qa_dir / f"{biome}-{size}px.png")
        reports[biome] = {"houses": len(cells), "atlasSizes": [size * 3 for size in CELL_SIZES], "output": str(output_dir / biome), "minimumMasterMargin": min(min(record["normalizedBounds"][0], record["normalizedBounds"][1], 256 - record["normalizedBounds"][2], 256 - record["normalizedBounds"][3]) for record in records)}
    return reports


def self_test():
    """Exercise trimming, opacity, bleed, preservation, ordering and repeatability."""
    with tempfile.TemporaryDirectory(prefix="transport-house-atlases-") as temporary:
        directory = Path(temporary)
        entries = []
        for index, house_id in enumerate(HOUSE_IDS):
            image = Image.new("RGBA", (360, 400), (255, 255, 255, 0))
            draw = ImageDraw.Draw(image)
            draw.ellipse((75, 280, 310, 340), fill=(0, 0, 0, 72))
            draw.rectangle((90, 100, 290, 290), fill=(200 if index % 3 == 0 else 30, 190 if index % 3 == 1 else 40, 210 if index % 3 == 2 else 35, 255))
            source = directory / f"{house_id}.png"
            save_png(image, source)
            entries.append({"id": house_id, "path": source.name})
            noisy = image.copy()
            noisy.putpixel((0, 0), (255, 255, 255, 1))
            noisy.putpixel((359, 399), (255, 255, 255, 7))
            clean_cell, clean_placement = normalize(image, house_id)
            noisy_cell, noisy_placement = normalize(noisy, house_id)
            assert clean_cell.tobytes() == noisy_cell.tobytes() and clean_placement == noisy_placement, "invisible distant matte specks must not shrink a house"
            before_alpha = image.getchannel("A")
            after_alpha = sharpen_interior(image, 64).getchannel("A")
            assert ImageChops.difference(before_alpha, after_alpha).getbbox() is None, "sharpening must preserve opacity"
        manifest = directory / "inputs.json"
        manifest.write_text(json.dumps({"biomes": {"taiga": list(reversed(entries))}}))
        build(manifest, directory / "first", directory / "qa")
        build(manifest, directory / "second", None)
        build(None, directory / "aligned", None, atlas_path=directory / "first" / "taiga" / "house-atlas.png", atlas_biome="tundra")
        for size in CELL_SIZES:
            first = directory / "first" / "taiga" / atlas_name(size)
            assert first.read_bytes() == (directory / "aligned" / "tundra" / first.name).read_bytes(), "aligned atlas cells must preserve original framing and pixels"
            assert first.read_bytes() == (directory / "second" / "taiga" / first.name).read_bytes(), "packing must be reproducible"
            with Image.open(first) as atlas:
                assert atlas.size == (size * 3, size * 3)
                for index, house_id in enumerate(HOUSE_IDS):
                    with Image.open(directory / "first" / "taiga" / "sources" / f"{house_id}.png") as source:
                        expected = source.copy() if size == 256 else sharpen_interior(resize_alpha(source, (size, size)), size)
                    x, y = index % 3 * size, index // 3 * size
                    actual = atlas.crop((x, y, x + size, y + size))
                    assert ImageChops.difference(actual, expected).convert("RGB").getbbox() is None and ImageChops.difference(actual.getchannel("A"), expected.getchannel("A")).getbbox() is None, "mips must never mix neighboring cells"
                    assert actual.getchannel("A").getpixel((0, 0)) == 0
        with Image.open(directory / "first" / "taiga" / "house-atlas.png") as source:
            edited = source.convert("RGBA")
        for index in range(9):
            edited.putpixel((index % 3 * 256, index // 3 * 256), (255, 255, 255, 1))
        ImageDraw.Draw(edited).rectangle((4, 224, 6, 227), fill=(40, 110, 50, 255))
        edited_path = directory / "variant.png"
        save_png(edited, edited_path)
        inset_cells, inset_records = aligned_atlas_cells(edited_path)
        transforms = {json.dumps(record["atlasCellTransform"], sort_keys=True) for record in inset_records}
        assert len(transforms) == 1 and inset_records[0]["offset"][0] > 0, "variant safety insets must be shared across every cell"
        for cell in inset_cells:
            left, top, right, bottom = alpha_bbox(cell)
            assert min(left, top, 256 - right, 256 - bottom) >= MIN_MARGIN
        # Full generated plots can differ in silhouette width while doors keep
        # one physical calibration. A per-object fit would silently change it.
        generated = Image.new("RGBA", (1026, 1026))
        draw = ImageDraw.Draw(generated)
        for index in range(9):
            cx, cy = index % 3 * 342 + 171, index // 3 * 342 + 220
            plot_width = 220 + index * 4
            draw.polygon([(cx, cy-65), (cx+plot_width//2, cy), (cx, cy+65), (cx-plot_width//2, cy)], fill=(140, 157, 68, 255))
            door_height = 28 if index < 6 else 14
            draw.rectangle((cx-18, cy-48, cx+18, cy+2), fill=(201, 180, 142, 255))
            draw.rectangle((cx-4, cy+2-door_height, cx+4, cy+2), fill=(27, 39, 52, 255))
        generated_path = directory / "calibrated.png"
        save_png(generated, generated_path)
        generated_cells, generated_records = generated_atlas_cells(generated_path)
        assert len({record["sharedSourceScale"] for record in generated_records}) == 1, "every plot must retain one shared source grid scale"
        assert generated_records[0]["drawSize"][0] < generated_records[-1]["drawSize"][0], "different parcel silhouettes must not be independently fitted to equal widths"
        door_heights = []
        for cell in generated_cells:
            dark = cell.convert("RGB")
            alpha = cell.getchannel("A")
            ys = [y for y in range(256) for x in range(120, 137) if alpha.getpixel((x,y)) > 240 and sum(dark.getpixel((x,y))) < 140]
            door_heights.append(max(ys)-min(ys)+1)
        assert min(door_heights[:6]) >= max(door_heights[6:]) * 1.7, "two-tile source doors must remain half the one-tile cell height"
        assert min(door_heights[:6]) / max(door_heights[6:]) <= 2.3, "registration must preserve, not exaggerate, the shared human scale"
        # Thin touching fence tips must be separated by pixel ownership alone.
        # This fixture connects the three bottom parcels through one-pixel ink.
        draw.line((292, 904, 391, 904), fill=(140, 157, 68, 255), width=1)
        draw.line((636, 904, 731, 904), fill=(140, 157, 68, 255), width=1)
        save_png(generated, generated_path)
        bridge_cells, bridge_records = generated_atlas_cells(generated_path)
        assert len(bridge_cells) == 9 and bridge_records[6]["sourceGutterPartitions"], "joined fence tips must retain nine registered plots"
        source_count = sum(generated.getchannel("A").histogram()[TRIM_ALPHA_THRESHOLD+1:])
        assert sum(record["meaningfulSourcePixels"] for record in bridge_records) == source_count, "gutter partitioning must preserve every meaningful source pixel exactly once"
        try:
            validate_source(Image.new("RGBA", (256, 256), (255, 255, 255, 255)), "opaque sheet")
        except ValueError:
            pass
        else:
            raise AssertionError("opaque artwork must be rejected")
        try:
            validate_source(Image.new("RGBA", (256, 256)), "empty cell")
        except ValueError:
            pass
        else:
            raise AssertionError("empty artwork must be rejected")
    print("House atlas self-test passed: alpha, margins, order, isolated mips and deterministic files.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--atlas", type=Path, help="An aligned transparent 3 × 3 biome-variant atlas; preserves cell framing")
    parser.add_argument("--normalize-atlas", action="store_true", help="Normalize each atlas cell using the same tier sizes and groundline as standalone sources")
    parser.add_argument("--preserve-grid-scale", action="store_true", help="Preserve complete registered cell calibration; never fit a sprite or automatically inset the grid")
    parser.add_argument("--generated-atlas", action="store_true", help="Register all nine generated alpha silhouettes at one shared source-grid scale, never per-object fit")
    parser.add_argument("--source-grid-padding", type=float, default=1.1, help="One explicit uniform registration cushion for the entire generated sheet; use 1 for sources with generation-time padding")
    parser.add_argument("--biome", choices=BIOMES, help="Required with --atlas")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "houses")
    parser.add_argument("--qa-dir", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if bool(args.manifest) == bool(args.atlas):
        parser.error("provide exactly one of --manifest or --atlas")
    if args.atlas and not args.biome:
        parser.error("--biome is required with --atlas")
    if args.preserve_grid_scale and (not args.atlas or args.normalize_atlas):
        parser.error("--preserve-grid-scale requires --atlas and cannot be combined with --normalize-atlas")
    if args.generated_atlas and (not args.atlas or args.normalize_atlas):
        parser.error("--generated-atlas requires --atlas and cannot be combined with --normalize-atlas")
    try:
        result = build(args.manifest.resolve() if args.manifest else None, args.output_dir, args.qa_dir, args.validate_only, args.atlas, args.biome, args.normalize_atlas, args.preserve_grid_scale, args.generated_atlas, args.source_grid_padding)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"House atlas build failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
