# Commerce camera correction, version 2

Only `shop-hardware`, `service-bank`, and `service-garage` were regenerated, in taiga, tundra, and desert finishes. The built-in image generation tool used the [mathematically projected block guide](camera-guide.png). The accepted original transparent outputs and exact prompts are recorded in [generation.json](generation.json); each climate's `generated/` folder contains its source images. Original sibling assets remain available.

The old sprites had shallow front façades inconsistent with their opposite walls. Paired, approximately measured horizontal edges now imply camera elevations of 29.1° for the bank, 30.1° for the garage, and 30.3° for the hardware shop, compared with the 30° camera behind the game's 2:1 projection. Measurements are manual and have about 1–2° edge uncertainty. The bank retains slight rotation within its plot. These are painterly sprites, not exact CAD projections. [angle-audit.json](angle-audit.json) records coordinates, method, before/after estimates, and representative preserved houses.

The house and civic families were not changed. A façade angle alone cannot distinguish in-plot rotation from a changed camera: the product of the two orthogonal horizontal edge slopes should be approximately 0.25. The inspected cheap houses and normal brick villa are consistent with that camera. The grand townhouse retains modest painterly camera drift; no claim of exact alignment is made for all preserved art.

Runtime registration is in `raster-buildings.js`. The two small light rectangles per corrected building were measured on exposed glass in the final 256px cells and checked across all three zoom levels, both DPRs, and climates.

Rebuild from saved sources with Pillow installed:

```sh
python3 fun/transport/assets/world/buildings-commerce-camera-v2/rebuild.py
```

The rebuild uses the existing alpha-preserving normalization/sharpening pipeline, a 232px maximum art extent, and groundline 244. It replaces only indices 1, 4, and 6. Every other source and every unselected atlas cell is copied from the original family at its existing LOD without resampling. Do not repack the whole family from a generated contact sheet. `tests/commerce-camera-browser-check.mjs` checks all 135 cell/LOD/climate combinations and 54 window-lighting profiles.
