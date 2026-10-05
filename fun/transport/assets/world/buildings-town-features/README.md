# Town features (placeholder art)

Simple images for the town features added with recipe 8: parks, play and sport, the town hall and three newer shops. They are rendered from the code drawings in [`town-feature-sprites.js`](../../../town-feature-sprites.js) by [`tools/render-town-features.mjs`](../../../tools/render-town-features.mjs), and are meant to be replaced by painted art in the style of the other buildings.

## Sheet

Each climate folder (`taiga/`, `tundra/`, `desert/`) holds one sheet at five densities: `atlas-16.png`, `atlas-32.png`, `atlas-64.png`, `atlas-128.png` and `atlas-256.png`, each exactly 4 × 3 cells of 16, 32, 64, 128 or 256 px. `raster-buildings.js` registers the cells in this order:

| Row | Cells |
| --- | --- |
| 1 | `park` (2 × 2), `playground` (1 × 1), `swimming-pool` (2 × 2), `sports-field` (2 × 2) |
| 2 | `tennis-courts` (1 × 1), `ballpark` (3 × 3), `sports-hall` (2 × 2), `town-hall` (2 × 2) |
| 3 | `shop-cafe` (1 × 1), `shop-pharmacy` (1 × 1), `shop-bookshop` (1 × 1), empty |

## Camera and scale

The game's fixed 2:1 dimetric camera, as for every painted building ([camera audit](../camera-audit.md)). A cell is the sprite's 32-unit box whatever the footprint: the renderer scales it by the footprint, so a 3 × 3 ballpark is drawn in the same cell as a 1 × 1 café. The footprint's plate is a diamond centred at (16, 24) units, 29 units wide and 14.5 tall: in a 256 px cell, centred at (128, 192), corners at x 12 and 244 and y 134 and 250. Buildings rise from the plate towards the top of the cell; keep the background transparent.

## Replacing the images

Generate one transparent 256 px image per identity and climate with the camera and plate above, matching the painted buildings in `buildings-civic/` (prompts in [isometric-architecture-prompts.json](../isometric-architecture-prompts.json)). Pack them into the 4 × 3 sheet in the order above and write all five densities; `tools/build-world-atlases.py` makes the smaller densities from a 256 px master. Climate finishes follow the other buildings: snow on tundra roofs, sandstone and palms in the desert.

What each image shows:

- **Park**: lawns, crossing gravel paths, a round fountain, trees, benches and flower beds.
- **Playground**: a soft play surface, swings, a slide, a sandpit, a roundabout and a low fence.
- **Swimming pool**: an outdoor pool with lanes, a paved deck with loungers and parasols, and a changing pavilion.
- **Sports field**: a marked football pitch with goals, a small covered stand and floodlights.
- **Tennis courts**: a marked hard court (clay in the desert) with a net and a wire fence.
- **Ballpark**: a baseball diamond with stands curling behind home plate, light towers and a scoreboard.
- **Sports hall**: a long indoor hall under a barrel roof, a glazed entrance and a few parked cars.
- **Town hall**: a symmetrical civic building with a columned portico, a clock tower and a flag.
- **Café**, **Pharmacy**, **Bookshop**: two-storey shops; a striped awning with tables outside, a green cross sign, a window of books.

Until a density loads, and if it fails, the sprites draw the same features in code, so the images can change without touching the game.
