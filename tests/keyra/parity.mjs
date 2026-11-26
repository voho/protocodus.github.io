// node tests/keyra/parity.mjs /path/to/pinned/virtual-instrument-keyra
// Feed the exact same timed events to both shipped engines and a native oracle.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyraDSP } from '../../fun/keyra/dsp/piano.mjs';
import { SimdDSP } from '../../fun/keyra/dsp/simd.mjs';

const tests = [
  { name: 'Concert, channel ownership, repeated strikes and damper', rate: 48000, block: 128, score: [
    ['noteOn', 36, 43, 1], ['noteOn', 60, 94, 2], ['render', 5093],
    ['controlChange', 64, 70, 2], ['noteOn', 60, 51, 2], ['noteOn', 60, 101, 1], ['render', 4091],
    ['noteOff', 60, 1], ['noteOff', 60, 2], ['noteOff', 36, 1], ['render', 3613],
    ['noteOff', 60, 2], ['render', 7231], ['controlChange', 64, 0, 2], ['render', 12637]
  ] },
  { name: 'Felt Nocturne, sostenuto capture and soft pedal', rate: 44100, block: 128, score: [
    ['setPreset', 5], ['noteOn', 48, 72, 3], ['noteOn', 55, 74, 3], ['render', 4577],
    ['controlChange', 66, 127, 3], ['noteOff', 48, 3], ['noteOff', 55, 3],
    ['controlChange', 67, 93, 3], ['noteOn', 72, 57, 3], ['render', 3769],
    ['noteOff', 72, 3], ['render', 5261], ['controlChange', 66, 0, 3], ['render', 10009]
  ] },
  { name: 'Distant Hall, microphones, tuning and modulation', rate: 96000, block: 128, score: [
    ['setControl', 'tuning', 442], ['setPreset', 7], ['setControl', 'micTube', 0.3],
    ['noteOn', 24, 91, 16], ['noteOn', 66, 68, 16], ['noteOn', 84, 104, 16], ['render', 11027],
    ['pitchBend', -0.5, 16], ['controlChange', 1, 25, 16], ['setControl', 'width', 0.5], ['render', 6163],
    ['allKeysUp'], ['render', 14153]
  ] },
  { name: 'Bar Piano, momentary pedal switches, panic and restart', rate: 48000, block: 73, score: [
    ['setPreset', 12], ['noteOn', 14, 127, 1], ['noteOn', 21, 100, 1], ['noteOn', 108, 62, 1],
    ['render', 6673], ['noteOff', 21, 1], ['noteOff', 108, 1], ['render', 4231],
    ['noteOff', 14, 1], ['allSoundOff'], ['render', 977], ['setPreset', 4],
    ['noteOn', 62, 87, 1], ['render', 5827], ['noteOff', 62, 1], ['render', 7117]
  ] }
];

function compare(piano, reference, test, renderer) {
  let index = 0, peakError = 0, worstRelative = 0, stereo = 0, peak = 0;
  const left = new Float32Array(test.block), right = new Float32Array(test.block);
  for (const [command, ...args] of test.score) {
    if (command !== 'render') {
      piano[command](...args);
      continue;
    }
    let errorPower = 0, signalPower = 0;
    const frames = args[0];
    for (let rendered = 0; rendered < frames; rendered += test.block) {
      const count = Math.min(test.block, frames - rendered);
      piano.render(left.subarray(0, count), right.subarray(0, count));
      for (let i = 0; i < count; ++i) {
        const l = reference[index++], r = reference[index++];
        const dl = left[i] - l, dr = right[i] - r;
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        peakError = Math.max(peakError, Math.abs(dl), Math.abs(dr));
        signalPower += l * l + r * r;
        errorPower += dl * dl + dr * dr;
        stereo += (l - r) ** 2;
      }
    }
    if (signalPower === 0) assert.equal(errorPower, 0, 'Native silence must be reproduced');
    else worstRelative = Math.max(worstRelative, Math.sqrt(errorPower / signalPower));
  }
  const label = renderer + ' ' + test.name + ' @ ' + test.rate;
  console.log(label + ': ' + index + ' samples, peak error ' + peakError + ', worst segment relative RMS ' + worstRelative);
  assert.equal(index, reference.length);
  assert.ok(peak > 0.003 && stereo > 0, label + ': silent/mono oracle');
  // Native libm and the WebAssembly runtime may round transcendental functions
  // differently. Check individual phrases and releases, including quiet tails.
  assert.ok(peakError < 0.0005 && worstRelative < 0.002, label + ': PCM exceeds agreement bounds');
}

const source = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../../../virtual-instrument-keyra', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'keyra-reference-'));
try {
  const oracle = join(temp, 'reference');
  execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', '-ffp-contract=off', '-I', join(source, 'Source'),
    fileURLToPath(new URL('./reference.cpp', import.meta.url)), join(source, 'Source/DSP/KeyraEngine.cpp'),
    join(source, 'Source/DSP/PianoModel.cpp'), '-o', oracle], { stdio: 'inherit' });
  const simd = await WebAssembly.compile(readFileSync(new URL('../../fun/keyra/dsp/keyra-simd.wasm', import.meta.url)));
  for (const test of tests) {
    const output = execFileSync(oracle, [String(test.rate), String(test.block)], {
      input: test.score.map(event => event.join(' ')).join('\n'), maxBuffer: 4 * 1024 * 1024
    });
    const native = new Float32Array(output.buffer, output.byteOffset, output.byteLength / 4);
    compare(new KeyraDSP(test.rate), native, test, 'JavaScript');
    compare(new SimdDSP(test.rate, simd), native, test, 'SIMD');
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
