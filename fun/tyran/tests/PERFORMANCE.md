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
