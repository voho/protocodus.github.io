// Run with: node tests/audio-check.mjs
// Exercise the production audio graph and scheduling; the browser companion
// renders that graph through OfflineAudioContext to check the actual waveform.
import assert from 'node:assert/strict';
import { createAudio } from '../js/audio.js';
import { RIDER } from '../js/config.js';

let clock = 100;
let context;
let nextTimer = 0;
const timers = new Map();
const saved = new Map();
globalThis.performance = { now: () => clock };
globalThis.localStorage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
globalThis.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.requestAnimationFrame = () => {};

class Param {
  value = 0;
  events = [];
  setTargetAtTime(value, time, response) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time) && response > 0);
    this.value = value;
    this.events.push({ value, time, response });
  }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}

class Node {
  connections = [];
  connect(node) { this.connections.push(node); return node; }
}

class TestContext {
  sampleRate = 44100;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  sources = [];
  filters = [];
  gains = [];
  panners = [];
  oscillators = [];
  constructor() { context = this; }
  createGain() {
    const node = Object.assign(new Node(), { gain: new Param() });
    this.gains.push(node); return node;
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), Object.fromEntries(
      ['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, new Param()])));
  }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: channel => data[channel] };
  }
  createBufferSource() {
    const node = Object.assign(new Node(), { playbackRate: new Param(), start() {}, stop() {} });
    this.sources.push(node); return node;
  }
  createBiquadFilter() {
    const node = Object.assign(new Node(), { frequency: new Param(), Q: new Param() });
    this.filters.push(node); return node;
  }
  createStereoPanner() {
    const node = Object.assign(new Node(), { pan: new Param() });
    this.panners.push(node); return node;
  }
  createOscillator() {
    const node = Object.assign(new Node(), { frequency: new Param(), start() {}, stop() {} });
    this.oscillators.push(node); return node;
  }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
}

globalThis.window = { AudioContext: TestContext, addEventListener() {}, removeEventListener() {} };

const audio = createAudio();
audio.start();
assert.equal(context.sources.length, 6, 'six continuous voices');
assert.equal(context.panners.length, 1, 'one shared snow panner');
assert.equal(context.gains[4].connections[0], context.panners[0], 'edge is spatial');
assert.equal(context.gains[5].connections[0], context.panners[0], 'wash shares the same panner');
for (const index of [1, 2, 3, 6]) {
  assert.equal(context.gains[index].connections[0], context.gains[0], 'wind, rumble and body remain central');
}

const snowGains = () => context.gains.slice(3, 7).map(node => node.gain.value);
const target = (speed, grounded = true, lean = 0, surface = null) => {
  clock += 40;
  audio.ambience(speed, 7, grounded, 0, 0.8, 0, surface, 0, lean);
};
target(30, true, -RIDER.lean);
assert.equal(context.panners[0].pan.value, 0.38, 'physical right carve places the edge on the right');
target(30, true, RIDER.lean);
assert.equal(context.panners[0].pan.value, -0.38, 'left carve places the edge on the left');
target(30, true, -RIDER.lean * 100);
assert.equal(context.panners[0].pan.value, 0.38, 'pan stays bounded');

// The established speed range has the same filter targets as before.
target(21);
assert.equal(context.filters[0].frequency.value, 260 + 0.25 * 1500);
assert.equal(context.filters[1].frequency.value, 950 + ((0.5 - 0.45) / 0.55) * 1750);
target(42);
const at42 = context.filters.map(node => node.frequency.value);
const gains42 = context.gains.slice(1).map(node => node.gain.value);
target(84);
const at84 = context.filters.map(node => node.frequency.value);
assert.equal(at84[0] - at42[0], 450, 'wind keeps brightening beyond the old ceiling');
assert.equal(at84[1] - at42[1], 750, 'whistle distinguishes flow speed');
assert.equal(at84[3] - at42[3], 400, 'loaded edge also gains high-speed timbre');
assert.deepEqual(context.gains.slice(1).map(node => node.gain.value), gains42,
  'extra speed adds no loudness');
target(1e9);
for (const [index, bound] of [[0, 900], [1, 1500], [2, 70], [3, 800]]) {
  assert.ok(context.filters[index].frequency.value > at84[index]);
  assert.ok(context.filters[index].frequency.value < at42[index] + bound,
    'extreme speed stays within the authored filter range');
}

// Takeoff arrives inside the ordinary control throttle. It still retires all
// four snow voices immediately; the wind remains and airborne lean is ignored.
clock += 1;
audio.ambience(30, 7, false, 0, 0.8, 0, null, 0, RIDER.lean);
assert.deepEqual(snowGains(), [0, 0, 0, 0]);
assert.equal(Math.abs(context.panners[0].pan.value), 0);
assert.ok(context.gains[1].gain.value > 0, 'air movement retains wind');
assert.equal(context.gains[3].gain.events.at(-1).response, 0.025, 'snow leaves promptly');
const writes = context.filters[0].frequency.events.length;
clock += 1;
audio.ambience(35, 0, false, 0);
assert.equal(context.filters[0].frequency.events.length, writes, 'steady-state controls retain the throttle');
clock += 1;
audio.ambience(30, 7, true, 0, 0.8);
assert.ok(snowGains()[0] > 0, 'touchdown also bypasses the throttle');

target(0, true, RIDER.lean, { rock: 1, ice: 0, powder: 0 });
assert.deepEqual(snowGains(), [0, 0, 0, 0], 'a stationary board does not scrape or rumble');
assert.equal(Math.abs(context.panners[0].pan.value), 0, 'stationary lean cannot move the sound');
audio.toggleMute();
target(84, true, -RIDER.lean);
assert.equal(context.gains[0].gain.value, 0);
assert.ok(context.gains[3].gain.value > 0, 'muted voices still track the current ride');
audio.toggleMute();

const pausedWrites = context.filters[0].frequency.events.length;
audio.quiet();
target(120, false);
audio.land(10);
assert.equal(context.filters[0].frequency.events.length, pausedWrites);
assert.equal(context.sources.length, 6, 'pause never queues stale one-shots');
assert.equal(context.oscillators.length, 0);
for (const timer of timers.values()) timer();
await Promise.resolve();
assert.equal(context.state, 'suspended');
audio.start();
assert.equal(context.state, 'running');
audio.ambience(30, 0, true, 0);
assert.ok(context.gains[3].gain.value > 0, 'resume immediately repopulates the ride mix');
assert.equal(context.sources.length, 6, 'resume reuses the graph');

// Older browsers keep all six voices when the optional panner is missing or
// refuses creation. No per-update nodes are needed in either path.
for (const panner of [undefined, () => { throw new Error('unsupported'); }]) {
  window.AudioContext = class extends TestContext {
    createStereoPanner = panner;
  };
  const mono = createAudio();
  mono.start();
  for (let i = 0; i < 100; i++) {
    clock += 40;
    mono.ambience(20 + i, 3, true, 0, 0.5, 0, null, 0, -RIDER.lean);
  }
  assert.equal(context.sources.length, 6);
  assert.equal(context.panners.length, 0);
  assert.ok(context.gains[4].gain.value > 0, 'mono fallback keeps the carve');
}

console.log('Audio checks passed: directional grounded edges, bounded flow timbre, immediate contact transitions, stationary silence, six-voice budget, mono fallback, mute and pause/resume.');
