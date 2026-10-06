# Commerce and town workshop sprites

All eight commerce identities were regenerated with the built-in image generation tool on 5 October 2026, in taiga, tundra and desert finishes. A new small town workshop occupies the ninth cell. The active family therefore contains 27 newly generated building variants.

The artwork uses detailed painted miniature textures, individual shop fittings and restrained planting. The fixed orthographic 2:1 dimetric camera uses ground axes at approximately ±26.565° and upright walls. The [camera guide](camera-guide.png) was supplied to generation and climate edits. These are painted assets with small camera variation, not exact CAD projections.

The complete original transparent output sheets, exact prompts, references and hashes are recorded in [generation.json](generation.json) and [regeneration-2026-10-05.json](regeneration-2026-10-05.json). Every biome retains `source-generated-2026-10-05.png`, its losslessly registered sheet, registration records, nine transparent 256px per-object masters, and all runtime densities. The initial eight-building taiga sheet is also retained as generation history.

Row-major order is butcher, hardware, florist / post office, bank, hotel / garage, barber, town workshop. The workshop has brick walls, two green-gray sawtooth roof bays with northlight glazing, a modest chimney, timber loading doors, crates and a small workbench. Each biome metadata file records the ninth identity as `civic:factory:<biome>`.

Rebuild the entire family with Pillow, NumPy and SciPy installed:

```sh
python3 fun/transport/assets/world/buildings-commerce-camera-v2/rebuild.py
```

`tools/prepare-building-atlas.py` identifies nine disconnected alpha cutouts and integer-translates their original RGBA pixels into isolated padded cells. `tools/build-world-atlases.py` then normalizes the complete objects to a maximum 232px extent with groundline 244, using the established premultiplied-alpha filtering and mild interior sharpening for 16/32/64/128/256px cells. No script generates, recolors or repaints artwork.

The previous selective hardware/bank/garage correction remains documented in [generation-selective-v2.json](generation-selective-v2.json) and its original individual `generated/` images. [angle-audit.json](angle-audit.json) describes measurements of that historical artwork, not the regenerated sheets. The original sibling family remains available under `../buildings-commerce/`.

Runtime registration is in `raster-buildings.js`. `tests/commerce-camera-browser-check.mjs` verifies that all 135 cell/LOD/climate combinations decode and every occupied cell has refreshed artwork.
