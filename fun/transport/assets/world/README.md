# Generated world sprites

Original artwork was created with the **built-in image_gen tool**, using the generated houses as the style reference. Transparent 256×256 per-object masters are downscaled into isolated 16, 32, 64 and 128-pixel cells. Industry sites additionally use a 256-pixel runtime level for the 2×2 footprint at Detail zoom on DPR 2 displays.

The collection includes 51 civic/commercial building variants (17 identities in three climates), 33 supported industry/climate combinations, 72 nature objects, nine infrastructure pieces, nine cargo materials, and **72 individually drawn vehicle frames** (nine vehicle types × eight headings). Houses live in [../houses](../houses/README.md).

## Isometric camera

The game uses a fixed 2:1 dimetric view: ground axes slope ±26.565°, while walls, poles, trees and people stay upright. The architecture, industries, vehicles, ports, stops, tunnel mouths and rocky terrain have been redrawn for this view with the built-in imagegen tool. All three climate finishes retain the same camera. Ground textures and continuous roads are projected once; upright sprites are drawn separately in depth order. The same generated identities appear in the interface.

- Houses: 27 sprites and their source/prompt records in [../houses](../houses/README.md).
- Civic/commercial buildings: 51 sprites. Civic source sheets remain in `buildings-civic/{biome}`; active commerce sheets are in `buildings-commerce-camera-v2/{biome}`, replacing the bank, garage and hardware shop in all three climates. [Original architecture prompts](isometric-architecture-prompts.json) also cover the 27 houses; [commerce corrections](buildings-commerce-camera-v2/generation.json) retain their camera guide and prompt history.
- Industries: 33 sprites; each `industries-*` folder keeps `source-isometric.png` and `isometric-prompt.json`.
- Vehicles: all 72 directional frames now use `vehicle-{kind}-dimetric-v2/`; each directory records its source, prompt and packing provenance. Six families were regenerated against a mathematical camera guide; the other three retain their generated art with corrected shared-scale packing. Cargo is projected onto the vehicle's ground plane. The generic palette/fallback sheet in `vehicles-dimetric-v2/` uses these same southeast frames.
- Infrastructure: two stops, four separately drawn harbor orientations and eight road/rail tunnel mouths; [structure prompts](isometric-infrastructure-v2/isometric-prompt.json), [portal prompts](isometric-portals-v2/isometric-prompt.json), [structure atlas](isometric-infrastructure-v2/atlas.png), [portal atlas](isometric-portals-v2/atlas.png). Rear-facing entrances show the back of the masonry rather than a front-facing hole. Uniform runtime scaling preserves the authored camera in both map and UI portraits.
- Terrain: 18 rock and mountain details; [prompts](isometric-terrain-prompts.json) and `source-isometric.png` in `nature-rocks/` and `nature-mountains/`.

Original RGBA pixels are registered into padded cells before downscaling. `prepare-building-atlas.py` handles irregular disconnected cutouts; `prepare-terrain-atlas.py` handles transparent gutters with configurable rows and columns. Both retain the generated alpha rather than repainting silhouettes. The normal atlas pipelines then make transparent 256px masters and isolated display densities.

The [camera audit](camera-audit.md) records the corrected families, runtime geometry, verification and remaining painterly variation. Generated artwork approximates the mathematical projection; the renderer's terrain and cargo transforms use it exactly.

## Source and prompt records

- `buildings-civic/` and `buildings-commerce/`: school, hospital, police, fire, stadium, church, pub, five shops and five services. Each folder records the initial prompt, climate edits and any layout repairs.
- `industries-{biome}/` and `industries-{biome}-extra/`: distinctive complete sites, including pits, headframes, kilns, tanks, log yards, farm plots and processing equipment. Each contains `prompt.json` and any follow-up prompt.
- `nature-*/`: tree species, bare trees, saplings, flowers, shrubs, rocks and mountains. Each folder contains its prompt records and packing provenance.
- [Terrain realism prompts](terrain-realism-prompts.json): the replacement rock and mountain sheets use lower, near-overhead outcrops, muted sediment and melting snow. Their `source-generated-v2.png` originals and `source-packed-v2.json` registration records are retained in the corresponding family folders. Packing preserves complete objects through transparent gutters, then produces the normal 256px masters and display densities.
- `vehicle-{kind}-dimetric-v2/`: active eight-direction sheets and their source/provenance. All use the verified compass order NW, N, NE / W, empty, E / SW, S, SE. Older `vehicle-{kind}/` artwork remains as source history.
- [transport-prompts.json](transport-prompts.json): original infrastructure and vehicle reference sheet prompts. The active vehicle fallback is assembled from the corrected directional masters.
- `cargo/`: textured coal, ore, logs, grain, crates, steel, barrels, glass and fish loads. The rendered amount follows the vehicle's capacity fraction; the body stays visible beneath it.

No direction is manufactured by rotating or mirroring another direction. Fronts, rears, windows, wheels and decks use the appropriate fixed-camera view. `vehicle-directions.js` quantizes travel angles into E, SE, S, SW, W, NW, N and NE. Train coaches select the direction of their own track segment. Night lights and cargo follow the same heading.

## Rebuilding

`tools/build-world-atlases.py` validates alpha and cell boundaries, normalizes cutouts, then uses premultiplied-alpha Lanczos downscaling and mild interior sharpening. The script never generates or repaints artwork. Use `--anchor center --vehicle --shared-scale` for directional sheets drawn at one physical scale: a common fit preserves their authored foreshortening, especially the shorter north/south views. Independent principal-axis normalization is retained only for rebuilding legacy sheets; it must not be used for the active camera-guide artwork. Atlas metadata includes the source SHA256, cell order, shared scale and source crop bounds.

Some generated sheets extend into their empty center cell. Their local `prepare-source.py` scripts isolate complete objects through transparent gaps and integer-translate them into padded cells, without resampling or rotation. The replacement terrain sheets use `tools/prepare-terrain-atlas.py` for the same lossless registration through per-row transparent gutters. Run these before the shared packer.

The runtime fetches only the display atlases, never source sheets or masters. Each display resolution becomes usable as it loads, so a missing density can use another resolution of the same generated image. Native canvas drawing is the final fallback when no image is usable. Late loads invalidate artwork caches without changing the saved world; connectivity recovery retries missing densities. Window light anchors are measured against the generated building art and follow the climate actually drawn.

## Gameplay footprints

New industries reserve 2×2 tiles for placement, inspection, selection and demolition. Roads, houses, trees and settlement growth cannot occupy the site. Catchment, infrastructure access and operating-cost service benefits measure from every site edge. Recipe 4 preserves natural elevation beneath these sites and settlements. Recipes 1–3 and one-tile saved industries retain their original geography and footprint.

Browser checks: `tests/world-art-browser-check.mjs`, `tests/vehicle-directions-browser-check.mjs`, `tests/raster-houses-browser-check.mjs`, `tests/shipping-renderer-check.mjs`, and `tests/daynight-renderer-check.mjs`. Source/contact-sheet screenshots are written outside the shipped asset directories.
