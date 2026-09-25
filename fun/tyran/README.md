# Tyran

An original browser arcade shooter inspired by the vertical scrolling tradition of Tyrian and the swarming choreography of Galaga. Available at `/fun/tyran/`, linked from the home page and Fun section. Static ES modules and Canvas 2D; no build step, third-party runtime, account, or backend.

## Play

Serve the repository root and open the game:

```sh
python3 -m http.server 8773 --bind 127.0.0.1
```

Open `http://127.0.0.1:8773/fun/tyran/`.

- **Single player:** WASD to move; **Space** fires your primary gun, **Q** fires secondary plasma, **E** detonates a nova charge.
- **Pause:** Escape, P or Tab. **Sound:** V. Sound and effects quality are also available in the pause menu.
- **Weapons:** your ship carries one primary gun (Pulse Array, Scatter Cannon or Lance Driver) and the Plasma Mortar. Each fire key uses its own weapon directly; there is no weapon-switch key. The six-tier Ion armament upgrade improves every gun and drone.
- **Touch:** drag the left control to steer, hold Pulse or Plasma on the right to fire and tap Nova to detonate.

## How a sector plays

Each sector is a script of waves (`waves.js`), followed by its guardian:

- **Swarm (hive) waves.** Squadrons fly in along looping Catmull-Rom paths in conga lines — wide rows arrive as two mirrored lines — and settle into a breathing hive below the HUD. Ships then peel off to dive at the pilot, fire from the top of their loop and on the way down, and wrap unseen to the top to rejoin their slot. Commanders take escorts from the row beneath them, dives grow more frequent as the swarm thins, bottom-row ships take occasional potshots, and needles home in as kamikazes. A ship destroyed mid-dive is worth double. After a timeout the remaining swarm makes one last pass and leaves.
- **Strike squadrons** sweep across on zigzag, cross, arc, snake and U-turn paths while firing; reapers plunge diagonally in threes. Chevrons at the screen edge announce side entries about a second in advance.
- **Gunships** descend to firing stations. Lancers lock a firing line, paint it as a pulsing dashed line, then fire a short heavy beam along it; bulwarks fire rings.
- **Heavy cruiser (midboss).** A reinforced dreadnought alternates rings and aimed fans while escorts cross; it drops a power core and a wing drone.
- **Captor.** A harbinger hovers above the pilot and projects a tractor cone. It steals one wing drone, parades it upside down beneath itself and turns its guns on the pilot; shooting the captor down rescues the drone (+1,500). With no drone to steal, the beam drains shields and fire energy and hauls the ship upward. It escapes with its prize after a while.
- **Tactical formations** (from sector 4) reuse the anchored vee, wall, orbit, escort and pincer formations.

Destroying every ship of a squadron before any escapes pays a squadron bonus; every third wiped squadron drops a power core. Enraged guardians launch pairs of diving interceptors.

After the guardians of sectors 1, 3, 5, 7 and 9, a **challenging stage** flies 40 ships through acrobatic figure-eight, orbit and loop paths without firing or colliding. The stage reports hits out of 40 and pays credits and score per hit, with a large perfect bonus.

**In-flight progression.** Power cores widen the primary through five levels (pulse stream, scatter fan, piercing lances); outer bolts are slightly weaker so width is not pure multiplication, and only the central bolts strike ground scenery so wide volleys do not farm salvage. A hit that gets through the shield knocks one core loose; it drifts away and can be caught again after about a second. Up to two wing drones fly in formation, echo every primary volley and soak up hostile rounds. Nova charges clear all hostile fire (each cancelled round scores), strike every visible ship, interrupt captor beams and grant a brief shield; they need a fresh key press. Each sector launches with at least two. Reserve ships continue the sector after a short delay with a three-second launch shield, a cleared launch lane, two fewer power levels and one fewer drone. Score milestones (30,000, then every 120,000) award extra ships up to five in reserve. Retrying a failed sector continues with at least two reserve ships.

Heavy kills briefly freeze the simulation (hitstop); the freeze holds the rendered frame exactly still and resumes without a catch-up burst. In-combat notices (waves, captures, extra ships) use a compact banner below the HUD so they do not cover the fight. A master limiter and a shared voice slot for simultaneous explosions keep novas and mass kills from clipping. The shop prepares the next sector's terrain, scenery and fleet liveries during idle time, so launching it builds nothing. The soundtrack switches to a brighter loop for challenging stages and a faster one for guardians. The shop shows a Galaga-style flight report: shots, hits and hit ratio, squadrons wiped, dive kills, rescues and the challenging stage result.

Primary fire is unlimited. Secondary plasma deals 58 base damage per orb, adds splash damage and costs 20 fire energy. Your ship has a 100-energy reserve that regenerates at 18/s after one second without a secondary shot. Depletion locks secondary fire until 40 energy has recovered, then a held secondary key resumes automatically. Primary fire remains available while energy recovers; holding both keys favors secondary while charged and primary during recovery. A shared shot cooldown prevents rapid key alternation from firing extra volleys. Fusion capacitor upgrades increase energy regeneration by 3/s per tier and reduce its delay by 0.1 seconds per tier, alongside their existing shield benefits. Rapid fire consumes secondary energy faster. New sectors refill the reserve.

During flight, delivered keyboard events are canceled in capture phase and stopped before other page handlers; this includes modifier combinations while firing. Escape or P pauses, and Tab pauses for keyboard navigation of the controls. Menus retain normal Tab, Enter and Space behavior. Supported fullscreen browsers also request Keyboard Lock for gameplay keys and release it on pause, focus loss or fullscreen exit. Browser permission denial falls back to ordinary event capture. A webpage cannot block OS-reserved shortcuts that the browser never receives.

Choose **New campaign** to start in sector one and fight through ten worlds: jungle, snow, desert, tropical islands, asteroid belt, Mars, volcanic foundry, neon city, alien garden, and void citadel. Each sector's wave script introduces all nine enemy classes, followed by a sector guardian with three attack phases. Each sector has its own fleet family and hull designs: ten classes across ten families make 100 enemy variants. World cards preview each environment; **Practice sector** starts from that world with a fresh ship and leaves your saved campaign untouched.

Destroy ships and scenery for credits, collect repair and salvage pickups, and purchase six tiers each of weapons, shields, hull, and recharge between sectors. The shop also sells the Scatter Cannon (1,100) and Lance Driver (1,600) — bought once, then equipped freely — plus wing drones, nova charges and reserve ships (each more expensive than the last); power, drones and nova charges carry into the next sector. The shop shows campaign progress, your ship's capacities, and each upgrade's current and next values before purchase. Pulse Array delivers fast, precise twin bolts; Plasma Mortar fires slower, heavier orbs with splash damage against clustered targets. Both fire keys share a cooldown. Enemy formations fly coordinated vee, wall, orbit, escort and pincer patterns. Guardians seal their armor between attack cycles; glowing weak points open during safe firing windows and can be broken for bonus damage. Chaining a double kill, multi kill or rampage overcharges damage and blast radius for a few seconds, then resets if the timer expires or the pilot is hit. Your ship launches each new sector with full hull, shields and fire energy. Retry keeps current equipment and accumulated credits/score. Hostile rounds hit harder in later sectors so upgraded hulls still respect incoming fire; salvage per kill grows more gently than score.

Ground structures now offer targets and rewards. Turrets telegraph their aim before firing at passing ships; destroy the emplacement to stop its fire. Marked supply structures release one pickup when destroyed, including through a nearby explosion. Their locations and contents follow the level seed. Repair and credit supplies join two temporary bonuses:

- **Rapid fire:** fire 65% faster for ten seconds, with the current weapon's projectile damage unchanged.
- **Immortality:** take no hull or shield damage for ten seconds.

Picking up the same bonus refreshes its ten-second duration; different bonuses can run together. Ship effects and the HUD countdown show what is active. Pausing freezes both timers, campaign autosaves preserve them, and a new sector starts without temporary bonuses.

## Automatic campaign progress

- **New campaign** begins at sector one and replaces the previous campaign. **Resume campaign** returns to your saved flight or shop; there are no manual save/load controls.
- Progress saves automatically every five seconds of flight, when pausing or leaving, at each sector launch/clear, after shop purchases, and at campaign completion. Stage, credits, score, equipment, fire energy, recharge delay and depleted state are included.
- A saved flight also restores ships, health, enemies, formations, projectiles, boss state, level hash, scenery damage stages, ground turret firing state, temporary bonuses and remaining blast momentum, plus the wave script position, hive, conga-line queues, dives, squadron bonuses, captor and captive drone, lancer beams, power, drones, nova charges, reserve ships, the challenging stage and the flight report. Saves from before the wave script resume with a fresh script and the default loadout. It opens paused; press **Resume flight** when ready. A shop save reopens the shop before the next launch.
- Progress stays in this browser's local storage. The game reports unavailable storage or unreadable saves and keeps the current flight playable. If the browser closes unexpectedly, at most the last five seconds of flight since a successful autosave may be lost. Practice flights never overwrite campaign progress.

The single storage key is `tyran-campaign`. Existing `tyran-save-v2:auto` and `tyran-save-v2:manual` saves remain compatible: the newest valid one is adopted when resuming, unless a campaign already exists. Earlier version-one checkpoints migrate into the shop before their next sector. Older co-op saves continue as single-player, retaining the first surviving ship (player one when both survived), progress and equipment. Enemy and boss weak-point health scale down to the solo balance with their damage fraction preserved. Projectile ownership and turret targets migrate once. Saves without fire-energy fields start with a full reserve. Saved data is validated and bounded before restoring; formation references are rebuilt without replaying reward or transition events. Legacy weapon metadata remains compatible; retired projectiles already in flight finish with their original behavior. All future fire uses the dedicated pulse/plasma channels. The `sceneryVersion` marker distinguishes current structure health from earlier saves. Restoring older damage preserves the percentage of health remaining against the new armor totals, so a lightly damaged old building remains lightly damaged.

## Visuals and audio

Runtime artwork uses 20 detailed sprite atlases: seven base sheets for terrain, scenery, ships and effects, three destruction sheets and ten sector fleet families. The asset library keeps only the lossless WebP atlases used by the game; duplicate PNGs and retired landscape paintings have been removed. The WebPs retain identical pixels and transparency to the original PNGs. Weathered metal, fine foliage, mineral relief and textured fire retain the existing biome palettes. The renderer decodes the atlases before preparing flight and caches palette grading and silhouette shadows. Generated assets and their provenance are recorded in `assets/sprites/prompts.json`; common fleet and procedural artwork provide fallbacks when a specialized atlas is unavailable. The map uses generated material tiles and connected shoreline/cliff masks. Audio effects and an adaptive electronic sequence are synthesized with Web Audio after a user gesture.

Player damage produces a brief defocus pulse (stronger for hull hits); the canvas softens while HUD and menu text stay sharp. Explosions add a warm fire bloom, with horizontal lens streaks and faint reflections for large blasts and bosses. Shared cached textures and a six-flare limit keep these effects bounded. Effects have high/low settings. Reduced-motion preference disables screen shake, impact blur, lens flares and bright screen flashes, and softens fire bloom. Losing window focus automatically pauses. Failure or denial of local storage and audio does not prevent play.

Ships cast separate ground shadows, with silver armor rims, white-hot engine fire and warm nozzle bloom. Every sector has a reserved high-contrast fleet palette (for example red/yellow over jungle and acid green/yellow over the black asteroid belt), separate from terrain and scenery materials. Fleet source sheets share red armor and gold trim, which the renderer remaps to each sector's complementary colors while preserving neutral metal shading. Every ship uses one fixed hull sprite and shadow: players face up, enemies face down. Steering never rotates or deforms a hull. Restrained exhaust flicker and reactor lighting provide life without alternate sprite frames; reduced-motion mode freezes these decorative effects. Two cached player projectile textures make each weapon readable in motion; hostile projectiles also use cached sprites with size and color tied to the firing ship. Thrust responds to acceleration. Hull and equipment add mass: heavier ships accelerate, coast and reverse more gradually while retaining their cruise speed. Keyboard and touch controls both use this motion model. Mouse movement and clicks never steer or fire a ship; interface buttons remain clickable.

Each level is generated from a stable hash of its world ID and seed. `WorldRenderer.setWorld(index, seed)` reproduces the same terrain and scenery; changing the seed changes the layout. The campaign uses the default `tyran-v2` seed. The map consists of 100-pixel cells with four elevation materials and shared corner masks that connect water, banks, ground and ridges. Six material variants per elevation add surface detail. Irregular contours join at shared tile crossings, with layered cliff shadows, broken rims, erosion fissures, sediment and low relief. Varied crops of the generated materials reduce obvious repeats. Cells are assembled into nearby 800-pixel strips for fast drawing, rather than painted as one landscape.

Exactly two planes scroll: **ground** and **atmosphere**. Water, terrain, rocks, vegetation, ground vehicles, buildings and their craters share the ground transform, keeping every object attached to its map cell. Clouds and drifting particles form the faster atmosphere plane. Extra offscreen cells cover the subtle lateral camera movement. Destructible scenery uses the same transform for rendering and collision. Terrain, scenery, shadows, glow, wreckage and projectile sprites are cached; the menu prepares opening terrain and nearby chunks are prepared during flight. Pixel caches stay bounded as the level scrolls, while a compact damage ledger preserves damaged and destroyed objects. Enemy formations enter, attack and depart instead of accumulating at the bottom of the arena.

Sprite memory is shared by appearance, not by actor. Atlas preparation keeps alpha-trimmed cells and releases full decoded sheets; derived ship caches retain roughly one fleet plus the player ship. Destruction artwork is created on demand, with at most 32 cached damage sprites (8.25 MiB); idle time prepares the next stage of structures already taking damage. Three shared scratch canvases handle scenery grading, shadows and local damage refreshes (6.3 MiB total). Atlases that are only recolored from their pixels — terrain materials, nature and structure scenery, all fleets and projectiles — stay in CPU memory, as do the grading scratches, so preparing a new appearance never waits on a synchronous GPU readback (previously 10–100 ms each, most visibly the first time a structure took damage in flight). Effects and pickups, which are drawn every frame, and all scenery strips keep normal GPU acceleration. Explosions reuse up to 700 particle records, select frames from shared art by age, and cap other transient effects. Scenery stores each object either as injured HP or a crater marker. Campaign menus retain only summary fields; full saved flights are read when resumed.

Seeded clusters of small rocks, scrub, coral and rubble add ground cover around the original scenery. They use an independent random stream, preserving saved destructible IDs and positions. Radar sweeps, service lights and small rooftop exhaust puffs animate in place; damaged machinery becomes quieter and destroyed structures stop. Static strips remain cached, and reduced-motion mode freezes ambient animation. Repair capsules and gold credit chips retain different silhouettes with a shared subtle green pickup halo.

Buildings now have 2.5× their previous health; nature and ground vehicles keep their existing durability. Version-three scenery saves retain the percentage of health remaining when migrating either earlier armor model. Structures and ground vehicles have four persistent appearances: fresh, lightly damaged, heavily damaged and crater. Damage changes their sprite at 70%, 35% and depleted health; intermediate hits reuse the cached scenery strip. Durability scales with footprint area and the structure's armor: doubling the width of the same type gives roughly four times the health. Destroying a large structure gives nearby light ships a gentle outward shove without damage. The impulse fades quickly, is weaker on heavier craft, excludes bosses and large ships, and never replaces the player's steering input.

Mission terrain accelerates smoothly from its opening pace to 1.75× speed by the final approach, then uses the slower boss-battle pace. The ramp follows elapsed mission time, so pausing freezes it, resuming a saved flight preserves the pace, and each new sector starts its own build-up.

Physics runs at a fixed 60 updates per second. Rendering interpolates between updates for smooth motion on faster displays and catches up through brief slow frames with a bounded budget. Paused and covered title screens stop repainting the arena. High-DPI rendering has a pixel budget and reduces backing resolution under sustained load; this never changes the flight area or simulation speed.

Damage refreshes only the affected part of a scenery strip, retaining overlapping objects in their original drawing order. Seeded ground-cover geometry is reused, and ground combat queries only mounted turrets. Ship and projectile drawing share canvas state where possible; offscreen ammunition and effects skip drawing. Lens streaks submit their narrow visible strip instead of a mostly transparent square. HUD meters animate with transforms instead of triggering layout on every update.

## Structure

| File | Responsibility |
| --- | --- |
| `game.js` | Rendering loop, input, screens, persistence and integration |
| `sim.js` | Combat, collision, power, drones, novas, reserve ships, campaign progression and shop economy |
| `waves.js` | Flight paths, sector wave scripts, hive, dives, gunship stations, captor and challenging stages |
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
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/flight-features-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/stutter-check.mjs
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

The simulation suite verifies collision, shields, every sector's wave script, path continuity at three widths, hive entry and slots, dives and their return, double dive rewards, squadron bonuses, power levels and dropped cores, gun and supply purchases, drones, the captor's capture, drain and rescue, novas, reserve ships and extra ships, lancer telegraphs, challenging stages, upgrades, defeat and refits, blast shove limits and the full campaign. Optional deterministic autopilot trials complete the campaign using ordinary movement and firing plus earned purchases, and confirm that a pilot who only holds fire loses ships in sector one and is defeated within the first three sectors. These trials prove reachability; they do not substitute for human difficulty tuning. Save tests verify next-step equivalence (including 90 steps through a busy hive wave with a nova), formation identity, boss windows, shop/victory restoration, gun and supply persistence, corruption, denied storage and legacy migration. Destruction QA checks all four raster stages through restoration and cache eviction, one-time armor migration, cache reuse between stage transitions and reward deduplication. Ground combat QA checks seeded supply and turret sites, aiming warnings, sparse hostile fire, one-time direct/collateral rewards, both weapons with rapid fire, invulnerability, pickup collection and exact bonus/turret autosave restoration. Browser QA covers the wave script, keyboard novas, power/drone/reserve HUD, captor rescue, lancer telegraphs, respawn, the challenging stage and the gun shop, automatic mid-flight saves, pause/menu/reload persistence, practice isolation, shop purchases, campaign continuation, WASD/Space/Q controls, fire energy, recharge lockout, world previews, scenery destruction, victory and real touch input.

Timing QA drives real keyboard events at simulated 30/60/120 Hz, checking movement parity, visible interpolation, pause, slow-frame recovery and adaptive resolution. Mouse QA verifies that moving, clicking and dragging never steer or fire a ship, that keyboard controls retain control, and that interface buttons remain clickable. Fleet QA checks all 100 family hulls, source proportions, fixed hull geometry, reduced motion and absence of retired banking downloads. Map tests check seed reproducibility, material variety and adjacent corner continuity. World checks cover all ten biomes at three viewport widths, exactly two planes, ground alignment, persistent destruction and bounded caches, and verify no landscape images are requested. The performance harness records Chrome frame intervals and CPU profiles during a repeatable single-player battle across multiple terrain chunks; it reports measurements without assuming other computers have the same frame rate.

Stutter QA checks that recolored atlases are CPU-resident while per-frame effects stay on the GPU, that a hitstop never moves the rendered terrain backward or jumps ahead on resume, and that the next sector launches without building terrain or scenery in its first frames.

Impact QA checks damage blur through real shield/hull hits, invulnerability, pause/resume, quality settings, reduced motion and end-screen cleanup.

Memory QA cycles every fleet repeatedly, checks shared damage/animation sources, verifies pixel-identical regeneration after cache eviction, restores old destruction records, and stresses repeated boss explosions. Memory estimates count retained RGBA surfaces, excluding browser-managed image/file caches and GPU overhead.
