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
It exercises all six snowfall bands across nine times of day, cloud extinction,
night-storm visibility, panorama skyline occlusion and photograph fallbacks.

For browser checks, serve the repository root and open
`/fun/alpen/?seed=alpine-review`. Exercise carve, charged pop, grab/spin, landing,
brake, pause/resume and restart. Check a narrow touch viewport as well as desktop.
The existing T key cycles morning, dusk and blue hour. `window.__alpen.debug()`
reports frame time, draw calls, triangles, render scale and simulation state.
It also reports CPU submission time and optional asynchronous GPU timing,
including separate averages for frames that refresh or reuse shadows.

The efficiency pass was checked from 390×844 through 3840×2160, including
expanded help, pause/resume and a native touch charged jump. Desktop labels
scale from about 14.5 px at 1440 pixels wide to 25 px at 4K, independently of
world rendering resolution. No horizontal overflow or shader errors occurred.
A frozen-scene framebuffer comparison against `dab491a`, at 1920×1080 with
4× MSAA, found a maximum difference of one 8-bit color step with rays both
enabled and disabled. The equivalent blur uses four texture reads instead of
five, inactive rays skip their composite read, and postpasses share a triangle.

Four alternating baseline/current eight-second opening rides at that same
resolution measured mean main-loop CPU time of 2.97 → 1.84 ms (about 38% less)
and total terrain-update time of 735 → 199 ms (about 73% less). Terrain retains
exact matching heights and surface neighborhoods across streamed builds.
Regression checks compare six complete terrain buffers in 48 streaming/reset
cases, including interrupted builds and seed changes at the same anchor.
The reuse buffers add about 0.94 MiB of CPU memory and no GPU memory.
Frame intervals stayed at 16.7 ms median / 17.6 ms p95 in both versions; GPU
timings varied without a clear overall change. These local measurements show
additional CPU headroom, not a guaranteed FPS increase on other hardware.

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

The weather pass was visually checked across clear, flurries, light snow,
snowing, heavy snow and blizzard conditions, all nine daylight phases, mist,
cloud cover and aurora. Light snowfall retains longer views, storm lighting
becomes more diffuse, and night storms retain enough ambient light to read
the near piste. Sun, glow and rays respect the photographed skyline, including
plate crossfades; dim night photographs no longer revive the fallback ribbons.
These changes add no GPU passes, geometry or textures. The skyline lookup is
cached once per decoded photograph, using about 5 KB of CPU memory in total.

The intermittent rectangle was captured during live riding: a single NaN
terrain pixel spread through the bloom filters into a roughly 144-pixel square.
A frozen redraw erased the original invalid pixel, which explains why earlier
particle-isolation checks missed it. Fog exits must preserve the neighboring
fragments needed by texture derivatives, and Fresnel inputs must stay within
their mathematical domain. Postprocessing also rejects nonfinite scene colors
before bloom or motion blur can spread them, without clipping valid HDR light.
The corrected shader keeps its fog shortcut by evaluating gradients first;
its texture-read and explicit-derivative counts remain unchanged. Live riding
through all 54 weather/time combinations produced 800 full-resolution HDR
scans without a nonfinite pixel or runtime/shader error. A 390×844 check also
verified native touch jump, pause and resume without horizontal HUD overflow.

Paired 1440×900 renderer checks with 4× MSAA retained a 16.7 ms median frame
interval and 17.5–17.8 ms p95. The safe terrain shader cost about 0.2–1.4 ms
more sampled GPU time than its unsafe predecessor across these runs; retaining
the fog shortcut recovered most of the storm cost of simply removing it.
These local timings vary with other system work and do not guarantee the same
FPS on other devices. No quality settings were reduced for the comparison.

To exercise that safeguard on the actual GPU, run this in the game console:

```js
await (await import('./tests/post-hdr-browser-check.mjs')).runPostHdrCheck()
```

This uses and disposes a separate offscreen WebGL context. It injects NaN,
positive infinity and negative infinity at idle and maximum speed, checks all
bloom/ray targets, and compares valid HDR images with the safeguard disabled.
All six cases passed locally: over 26,000 affected pixels fell to at most five,
and the valid images remained pixel-identical.
