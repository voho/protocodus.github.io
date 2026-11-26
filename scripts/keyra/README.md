# Keyra browser DSP

The three renderers compile the C++17 physical piano model and action from the revision in `revision.txt`. They share the instrument's factory bank, microphone mix, pedal logic and output stage. The SIMD WebAssembly worklet runs the native four-lane arithmetic. The scalar WebAssembly worklet uses the same compiled module that Binaryen translates to typed-array operations for the JavaScript worklet. The three builds share the runtime and acoustic notices in the DSP directory. Each instrument can render at the host's sample rate.

To rebuild, use Debian 13, Clang/LLD 19.1.7, WASI libc with libc++ for wasm32-wasi, Binaryen 120, a native C++17 compiler and Python 3. Pass the path to a separately supplied checkout containing the pinned revision.

```sh
bash scripts/keyra/build-dsp.sh /path/to/keyra-checkout
node tests/keyra/parity.mjs /path/to/keyra-checkout
```
