# Portable sustained-flight measurements

Run from an already served Tyran application with Node and Playwright available:

```sh
TYRAN_URL=http://127.0.0.1:8773/fun/tyran/ TYRAN_PERF_PROFILE=0 node fun/tyran/tests/performance-check.mjs
```

The default measures current served code, with no source interception. It uses a fixed 60-second preview settle followed by at least 25 seconds of real flight, and reports the actual visible canvas, backing size, cadence, workload, process churn and errors. CPU/GPU counters use the same start gate and stop boundary as the release comparison: the start gate holds RAF callback delivery only during counter reads, then restores normal RAF. Launch/preparation/trace transfer are outside the CPU window. All owned browser-process CPU remains included.

Use `TYRAN_ABLATION=native` or `TYRAN_ABLATION=gpu` to select the current application's renderer query parameter. Leave unset to keep TYRAN_URL exactly as supplied. For frozen A/B sources, set `TYRAN_SNAPSHOT_DIR` to a directory with `manifest.json` and `<variant>/<file>` overrides, and select `TYRAN_ABLATION=<variant>` (defaults to native when using snapshots). The optional snapshot path retains the symmetric visual-random stream substitution from the comparison harness. Current served code is not rewritten, so its shared seeded visual/simulation randomness is explicitly reported as a comparability limitation.

Keep both runs' viewport, DPR, world, stress mode, duration, profiling and settle settings identical. Compare raw CPU seconds only for comparable measured durations/cadence and workloads; use owned GPU counter delta divided by its reported wider boundary duration. Whole-device utilization includes unrelated apps and is never subtracted from owned CPU/GPU totals.

Useful environment variables:

- `TYRAN_PERF_OUTPUT`: output directory; defaults to the operating system's temporary directory / tyran-performance.
- `TYRAN_PLAYWRIGHT`: Playwright module path if not installed in Node's normal resolution path.
- `TYRAN_VIEWPORT_WIDTH`, `TYRAN_VIEWPORT_HEIGHT`, `TYRAN_DPR`: defaults 1440 × 960, DPR 1.
- `TYRAN_PERF_SECONDS`, `TYRAN_PERF_SETTLE_MS`: defaults 25 seconds and 60000 ms.
- `TYRAN_PERF_WORLD`, `TYRAN_PERF_STRESS`, `TYRAN_PERF_COLD`: defaults world 6, no stress injection, launch after preview.
- `TYRAN_PERF_PROFILE=0`: disable sampled JS profiling for headline timings; the original default remains profiling enabled and is recorded.
- `TYRAN_CPU_RATE`: optional renderer CPU throttle; defaults 1.
- `TYRAN_PERF_NATIVE_CPU=0`: opt into CDP counters on macOS; otherwise Darwin uses the portable local Python helper and verifies PID start-time identities. Other platforms use CDP SystemInfo counters without claiming native identity checks.
- `TYRAN_PERF_OWN_GPU=0`: disable macOS AGX owned-client GPU counters (needed on non-Apple GPU Macs). The helper is never run off Darwin.
- `TYRAN_PERF_GPU_SAMPLE=1`: optional whole-device macOS AGX utilization samples and idle control; off by default.
- `TYRAN_PYTHON`: Python executable for macOS helpers; defaults python3.

Files to copy together: performance-check.mjs, native-cpu-client.mjs, native-cpu.py and owned-gpu-stats.py. Paths are relative to the test module; no machine-specific paths are embedded. The Python CPU helper uses only standard-library ctypes/json; GPU helper uses standard-library plistlib and ioreg.

Do not run visual QA or other benchmark browsers concurrently with timed flights. Profiling runs diagnose hot functions; keep profiling disabled for reported savings.

## Frame-cost comparison without a hardware GPU

`frame-cost-check.mjs` isolates the two halves of a frame so a change can be compared on any machine, including a container whose only GPU is the SwiftShader software renderer:

```sh
TYRAN_BROWSER=chromium TYRAN_FRAME_MODE=js node fun/tyran/tests/frame-cost-check.mjs
TYRAN_BROWSER=chromium TYRAN_FRAME_MODE=gpu node fun/tyran/tests/frame-cost-check.mjs
```

- `js` replaces every WebGL2 context with a no-op context before the page loads. Frames then measure main-thread JavaScript only: script time per rendered frame, the renderer's own render/update averages, draw calls, vertices, and a CPU profile with self and inclusive attribution.
- `gpu` runs the real renderer and additionally sums the analytic area of every submitted triangle, reported in full-screen equivalents, split into image and geometry programs, with soft-layer round trips, flushes and texture uploads per frame.

Both modes drive the seeded 18-ship Inferno Foundry flight from `performance-check.mjs` for `TYRAN_PERF_SECONDS` seconds and pin the backing resolution through `tyran.adaptiveResolution = false`, so A/B runs draw the same surface. Compare runs of the same mode only; frame intervals under a software GPU are dominated by the rasterizer and are not a hardware measurement. Long tasks are reported for the `js` mode, where they identify main-thread work such as strip preparation or saves rather than compositor stalls.

The `memory` block of either report includes `syncStrips`, the number of terrain strips a frame had to finish or build on demand during the flight, plus `staleStrips` and `pendingStrips`; zero on-demand strips means streaming stayed ahead of the viewport.

### September 2026 results

Both passes ran for 20 seconds in the same container at a 1440 × 960 viewport and device pixel ratio 1, seeded identically, against the previous release (`base`) and this one. Fill is normalized per backing pixel, so the base fill pass, which lacked the resolution pin and adapted to 70% scale on the software GPU, remains comparable.

| Measure (per rendered frame) | Base | This release |
| --- | --- | --- |
| JavaScript pass: script time | 1.91 ms | 1.66 ms |
| JavaScript pass: total task time | 2.49 ms | 2.30 ms |
| JavaScript pass: draw calls | 153 | 94 |
| JavaScript pass: submitted vertices | 6,190 | 3,710 |
| JavaScript pass: `drawImage` calls | 438 | 362 |
| JavaScript pass: texture uploads | 0.05 | 0.05 |
| JavaScript pass: JS heap after the flight | 11.7 MB | 6.4 MB |
| Fill pass: full-screen-equivalents of fill | 12.8 | 5.5 |
| Fill pass: triangles | 2,470 | 1,300 |
| Fill pass: batch flushes | 5.3 | 1.1 |
| Fill pass: half-resolution layer round trips | 2 | 0 |
| Fill pass: texture uploads (bytes) | 0.34 (177 KB) | 0.23 (79 KB) |

Frame intervals under the software rasterizer are not reported; on the JavaScript pass both versions hold 60 FPS in this container.

### 2026-10-23: texture lifetime across sectors

Chrome 155 headless on an Apple-silicon Mac, 1440 × 960 at device pixel ratio 1. Before = the commit preceding this entry.

- The renderer's texture cache held a strong reference to every canvas it had uploaded, so sprites that the ship, effect, projectile and world caches dropped kept their textures. `tyran.launch(0..11)` in a row (`tests/gpu-memory-check.mjs`): GPU texture bytes 54 → 246 MB (the 256 MB budget) before, 54 → 64 MB after; resident textures 869 → 321; evictions 315 → 0 (each eviction flushes the pending batch). One sector's flight (`frame-cost-check`, world 6, which previews world 0 first): 323 textures / 89 MB → 244 / 63 MB.
- Per-frame cost is unchanged by design: js pass 0.65 → 0.71 ms script per frame (repeat runs vary by ±0.07), gpu pass 0.71 → 0.71 ms; 94 draw calls, 3.6k vertices and 5.7 screens of fill in both.
- Measured and left alone (browser, renderer and GPU process CPU over 12 s windows, three runs each; the browser process alone varies 10–37%): the GPU process costs 16.4% of a core and the renderer 11.7% at 60 FPS. Removing 55 of 102 draw calls per frame (the ships' screen/source-over switches) saved 0.9 points of GPU-process CPU; shrinking the 2.2 MB per-frame vertex buffer orphan saved 0.3 (noise). Draw-call batching and buffer tuning are not worth their exactness risk.
- Deferring the per-allocation `getError` to the end of a prewarm batch saved nothing: the 35 ms in a cold `selectWorld` is the wait for the uploads themselves.
- Cold costs, unchanged: `selectWorld` into a never-prepared sector 100 ms (hull rasterization ≈ 48 ms, upload wait ≈ 35 ms); `tyran.launch` into one 230–330 ms (adds ≈ 80 ms of terrain rows). The hangar prepares the next sector in idle time.
- `gpu-recovery-browser-check.mjs` failed before these changes on two stale assumptions (crowd braking slows the scroll; pooled strips are reused objects). It now passes, with its thresholds unchanged.

### 2026-10-23: entering a sector

Chrome 156 headless on an M1 Max (ANGLE Metal), 1440 × 900 at device pixel ratio 1, with other work running (load average 4–10). `tests/sector-entry-check.mjs`, three interleaved runs of each build (before = `1e3d358b`, the commit preceding this entry), medians of the per-run worst values and counts. A task is a main-thread task from Chrome's trace (wall time; thread time in brackets where it differs); a frame interval is the gap between two `requestAnimationFrame` callbacks. "Click handler" is the synchronous cost of the call; "ready" is the time until the world's preparation queue ran dry.

| Step | Build | Click handler | Ready | Worst task | Tasks > 16 / > 50 ms | Worst frame | Frames > 25 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Title screen: choose a sector (10) | before | 96 ms | 322 ms | 128 ms (106) | 20 / 10 | 133 ms | 10 |
| | after | 8.7 ms | 268 ms | 13.9 ms | 0 / 0 | 16.8 ms | 0 |
| Shop prepares the next sector (9) | before | – | 828 ms | 67 ms (46) | 17 / 9 | 50 ms | 9 |
| | after | – | 245 ms | 11.4 ms | 0 / 0 | 16.8 ms | 0 |
| Shop: Next (9) | before | 17.5 ms | 18 ms | 17.8 ms | 2 / 0 | 16.8 ms | 0 |
| | after | 2.4 ms | 2 ms | 4.1 ms | 0 / 0 | 16.8 ms | 0 |
| Practice after the preview settled (10) | before | 9.8 ms | 10 ms | 10.2 ms | 0 / 0 | 16.8 ms | 0 |
| | after | 8.0 ms | 8 ms | 8.4 ms | 0 / 0 | 16.8 ms | 0 |
| Cold `tyran.launch` (11) | before | 240 ms | 240 ms | 240 ms (203) | 11 / 11 | 233 ms | 11 |
| | after | 199 ms | 199 ms | 199 ms (188) | 11 / 11 | 183 ms | 11 |
| 4× CPU throttle, choose a sector (4) | before | 285 ms | 1057 ms | 461 ms | 19 / 4 | 483 ms | 11 |
| | after | 27 ms | 964 ms | 28 ms | 20 / 0 | 50 ms | 5 |
| 4× CPU throttle, shop prepares (4) | before | – | 2541 ms | 238 ms | 23 / 8 | 233 ms | 9 |
| | after | – | 955 ms | 28 ms | 13 / 0 | 33 ms | 1 |
| 4× CPU throttle, Next (4) | before | 37 ms | 37 ms | 38 ms | 4 / 0 | 33 ms | 2 |
| | after | 9 ms | 9 ms | 11 ms | 0 / 0 | 16.8 ms | 0 |

The first flight frame is unchanged: the digests of the first frame of all twelve sectors entered cold, ten entered after previewing them and nine launched from the shop (31 frames; `tests/first-frame-check.mjs` compares them) are identical before and after. A Next pressed 0.7 s after the shop opens costs 6 ms instead of 14 ms. Flight is unchanged too: `frame-cost-check` (12 s, sector 7) gives 1.25 / 1.31 → 1.38 / 1.19 ms of script per frame in the js pass and 1.27 / 1.42 → 1.36 / 1.20 ms in the gpu pass (two rounds, before → after, within the run-to-run spread), with no strips built on demand.

- What the hitches were. A sector's artwork is about 470 small jobs and 145–195 ms of main-thread time (median job 0.8–1.9 ms, 90th percentile 2.4 ms, longest 9 ms); the amount of artwork is the same, what changed is when it is made and in what pieces. `selectWorld` made the whole fleet and uploaded it inside the click (60–105 ms, median 81, now 2.4–14 ms, median 4.8), including a `setWorld` whose median 7.5 ms was mostly the biome-independent flame sheet (now 1.7 ms). The first terrain strip step painted all 24 terrain materials inline (40–245 ms), and the shop did 55–80 ms in one idle callback, then 25–35 ms more.
- How it is scheduled now. Everything is a job on the world's warm queue. `warmFleet` queues each hull's silhouettes, livery and lights (the boss hull alone was a 12 ms job and is now three, none over 7 ms), then the effect artwork. Terrain materials and masks, the sector's fixtures and its atmosphere sprites lead the queue, ahead of the strip steps, so a step never builds them inline and the first preview frame allocates no textures. `prepareReady` runs the queue in slices of about 6 ms that yield between slices; the shop uses it instead of one idle callback. `launch` stays synchronous and drains whatever is left before the first flight frame, so the preload and recovery checks still hold.
- The part that was not CPU. A texture's allocation check (`getError`) is a round trip that waits for every upload before it, and the uploads wait for the GPU to rasterize the canvases they copy: a handful of sprites made tasks of 29–44 ms with 0.4–1.3 ms of thread time. Jobs now count their allocations and the frame loop checks them once a fence has signalled, which costs nothing. The 90 uploads of a sector cost the main thread 3 ms in all. With the jobs already queued, deferring the checks cut the busy time of the title-screen step from a median of 287 to 237 ms (four sectors), the shop's worst task from 22 to 12 ms and a cold launch from 237 to 184 ms. (The earlier attempt to defer `getError` to the end of a prewarm batch only moved the wait; a fence lets the driver work meanwhile.) Uploads inside a frame, on request, at a restore and at launch are still checked at once.
- Not changed. `tyran.launch` into a sector that is not prepared still does the whole preparation inside the call (about 200 ms): launch is synchronous and complete, which the preload and recovery checks pin. So do New campaign pressed while another sector is on show, Continue, and a Practice or Next pressed within about a quarter second of choosing the sector or opening the shop: they pay what is left, while the fully prepared case costs 2–8 ms. The shop cannot start earlier, during the bonus-stage fade: the renderer holds one sector at a time, and building the next fleet there would evict ship sprites that may still be on screen.
- Measured and left alone. Priming the renderer's blend states with a hand-made frame halved a 35–40 ms main-thread wait that a traced scratch harness showed on the first sector change after a page load (thread time under 1 ms, seldom a late frame, absent after a warm-up step in `sector-entry-check`); it was not kept.
- Checks. All pure-Node checks pass, with the new `gpu-deferred-check.mjs`, and so do `browser-check`, `preload-browser-check`, `gpu-recovery-browser-check` and `gpu-memory-check`. In a full run of the 63 browser checks (all but the two long benchmarks and the measurement) 55 passed. Seven fail in this environment on the base commit too, with the same assertions: `bonus-outro-browser-check`, `ground-combat-browser-check`, `living-scenery-check`, `loading-browser-check`, `opaque-ground-check`, `scenery-memory-check` and `timing-check`. The eighth, `browser-check`, fails about one run in five on either build at its `#announcement` assertion, because the first frame after Next can already show the extra-ship notice that the cycle bonus grants (4 of 24 rounds before, 5 of 24 after).
