# Transport sprite production

[sprite-art-direction.js](sprite-art-direction.js) is the single source of physical proportions, camera and building style. Every generated house, civic building, shop, mall, industry and farm core uses its `buildingGenerationPrompt()`. Native fallback drawings use the same `SPRITE_SCALE` and feature conversion helpers. Update that module when art direction changes, then update the documentation and affected assets together.

## Shared physical scale

The current visual scale is a 16 m tile, a 1.75 m person, a 2.1 m personnel door, a 3 m storey and a 4.2 m loading bay. `SPRITE_SCALE` also defines door width, window and fence height, runtime pixels per metre and the master-cell dimensions. These are visual proportions; simulation distances and route fares remain measured in tiles.

Use `featureWorldPixels()` for features in world space, `featureSpriteUnits()` for native drawing units and `featureMasterPixels()` for generated atlas cells. The last two account for footprint so that a door in a 5 × 5 factory and a door in a one-tile cottage have the same world height. The prompt builder prints the correct master-pixel dimensions for each entry. A vehicle loading bay is a larger opening with its own calibration.

Larger parcels contain additional rooms, wings, storeys or repeated bays. Doors, windows, fences, benches and other human features keep their dimensions. Keep houses small enough to leave space for their gardens and fences, and compare them with the game's trucks and buses.

All current industry plots are **5 × 5 tiles**, including extractors, processors, farms and optional food chains. Farms contain a **2 × 2 building core**, an access lane and surrounding fenced fields within that plot. A core-only generation entry describes the 2 × 2 architectural asset; a full farm entry describes the entire 5 × 5 parcel. Crop beds, corn or grain, orchard canopies and pasture masses distinguish farm kinds without shrinking their doors or enlarging their fences.

## Generate a prompt

Write a job with one entry per atlas slot, in row-major order. Empty slots are `null`. Each occupied entry supplies its id, footprint and a brief description of the large features that identify it. The shared builder supplies camera, climate, proportions and detail limits.

For example, from the repository root:

```sh
cat > /tmp/transport-building-job.json <<'JSON'
{
  "columns": 3,
  "rows": 1,
  "biome": "taiga",
  "entries": [
    {"id": "cottage", "name": "Small timber cottage", "footprint": 1, "description": "One storey, a broad pitched roof, a garden and a low fence."},
    {"id": "school", "name": "Village school", "footprint": 2, "description": "Two connected classroom wings and a clear central entrance."},
    {"id": "food-plant", "name": "Food plant", "footprint": 5, "description": "Low processing halls, a loading shed, two large loading bays and a yard."}
  ]
}
JSON
node fun/transport/tools/generate-building-prompt.mjs /tmp/transport-building-job.json /tmp/transport-building-prompt.json
```

The output contains the canonical scale snapshot, original job, complete prompt and `transparent_background: true`. Use that prompt for image generation, retain the job and prompt with the asset source records, and preserve existing source artwork when replacing a family. Climate changes materials and planting while physical dimensions and the fixed orthographic 2:1 dimetric camera remain consistent.

## Preserve scale while packing

Keep each complete parcel in its original cell, including transparent margins and disconnected architectural parts. A small building should occupy less of its parcel than a large building. Do not normalize by independently fitting each building's bounding box into the cell: that changes door, floor and fence sizes between families.

For calibrated aligned sheets, [tools/build-world-atlases.py](tools/build-world-atlases.py) supports `--aligned --preserve-grid-scale`. Preserve the registered ground anchor and the full parcel grid through preparation and packing. The `--shared-scale` mode serves fixed-camera turnarounds where all frames need one family scale; it is a separate registration mode. Regenerate the master and display densities after replacing a source, and keep the prompt and registration metadata with them.

Large industries also ship 512-pixel display cells for Town view on high-density displays. [tools/build-industry-high-density.py](tools/build-industry-high-density.py) builds these from the full calibrated registered sources, verifies the existing 256-pixel master, and preserves the lower-density sheets. Export the complete registered cell at every density; do not enlarge a low-resolution thumbnail or independently fit each building.

## Recognition at game zooms

Use a clean silhouette, broad roof and wall colours, readable facade shading and a few large openings. Keep useful identifiers such as silos, greenhouses, chimneys, loading sheds, shop awnings and sports surfaces. Group planting into clear masses. Omit individual brick joints, roof tiles, woodgrain scratches, tiny lettering, dense crate grids, fine handrails, window mullions and flower speckle.

Inspect every family at its actual **Region (0.5×)** and **Town (1×)** size, then check Detail (2×) and standard and Retina displays. Compare several building kinds side by side with a truck or bus. Door heights, storey heights and fences should agree; buildings should remain identifiable from their roof, mass and large features when small. Display density can sharpen an image, but it must not reintroduce detail that makes the Region view noisy.

Gardens blend into the climate's world ground. Stone foundations support buildings on slopes without an opaque sprite backdrop. Farm ground follows its site, and fences and field objects remain aligned with the world grid. Review loaded artwork and native fallbacks so that delayed assets do not change physical scale.

## Tree variety and registration

[tree-art-catalog.js](tree-art-catalog.js) defines 27 tree sprites per climate: the original nine plus eighteen additional species in two 3 × 3 atlases. Three additional hollow trees bring tundra to 30. Its `treeGenerationPrompt()` uses the shared metre scale and records each species' height. Generate a reproducible job with `node fun/transport/tools/generate-tree-prompt.mjs taiga 1 /tmp/transport-tree-job.json`. The same catalog provides `hollowTreeGenerationPrompt()` and `cactusGenerationPrompt()` for the hollow-tree and nine-cactus sheets.

Trees use the same 2:1 camera, northwest light and restrained painted materials as the buildings. Broad crown masses, visible trunk forks and distinct branch silhouettes replace individual leaves, needle lines, fruit dots and bark scratches. The new sprites contain a tiny contact shadow; the renderer projects the longer ground shadow separately.

At the nominal 22-unit tree size, a 256-pixel master uses about 19.72 pixels per vertical metre. Woodland sprites render 1:1 in world space; the 1.5× enlargement of building uprights does not apply to them. Shorter species remain shorter. Register each trunk at the shared 95.5% cell-height root anchor, using lossless translation and a common metre scale. If generated heights drift, uniformly calibrate a complete plant to its stated metre height while preserving its botanical proportions; record the measured crown-to-root height and calibration factor. Keep transparent gutters and preserve the full registered cell through `--aligned --preserve-grid-scale --no-sharpen` packing. Do not normalize different plants to one maximum bounding-box height or enlarge them to fill their cells.

Artwork selection uses the existing tree seeds. Two thirds of mature trees choose an additional species; original bare and juvenile variants remain available. Hollow trunks occur sparsely in tundra's bare woodland. Nine additional desert cacti vary existing cactus patches, from small barrels to tall branching cardons, at a shared 16-unit envelope and 32 master pixels per metre. Grove positions, saved terrain and world recipes remain stable. Generated-art shadows follow the selected species' physical height; unavailable-art fallbacks retain their original geometry. The Gallery previews each named tree and cactus directly.

## Saved worlds

Recipe 10 generates 5 × 5 industrial plots. Published recipes 1–9 stay frozen so procedural saves reconstruct their original geography: recipe 8 has 3 × 3 industries and recipe 9 has 3 × 3 factories with 7 × 7 farms. These historical dimensions do not define new construction.

Save migration version 3 expands smaller sites only into clear adjoining land while retaining their original occupied tiles. A 7 × 7 farm shrinks to a contained 5 × 5 plot only if every existing freight stop stays within reach. When a safe resize cannot fit, the saved site's original footprint remains. Preserve roads, buildings, stops, inventories and route connections; new construction and openings still use 5 × 5.

Transport supports computers only. Artwork and gameplay checks use desktop and laptop browsers; phones and tablets show `please use computer to play the game` before startup, as recorded in [AGENTS.md](AGENTS.md).
