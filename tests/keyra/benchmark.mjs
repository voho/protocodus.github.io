// Run explicitly with node tests/keyra/benchmark.mjs on a built website checkout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';

const rate = 48000, frames = 128, deadline = frames / rate * 1000;
const chords = [[48, 55, 60, 64, 71], [45, 52, 57, 60, 67], [41, 53, 57, 60, 67], [43, 53, 59, 62, 67]];
const quantaPerChord = 96;
console.log(process.version, process.arch, cpus()[0]?.model, '128 frames / 48 kHz, callback budget ' + deadline.toFixed(3) + ' ms');

function play(piano, rounds) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const times = new Float64Array(rounds * chords.length * quantaPerChord);
  let peak = 0, index = 0;
  for (let round = 0; round < rounds; ++round) {
    for (const chord of chords) {
      for (let block = 0; block < quantaPerChord; ++block) {
        const start = performance.now();
        if (block === 0) for (const [i, note] of chord.entries()) piano.noteOn(note, 71 + 6 * i);
        if (block === 12) piano.controlChange(64, 102);
        if (block === 57) for (const note of chord) piano.noteOff(note);
        if (block === 89) piano.controlChange(64, 0);
        piano.render(left, right);
        times[index++] = performance.now() - start;
        for (let i = 0; i < frames; ++i) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
    }
  }
  assert.ok(peak > 0.003 && Number.isFinite(peak), 'Chord score produced no valid signal');
  return times;
}

for (const backend of ['JavaScript', 'SIMD', 'scalar WebAssembly']) {
  const load = performance.now();
  let create;
  if (backend === 'JavaScript') {
    const { KeyraDSP } = await import('../../fun/keyra/dsp/piano.mjs');
    create = () => new KeyraDSP(rate);
  } else {
    const { SimdDSP: WasmPiano } = await import('../../fun/keyra/dsp/simd.mjs');
    const name = backend === 'SIMD' ? 'keyra-simd.wasm' : 'keyra-scalar.wasm';
    const module = await WebAssembly.compile(readFileSync(new URL('../../fun/keyra/dsp/' + name, import.meta.url)));
    create = () => new WasmPiano(rate, module);
  }
  const loaded = performance.now();
  const piano = create();
  console.log(backend + ' module load/compile ' + (loaded - load).toFixed(1) + ' ms, cold construction ' +
    (performance.now() - loaded).toFixed(1) + ' ms');
  for (const [preset, name] of [[0, 'Concert Grand'], [7, 'Distant Hall']]) {
    piano.allSoundOff();
    piano.setPreset(preset);
    play(piano, 1); // One full progression warms the model and JIT.
    const times = play(piano, 2).sort();
    const total = times.reduce((sum, t) => sum + t, 0);
    const mean = total / times.length, p95 = times[Math.ceil(times.length * 0.95) - 1];
    const late = times.filter(t => t > deadline).length;
    console.log(backend + ' ' + name + ', ' + times.length + ' callbacks: mean ' + mean.toFixed(3) +
      ' ms, p95 ' + p95.toFixed(3) + ' ms, max ' + times.at(-1).toFixed(3) + ' ms, ' +
      late + ' over budget; ' + (deadline / mean).toFixed(2) + 'x real-time throughput');
  }
}
