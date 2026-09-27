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

`ASHLINE_TICKS` changes the sample count; `ASHLINE_SCENES` accepts a comma-separated subset of `march,obstructed,battle,harvesting`. `ASHLINE_SIM_URL` can select a baseline simulation module with its dependencies. Compare state digests as well as timing. Timings are reports, never machine-dependent test assertions.

The frame scheduler keeps deterministic 50 ms steps and checks an 8 ms CPU budget **between** steps. It bounds pending work and yields to rendering/input instead of chaining several expensive ticks. A single tick can exceed that budget, and sustained overload reduces effective game speed, including at 200%. The 2,000-unit congestion case remains CPU-heavy.

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
