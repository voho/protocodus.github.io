#!/usr/bin/env bash
set -euo pipefail
origin=$(pwd)
mkdir -p results
sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT
native="$sandbox/keyra"
git init -q "$native"
read -r revision < scripts/keyra/revision.txt
git -C "$native" fetch -q --depth=1 https://github.com/protocodus/virtual-instrument-keyra.git "$revision"
git -C "$native" checkout -q --detach FETCH_HEAD
test "$(git -C "$native" rev-parse HEAD)" = "$revision"
wasm2js --version
clang++-19 --version
node --version
# Run exactly the published score and warmup but omit the second, unaffected renderer.
sed "s/\['JavaScript', 'SIMD'\]/['JavaScript']/" tests/keyra/benchmark.mjs > tests/keyra/trial-score.mjs

compile_scalar() {
  local stem=$1
  shift
  clang++-19 --target=wasm32-wasi --sysroot=/usr -mexec-model=reactor -std=c++17 -fno-exceptions -fno-rtti -ffp-contract=off \
    -Wl,--initial-memory=67108864 -Wl,--max-memory=67108864 -Wl,-z,stack-size=2097152 \
    -O2 -DKEYRA_FORCE_SCALAR -fno-unroll-loops -fno-vectorize -fno-slp-vectorize "$@" \
    -I"$native/Source/DSP" "$native/Source/DSP/PianoModel.cpp" "$native/Source/DSP/KeyraEngine.cpp" \
    scripts/keyra/bridge.cpp -o "$sandbox/$stem.wasm"
}

measure() {
  local name=$1
  cp fun/keyra/dsp/core.mjs "results/$name.mjs"
  sha256sum "results/$name.mjs"
  if ! node tests/keyra/trial-score.mjs | tee "results/$name.time"; then
    echo "Timing failed for $name" | tee "results/$name.error"
    return
  fi
  if ! node tests/keyra/parity.mjs "$native" >"results/$name.parity" 2>&1; then
    echo "PCM parity failed for $name" | tee "results/$name.error"
  fi
  cat "results/$name.parity"
}

run_candidate() {
  local stem=$1 level=$2 name="$1-$2"
  echo "::group::$name"
  if wasm2js "$sandbox/$stem.wasm" "-$level" -o "$sandbox/$name.js" && \
     python3 scripts/keyra/package-dsp.py "$sandbox/$name.js" fun/keyra/dsp/core.mjs; then
    measure "$name"
  else
    echo "$name could not be packaged" | tee "results/$name.error"
  fi
  echo "::endgroup::"
}

echo "::group::shipped"
measure shipped
echo "::endgroup::"
# The compiler can legalize the native four-float vector type to scalar
# instructions without WebAssembly SIMD. No model source is edited.
compile_scalar veclanes -UKEYRA_FORCE_SCALAR -mno-simd128
run_candidate veclanes O2
compile_scalar vecsize -Oz -UKEYRA_FORCE_SCALAR -mno-simd128
run_candidate vecsize O2
compile_scalar noforcedunroll -mllvm -pragma-unroll-threshold=1 -mllvm -unroll-full-max-count=1
run_candidate noforcedunroll O2
echo 'Same-worker report:'
for report in results/*.time; do echo "$report"; grep 'callbacks:' "$report"; done
