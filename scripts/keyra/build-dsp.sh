#!/usr/bin/env bash
# Build both browser renderers and the catalog from one pinned native tree.
set -euo pipefail
site=$(cd "$(dirname "$0")/../.." && pwd)
tools="$site/scripts/keyra"
target="$site/fun/keyra"
source_checkout=${1:?Pass the path to a Keyra checkout}
read -r revision < "$tools/revision.txt"
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
mkdir -p "$target/dsp"
reference=Experiments/Research/GrandPianoV2/reference
git -C "$source_checkout" archive "$revision" Source/DSP LICENSE THIRD_PARTY_NOTICES.md \
    "$reference/ATTRIBUTION.md" "$reference/upstream/LICENSE-CC-BY-3.0.txt" | tar -xC "$build"

compile() {
    local output=$1
    shift
    "${WASI_CXX:-clang++-19}" --target=wasm32-wasi --sysroot="${WASI_SYSROOT:-/usr}" \
        -mexec-model=reactor -std=c++17 -fno-exceptions -fno-rtti -ffp-contract=off \
        -Wl,--initial-memory=67108864 -Wl,--max-memory=67108864 -Wl,-z,stack-size=2097152 \
        -I"$build/Source/DSP" "$@" "$build/Source/DSP/PianoModel.cpp" \
        "$build/Source/DSP/KeyraEngine.cpp" "$tools/bridge.cpp" -o "$output"
}
compile "$build/scalar.wasm" -O2 -DKEYRA_FORCE_SCALAR -fno-unroll-loops -fno-vectorize -fno-slp-vectorize
wasm2js "$build/scalar.wasm" -O2 -o "$build/module.js"
python3 "$tools/package-dsp.py" "$build/module.js" "$target/dsp/core.mjs"
compile "$build/simd.wasm" -O3 -msimd128 -flto -Wl,--strip-all
install -m 644 "$build/simd.wasm" "$target/dsp/keyra-simd.wasm"
"${CXX:-c++}" -std=c++17 -I"$build/Source/DSP" "$tools/export-metadata.cpp" -o "$build/export"
"$build/export" > "$target/metadata.js"
cp "$build/LICENSE" "$target/dsp/LICENSE"
cp "$build/$reference/upstream/LICENSE-CC-BY-3.0.txt" "$target/dsp/SALAMANDER-CC-BY-3.0.txt"
cp "$build/$reference/ATTRIBUTION.md" "$target/dsp/SALAMANDER-ATTRIBUTION.md"
python3 "$tools/browser-notices.py" "$build/THIRD_PARTY_NOTICES.md" "$target/dsp/THIRD_PARTY_NOTICES.md"
