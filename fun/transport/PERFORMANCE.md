# Large-world performance

Measured on the development machine in Node and headless Chrome in September and October 2026. These are regression workloads, not a promised frame rate on every device. The map-size limit remains **2048 × 2048**.

## Busy companies and frame-sliced commits

`tests/busy-company-benchmark.mjs` plays a real company on a generated recipe 13 world. Every producer that can reach its nearest buyer within 70 tiles by road, and every town with a neighbour within 45 tiles, runs a route built with the game's own connection planner, four vehicles each. It then times whole daily steps. With `--model`, a frozen copy builds and ticks the same company in the same process, alternating order, and must reach an identical SHA-1 of every field and tile.

| Company | Daily step before → after (median) | State |
| --- | ---: | --- |
| 512², 73 routes, 293 vehicles | 42–45 → 32–34 ms (1.23–1.37×) | identical |
| 1024², 185 routes, 741 vehicles | 125–133 → 93–101 ms (1.30–1.37×) | identical |

- **Town growth** surveyed every lot in reach with `localEnvironment` before checking that a road runs beside it, then tested every lot's flatness. A lot is now rejected by the road and site checks first. Lots are then ranked with a stable sort, and flatness is read only until a flat lot wins, so ties still keep the earlier lot.
- **Levelling a sloped lot** (`plotLevelPlan`) wrapped the game in a `Proxy` and rebuilt whole 48 × 48 height chunks through it for every candidate level. `previewVertexHeights` now runs the same distance transform over the plot's own window. Any source more than seven vertices away cannot set a height, so the result is exact.
- **Height fields** survive towns' journaled new homes as well as ecology: neither moves a height, water or a network. The LRU holds 4,096 1 KiB chunks (4 MiB, a whole 2048² map) instead of 96, so daily growth across a large map stops cycling it. Single-tile flatness reads its four corners from one chunk.
- **Daily upkeep** needed only the police, fire and service buildings around each vehicle and player plant. `localSupport` counts those exactly, without the full neighbourhood survey. Station buckets use numeric keys instead of building a string per bucket per query.
- **Commits.** At 8× a second's eight days ran inside one animation frame: about 260 ms on the 512² company and 800 ms at 1024², once a second. `createWorldClock` now stops a frame's commit at a day boundary once it has used `FRAME_BUDGET_MS` (16 ms) and finishes on the following frames. Whole-day slices reach the same state. Pauses, speed changes, saves and any backlog of more than two intervals still commit everything at once, so game time never falls behind.
- **Recipe 13 placement** pre-filters the towns and plots that can touch a candidate and caches industry relations per kind pair. The worst case (2 towns, 96 districts on 2048²) generates in 12.8 s, against 13.8 s for recipe 12 before. Recipe 12 itself now takes 8.6 s and stays byte-exact.

Ecology remains a fixed cost: about 15 ms a day on maps of 1024² and more. It samples 4,096 random tiles a day, and its time goes to scattered tile reads rather than arithmetic.

```sh
node --max-old-space-size=8192 fun/transport/tests/busy-company-benchmark.mjs --size=1024 --days=100 --model=/absolute/baseline/model.js
```

## October 2026 update

World state now commits about once per active second, while ordinary map rendering targets 30 frames per second. Each commit processes elapsed simulation time in chronological order. Vehicles replay recorded paths one active second behind the committed state, including bends, loading waits, train carriages and aircraft turnarounds. Camera motion, pointer gestures, vehicle following and delivery figures use the display's animation frames. Input and renderer invalidations wake a paused view immediately. Paused housekeeping uses a 250 ms timer, menus poll once a second, and a hidden tab cancels both its animation frame and timer. Autosave and notice deadlines remain active in a visible paused game.

Pause, speed changes and saves flush the pending fraction at its original rate. Hidden and loading time is excluded; delayed visible frames retain elapsed time. Save capture blocks whole world commits while retaining pending time. Motion history only records vehicles in or approaching the view, plus the followed/selected vehicle, and discards records outside the presentation window. Offscreen vehicles still participate in the complete economic simulation. A paired 10,000-vehicle/1,000-route workload with 500 tracked vehicles and 30 Hz presentation reduced CPU by **62.5% at 1×** and **22.3% at 8×**, with identical complete game state. This measures simulation and presentation work, not hardware GPU utilization.

A paired app-only check used the same current renderer, seed 1847, Detail view and DPR 1. Ordinary map submissions fell **235 → 119 over four seconds**, with script time **597 → 303 ms**. A three-second pause fell **181 → 13 callbacks** and **24.7 → 3.1 ms** of script time, with no map/minimap repaint or game-time advance. Hidden running/paused views had zero callbacks. Both versions rendered 58 camera-glide frames in 1.1 seconds; the new loop still handled paused input in the next display frame.

A settled view without ground traffic can reuse trees, shadows, buildings and foundations in one native-pixel viewport image. Sparse views keep the cheaper individual drawing path: caching requires at least 32 static submissions, increasing with the display's physical-pixel area. Ground vehicles still merge into the original scenery order so they pass behind trees and buildings correctly. Water, airborne planes and overlays remain separate. Camera, display density, resize, layers, artwork and journaled world changes invalidate the image. This adds at most one **32 MiB** surface, independently of world size and the existing **96 MiB** scenery-strip budget; larger displays use the existing renderer. The surface is released when ground traffic enters the view or the scene becomes sparse.

Fleet updates reuse trajectory records and share a route's unchanged terrain, weather and service calculations across its vehicles. Vehicle variation, upgrades, chronological arrivals and arithmetic order are retained. House artwork selection is memoized until a new climate/design/orientation becomes available, and consecutive uses of the newest prepared sprite avoid unnecessary LRU mutations. The nine house kinds each have three architectural designs and two physical rotations; loading remains limited to the active climate and requested density. Pure Build tool selection reuses its cards and canvases, updating pressed states; changed world/pricing/category values still rebuild them. Identical Towns/Industries markup retains its existing cards, listeners, focus and portraits.

Grass has finer irregular dark and light grain, soil pores and broken moss patches. Eight small seeded textures per climate stay anchored to the terrain. All three climates together use at most **864 KiB**. Authored meadow and scree textures cover all dry terrain, including previously smooth mountain faces, with climate-specific sand/snow finishes, softly blended boundaries and irregular lichen patches. Their permanent texture bank is bounded at **3 MiB**, plus **768 KiB** for moss stamps. All detail is painted into cold terrain chunks and adds no drawing to warm frames; first rendering and newly exposed chunks still cost more than the previous smooth terrain.

Terrain illumination now interpolates shared vertex light derived from neighboring slopes instead of assigning a separate light level to each triangle. A small world-aligned light map is baked into each cold chunk using the existing source-sized scratch canvas; no additional per-chunk texture or warm-frame work is retained. Paired Taiga, Tundra and Desert checks at all three zooms kept identical chunk-cache bytes and composed zero chunks in warm views. Cold scene timings were mixed and variable, so this visual change carries no whole-scene speed claim. The lighting browser check covers integral and fractional display density, chunk seams, transparent cutouts, sharp material boundaries and unchanged flat-water colours.

House garden cutouts expose the actual world terrain while preserving architecture, fences, flowers and paths. Prepared cutout canvases share an **18 MiB** cache. A garden raised above a slope copies the same world-anchored ground onto its level top, using a separate **16 MiB** surface cache; unchanged warm views reuse both. Foundation walls use irregular fieldstones from shared climate, wall-direction and density materials, bounded at **7 MiB** regardless of the number of scenery contexts.

Generation recipe **9** reserves **7×7 farm plots** around **2×2 building cores**; processors and other industrial sites remain **3×3**. Crop and pasture ground is baked into the existing terrain chunks, so warm frames add no field-texture composition. The shared field bank contains at most **15 textures × 128 × 128 × 4 bytes = 960 KiB**, independent of map size and farm count. Fences, orchard trees and small building cores retain normal scenery ordering and picking. All 49 plot tiles participate in reservations, indexed catchment, route bounds, demolition, save validation and construction undo. Recipes **1–8** keep their exact baseline bytes, and restored compact farms retain their saved extents.

The building catalog now has **43 kinds**, including three player-built parks and three shopping centres. Recipes 1–7 preserve the original 26-kind collection; drainage worlds use 37 procedural kinds including town features. The six additional parks and malls remain player-built. Parks feed the existing greenery, amenity and pollution calculations. Shopping centres contribute actual shop units and food/household outlets to the monthly market, occupancy and private rent calculations. The five original shop identities each have three stable artwork styles, with active-climate and requested-density loading; artwork variety does not add simulation entities or alter historic generation recipes.

A four-pair terrain comparison, seed 1847 at 1280 × 900/DPR 1, measured Town's 69-chunk first render at **418 → 629 ms**, with warm rendering **2.3 → 2.3 ms**. Detail's 24-chunk first render was **235 → 482 ms**, with warm rendering **1.4 → 1.5 ms**. A pan exposing one new row cost **84 → 120 ms** at Town and **72 → 150 ms** at Detail. Chunk-cache memory was unchanged and every warm sample composed zero chunks. These first-render costs are a remaining tradeoff of the richer ground materials.

The paired 512² fleet workload below uses 10,000 vehicles, 1,000 routes and 240 frames, alternating baseline/current execution order. Each resulting complete simulation state matched exactly.

| Fleet | Median frame before → after | Total CPU before → after |
| --- | ---: | ---: |
| Road | 10.46 → 4.88 ms | 3,053 → 1,521 ms |
| Rail | 11.72 → 5.83 ms | 3,384 → 1,704 ms |
| Water | 5.77 → 4.39 ms | 1,720 → 1,399 ms |

A separate historical renderer comparison covers 18 daylight views: a generated town, dense forest and staged city, at three zooms and DPR 1/2. Median CPU reductions across each scene's three zooms were **83–91% at DPR 1** and **31–67% at DPR 2**. Forest reductions were 91% and 67%, respectively. Each settled static layer used one image submission; terrain chunks and overlays still draw separately. All 2,574 sampled picks matched; the additional transparent composition changed color channels by at most 3/255. These headless rendering timings and reduced draw submissions measure work, not hardware GPU utilization or a guaranteed frame rate. The measurements below describe earlier, separate workloads.

`scenery-view-browser-check.mjs` compares viewport caching enabled/disabled with current artwork at DPR 1, 1.25 and 2, including camera movement, layers, construction/ecology, traffic, sparse and dense bridge views, the memory cap, resizing and late artwork. `sprite-cache-benchmark.mjs` reports the production cache-hit microbenchmarks without claiming a whole-frame improvement.

## Changes

- The app redraws only when the company, camera, selection, artwork, or map controls change. Pause stops water/weather/light animation and idle map repainting. Hidden tabs do not simulate. A hidden minimap and closed management panels do no recurring drawing or list rebuilding.
- Terrain height fields use bounded byte caches with numeric keys. Cached mesh canvases contain their actual projected bounds instead of allocating empty maximum-height margins. Static scenery and grid paths are reused.
- Route drawing indexes ordered segment runs by spatial cell. Only the visible sections are projected; the minimap reuses complete route paths. Distant vehicles and their lights do not query terrain heights.
- A shared network bitset costs 512 KiB at 2048², even when every tile carries a network. Construction updates it incrementally. Ecology does not trigger a full network scan.
- Construction also journals the cells each network revision touched. A running route whose stops lie too far from every changed cell for its search to reach one keeps its path, so an unrelated edit no longer searches every route again.
- Vehicle arrivals use a time-ordered event queue instead of rescanning the fleet for every arrival. Spatial buckets bound nearby settlement, industry, zone and station queries. Fleet and station lookup tables replace repeated array scans. Local routes retain breadth-first search; distant routes use shortest-path A* and can choose a different equally short route.
- Generated tile elevations share immutable exact numbers while tiles remain independently mutable ordinary objects. Artwork loads for the active climate; authored building sprites reuse identical canvases across legacy variant numbers.
- Saves preserve generated terrain as lossless baseline deltas. Repeated network changes compress into runs. Long cardinal routes use exact direction runs rather than repeated coordinate objects. Large fleets share record field names and store fractional values as exact IEEE754 bits. Legacy saves remain readable.
- Route search applies to the whole fleet, while the UI shows 50 cards per page. It does not create thousands of canvases and DOM cards at once.
- Industries and Towns show 40 cards per page. The periodic refresh rebuilds only that page and keeps its drawn portraits, and town cards share one list of active stops.
- The HUD, route cards and town labels reuse cached `Intl` number and date formatters (`formatters.js`) rather than building one in every `toLocaleString` or `toLocaleDateString` call; the text is identical. Route cards reuse each accounting start date, and a town label keeps its population text until the whole number changes.

## Representative measurements

| Workload | Before | After |
| --- | ---: | ---: |
| Paused app, 3 seconds, map redraws | 181 | 0 |
| Paused app, 3 seconds, script time | 1,360 ms | about 5 ms |
| Decoded world atlases, initial taiga world | 60.2 MiB | 33.7 MiB |
| Real 2048² generated tile heap | 519.4 MiB | 455.5 MiB |
| Forest/coast, Detail at DPR 2, warm renderer | 52–53 ms | about 6–8 ms |
| 2048², 10,000 vehicles, 1,000 short routes, 120 simulation steps | 48.35 s | 1.27 s |
| Cross-map shortest-path search | about 630 ms | about 10 ms |
| Unrelated one-tile road, 201 routes on a 1024² road grid, route replanning | about 65 ms | about 0.2 ms |
| Road/rail grid every 8 tiles, 2048² terrain save | 5.53 MiB | 0.99 MiB |
| Route panel with 10,000 routes | formerly unbounded cards | 50 cards, about 25–55 ms opening |
| Industries panel, 2048², opening / refresh | 576 cards, 93 ms / 79 ms | 40 cards, about 9 ms / 9 ms |
| HUD update with the Routes panel open over 50 running cards | about 11.7 ms | about 1.3–2.1 ms |

The fleet benchmark flattens **4,194,304 independently mutable tiles** into a synthetic connected network, connecting stops near every existing town and industry. Its short journeys deliberately create frequent arrivals. It bypasses construction costs and terrain constraints to isolate simulation scaling; it does not claim every synthetic route is a commercially valid passenger service. Long-distance route finding is measured separately. Daily updates still produce occasional spikes.

The renderer benchmark uses a synthetic connected grid of 983,040 road/rail tiles, 1,000 routes representing 2,047,000 logical segments, and 10,000 vehicles, with 41–90 intentionally visible at each zoom. It shares immutable terrain fixtures to isolate rendering rather than measuring world memory. Warm views recompose no terrain and rebuild no route paths. A pan considers fewer than 0.8% of the route segments. Cold minimap creation is roughly 220–250 ms; warm reuse is roughly 1 ms.

A separate save test mutates over four million tiles in a real generated 2048² world. Its terrain-heavy autosave is about 2.02 MiB and restores every tile exactly. A combined stress fixture with 4.19 million network flags, 1,000 routes of 4,075 points, and 10,000 vehicles with fractional positions uses **4.19 MiB** (including all route and fleet state) and round-trips tiles, route points and vehicles exactly. Encoding took 1.79 seconds and decoding took 5.78 seconds in that run. Arbitrary new tile fields and unusual precision are retained with a lossless fallback rather than silently rounded.

## Practical limits

A raw 4096² generation probe used about **1.8 GiB of JavaScript heap**, before renderer surfaces, path buffers, fleets, save reconstruction or browser overhead. It is not exposed as a playable size. Larger supported maps require a packed/lazy tile representation and a save strategy that avoids retaining both worlds while replacing one.

Normal menu generation/restoration and live save encoding now use background workers (measurements below). Page-leave checkpoints, compatibility callers and worker-unavailable fallbacks still perform synchronous validation/terrain scans. A fully modified 2048² synchronous save can take roughly 1.3–1.8 seconds; loading while keeping the previous company for failure recovery can briefly double world memory. Fully paused unchanged worlds skip periodic autosave scans. Long-network edits can still require multiple route replans, and worst-case winding routes do not compress as well as straight lines. Local-storage quota is shared by all named saves and depends on the browser.

## Reproduce

Run from the repository root with its static server serving port 8765. Set `TRANSPORT_PLAYWRIGHT` to the installed Playwright module if it is not available as `playwright`.

```sh
node --test --test-concurrency=2 fun/transport/tests/*.test.mjs
node --expose-gc --max-old-space-size=2048 fun/transport/tests/dense-world-benchmark.mjs
node --expose-gc --max-old-space-size=4096 fun/transport/tests/dense-save-benchmark.mjs --roundtrip
node fun/transport/tests/rendering-performance-browser-check.mjs
node fun/transport/tests/app-performance-browser-check.mjs
node fun/transport/tests/scenery-view-browser-check.mjs
node fun/transport/tests/world-cadence-browser-check.mjs
node fun/transport/tests/renderer-presentation-browser-check.mjs
node fun/transport/tests/raster-houses-browser-check.mjs
node fun/transport/tests/house-ground-browser-check.mjs
node fun/transport/tests/farm-fields-browser-check.mjs
node fun/transport/tests/farm-core-art-browser-check.mjs
node fun/transport/tests/terrain-lighting-browser-check.mjs
node fun/transport/tests/town-variety-art-browser-check.mjs
node fun/transport/tests/parks-farms-app-browser-check.mjs
node --test fun/transport/tests/farm-plots.test.mjs fun/transport/tests/farm-food-chains.test.mjs fun/transport/tests/parks-malls.test.mjs
node fun/transport/tests/tool-panel-browser-check.mjs
node fun/transport/tests/sprite-cache-benchmark.mjs
node fun/transport/tests/start-menu-browser-check.mjs
node fun/transport/tests/compact-play-browser-check.mjs
node fun/transport/tests/weather-effects-browser-check.mjs
node fun/transport/tests/loading-screen-browser-check.mjs
```

The browser checks use isolated storage and never edit the player's saved companies. Timing values are reported; correctness, cache bounds, conservation, exact save restoration, idle invalidation, and visible interactions are asserted.

## Busy-screen rendering

A second pass profiles what is actually on screen: dense woodland, a large city, and crowded roads and railways. Its baseline is the completed large-world work above, before the additional sprite, lighting and scene-cache changes.

Nature, buildings and transport now use shared, bounded prepared-image caches across the three zoom levels. The artwork is rendered at the required physical-pixel size; revisiting a prepared zoom does not resize every instance again. The static artwork pool is capped at 128 MiB, transport at 32 MiB, and tree shadows at 32 MiB. Larger visible groves previously exhausted the 16 MiB sprite cache and could recreate thousands of identical images every frame. In one 24-frame Detail woodland run, the old renderer created 10,632 sprites; the new renderer created none after warming.

Small camera moves reuse scenery ordering and foundation geometry. Moving vehicles are merged into that order, preserving occlusion. Exact sprite and shadow rectangles reject objects outside the screen; shadow smoothing state is set once for the batch. Cargo badges reuse prepared artwork while preserving their load indicators.

When measured, the full suite covered **54 views**: six scenes × three zooms × daylight, night and rain, at 1280 × 900 CSS pixels and DPR 2. The day/night cycle has since been removed, so it now runs daylight and rain (36 views). It includes a real 512² taiga world (seed 418), its densest sampled forest and largest town, plus staged flat landscapes. The staged city contains 21,139 buildings and 157 industries. The fleet contains 3,102 vehicles; Region considers 1,257 nearby vehicles and paints roughly 1,041 visible load badges. Detail still paints 63 visible badges. These are rendering fixtures, without construction costs or an economic simulation step in the measured interval.

Warm frame and pan values below are medians in milliseconds. The first three rows are a separate paired forest run in fresh browser contexts, with 24 warm frames and 24 pan steps. Remaining rows come from the complete 54-view sequence, with 12 frames per phase. That sequence retains multiple scene fixtures and exercises a larger graphics working set. Pixel hashes use a separate readback canvas so verification does not switch the game's primary canvas toward frequent-readback rendering.

| View | Warm before → after | Panning before → after |
| --- | ---: | ---: |
| Dense woodland, Region | 17.3 → 11.4 ms | 25.0 → 15.0 ms |
| Dense woodland, Town | 6.5 → 4.6 ms | 8.7 → 5.6 ms |
| Dense woodland, Detail | 42.1 → 2.1 ms | 41.7 → 2.4 ms |
| Generated dense forest, Town, daylight | 90.6 → 5.4 ms | 67.6 → 7.7 ms |
| Large city, Region, night | 19.3 → 7.7 ms | 27.1 → 10.7 ms |
| Crowded fleet, Region, daylight | 12.8 → 5.5 ms | 22.0 → 11.9 ms |
| Large city + crowded fleet, Region, night | 45.5 → 14.6 ms | 58.8 → 19.6 ms |

All 54 updated warm views created **zero nature, building, vehicle or shadow images**, rebuilt no static scenes, and recomposed no terrain chunks. Panning can populate newly exposed terrain and rebuild the scenery border periodically. All three zooms retain the same objects and artwork. The full sequence's dense woodland Region daylight result was 12.9 ms warm / 17.1 ms panning, compared with 20.5 / 31.6 ms before; the separate fresh-context row above is reported independently.

Render-call duration is not the displayed frame interval. In the paired Detail woodland run, the median animation-frame interval fell from 171.7 to 16.7 ms. The combined city/fleet night scene fell from 48.9 to 22.9 ms; its remaining draw/compositing work still exceeds a 60 Hz frame budget. Cold views, system load and retained graphics surfaces also affect results. These measurements do not promise 60 fps or remove simulation/save costs.

A separate **100-case** browser regression compares a reused renderer with a newly created one after small, long and reverse pans, visibility toggles, terrain/building revisions, zoom changes and late artwork loading. Every visible RGBA pixel and sampled inspection target matches. Before/after daytime Town screenshots of forests and buildings also match exactly. Prepared vehicle/badge edges have small rasterization differences; all directions, load states and footprints receive independent artwork checks.

```sh
# Full sequence; warm caches must not rerasterize visible objects.
TRANSPORT_EXPECT_STABLE_SPRITES=1 node fun/transport/tests/busy-scenes-browser-check.mjs

# Independent forest run, with a fresh browser context for each selected scene.
TRANSPORT_FRESH_SCENES=1 TRANSPORT_SCENES=forest TRANSPORT_CONDITIONS=day TRANSPORT_FRAMES=24 \
  TRANSPORT_EXPECT_STABLE_SPRITES=1 node fun/transport/tests/busy-scenes-browser-check.mjs

# Cached/fresh frame and inspection equivalence, including invalidations.
node fun/transport/tests/scene-cache-browser-check.mjs
```

`TRANSPORT_URL` selects an immutable comparison server, `TRANSPORT_OUTPUT` selects the results/screenshot directory, and `TRANSPORT_PROFILE=1` records Chrome CPU profiles for Region daylight views. Timings are reported rather than asserted against device-specific thresholds.

## Background world and save jobs

New-world generation, restore/migration, validation and save encoding run in module workers. The main thread receives transferable terrain/route buffers and materializes ordinary game objects in yielding slices. Existing save formats and exact procedural baselines are preserved. The menu loading view stays responsive and supports cancellation before activation. Autosaves coalesce repeated requests and reject results belonging to cancelled or replaced companies; named save writes retain their single atomic local-storage commit.

The worker benchmark uses a real generated taiga map (seed 1847), verifies byte-identical generated and edited saves against the synchronous model, restores an edited building, and cancels an in-flight creation. A 16 ms UI heartbeat records the longest main-thread gap. These figures cover the worker/capture/hydration operation, not subsequent artwork loading or first terrain rendering.

| Map and operation | Synchronous maximum UI gap | Background maximum UI gap |
| --- | ---: | ---: |
| 1024² generation | 361 ms | 26 ms |
| 1024² restore | 483 ms | 28 ms |
| 1024² save validation/encoding | 226 ms | 23 ms capture / 17 ms encoding |
| 2048² generation | 1,137 ms | 47 ms |
| 2048² restore | 1,746 ms | 34 ms |
| 2048² save validation/encoding | 897 ms | 24 ms capture / 22 ms encoding |

This improves responsiveness, not total throughput. Including the benchmark's final 25 ms heartbeat window, 2048² generation took 1.16 seconds synchronously and 2.44 seconds with transfer/hydration; restoration took 1.77 and 2.87 seconds. Consistent capture held simulation for approximately 0.72 seconds on that map while allowing the UI to respond; play resumed during approximately 0.97 seconds of worker encoding. Snapshot capture and materialization still allocate memory, and a very large fleet or heavily extended tile state can increase their cost. Route planning remains synchronous. Page-leave checkpoints and unsupported-worker fallbacks also retain synchronous behavior.

The current one-second cadence blocks whole world commits during snapshot capture and retains the elapsed interval for the next commit. Buffered vehicle motion can continue until it reaches the committed state; a longer capture can temporarily exhaust that buffer. Earlier fractional-update measurements held vehicles for about 85 ms at 1024² and 640 ms at 2048² at 8×, compared with roughly 0.2 s at 512², 0.7 s at 1024² and 2.9 s at 2048² before capture optimization. Tiles that `delete` has put into dictionary mode (terrain object release, bulldozing) used to make every later tile take generic per-key loads; plain tiles now only check their key names. After about 30 played days, capture takes 31 ms instead of 118 ms at 512² and 123 ms instead of 462 ms at 1024², and freshly generated worlds are unchanged (28 and 107 ms). Construction autosaves wait three seconds after the last stroke.

Browser regression checks cover startup, cancellation by button/Escape, save-slot round trips, quotas, delayed stale worker responses, overlapping saves, continued simulation during encoding and the final page-leave checkpoint. The new UI scenarios pass on both 512² and 2048² maps. All 431 model tests pass.

```sh
node fun/transport/tests/background-jobs-browser-check.mjs
TRANSPORT_WORLD_SIZE=square2048 node fun/transport/tests/background-jobs-browser-check.mjs
node fun/transport/tests/background-ui-browser-check.mjs
TRANSPORT_WORLD_SIZE=square2048 node fun/transport/tests/background-ui-browser-check.mjs
```

## Startup module loading

Static imports reach 13 levels deep from `start-menu.js` and 14 from `app.js`. The browser discovers each level only after parsing the one before it, so every level costs a round trip. `index.html` now preloads the 39 menu modules (382 KiB). The menu preloads the other 45 game modules (635 KiB) once it is idle, so they are usually in place before Create.

Paired runs against an immutable copy of the previous build used Chrome's network throttling at 20 Mbps, a no-store local server and a disabled cache. Each run created the default taiga world with seed 1847 after 1.5 seconds on the menu. Values are medians of four runs:

| Workload | Before | After |
| --- | ---: | ---: |
| 40 ms latency, page to menu | 695 ms | 564 ms |
| 40 ms latency, Create to playable | 5.68 s | 5.08 s |
| 100 ms latency, page to menu | 1.46 s | 1.23 s |
| 100 ms latency, Create to playable | 6.59 s | 5.55 s |

Clicking Create on the menu's first frame still gains 0.2–0.3 s. World generation then starts later, because the preload shares bandwidth with the worker's own imports. Preloading both graphs from `index.html` made the menu slower than no preloading at all (934 ms at 40 ms latency, 2.02 s at 100 ms), so the second phase waits for the menu.

```sh
node --test fun/transport/tests/module-preload.test.mjs
node fun/transport/tests/start-menu-browser-check.mjs
node fun/transport/tests/loading-screen-browser-check.mjs
```

## Scenery batches after native sprite preparation

A further pass batches static sprites on narrow depth diagonals and caches the tree-shadow ground layer. Vehicle ordering remains exact: a vehicle inside a strip's ordering range causes that strip to draw its original objects. Original sprite masks still drive inspection. Bridges, stations and tunnel mouths remain independent. The extra batch/shadow pool is capped at **96 MiB**, and oversized views fall back to direct drawing.

Preparation has a roughly **3 ms** per-frame budget; a shadow layer becomes visible only when complete. Continuous camera movement suspends preparation until the camera has settled for 90 ms. Original sprites remain visible throughout. This avoids spending time rebuilding caches that another pan would immediately discard. The first prototype improved median panning but doubled dense-forest pan P90 to about 48 ms; staged, camera-aware preparation removes that rebuild spike. Continuous-pan regression checks record zero raster-preparation time.

This comparison uses an immutable copy of the completed native-sprite work, fresh browser contexts per scene, 1280 × 900 CSS pixels, DPR 2, 24 warm frames and 24 pan steps. The harness waits for pending preparation before measuring warm frames. Warm and pan values are medians in milliseconds:

| View | Warm before → after | Panning before → after |
| --- | ---: | ---: |
| Dense woodland, Region, daylight | 10.8 → 2.7 ms | 14.4 → 14.7 ms |
| Dense woodland, Town, daylight | 4.3 → 1.9 ms | 5.3 → 5.1 ms |
| Dense woodland, Detail, daylight | 2.1 → 1.5 ms | 2.5 → 1.6 ms |
| City + crowded fleet, Region, daylight | 7.9 → 7.0 ms | 14.1 → 14.1 ms |
| City + crowded fleet, Region, night | 12.9 → 12.4 ms | 18.4 → 18.7 ms |

The gain is strongest in stationary woodland views; crowded fleets still require individual moving-vehicle, cargo and light draws. Continuous Region panning remains approximately at the preceding implementation's cost: forest daylight P90 was 22.7 → 24.4 ms. Batch warming cannot remove terrain's first-render cost. These results do not imply a general 60 fps guarantee.

Paired batched/direct image checks cover moving vehicles, panning beyond the cached border, terrain edits, visibility changes, all three zooms, fractional display density and Retina. Transitional checks also compare partially prepared frames and verify queues finish after the camera settles. Picking is identical; small channel differences from transparent compositing are bounded separately from geometry. Warm rendering creates no new nature, building, vehicle or shadow sprites. The separate 100-case cached/fresh-view regression now waits for staged preparation and allows at most four channel levels of transparency roundoff with a mean difference ≤0.02/255; inspection targets still match exactly.

```sh
node fun/transport/tests/scenery-batches-browser-check.mjs
TRANSPORT_FRESH_SCENES=1 TRANSPORT_SCENES=forest,mixed TRANSPORT_CONDITIONS=day \
  TRANSPORT_FRAMES=24 TRANSPORT_EXPECT_STABLE_SPRITES=1 \
  node fun/transport/tests/busy-scenes-browser-check.mjs
```

## Artwork densities

Startup used to fetch every density of every atlas, 16 to 256 pixels: 104 images, 11.0 MiB on the wire and 36.7 MiB decoded, while the loader waited up to four seconds. On a slow connection the map opened with only 5 of 34 atlases usable, and each of the 77 images that arrived afterwards cleared and rebuilt every map cache.

Startup now waits only for the 16–64-pixel cells, or up to 128 pixels at DPR 1.5 or more, requested density by density. Each draw fetches the cell an eager load would use, and the best loaded density stands in until it arrives. A new density publishes only if a draw was waiting for it. Changes publish in batches: 150 ms after the last arrival, at most 500 ms after the first, and at once when nothing else is loading.

New seed-1847 taiga world from the menu, 1440 × 900 CSS pixels, headless Chrome with CDP throttling. Ready time runs from **Create** until the map is shown:

| Connection | View | Ready before → after | Art publications after ready | Frames over 50 ms in the next 12 s |
| --- | --- | ---: | ---: | ---: |
| 20 Mbps, 40 ms | DPR 2 | 6.7 → 4.1 s | 0 → 5 | 0 → 4 |
| 20 Mbps, 40 ms | DPR 1 | 5.9 → 2.7 s | 2 → 4 | 2 → 4 |
| 20 Mbps, 100 ms | DPR 2 | 7.6 → 6.0 s | 0 → 4 | 0 → 4 |
| 20 Mbps, 100 ms | DPR 1 | 7.0 → 5.2 s | 3 → 5 | 3 → 5 |
| 8 Mbps, 40 ms | DPR 2 | 6.4 → 6.4 s | 78 → 6–7 | 45 → 6 |
| 8 Mbps, 40 ms | DPR 1 | 6.0 → 3.9 s | 78 → 5 | 44 → 6 |

At 8 Mbps, 22 of 34 atlases (every atlas of the climate) are usable when the map appears, against 5 before. After touring Region and Town, decoded artwork is 9.3 MiB at DPR 1 and 28.4 MiB at DPR 2, against 36.7 MiB. Each publication clears and rebuilds the map caches once. On a fast connection, the publications after ready are the sharper cells the first view asked for, arriving in the first seconds of play. At DPR 2 on 8 Mbps, the six 256-pixel cells that Town upright industries, large civic buildings, rocks and houses need arrive more than 500 ms apart, so each gets its own publication. Once artwork settles, every zoom matches the eager loader at DPR 1 and 2, apart from single-level noise that the renderer also shows between two eager runs.

```sh
node fun/transport/tests/art-loading-browser-check.mjs
node --test fun/transport/tests/art-densities.test.mjs
```

## Hover picking

In Explore, every pointer move picks the tile under the cursor by testing the sprites drawn there for an opaque pixel, front to back. Each test used to read one pixel back from a GPU-backed sprite canvas, and each synchronous readback waits for the GPU. One hover sweep across the start town at all three zooms made Chrome log 134 `willReadFrequently` warnings. The slowest first-pass pick took 8 ms. `opaqueAt` now reads a sprite whole the first time it is tested and keeps a full-resolution 1-bit mask of alpha above 24. That is exactly the old threshold, at 1/32 of the RGBA memory, and later tests read nothing back. Canvases above 2²⁰ pixels, or a failed read, keep the one-pixel test. Sprite factories never repaint a canvas they have returned, so masks are never stale.

The pointer handler also replaced `hover` with a new object on every move, which repainted a paused map on each move, even within one tile. It now keeps the object until the tile changes.

A 12-pixel grid sweep (2,948 moves per zoom) over the start town, 1280 × 860 CSS pixels at DPR 2; the after column is the range over five runs:

| View | Slowest pick before → after | Sprites read back once |
| --- | ---: | ---: |
| Region | 8.0 → 1.5–2.0 ms | 93 |
| Town | 2.1 → 1.3–1.7 ms | 30 |
| Detail | 2.0 → 2.5–2.7 ms | 20 |

A Detail industry sprite is 576 × 624 pixels at DPR 2. Its mask costs about 2 ms once, and later tests of that sprite are free. Readback warnings fell from 134 to 0. Sixty moves inside one tile of a paused map fell from 60 repaints to none. At 500 seeded points per zoom, at DPR 1 and 2, the masks pick the same tile as one-pixel readbacks.

```sh
node fun/transport/tests/hover-pick-browser-check.mjs
```

## Daily simulation step

The day boundary (industries, settlements, ecology, maintenance) is the only heavy simulation step, and at 8× it recurs eight times a second. Its hottest helpers allocated on every sample. Weather lattice samples are now cached under a numeric id, and the seeded string key is only built for a sample not yet cached. The neighborhood survey behind `localEnvironment` and ecology fills one pooled window instead of a new `Map` per call. Site extents and ecology's terrain test compare directly instead of building arrays. Random keys are unchanged, so every outcome is identical.

The benchmark ticks the same taiga world (seed 1847) one day at a time in one Node process, alternating with an immutable copy of the previous build, and skips the first 10 days. Values are daily-step medians in milliseconds over two runs:

| World | Days | Before | After |
| --- | ---: | ---: | ---: |
| 512² | 150 | 5.0–5.8 | 4.3–5.0 |
| 1024² | 80 | 15.6–16.6 | 13.5 |
| 2048² | 40 | 29.9–32.1 | 24.8–28.0 |

That is 1.15–1.23× faster. The full game state hashes identically after every run, and after 150 days on desert, tundra and zoned 512² worlds.

```sh
node --max-old-space-size=6144 fun/transport/tests/daily-step-benchmark.mjs --model=/absolute/baseline/fun/transport/model.js --size=1024 --days=80
```

## Daily ecology revisions

Every simulated day, ecology changes a few hundred tiles on a 512² map and bumps `game.revision`. The renderer used to discard every index, prepared strip, route path and height field, then fingerprint every visible chunk again, so an empty revision cost almost as much as a real one. `change-journal.js` now records exactly which cells each ecology day changed. A journaled day keeps the indexes, foundations, grid, route paths and height fields, and fingerprints only chunks within three tiles of a change. Chunks whose terrain changed are still repainted, and scenery lists and strips are still rebuilt. Construction, settlement and industry revisions, or any gap in the journal, take the previous full path.

Paired runs against an immutable copy of the previous build used a 512² taiga map (seed 1847), 1440 × 900 CSS pixels and DPR 2. Values are medians in milliseconds:

| Workload | Before | After |
| --- | ---: | ---: |
| First render after one ecology day, paused, Region | 33.5 | 18.6 |
| First render after one ecology day, paused, Town | 12.3 | 7.3 |
| First render after one ecology day, paused, Detail | 5.8 | 3.0 |
| Day frames during 8 seconds at 8×, Region | 34.1 | 18.5 |
| Other frames in the same run | 3.3 | 3.0 |

In the 8× run, 56 of 64 day frames were ecology only (median 18.1 ms). The other 8 days also grew a town or industry and still cost about 39 ms. A revision that is not journaled still costs about 25 ms at Region. A journaled day with no changes costs 11 ms; that remainder is the scenery rebuild.

The cached/fresh regression adds journaled ecology days at all three zooms, at DPR 1 and 2. They change tiles in view, on chunk seams and out of view, dissolve a 3×3 grove, then run three real ecology days. Every RGBA pixel and sampled inspection target matches a new renderer, and route paths and foundations are not rebuilt. Seeded ecology outcomes match fixtures recorded before the journal existed.

```sh
node --test fun/transport/tests/change-journal.test.mjs
node fun/transport/tests/scene-cache-browser-check.mjs
```

## Patched ecology and growth days

Journaled days no longer rebuild the scenery list or land in one frame. A day's changed tiles patch the cached scene: only their objects and shadows are made again, only the strips on the depth runs they touch are regrouped, and the shadow layer is swapped once its successor is ready. A day that leaves the shadows alone lets a layer still being painted carry on; a second shadow change before it is ready draws shadows directly rather than show a layer two days old. Terrain chunks a day changed keep their last picture and recompose two a frame. A day on which a town builds homes is journaled as well, so the ordinary day of a busy map, ecology plus growth, no longer discards the scene, every strip and the chunk fingerprints.

Paired runs against an immutable copy of the previous build, seed 1847 taiga, 512², 1440 × 900 CSS pixels at DPR 1 in headless Chromium (software rendering), 10 seconds per row. Frame intervals and render calls in milliseconds:

| Workload | Frames before → after | Frame p99 before → after | Render p90 before → after | Render max before → after |
| --- | ---: | ---: | ---: | ---: |
| Region, 1× | 279 → 304 | 150 → 67 | 22.8 → 25.1 | 131 → 45 |
| Region, 8× | 114 → 212 | 200 → 83 | 112 → 33 | 158 → 58 |
| Town, 8× | 250 → 277 | 117 → 83 | 48.6 → 20.2 | 91 → 54 |

At Region a day frame used to recompose about eight chunks and rebuild the scene together (a 77 ms render); it now recomposes one or two chunks and patches the scene (about 25 ms). On the untouched baseline 17 of 120 days on this map also grew a town and were not journaled; on the larger maps nearly every day is one. Budgeted chunks and the patch queue count toward `sceneryBatches.pending`, so checks that settle a view wait for them.

The cached/fresh regression now also runs a day of new homes in view at every zoom, including a home on woodland that dissolves its grove, and every ecology and homes frame must match a new renderer in every RGBA pixel; both kinds must patch the scene without rebuilding it.

```sh
node --test fun/transport/tests/change-journal.test.mjs fun/transport/tests/scenery-batches.test.mjs
node fun/transport/tests/scene-cache-browser-check.mjs
```

## Mini map

Ecology used to resample the whole 512 × 512 overview after every day, and the app also sampled the hidden mini map when a world loaded and on each layer change. The overview now recolours only the samples of the cells a day journals, skips pixels where a road, rail or industry overlay won, and writes only their dirty rectangle. Construction, growth and loads still resample it whole. A hidden mini map is not drawn until it opens.

Measured on taiga maps (seed 4242; the live run on 512²) at 1440 × 900 CSS pixels and DPR 1. Draw times are medians in milliseconds, with the previous and the new renderer drawing the same world in one page:

| Workload | Before | After |
| --- | ---: | ---: |
| Mini map draw after one ecology day, 512² | 61.8 | 0.4 |
| Mini map draw after one ecology day, 2048² | 67.9 | 0.4 |
| Town 8× for 6 s with the mini map open, frames per second | 27.6 | 56.1 |
| Frames over 33 ms in the same run | 52 | 6 |
| Total mini map milliseconds in the same run (48 draws) | 3,259 | 359 |
| Hidden mini map samples while loading a world | 262,144 | 0 |

With the mini map closed, the same run holds 59.4 fps. Nearly all of the remaining mini map time comes from the five or so days out of 48 that also grew a town or an industry. Those revisions are not journaled, so they still resample the whole overview.

The Layers check patches 512² and 2048² worlds through 12 ecology days, one journaled day under road, rail and industry pixels, a road and a terraform, with roads, rails and buildings each shown and hidden. Every patched overview matches a forced full resample word for word.

```sh
node fun/transport/tests/layers-browser-check.mjs
```

## Bookkeeping revisions and route paths

Renaming, buying, selling or upgrading vehicles, the full-load switch, borrowing and repaying bump `game.revision` without touching a tile. They used to take the full path of a construction revision, rebuilding the scene and fingerprinting every visible chunk. They now journal an empty surface change, so the renderer keeps its scene, chunks and route paths and only redraws.

Route lines are projected for the visible area rounded out to 16-tile cells and cached by those bounds. The key used to be the exact visible rectangle, so every pan of a tile rebuilt every visible route path; a pan now rebuilds them only when the view crosses a cell edge. Direction chevrons skip segments outside the view before positioning them, river flow compares neighbour counts without building arrays, delivery floaters share one number formatter, and `transportHeight` no longer allocates per call.

Town streets add sidewalks to the ground chunks, which are cached as before, and up to one lamp and one bin per street tile to the scene, skipped at Region zoom. The cached/fresh scene regression and the rendering budgets pass with them.

```sh
node fun/transport/tests/scene-cache-browser-check.mjs
node fun/transport/tests/rendering-performance-browser-check.mjs
```

## Recipe 8 generation

Recipe 8 adds drainage, lake basins, river tracing, valley carving and town levelling, so it costs about twice recipe 7. Generation runs in the world worker like every recipe, so the menu stays responsive; the extra time is spent behind the loading screen, and a procedural save pays it again when it regenerates its baseline on load. The town-site search reads a per-tile level array instead of tile objects, and the industry search checks a site's deposit only when it would win; every generated world stays identical (fingerprints of recipe 8 before and after).

Medians in Node for taiga seed 1847 through `createGame` (five runs, three at 2048²):

| Map | Recipe 7 | Recipe 8 |
| --- | ---: | ---: |
| 512² | 255 ms | 459 ms |
| 1024² | 637 ms | 1,222 ms |
| 2048² | 2,140 ms | 3,961 ms |

The two search changes took recipe 8's 2048² terrain-and-towns pass (`generateWorldV8`) from 3,764 to 3,453 ms, with the parks, sports grounds and halls the towns now also place.
