# Large-world performance

Measured on the development machine in Node and headless Chrome in September 2026. These are regression workloads, not a promised frame rate on every device. The map-size limit remains **2048 × 2048**.

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
node fun/transport/tests/start-menu-browser-check.mjs
node fun/transport/tests/compact-play-browser-check.mjs
node fun/transport/tests/weather-effects-browser-check.mjs
node fun/transport/tests/loading-screen-browser-check.mjs
```

The browser checks use isolated storage and never edit the player's saved companies. Timing values are reported; correctness, cache bounds, conservation, exact save restoration, idle invalidation, and visible interactions are asserted.

## Busy-screen rendering

A second pass profiles what is actually on screen: dense woodland, a large city, and crowded roads and railways. Its baseline is the completed large-world work above, before the additional sprite, lighting and scene-cache changes.

Nature, buildings and transport now use shared, bounded prepared-image caches across the three zoom levels. The artwork is rendered at the required physical-pixel size; revisiting a prepared zoom does not resize every instance again. The static artwork pool is capped at 128 MiB, transport at 32 MiB, and tree shadows at 32 MiB. Larger visible groves previously exhausted the 16 MiB sprite cache and could recreate thousands of identical images every frame. In one 24-frame Detail woodland run, the old renderer created 10,632 sprites; the new renderer created none after warming.

Small camera moves reuse scenery ordering and foundation geometry. Moving vehicles are merged into that order, preserving occlusion. Exact sprite and shadow rectangles reject objects outside the screen; shadow smoothing state is set once for the batch. Night lighting uses cached emitter descriptions, window artwork and directional headlight beams. Cargo badges reuse prepared artwork while preserving their load indicators.

The full suite covers **54 views**: six scenes × three zooms × daylight, night and rain, at 1280 × 900 CSS pixels and DPR 2. It includes a real 512² taiga world (seed 418), its densest sampled forest and largest town, plus staged flat landscapes. The staged city contains 21,139 buildings and 157 industries. The fleet contains 3,102 vehicles; Region considers 1,257 nearby vehicles and paints roughly 1,041 visible load badges. Detail still paints 63 visible badges. These are rendering fixtures, without construction costs or an economic simulation step in the measured interval.

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

A separate **100-case** browser regression compares a reused renderer with a newly created one after small, long and reverse pans, visibility toggles, terrain/building revisions, zoom changes and late artwork loading. Every visible RGBA pixel and sampled inspection target matches. Before/after daytime Town screenshots of forests and buildings also match exactly. Prepared vehicle/badge edges and cached night lights have small rasterization differences; all directions, load states and footprints receive independent artwork checks.

```sh
# Full sequence; warm caches must not rerasterize visible objects.
TRANSPORT_EXPECT_STABLE_SPRITES=1 node fun/transport/tests/busy-scenes-browser-check.mjs

# Independent forest run, with a fresh browser context for each selected scene.
TRANSPORT_FRESH_SCENES=1 TRANSPORT_SCENES=forest TRANSPORT_CONDITIONS=day TRANSPORT_FRAMES=24 \
  TRANSPORT_EXPECT_STABLE_SPRITES=1 node fun/transport/tests/busy-scenes-browser-check.mjs

# Cached/fresh frame and inspection equivalence, including invalidations.
node fun/transport/tests/scene-cache-browser-check.mjs
```

`TRANSPORT_URL` selects an immutable comparison server, `TRANSPORT_OUTPUT` selects the results/screenshot directory, and `TRANSPORT_PROFILE=1` records Chrome CPU profiles for Region daylight/night views. Timings are reported rather than asserted against device-specific thresholds.

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

Vehicles no longer stop during autosave capture. Daily steps wait for the capture, and periodic saves start early in a day, so at 1× no frame is held up to 2048² and at 8× the hold is about 85 ms at 1024² and 640 ms at 2048² (previously about 0.2 s at 512², 0.7 s at 1024² and 2.9 s at 2048², at every speed). Tiles that `delete` has put into dictionary mode (terrain object release, bulldozing) used to make every later tile take generic per-key loads; plain tiles now only check their key names. After about 30 played days, capture takes 31 ms instead of 118 ms at 512² and 123 ms instead of 462 ms at 1024², and freshly generated worlds are unchanged (28 and 107 ms). Construction autosaves wait three seconds after the last stroke, so a drag never holds vehicles.

Browser regression checks cover startup, cancellation by button/Escape, save-slot round trips, quotas, delayed stale worker responses, overlapping saves, continued simulation during encoding and the final page-leave checkpoint. The new UI scenarios pass on both 512² and 2048² maps. All 431 model tests pass.

```sh
node fun/transport/tests/background-jobs-browser-check.mjs
TRANSPORT_WORLD_SIZE=square2048 node fun/transport/tests/background-jobs-browser-check.mjs
node fun/transport/tests/background-ui-browser-check.mjs
TRANSPORT_WORLD_SIZE=square2048 node fun/transport/tests/background-ui-browser-check.mjs
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
TRANSPORT_FRESH_SCENES=1 TRANSPORT_SCENES=forest,mixed TRANSPORT_CONDITIONS=day,night \
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

## Daily ecology revisions

Every simulated day, ecology changes a few hundred tiles on a 512² map and bumps `game.revision`. The renderer used to discard every index, prepared strip, route path and height field, then fingerprint every visible chunk again, so an empty revision cost almost as much as a real one. `change-journal.js` now records exactly which cells each ecology day changed. A journaled day keeps the indexes, foundations, grid, route paths, height fields and night-light emitters, and fingerprints only chunks within three tiles of a change. Chunks whose terrain changed are still repainted, and scenery lists and strips are still rebuilt. Construction, settlement and industry revisions, or any gap in the journal, take the previous full path.

Paired runs against an immutable copy of the previous build used a 512² taiga map (seed 1847), 1440 × 900 CSS pixels and DPR 2. Values are medians in milliseconds:

| Workload | Before | After |
| --- | ---: | ---: |
| First render after one ecology day, paused, Region | 33.5 | 18.6 |
| First render after one ecology day, paused, Town | 12.3 | 7.3 |
| First render after one ecology day, paused, Detail | 5.8 | 3.0 |
| Day frames during 8 seconds at 8×, Region | 34.1 | 18.5 |
| Other frames in the same run | 3.3 | 3.0 |

In the 8× run, 56 of 64 day frames were ecology only (median 18.1 ms). The other 8 days also grew a town or industry and still cost about 39 ms. A revision that is not journaled still costs about 25 ms at Region. A journaled day with no changes costs 11 ms; that remainder is the scenery rebuild.

The cached/fresh regression adds journaled ecology days at all three zooms, by day and night, at DPR 1 and 2. They change tiles in view, on chunk seams and out of view, dissolve a 3×3 grove, then run three real ecology days. Every RGBA pixel and sampled inspection target matches a new renderer, and route paths, foundations and night emitters are not rebuilt. Seeded ecology outcomes match fixtures recorded before the journal existed.

```sh
node --test fun/transport/tests/change-journal.test.mjs
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
