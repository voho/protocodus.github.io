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

The output contains the canonical scale, registration and palette snapshots, original job, complete prompt and `transparent_background: true`. Use that prompt for image generation, retain the job and prompt with the asset source records, and preserve existing source artwork when replacing a family. Climate changes ground and planting while buildings share the same muted plaster, stone, brick, timber, slate and terracotta materials.

[tools/generate-building-reference.mjs](tools/generate-building-reference.mjs) produces a measured SVG guide with the exact camera, material swatches and physical doorway sizes for one-, two- and five-tile buildings:

```sh
node fun/transport/tools/generate-building-reference.mjs /tmp/transport-building-reference.svg taiga
```

Use this as a construction reference alongside an approved painted source. Ground edges follow slopes **+0.5 and -0.5** with vertical walls. Building, roof, fence, yard and court axes all follow those directions; a second house rotation swaps the two world axes. Measure both directions on the actual generated ground edges before accepting art. A descriptive prompt or metadata declaration does not prove the painted camera is correct.

Add `--houses --rotation=0` or `--houses --rotation=1` to produce a label-free 3 × 3 house construction sheet. These guides include calibrated houses, paths, shrubs and fences while leaving lawns transparent; the world supplies their ground surface.

## Preserve scale while packing

Keep each complete architectural cutout in its registered cell, including transparent margins and disconnected architectural parts. A small building should occupy less of its parcel than a large building. Do not normalize by independently fitting each building's bounding box into the cell: that changes door, floor and fence sizes between families.

The 256px building master maps to a **72px billboard per footprint tile**. The physical ground centre is **(128,192)**. A full 16m world tile projects to 64×32px and fits inside that frame with filtering margins. `buildingGroundEnvelope()` provides a **15m envelope per 16m tile**: about 213.33×106.67px in the master, centred on the registered point. Use the available width for additional architecture and useful garden or working-yard elements. Human features keep their original metre dimensions: widening a layout must not enlarge its doors or loading bays. Bare ground remains transparent and comes from the world texture. Store measured ground vertices/centre and vertical doorway edges; shadows, foliage and silhouette bottoms are not registration datums.

For calibrated aligned sheets, [tools/build-world-atlases.py](tools/build-world-atlases.py) supports `--aligned --preserve-grid-scale`. Preserve the physical ground anchor and calibrated frame through preparation and packing. The `--shared-scale` mode serves fixed-camera turnarounds where all frames need one family scale; it is a separate registration mode. Regenerate the master and display densities after replacing a source, and keep the prompt and registration metadata with them.

Current architectural sheets ship 512-pixel display cells for Town view on high-density displays. [tools/plot-building-jobs.mjs](tools/plot-building-jobs.mjs) records all building identities, plot sizes, designs and rotations. [tools/pack-plot-cutouts.py](tools/pack-plot-cutouts.py) preserves their complete RGBA cells, generates each density directly from the original source, and reports observed alpha, filtering margins and measured physical landmarks. Its reports distinguish pending source review from verified measurements; generated prompt numbers are not evidence of actual dimensions. Use `--measurements landmarks.json --register-ground` to register measured physical ground centres at the uniform sheet density. When the generated source has a different camera density, `--sheet-scale` accepts one measured scale for the entire sheet, with required `--scale-calibration` evidence of observed ground-axis endpoints and a designed physical span. Recheck observed doors after calibration; never fit individual silhouettes. An explicit `sourceBoundsSheet` rectangle can recover an isolated sprite that crosses a nominal row boundary; it changes extraction and translation, never the building scale. Packing rejects lost meaningful pixels and insufficient gutters and quantifies any discarded alpha-1/2 encoding noise. Neutral cutouts share one sheet across climates, so changing terrain does not change building materials or decode duplicate architecture. Historical assets retain their original 48px calibration. [tools/build-industry-high-density.py](tools/build-industry-high-density.py) maintains those historical industry sheets from their calibrated registered sources, verifies the existing 256-pixel master, and preserves the lower-density sheets. Export the complete registered cell at every density; do not enlarge a low-resolution thumbnail or independently fit each building.

The 2026-10-07 renewal replaces all 132 active plot sprites across 16 sheets, plus eight airport building parts, six stop/port sprites and the standalone railway station. Every plot entry has observed camera and ground-centre evidence; visible ordinary door leaves are measured separately from fixed transoms, public arches and vehicle bays. The retained records explicitly identify entrances whose head or sill is genuinely obscured. Sources use narrow physical setbacks where needed for the measured camera and filtering margins; farms combine their compact building cores with full 5×5 native fields.

[tools/assemble-building-source-cells.py](tools/assemble-building-source-cells.py) reproduces the three isolated town-feature corrections from their retained full generated frames. Its source recipe records each separately generated frame's observed physical parcel edge, uniform density and ground translation into the common sheet. It rejects lost source pixels and overlap with adjacent sprites. This normalization preserves the entire frame; it does not fit each silhouette to a box. Other isolated shop edits retain their exact source-frame assembly recipes beside the family.

Run `python3 fun/transport/tools/test-plot-cutout-packing.py` for the packing regression checks. [tools/render-plot-building-guides.mjs](tools/render-plot-building-guides.mjs) exports native construction guides for all jobs and both orientations; it blocks painted PNG loads and uses the shared current metre scale.

A reviewed `--sheet-offset-y` can move every registered cutout in one sheet by up to three master pixels, with a required `--registration-note`. This reserves filtering clearance without changing source density or physical features. Record the actual resulting ground centre and its error; do not alter source observations. The renewed town-feature sheet registers all eleven entries at the exact (128,192) master ground centre. At very small display densities, filtering can leave a faint fractional shadow on a cell edge; browser checks reject opaque edge clipping and verify complete source-pixel retention separately.

[tools/render-farm-compounds.mjs](tools/render-farm-compounds.mjs) builds the five full **5 × 5 farm atlas portraits** from the actual native field, crop, orchard and fence geometry in [farm-fields-art.js](farm-fields-art.js), combined with each registered painted **2 × 2 farm core**. It places the core at the same world metre scale and depth as the live farm; the full portrait keeps the industry's (128,192) master ground centre. Bare meadow and generic yard remain RGBA transparent, while crops, plants, paths, fences and contact shadows remain visible. This gives atlas/Gallery portraits the same field layout and human-scale buildings as the world renderer instead of a separately scaled farm painting. With the local HTTP server running, export the cutouts and measured geometry from the repository root:

```sh
node fun/transport/tools/render-farm-compounds.mjs /tmp/transport-farm-compounds
python3 fun/transport/tools/assemble-farm-atlases.py /tmp/transport-farm-compounds industries-1 industries-3
```

[tools/assemble-farm-atlases.py](tools/assemble-farm-atlases.py) packs these registered portraits into the two industry sheets. It preserves the processor cells' exact 512px samples and archives their original generator PNG, measured landmarks and registration metadata. Farm door landmarks come from the painted cores' actual measured endpoints, transformed through their renderer placement. Smaller levels are packed from the canonical composition with premultiplied alpha. Restore the original processor pack before rebuilding an already composed sheet.

[building-plot-alpha-browser-check.mjs](tests/building-plot-alpha-browser-check.mjs) verifies the current authored RGBA cutouts over four unrelated textured backgrounds. [house-ground-browser-check.mjs](tests/house-ground-browser-check.mjs) remains a compatibility entry point: it runs that shared architectural alpha review followed by [foundation-ground-browser-check.mjs](tests/foundation-ground-browser-check.mjs), which checks textured raised tops, stone sides and cache reuse. It writes their artifacts in separate `authored-alpha` and `foundation-ground` directories beneath `TRANSPORT_SCREENSHOTS` (or `TRANSPORT_OUTPUT`). Current sprites do not depend on RGB lawn masking or the historical 48px building frame.

## Recognition at game zooms

Use a clean silhouette, broad roof and wall colours, readable facade shading and a few large openings. Keep useful identifiers such as silos, greenhouses, chimneys, loading sheds, shop awnings and sports surfaces. Group planting into clear masses. Omit individual brick joints, roof tiles, woodgrain scratches, tiny lettering, dense crate grids, fine handrails, window mullions and flower speckle.

Inspect every family at its actual **Region (0.5×)** and **Town (1×)** size, then check Detail (2×) and standard and Retina displays. Compare several building kinds side by side with a truck or bus. Door heights, storey heights and fences should agree; buildings should remain identifiable from their roof, mass and large features when small. Display density can sharpen an image, but it must not reintroduce detail that makes the Region view noisy.

[tools/build-object-high-density.py](tools/build-object-high-density.py) verifies lazily loaded terrain cells up to 1024px, port cells up to 512px, historical road-texture cells up to 512px, and directional vehicle families plus their fallback composition up to 256px against retained originals. Current connected roads and railway surfaces use native projected geometry. Large Gallery portraits request sharper display levels while ordinary map views keep their lower densities. Every level samples its original independently with premultiplied alpha, without sharpening, recoloring or changing scale or anchors. The atlas manifests record original source hashes, cell/crop resolutions, exact transforms and enlargement factors. Renewed mountains and rocks use the source bounds recorded in their manifests; 1024px display cells preserve those originals but do not create additional painted detail. Historical families retain their original calibration and lower PNGs. Run `python3 fun/transport/tools/build-object-high-density.py --verify`, `python3 fun/transport/tools/test-object-high-density.py`, and `node --test fun/transport/tests/object-detail-density.test.mjs` to verify source detail limits, packing and lazy density selection. Startup still loads at most 128px cells; only explicitly registered large terrain families can request 1024px.

[building-registration.test.mjs](tests/building-registration.test.mjs) preserves the historical 48px source-calibration checks. Current plot sheets record actual source landmarks, applied uniform packing transforms, doorway measurements, source hashes and transparent gutters in `atlas.json`. Their measured acceptance limits are 0.11 ground-slope error, 3 master pixels of ground-centre error, and 25% personnel-door height error. Obscured ordinary entrances and larger public portals are classified explicitly; neither counts as an observed 2.1m door. The packing regression checks and real-canvas zoom review supplement these source records.

All architectural families use genuine RGBA alpha as their terrain transparency key, including houses, civic buildings, malls, industries and farm cores. Bare grass, snow, sand and generic earth show the world texture through the sprite. Paths, paving, courts, pools, crops, mineral heaps, fences, planting and contact shadows remain visible. Avoid a green chroma key: it would remove foliage and green roofs. Runtime compositing uses the authored alpha directly. Stone foundations support buildings on slopes without an opaque sprite backdrop. Farm ground follows its site, and fences and field objects remain aligned with the world grid. Review loaded artwork and native fallbacks so that delayed assets do not change physical scale.

Railway surfaces use [rail-surface-art.js](rail-surface-art.js) in the horizontal terrain plane: gray ballast, darker sleepers and pale steel with a 1.435m gauge. That connected geometry serves loaded and unavailable-art paths, slopes, bridge decks, tunnel approaches and Gallery portraits. Historical brown rail atlas slots remain source records; they no longer overlay the runtime tracks. [network-art-browser-check.mjs](tests/network-art-browser-check.mjs) checks all connectivity masks at the three game zooms and both display densities.

## Tree variety and registration

[tree-art-catalog.js](tree-art-catalog.js) defines 27 tree sprites per climate: the original nine plus eighteen additional species in two 3 × 3 atlases. Three additional hollow trees bring tundra to 30. Its `treeGenerationPrompt()` uses the shared metre scale and records each species' height. Generate a reproducible job with `node fun/transport/tools/generate-tree-prompt.mjs taiga 1 /tmp/transport-tree-job.json`. The same catalog provides `hollowTreeGenerationPrompt()` and `cactusGenerationPrompt()` for the hollow-tree and nine-cactus sheets.

Trees use the same elevated 2:1 camera, northwest light and restrained painted materials as the buildings. Visible crown tops, radial palm fronds, horizontal branch layers and the tops of cactus columns establish the view from above. Avoid front-view botanical portraits. Broad crown masses and distinct branch silhouettes remain readable at game scale. The sprites contain a tiny contact shadow; the renderer projects the longer ground shadow separately.

At the nominal 22-unit tree size, a 256-pixel master uses about 19.72 pixels per vertical metre. Woodland sprites render 1:1 in world space; the registered 72px-per-tile building frame does not apply to them. Shorter species remain shorter. Register each trunk at the shared 95.5% cell-height root anchor, using lossless translation and a common metre scale. If generated heights drift, uniformly calibrate a complete plant to its stated metre height while preserving its botanical proportions; record the measured crown-to-root height and calibration factor. Keep transparent gutters and preserve the full registered cell through `--aligned --preserve-grid-scale --no-sharpen` packing. Do not normalize different plants to one maximum bounding-box height or enlarge them to fill their cells.

Artwork selection uses the existing tree seeds. Two thirds of mature trees choose an additional species; original bare and juvenile variants remain available. Hollow trunks occur sparsely in tundra's bare woodland. Nine additional desert cacti vary existing cactus patches, from small barrels to tall branching cardons, at a shared 16-unit envelope and 32 master pixels per metre. Grove positions, saved terrain and world recipes remain stable. Generated-art shadows follow the selected species' physical height; unavailable-art fallbacks retain their original geometry. The Gallery previews each named tree and cactus directly.

The October 2026 renewal replaces all 165 active nature cutouts across 19 sheets: 84 trees, nine cacti, 54 ground-cover patches and 18 geological patches. Each climate includes nine separately authored **sparse** plant/flower patches alongside the nine denser patches. Sparse patches preserve the gaps between their clumps, contain 25–68% less painted area than their dense counterpart, and render once per terrain-detail stamp. A separate stable density seed keeps sparse cactus patches reachable alongside individual cactus species. Named sparse Gallery entries retain their exact identity; variant zero retains the original dense ground patch where applicable.

[tools/pack-nature-renewal.py](tools/pack-nature-renewal.py) packs these original RGBA sources. Each directory retains `source-renewal-2026-10-07.png`, the exact final prompt and packing job in `generation.json`, source hashes, bounds, source observations and the applied transform. Tree/cactus records distinguish observed root landmarks from estimated trunk bases. Ground cover keeps one common source-sheet scale, including empty gaps; geological patches preserve their aspect ratio. Those patches do not claim measured physical plant heights. Every display density samples the original cutout independently with premultiplied-alpha filtering. High-density exports may enlarge the retained source detail; they do not invent more detail. See [nature renewal provenance](assets/world/nature-renewal-2026-10-07.md).

## Saved worlds

Recipe 11 keeps 5 × 5 industrial plots and places geological features on sparse 3 × 3 through 6 × 6 parcels. Larger features appear less often and reserve every occupied tile; woodland remains 2 × 2 or 3 × 3. Published recipes 1–10 stay frozen so procedural saves reconstruct their original geography: recipe 8 has 3 × 3 industries and recipe 9 has 3 × 3 factories with 7 × 7 farms. These historical dimensions do not define new construction.

Save migration version 3 expands smaller sites only into clear adjoining land while retaining their original occupied tiles. A 7 × 7 farm shrinks to a contained 5 × 5 plot only if every existing freight stop stays within reach. When a safe resize cannot fit, the saved site's original footprint remains. Preserve roads, buildings, stops, inventories and route connections; new construction and openings still use 5 × 5.

Transport supports computers only. Artwork and gameplay checks use desktop and laptop browsers; phones and tablets show `please use computer to play the game` before startup, as recorded in [AGENTS.md](AGENTS.md).

## Airport component quality

Airport towers, terminals, hangars and fuel depots use eight painted cutouts in both runway orientations. [airport-building-art.js](airport-building-art.js) preserves each physical ground anchor so planes, buildings and scenery keep their depth order; native runways remain in the terrain mesh. Unbuilt airfield ground reveals the world's texture. The full airport is shown in the Gallery, inspector and construction cards.

[tools/render-airport-building-guides.mjs](tools/render-airport-building-guides.mjs) creates a measured construction atlas and a canonical `buildingGenerationPrompt()` with `componentFrame` registration. [tools/pack-airport-cutouts.py](tools/pack-airport-cutouts.py) packs complete original RGBA cells using one observed sheet density and per-component ground translations. Current art uses 5.6 source pixels per world pixel, measured from actual base edges rather than the requested guide resolution. Ground-edge slopes, physical anchors, scale variation, hidden door heads, source hashes, generation/edit prompts and zero-clipping evidence are retained with the shipping assets. Every mip samples the original pixels independently; camera, doors and silhouettes are never independently fitted or colour-keyed.

[tests/airport-quality-browser-check.mjs](tests/airport-quality-browser-check.mjs) verifies both airport axes across all three map zooms, three climates and standard, fractional and Retina densities, including full Gallery framing, picking, native pixel submission, cache reuse and unloaded-art fallback. [tests/gallery-portrait-quality-browser-check.mjs](tests/gallery-portrait-quality-browser-check.mjs) checks every available catalog portrait at its actual selected size and saves native-resolution contact sheets. UI alpha fitting preserves aspect and prepares enough source pixels before drawing; open galleries refresh when display density changes.

## Start menu landscape previews

`assets/ui/start-{taiga,tundra,desert}.webp` are static 1080 × 704 captures of the actual recipe-11 game, seed 1847, at Town view, centred on the starting town with map annotations and weather disabled. All three total about 289 KiB. They reuse shipping artwork at its calibrated world scale; no building sprites are enlarged or regenerated. `tools/capture-start-landscapes.mjs` recreates them through the normal computer startup flow in an isolated browser context. The menu only loads the selected image; it never generates a world for the preview.
