# Generated town features

All eleven town features use image-generated, hand-painted artwork matching the civic and commerce families. The previous procedural placeholder atlases were replaced on 2026-10-06. The code in [`town-feature-sprites.js`](../../../town-feature-sprites.js) remains the loading/error fallback; it is not the source of the shipped images.

## Sheet

Each climate folder (`taiga/`, `tundra/`, `desert/`) holds a 4 × 3 sheet at five densities: `atlas-16.png`, `atlas-32.png`, `atlas-64.png`, `atlas-128.png` and `atlas-256.png`. `atlas.png` is the 256px master. The runtime registration in `raster-buildings.js` keeps this order:

| Row | Cells |
| --- | --- |
| 1 | `park` (2 × 2), `playground` (1 × 1), `swimming-pool` (2 × 2), `sports-field` (2 × 2) |
| 2 | `tennis-courts` (1 × 1), `ballpark` (3 × 3), `sports-hall` (2 × 2), `town-hall` (2 × 2) |
| 3 | `shop-cafe` (1 × 1), `shop-pharmacy` (1 × 1), `shop-bookshop` (1 × 1), empty |

## Shared art direction and scale

Every generation uses `buildingGenerationPrompt()` from [`sprite-art-direction.js`](../../../sprite-art-direction.js), with footprints read from `BUILDINGS`. The fresh generated civic sheet is the style reference: fixed 2:1 dimetric camera, northwest light, softly painted natural materials, broad roof and wall masses, and recognizable sports surfaces. A tile represents 16 metres; normal personnel entrances are 2.1m high and storeys are 3m. Larger parcels add rooms, wings and garden space without enlarging human features.

`scale-2026-10-06.json` records measured personnel-door edges in the accepted Taiga source. Every complete cutout within a footprint tier receives one shared uniform calibration; bounds locate the ground contact and never determine scale. Shops measure approximately 3.9–4.3 world pixels per doorway, and the pool pavilion and town hall approximately 4.1–4.3 pixels, against the shared 4.2px target. Tundra and desert are image-generation edits of that accepted base, preserving its building geometry.

Original RGBA cutouts are preserved with genuine transparent backgrounds. Packing only registers and uniformly resamples them with premultiplied alpha. The full calibrated 256px parcel grid is retained, and mipmaps do not sharpen tiny details. All eleven sprites are separate alpha components in each raw sheet; the bottom-right slot is empty. Actual Town and Region previews were reviewed before climate derivation.

## Provenance and rebuilding

Each climate includes the raw `source-generated-2026-10-06.png`, its calibrated registered sheet, `generation-2026-10-06.json` with the canonical job and exact image-generation/edit prompt, `packing-2026-10-06.json`, `atlas.json`, and isolated master cutouts in `sources/`. An initial generation with touching sports/planting gutters was rejected; a subsequent image-generation edit created the accepted separate sprites. The rejected Taiga draft is retained only as that edit's source reference and is never loaded by the game.

To repack these accepted sources at the recorded shared physical scale:

```sh
python3 tools/pack-town-feature-atlases.py assets/world/buildings-town-features
```

The helper validates eleven complete disconnected sprites, preserves their original RGBA pixels, applies the shared tier calibration, then calls the common atlas packer with `--aligned --preserve-grid-scale --no-sharpen`. New source generations must follow the canonical instructions and be measured and reviewed at game zoom levels before replacing the accepted files. `tools/render-town-features.mjs` exports native fallback previews to `/tmp/transport-native-town-features` by default so those previews cannot overwrite this production art.

The park has a fountain and crossing paths; the playground has a slide and swings; the pool has a modest changing pavilion; the football pitch, tennis court and baseball diamond retain distinct surfaces; the sports hall has a barrel roof; the town hall has a clock turret. The café, pharmacy and bookshop use shared high-street proportions with restrained awnings and large identifying symbols, without lettering or book-spine grids.
