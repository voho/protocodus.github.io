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
    -I"$native/Source/DSP" "$model_source" "$native/Source/DSP/KeyraEngine.cpp" \
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
  if wasm2js "$sandbox/$stem.wasm" "-$level" --one-caller-inline-max-function-size=24 --flexible-inline-max-function-size=16 --always-inline-max-function-size=4 -o "$sandbox/$name.js" && \
     python3 scripts/keyra/package-dsp.py "$sandbox/$name.js" fun/keyra/dsp/core.mjs; then
    measure "$name"
  else
    echo "$name could not be packaged" | tee "results/$name.error"
  fi
  echo "::endgroup::"
}

# The compiler-only trials keep all source files byte-for-byte unchanged.
# This separate experiment tests a single ABI boundary around unchanged model loops.
# Only a temporary compiler input gets the annotation; parity always builds from
# the unmodified pinned C++.
python3 - "$native/Source/DSP/PianoModel.cpp" "$sandbox" <<'PY'
from pathlib import Path
import sys
origin, work = Path(sys.argv[1]), Path(sys.argv[2])
src = origin.read_text()
prefix,chunk=src.split("  void renderChunk(float* left,float* right,float* const* mics,int frames) noexcept {")
def wrap(block, first, after, name):
    start=block.index(first)
    end=block.index(after,start)
    return block[:start] + "    auto "+name+"=[&]() __attribute__((noinline)) {\n" + block[start:end] + "    }; "+name+"();\n" + block[end:]
one=wrap(chunk,"    for(int i=0;i<keyCount;++i){\n      const int o=i*bankSlots;","    boardPressure(mixRadiation,0,micCount","playBank")
head=prefix+"  void renderChunk(float* left,float* right,float* const* mics,int frames) noexcept {"
(work/"bank.cpp").write_text(head+one)
two=wrap(one,"    for(int i=0;i<keyCount;++i){Voice& v=voices[i];","    if(frameRings){std::memset(rim,0,sizeof(rim));","playVoices")
(work/"twostage.cpp").write_text(head+two)
PY
model_source="$sandbox/twostage.cpp"
compile_scalar stagecapped
run_candidate stagecapped O2
model_source="$sandbox/bank.cpp"
compile_scalar bankcapped
run_candidate bankcapped O2
model_source="$native/Source/DSP/PianoModel.cpp"
compile_scalar plaincapped
run_candidate plaincapped O2
git -c safe.directory="$(pwd)" show HEAD:fun/keyra/dsp/core.mjs > fun/keyra/dsp/core.mjs
measure shipped
