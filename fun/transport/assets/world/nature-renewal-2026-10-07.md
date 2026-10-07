# Nature artwork renewal — 7 October 2026

All active nature sheets were authored afresh with the built-in image generator. Earlier sprite pixels are not used by these sheets. Trees and plants use an elevated orthographic camera, visible canopy tops and radial foliage, northwest lighting, genuine alpha and a restrained climate palette.

The tree camera reference is retained as [rendered geometry](nature-camera-reference.png) and [editable geometry](nature-camera-reference.svg). Its green diamonds establish the projection only; generated cutouts omit those diamonds and keep true alpha.

| Families | Sheets | Cutouts |
| --- | ---: | ---: |
| Taiga, tundra and desert trees, including varieties and hollow trees | 10 | 84 |
| Individually scaled desert cacti | 1 | 9 |
| Dense and sparse ground cover in three climates | 6 | 54 |
| Mountains and rocks | 2 | 18 |

The source image, final generation prompt, retained source hash and reproducible packing job live beside every atlas. To rebuild any family, extract `job` from its `generation.json` to a temporary JSON file, then run:

```sh
python3 fun/transport/tools/pack-nature-renewal.py job.json source-renewal-2026-10-07.png OUTPUT_DIRECTORY
```

The packer isolates whole subjects using alpha. It never removes colors to imitate transparency. Plant heights use recorded physical metre scales and a shared root anchor. A few original species have explicitly reviewed root/crown landmarks; other records disclose their trunk-base estimates. Species heights vary rather than filling every cell with the same silhouette. Source cells and every mip are sampled independently from original pixels with premultiplied-alpha filtering.

Sparse ground cover keeps one scale for the entire authored sheet, so the space between clumps survives packing. It has 25–68% less occupied area per corresponding patch; the climate averages have 48%, 57% and 53% less area for taiga, tundra and desert respectively. Runtime selection uses a stable independent seed and draws one sparse patch rather than layering several copies. All 27 sparse identities are reachable and listed in the Gallery.

Geological images retain their aspect ratio and lighting direction. New worlds place their detailed variants on real 3 × 3, 4 × 4, 5 × 5 or 6 × 6 parcels, with increasingly rare large plots. Those parcels participate in picking, clearing, saved state, depth ordering and terrain editing. A larger footprint and a 1024px export provide more display space, not additional painted detail beyond the original source.

Verification:

- `tests/tree-variety-browser-check.mjs`: atlas alpha/gutters, physical scale, all species and densities, saved-world stability, native recovery and unchanged published woodland geometry.
- `tests/sparse-nature-browser-check.mjs`: all 27 sparse identities, reduced alpha occupancy, dense/sparse reachability, exact Gallery identities and 162 runtime view/density profiles.
- `tests/native-nature-browser-check.mjs`: elevated native geometry and unclipped published forest layouts.
- `tests/terrain-objects-renderer-check.mjs`: full large-parcel drawing, picking, clearing, cache reuse and restored state.
- `tools/build-object-high-density.py --verify`: exact original-source regeneration of geological mips and retained provenance.
