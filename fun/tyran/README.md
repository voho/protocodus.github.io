# Tyran

An original browser arcade shooter inspired by the vertical scrolling tradition of Tyrian. Available at `/fun/tyran/`, linked from the home page and Fun section. Static ES modules and Canvas 2D; no build step, third-party runtime, account, or backend.

## Play

Serve the repository root and open the game:

```sh
python3 -m http.server 8773 --bind 127.0.0.1
```

Open `http://127.0.0.1:8773/fun/tyran/`.

- **Solo:** use WASD/arrows to steer; hold either Control key, Space, or Enter to fire.
- **Co-op pilot 1:** WASD to move; left Control or Space to fire.
- **Pilot 2:** arrows to move; right Control or Enter to fire. Choose co-op before launching.
- **Pause:** Escape or P. **Sound:** M. Sound and effects quality are also available in the pause menu.
- **Weapons:** **left Alt / Option** switches player one between **Pulse Array** and **Plasma Mortar**; **right Alt / Option** switches player two. Tap the weapon name in your HUD to switch with a mouse or touch. Each pilot chooses independently, including in the shop; the six-tier Ion armament upgrade improves both weapons for both pilots.
- **Touch:** drag the left control to steer and hold the right control to fire.

During flight, delivered keyboard events are canceled in capture phase and stopped before other page handlers; this includes modifier combinations while firing and switching. Escape or P pauses, and Tab pauses for keyboard navigation of the controls. Menus retain normal Tab, Enter and Space behavior. Supported fullscreen browsers also request Keyboard Lock for gameplay keys and release it on pause, focus loss or fullscreen exit. Browser permission denial falls back to ordinary event capture. A webpage cannot block OS-reserved shortcuts that the browser never receives.

Choose **New campaign** to start in sector one and fight through ten worlds: jungle, snow, desert, tropical islands, asteroid belt, Mars, volcanic foundry, neon city, alien garden, and void citadel. Each introduces nine enemy classes, followed by a sector guardian with three attack phases. Each sector has its own fleet family and hull designs: ten classes across ten families make 100 enemy variants. World cards preview each environment; **Practice sector** starts from that world with a fresh ship and leaves your saved campaign untouched.

Destroy ships and scenery for credits, collect repair and salvage pickups, and purchase six tiers each of weapons, shields, hull, and recharge between sectors. The shop shows campaign progress, your ship's capacities, and each upgrade's current and next values before purchase. Pulse Array delivers fast, precise twin bolts; Plasma Mortar fires slower, heavier orbs with splash damage against clustered targets. Switching preserves the current shot cooldown. Enemy formations fly coordinated vee, wall, orbit, escort and pincer patterns. Guardians seal their armor between attack cycles; glowing weak points open during safe firing windows and can be broken for bonus damage. Chaining a double kill, multi kill or rampage overcharges damage and blast radius for a few seconds, then resets if the timer expires or the pilot is hit. Co-op shares the upgrade budget and equipment; one surviving pilot can complete a sector, and both ships return with full hull and shields at the next launch. Retry keeps current equipment and accumulated credits/score.

Ground structures now offer targets and rewards. Turrets telegraph their aim before firing at passing ships; destroy the emplacement to stop its fire. Marked supply structures release one pickup when destroyed, including through a nearby explosion. Their locations and contents follow the level seed. Repair and credit supplies join two temporary bonuses:

- **Rapid fire:** fire 65% faster for ten seconds, with the current weapon's projectile damage unchanged.
- **Immortality:** take no hull or shield damage for ten seconds.

Each bonus belongs to the pilot who collects it. Picking up the same bonus refreshes its ten-second duration; different bonuses can run together. Ship effects and each pilot's countdown show what is active. Pausing freezes both timers, campaign autosaves preserve them, and a new sector starts without temporary bonuses.

## Automatic campaign progress

- **New campaign** begins at sector one and replaces the previous campaign. **Resume campaign** returns to your saved flight or shop; there are no manual save/load controls.
- Progress saves automatically every five seconds of flight, when pausing or leaving, at each sector launch/clear, after shop purchases and weapon selections, and at campaign completion. Stage, credits, score, equipment and solo/co-op mode are included. Each pilot's active weapon is saved independently.
- A saved flight also restores ships, health, enemies, formations, projectiles, boss state, level hash, scenery damage stages, ground turret firing state, temporary bonuses and remaining blast momentum. It opens paused; press **Resume flight** when ready. A shop save reopens the shop before the next launch.
- Progress stays in this browser's local storage. The game reports unavailable storage or unreadable saves and keeps the current flight playable. If the browser closes unexpectedly, at most the last five seconds of flight since a successful autosave may be lost. Practice flights never overwrite campaign progress.

The single storage key is `tyran-campaign`. Existing `tyran-save-v2:auto` and `tyran-save-v2:manual` saves remain compatible: the newest valid one is adopted when resuming, unless a campaign already exists. Earlier version-one checkpoints migrate into the shop before their next sector. Stored input is validated and bounded before restoring; formation references are rebuilt without replaying reward or transition events. Older saves map lance to pulse and scatter, seeker or arc to plasma; retired projectiles already in flight finish with their original behavior. The `sceneryVersion` marker distinguishes current structure health from earlier saves. Restoring older damage preserves the percentage of health remaining against the new armor totals, so a lightly damaged old building remains lightly damaged.

## Visuals and audio

Runtime artwork uses 20 detailed sprite atlases: seven base sheets for terrain, scenery, ships and effects, three destruction sheets and ten sector fleet families. The asset library keeps only the lossless WebP atlases used by the game; duplicate PNGs and retired landscape paintings have been removed. The WebPs retain identical pixels and transparency to the original PNGs. Weathered metal, fine foliage, mineral relief and textured fire retain the existing biome palettes. The renderer decodes the atlases before preparing flight and caches palette grading and silhouette shadows. Generated assets and their provenance are recorded in `assets/sprites/prompts.json`; common fleet and procedural artwork provide fallbacks when a specialized atlas is unavailable. The map uses generated material tiles and connected shoreline/cliff masks. Audio effects and an adaptive electronic sequence are synthesized with Web Audio after a user gesture.

Player damage produces a brief defocus pulse (stronger for hull hits); the canvas softens while HUD and menu text stay sharp. Explosions add a warm fire bloom, with horizontal lens streaks and faint reflections for large blasts and bosses. Shared cached textures and a six-flare limit keep these effects bounded. Effects have high/low settings. Reduced-motion preference disables screen shake, impact blur, lens flares and bright screen flashes, and softens fire bloom. Losing window focus automatically pauses. Failure or denial of local storage and audio does not prevent play.

Ships cast separate ground shadows, with silver armor rims, white-hot engine fire and warm nozzle bloom. Every sector has a reserved high-contrast fleet palette (for example red/yellow over jungle and acid green/yellow over the black asteroid belt), separate from terrain and scenery materials. Fleet source sheets share red armor and gold trim, which the renderer remaps to each sector's complementary colors while preserving neutral metal shading. Every ship uses one fixed hull sprite and shadow: players face up, enemies face down. Steering never rotates or deforms a hull. Restrained exhaust flicker and reactor lighting provide life without alternate sprite frames; reduced-motion mode freezes these decorative effects. Two cached player projectile textures make each weapon readable in motion; hostile projectiles also use cached sprites with size and color tied to the firing ship. Thrust responds to acceleration. Hull and equipment add mass: heavier ships accelerate, coast and reverse more gradually while retaining their cruise speed. Keyboard and touch controls both use this motion model. Mouse movement and clicks never steer or fire a ship; interface buttons remain clickable.

Each level is generated from a stable hash of its world ID and seed. `WorldRenderer.setWorld(index, seed)` reproduces the same terrain and scenery; changing the seed changes the layout. The campaign uses the default `tyran-v2` seed. The map consists of 100-pixel cells with four elevation materials and shared corner masks that connect water, banks, ground and ridges. Six material variants per elevation add surface detail. Irregular contours join at shared tile crossings, with layered cliff shadows, broken rims, erosion fissures, sediment and low relief. Varied crops of the generated materials reduce obvious repeats. Cells are assembled into nearby 800-pixel strips for fast drawing, rather than painted as one landscape.

Exactly two planes scroll: **ground** and **atmosphere**. Water, terrain, rocks, vegetation, ground vehicles, buildings and their craters share the ground transform, keeping every object attached to its map cell. Clouds and drifting particles form the faster atmosphere plane. Extra offscreen cells cover the subtle lateral camera movement. Destructible scenery uses the same transform for rendering and collision. Terrain, scenery, shadows, glow, wreckage and projectile sprites are cached; the menu prepares opening terrain and nearby chunks are prepared during flight. Pixel caches stay bounded as the level scrolls, while a compact damage ledger preserves damaged and destroyed objects. Enemy formations enter, attack and depart instead of accumulating at the bottom of the arena.

Sprite memory is shared by appearance, not by actor. Atlas preparation keeps alpha-trimmed cells and releases full decoded sheets; derived ship caches retain roughly one fleet plus both pilots. Destruction artwork is created on demand, with at most 32 cached damage sprites (8.25 MiB); idle time prepares the next stage of structures already taking damage. Three shared scratch canvases handle scenery grading, shadows and local damage refreshes (6.3 MiB total). Only the grading scratch requests CPU pixel storage for tint readback; scenery strips retain normal GPU acceleration. Explosions reuse up to 700 particle records, select frames from shared art by age, and cap other transient effects. Scenery stores each object either as injured HP or a crater marker. Campaign menus retain only summary fields; full saved flights are read when resumed.

Seeded clusters of small rocks, scrub, coral and rubble add ground cover around the original scenery. They use an independent random stream, preserving saved destructible IDs and positions. Radar sweeps, service lights and small rooftop exhaust puffs animate in place; damaged machinery becomes quieter and destroyed structures stop. Static strips remain cached, and reduced-motion mode freezes ambient animation. Repair capsules and gold credit chips retain different silhouettes with a shared subtle green pickup halo.

Structures and ground vehicles have four persistent appearances: fresh, lightly damaged, heavily damaged and crater. Damage changes their sprite at 70%, 35% and depleted health; intermediate hits reuse the cached scenery strip. Durability scales with footprint area and the structure's armor: doubling the width of the same type gives roughly four times the health. Destroying a large structure gives nearby light ships a gentle outward shove without damage. The impulse fades quickly, is weaker on heavier craft, excludes bosses and large ships, and never replaces the player's steering input.

Mission terrain accelerates smoothly from its opening pace to 1.75× speed by the final approach, then uses the slower boss-battle pace. The ramp follows elapsed mission time, so pausing freezes it, resuming a saved flight preserves the pace, and each new sector starts its own build-up.

Physics runs at a fixed 60 updates per second. Rendering interpolates between updates for smooth motion on faster displays and catches up through brief slow frames with a bounded budget. Paused and covered title screens stop repainting the arena. High-DPI rendering has a pixel budget and reduces backing resolution under sustained load; this never changes the flight area or simulation speed.

Damage refreshes only the affected part of a scenery strip, retaining overlapping objects in their original drawing order. Seeded ground-cover geometry is reused, and ground combat queries only mounted turrets. Ship and projectile drawing share canvas state where possible; offscreen ammunition and effects skip drawing. Lens streaks submit their narrow visible strip instead of a mostly transparent square. HUD meters animate with transforms instead of triggering layout on every update.

## Structure

| File | Responsibility |
| --- | --- |
| `game.js` | Rendering loop, input, screens, persistence and integration |
| `sim.js` | Combat, collision, campaign progression and upgrade economy |
| `save-game.js` | Validated campaign autosaves and legacy migration |
| `worlds.js` | Ten scrolling environments and destructible scenery |
| `tile-map.js` | Pure seeded terrain generation and shared corner masks |
| `terrain-sprites.js` | Reusable material and shoreline/cliff sprites |
| `sprite-assets.js` | Atlas loading, alpha extraction and shared decoded cells |
| `ships.js` | Ten enemy classes and fleet families, reserved palettes, fixed hulls and cached spacecraft artwork |
| `projectile-sprites.js` | Palette-matched ammunition textures and visual sizing |
| `effects.js` | Explosions, debris, lighting, wreckage and motion |
| `audio.js` | Original synthesized music and sound effects |
| `index.html`, `style.css` | Responsive menu, HUD, hangar and controls |

## Verification

```sh
node fun/tyran/tests/sim-check.mjs --balance
node fun/tyran/tests/tile-map-check.mjs
node fun/tyran/tests/save-game-check.mjs
node fun/tyran/tests/ground-combat-check.mjs
node tests/navigation-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/campaign-save-browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/destruction-save-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/blast-integration-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ground-sites-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ground-combat-browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/mouse-controls-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/timing-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/keyboard-weapons-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/world-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/terrain-relief-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/living-scenery-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-visual-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-fixed-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/raster-fleet-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/fleet-families-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/projectile-effects-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/render-lifecycle-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/impact-effects-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/sprite-memory-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/scenery-memory-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/effects-memory-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/scenery-refresh-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-draw-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/projectile-batch-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/effects-render-work-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/performance-check.mjs
```

Browser QA expects the root server at port 8773 and installed Chrome. `TYRAN_URL`, `TYRAN_BROWSER` and `TYRAN_SCREENSHOTS` override the defaults. Screenshots are written outside the repository to `/tmp/tyran-qa`.

For a heavier performance run, add `TYRAN_DPR=2 TYRAN_CPU_RATE=4 TYRAN_PERF_STRESS=1`: this uses high pixel density, fourfold CPU throttling, accelerated late-mission scrolling, rapid fire, recurring impact blur and large explosions. `TYRAN_PERF_OUTPUT` selects the directory for frame traces, CPU profiles, GPU-backend metadata and screenshots. Rendering checks compare pixels and canvas state, verify bounded scratch memory, and count avoided drawing work; draw-area savings are not GPU-time measurements.

The simulation suite verifies collision, shields, all spawn schedules, upgrades, co-op deaths/revival, blast shove limits and the full campaign. Optional deterministic autopilot trials complete both solo and co-op using ordinary movement and firing plus earned purchases. These trials prove reachability; they do not substitute for human difficulty tuning. Save tests verify next-step equivalence, formation identity, boss windows, shop/victory restoration, corruption, denied storage and legacy migration. Destruction QA checks all four raster stages through restoration and cache eviction, one-time armor migration, cache reuse between stage transitions and reward deduplication. Ground combat QA checks seeded supply and turret sites, aiming warnings, sparse hostile fire, one-time direct/collateral rewards, both weapons with rapid fire, invulnerability, co-op ownership and exact bonus/turret autosave restoration. Browser QA covers automatic mid-flight saves, pause/menu/reload persistence, practice isolation, shop purchases, campaign continuation, both physical Control and Alt keys, independent weapon choices, world previews, scenery destruction, victory and real touch input.

Timing QA drives real keyboard events at simulated 30/60/120 Hz, checking movement parity, visible interpolation, pause, slow-frame recovery and adaptive resolution. Mouse QA verifies that moving, clicking and dragging never steer or fire a ship, that keyboard controls retain control, and that interface buttons remain clickable. Fleet QA checks all 100 family hulls, source proportions, fixed hull geometry, reduced motion and absence of retired banking downloads. Map tests check seed reproducibility, material variety and adjacent corner continuity. World checks cover all ten biomes at three viewport widths, exactly two planes, ground alignment, persistent destruction and bounded caches, and verify no landscape images are requested. The performance harness records Chrome frame intervals and CPU profiles during a repeatable co-op battle across multiple terrain chunks; it reports measurements without assuming other computers have the same frame rate.

Impact QA checks damage blur through real shield/hull hits, invulnerability, pause/resume, quality settings, reduced motion and end-screen cleanup.

Memory QA cycles every fleet repeatedly, checks shared damage/animation sources, verifies pixel-identical regeneration after cache eviction, restores old destruction records, and stresses repeated boss explosions. Memory estimates count retained RGBA surfaces, excluding browser-managed image/file caches and GPU overhead.
