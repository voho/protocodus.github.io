// node tests/oregana/parity.mjs [path/to/virtual-instrument-oregana]
// Requires a C++17 compiler; only the test uses the native checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controls } from '../../fun/oregana/metadata.js';
import { OreganaDSP } from '../../fun/oregana/dsp/organ.mjs';

const tests = [
  { name: 'Principal, half-drawn stop and repeated note', rate: 48000, blockSize: 251, score: [
    ['noteOn', 60, 37], ['render', 8191], ['noteOn', 67, 110],
    ['setControl', 'hw_rohrfloete_8', 0.53], ['render', 17717],
    ['setBend', 0.35], ['noteOff', 60, 115], ['render', 391], ['noteOn', 60, 40],
    ['render', 4361], ['noteOff', 60, 75], ['render', 4800],
    ['noteOff', 67, 24], ['render', 28709],
  ] },
  { name: 'Tremulant reed, couplers and room tail', rate: 44100, score: [
    ['setPreset', 8], ['noteOn', 48, 54], ['noteOn', 64, 104], ['render', 25904],
    ['setControllers', 0.17, 0.43], ['setControl', 'seat', -0.41], ['render', 11243],
    ['noteOff', 64, 100], ['noteOff', 48, 80], ['render', 27006],
  ] },
  { name: 'Tutti chord and mixtures', rate: 48000, score: [
    ['setPreset', 16], ['noteOn', 48, 80], ['noteOn', 60, 86],
    ['noteOn', 64, 75], ['noteOn', 67, 102], ['render', 24101],
    ['render', 48000], ['allKeysUp'], ['render', 19499],
  ] },
  { name: 'Swell expression, split pedal and high-rate conversion', rate: 96000, score: [
    ['setPreset', 15], ['setControl', 'keyboard', 2], ['setControl', 'pedal_keys', 2],
    ['noteOn', 43, 52], ['noteOn', 70, 71], ['render', 34001],
    ['setControllers', 0, 0.21], ['render', 26513],
    ['allSoundOff'], ['render', 32004],
  ] },
];

function runScore(oraclePath, { name, rate, blockSize = 128, score }) {
  const reference = execFileSync(oraclePath, [String(rate)], {
    input: score.map((event) => event.join(' ')).join('\n'),
    maxBuffer: 4 * 1024 * 1024,
  });
  const native = new Float32Array(reference.buffer, reference.byteOffset, reference.byteLength / 4);
  const organ = new OreganaDSP(rate);
  let offset = 0;
  let different = 0;
  let maxError = 0;
  let worstRelative = 0;
  let steadyTuttiMs;
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);

  for (const [command, ...args] of score) {
    if (command === 'setControl') {
      const index = controls.findIndex((entry) => entry.id === args[0]);
      assert.ok(index >= 0, 'Missing native control ' + args[0]);
      organ.setControl(index, args[1]);
    } else if (command === 'render') {
      const frames = args[0];
      const start = performance.now();
      let errorPower = 0;
      let signalPower = 0;
      let stereoPower = 0;
      for (let done = 0; done < frames; done += blockSize) {
        const count = Math.min(blockSize, frames - done);
        organ.render(count === blockSize ? left : left.subarray(0, count),
                     count === blockSize ? right : right.subarray(0, count));
        for (let i = 0; i < count; i++) {
          const l = native[offset++];
          const r = native[offset++];
          if (!Object.is(l, left[i])) different++;
          if (!Object.is(r, right[i])) different++;
          const dl = l - left[i];
          const dr = r - right[i];
          maxError = Math.max(maxError, Math.abs(dl), Math.abs(dr));
          signalPower += l * l + r * r;
          errorPower += dl * dl + dr * dr;
          stereoPower += (l - r) ** 2;
        }
      }
      if (name.startsWith('Tutti') && frames === rate) steadyTuttiMs = performance.now() - start;
      // Compare each section individually, so a loud chord cannot hide a lost tail.
      const relativeError = Math.sqrt(errorPower / signalPower);
      assert.ok(signalPower / frames > 1e-10 && stereoPower > 0, name + ': silent/mono reference');
      assert.ok(Number.isFinite(relativeError), name + ': invalid output');
      worstRelative = Math.max(worstRelative, relativeError);
    } else {
      organ[command](...args);
    }
  }
  assert.equal(offset, native.length, name + ': sample count');
  assert.equal(different, 0, name + ': ' + different + ' differing samples, peak error '
    + maxError + ', worst relative RMS error ' + worstRelative);
  console.log(name + ' @ ' + rate + ' Hz: all ' + native.length + ' samples match the native render.');
  if (steadyTuttiMs !== undefined) {
    console.log('One second of held four-note Tutti in 128-frame blocks: ' + steadyTuttiMs.toFixed(0) + ' ms');
  }
}

const checkout = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../../../virtual-instrument-oregana', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'oregana-reference-'));
try {
  const revision = readFileSync(new URL('../../scripts/oregana/revision.txt', import.meta.url), 'utf8').trim();
  const archive = execFileSync('git', ['-C', checkout, 'archive', revision, 'Source/DSP']);
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  const oracle = join(temp, 'reference');
  execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', '-ffp-contract=off',
    '-I', join(temp, 'Source'), fileURLToPath(new URL('./reference.cpp', import.meta.url)),
    join(temp, 'Source/DSP/OreganaEngine.cpp'), '-o', oracle], { stdio: 'inherit' });
  for (const test of tests) runScore(oracle, test);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
