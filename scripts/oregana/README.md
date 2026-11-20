# Oregana JavaScript build

The browser runs the checked-in ES module in `fun/oregana/dsp/core.mjs`. Its
pipe models, tuning tables, winding, action, church, stereo output, performance
controllers and sample-rate conversion are translated from
[Protocodus Oregana](https://github.com/protocodus/virtual-instrument-oregana).
`revision.txt` identifies the exact source revision.

To regenerate the JavaScript and the controls and registrations for the panel,
use Debian 13 with Clang/LLD 19.1.7, WASI libc, libc++ for wasm32-wasi and
Binaryen 120. Install the toolchain and run from the website repository:

```sh
apt install clang-19 lld-19 wasi-libc libc++-19-dev-wasm32 libclang-rt-19-dev-wasm32 binaryen g++ python3
git clone https://github.com/protocodus/virtual-instrument-oregana.git ../virtual-instrument-oregana
scripts/oregana/build-dsp.sh ../virtual-instrument-oregana
node tests/oregana/parity.mjs ../virtual-instrument-oregana
```

Clang compiles the unmodified C++17 engine and host instrument into a temporary
intermediate. Binaryen translates that into JavaScript with typed arrays,
integer operations and explicit float rounding. `scalar.h` selects Oregana's
single-pipe implementation because JavaScript has scalar arithmetic. The build
keeps loops small enough for browser JIT compilation and disables contraction
in agreement with the native build. The packager identifies the flue and reed
render loops by their content hashes and annotates their typed-array reads for
asm.js acceleration. Each loop also runs as standard JavaScript. The
AudioWorklet reuses a fixed heap and stereo output buffers. Each instance has
its own organ and memory.

To check the ordinary JavaScript path with V8 asm.js acceleration disabled,
run `node --no-validate-asm tests/oregana/parity.mjs ../virtual-instrument-oregana`.
