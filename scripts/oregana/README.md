# Oregana browser DSP build

Both renderers use the C++17 engine revision pinned in `revision.txt`. The
JavaScript module uses the original scalar pipe kernels. Its counterpart in
`fun/oregana/dsp/organ-simd.wasm` uses the original four-pipe SIMD kernels.
Both run the same pipe models, regulation, wind, action, nave, controls and
sample-rate conversion. They expose the same stereo render and note interface.

To regenerate the renderers and control metadata, use Debian 13 with Clang/LLD
19.1.7, WASI libc, libc++ for wasm32-wasi and Binaryen 120. Pass the path to
a separately provided Oregana checkout containing the pinned revision.

```sh
apt install clang-19 lld-19 wasi-libc libc++-19-dev-wasm32 libclang-rt-19-dev-wasm32 binaryen g++ python3
scripts/oregana/build-dsp.sh /path/to/oregana-checkout
node tests/oregana/parity.mjs /path/to/oregana-checkout
```

The build takes a clean snapshot of that revision. `division-keys.patch`
extends the host input router so the on-screen manuals and pedalboard can
play alongside the routed keyboard. The final holder of each division's key
releases its pallet. `stereo-output.patch` skips empty row-delay buffers and
work on the separate division outputs and meters that the web host does not
connect. The main stereo mix keeps its original summation order.

Clang disables floating-point contraction for both builds. For the JavaScript
module, `scalar.h` selects the original single-pipe kernels. Binaryen emits
typed-array operations and explicit float rounding. The packager identifies
the flue and reed loops by content hash and annotates their typed-array reads
for browsers with asm.js acceleration. Each loop also runs as ordinary
JavaScript. To test that path on a Node version offering the flag, run
`node --no-validate-asm tests/oregana/parity.mjs /path/to/oregana-checkout`.
