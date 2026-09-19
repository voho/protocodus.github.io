# Tyran

An original browser arcade shooter inspired by the vertical scrolling tradition of Tyrian. Available at `/fun/tyran/`, linked from the home page and Fun section. Static ES modules and Canvas 2D; no build step, third-party runtime, account, or backend.

## Play

Serve the repository root and open the game:

```sh
python3 -m http.server 8773 --bind 127.0.0.1
```

Open `http://127.0.0.1:8773/fun/tyran/`.

- **Solo:** WASD or arrows to move; either Control key, Space, or Enter to fire.
- **Co-op pilot 1:** WASD to move; left Control or Space to fire.
- **Pilot 2:** arrows to move; right Control or Enter to fire. Choose co-op before launching.
- **Pause:** Escape or P. **Sound:** M. Sound and effects quality are also available in the pause menu.
- **Weapons:** number keys **1–6** swap the active fire profile. Choose the same profiles in the service bay; the six-tier Ion armament upgrade improves every profile without removing its tradeoff.
- **Touch:** drag the left control to steer and hold the right control to fire.

Choose **New campaign** to start in sector one and fight through ten worlds: jungle, snow, desert, tropical islands, asteroid belt, Mars, volcanic foundry, neon city, alien garden, and void citadel. Each introduces nine enemy classes, followed by a sector guardian with three attack phases. Ten sector liveries and fittings create 100 enemy variants from ten underlying silhouettes. World cards preview each environment; **Fly selected sector** starts from that world with a fresh ship.

Destroy ships and scenery for credits, collect repair and salvage pickups, and purchase six tiers each of weapons, shields, hull, and recharge between sectors. The shop shows campaign progress, your ship's capacities, and each upgrade's current and next values before purchase. Pulse, scatter, lance, seeker, plasma and arc profiles trade fire rate for reach, piercing, homing, splash or chain jumps. Enemy formations fly coordinated vee, wall, orbit, escort and pincer patterns. Guardians seal their armor between attack cycles; glowing weak points open during safe firing windows and can be broken for bonus damage. Chaining a double kill, multi kill or rampage overcharges damage and blast radius for a few seconds, then resets if the timer expires or the pilot is hit. Co-op shares the upgrade budget and equipment; one surviving pilot can complete a sector, and both ships return with full hull and shields at the next launch. Retry keeps current equipment and accumulated credits/score.

## Save and load

- **Continue** loads the automatic slot, updated at launch, after a sector clear, after shop purchases/profile selections, and at campaign completion.
- **Save game** in the pause menu or shop writes a separate manual slot. **Load game** restores that slot from the menu, pause screen, shop or debrief. Starting another campaign preserves the manual slot.
- A saved flight restores its ships, health, credits, equipment, enemies, formations, projectiles, boss state, level hash and scenery destruction. It opens paused; press **Resume flight** to continue. A shop save reopens the shop before the next launch.
- Saves use this browser's local storage. The game reports unavailable storage or unreadable saves and keeps the current flight playable. Earlier version-one checkpoints migrate into the shop before their next sector.

The versioned storage keys are `tyran-save-v2:auto` and `tyran-save-v2:manual`. Stored input is validated and bounded before loading; formation references are rebuilt without replaying reward or transition events.

## Visuals and audio

Runtime artwork comes from seven generated PNG sprite atlases: 113 cells for terrain materials, vegetation, structures, ground vehicles, ships, projectiles, pickups and effects. Weathered metal, fine foliage, mineral relief and textured fire retain the existing biome palettes. The renderer decodes the atlases before preparing flight and caches palette grading, silhouette shadows and banking frames. Original assets and exact prompts are in `assets/sprites/`; procedural artwork remains available if an atlas fails to load. The map uses generated material tiles and connected shoreline/cliff masks. Audio effects and an adaptive electronic sequence are synthesized with Web Audio after a user gesture.

Effects have high/low settings. Reduced-motion preference disables screen shake, impact blur and bright screen flashes. Losing window focus automatically pauses. Failure or denial of local storage and audio does not prevent play.

Ships cast separate ground shadows, with silver armor rims, white-hot engine fire and warm nozzle bloom. Every sector has a reserved high-contrast fleet palette (for example red/yellow over jungle and acid green/yellow over the black asteroid belt), separate from terrain and scenery materials. Three roll sprites narrow and shade the wings while keeping the nose heading fixed. Six cached player projectile textures make each profile readable in motion; hostile projectiles also use cached sprites with size and color tied to the firing ship. Thrust responds to acceleration. Hull and equipment add mass: heavier ships accelerate, coast, reverse and bank more gradually while retaining their cruise speed. Both keyboard layouts use the same motion model.

Each level is generated from a stable hash of its world ID and seed. `WorldRenderer.setWorld(index, seed)` reproduces the same terrain and scenery; changing the seed changes the layout. The campaign uses the default `tyran-v2` seed. The map consists of 100-pixel cells with four elevation materials and shared corner masks that connect water, banks, ground and ridges. Six material variants per elevation add surface detail. Cells are assembled into nearby 800-pixel strips for fast drawing, rather than painted as one landscape.

Five planes provide parallax: deep water or space, tile ground, rocks and ground vehicles, trees and tall vegetation, then high structures and clouds. Scenery is projected around the viewport center so its height offset remains bounded throughout a flight. Extra offscreen cells cover the subtle lateral camera movement. Destructible scenery uses the same layer transform for rendering and collision. Terrain, scenery, shadows, glow, wreckage and projectile sprites are cached; the menu prepares opening terrain and nearby chunks are prepared during flight. Pixel caches stay bounded as the level scrolls, while a compact damage ledger preserves destroyed objects. Enemy formations enter, attack and depart instead of accumulating at the bottom of the arena.

Physics runs at a fixed 60 updates per second. Rendering interpolates between updates for smooth motion on faster displays and catches up through brief slow frames with a bounded budget. Paused and covered title screens stop repainting the arena. High-DPI rendering has a pixel budget and reduces backing resolution under sustained load; this never changes the flight area or simulation speed.

## Structure

| File | Responsibility |
| --- | --- |
| `game.js` | Rendering loop, input, screens, persistence and integration |
| `sim.js` | Combat, collision, campaign progression and upgrade economy |
| `save-game.js` | Validated run snapshots, local save slots and legacy migration |
| `worlds.js` | Ten scrolling environments and destructible scenery |
| `tile-map.js` | Pure seeded terrain generation and shared corner masks |
| `terrain-sprites.js` | Reusable material and shoreline/cliff sprites |
| `sprite-assets.js` | Atlas loading, alpha extraction and shared decoded cells |
| `ships.js` | Ten enemy classes, reserved fleet palettes and cached spacecraft artwork |
| `projectile-sprites.js` | Palette-matched ammunition textures and visual sizing |
| `effects.js` | Explosions, debris, lighting, wreckage and motion |
| `audio.js` | Original synthesized music and sound effects |
| `index.html`, `style.css` | Responsive menu, HUD, hangar and controls |

## Verification

```sh
node fun/tyran/tests/sim-check.mjs --balance
node fun/tyran/tests/tile-map-check.mjs
node fun/tyran/tests/save-game-check.mjs
node tests/navigation-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/campaign-save-browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/timing-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/world-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-visual-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-roll-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/raster-fleet-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/projectile-effects-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/render-lifecycle-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/performance-check.mjs
```

Browser QA expects the root server at port 8773 and installed Chrome. `TYRAN_URL`, `TYRAN_BROWSER` and `TYRAN_SCREENSHOTS` override the defaults. Screenshots are written outside the repository to `/tmp/tyran-qa`.

The simulation suite verifies collision, shields, all spawn schedules, upgrades, co-op deaths/revival, and the full campaign. Optional deterministic autopilot trials complete both solo and co-op using ordinary movement and firing plus earned purchases. These trials prove reachability; they do not substitute for human difficulty tuning. Save tests verify next-step equivalence, formation identity, boss windows, independent slots, shop/victory restoration, corruption, denied storage and legacy migration. Browser QA covers manual mid-flight saves and reloads, shop purchases, campaign continuation, both physical Control keys, pause, world previews, scenery destruction, victory and real touch input.

Timing QA drives real keyboard events at simulated 30/60/120 Hz, checking movement parity, visible interpolation, pause, slow-frame recovery and adaptive resolution. Map tests check seed reproducibility, material variety and adjacent corner continuity. World checks cover all ten biomes at three viewport widths, edge coverage, depth-correct hits, persistent destruction and bounded caches, and verify no landscape images are requested. The performance harness records Chrome frame intervals and CPU profiles during a repeatable co-op battle across multiple terrain chunks; it reports measurements without assuming other computers have the same frame rate.
