# Ashline

An original 2D real-time strategy game for the browser. Lead an expedition into the ashlands, harvest minerals, build and defend a base, and defeat the opposing command center.

New skirmishes use a procedurally generated 144 × 112 tile battlefield: 16,128 tiles, four times the original map area. Mineral deposits, rocky obstacles, lava pools, and three connecting routes span the expanded sector under fog of war. Construct production buildings and defenses, recruit specialized units, and face an AI that develops its economy and adapts its attacks.

Lava pools have rugged basalt banks, slowly flowing molten surfaces, and brief bubbles. They block movement and construction; units and the AI route around them. Seeded pools preserve starting clearings, mineral access, and the map’s guaranteed routes. Fog hides undiscovered pools and stops live animation outside current vision. Pools persist through save/load, and older saves remain compatible.

Sparse deadwood groves mix bare hardwoods, charred conifers, twisted trees, bleached snags, hollow stumps, and fallen trunks. Their rough roots share the rocky ground’s impassable footprint. Varied silhouettes and sizes enrich the ashlands, with soft shadows and branches that fade when they would obscure visible units. Placement is seeded and remains consistent after loading a save.

Barracks train **Rocket infantry** for mobile anti-armor support. Their slow-firing shoulder launchers hit vehicles hard and deal a small amount of splash damage; rifle squads and recon rovers counter them. **Rocket towers** provide longer-range missile defense with a wider blast radius, require a barracks and reactor, and stop firing without sufficient power. Rockets travel before exploding. The AI recruits rocket infantry and builds rocket towers as part of its defenses.

Units earn three ranks through combat: rank 1 at **5 kills**, rank 2 at **10 kills**, and rank 3 at **15 kills**. Each rank adds 20% of base damage, movement speed, and maximum HP, for totals of **+20%, +40%, and +60%**. Promotion adds the gained maximum HP to current health, preserving damage already taken. Three chevrons below each visible unit show its earned ranks; the selected-unit panel shows kills toward the next threshold and the current bonus. A surviving unit receives credit for its own kills, including splash and rocket impacts. Ranks and kills persist in saves; existing units without a kill count start unranked.

Every completed refinery includes one free hauler. Haulers automatically collect and deliver minerals, and resume harvesting after moving or stopping. Armed units guard by default: they fire at visible enemies in weapon range while holding their position. Moving or stopping returns them to guard when the order finishes.

Units steer around nearby traffic and leave parked allies in place. If friendly units jam in a tight passage, their spacing briefly softens so they can pass and continue their orders. Rocks, lava, buildings, and enemy collision boundaries remain solid. This also keeps haulers moving through shared refinery approaches.

Select units and toggle **Explore** (X) to automatically scout reachable unexplored areas. Armed explorers stop to fire at nearby visible enemies and resume exploring afterward. Haulers can explore too; they resume harvesting when exploration ends. Toggle Explore again, stop, or issue a manual move, attack, or harvest order to end auto-explore. When no reachable unexplored areas remain, armed units return to guarding.

Every barracks, vehicle foundry, and refinery has its own rally point. Select it and right click a destination, or choose **Rally** (R) and click/tap. New combat units attack move there; haulers relocate and resume automatic harvesting. Each building trains one unit at a time, independently of the others. Recruiting with a compatible producer selected adds to that producer’s queue; otherwise recruitment chooses the available producer with the least remaining work. Card badges show total queued items, with a progress bar for each active producer, and the production list identifies each working building.

Buildings show their actual activity. Production bays contain the current queued unit as it assembles or trains; empty queues leave a dim, empty bay with its machinery stopped. Refineries process delivered minerals with a filling hopper, moving conveyor, and exhaust. Haulers visibly carry empty, partial, or full loads and drain their cargo during unloading. Command scanning, reactor fans, and sentry scanning/recoil remain distinct. Animations pause with the simulation and respect fog and power.

The pause menu saves one operation to this browser’s local storage and loads it again, including the exact simulation, fog knowledge, production queues, rally points, camera, economy, and AI. The briefing offers **Load saved operation** on the next visit. Loading pauses the restored operation until you resume. Existing 72 × 56 saves remain playable at their original size; start a new skirmish for the larger battlefield. Saving again replaces that slot; clearing browser site data removes it.

Original synthesized sound effects cover orders, production, weapons, explosions, and deliveries. Sound begins after a user gesture; effects and music have independent toggles in the pause menu. The locally hosted synthwave loop **Space Adventure** by **MintoDog** is CC0; its creator’s license and source are recorded in [audio credits](assets/audio/CREDITS.md).

## Run locally

From the repository root:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/fun/ashline/>. No build step or installation is required.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag a box | Select a unit or building / select multiple units |
| Double click a unit | Select all friendly units of that type currently on screen |
| Shift + select | Add to the selection |
| Right click | Move, attack an enemy, or send a harvester to minerals |
| A, then click | Attack move |
| R, then click / Rally button | Set selected production buildings’ rally point |
| X / Explore button | Toggle auto-explore for selected units |
| S | Stop selected units and disable auto-explore |
| E | Select all combat units |
| Space | Center the camera on your base |
| Arrow keys / middle-button drag | Pan the camera |
| Mouse wheel | Zoom |
| Ctrl + 1–5 / 1–5 | Assign / select a control group |
| P | Pause or resume |
| B / Command button | Open or close the production console |
| Escape | Cancel the current action |
| Sidebar | Construct buildings and train units |

Selections containing any military unit automatically exclude haulers, including drag selection, Shift selection, and control groups. Select haulers on their own to command them together.

On touchscreens, tap to select, then tap a destination or target. Drag empty ground to pan. The production console starts collapsed and closes after choosing a structure so its placement stays visible.

## Simulation checks

From this directory:

```sh
node tests/sim-check.mjs
node tests/orders-check.mjs
node tests/explore-check.mjs
node tests/production-check.mjs
node tests/processing-check.mjs
node tests/rocket-check.mjs
node tests/rank-check.mjs
node tests/collision-check.mjs
node tests/lava-check.mjs
node tests/save-check.mjs
```

The checks exercise seeded maps, route connectivity, fog, finite harvesting and recovery, construction, production, power, complete skirmishes, included refinery haulers, automatic harvesting orders, default guarding, auto-exploration with cancellation and route recovery, and lava generation, safe detours, and save compatibility.

For browser interaction checks, use an existing Playwright installation and Chrome while the local server is running:

```sh
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/camera-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/faction-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/shadows-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/cargo-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/operation-visual-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/rocket-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/rank-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/traffic-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/lava-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/map-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/trees-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/features-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/building-animation-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/audio-check.mjs
```

`ASHLINE_URL` overrides the default local URL. Screenshots are written to `/tmp/ashline-qa` (override with `ASHLINE_SCREENSHOTS`). Browser checks cover deployment, selection, orders, production, camera controls, pause/restart, and mobile touch input.

## Implementation

The game runs directly from static files. `sim.js` owns the deterministic simulation and opponent, `render.js` draws the battlefield with Canvas 2D, and `main.js` connects pointer/keyboard/touch input to the compact DOM command console. `save.js` validates and restores the versioned local save, and `audio.js` generates sound effects with native Web Audio and plays the local soundtrack. No runtime packages or network services are required.

Units and buildings use freshly rendered low-resolution military sprites: broad armor panels, substantial weapons and machinery, and clean color clusters designed for gameplay size. Unit frames are 32–64 pixels and building frames are 40–104 pixels. Nearest-neighbor normalization and sprite drawing keep roofs, turns, zoom, portraits, and production previews crisp; terrain, fog, and soft shadows retain smooth rendering. Friendly units and buildings have ivory armor with cobalt panels and blue square insignia; enemies have broad crimson armor and red diamond insignia. These colors and shapes carry through production previews, cargo/idle states, and the minimap. `assets.js` loads and normalizes the sprite atlases once, prepares faction colors, and supplies the textured terrain. The battlefield fills the viewport; a collapsible production console and contextual selection controls preserve space for play. Asset provenance and the complete built-in image-generation prompt set are in [assets/generated/ASSETS.md](assets/generated/ASSETS.md).

Units keep a fixed, mostly overhead view with shallow side depth as they turn. A shared overhead unit atlas supplies the roof textures; continuous ground-plane rotation, fixed foreshortening, and screen-space side walls preserve one camera angle for every facing. The camera check covers full turns, animation registration, transparency, and desktop/mobile previews at normal and minimum zoom.

Units and buildings cast soft silhouette shadows from a fixed upper-left light. Shadows draw on the ground before objects, grow with building construction, and respect fog of war. Prepared shadow images are cached with the sprites.
