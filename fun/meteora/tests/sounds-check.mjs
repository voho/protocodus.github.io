// Run with: node tests/sounds-check.mjs
// The sound bank is plain arithmetic, so it renders here exactly as in the
// browser: every sound must be audible, clean at both ends and unclipped,
// and the mix's arithmetic must do what the ear expects of it.
import { test, run, assert, near } from './harness.mjs';
import {
  RATE, SOUND_NAMES, doppler, enginePitch, lockBeepInterval, loops, muffle, soundBank, synthesize, synthesizeBank,
} from '../js/sounds.js';

const bank = soundBank();
// harness.finite spells out the whole array in its message; these are a
// million samples long.
const finite = (a, label) => assert.ok(a.every(Number.isFinite), `${label} has a non-finite sample`);
const rms = (a, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
// Share of the signal's energy below `hz`, from a one-pole lowpass: a crude
// but steady measure of how deep a sound is.
const lowShare = (a, hz) => {
  const k = 1 - Math.exp(-2 * Math.PI * hz / RATE);
  let y = 0, low = 0, all = 0;
  for (const x of a) { y += (x - y) * k; low += y * y; all += x * x; }
  return low / all;
};

test('every sound renders, audible and finite, and peaks below clipping', () => {
  assert.deepEqual(Object.keys(bank).sort(), [...SOUND_NAMES].sort());
  for (const [name, takes] of Object.entries(bank)) {
    assert.ok(takes.length >= 1, name);
    for (const a of takes) {
      finite(a, name);
      const peak = a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      assert.ok(peak > 0.5 && peak <= 0.9 + 1e-6, `${name} peak ${peak}`);
      assert.ok(rms(a) > 0.05, `${name} rms ${rms(a)}`);
    }
  }
});

test('no sound starts or stops on a click', () => {
  for (const [name, takes] of Object.entries(bank)) {
    for (const a of takes) {
      assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[a.length - 1]) < 1e-6, `${name} ends at zero`);
      // The last 5 ms carry almost nothing: the sound has died, not been cut.
      assert.ok(rms(a, a.length - RATE * 0.005) < 0.03, `${name} tail ${rms(a, a.length - RATE * 0.005)}`);
    }
  }
});

test('the takes of one sound differ, and a seed always gives the same take', () => {
  const [a, b] = bank.cannon;
  assert.ok(a.some((x, i) => Math.abs(x - b[i]) > 0.05), 'two cannon takes are not identical');
  const again = synthesize('hitHull', 5), once = synthesize('hitHull', 5);
  assert.deepEqual(again, once);
});

test('the bank renders in slices, to the same result', () => {
  const sliced = {};
  const job = synthesizeBank((name, data) => (sliced[name] ??= []).push(data));
  let steps = 0;
  while (!job.next().done) steps++;
  assert.ok(steps > 100, `${steps} slices`);
  for (const name of SOUND_NAMES) assert.deepEqual(sliced[name], bank[name], name);
});

test('blasts are deep, shield hits and cannon fire are bright', () => {
  const deep = lowShare(bank.shipExplosion[0], 200);
  for (const name of ['cannon', 'hitShield', 'enemyCannon']) {
    assert.ok(lowShare(bank[name][0], 200) < deep, `${name} is brighter than an explosion`);
  }
  assert.ok(lowShare(bank.playerExplosion[0], 200) >= lowShare(bank.blast[0], 200) * 0.9, 'our own death is no lighter than a missile');
  // Longest of all: the fighter's death outlasts an interceptor's, which outlasts a missile.
  assert.ok(bank.playerExplosion[0].length > bank.shipExplosion[0].length && bank.shipExplosion[0].length > bank.blast[0].length);
});

test('loops meet themselves at the seam', () => {
  const { brown, crackle, noise } = loops();
  for (const [name, a] of Object.entries({ brown, crackle })) {
    assert.ok(Math.abs(a[0] - a[a.length - 1]) < 0.02, `${name} seam`);
    finite(a, name);
  }
  assert.ok(rms(noise) > 0.3 && rms(brown) > 0.1, 'loops are not silent');
});

test('engine pitch rises with speed, smoothly and without steps, past the top speed too', () => {
  let prev = enginePitch(0);
  assert.ok(prev > 25 && prev < 40, `idle ${prev} Hz`);
  for (let v = 0.25; v <= 600; v += 0.25) {
    const f = enginePitch(v);
    assert.ok(f > prev, `strictly rising at ${v} m/s`);
    assert.ok(f - prev < 0.05, `no jump at ${v} m/s`);
    prev = f;
  }
  assert.ok(enginePitch(180) / enginePitch(0) > 1.5, 'cruise is well above idle');
  assert.ok(enginePitch(320) > enginePitch(180) && enginePitch(600) > enginePitch(320), 'keeps rising');
  assert.equal(enginePitch(-50), enginePitch(0));
});

test('doppler: approach raises the pitch, recession lowers it, a crossing leaves it', () => {
  const up = doppler(100, 0, 0, -400, 0, 0), down = doppler(100, 0, 0, 400, 0, 0);
  assert.ok(up > 1.2 && down < 0.85, `${up} / ${down}`);
  near(doppler(100, 0, 0, 0, 300, 0), 1, 1e-9);
  near(doppler(0, 0, 0, 500, 0, 0), 1, 1e-9);
  // However fast the pass, the bend stays within an octave each way.
  assert.ok(doppler(1, 0, 0, -1e6, 0, 0) <= 2 && doppler(1, 0, 0, 1e6, 0, 0) >= 0.5);
});

test('distance dulls, and the lock beeps quicken as the lock builds', () => {
  let prev = Infinity;
  for (const d of [0, 50, 200, 500, 1000, 2000, 5000]) { const f = muffle(d); assert.ok(f < prev && f >= 400); prev = f; }
  assert.ok(muffle(10) > 15000, 'close by, nothing is dulled');
  assert.ok(lockBeepInterval(0) > lockBeepInterval(0.5) && lockBeepInterval(0.5) > lockBeepInterval(1));
  assert.equal(lockBeepInterval(2), lockBeepInterval(1));
});

await run();
