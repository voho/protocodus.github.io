# Generated town features

All eleven town features were regenerated on 2026-10-07 with broad architecture, quieter materials and a shared human scale. Taiga, tundra and desert retain the same identities. The previous tracked sources and calibration records remain as historical provenance; runtime loads the new atlases. Native art in [`town-feature-sprites.js`](../../../town-feature-sprites.js) remains the loading/error fallback.

Each climate ships a 4 × 3 sheet at 16, 32, 64, 128 and 256 pixels per complete registered cell. `atlas.png` and `atlas-256.png` are identical masters. The bottom-right slot is genuinely empty.

| Row | Cells |
| --- | --- |
| 1 | `park` (2 × 2), `playground` (1 × 1), `swimming-pool` (2 × 2), `sports-field` (2 × 2) |
| 2 | `tennis-courts` (1 × 1), `ballpark` (3 × 3), `sports-hall` (2 × 2), `town-hall` (2 × 2) |
| 3 | `shop-cafe` (1 × 1), `shop-pharmacy` (1 × 1), `shop-bookshop` (1 × 1), empty |

Every generation and climate edit used the canonical `buildingGenerationPrompt()` from [`sprite-art-direction.js`](../../../sprite-art-direction.js). The source contract remains a 16 m tile, 1.75 m person, 2.1 m personnel door, 3 m storey and exact orthographic 2:1 ground projection. Semantic plaster, stone, brick, timber, slate, terracotta and glass swatches are shared with other building families. Climate changes planting, garden ground and restrained snow accents. Sports grounds, paved pool decks, playground substrate and tennis surfaces remain recognizable built surfaces.

The full world parcel is 64 × footprint pixels wide; its building billboard is 48 × footprint pixels wide. An inset architectural/garden square of at most approximately 10 m × footprint therefore targets 213.33 × 106.67 pixels in a normalized 256px cell. The full 16 m parcel is supplied by world terrain. Artwork is never independently enlarged to fill its cell, and no vertical compression was applied.

The accepted sources are near-2:1 painted assets, rather than pixel-exact geometry. Actual foreground edge measurements are retained in `camera-scale-audit-2026-10-07.json` and the per-climate metadata; sampled absolute slopes are approximately 0.53–0.60 against the exact 0.50 target. The approved painted tolerance is 0.11. Roof and facade measurements can also vary slightly. Native projected geometry uses the exact camera. Rejected camera and climate attempts are kept outside the repository under `/tmp/transport-town-feature-rejected`.

Registration uses actual planar ground vertices, with an occluded back vertex completed approximately from the parallel ground axes where necessary. The midpoint of the observed opposite right/left vertices supplies the physical ground datum, translated to `(128,192)` in the master; the uncertain hidden back vertex does not bias registration. Alpha bounds, shadows, planting height and roof height only locate RGBA pixels; they never choose the scale or datum. Integer resampling/translation leaves less than half a master pixel of registration rounding.

Each climate applies one uniform measured personnel-door/frame factor per footprint tier. The normalized calibration target is 22.4px for one-tile shops and 11.2px for two-tile architecture. Shop awnings obscure some headers, so their full outer frames carry an explicit ±3 source-pixel uncertainty; visible openings are shorter. The changing pavilion and entrance annex supply clear two-tile door measurements. A portico can obscure the climate town hall doorway. No personnel door can be reliably measured in the accepted ballpark: its complete inset field and garden instead use an explicit 28 m square on the 48 m parcel before filtering clearance. Its metadata does not claim a doorway measurement.

Region filtering required additional transparent clearance. One shared 0.88 correction applies to every complete one-/two-tile cutout, and 0.93 to every three-tile cutout, across the family. These are whole-tier corrections, never independent silhouette fits. The current masters retain at least 9px meaningful gutters, measured personnel frames render at approximately 1.72–1.98m, and the ballpark inset renders at 26.04m. The original measurements, canonical targets, applied correction and resulting dimensions remain explicit in the metadata.

The shops were requested with substantial 8–10 m facades and two 3 m storeys. They now read near 35 world pixels wide at Town size in taiga after filtering clearance, compared with the previous approximately 20px shops. Their large striped café awning, pharmacy cross and cream open-book emblem identify them. The park fountain, playground slide/swings, blue pool, football goals/centre circle, tennis net/court, baseball infield, barrel-roof hall and clock town hall remain distinct at Town and Region sizes.

Each climate retains the exact accepted job and image-edit prompt in `generation-accepted-2026-10-07.json`, the generated RGBA sheet in `source-generated-2026-10-07.png`, measured landmarks and calibration in `registration-2026-10-07.json`, the registered full grid in `source-registered-2026-10-07.png`, and packing/source hashes in `packing-2026-10-07.json` and `atlas.json`. Taiga used the retained construction guide; accepted climate edits used the pre-clearance registered taiga grid, retained exactly as `climate-edit-reference-2026-10-07.png`. `comparison-master-2026-10-07.png` and `comparison-town-region-2026-10-07.png` show the before/after evidence. Root also reviewed the actual browser Town view beside houses and transport.

Rebuild the current accepted family with:

```sh
python3 tools/repack-town-features-registered.py assets/world/buildings-town-features
```

The helper separates only weak alpha-matte bridges by nearest complete-sprite ownership, retains original RGBA cutouts, applies the shared physical calibration, and packs the aligned full cells with `--preserve-grid-scale --no-sharpen`. All eleven cells have complete transparent gutters and the empty slot stays transparent at every density. The older packing helper and 2026-10-06 records describe the historical generation.
