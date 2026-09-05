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
HUD checks cover mode transitions, controls disclosure, focus and idle DOM writes.
The graphics check uses a renderer stub; it does not compile GPU shaders.

For browser checks, serve the repository root and open
`/fun/alpen/?seed=alpine-review`. Exercise carve, charged pop, grab/spin, landing,
brake, pause/resume and restart. Check a narrow touch viewport as well as desktop.
The existing T key cycles morning, dusk and blue hour. `window.__alpen.debug()`
reports frame time, draw calls, triangles, render scale and simulation state.
It also reports CPU submission time and optional asynchronous GPU timing,
including separate averages for frames that refresh or reuse shadows.

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
