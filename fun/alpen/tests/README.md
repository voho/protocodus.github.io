# Alpen checks

Run from `fun/alpen` with Node.js; no test dependencies are needed:

```sh
node tests/riding-check.mjs
node tests/terrain-shadow-check.mjs
node tests/models-check.mjs
node tests/graphics-check.mjs
```

These cover jump charge and timing, ballistic flight, trick landing assistance,
input pulses, camera tracking, terrain continuity and determinism, shadow seams,
model geometry budgets, shadow refresh timing, and adaptive rendering recovery.
The graphics check uses a renderer stub; it does not compile GPU shaders.

For browser checks, serve the repository root and open
`/fun/alpen/?seed=alpine-review`. Exercise carve, charged pop, grab/spin, landing,
brake, pause/resume and restart. Check a narrow touch viewport as well as desktop.
The existing T key cycles morning, dusk and blue hour. `window.__alpen.debug()`
reports frame time, draw calls, triangles, render scale and simulation state.

Validated in the local Chromium browser at 1440×900 and 390×844, including actual
touch events, daylight/dusk/blue hour/blizzard rendering, and terrain rebuilds
at 1.2, 3.6 and 8 km. No runtime or shader errors occurred in the final pass.
The 120-frame opening benchmark at 1200×1279 measured a 16.7 ms median and
17.6 ms p95 at full resolution, matching the original run's display-limited FPS.
CPU microbenchmarks measured height queries about 31% faster and a streamed
five-tile shadow row about 38% faster; those are local measurements, not a
cross-device FPS guarantee. Adaptive halo rendering saves three passes when
resolution falls below 80%, fading back in as performance recovers.

A white block appeared in two blue-hour screenshots during forced weather
changes. It did not reproduce in direct framebuffer checks or the final pass;
its cause remains unconfirmed. No speculative particle changes were applied.
