# Performance and resource checks

Measured on 2026-09-27 against `bd6680b`, after prepared unit atlases were already shipped. These are local comparative measurements, not device-independent FPS guarantees.

## Simulation

The fixture uses a 224 × 168 map with equal opposing populations and enough completed nexuses for their capacity. Eight warm-up ticks precede 80 measured ticks of 50 ms simulation time. AI is disabled so the comparison isolates implementation cost: all eight before/after final-state digests match, including units, orders, combat, resources, visibility, and RNG state.

| Total units | Scene | Median before → after (ms/tick) | p95 before → after (ms/tick) |
| --- | --- | --- | --- |
| 600 | March | 23.27 → 17.00 | 40.16 → 23.17 |
| 600 | Obstructed routes | 43.31 → 33.00 | 62.18 → 59.31 |
| 600 | Battle | 28.25 → 19.60 | 33.66 → 25.25 |
| 600 | Harvesting | 30.21 → 16.61 | 38.83 → 21.46 |
| 2,000 | March | 90.15 → 73.48 | 116.07 → 102.86 |
| 2,000 | Obstructed routes | 136.58 → 130.16 | 177.41 → 145.16 |
| 2,000 | Battle | 105.68 → 79.74 | 121.31 → 106.60 |
| 2,000 | Harvesting | 145.85 → 56.06 | 177.26 → 99.03 |

Improvements reuse ordered spatial-query candidates and per-step team/role lists, share immutable Boids neighborhood candidates, prove empty swept rectangles using a summed blocked-tile grid, and reuse numeric A* heap storage. Exact position, collision, and visibility checks still run. Derived caches are invalidated by navigation changes, bucket moves, births, and deaths; none is serialized.

From `fun/ashline/`:

```sh
node tests/performance-benchmark.mjs
ASHLINE_UNITS=2000 node tests/performance-benchmark.mjs
ASHLINE_PROFILE=/tmp/ashline-sim.cpuprofile node tests/performance-benchmark.mjs
node --test tests/performance.test.mjs tests/frame-scheduler.test.mjs tests/ai-defense.test.mjs
```

`ASHLINE_TICKS` changes the sample count; `ASHLINE_SCENES` accepts a comma-separated subset of `march,obstructed,battle,harvesting`, plus the opt-in `duel`: a hard AI-versus-AI match on a vast rift map, where `ASHLINE_UNITS` does not apply. Each scene reports the median, p95 and worst tick (`maxMs`). `ASHLINE_SIM_URL` can select a baseline simulation module with its dependencies. Compare state digests as well as timing. Timings are reports, never machine-dependent test assertions.

The frame scheduler keeps deterministic 50 ms steps and checks an 8 ms CPU budget **between** steps. It bounds pending work and yields to rendering/input instead of chaining several expensive ticks. A single tick can exceed that budget, and sustained overload reduces effective game speed, including at 200%. The 2,000-unit congestion case remains CPU-heavy.

## Simulation, 2026-10-09

Measured against `4563439` on a 4-core container that runs roughly twice as slow as the 2026-09-27 machine and varies about ±20% between runs, so compare these figures only with each other. Baseline and new runs alternated, three of each; the table gives the median of the per-run medians and p95s. The 2,000-unit rows use 30 measured ticks.

| Total units | Scene | Median before → after (ms/tick) | p95 before → after (ms/tick) |
| --- | --- | --- | --- |
| 600 | March | 46.91 → 43.30 | 72.11 → 72.15 |
| 600 | Obstructed routes | 91.59 → 61.57 | 152.66 → 109.87 |
| 600 | Battle | 53.98 → 49.77 | 86.76 → 86.40 |
| 600 | Harvesting | 48.86 → 43.11 | 77.43 → 76.45 |
| 2,000 | March | 203.87 → 187.68 | 263.78 → 265.07 |
| 2,000 | Obstructed routes | 364.32 → 129.29 | 500.83 → 187.84 |
| 2,000 | Battle | 214.84 → 201.48 | 327.44 → 246.40 |
| 2,000 | Harvesting | 172.33 → 131.97 | 236.96 → 181.40 |

A 15-minute hard AI duel (`duel`, 18,000 ticks) shows the tick spikes a real match produces: total simulation time **28.0 → 17.4 s**, p95 **4.69 → 2.72 ms**, worst tick **180.6 → 47.8 ms**. Generating a vast map takes about 36 → 25 ms.

Every change keeps behaviour bit-identical. The final-state digests of all benchmark scenes match the baseline at both populations. So do the behaviour digests of 72 generated maps, four 300-second games and four scenes, and differential traces of 900-second AI duels, placement checks across whole maps, mass exploration, group rallies into rock and corners, and depleting harvest fields.

- **A\*.** Generation stamps replace three whole-map resets per search, the heuristic is cached per cell, and bounds and the Defend leash are resolved once per search. Costs stay `Float32Array` values and heap ties are unchanged, so the same paths come out.
- **Swept clearance.** When a ray's bounding rectangle touches a blocker, it is split into chunks of 12 samples. A chunk whose slightly widened rectangle is empty in the summed blocked-tile grid is proven clear; only the rest are sampled, and the corner test no longer allocates. Boids neighbours inside an open 8.4-tile square skip their swept checks, since every one would succeed.
- **Fog.** Each sight disc is stamped row by row: a square root estimates each span, and the original cell-centre test settles both ends. AI memory pruning looks up entities by id instead of scanning the entity list.
- **Spatial queries.** Grid buckets use integer keys. Cached nearby-entity rectangles are checked against per-bucket versions, so a unit crossing a bucket no longer clears every cached query, and deaths no longer clear the cache, because dead entities keep their bucket until the step ends.
- **Group orders.** Rally slots are claimed in the original distance, row and column order, but in doubling distance bands. A filled rally stops searching instead of sorting every hex point and fallback tile on the map, and occupancy uses integer keys. In an instrumented duel run, the worst AI think fell from 192 to 45 ms; most of what remains is a one-time cold navigation rebuild.
- **Construction planning.** `canPlace` splits into position-independent checks, evaluated once, and a per-cell check. Reasons and their order are unchanged. AI building placement and wall-drag previews test hundreds of cells against one evaluation, and units are bucketed by tile once. AI placement, previously up to 43 ms in one think, no longer appears among the duel's worst ticks.
- **Navigation and economy.** The region flood no longer allocates per cell. Nearest-shard and exploration targets come from ring searches that stop once no farther cell can win, with ties going to the lowest index, as in a full scan. Exploration reuses its crowding grid. AI mining-site matching uses buckets that keep the first-match order. Spawn crowding uses the spatial index, and the armor table is a module constant.
- **Generation.** Relief quantiles sort the mirrored half of each field once, still as numeric `TypedArray` sorts. Pocket breaching no longer allocates a closure per cell.

A\* expansion still dominates the obstructed scene and the remaining worst AI ticks (up to 16 searches per tick). A shared flow field would change paths, so it needs re-baselined digests. March and battle at 2,000 units remain bound by the per-unit neighbour loops in `navigate`.

From `fun/ashline/`, with the previous simulation checked out beside it. `ASHLINE_SIM_URL` must name `sim.js` inside a complete checkout, because it imports its sibling simulation modules (`ai.js`, `terrain.js`, `flocking.js`, `traffic.js`, `mission.js`, `campaign.js`, `abilities.js`):

```sh
git worktree add /tmp/ashline-base 4563439
ASHLINE_SIM_URL=file:///tmp/ashline-base/fun/ashline/sim.js node tests/performance-benchmark.mjs
node tests/performance-benchmark.mjs
ASHLINE_SIM_URL=file:///tmp/ashline-base/fun/ashline/sim.js ASHLINE_UNITS=2000 ASHLINE_TICKS=30 node tests/performance-benchmark.mjs
ASHLINE_UNITS=2000 ASHLINE_TICKS=30 node tests/performance-benchmark.mjs
ASHLINE_SCENES=duel ASHLINE_TICKS=18000 node tests/performance-benchmark.mjs
```

The state digest covers every saved field. Typed events and team statistics, added after this pass, therefore change the digests relative to `4563439`; with team statistics removed and events reduced to text, team and time, all four scenes still match it.

## Rendering, 2026-10-10

`tests/render-benchmark.mjs` instruments `CanvasRenderingContext2D` in headless Chromium and counts the operations of one battlefield frame (minimap overlay included, full minimap rebuild excluded) on the vast `PERF-VAST-2026` rift at 1440 × 900, DPR 1, with every cell visible. The scenes add 0, 200 and 2,000 mixed units of both teams near the camera, with a quarter of that number in shots, rockets, shells and explosions; some units are firing, damaged, freshly hit or selected. Counts are deterministic. Frame times come from 30 draws per scene in a software-rasterised headless browser on the shared 4-core container (load average 10–14 during the runs, so individual runs vary by up to ±40%); baseline (`cfd3dab`) and new runs alternated three times each, and the table gives the median and the best of the three per-run medians.

| Scene | Canvas operations | `save`/`restore` pairs | Radial gradients | `shadowBlur` sets | Ellipses | Fills | Frame median (median / best run, ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Base (10 units) | 1,303 → 939 | 280 → 10 | 8 → 0 | 18 → 0 | 34 → 10 | 36 → 16 | 23.7 / 23.3 → 34.0 / 23.4 |
| +200 units, 50 effects | 7,527 → 3,816 | 1,380 → 32 | 311 → 0 | 18 → 0 | 710 → 323 | 776 → 388 | 89.0 / 78.1 → 78.9 / 72.0 |
| +2,000 units, 500 effects | 63,568 → 29,760 | 11,265 → 232 | 3,031 → 0 | 18 → 0 | 6,803 → 3,156 | 7,457 → 3,764 | 632.9 / 591.9 → 482.0 / 478.5 |

`drawImage` calls rise (477 → 505, 1,077 → 1,497, 6,477 → 10,410) because soft shapes are now stamps of cached sprites, and the new frame also draws hit flashes, burning hulls, ash-fall, lava heat light and explosion flashes. Linear gradients fall from one per frame to none. In a layer-by-layer timing of the base scene, removing ash-fall, heat light or embers each changed the frame by less than the run-to-run noise (about 2 ms); removing the stretched vignette saves about 3.5 ms under software rasterisation, and with everything enabled the base frame matches the baseline's best run.

What changed:

- **Cached soft sprites.** Glows, lamps (formerly a `shadowBlur` per lamp), soot, fire, smoke, steam, flames, the production-bay floor and labels are baked once into small canvases and stamped with `drawImage`; no gradient or blur is created per frame. The vignette is a one-eighth-resolution bake per viewport size.
- **Transforms instead of state stacks.** Bodies, shadows and rockets get one computed `setTransform` each; sprite drawing restores only the sampling settings it changes; attached unit effects rotate their points rather than the context; prop shadows set and reset alpha.
- **Fewer scans.** Props are bucketed by tile row and only the rows on screen are visited; canopy fading checks units bucketed by row instead of every visible unit per tree; hauler unload streams and engineer beams look up their targets in an id map rebuilt only when the entity list changes; lava pools are rejected by their tile bounds before any cell is visited, with cell coordinates precomputed.
- **Fog.** In the live loop the fog grids are compared only once per simulation tick, and then word by word; fixtures that edit fog in place are still compared every frame.
- **Terrain bake.** The 8 px-per-tile material masks reuse a small scratch-canvas pool and clear every backing store when the bake ends, the noise bake and each lava bank surface are released as soon as they are composited, and the lava heat light is rebuilt only when exploration changes.

Reproduce from `fun/ashline/` against a local server of each checkout (`ASHLINE_DRAWS` sets the timed draws, `ASHLINE_DPR` the device pixel ratio, `ASHLINE_SCREENSHOTS` an optional output folder):

```sh
git worktree add /tmp/ashline-render-base cfd3dab
(cd /tmp/ashline-render-base && python3 -m http.server 8001 --bind 127.0.0.1 &)
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs ASHLINE_URL=http://127.0.0.1:8001/fun/ashline/ ASHLINE_DRAWS=30 node tests/render-benchmark.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs ASHLINE_DRAWS=30 node tests/render-benchmark.mjs
```

The baseline checkout has no copy of the benchmark; run this checkout's script against the baseline server, as above.

## Rendering and memory

Chrome, a 1440 × 900 desktop viewport at DPR 2, Vast volcanic rift, seed `PERF-VAST-2026`:

- Cached canvas storage: **224.3 → 193.4 MiB**, approximately 31 MiB saved. This sums live programmatically created canvas dimensions × four bytes after garbage collection; it is not total browser/GPU process memory. The persistent main canvas and minimap are excluded.
- Temporary unit shadow/contact masks are released after their composed shadows are built, saving about 14.3 MiB. The 42 lava pools retain their originally generated half-resolution flow textures, saving about 16.7 MiB; banks, masks, and output surfaces keep their resolution.
- A paused scene with 2,000 visible units reduced mean renderer draw submission from **13.55 → 10.42 ms** (p95 **15.5 → 11.8 ms**). At a 390 × 844 mobile viewport, DPR 2, the corresponding mean was **11.52 → 9.10 ms**. These isolate renderer work; they exclude simulation and asynchronous GPU completion.
- Rank/team/group plates use a bounded cache at the current DPR. Off-screen bodies avoid depth sorting, while visible route segments from off-screen selected units still render.
- Leaving an operation releases terrain, fog, minimap caches, lava surfaces, remembered entities, and cached plates. Reusable art remains around 67 MiB. A replacement save load and a failed deployment also release retired worlds; an invalid save preserves the current operation.

Run against a local HTTP server with an existing Playwright/Chrome installation:

```sh
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/memory-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/resource-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/rank-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/lava-browser-check.mjs
ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/fog-save-browser-check.mjs
```

`ASHLINE_URL` overrides the default `http://127.0.0.1:8000/fun/ashline/`. Unit body/shadow pixels were compared across 704 cases with identical hashes. Lava screenshots at minimum/maximum zoom and DPR 1/2 differed by at most 7/255 per color channel, with mean differences below 0.13/255 due to the changed resampling pass. Stationary recessed banks, simulation-time animation, pause, and fog behavior are covered separately.
