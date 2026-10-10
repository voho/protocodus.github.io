# Ashline

An original 2D real-time strategy game for the browser. Lead an expedition into the ashlands, harvest minerals, build and defend a base, and defeat the opposing command center.

Choose **Organics** or **AI Unity** independently for your force and its rival. Organics combines human infantry and alien launcher teams with rounded, clunky industrial machinery: bulbous cast turrets, old truck cabins, cylindrical tanks and arched factory roofs. AI Unity fields autonomous combat robots, mobile walkers, skimmers, and intricate assembly facilities. Each race has its own complete nine-unit roster and nine functional buildings; ownership colors remain ivory/cobalt for your force and crimson for the opponent. Their economies and technology paths are comparable, with differences in durability, firepower, mobility, and infrastructure. Older operations load as Organics. See [the recorded AI-versus-AI balance trials](docs/BALANCE.md) for matchup results and reproduction commands.

**Nexus construction vehicles** (Organics) and **Mainframe constructors** (AI Unity) cost 1,800 credits and train at a foundry. Move one to an explored area, select **Deploy nexus**, and choose a clear 3 × 3 footprint within four tiles. Deployment consumes the vehicle with no extra charge, transferring its damage to a new nexus that takes 40 base seconds to complete. Once complete, it grants population capacity and a new construction area for refineries, defenses, and production. AI commanders scout deposits, transport constructors, and establish new mining bases. Losing every nexus and construction vehicle ends the operation.

Control groups are exclusive: Shift/Ctrl + 1–5 assigns the selected entities to that group, replacing its old members and removing the selected units from prior groups. Press 1–5 to recall. A numbered badge beside each assigned friendly unit shows its group; assignments persist in saves.

Both races construct **walls**. Choose the wall card, then drag across the ground to preview a continuous line and its credit cost; release to build. Diagonal drags make connected stair steps, up to 48 segments per order. Placement stops at the first obstruction or unaffordable segment and reports what was actually built. Walls block paths, extend from an existing base or adjacent wall segments, and can be attacked, repaired, or sold. Leave a gate for haulers and deployment bays. Armed attackers can break an enemy wall that obstructs pursuit; siege fire can reach targets beyond it. Escape or the visible Cancel button exits the wall tool.

Build a **Signal laboratory** to research three two-stage branches. Pulse accelerators → Composite field armor improve infantry damage and health; Stabilized armaments → Adaptive drivetrains improve vehicle damage and speed; Efficient power routing → Advanced ballistics reduce electricity demand and unlock advanced weapons. Research applies to deployed and future units, persists in saves, costs credits, and occupies one laboratory per project. Multiple laboratories can work on different projects at once.

Select a structure and choose **Upgrade** to install local improvements: Accelerated operations makes production, research, and refinery work 25% faster; Efficient converters cuts that building’s power consumption by 25%; a foundry’s Advanced assembly bay unlocks **Pike strikers** once Advanced ballistics is researched. These fast six-wheel vehicles carry twin autocannons that counter infantry. Foundries also build **Field engineers**, unarmed tracked support vehicles that automatically repair nearby vehicles and buildings within four tiles, consuming credits and requiring power.

Surplus generation gives construction, training, research, upgrades, and mineral processing a modest speed boost with diminishing returns: `1 + 0.25 × surplus / (demand + 100 + surplus)`, approaching +25%. Repairs, weapons, and unloading retain their normal full-power rates.

**Grid capacitors** store 1,200 power-seconds each, charging from surplus generation at up to 30 per second. During a shortage, reserve power keeps defenses and industry online until storage runs out. Brownouts then disable defenses and scale training, research, upgrades, unloading, processing, and repairs with available power; emergency construction retains a 20% minimum so reactors can recover the grid. The HUD shows current supply/demand, operating percentage, remaining reserve time, and storage. Building lights dim and show restrained amber outage indicators. The AI scouts, chooses counters from observed forces, develops technology, expands toward seen deposits, rebuilds power, escorts armor with engineers, and regroups damaged or outmatched formations.

New skirmishes default to the **192 × 144 Frontier** battlefield (27,648 tiles), with **144 × 112 Standard** and **224 × 168 Vast** sectors available in the briefing. Choose **Volcanic rift** for lava shores and broken ridges, **Basalt basin** for broad open basalt plains and scattered mesas, or **Shattered highlands** for defended passes and valuable flanking expansions. Each profile changes the actual terrain and resource layout. Layered, domain-warped value noise shapes the relief: gapped ridge walls and mesas of impassable rock, sunken basalt basins, a broken plateau ring around each base whose gates the three guaranteed routes cut, open bowls around every mineral field, and scattered boulder outcrops. The relief is point-symmetric about the map centre, so both bases face the same ground, and every pocket of 30 or more tiles is breached back to the main sector. Rock renders as a raised plate with a lit rim and a shaded foot; basalt as a darker, cooler plate with joint seams; haul ruts only wear into open ground. Seeded crater bowls sit beside approaches and flanking positions: units inside take 15% less direct-fire damage, while rockets and siege explosions ignore the cover. Craters remain passable but cannot support construction; they preserve starting clearings, mineral bowls, and all guaranteed routes. Construct production buildings and defenses, recruit specialized units, and face an AI that develops its economy and adapts its attacks. Cadet and Commander opposition build and train at 55% and 75% of full speed, raid later with smaller groups, and Cadet never fields siege crawlers.

Lava pools are recessed into rugged basalt basins, with shaded inner banks and a subtle lit near rim above broad red/orange molten surfaces, swirled amber folds, sparse dark crust, and brief bubbles. The molten texture slowly flows beneath the fixed shoreline and its inner shadows, pausing with the simulation. Pools block movement and construction; units and the AI route around them. Seeded pools preserve starting clearings, mineral access, and the map’s guaranteed routes. Fog hides undiscovered pools and stops live animation outside current vision. Pools persist through save/load, and older saves remain compatible.

Individual dead trees scatter randomly across open ground: bare hardwoods, charred conifers, twisted trees, bleached snags, hollow stumps, and fallen trunks. Their roots block movement and construction while base clearings and guaranteed routes stay open. Varied silhouettes and sizes enrich the ashlands, with soft shadows and branches that fade when they would obscure visible units. Mineral fields form loose, irregular patches with small outlying deposits. Safe mint starter fields preserve the same budget across profiles; blue minerals mark expansion reserves. Exposed red deposits contain twice the credits and yield twice as quickly while mining, with the same 200-credit hauler capacity. Terrain, mineral types, and reserves are mirrored exactly about the map centre, and all deposits connect to the starting bases through open ground. Placement is seeded and remains consistent after loading a save. Start a new operation for the scattered layout; existing saves retain their terrain and deposits.

Barracks train **Rocket infantry** for mobile anti-armor support. Their slow-firing shoulder launchers hit vehicles hard (1.8× against heavy armor) and deal a small amount of splash damage; rifle squads and recon rovers counter them, and tanks only deal half damage to infantry. **Rocket towers** provide longer-range missile defense with a wider blast radius, require a barracks and reactor, and stop firing without sufficient power. Rockets travel before exploding. The AI recruits rocket infantry and builds rocket towers as part of its defenses.

Units earn three ranks through combat: rank 1 at **5 kills**, rank 2 at **10 kills**, and rank 3 at **15 kills**. Each rank adds 20% of base damage and maximum HP, for totals of **+20%, +40%, and +60%**, but only 5% of base movement speed (+5%, +10%, +15%), so veterans keep pace with their formation. Destroyed walls count toward the team's kill total but never toward a unit's rank. Promotion adds the gained maximum HP to current health, preserving damage already taken. Three chevrons below each visible unit show its earned ranks; the selected-unit panel shows kills toward the next threshold and the current bonus. A surviving unit receives credit for its own kills, including splash and rocket impacts. Ranks and kills persist in saves; existing units without a kill count start unranked.

Every completed refinery includes one free hauler. Haulers automatically collect and deliver minerals, and resume harvesting after moving or stopping. Armed units guard by default: they fire at visible enemies in weapon range while holding their position. Moving or stopping returns them to guard when the order finishes. New units never deploy into a sealed pocket between buildings; a producer whose exits are walled in waits until ground opens.

Damage to your forces raises a throttled **under attack** warning with an orange ping on the tactical map, destroyed units are reported, losing the last hauler prompts a replacement, and low power warns once and marks the power readout while defenses stay offline. Shells and tracers fired from concealed positions are drawn and heard where they land, never where they came from.

Units use [Craig Reynolds’ Boids rules](https://www.red3d.com/cwr/boids/) for local herd movement: **separation** avoids crowding nearby bodies, **alignment** follows nearby allies’ average heading, and **cohesion** draws traveling allies together. Group orders guide the flock toward compact destinations around a shared rally point. Only nearby allies traveling toward compatible destinations align and cohere; opposing traffic keeps its own orders. Comfortable spacing has a deadband so an orderly flock does not continually squeeze together and spread apart. Attraction fades near the destination while collision clearance stays active. Each simulation tick reads a shared snapshot of neighbors from a spatial grid, preserving deterministic save continuation.

Units anticipate crossing traffic, slow behind a leader, and route around nearby bodies. A blocked unit can back out of a crowd; allies still assembling a preserved formation can step aside and return after it passes. Idle military guards remain planted. Friendly spacing only softens between a specific blocked pair when static geometry prevents a bypass in a tight lane. Rocks, lava, buildings, and enemy collision boundaries remain solid. This also keeps haulers moving through shared refinery approaches.

Clear routes follow direct lines at any angle. Obstacle routes discard unnecessary grid waypoints. Units steer and travel at the same time, moving along their current body heading without sliding sideways. They slow for sharp turns and brake when a corner requires more clearance. Stationary units stop their walking and track animations. Every movement checks the swept path against solid ground. The same routing serves manual orders, rallies, harvesting, scouting, and combat pursuit.

Group move and attack-move orders gather scattered units into one compact army around the click. Units keep roughly their left/right and front/back ordering while closing the original gaps. They travel and turn at their own speeds, using local detours, speed matching and yielding to clear traffic. Distinct parking positions leave room for late arrivals to pass between settled allies. Obstructed, clipped or unreachable rally points use nearby available ground on each unit’s side of the obstacle. Repeating the same order for the same selection keeps its reserved positions stable; a different selection can regroup. Selected units show their own destination brackets and subtle route segments through visible ground.

To preserve a particular formation, hold the right mouse button at its destination and drag around that point. A live preview rotates the selected layout through a full 360 degrees; release to move into that layout and face the chosen direction. The layout is captured when the gesture begins, so moving units cannot change the preview underneath it. Preserved formations share travel and turning limits while avoiding obstacles and finish assembling before becoming idle. A quick right-click continues to gather a compact flock, with each unit becoming idle as it arrives.

Military units default to the **Guard** idle stance: they stay on their exact spot and fire at the closest visible enemy within firing range. Choose **Defend** in the selection panel to let an idle unit retaliate against an enemy that fires on it. It may chase that visible attacker, but stays within one firing-range radius of its original position and returns there when retaliation ends. Move, attack, attack-move, and explore orders take priority over Defend; its saved preference resumes only when the unit is idle, from its new position. Selected military units show their firing range as a subtle translucent circle. Stances and ongoing retaliation survive saving and loading.

Select units and toggle **Explore** (X) to automatically scout reachable unexplored areas. Armed explorers stop to fire at nearby visible enemies and resume exploring afterward. Haulers can explore too; they resume harvesting when exploration ends. Toggle Explore again, stop, or issue a manual move, attack, or harvest order to end auto-explore. When no reachable unexplored areas remain, armed units resume their chosen idle stance.

Every barracks, vehicle foundry, and refinery has its own rally point. Select it and right click a destination, or choose **Rally** (R) and click/tap. New units reserve separate positions around that rally point; combat units attack move there, while haulers relocate and resume automatic harvesting. Each building trains one unit at a time, independently of the others. Recruiting with a compatible producer selected adds to that producer’s queue; otherwise recruitment chooses the available producer with the least remaining work. Card badges show total queued items, with a progress bar for each active producer, and the production list identifies each working building.

Buildings show their actual activity. Production bays contain the current queued unit as it assembles or trains; empty queues leave a dim, empty bay with its machinery stopped. Refineries process delivered minerals with a filling hopper, moving conveyor, and exhaust. Haulers visibly carry empty, partial, or full loads and drain their cargo during unloading. Command scanning, reactor fans, and sentry scanning/recoil remain distinct. Animations pause with the simulation and respect fog and power.

Select a building to **Repair** or **Sell** it. At full power, repair restores 2% of maximum health per second, spends credits only for actual healing, waits when funds run out, and stops at full health; click again to stop early. The panel shows the actual power-adjusted rate and cost. Restoring an entire health bar costs half the building price. Construction must finish before repair starts. Selling immediately returns half the building’s and installed upgrades’ value scaled by remaining health, plus all paid unit queues, active research, and unfinished upgrades; the button shows the exact refund. Destruction loses those investments. A refinery’s deployed included hauler keeps its cargo and resumes work, with its value excluded from the building refund. The command nexus can be repaired but cannot be sold.

The pause menu saves one operation to this browser’s local storage and loads it again, including the exact simulation, fog knowledge, production queues, rally points, active repairs, camera, economy, and AI. The briefing offers **Load saved operation** on the next visit. Loading pauses the restored operation until you resume. Existing 72 × 56 and 144 × 112 saves remain playable with their stored terrain, mineral positions, and depletion unchanged; older deposits retain their mint material. Start a new skirmish to choose a larger battlefield and terrain profile. Saving again replaces that slot; clearing browser site data removes it.

Original synthesized sound effects cover orders, production, weapons, explosions, and deliveries. Sound begins after a user gesture; effects and music have independent toggles in the pause menu. The locally hosted synthwave loop **Space Adventure** by **MintoDog** is CC0; its creator’s license and source are recorded in [audio credits](assets/audio/CREDITS.md).

Each completed nexus adds **200 unit slots**, up to **2,000 units per side**, including haulers, engineers, and construction vehicles. Losing a nexus lowers capacity without removing existing units; recruitment waits until there is room again. Paid production queues reserve population slots so parallel factories cannot exceed the limit. Buildings and walls do not consume unit capacity.

## Run locally

From the repository root:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/fun/ashline/>. No build step or installation is required.

Previews that permit local JavaScript modules can also open `index.html` directly: when workers are blocked, map generation falls back to the main thread after painting the loading screen. Use the local server in browsers that block modules from `file:` URLs.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag a box | Select a unit or building / select multiple units |
| Double click a unit | Select all friendly units of that type currently on screen |
| Shift + select | Add to the selection |
| Right click | Gather units at a point, attack an enemy, or send a harvester to minerals |
| Hold right button and drag | Preview and rotate a preserved formation; release to move and face that direction |
| Q, then click | Attack move |
| R, then click / Rally button | Set selected production buildings’ rally point |
| Repair / Sell buttons | Repair or sell the selected building |
| Upgrade button / Research tab | Retrofit a selected structure / research army and grid technology |
| Wall card, then drag | Preview and build a continuous wall line |
| X / Explore button | Toggle auto-explore for selected units |
| H | Stop selected units and disable auto-explore |
| E | Select all combat units |
| Space | Center the camera on your base |
| WASD / arrow keys / middle-button drag | Pan the camera |
| Mouse at a screen edge or corner | Scroll in that direction |
| Mouse wheel / pinch / + / − | Five zoom levels, capped at native 1:1 texture resolution |
| Shift (or Ctrl) + 1–5 / 1–5 | Assign / select a control group |
| P | Pause or resume |
| Speed slider below the minimap | Set simulation speed to 100%, 125%, 150%, 175%, or 200% |
| B / Command button | Open or close the production console |
| Escape / × button | Cancel the current action / clear the selection |
| Sidebar | Construct, recruit, research, and monitor power |

Selections containing any military unit automatically exclude haulers, including drag selection, Shift selection, and control groups. Select haulers on their own to command them together.

On touchscreens, tap to select, then tap a destination or target. Drag empty ground to pan; pinch to zoom. The production console starts collapsed and closes after choosing a structure so its placement stays visible.

## Testing

Run every check from this directory with one command:

```sh
node tests/run-checks.mjs            # simulation checks and node:test suites
node tests/run-checks.mjs --browser  # also every Playwright browser check
```

The runner discovers the scripts in `tests/`: plain checks run as `node tests/<name>.mjs`, `*.test.mjs` suites run with `node --test`, and scripts that drive Playwright are browser checks. Node checks run in parallel lanes, one per CPU by default (`--jobs N`); browser checks run afterwards, up to three at a time depending on the CPU count (`--browser-jobs N`), and `--browser-only` skips the node checks. With `--browser` it serves the repository root on a free local port and sets `ASHLINE_URL`, so no separate server is needed; an `ASHLINE_URL` you set yourself is used instead. It uses `ASHLINE_PLAYWRIGHT` when set, otherwise the `playwright` package, `NODE_PATH` or the global npm root, and runs Google Chrome when it is installed, otherwise Playwright's Chromium (`ASHLINE_BROWSER` overrides the channel).

Each check writes a log, and browser checks write screenshots to their own subfolder of `screenshots/` beside the logs (a new folder in the system temporary directory unless `--logs DIR` is given). Failures print their output, or the failing node:test blocks, as they finish. A closing table lists every check with its status, duration, subtest count and log (`summary.json` in the log folder holds the same results for scripts), and the command exits non-zero if any check fails or times out. Other words select checks by name: `node tests/run-checks.mjs --browser faction map` runs only the checks whose names contain them. `--list` prints what was discovered, `--timeout S` stops a check after S seconds (default 900), and `--retries N` re-runs failures one at a time and reports checks that passed only on a retry. The measurement tools `performance-benchmark` and `race-balance` run only with `--tools`, last, one at a time and without a time limit; see [performance](docs/PERFORMANCE.md) and [balance](docs/BALANCE.md) for their options.

### Simulation checks

Each check also runs on its own from this directory:

```sh
node tests/sim-check.mjs
node --test tests/terrain.test.mjs tests/integration.test.mjs tests/walls-craters.test.mjs
node tests/orders-check.mjs
node tests/explore-check.mjs
node tests/production-check.mjs
node tests/processing-check.mjs
node tests/rocket-check.mjs
node tests/rank-check.mjs
node tests/abilities-check.mjs
node tests/mission-check.mjs
node tests/collision-check.mjs
node tests/formation-check.mjs
node tests/path-smoothing-check.mjs
node tests/building-actions-check.mjs
node tests/gameplay-expansion-check.mjs
node tests/races-check.mjs
node tests/capacity-check.mjs
node tests/nexus-check.mjs
node tests/ai-nexus-check.mjs
node --test tests/control-groups.test.mjs
node --test tests/loading.test.mjs
node --test tests/performance.test.mjs tests/frame-scheduler.test.mjs tests/ai-defense.test.mjs tests/events-stats.test.mjs
node --test tests/module-boundaries.test.mjs
node --test tests/camera.test.mjs tests/movement.test.mjs tests/flocking.test.mjs tests/traffic-stability.test.mjs tests/compact-flock.test.mjs tests/formation-drag.test.mjs tests/unit-stances.test.mjs
node tests/lava-check.mjs
node tests/distribution-check.mjs
node tests/relief-check.mjs
node tests/save-check.mjs
```

The checks exercise seeded maps, route connectivity, fog, finite harvesting and recovery, construction, production, power, complete skirmishes, included refinery haulers, automatic harvesting orders, default guarding, auto-exploration with cancellation and route recovery, lava generation, safe detours, relief connectivity and pocket-safe deployment, typed events and match statistics, commander profiles, unit abilities, scripted missions, production cancellation, and save compatibility. The module boundary suite keeps the module split sound: a game plays identically whichever simulation module is imported first, map generation never imports the simulation or draws on its shared random stream, and explored, power, research, upgrade, deployment, hauler-loss, victory and defeat events keep their kinds and subjects.

### Browser checks

To run a browser check on its own, start the local server (see [Run locally](#run-locally)) and point the check at a Playwright installation. Set `ASHLINE_BROWSER=chromium` when Google Chrome is not installed:

```sh
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/startup-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/camera-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/resource-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/memory-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/faction-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/shadows-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/cargo-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/operation-visual-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/rocket-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/rank-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/traffic-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/formation-gesture-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/stance-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/lava-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/map-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/trees-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/features-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/building-animation-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/building-actions-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/expansion-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/races-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/population-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/production-ui-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/expansion-visual-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/races-visual-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/fog-save-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/audio-check.mjs
```

Set `ASHLINE_URL` to the served game, such as `http://127.0.0.1:8000/fun/ashline/`, when a check's default port differs from your server. Each check writes screenshots to its own `/tmp/ashline-*-qa` folder unless `ASHLINE_SCREENSHOTS` names another. Browser checks cover deployment, selection, orders, production, camera controls, pause/restart, and mobile touch input.

The startup check separately verifies that setup creates no game state, requests no battlefield art, and starts no game animation frames. It checks desktop/tablet/phone overflow, visible progress through terrain preparation, saved-game loading, automatic fallback for blocked or unavailable workers, and generation error/retry. The loading unit checks verify that file previews skip workers, yield before generation, and preserve deterministic maps. Gameplay fixtures wait for `ashline.booted` to interact with setup and for `!ashline.loading && ashline.state && !ashline.paused` after deployment. Art-only fixtures explicitly call `startAssets()` before inspecting sprites.

## Implementation

See [performance measurements and reproduction commands](docs/PERFORMANCE.md) for simulation, rendering, and canvas-memory comparisons. Fixed 50 ms simulation steps yield between expensive ticks to keep input and rendering responsive; under sustained overload, effective game speed can fall below the requested slider setting. Returning to setup, replacing a world, or failing deployment releases the old terrain and fog surfaces immediately.

AI perimeter defense assigns nearby troops according to visible threats, armor effectiveness, and powered defenses in actual firing range. It preserves distant raids, stops chasing intruders that leave the perimeter, and withdraws outmatched defenders locally. Critically damaged military units seek a nearby nexus for repairs; threatened haulers can shelter at nearby refineries. These decisions use current vision and preserve deterministic save continuation.

The setup menu is a static DOM screen. Changing seed, faction, size, or terrain updates the form without creating a world. Deploy and Load open a progress screen before art preparation; `world-worker.js` normally generates new simulation state away from the UI thread, with a main-thread fallback when workers are unavailable or blocked. Both paths use the same deterministic generator. The renderer bakes terrain in chunks that yield for painting through `loading.js`. Progress follows completed assets and terrain stages. The game loop starts only after preparation and stops in the pause and setup menus. Oxanium supplies the space-inspired heading face; its self-hosted font and license are in [assets/fonts/CREDITS.md](assets/fonts/CREDITS.md).

The game runs directly from static files. `sim.js` owns the deterministic simulation: entities, orders, movement, combat, economy, power, fog and victory. `terrain.js` generates the seeded, point-symmetric maps from local hash-seeded streams, so map generation never shifts the shared simulation random stream; `sim.js` re-exports its map sizes, profiles and layout. `ai.js` plays the opposing commander through the same public commands as the player, using only current vision and its own fog memory, and defines the commander doctrines that `createGame` accepts through its `aiProfiles` option. `render.js` draws the battlefield with Canvas 2D, and `main.js` connects pointer/keyboard/touch input to the compact DOM command console. `save.js` validates and restores the versioned local save, and `audio.js` generates sound effects with native Web Audio and plays the local soundtrack. No runtime packages or network services are required.

Simulation events carry a stable `kind` beside their message text, and events about a team's own units or structures include their position, so the interface and audio can react without parsing copy or revealing anything under fog. Each team also keeps match statistics: units trained and lost, structures built and lost, unit and structure kills, mined and spent credits, damage dealt and taken, peak armed-unit count and completed research. Starting forces are not counted as trained, refinery haulers delivered later are; cancelled research and cancelled training return their spending, while sales count as salvage. Saves from before these records still load and continue; their statistics stay unavailable. `cancelTraining` removes any queued unit, including the one in training, for a full refund.

`abilities.js` gives each combat role one active ability, with the same mechanics under each race's name: **Dig in / Brace protocol** (rifles take 35% less damage for 10 s while holding still; any new order ends it), **Long shot / Extended lock** (rockets gain 3 tiles of range for 8 s), **Flare / Sensor probe** (a scout lights a 7-tile radius within 14 tiles for 12 s, for its own team only), **Overdrive / Overclock** (tanks move 40% faster for 6 s), **Afterburner / Sprint** (strikers move 60% faster for 4 s), **Barrage / Arc barrage** (siege crawlers fire four scattered shells at explored ground within range + 2, 0.7 s apart, each at 70% damage with splash) and **Field patch / Nano-patch** (an engineer restores 25% of the most damaged friendly vehicle or structure within 4 tiles, paid at the engineer repair rate). Cooldowns run from 30 to 45 s. Timers are absolute simulation times on the unit, flare reveals are saved team-owned fog sources, and barrage scatter draws from the shared simulation stream only while a salvo fires.

`mission.js` runs scripted operations defined as data in `campaign.js`. `createGame(seed, difficulty, {mission})` applies the operation's races, AI teams, credits and opening forces, resolves its zones against the map layout so any seed works, and runs its setup. Four times a second the engine evaluates objectives (destroy or protect tagged entities, annihilate, survive, hold or reach a zone, deploy a nexus in a zone, deliver credits, research, build, train, kills), fires triggers (dialogue, reinforcements and hostile waves, objective reveals, supplies, commander directives) and settles victory or defeat; losing the nexus, every unit, a tagged asset or the time limit can fail an operation. Operations can restrict which structures, units, research and upgrades the player may use. Mission progress is plain saved state; skirmishes carry none and keep the Charter rule: a side without a nexus or construction vehicle loses.

Units and buildings use generated military sprites with smooth contours, broad armor panels, substantial weapons and restrained mechanical detail designed for gameplay size. Unit frames are baked at 64–128 pixels into small lossless WebP atlases before shipping; building frames are prepared at 80–208 pixels during loading. These sizes serve high-density displays while keeping existing battlefield sizes. Filtered preparation and sprite drawing keep roofs, turns, zoom, portraits, and production previews smooth. Friendly units and buildings have ivory armor with cobalt panels and blue square insignia; enemies have broad crimson armor and red diamond insignia. These colors and shapes carry through production previews, cargo/idle states, and the minimap. `assets.js` slices the prepared unit atlases without resizing or recoloring friendly frames, derives enemy colors and shadows, normalizes building sprites, and supplies the textured terrain. The battlefield fills the viewport; a collapsible production console and contextual selection controls preserve space for play. Asset provenance and the complete built-in image-generation prompt set are in [assets/generated/ASSETS.md](assets/generated/ASSETS.md).

Every unit uses **eight separately generated direction views**, spaced 45° apart, for both factions. Infantry also has eight walking poses. While turning and moving, it displays the closest view to its continuous simulation heading. Each sheet shows the same unit from a fixed shallow overhead camera, including distinct front and rear surfaces. The renderer uses those views directly, preserves whole silhouettes and shared scales, and keeps shadows pointing lower-right. Attached effects follow the selected direction, and hauler cargo fills each view's hopper through a bounded cache. The camera check covers source integrity, nearest-direction selection, full turns, animation registration, transparency, and desktop/mobile previews at normal and minimum zoom.

Units and buildings cast soft silhouette shadows from a fixed upper-left light. Shadows draw on the ground before objects, grow with building construction, and respect fog of war. Prepared shadow images are cached with the sprites.

### Rebuilding unit atlases

Keep original directional art in `assets/generated/directions/`. The game downloads only `assets/prepared/units/`: 18 lossless sheets totaling 1.30 MB instead of 16.16 MB. Each cell uses the existing renderer's prepared resolution and normalization, preserving physical size, anchors, native maximum zoom, and portrait detail. The manifest stores original draw scales and hopper polygons in prepared pixel coordinates. `source-bounds.json` records extraction bounds for source-art QA and is not loaded during play.

After changing a unit master, source normalization, friendly paint, or hopper bounds, rebuild with an existing Playwright/Chrome installation and `cwebp` from libwebp. Run from `fun/ashline/`; the tool starts its own temporary local server. `ASHLINE_BROWSER` and `CWEBP` can override the browser channel and encoder executable.

```sh
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/prepare-unit-atlases.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/prepare-unit-atlases.mjs --check
```

The check regenerates into a temporary directory and compares all outputs without modifying them. Commit the updated sheets and metadata together. `tests/resource-check.mjs` verifies the download/pixel budgets, exact consumption of baked frames, unchanged maximum zoom, and successful loading with source masters blocked. Unit masters remain available for future art changes but are never fetched during game startup or play.
