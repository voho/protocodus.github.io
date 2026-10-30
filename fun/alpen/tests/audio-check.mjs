// Run with: node tests/audio-check.mjs
// Exercise the production audio graph and scheduling; the browser companion
// renders that graph through OfflineAudioContext to check the actual waveform.
import assert from 'node:assert/strict';
import { createAudio } from '../js/audio.js';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { Rider } from '../js/rider.js';
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
globalThis.setTimeout = (callback, delay) => {
  callback.delay = delay; timers.set(++nextTimer, callback); return nextTimer;
};
globalThis.clearTimeout = id => timers.delete(id);
globalThis.requestAnimationFrame = () => {};

class Param {
  value = 0;
  events = [];
  automation = [];
  setTargetAtTime(value, time, response) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time) && response > 0);
    this.value = value;
    this.events.push({ value, time, response });
  }
  record(kind, value, time) {
    this.value = value;
    this.events.push({ kind, value, time }); this.automation.push({ kind, value, time });
  }
  setValueAtTime(value, time) { this.record('set', value, time); }
  exponentialRampToValueAtTime(value, time) { this.record('exponential', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  at(time) {
    let previous = { time: 0, value: 0 };
    for (const event of this.automation) {
      if (time < event.time) {
        const t = (time - previous.time) / (event.time - previous.time);
        if (event.kind === 'linear') return previous.value + (event.value - previous.value) * t;
        if (event.kind === 'exponential') return previous.value * (event.value / previous.value) ** t;
        return previous.value;
      }
      previous = event;
    }
    return previous.value;
  }
  cancelScheduledValues(time) {
    this.events.push({ kind: 'cancel', time });
    this.automation = this.automation.filter(event => event.time < time);
  }
  cancelAndHoldAtTime(time) {
    const value = this.at(time);
    this.cancelScheduledValues(time); this.record('hold', value, time);
  }
}

class Node {
  connections = [];
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections.length = 0; }
}
class Source extends Node {
  starts = [];
  stops = [];
  ended = false;
  start(time = 0) { this.starts.push(time); }
  stop(time = 0) { this.stops.push(time); }
  finish() { this.ended = true; this.onended?.(); }
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
    const node = Object.assign(new Source(), { playbackRate: new Param() });
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
    const node = Object.assign(new Source(), { frequency: new Param() });
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

// The actual rider stays ungrounded through a fall, even when its body is
// sliding on snow. Feed the same body-contact signal main uses; ordinary
// board voices must remain silent until the rider gets up.
{
  const r = new Rider(THREE, { height: () => 0, canStall: () => false });
  r.pos.set(0, 3, 0); r.vel.set(0, -2, -20);
  r.state = 'air'; r.grounded = false; r.airTime = .8;
  let impacts = 0, airborne = 0, sliding = 0, rising = 0;
  r.on('impact', () => impacts++);
  assert.equal(r.strike(0, 1, 1), 'fall');
  const dt = 1 / 120;
  const input = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
  for (let i = 0; r.state !== 'ride' && i < 1200; i++) {
    r.step(dt, input);
    const tumbleSlide = r.state === 'fall' && !r.airborne ? r.speed : 0;
    clock += dt * 1000; context.currentTime += dt;
    audio.ambience(r.speed, r.slide, r.grounded, 0, r.carveLoad, tumbleSlide, null, r.chatter, r.roll);
    if (r.state === 'fall') {
      assert.equal(r.grounded, false, 'a sliding body is not a grounded snowboard');
      assert.deepEqual(snowGains().slice(0, 3), [0, 0, 0], 'tumbling never adds board rumble, edge or wash');
      if (r.airborne) {
        airborne++;
        assert.equal(snowGains()[3], 0, 'an airborne tumble has no continuous body scrape');
      } else if (r.speed > 0) {
        sliding++;
        assert(snowGains()[3] > 0, 'real moving body contact produces the missing scrape');
      }
    } else if (r.state === 'rise') {
      rising++;
      assert.equal(snowGains()[3], 0, 'getting up clears body drag');
      assert(snowGains()[0] > 0, 'the board mix returns during recovery');
    }
  }
  assert.equal(r.state, 'ride');
  assert(impacts > 0 && airborne > 0 && sliding > 0 && rising > 0,
    'the real trace includes ballistic tumbling, bounce impacts, sliding and recovery');
  assert.equal(context.sources.length, 6, 'body sliding reuses the existing six continuous voices');
}

const bodyTarget = (speed, bodySpeed, grounded = false, rock = 0, elapsed = 40) => {
  clock += elapsed;
  audio.ambience(speed, 7, grounded, 0, .8, bodySpeed,
    { rock, ice: 0, powder: 0 }, 0, RIDER.lean);
  return context.gains[6].gain.value;
};
bodyTarget(20, 0);
const contactWrites = context.gains[6].gain.events.length;
assert(bodyTarget(20, 20, false, 0, 1) > 0, 'body touchdown inside the throttle immediately starts scraping');
assert.equal(context.gains[6].gain.events.length, contactWrites + 1);
assert.deepEqual(snowGains().slice(0, 3), [0, 0, 0]);
assert.equal(Math.abs(context.panners[0].pan.value), 0, 'a fallen body remains central despite the old carve lean');
const bodyWrites = context.filters[0].frequency.events.length;
bodyTarget(21, 21, false, 0, 1);
assert.equal(context.filters[0].frequency.events.length, bodyWrites, 'unchanged body contact retains the 35 ms throttle');
assert.equal(bodyTarget(20, 0, false, 0, 1), 0, 'a body leaving the snow immediately retires its scrape');
assert.equal(context.gains[6].gain.events.at(-1).response, .025, 'airborne body scrape releases promptly');
assert(bodyTarget(20, 20, false, 0, 1) > 0, 'a later body contact can return inside the same throttle window');
const slowBody = bodyTarget(.3, .3), movingBody = bodyTarget(3, 3);
assert(slowBody > 0 && slowBody < movingBody * .05, 'body drag fades smoothly near a stop');
assert.equal(bodyTarget(0, 0), 0, 'a stopped body adds no scrape');
assert.equal(bodyTarget(20, 0, false, 1), 0, 'flying over rock cannot scrape without body or board contact');
assert(bodyTarget(20, 0, true, 1) > 0, 'ordinary board-on-rock scraping remains audible');
assert.equal(bodyTarget(20, 0, true, 0), 0, 'ordinary clean snow does not gain a body scrape');

target(0, true, RIDER.lean, { rock: 1, ice: 0, powder: 0 });
assert.deepEqual(snowGains(), [0, 0, 0, 0], 'a stationary board does not scrape or rumble');
assert.equal(Math.abs(context.panners[0].pan.value), 0, 'stationary lean cannot move the sound');
audio.toggleMute();
target(84, true, -RIDER.lean);
assert.equal(context.gains[0].gain.value, 0);
assert.ok(context.gains[3].gain.value > 0, 'muted voices still track the current ride');
assert(bodyTarget(20, 20) > 0, 'muted body contact still tracks the current fall');
assert.equal(context.gains[0].gain.value, 0, 'the master keeps body drag muted');
audio.toggleMute();

const pausedWrites = context.filters[0].frequency.events.length;
audio.quiet();
assert.equal(bodyTarget(20, 20), 0, 'paused body contact cannot repopulate the quiet mix');
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
assert(bodyTarget(20, 20, false, 0, 0) > 0, 'resume immediately restores a current body slide');
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
  clock += 40;
  mono.ambience(20, 7, false, 0, .8, 20);
  assert(context.gains[6].gain.value > 0, 'mono fallback keeps body dragging');
  assert.deepEqual(context.gains.slice(3, 6).map(node => node.gain.value), [0, 0, 0]);
  assert.equal(context.sources.length, 6, 'mono body contact adds no extra voice');
}

const shots = ctx => [...ctx.oscillators, ...ctx.sources.slice(6)];
const envelope = source => {
  let node = source.connections[0];
  while (!node.gain) node = node.connections[0];
  return node;
};
const fresh = (fallback = false) => {
  timers.clear();
  window.AudioContext = class extends TestContext {
    createGain() {
      const node = super.createGain();
      if (fallback) node.gain.cancelAndHoldAtTime = undefined;
      return node;
    }
  };
  const audio = createAudio(); audio.start();
  return { audio, ctx: context };
};

// Observe production source schedules and independent AudioParam timelines,
// including attack, decay, delayed tones and both burst routing branches.
for (const fallback of [false, true]) for (const pauseAt of [.005, .05]) {
  const { audio, ctx } = fresh(fallback);
  audio.cocoa(); audio.speedClub(); audio.whoosh(.5);
  const old = shots(ctx).map(source => ({ source, gain: envelope(source),
    level: envelope(source).gain.at(pauseAt), stop: source.stops.at(-1) }));
  ctx.currentTime = pauseAt; audio.quiet();
  let active = 0, delayed = 0;
  for (const { source, gain, level, stop } of old) {
    const retiredAt = source.stops.at(-1);
    assert(retiredAt < stop, 'pause brings an already scheduled one-shot stop forward');
    if (source.starts[0] > pauseAt) {
      delayed++;
      assert.equal(retiredAt, pauseAt, 'future notes stop before they can start');
      assert.equal(gain.gain.at(pauseAt), 0, 'future envelope automation is silenced');
    } else {
      active++;
      assert(retiredAt > pauseAt && retiredAt <= pauseAt + .03, 'active cues get a short bounded fade');
      assert(Math.abs(gain.gain.at(pauseAt) - level) < 1e-12, 'retirement holds the real attack/decay level');
      assert(gain.gain.at((pauseAt + retiredAt) / 2) > 0, 'an active cue fades instead of cutting abruptly');
      assert.equal(gain.gain.at(retiredAt), 0, 'the envelope reaches silence at source retirement');
    }
  }
  assert(active > 0 && delayed > 0);
  assert(ctx.sources.slice(0, 6).every(source => source.stops.length === 0), 'the six continuous loops survive pause');
  assert.equal(ctx.sources.length, 8, 'only the two requested noise bursts were allocated');
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 350, 'parking still waits for the loop fade');
  // The old cue must retire before the 350 ms park, independently of how
  // long wall time then passes while the native audio clock stays frozen.
  ctx.currentTime = pauseAt + .35;
  for (const { source, gain } of old) {
    assert(source.stops.at(-1) <= ctx.currentTime);
    source.finish();
    assert.equal(source.connections.length, 0); assert.equal(gain.connections.length, 0);
    assert.equal(source.onended, null, 'ended sources release their cleanup closure');
  }
  for (const callback of timers.values()) callback();
  await Promise.resolve(); assert.equal(ctx.state, 'suspended');
  const frozen = ctx.currentTime; clock += 10000;
  audio.start(); assert.equal(ctx.state, 'running'); assert.equal(ctx.currentTime, frozen);
  const stopCounts = old.map(({ source }) => source.stops.length);
  audio.quiet();
  assert.deepEqual(old.map(({ source }) => source.stops.length), stopCounts, 'ended shots are absent from later retirement');
}

// Resume during the old fade: no old envelope can be resurrected, while a
// newly requested cue retains its ordinary lifetime and can end naturally.
{
  const { audio, ctx } = fresh(); audio.cocoa();
  ctx.currentTime = .05; audio.quiet();
  const old = shots(ctx).map(source => ({ source, stop: source.stops.at(-1), writes: envelope(source).gain.events.length }));
  ctx.currentTime = .055; audio.start(); audio.perfectPop();
  assert.equal(timers.size, 0, 'rapid resume cancels the pending park');
  for (const { source, stop, writes } of old) {
    assert.equal(source.stops.at(-1), stop); assert.equal(envelope(source).gain.events.length, writes);
  }
  const current = shots(ctx).slice(old.length);
  assert.equal(current.length, 2);
  assert(current.every(source => source.stops.length === 1 && source.stops[0] > .15), 'fresh cues receive their full new envelopes');
  ctx.currentTime = .4;
  for (const source of current) source.finish();
  audio.quiet();
  assert(current.every(source => source.stops.length === 1), 'natural onended cleanup removes shots from pause tracking');
  assert(old.every(({ source }) => source.stops.length === 2), 'another pause cannot extend already retired fades');
}

// A suspended/interrupted clock cannot play a fade now. Saving one for the
// next resume would retain precisely the stale tail that pause must discard.
for (const state of ['suspended', 'interrupted']) {
  const { audio, ctx } = fresh(); audio.cocoa(); audio.whoosh(-.5);
  ctx.currentTime = .05; ctx.state = state;
  const old = shots(ctx).map(source => ({ source, gain: envelope(source) }));
  audio.quiet(); audio.start();
  for (const { source, gain } of old) {
    assert.equal(source.stops.at(-1), .05, state + ': no old source survives into resume');
    assert.equal(gain.gain.at(.05), 0, state + ': the frozen envelope has no saved fade');
  }
  assert(ctx.sources.slice(0, 6).every(source => source.stops.length === 0));
}

// A browser interruption can freeze an already retiring source mid-fade.
// A second quiet must still find it and discard that remaining fragment.
for (const quietAgain of [false, true]) {
  const { audio, ctx } = fresh(); audio.chime(1);
  ctx.currentTime = .1; audio.quiet();
  const old = shots(ctx).map(source => ({ source, gain: envelope(source) }));
  assert(old.every(({ source }) => source.stops.at(-1) > .11), 'the first fade is still in progress');
  ctx.currentTime = .105; audio.quiet();
  assert(old.every(({ source }) => source.stops.at(-1) <= .125), 'repeated running quiet never extends a fade');
  ctx.currentTime = .11; ctx.state = 'interrupted';
  if (quietAgain) audio.quiet();
  audio.start();
  for (const { source, gain } of old) {
    assert.equal(source.stops.at(-1), .11, 'a frozen retiring source stops before resume');
    assert.equal(gain.gain.at(.11), 0, 'no remainder of the first fade survives');
  }
}

console.log('Audio checks passed: riding mix, body contact, six-voice budget, mute, pause/resume and active/delayed one-shot retirement.');
