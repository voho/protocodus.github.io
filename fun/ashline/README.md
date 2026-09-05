# Ashline

An original 2D real-time strategy game for the browser. Lead an expedition into the ashlands, harvest minerals, build and defend a base, and defeat the opposing command center.

Every match has a procedurally generated battlefield, mineral deposits, terrain obstacles and fog of war. Construct production buildings and defenses, recruit specialized units, and face an AI that develops its economy and adapts its attacks.

Every completed refinery includes one free hauler. Haulers automatically collect and deliver minerals, and resume harvesting after moving or stopping. Armed units guard by default: they fire at visible enemies in weapon range while holding their position. Moving or stopping returns them to guard when the order finishes.

Select units and toggle **Explore** (X) to automatically scout reachable unexplored areas. Armed explorers stop to fire at nearby visible enemies and resume exploring afterward. Haulers can explore too; they resume harvesting when exploration ends. Toggle Explore again, stop, or issue a manual move, attack, or harvest order to end auto-explore. When no reachable unexplored areas remain, armed units return to guarding.

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
| Shift + select | Add to the selection |
| Right click | Move, attack an enemy, or send a harvester to minerals |
| A, then click | Attack move |
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

On touchscreens, tap to select, then tap a destination or target. Drag empty ground to pan. The production console starts collapsed and closes after choosing a structure so its placement stays visible.

## Simulation checks

From this directory:

```sh
node tests/sim-check.mjs
node tests/orders-check.mjs
node tests/explore-check.mjs
```

The checks exercise seeded maps, route connectivity, fog, finite harvesting and recovery, construction, production, power, complete skirmishes, included refinery haulers, automatic harvesting orders, default guarding, and auto-exploration with cancellation and route recovery.

For browser interaction checks, use an existing Playwright installation and Chrome while the local server is running:

```sh
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/camera-check.mjs
```

`ASHLINE_URL` overrides the default local URL. Screenshots are written to `/tmp/ashline-qa` (override with `ASHLINE_SCREENSHOTS`). Browser checks cover deployment, selection, orders, production, camera controls, pause/restart, and mobile touch input.

## Implementation

The game runs directly from static files. `sim.js` owns the deterministic simulation and opponent, `render.js` draws the battlefield with Canvas 2D, and `main.js` connects pointer/keyboard/touch input to the compact DOM command console. No runtime packages or network services are required.

Generated building, unit, mineral and rock sprites share a weathered steel/ashland visual style. `assets.js` loads and normalizes the sprite atlases once, prepares faction colors, and supplies the textured terrain. The battlefield fills the viewport; a collapsible production console and contextual selection controls preserve space for play. Asset provenance and the complete built-in image-generation prompt set are in [assets/generated/ASSETS.md](assets/generated/ASSETS.md).

Units keep a fixed, mostly overhead view with shallow side depth as they turn. A shared overhead unit atlas supplies the roof textures; continuous ground-plane rotation, fixed foreshortening, and screen-space side walls preserve one camera angle for every facing. The camera check covers full turns, animation registration, transparency, and desktop/mobile previews at normal and minimum zoom.
