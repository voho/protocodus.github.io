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

from PIL import Image, ImageChops, ImageDraw, ImageFilter

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
    """A small detail lift, strictly inside opaque pixels; never sharpen alpha."""
    radius = .35 if cell_size <= 32 else .5 if cell_size <= 64 else .6
    percent = 20 if cell_size <= 32 else 30 if cell_size <= 64 else 35
    alpha = image.getchannel("A")
    interior = alpha.point(lambda value: 255 if value >= 248 else 0).filter(ImageFilter.MinFilter(3))
    rgb = image.convert("RGB")
    sharpened = rgb.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3))
    result = Image.composite(sharpened, rgb, interior).convert("RGBA")
    result.putalpha(alpha)
    return result


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


def aligned_atlas_cells(path: Path) -> tuple[list[Image.Image], list[dict]]:
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


def build(manifest_path: Path | None, output_dir: Path, qa_dir: Path | None, validate_only=False, atlas_path: Path | None = None, atlas_biome: str | None = None) -> dict:
    jobs = {atlas_biome: []} if atlas_path else load_manifest(manifest_path)
    reports = {}
    for biome, houses in jobs.items():
        cells, records = aligned_atlas_cells(atlas_path) if atlas_path else ([], [])
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
        metadata = {"version": 1, "biome": biome, "columns": 3, "rows": 3, "cellSizes": list(CELL_SIZES), "groundline": GROUNDLINE, "masterCellSize": MASTER_SIZE, "order": list(HOUSE_IDS), "houses": records}
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
    try:
        result = build(args.manifest.resolve() if args.manifest else None, args.output_dir, args.qa_dir, args.validate_only, args.atlas, args.biome)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"House atlas build failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
