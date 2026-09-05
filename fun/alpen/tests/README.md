# Alpen checks

Run from `fun/alpen` with Node.js; no test dependencies are needed:

```sh
node tests/riding-check.mjs
node tests/terrain-shadow-check.mjs
node tests/models-check.mjs
node tests/graphics-check.mjs
node tests/hud-check.mjs
```

These cover jump charge and timing, ballistic flight, trick landing assistance,
input pulses, camera tracking, terrain continuity and determinism, shadow seams,
model geometry budgets, shadow refresh timing, and adaptive rendering recovery.
Input regressions include releasing a spin before touchdown, controller menu
edges, and discarding stale jump gestures across pause and focus loss.
HUD checks cover mode transitions, controls disclosure, focus and idle DOM writes.
The graphics check uses a renderer stub; it does not compile GPU shaders.

For browser checks, serve the repository root and open
`/fun/alpen/?seed=alpine-review`. Exercise carve, charged pop, grab/spin, landing,
brake, pause/resume and restart. Check a narrow touch viewport as well as desktop.
The existing T key cycles morning, dusk and blue hour. `window.__alpen.debug()`
reports frame time, draw calls, triangles, render scale and simulation state.
It also reports CPU submission time and optional asynchronous GPU timing,
including separate averages for frames that refresh or reuse shadows.

The follow-up pass verified A/Start pause and resume through the production
loop with a simulated controller, plus actual touch jump and pause controls
at 390×844. Day, dusk and blue-hour captures at 8 km compiled without errors.
Conifer volume uses 7.2% fewer triangles in the seeded model sample; snow
variants share one surface and hanging needle cards supply depth. Mountain
geometry stays at 35,840 triangles and adds one existing 1024² granite map.
A local 160-frame renderer comparison against `76b47f0`, with a fixed camera
and 100% internal resolution at 1440×900, measured mean sampled GPU work
7.06 → 6.49 ms and render submission 1.03 → 0.98 ms. Both runs had 16.7 ms
median / 18.5 ms p95 frame intervals. This isolates rendering, not gameplay
CPU cost, and does not predict performance on other hardware.

The presentation pass was checked at 1440×900 and 390×844 with desktop and
native touch input, charged jumps, controls disclosure, pause/resume, restart,
and actual WebGL context loss/restoration. No runtime or shader errors were
reported. A 180-frame opening run measured 16.7 ms median / 18.6 ms p95 at
80% internal resolution, with mean CPU submission 2.6 ms and sampled GPU
work 6.1 ms. These are local measurements; the adaptive governor chooses
resolution for each device. Terrain checks also exercise three seeds over
12 km and long-range shadow seams. Tree triangle counts remain unchanged.

The earlier riding pass was validated in Chromium at 1440×900 and 390×844, including actual
touch events, daylight/dusk/blue hour/blizzard rendering, and terrain rebuilds
at 1.2, 3.6 and 8 km. No runtime or shader errors occurred in the final pass.
The 120-frame opening benchmark at 1200×1279 measured a 16.7 ms median and
17.6 ms p95 at full resolution, matching the original run's display-limited FPS.
CPU microbenchmarks measured height queries about 31% faster and a streamed
five-tile shadow row about 38% faster; those are local measurements, not a
cross-device FPS guarantee. Adaptive halo rendering saves three passes when
resolution falls below 80%, fading back in as performance recovers.

An intermittent flat block appeared in blue-hour captures and one pause
screenshot. It did not reproduce in direct framebuffer checks or a subsequent
frozen-frame comparison with every particle system hidden. Its cause remains
unconfirmed; no speculative particle fixes were applied.
The follow-up investigation also found 30 successive frozen renders stable
and no nonfinite values in the HDR target; it did not reproduce the block.
