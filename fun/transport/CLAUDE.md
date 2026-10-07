# Transport development

Follow the project decisions in [AGENTS.md](AGENTS.md), including computer-only support and the shared building scale and style.

## Building consistency image

[building-consistency-browser-check.mjs](tests/building-consistency-browser-check.mjs) arranges every current building type on **flat grass using the real world renderer**, all at the same physical scale. It includes every house design and rotation, shop exterior, industry, both grain crops with fenced fields, road and rail stops, four port orientations, and both airport orientations. The primary town styles are Taiga; industries available only in another climate keep their authored climate, labelled beneath their plots. Ports need small flat water pads. Existing saved-world legacy footprints and other climate finishes remain covered by [sprite-scale-browser-check.mjs](tests/sprite-scale-browser-check.mjs).

Open the [interactive scene](tools/building-consistency.html) to switch between the game's Town and Detail views and show the actual tile grid, or run the test to save `overview.png` and `detail.png`. View the images at 100% to compare doors, storeys, gardens and silhouettes. Images are generated review artifacts, not approved golden snapshots; the script verifies catalog coverage, exact loaded artwork, 5 × 5 industry plots, 2 × 2 farm cores, flat ground, sprite submissions, no clipping, unchanged model state and deterministic captures.

Use [generate-building-reference.mjs](tools/generate-building-reference.mjs) and the measured camera/ground-centre workflow in [SPRITES.md](SPRITES.md) when correcting authored alignment. Increasing atlas density cannot correct a painted ground edge or an incorrectly registered yard.

[building-plot-alpha-browser-check.mjs](tests/building-plot-alpha-browser-check.mjs) composites all 132 current architectural cells over four different textured backgrounds, checks decoded alpha against the actual composited pixels, and verifies the registered full-plot billboard dimensions. It saves one comparison image per sheet in `/tmp/transport-building-plot-alpha`. This catches opaque lawns, background cards and terrain-colour keys without removing green roofs or foliage.

The flat comparison does not exercise raised foundation tops. [foundation-ground-browser-check.mjs](tests/foundation-ground-browser-check.mjs) checks textured ground beneath houses, civic buildings, industries and farm cores on slopes, including warm draws and panning.

[house-ground-browser-check.mjs](tests/house-ground-browser-check.mjs) is a compatibility runner for the authored-RGBA alpha review and foundation-ground checks above. It uses the current shared building frame and leaves the architecture's alpha untouched; reports are saved in separate `authored-alpha` and `foundation-ground` subdirectories.

[render-farm-compounds.mjs](tools/render-farm-compounds.mjs) exports the five full 5 × 5 farm atlas portraits using the world's native fields and fences around registered painted 2 × 2 building cores. [assemble-farm-atlases.py](tools/assemble-farm-atlases.py) combines those portraits with unchanged registered processor cutouts, retaining original source calibration. The composition preserves world physical scale and ground registration; bare meadow and generic yard stay transparent so portraits reveal any underlying texture. Run it with the local server available, following [SPRITES.md](SPRITES.md).

[selection-underlay-browser-check.mjs](tests/selection-underlay-browser-check.mjs) checks selection and hover against the visible foundation plane on slopes, sprite occlusion, full farm fields, and reusable scenery caches at each zoom and display density.

Regenerate from the repository root with a local HTTP server and Playwright plus Chrome installed:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

In another terminal:

```sh
node fun/transport/tests/building-consistency-browser-check.mjs
```

`TRANSPORT_URL` changes the served game URL, `TRANSPORT_PLAYWRIGHT` selects a Playwright module path, `TRANSPORT_BROWSER` selects its browser channel, and `TRANSPORT_OUTPUT` changes the artifact directory. Default output is `/tmp/transport-building-consistency-qa/` (two native PNGs and a coverage manifest). Generated screenshots stay outside the repository, as with the other browser QA scripts. New catalog entries are included automatically.
