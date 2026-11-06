/* Hedgerow — field recordings and procedural sound (Web Audio).

   Small, local CC0 recordings give firearm blasts, footsteps and impacts
   the irregular detail of real surfaces. See assets/audio/SOURCES.md for
   provenance. Samples load in the background; every event keeps a complete
   procedural fallback when a file or codec is unavailable. The rain bed,
   wind, thunder, bullets cracking past, reloads and explosions use filtered
   noise and short oscillator sweeps. World sounds are panned and
   attenuated by distance from the listener and lose their highs with
   distance; gunfire carries a short slap-back echo from the houses and the
   tree line.

   Foley: footsteps by surface (hobnails clicking on stone, mud sucking at
   the boot, grass swishing, leaf litter crackling, planks knocking hollow,
   water splashing) with heel and toe and a little difference every step;
   the kit (canteen, scabbard, pouches, the rifle on its sling) when running,
   jumping, landing, kneeling; the rifle shouldered; reloads in their parts;
   empty cases ringing on stone; bodies and rifles falling; ricochets off
   stone and steel; and the rain ticking on the helmet.

   Dazed by a blast close by (daze()), everything is heard through a
   low-pass that shuts down to a few hundred hertz and opens again as it
   wears off, behind a high, slightly wavering ringing in the ears. */

import { rng } from './util.js';
import { createAcousticOcclusion } from './audio-space.js';
import { createFireAmbience } from './audio-fires.js';
import { createRadioAmbience } from './audio-radios.js';
import { KAR98K_ACTION_TIMING } from './weapon-action-timing.js';
import { createSimulationActions } from './audio-actions.js';
import { actorReloadTiming } from './audio-reload-timing.js';

// One-shot mono files keep positional sounds anchored to their source. No
// remote audio requests, and no full recording sessions in the shipping game.
const SAMPLE_FILES = {
  rifle: ['rifle-01.ogg', 'rifle-02.ogg'],
  bolt: ['bolt-01.ogg', 'bolt-02.ogg'],
  smg: ['smg-01.ogg', 'smg-02.ogg'],
  hard: [0, 1, 2].map(i => `footstep_concrete_00${i}.ogg`),
  grass: [0, 1, 2].map(i => `footstep_grass_00${i}.ogg`),
  wood: [0, 1, 2].map(i => `footstep_wood_00${i}.ogg`),
  metalHit: [0, 1].map(i => `impactMetal_light_00${i}.ogg`),
  woodHit: [0, 1].map(i => `impactWood_light_00${i}.ogg`),
  stoneHit: [0, 1].map(i => `impactMining_00${i}.ogg`),
};
const SAMPLE_TOTAL = Object.values(SAMPLE_FILES).flat().length;
const SAMPLE_BASE = new URL('../assets/audio/', import.meta.url);
const MAX_SAMPLE_VOICES = 36;
const SPATIAL_INTERVAL = .05, SPATIAL_BUDGET = 32;
const MAX_HORIZON_REPORTS = 4;
const MAX_CASING_CONTACTS = 8;
const MAX_BODY_CONTACTS = 8;

export function createAudio() {
  let ctx = null, master = null, sfx = null, amb = null, verb = null;
  let weather = null, weatherExposure = null;
  let noiseBuf = null, brownBuf = null;
  let volume = 0.8;
  const mix = { effects: 1, ambience: 1 };
  let ambienceMix = null;
  const R = rng(77);
  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  let listenerRevision = 0, nextSpatialUpdate = 0, spatialUpdates = 0, peakSpatialUpdates = 0, spatialCursor = 0;
  const occlusion = createAcousticOcclusion();
  let rainGain = null, windGain = null, windLP = null, whistle = null, whistleBP = null, helmetGain = null, patterGain = null, dripGain = null;
  // the level's weather and wildlife (setAmbience), and when the next of each comes (tick)
  const amb0 = { rain: 1, wind: 1, birds: false, aircraft: false, frogs: null, frogsHeight: .2 };
  const next = { gust: 0, swell: 0, bird: 4, plane: 25, frog: 2 };
  let lastLoud = -99, outdoors = false, ambienceTarget = 0;
  let sheltered = 0, enclosure = 0, rainSwell = 1;
  let dull = null, ring = null, ringVolume = null, dazed = 0;
  let echoA = null, echoB = null, echoFb = null, echoLP = null;   // the slap-back (setSpace)
  const samples = new Map(), sampleLast = new Map(), sampleVoices = new Set();
  let playerActions = null, actorActions = null;
  const horizonReports = new Set();
  const casingContacts = new Set();
  const bodyContacts = new Set();
  const aircraftPasses = new Set();
  const transientBuses = new WeakMap(), activeBuses = new Set();
  let sampleCulled = 0, sampleStolen = 0;
  let sampleLoad = null, sampleFailed = 0, sampleRetries = 0;
  const sampleErrors = [];
  let fireAmbience = null, fireSources = [];
  let radioAmbience = null, radioSources = [];
  let horizonCulled = 0;
  let casingPlayed = 0, casingCulled = 0;
  let bodyPlayed = 0, bodyCulled = 0;

  // A bounded queue avoids competing with the mission's model/texture loads.
  // Loading is optional: the first shot never waits on a network request.
  function loadSamples() {
    if (!ctx || sampleLoad) return sampleLoad || Promise.resolve();
    const files = Object.values(SAMPLE_FILES).flat();
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        for (let attempt = 0; attempt < 2; attempt++) {
          const abort = new AbortController();
          // A cold mission may spend several seconds compiling shaders on
          // the main thread. Bound a fetch, not its already downloaded decode,
          // and retry one transient failure without delaying a gameplay event.
          const timeout = setTimeout(() => abort.abort(), attempt ? 25000 : 12000);
          try {
            const response = await fetch(new URL(file, SAMPLE_BASE), { signal: abort.signal });
            if (!response.ok) {
              const error = new Error(`HTTP ${response.status}`); error.transient = response.status >= 500; throw error;
            }
            const data = await response.arrayBuffer();
            clearTimeout(timeout);
            const decoded = await ctx.decodeAudioData(data);
            // Keep a stereo source recording from spreading a world-positioned
            // footstep/impact over both sides of the listener's head.
            let buffer = decoded;
            if (decoded.numberOfChannels > 1) {
              buffer = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
              const mono = buffer.getChannelData(0);
              for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
                const data = decoded.getChannelData(channel);
                for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
              }
            }
            samples.set(file, buffer);
            break;
          } catch (error) {
            const transient = error?.transient || error?.name === 'AbortError' || error?.name === 'TypeError';
            if (!attempt && transient) {
              sampleRetries++;
              await new Promise(done => setTimeout(done, 250));
            } else {
              sampleFailed++;
              sampleErrors.push({ file, reason: error?.message || 'decode failed' });
              break;
            }
          }
          finally { clearTimeout(timeout); }
        }
      }
    };
    sampleLoad = Promise.all(Array.from({ length: 3 }, worker));
    return sampleLoad;
  }

  // No immediate repetition within a material family. Tiny rate/gain changes
  // keep sustained automatic fire and a walking gait from becoming a loop.
  function sample(kind, out, at, gain = 1, { rate = 1, spread = 0.045, priority = 0 } = {}) {
    const files = SAMPLE_FILES[kind]?.filter(file => samples.has(file));
    if (!files?.length) return false;
    const level = gain * (out.gain?.value ?? 1);
    if (sampleVoices.size >= MAX_SAMPLE_VOICES) {
      // Keep the player's attack and nearby threats ahead of weak, distant
      // recording tails. Age reduces a tail's score, but never its priority.
      let quiet = null, quietScore = Infinity;
      for (const voice of sampleVoices) {
        const age = Math.max(0, ctx.currentTime - voice.at);
        const score = voice.level * Math.max(.08, 1 - age / voice.duration);
        if (!quiet || voice.priority < quiet.priority || (voice.priority === quiet.priority && score < quietScore)) { quiet = voice; quietScore = score; }
      }
      if (!quiet || quiet.priority > priority || (quiet.priority === priority && level <= quietScore * 1.1)) {
        sampleCulled++;
        return true; // intentional voice cull, not a missing-sample fallback
      }
      quiet.source.stop();
      sampleVoices.delete(quiet);
      sampleStolen++;
    }
    let i = Math.floor(R() * files.length);
    if (files.length > 1 && files[i] === sampleLast.get(kind)) i = (i + 1) % files.length;
    const file = files[i]; sampleLast.set(kind, file);
    const source = ctx.createBufferSource(), envelope = ctx.createGain();
    source.buffer = samples.get(file);
    source.playbackRate.value = rate * (1 - spread + R() * spread * 2);
    envelope.gain.value = gain * (0.94 + R() * 0.12);
    source.connect(envelope).connect(out);
    attachSource(source, out);
    const voice = { source, priority, level, at, duration: source.buffer.duration / source.playbackRate.value };
    sampleVoices.add(voice);
    source.onended = () => { sampleVoices.delete(voice); source.disconnect(); envelope.disconnect(); };
    source.start(at);
    return true;
  }

  // The bullet still travels at gameplay speed; its distant muzzle blast
  // reaches the ear later. Nearby danger cues (cracks/impacts) stay immediate.
  function travelTime(x, y, z) {
    return Math.hypot(x - listener.x, y - listener.y, z - listener.z) / 343;
  }

  /* on a click (the browser lets sound start only on one): the sound made if it is not yet, and
     started */
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    prepare();
  }

  /* the context, the mixer and the loops, made while loading (main.js) and silent until a click
     starts them: the browser's first audio context takes a quarter of a second to open, which on
     the first click held the page */
  function prepare() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    // dazed: everything through a low-pass (wide open until then), the ringing on top of it
    dull = ctx.createBiquadFilter(); dull.type = 'lowpass'; dull.frequency.value = 20000; dull.Q.value = 0.3;
    // The compressor preserves the normal attack/decay. A final, mostly
    // transparent guard catches the rare coincident blast/fire transient
    // before the browser's output would hard-clip it. Unity below 0.82;
    // a smooth shoulder reaches a 0.94 ceiling at full-scale input.
    const guard = ctx.createWaveShaper(), curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
      curve[i] = a <= 0.82 ? x : Math.sign(x) * (0.82 + 0.12 * (1 - Math.pow(Math.max(0, 1 - (a - 0.82) / 0.18), 1.5)));
    }
    guard.curve = curve;
    master.connect(dull).connect(comp).connect(guard).connect(ctx.destination);
    ring = ctx.createGain(); ring.gain.value = 0;
    // Tinnitus bypasses the concussion low-pass, while this independent
    // volume stage still makes muting immediate even at a cached daze level.
    ringVolume = ctx.createGain(); ringVolume.gain.value = volume * mix.effects;
    const tone = ctx.createOscillator(); tone.frequency.value = 3900;
    const waver = ctx.createOscillator(); waver.frequency.value = 4.3;
    const waverDepth = ctx.createGain(); waverDepth.gain.value = 9;
    waver.connect(waverDepth).connect(tone.frequency);
    tone.connect(ring).connect(ringVolume).connect(comp);
    tone.start(); waver.start();
    sfx = ctx.createGain(); sfx.gain.value = mix.effects; sfx.connect(master);
    playerActions = createSimulationActions({ ctx, output: sfx });
    actorActions = createSimulationActions({ ctx, output: sfx, maxActions: 12 });
    ambienceMix = ctx.createGain(); ambienceMix.gain.value = mix.ambience;
    amb = ctx.createGain(); amb.gain.value = 0;
    amb.connect(ambienceMix).connect(master);   // silent until the mission (setOutdoors)
    // Weather outside a roof/window is distinct from a nearby fire or bird
    // that already has a world-space transmission path of its own.
    weather = ctx.createBiquadFilter(); weather.type = 'lowpass'; weather.frequency.value = 20000; weather.Q.value = .5;
    weatherExposure = ctx.createGain(); weatherExposure.gain.value = 1;
    weather.connect(weatherExposure).connect(amb);
    // outdoor slap-back: two short delays, filtered, set to the place (setSpace)
    verb = ctx.createGain(); verb.gain.value = 0.32;
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
    d1.delayTime.value = 0.11; d2.delayTime.value = 0.27;
    const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 2200;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    // Reflections carry the mid-range crack, not repeated sub-bass pressure.
    // A quieter second return keeps rapid fire legible in narrow streets.
    const echoHP = ctx.createBiquadFilter(); echoHP.type = 'highpass'; echoHP.frequency.value = 150; echoHP.Q.value = 0.5;
    const returnA = ctx.createGain(), returnB = ctx.createGain();
    returnA.gain.value = 0.8; returnB.gain.value = 0.52;
    verb.connect(echoHP).connect(f1); f1.connect(d1); f1.connect(d2);
    d1.connect(returnA).connect(sfx); d2.connect(fb); fb.connect(d1); d2.connect(returnB).connect(sfx);
    echoA = d1; echoB = d2; echoFb = fb; echoLP = f1;

    const n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = R() * 2 - 1;
    brownBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const bc = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (R() * 2 - 1)) / 1.02; bc[i] = last * 3.5; }
    startAmbience();
    shelterLevels();
    const fireR = rng(913);
    fireAmbience = createFireAmbience({ ctx, output: amb, makeNoise: brown => noise(brown, fireR), occlusion, listener, random: fireR });
    fireAmbience.warm();
    fireAmbience.setSources(fireSources);
    const radioR = rng(1945);
    radioAmbience = createRadioAmbience({ ctx, output: sfx, makeNoise: () => noise(false, radioR), occlusion, listener, random: radioR });
    radioAmbience.setSources(radioSources);
    loadSamples();
  }

  function noise(brown = false, random = R) {
    const s = ctx.createBufferSource();
    s.buffer = brown ? brownBuf : noiseBuf;
    s.loop = true;
    s.loopStart = random() * 1.5;
    return s;
  }

  /* a loop of `count` drops a channel, each `drop(d, at)` written into a stereo buffer `sec` long */
  function dropLoop(sec, count, drop) {
    const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < count; k++) drop(d, Math.floor(R() * (n - 4000)));
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    return src;
  }

  function startAmbience() {
    // rain: the broadband hiss of it falling on the fields, and its roar in the hedges
    const r = noise();
    const rainLP = ctx.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 5200;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    rainGain = ctx.createGain(); rainGain.gain.value = 0.12;
    r.connect(hp).connect(rainLP).connect(rainGain).connect(weather);
    r.start(0, R());
    const r2 = noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
    const roar = ctx.createGain(); roar.gain.value = 0.45;
    r2.connect(bp).connect(roar).connect(rainGain);
    r2.start(0, R());
    /* the patter: a few hundred small drops a second on leaves, puddles and the kit, each a tiny
       damped ring; two loops of unrelated length so the pattern never repeats audibly */
    const sr = ctx.sampleRate;
    const tick = (d, at) => {
      const len = 40 + Math.floor(R() * 220), w = (1600 + R() * 5200) / sr * 2 * Math.PI, amp = 0.05 + R() * R() * 0.45;
      for (let i = 0; i < len; i++) d[at + i] += Math.sin(i * w) * Math.exp(-i / (len * 0.25)) * amp;
    };
    patterGain = ctx.createGain(); patterGain.gain.value = 0.32;
    const pf = ctx.createBiquadFilter(); pf.type = 'highpass'; pf.frequency.value = 900;
    pf.connect(patterGain).connect(weather);
    for (const [sec, count] of [[4.1, 900], [5.3, 1100]]) { const l = dropLoop(sec, count, tick); l.connect(pf); l.start(0, R() * sec); }
    /* near drips off the leaves and eaves into puddles: a rising "plip" (the bubble a drop
       leaves behind), now and then */
    const plip = (d, at) => {
      const len = Math.floor(sr * (0.03 + R() * 0.05)), f0 = 700 + R() * 900, amp = 0.25 + R() * 0.6;
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const u = i / len;
        ph += (f0 * (1 + 1.6 * u)) / sr * 2 * Math.PI;
        d[at + i] += Math.sin(ph) * Math.exp(-u * 5) * amp + (i < 40 ? (R() * 2 - 1) * 0.3 * amp : 0);
      }
    };
    dripGain = ctx.createGain(); dripGain.gain.value = 0.05;
    const drips = dropLoop(7.3, 11, plip); drips.connect(dripGain).connect(weather); drips.start();
    // wind: a low rush that gusts (tick), and a thin whistle in the hedges and the wire at the gusts
    const w = noise(true);
    windLP = ctx.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 220 + 260 * amb0.wind;
    windGain = ctx.createGain(); windGain.gain.value = 0.16 * amb0.wind;
    w.connect(windLP).connect(windGain).connect(weather);
    w.start(0, R());
    const ws = noise();
    whistleBP = ctx.createBiquadFilter(); whistleBP.type = 'bandpass'; whistleBP.frequency.value = 820; whistleBP.Q.value = 7;
    whistle = ctx.createGain(); whistle.gain.value = 0;
    ws.connect(whistleBP).connect(whistle).connect(weather);
    ws.start(0, R());
    // rain on the helmet: a loop of drops ticking on steel, close, all round the head
    const sec = 3, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < 36; k++) {
        const len = 500 + Math.floor(R() * 900), at = Math.floor(R() * (n - len));
        const w = (3000 + R() * 2800) / ctx.sampleRate * 2 * Math.PI, amp = 0.2 + R() * 0.8;
        for (let i = 0; i < len; i++) d[at + i] += (Math.sin(i * w) * Math.exp(-i / (len * 0.16)) * 0.5 + (R() * 2 - 1) * Math.exp(-i / 30) * 0.35) * amp;
      }
    }
    const hs = ctx.createBufferSource(); hs.buffer = buf; hs.loop = true;
    helmetGain = ctx.createGain(); helmetGain.gain.value = 0.045;
    hs.connect(helmetGain).connect(weather);
    hs.start();
    rainLevels();
  }

  /* Spatial chain for a sound at a world position. Returns the input node
     or null when it is too far to hear. */
  function spatial(x, y, z, { ref = 6, max = 400, echo = 0, lowpassFar = true, occlude = true, ambient = false, destination = null } = {}) {
    const d = Math.hypot(x - listener.x, y - listener.y, z - listener.z);
    if (d > max) return null;
    const g = ctx.createGain();
    const path = occlude ? occlusion.sample(x, y, z, ctx.currentTime) : null;
    const pan = ctx.createStereoPanner();
    const nodes = [g, pan];
    let lp = null, send = null;
    if (lowpassFar || path?.blocked) {
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.Q.value = 0.5;
      g.connect(lp); lp.connect(pan);
      nodes.push(lp);
    } else g.connect(pan);
    pan.connect(destination || (ambient ? amb : sfx));
    if (echo > 0) {
      send = ctx.createGain();
      pan.connect(send); send.connect(verb);
      nodes.push(send);
    }
    const position = { x, y, z, ref, max, echo, lowpassFar, path, gain: g, pan, lp, send, revision: listenerRevision };
    applySpatial(position, ctx.currentTime, true);
    return transientBus(g, nodes, position);
  }

  function spatialParam(param, value, time, immediate) {
    if (immediate) param.value = value;
    else if (Math.abs(param.value - value) > .0001) param.setTargetAtTime(value, time, .025);
  }

  function applySpatial(position, time, immediate = false) {
    if (Number.isFinite(position.bearing)) {
      // A horizon direction has no local collider path or distance change.
      const progress = position.moving ? Math.max(0, Math.min(1, (time - position.start) / position.duration)) : 0;
      const bearing = position.bearing + (position.travel || 0) * progress;
      spatialParam(position.pan.pan, -Math.sin(bearing - listener.yaw) * position.spread, time, immediate);
      position.revision = listenerRevision;
      return;
    }
    const { x, y, z, ref, max, path } = position;
    const dx = x - listener.x, dz = z - listener.z, d = Math.hypot(dx, y - listener.y, dz);
    // camera.js faces (sin(yaw), 0, cos(yaw)); angle zero is in front.
    const angle = Math.atan2(dx, dz) - listener.yaw, behind = Math.max(0, -Math.cos(angle));
    const gain = ref / Math.max(ref, d) * Math.max(0, 1 - d / max) * (path?.gain ?? 1) * (1 - behind * .12);
    spatialParam(position.gain.gain, gain, time, immediate);
    spatialParam(position.pan.pan, Math.max(-1, Math.min(1, -Math.sin(angle) * Math.min(1, d / 3))), time, immediate);
    if (position.lp) spatialParam(position.lp.frequency, Math.min(path?.cutoff ?? 20000, position.lowpassFar ? Math.max(700, 16000 / (1 + d / 18 + behind * .5)) : 20000), time, immediate);
    if (position.send) spatialParam(position.send.gain, position.echo * Math.min(1, .4 + d / 60), time, immediate);
    position.revision = listenerRevision;
  }

  function updateSpatial() {
    if (!ctx || ctx.state !== 'running' || ctx.currentTime < nextSpatialUpdate) return;
    const time = ctx.currentTime; nextSpatialUpdate = time + SPATIAL_INTERVAL;
    const buses = [...activeBuses], total = buses.length;
    if (!total) return;
    const start = spatialCursor % total;
    let count = 0, visited = 0;
    while (visited < total && count < SPATIAL_BUDGET) {
      const bus = buses[(start + visited++) % total];
      if (!bus.position || (bus.position.revision === listenerRevision && !bus.position.moving)) continue;
      applySpatial(bus.position, time); count++;
    }
    spatialCursor = (start + visited) % total;
    spatialUpdates += count; peakSpatialUpdates = Math.max(peakSpatialUpdates, count);
  }

  // One-shot panners/filters/sends have a lifetime too. Disconnect them once
  // all attached (including future-scheduled) sources end, rather than leave
  // an empty graph connected after every footstep and bullet impact.
  function transientBus(input, nodes, position = null) {
    const bus = { input, nodes, position, sources: 0 };
    transientBuses.set(input, bus); activeBuses.add(bus);
    queueMicrotask(() => { if (!bus.sources) releaseBus(bus); });
    return input;
  }

  function releaseBus(bus) {
    if (!activeBuses.delete(bus)) return;
    transientBuses.delete(bus.input);
    for (const node of bus.nodes) node.disconnect();
  }

  function attachSource(source, input) {
    const bus = transientBuses.get(input);
    if (!bus) return;
    bus.sources++;
    source.addEventListener('ended', () => { if (!--bus.sources) releaseBus(bus); }, { once: true });
  }

  function env(gainNode, t0, attack, peak, decay, curve = 'exp') {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    else g.linearRampToValueAtTime(0, t0 + attack + decay);
  }

  function burst(out, t, { dur = 0.2, peak = 1, type = 'lowpass', freq = 3000, q = 0.7, sweepTo = null, brown = false, attack = 0.002 } = {}) {
    const s = noise(brown);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(out);
    attachSource(s, out);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t, R() * 1.5);
    s.stop(t + dur + attack + 0.05);
    return s;
  }

  function tone(out, t, { f0 = 120, f1 = 40, dur = 0.2, peak = 1, type = 'sine' } = {}) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.003, peak, dur);
    o.connect(g).connect(out);
    attachSource(o, out);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // Enemy actions remain positioned in the world. Player cues instead wait
  // for advanceActions(dt), called with the animation's simulation step.
  function playerAction() { return playerActions.create(); }
  function cancelActions() { playerActions?.cancel(); }

  /* ---------- weapons ---------- */

  const GUN = {
    garand: { crack: 1.0, freq: 2600, body: 1.1, low: 95, dur: 0.22, echo: 0.9 },
    thompson: { crack: 0.7, freq: 1800, body: 0.9, low: 80, dur: 0.14, echo: 0.6 },
    kar98k: { crack: 1.0, freq: 2400, body: 1.1, low: 90, dur: 0.24, echo: 0.9 },
    mp40: { crack: 0.65, freq: 1700, body: 0.8, low: 85, dur: 0.12, echo: 0.55 },
    mg42: { crack: 0.75, freq: 2100, body: 0.9, low: 75, dur: 0.1, echo: 0.6 },
  };

  function gunshot(kind, x, y, z, { player = false } = {}) {
    if (!ctx) return;
    const p = GUN[kind] || GUN.kar98k;
    const t = ctx.currentTime + 0.001 + (player ? 0 : travelTime(x, y, z));
    if (player || Math.hypot(x - listener.x, y - listener.y, z - listener.z) < 80) lastLoud = ctx.currentTime;
    const out = player ? sfx : spatial(x, y, z, { ref: 8, max: 600, echo: p.echo });
    if (!out) return;
    let o = out;
    if (player) {
      const g = ctx.createGain(); g.gain.value = 0.9; g.connect(sfx);
      const e = ctx.createGain(); e.gain.value = p.echo * 0.6; g.connect(e); e.connect(verb);
      o = transientBus(g, [g, e]);
    }
    const family = kind === 'garand' ? 'rifle' : kind === 'kar98k' ? 'bolt' : 'smg';
    const recorded = sample(family, o, t, kind === 'mg42' ? 0.95 : 1.1, {
      rate: kind === 'thompson' ? 0.9 : kind === 'mg42' ? 0.88 : 1,
      spread: 0.025, priority: player ? 3 : 2,
    });
    if (!recorded) {
      burst(o, t, { dur: p.dur * 0.35, peak: p.crack, type: 'highpass', freq: p.freq, q: 0.5 });
      burst(o, t, { dur: p.dur, peak: p.body * 0.9, type: 'lowpass', freq: 1800, sweepTo: 300, q: 0.8 });
    }
    // A restrained close pressure layer gives each weapon its own weight.
    tone(o, t, { f0: p.low * 1.6, f1: p.low * 0.4, dur: p.dur * 0.9, peak: p.body * (recorded ? 0.24 : 0.9) });
    if (player) {
      if (kind === 'kar98k') {
        const action = playerAction();
        const cycle = KAR98K_ACTION_TIMING.shot;
        // A hand-worked bolt: lift/pull, then push/lock, well after the blast.
        action.at(cycle.liftPull, (out, when) => burst(out, when, { dur: 0.07, peak: 0.1, type: 'bandpass', freq: 1650, sweepTo: 2600, q: 2 }));
        action.at(cycle.push, (out, when) => burst(out, when, { dur: 0.055, peak: 0.14, type: 'bandpass', freq: 1900, sweepTo: 1100, q: 2 }));
        action.at(cycle.lock, (out, when) => tone(out, when, { f0: 240, f1: 135, dur: 0.045, peak: 0.055, type: 'triangle' }));
      } else {
        const openBolt = kind === 'thompson' || kind === 'mp40' || kind === 'mg42';
        playerAction().at(openBolt ? .048 : .065, (out, when) => burst(out, when, { dur: 0.025, peak: openBolt ? 0.045 : 0.065, type: 'bandpass', freq: kind === 'mp40' ? 1650 : 2300, q: 2.3 }));
      }
    }
  }

  function garandPing() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.06;
    for (const [f, a] of [[2760, 0.16], [4150, 0.08], [5800, 0.04]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); env(g, t, 0.002, a, 0.5);
      o.connect(g).connect(sfx); o.onended = () => { o.disconnect(); g.disconnect(); }; o.start(t); o.stop(t + 0.6);
    }
  }

  function dryFire() {
    if (!ctx) return;
    burst(sfx, ctx.currentTime, { dur: 0.03, peak: 0.25, type: 'bandpass', freq: 3500, q: 2 });
  }

  /* A reload, the player's own or someone else's at a position, in its
     parts (at the moments of the clip in reload.js). Garand: the operating
     rod back, the clip shoved in, the thumb out, the bolt slamming home.
     Thompson: the magazine catch, the empty one out (and onto the ground),
     the full one slapped in, the bolt racked. Kar98k: the bolt, stripper
     clip and locking lugs. MP40: stamped-steel magazine and open bolt. */
  function reload(kind, at = null) {
    if (!ctx) return;
    if (!at) cancelActions();
    const action = at ? null : playerAction();
    const out = at ? spatial(at.x, at.y + 1.2, at.z, { ref: 2, max: 30 }) : action.out;
    if (!out) return;
    const t = action ? 0 : ctx.currentTime;
    reloadCues(kind, (tt, make) => action ? action.at(tt, make) : make(out, tt), t);
  }

  // Each actor advances only its own handle with the same dt as reloadT.
  // A future beat holds no source/path at the soldier's old position. Its
  // short emitted tail stays where it happened, with the normal shared
  // material-path budget and independent listener-bearing updates.
  function reloadActor(kind, getPosition, options) {
    if (!ctx || typeof getPosition !== 'function') return null;
    const action = actorActions.create();
    let cancelled = false;
    const position = () => {
      if (cancelled) return null;
      const at = getPosition();
      if (at && [at.x, at.y, at.z].every(Number.isFinite)) return at;
      cancelled = true; action.cancel(); return null;
    };
    reloadCues(kind, (offset, make) => action.at(offset, (output, when) => {
      const at = position();
      if (!at) return null;
      const out = spatial(at.x, at.y + 1.2, at.z, { ref: 2, max: 30, destination: output });
      return out ? make(out, when) : null;
    }), 0, actorReloadTiming(kind, options));
    return {
      advance(dt) { if (position()) action.advance(dt); },
      cancel() { cancelled = true; action.cancel(); },
      finish() { cancelled = true; action.finish(); },
    };
  }

  // The same mechanical pattern serves player, moving NPC and legacy
  // position-only callers. Only the dispatch clock/output route differs.
  function reloadCues(kind, dispatch, t = 0, profile = null) {
    const click = (tt, f, peak, d = 0.04, q = 3) => {
      const freq = f * (0.95 + R() * 0.1);
      dispatch(tt, (out, when) => burst(out, when, { dur: d, peak, type: 'bandpass', freq, q }));
    };
    const slide = (tt, f0, f1, peak, d = 0.09) => dispatch(tt, (out, when) => burst(out, when, { dur: d, peak, type: 'bandpass', freq: f0, sweepTo: f1, q: 2 }));
    const clunk = (tt, f, peak) => dispatch(tt, (out, when) => tone(out, when, { f0: f, f1: f * 0.58, dur: 0.08, peak, type: 'triangle' }));
    if (kind === 'garand') {
      slide(t + 0.17, 1800, 2600, 0.12); click(t + 0.24, 2300, 0.3);
      slide(t + 0.72, 1200, 1800, 0.15, 0.12); click(t + 0.83, 2800, 0.26);
      click(t + 1.45, 3400, 0.12, 0.03);
      click(t + 1.85, 1900, 0.42, 0.05, 2);
      clunk(t + 1.85, 260, 0.18);
    } else if (kind === 'thompson' || kind === 'mp40') {
      const steel = kind === 'mp40' ? 0.83 : 1;
      const timing = profile || { release: .25, extract: .3, drop: .78, insert: .8, seated: .95, pull: 1.55, rack: 1.62, shut: 2.05 };
      click(t + timing.release, 3000, 0.22, 0.03);
      slide(t + timing.extract, 1500 * steel, 900 * steel, 0.12, 0.1);
      click(t + timing.drop, 1300 * steel, 0.1, 0.06, 1.5);
      slide(t + timing.insert, 900 * steel, 1600 * steel, 0.14, 0.12); click(t + timing.seated, 2400 * steel, 0.32, 0.04, 2);
      slide(t + timing.pull, 2000 * steel, 1400 * steel, 0.15, 0.08); click(t + timing.rack, 2600 * steel, 0.3);
      click(t + timing.shut, 2200 * steel, 0.38, 0.05, 2); clunk(t + timing.shut, kind === 'mp40' ? 205 : 250, 0.08);
    } else if (kind === 'kar98k') {
      const timing = profile || KAR98K_ACTION_TIMING.reload;
      click(t + timing.lift, 1850, 0.18); slide(t + timing.pull, 1200, 2400, 0.16, 0.13);
      click(t + timing.clipIn, 3300, 0.15, 0.025); // stripper clip into the guide
      slide(t + timing.roundsIn, 1900, 950, 0.15, 0.22); // rounds pressed into the internal magazine
      timing.roundClicks.forEach((at, i) => click(t + at, 2700 - i * 180, 0.055, 0.018, 2));
      click(t + timing.clipOut, 3600, 0.12, 0.025); // empty clip out
      slide(t + timing.push, 2100, 1150, 0.19, 0.13);
      click(t + timing.lock, 1550, 0.28, 0.045, 2); clunk(t + timing.lock, 230, 0.12);
    } else if (kind === 'mg42') {
      click(t + 0.3, 2800, 0.22); clunk(t + 0.55, 310, 0.12);
      for (let i = 0; i < 7; i++) click(t + 1.35 + i * 0.11, 2300 + R() * 900, 0.045 + R() * 0.04, 0.025);
      slide(t + 3.2, 1800, 900, 0.12, 0.18);
      click(t + 4.15, 1450, 0.36, 0.055, 2); clunk(t + 4.15, 220, 0.18);
      slide(t + 4.6, 1600, 2300, 0.22, 0.15); click(t + 4.86, 1900, 0.3);
    } else {
      const clicks = [0.25, 0.85, 1.6, 2.05];
      clicks.forEach((dt, i) => click(t + dt, 2200 + i * 500, 0.25 + (i === clicks.length - 1 ? 0.15 : 0)));
    }
  }

  function switchWeapon() {
    if (!ctx) return;
    cancelActions();
    const t = ctx.currentTime;
    burst(sfx, t, { dur: 0.08, peak: 0.15, type: 'bandpass', freq: 900, q: 1.5 });
    burst(sfx, t + 0.12, { dur: 0.04, peak: 0.2, type: 'bandpass', freq: 2600, q: 3 });
  }

  /* A bullet passing close: a sharp supersonic crack and a whip. */
  function whizz(x, y, z, closeness = 1) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 2, max: 30, lowpassFar: false, occlude: false });
    if (!out) return;
    const t = ctx.currentTime;
    burst(out, t, { dur: 0.05, peak: 0.6 * closeness, type: 'highpass', freq: 3500, q: 0.7 });
    burst(out, t + 0.01, { dur: 0.12, peak: 0.3 * closeness, type: 'bandpass', freq: 5000, sweepTo: 1500, q: 2 });
  }

  function impact(x, y, z, surface) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 3, max: 80 });
    if (!out) return;
    const t = ctx.currentTime;
    const hit = surface === 'metal' || surface === 'iron' ? 'metalHit' : surface === 'wood' || surface === 'planks' ? 'woodHit' : ['stone', 'cobble', 'concrete', 'tile'].includes(surface) ? 'stoneHit' : null;
    if (hit && sample(hit, out, t, 0.3, { spread: 0.1, priority: 1 })) {
      if ((hit === 'metalHit' && R() < 0.4) || (hit === 'stoneHit' && R() < 0.22)) ricochet(out, t);
      return;
    }
    if (surface === 'metal') {
      tone(out, t, { f0: 1800 + R() * 900, f1: 1400, dur: 0.18, peak: 0.25, type: 'triangle' });
      burst(out, t, { dur: 0.04, peak: 0.3, type: 'highpass', freq: 3000 });
      if (R() < 0.4) ricochet(out, t);
    } else if (surface === 'water') {
      burst(out, t, { dur: 0.18, peak: 0.35, type: 'bandpass', freq: 1200, sweepTo: 600, q: 1 });
    } else if (surface === 'wood') {
      burst(out, t, { dur: 0.08, peak: 0.4, type: 'bandpass', freq: 900, q: 1.5 });
    } else if (surface === 'flesh') {
      burst(out, t, { dur: 0.08, peak: 0.45, type: 'lowpass', freq: 700, q: 1 });
    } else if (surface === 'stone' || surface === 'cobble' || surface === 'concrete') {
      burst(out, t, { dur: 0.06, peak: 0.4, type: 'bandpass', freq: 2400, q: 1.2 });
      if (R() < 0.22) ricochet(out, t);
    } else {
      burst(out, t, { dur: 0.1, peak: 0.35, type: 'lowpass', freq: 600, q: 0.7 });
    }
  }

  /* A bullet glancing off and whining away. */
  function ricochet(out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = 2600 + R() * 1800;
    o.frequency.setValueAtTime(f0, t + 0.01);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.4 + R() * 0.15), t + 0.38);
    const g = ctx.createGain(); env(g, t + 0.01, 0.01, 0.045 + R() * 0.03, 0.36);
    o.connect(g).connect(out); attachSource(o, out);
    o.onended = () => { o.disconnect(); g.disconnect(); }; o.start(t + 0.01); o.stop(t + 0.45);
  }

  function explosion(x, y, z, scale = 1) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 12, max: 900, echo: 1.2 });
    if (!out) return;
    const t = ctx.currentTime + travelTime(x, y, z);
    if (Math.hypot(x - listener.x, y - listener.y, z - listener.z) < 140) lastLoud = ctx.currentTime;
    burst(out, t, { dur: 0.25, peak: 1.4 * scale, type: 'lowpass', freq: 5000, sweepTo: 800 });
    burst(out, t, { dur: 1.8, peak: 1.2 * scale, type: 'lowpass', freq: 600, sweepTo: 80, brown: true });
    tone(out, t, { f0: 70, f1: 25, dur: 1.2, peak: 1.4 * scale });
    // debris patter
    for (let i = 0; i < 6; i++) burst(out, t + 0.5 + R() * 1.2, { dur: 0.05, peak: 0.12, type: 'bandpass', freq: 1500 + R() * 2000, q: 2 });
  }

  function thunder({ delay = 3, power = 1 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const g = ctx.createGain(); g.connect(weather); transientBus(g, [g]);
    if (power > 1.2) burst(g, t, { dur: 0.35, peak: 0.9 * power, type: 'lowpass', freq: 3000, sweepTo: 400 });
    for (let i = 0; i < 5; i++) {
      burst(g, t + i * (0.35 + R() * 0.6), { dur: 1.6 + R() * 2.2, peak: (0.55 - i * 0.07) * power, type: 'lowpass', freq: 380 - i * 40, sweepTo: 60, brown: true, attack: 0.15 });
    }
  }

  /* Distant war: artillery thumps and far machine-gun bursts. */
  function distant(kind, { azimuth = R() * Math.PI * 2, delay = 0 } = {}) {
    if (!ctx) return;
    if (horizonReports.size >= MAX_HORIZON_REPORTS) { horizonCulled++; return; }
    const t = ctx.currentTime + (Number.isFinite(delay) ? Math.max(0, delay) : 0);
    const g = ctx.createGain(), pan = ctx.createStereoPanner();
    g.gain.value = 0.35;
    // A broad bearing ties a distant report to its horizon flash without
    // pinning low artillery rumble hard into one ear. No world probe needed.
    const bearing = { bearing: Number.isFinite(azimuth) ? azimuth : 0, spread: kind === 'artillery' ? .45 : .7, pan, revision: listenerRevision };
    applySpatial(bearing, ctx.currentTime, true);
    g.connect(pan).connect(weather); transientBus(g, [g, pan], bearing);
    const report = { start: t, out: g, sources: new Set(), cancelled: false };
    horizonReports.add(report);
    const track = source => {
      report.sources.add(source);
      source.addEventListener('ended', () => {
        report.sources.delete(source);
        if (!report.sources.size) horizonReports.delete(report);
      }, { once: true });
    };
    if (kind === 'artillery') {
      track(tone(g, t, { f0: 55, f1: 28, dur: 1.5, peak: 0.6 }));
      track(burst(g, t, { dur: 2.2, peak: 0.4, type: 'lowpass', freq: 220, sweepTo: 60, brown: true, attack: 0.05 }));
    } else if (kind === 'flare') {
      // a flare bursting open far off: a soft pop, then the fizz of it burning
      track(burst(g, t, { dur: 0.09, peak: 0.35, type: 'lowpass', freq: 700, q: 0.8 }));
      track(burst(g, t + 0.05, { dur: 1.6, peak: 0.05, type: 'bandpass', freq: 3200, q: 0.6, attack: 0.2 }));
    } else {
      const n = 6 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) track(burst(g, t + i * 0.055, { dur: 0.06, peak: 0.18, type: 'lowpass', freq: 900, q: 0.7 }));
    }
  }

  function cancelHorizon() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const report of horizonReports) {
      if (report.cancelled) continue;
      report.cancelled = true;
      report.out.gain.cancelAndHoldAtTime(t);
      report.out.gain.setTargetAtTime(0, t, .01);
      for (const source of report.sources) { try { source.stop(t + .04); } catch { /* already ended */ } }
    }
  }

  /* ---------- foley ---------- */

  // which kind of step a surface makes
  const STEP = {
    cobble: 'hard', stone: 'hard', concrete: 'hard', tile: 'hard', metal: 'metal', iron: 'metal',
    wood: 'wood', planks: 'wood', mud: 'mud', dirt: 'mud', grass: 'grass', forest: 'leaves', foliage: 'leaves',
    sandbag: 'soft', fabric: 'soft', water: 'water',
  };

  /* A step: heel, then toe, a little different every time. `run` adds the
     kit, `wet` (0..1) a thin splash on hard ground and grass in the rain. */
  function footstep(x, y, z, surface, loud = 1, player = false, { run = false, wet = 0 } = {}) {
    if (!ctx) return;
    const out = player ? sfx : spatial(x, y, z, { ref: 2, max: 40 });
    if (!out) return;
    const t = ctx.currentTime;
    const family = STEP[surface] || 'hard';
    const recorded = ['hard', 'grass', 'wood'].includes(family) && sample(family, out, t, (player ? 0.32 : 0.4) * loud, { spread: run ? 0.075 : 0.045 });
    const g = (player ? 0.22 : 0.3) * loud * (recorded ? 0.28 : 1);
    const v = 0.9 + R() * 0.2;
    const toe = t + 0.05 + R() * 0.03;
    switch (STEP[surface] || 'hard') {
      case 'hard':
        burst(out, t, { dur: 0.05, peak: g, type: 'bandpass', freq: 1100 * v, q: 1.4 });
        burst(out, t, { dur: 0.02, peak: g * 0.45, type: 'bandpass', freq: 4200 * v, q: 3 });          // hobnails
        burst(out, toe, { dur: 0.04, peak: g * 0.6, type: 'bandpass', freq: 1500 * v, q: 1.6 });
        burst(out, toe + 0.01, { dur: 0.06, peak: g * 0.18, type: 'highpass', freq: 3500 });            // grit under the sole
        for (let i = 0; i < 3; i++) burst(out, toe + R() * 0.06, { dur: 0.008, peak: g * (0.1 + R() * 0.15), type: 'bandpass', freq: 3000 + R() * 4000, q: 3 });   // grains crunching
        if (wet > 0) burst(out, t + 0.005, { dur: 0.09, peak: g * 0.5 * wet, type: 'bandpass', freq: 2600 * v, sweepTo: 1200, q: 1.1 });
        break;
      case 'mud':
        burst(out, t, { dur: 0.11, peak: g, type: 'lowpass', freq: 520 * v, q: 1.3 });
        burst(out, t + 0.02, { dur: 0.16, peak: g * 0.55, type: 'bandpass', freq: 900 * v, sweepTo: 350, q: 2.5 });      // squelch
        burst(out, t + 0.16 + R() * 0.05, { dur: 0.06, peak: g * 0.35, type: 'bandpass', freq: 1600 * v, sweepTo: 2600, q: 4 });   // the boot pulling free
        if (wet > 0.4 && R() < wet * 0.5) burst(out, t + 0.01, { dur: 0.14, peak: g * 0.5 * wet, type: 'bandpass', freq: 1300 * v, sweepTo: 650, q: 1.2 });   // into a puddle
        break;
      case 'grass':
        burst(out, t, { dur: 0.09, peak: g * 0.75, type: 'lowpass', freq: 600 * v, q: 1 });
        burst(out, t + 0.01, { dur: 0.16, peak: g * 0.3, type: 'highpass', freq: 3800 * v });            // blades swishing
        if (wet > 0) burst(out, t + 0.02, { dur: 0.12, peak: g * 0.25 * wet, type: 'bandpass', freq: 2000, q: 1 });
        break;
      case 'leaves':
        burst(out, t, { dur: 0.09, peak: g * 0.7, type: 'lowpass', freq: 650 * v, q: 1 });
        for (let i = 0; i < 4; i++) burst(out, t + R() * 0.12, { dur: 0.012, peak: g * (0.15 + R() * 0.2), type: 'bandpass', freq: 2500 + R() * 3500, q: 2 });
        if (R() < 0.15) burst(out, t + 0.04, { dur: 0.015, peak: g * 0.6, type: 'highpass', freq: 1800 });   // a twig snaps
        break;
      case 'wood':
        tone(out, t, { f0: 190 * v, f1: 120 * v, dur: 0.12, peak: g * 0.8, type: 'triangle' });
        burst(out, t, { dur: 0.06, peak: g * 0.8, type: 'bandpass', freq: 700 * v, q: 2 });
        burst(out, toe, { dur: 0.04, peak: g * 0.45, type: 'bandpass', freq: 950 * v, q: 2 });
        if (R() < 0.2) tone(out, t + 0.08, { f0: 420 * v, f1: 380 * v, dur: 0.25, peak: g * 0.1, type: 'sawtooth' });   // a board creaks
        break;
      case 'metal':
        tone(out, t, { f0: 600 * v, f1: 540 * v, dur: 0.2, peak: g * 0.35, type: 'triangle' });
        burst(out, t, { dur: 0.04, peak: g * 0.8, type: 'bandpass', freq: 2200 * v, q: 2 });
        break;
      case 'soft':
        burst(out, t, { dur: 0.1, peak: g * 0.7, type: 'lowpass', freq: 450 * v, q: 0.8 });
        burst(out, t + 0.02, { dur: 0.08, peak: g * 0.2, type: 'bandpass', freq: 1500, q: 1 });
        break;
      case 'water':
        burst(out, t, { dur: 0.22, peak: g * 1.4, type: 'bandpass', freq: 900 * v, sweepTo: 400, q: 0.9 });
        burst(out, t + 0.05, { dur: 0.3, peak: g * 0.6, type: 'bandpass', freq: 1800 * v, sweepTo: 700, q: 1.2 });       // slosh
        for (let i = 0; i < 3; i++) burst(out, t + 0.1 + R() * 0.25, { dur: 0.03, peak: g * 0.2, type: 'bandpass', freq: 2500 + R() * 2000, q: 4 });
        break;
    }
    if (run) kit(out, t + 0.02, (player ? 0.22 : 0.3) * loud * 0.7);
  }

  /* The kit on a moving soldier: canteen, scabbard, pouches, the rifle on its
     sling, webbing and wool. */
  function kit(out, t, peak, track = null) {
    const click = burst(out, t, { dur: 0.05, peak: peak * 0.35, type: 'bandpass', freq: 2900 + R() * 900, q: 5 });
    track?.(click);
    if (R() < 0.5) {
      const ring = tone(out, t + 0.01, { f0: 1700 + R() * 600, f1: 1500, dur: 0.07, peak: peak * 0.06, type: 'triangle' });
      track?.(ring);
    }
    const cloth = burst(out, t, { dur: 0.12, peak: peak * 0.18, type: 'bandpass', freq: 1200, q: 0.8 });
    track?.(cloth);
  }

  /* The player's own moves: kneeling, getting up, shouldering the rifle,
     a jump, a landing (on `surface`). */
  function gear(kind, surface = 'mud', level = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'crouch' || kind === 'stand') {
      const down = kind === 'crouch';
      burst(sfx, t, { dur: 0.22, peak: 0.08, type: 'bandpass', freq: down ? 900 : 1200, sweepTo: down ? 500 : 1800, q: 0.7 });
      kit(sfx, t + 0.05, 0.18);
    } else if (kind === 'aim') {
      burst(sfx, t, { dur: 0.12, peak: 0.06, type: 'bandpass', freq: 1500, sweepTo: 900, q: 0.8 });
      burst(sfx, t + 0.06, { dur: 0.03, peak: 0.07, type: 'bandpass', freq: 3200, q: 4 });          // sling swivel
    } else if (kind === 'jump') {
      burst(sfx, t, { dur: 0.15, peak: 0.07, type: 'bandpass', freq: 1100, q: 0.7 });
      kit(sfx, t + 0.03, 0.2);
    } else if (kind === 'heart') {
      // lub-dub, felt more than heard
      tone(sfx, t, { f0: 62, f1: 38, dur: 0.12, peak: 0.25 * level });
      tone(sfx, t + 0.16, { f0: 55, f1: 34, dur: 0.1, peak: 0.16 * level });
    } else if (kind === 'lean') {
      burst(sfx, t, { dur: 0.16, peak: 0.05, type: 'bandpass', freq: 1300, sweepTo: 800, q: 0.7 });
      kit(sfx, t + 0.04, 0.12);
    } else if (kind === 'inhale' || kind === 'exhale' || kind === 'gasp') {
      // a breath through the nose held, let out, or let out hard and drawn again when held too long
      const out = kind !== 'inhale';
      burst(sfx, t, { dur: out ? 0.55 : 0.35, peak: kind === 'gasp' ? 0.07 : 0.035, type: 'bandpass', freq: out ? 700 : 1100, sweepTo: out ? 450 : 1500, q: 0.9, attack: out ? 0.02 : 0.08 });
      if (kind === 'gasp') burst(sfx, t + 0.6, { dur: 0.4, peak: 0.05, type: 'bandpass', freq: 1000, sweepTo: 1500, q: 0.9, attack: 0.06 });
    } else if (kind === 'land') {
      footstep(0, 0, 0, surface, 1.5, true);
      kit(sfx, t + 0.01, 0.3);
      kit(sfx, t + 0.06, 0.2);
    }
  }

  /* An empty case landing where it fell, `delay` after the shot: brass rings
     on stone and steel, ticks on planks, is lost in mud, grass and leaves. */
  function casing(x, y, z, surface, delay = 0.45) {
    if (!ctx) return;
    const kind = STEP[surface] || 'hard';
    if (kind !== 'hard' && kind !== 'metal' && kind !== 'wood') return;
    const out = spatial(x, y, z, { ref: 1.5, max: 20, lowpassFar: false });
    if (!out) return;
    const t = ctx.currentTime + delay;
    const f = (kind === 'wood' ? 2600 : 3800) + R() * 1500;
    const n = kind === 'wood' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 - i * 0.02) + R() * 0.01;
      tone(out, tt, { f0: f * (1 + R() * 0.05), f1: f * 0.98, dur: (kind === 'wood' ? 0.05 : 0.12) - i * 0.02, peak: 0.07 / (i + 1), type: 'sine' });
      if (kind !== 'wood') tone(out, tt, { f0: f * 2.7, f1: f * 2.65, dur: 0.06, peak: 0.025 / (i + 1), type: 'sine' });
    }
  }

  /* A single, quiet first contact from casings.js. The physics already owns
     the bounce timing: this adds no guessed delay or invented extra bounces.
     Soft ground absorbs the small case, while boards and hard surfaces give
     a brief wooden tick or brass ring. This original synthesis uses no new
     recording or claim to reproduce a particular cartridge. */
  function casingImpact(x, y, z, surface, speed = 4) {
    if (!ctx || ctx.state !== 'running' || ![x, y, z, speed].every(Number.isFinite) || speed < .8) return false;
    const kind = STEP[surface] || 'hard';
    if (kind !== 'hard' && kind !== 'metal' && kind !== 'wood') return false;
    if (casingContacts.size >= MAX_CASING_CONTACTS) { casingCulled++; return false; }
    const out = spatial(x, y, z, { ref: 1.2, max: 16 });
    if (!out) return false;
    const t = ctx.currentTime + .001, strength = Math.min(1, speed / 5);
    const wood = kind === 'wood', f = (wood ? 2300 : 3700) + R() * (wood ? 650 : 1100);
    const contact = { remaining: wood ? 2 : 3 };
    casingContacts.add(contact); casingPlayed++;
    const track = source => source.addEventListener('ended', () => { if (!--contact.remaining) casingContacts.delete(contact); }, { once: true });
    track(tone(out, t, { f0: f, f1: f * .985, dur: wood ? .04 : .095, peak: (wood ? .03 : .046) * strength, type: 'sine' }));
    if (!wood) track(tone(out, t, { f0: f * 2.64, f1: f * 2.61, dur: .035, peak: .012 * strength, type: 'sine' }));
    track(burst(out, t, { dur: .007, peak: .022 * strength, type: 'bandpass', freq: wood ? 2500 : 5600, q: 2 }));
    return true;
  }

  function bodyContactOutput(x, y, z, player, ref = 2.5, max = 40) {
    // Leave one of the eight slots for the player's own fall.
    if (bodyContacts.size >= MAX_BODY_CONTACTS || (!player && [...bodyContacts].filter(contact => !contact.player).length >= MAX_BODY_CONTACTS - 1)) { bodyCulled++; return false; }
    const gate = ctx.createGain(); gate.connect(sfx);
    const out = player ? transientBus(gate, [gate]) : spatial(x, y, z, { ref, max, destination: gate });
    if (!out) { gate.disconnect(); return false; }
    const contact = { gate, sources: new Set(), cancelled: false, player };
    bodyContacts.add(contact); bodyPlayed++;
    const track = source => {
      contact.sources.add(source);
      source.addEventListener('ended', () => {
        contact.sources.delete(source);
        if (!contact.sources.size) { bodyContacts.delete(contact); gate.disconnect(); }
      }, { once: true });
    };
    return { out, track };
  }

  /* A torso actually meeting its floor. The short clothing/kit detail
     belongs to this contact; the dropped rifle has its own physics. */
  function bodyImpact(x, y, z, surface = 'mud', speed = 4, player = false) {
    if (!ctx || ctx.state !== 'running' || !outdoors || ![x, y, z, speed].every(Number.isFinite) || speed <= .45) return false;
    const output = bodyContactOutput(x, y, z, player);
    if (!output) return false;
    const { out, track } = output;
    const t = ctx.currentTime + .001, kind = STEP[surface] || 'mud';
    const soft = kind === 'mud' || kind === 'grass' || kind === 'leaves' || kind === 'soft', water = kind === 'water';
    const strength = .62 * Math.min(1.1, Math.pow(speed / 4, .7)) * (player ? .72 : 1);
    track(burst(out, t, { dur: .18, peak: (water ? .19 : soft ? .27 : .31) * strength, type: 'lowpass', freq: water ? 240 : soft ? 290 : kind === 'wood' ? 350 : 480, q: .8, brown: true }));
    track(tone(out, t, { f0: 82, f1: 42, dur: .16, peak: (water || soft ? .12 : .16) * strength }));
    track(burst(out, t + .008, { dur: .1, peak: .06 * strength, type: 'bandpass', freq: 1000, q: .7 }));
    track(burst(out, t + .02, { dur: .04, peak: .035 * strength * (water ? .25 : soft ? .55 : 1), type: 'bandpass', freq: 2300, q: 2 }));
    if (water) track(burst(out, t + .01, { dur: .16, peak: .11 * strength, type: 'bandpass', freq: 650, sweepTo: 320, q: .8 }));
    else if (kind === 'wood') track(burst(out, t, { dur: .065, peak: .05 * strength, type: 'lowpass', freq: 1000, q: .7 }));
    return true;
  }

  function cancelContacts() {
    if (!ctx) return;
    for (const contact of bodyContacts) {
      if (contact.cancelled) continue;
      contact.cancelled = true;
      contact.gate.gain.cancelAndHoldAtTime(ctx.currentTime);
      contact.gate.gain.linearRampToValueAtTime(0, ctx.currentTime + .02);
      for (const source of contact.sources) { try { source.stop(ctx.currentTime + .04); } catch { /* already ended */ } }
    }
  }

  /* Legacy fallback for rigs without physical particles. */
  function bodyFall(x, y, z, surface = 'mud', delay = 0.5, player = false) {
    if (!ctx || ctx.state !== 'running' || !outdoors || ![x, y, z, delay].every(Number.isFinite)) return false;
    const output = bodyContactOutput(x, y, z, player, 3, 50);
    if (!output) return false;
    const { out, track } = output, t = ctx.currentTime + Math.max(0, delay);
    const kind = STEP[surface] || 'mud';
    track(burst(out, t, { dur: 0.22, peak: 0.55, type: 'lowpass', freq: kind === 'hard' ? 500 : 320, q: 0.9, brown: true }));
    track(tone(out, t, { f0: 85, f1: 45, dur: 0.18, peak: 0.35 }));
    if (kind === 'mud' || kind === 'water') track(burst(out, t + 0.03, { dur: 0.25, peak: 0.25, type: 'bandpass', freq: 800, sweepTo: 300, q: 1.5 }));
    kit(out, t + 0.03, 0.5, track);
    kit(out, t + 0.12, 0.3, track);
    const rt = t + 0.18 + R() * 0.2;
    track(burst(out, rt, { dur: 0.07, peak: 0.25, type: 'bandpass', freq: kind === 'hard' ? 1800 : 1000, q: 1.5 }));
    if (kind === 'hard') track(tone(out, rt, { f0: 900, f1: 850, dur: 0.15, peak: 0.05, type: 'triangle' }));
    return true;
  }

  function pin() {
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(sfx, t, { dur: 0.04, peak: 0.3, type: 'bandpass', freq: 3200, q: 4 });
    tone(sfx, t + 0.05, { f0: 3000, f1: 2500, dur: 0.15, peak: 0.08, type: 'triangle' });
  }

  function grenadeBounce(x, y, z) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 3, max: 40 });
    if (!out) return;
    burst(out, ctx.currentTime, { dur: 0.05, peak: 0.3, type: 'bandpass', freq: 1100, q: 2 });
  }

  function ui(kind = 'click') {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'objective') {
      tone(sfx, t, { f0: 440, f1: 440, dur: 0.25, peak: 0.12, type: 'triangle' });
      tone(sfx, t + 0.18, { f0: 660, f1: 660, dur: 0.4, peak: 0.12, type: 'triangle' });
    } else if (kind === 'checkpoint') {
      tone(sfx, t, { f0: 520, f1: 520, dur: 0.3, peak: 0.08, type: 'triangle' });
    } else if (kind === 'pickup') {
      burst(sfx, t, { dur: 0.06, peak: 0.25, type: 'bandpass', freq: 1800, q: 2 });
      tone(sfx, t + 0.04, { f0: 900, f1: 1200, dur: 0.12, peak: 0.06, type: 'triangle' });
    } else if (kind === 'hit') {
      burst(sfx, t, { dur: 0.03, peak: 0.18, type: 'bandpass', freq: 2800, q: 3 });
    } else if (kind === 'kill') {
      tone(sfx, t, { f0: 1600, f1: 1300, dur: 0.09, peak: 0.07, type: 'triangle' });
    } else if (kind === 'hurt') {
      burst(sfx, t, { dur: 0.15, peak: 0.45, type: 'lowpass', freq: 500, q: 1 });
      tone(sfx, t, { f0: 90, f1: 60, dur: 0.2, peak: 0.4 });
    } else if (kind === 'beep') {
      tone(sfx, t, { f0: 1200, f1: 1200, dur: 0.08, peak: 0.1, type: 'square' });
    }
  }

  /* ---------- weather and wildlife, moved on each frame by tick() ---------- */

  /* a sound around the listener, `d0`..`d1` metres off in a random direction (or on the line `z`,
     for the frogs on the water) */
  function around(d0, d1, max, z = null, y = null) {
    const a = R() * Math.PI * 2, d = d0 + R() * (d1 - d0);
    return spatial(listener.x + Math.sin(a) * d, y ?? listener.y + 2, z ?? listener.z + Math.cos(a) * d, { ref: 6, max, ambient: true });
  }

  /* a small bird: a few quick chirps, or now and then a crow */
  function bird(t) {
    const out = around(15, 60, 120);
    if (!out) return;
    if (R() < 0.2) {
      for (let i = 0, n = 2 + Math.floor(R() * 3); i < n; i++) {
        const tt = t + i * 0.42;
        tone(out, tt, { f0: 620, f1: 480, dur: 0.26, peak: 0.08, type: 'sawtooth' });
        burst(out, tt, { dur: 0.24, peak: 0.05, type: 'bandpass', freq: 1300, q: 3 });
      }
      return;
    }
    const f = 2600 + R() * 2200;
    for (let i = 0, n = 2 + Math.floor(R() * 6); i < n; i++) {
      const tt = t + i * (0.09 + R() * 0.07), up = R() < 0.5;
      tone(out, tt, { f0: f * (up ? 0.8 : 1.25), f1: f * (up ? 1.25 : 0.8), dur: 0.05 + R() * 0.05, peak: 0.035, type: 'sine' });
    }
  }

  /* a frog on the bank: a short train of rasping pulses */
  function frog(t) {
    const out = around(8, 45, 70, amb0.frogs + (R() * 2 - 1) * 12, amb0.frogsHeight);
    if (!out) return;
    const f = 380 + R() * 380;
    for (let i = 0, n = 3 + Math.floor(R() * 5); i < n; i++) burst(out, t + i * 0.035, { dur: 0.02, peak: 0.12, type: 'bandpass', freq: f, q: 9 });
  }

  /* bombers going over high up, unseen: the beat of many engines, swelling over half a minute and
     drifting across the sky */
  function aircraft(t) {
    if (aircraftPasses.size) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const pan = ctx.createStereoPanner();
    const from = R() < 0.5 ? -1.25 : 1.25, dur = 28 + R() * 12;
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(pan).connect(weather);
    const position = { bearing: listener.yaw + from, travel: -2 * from, start: t, duration: dur, moving: true, spread: .85, pan, revision: listenerRevision };
    applySpatial(position, t, true);
    transientBus(lp, [lp, g, pan], position);
    const pass = { gain: g, sources: new Set(), cancelled: false };
    aircraftPasses.add(pass);
    for (const f of [58, 59.3, 61.1, 87.5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (0.98 + R() * 0.04);
      o.connect(lp); attachSource(o, lp); o.onended = () => o.disconnect(); o.start(t); o.stop(t + dur + 0.1);
      pass.sources.add(o);
      o.addEventListener('ended', () => { pass.sources.delete(o); if (!pass.sources.size) aircraftPasses.delete(pass); }, { once: true });
    }
  }

  function cancelAircraft() {
    if (!ctx) return;
    for (const pass of aircraftPasses) {
      if (pass.cancelled) continue;
      pass.cancelled = true;
      pass.gain.gain.cancelAndHoldAtTime(ctx.currentTime);
      pass.gain.gain.setTargetAtTime(0, ctx.currentTime, .04);
      for (const source of pass.sources) { try { source.stop(ctx.currentTime + .2); } catch { /* already ended */ } }
    }
  }

  function rainLevels(ease = 0, swellOnly = false) {
    const levels = [
      [rainGain, .12 * amb0.rain * rainSwell * (1 - .38 * sheltered)],
      [patterGain, .32 * amb0.rain * rainSwell * (1 - .72 * sheltered)],
      [dripGain, .05 * Math.sqrt(amb0.rain) * (1 - .8 * sheltered)],
      [helmetGain, .045 * amb0.rain * (1 - sheltered)],
    ];
    for (const [node, level] of swellOnly ? levels.slice(0, 2) : levels) {
      if (ease) node.gain.setTargetAtTime(level, ctx.currentTime, ease);
      else {
        node.gain.cancelAndHoldAtTime(ctx.currentTime);
        node.gain.setValueAtTime(level, ctx.currentTime);
      }
    }
  }

  function shelterLevels() {
    if (!weather) return;
    const t = ctx.currentTime;
    weather.frequency.setTargetAtTime(20000 * Math.pow(.085, sheltered), t, .25);
    // An open-sided awning blocks drops while admitting most wind; a roof
    // surrounded by walls also reduces the outside bed's exposure.
    weatherExposure.gain.setTargetAtTime(1 - .65 * sheltered * (.25 + .75 * enclosure), t, .25);
    rainLevels(.15);
  }

  /* each frame: the wind gusting, the rain easing and coming on, and the wildlife, which falls quiet
     for a while after shooting close by */
  function tick() {
    if (!ctx || ctx.state !== 'running' || !outdoors) return;
    const t = ctx.currentTime;
    updateSpatial();
    fireAmbience?.update(t);
    radioAmbience?.update(t);
    // Ease the weather behind nearby combat, then restore it smoothly. Foley
    // and enemy cues remain on the SFX bus and retain their relative level.
    const target = t - lastLoud < 0.4 ? 0.63 : 1;
    if (target !== ambienceTarget) {
      ambienceTarget = target;
      amb.gain.setTargetAtTime(target, t, target < 1 ? 0.045 : 0.7);
    }
    if (t > next.gust) {
      const gust = amb0.wind * (0.45 + R() * R() * 1.4), ease = 0.8 + R() * 2.5;
      windGain.gain.setTargetAtTime(0.16 * gust, t, ease);
      windLP.frequency.setTargetAtTime(220 + 260 * gust, t, ease);
      whistle.gain.setTargetAtTime(0.012 * Math.max(0, gust - 0.9) ** 2, t, ease);
      whistleBP.frequency.setTargetAtTime(700 + R() * 500, t, ease);
      next.gust = t + 3 + R() * 9;
    }
    if (t > next.swell) {
      rainSwell = 0.75 + R() * 0.45;
      rainLevels(4, true);
      next.swell = t + 10 + R() * 20;
    }
    const calm = t - lastLoud > 25;
    if (t > next.bird) { if (amb0.birds && calm) bird(t); next.bird = t + 2 + R() * 7 * (0.5 + amb0.rain); }
    if (t > next.frog) { if (amb0.frogs !== null && calm) frog(t); next.frog = t + 0.4 + R() * 1.6; }
    if (t > next.plane) { if (amb0.aircraft) aircraft(t); next.plane = t + 70 + R() * 80; }
  }

  /* dazed by a blast (0 clear .. 1 stunned; each frame): the world shut down to 250 Hz at
     worst and the ears ringing, both easing as it wears off */
  function daze(level) {
    if (!ctx || (Math.abs(level - dazed) < 0.002 && (level > 0 || dazed === 0))) return;
    dazed = level;
    const t = ctx.currentTime;
    dull.frequency.setTargetAtTime(20000 * Math.pow(0.0125, level), t, 0.05);
    ring.gain.setTargetAtTime(0.035 * level * level, t, 0.1);
  }

  function mixLevel(node, value) {
    if (!node) return;
    node.gain.cancelAndHoldAtTime(ctx.currentTime);
    if (ctx.state !== 'running') node.gain.setValueAtTime(value, ctx.currentTime);
    else node.gain.linearRampToValueAtTime(value, ctx.currentTime + .02);
  }

  return {
    init, prepare, loadSamples,
    // Preserve the previous loader API while reporting the active manifest.
    preloadSamples() { return loadSamples().then(() => ({ loaded: samples.size, failed: sampleFailed, total: SAMPLE_TOTAL })); },
    // Read-only diagnostics for the audio settings/debug and browser smoke tests.
    get sampleStatus() { return { ready: samples.size, failed: sampleFailed, total: SAMPLE_TOTAL, active: sampleVoices.size }; },
    get voiceStatus() { return { limit: MAX_SAMPLE_VOICES, stolen: sampleStolen, culled: sampleCulled, player: [...sampleVoices].filter(voice => voice.priority >= 3).length }; },
    get sampleLoadDetails() { return { retries: sampleRetries, failures: sampleErrors.map(error => ({ ...error })) }; },
    get acousticStatus() { return occlusion.status; },
    get environmentStatus() { return { shelter: sheltered, enclosure }; },
    get actionStatus() { return playerActions?.status ?? { active: 0, sources: 0, pending: 0, dispatched: 0, evicted: 0, rejected: 0, maxActions: 4, maxCues: 32 }; },
    get actorActionStatus() { return actorActions?.status ?? { active: 0, sources: 0, pending: 0, dispatched: 0, evicted: 0, rejected: 0, maxActions: 12, maxCues: 32 }; },
    get nodeStatus() { return { oneShotBuses: activeBuses.size }; },
    get casingStatus() { return { active: casingContacts.size, played: casingPlayed, culled: casingCulled, max: MAX_CASING_CONTACTS }; },
    get bodyContactStatus() { return { active: bodyContacts.size, sources: [...bodyContacts].reduce((n, contact) => n + contact.sources.size, 0), retiring: [...bodyContacts].filter(contact => contact.cancelled).length, played: bodyPlayed, culled: bodyCulled, max: MAX_BODY_CONTACTS }; },
    get aircraftStatus() {
      const retiring = [...aircraftPasses].filter(pass => pass.cancelled).length;
      return { active: aircraftPasses.size - retiring, retiring, max: 1 };
    },
    get horizonStatus() { return { active: horizonReports.size, pending: [...horizonReports].filter(report => !report.cancelled && report.start > ctx.currentTime).length, sources: [...horizonReports].reduce((count, report) => count + report.sources.size, 0), max: MAX_HORIZON_REPORTS, culled: horizonCulled }; },
    get spatialStatus() { return { updates: spatialUpdates, peak: peakSpatialUpdates, budget: SPATIAL_BUDGET, interval: SPATIAL_INTERVAL }; },
    get fireStatus() { return fireAmbience?.status ?? { active: 0, retiring: 0, max: 4, sources: fireSources.length, pathUpdates: 0, interval: .25, prepared: false, textureBytes: 0 }; },
    get radioStatus() { return radioAmbience?.status ?? { active: 0, retiring: 0, max: 2, sources: radioSources.length, pathUpdates: 0, interval: .125, prepared: false, textureBytes: 0, gateErrors: 0 }; },
    get ready() { return !!ctx; },
    setVolume(v) {
      const target = Number(v);
      if (!Number.isFinite(target)) return;
      volume = Math.max(0, Math.min(1, target));
      // Reach exact silence, including the separate concussion ring bus.
      mixLevel(master, volume); mixLevel(ringVolume, volume * mix.effects);
    },
    setMix({ effects = mix.effects, ambience = mix.ambience } = {}) {
      if (Number.isFinite(effects)) mix.effects = Math.max(0, Math.min(1, effects));
      if (Number.isFinite(ambience)) mix.ambience = Math.max(0, Math.min(1, ambience));
      mixLevel(sfx, mix.effects); mixLevel(ambienceMix, mix.ambience);
      mixLevel(ringVolume, volume * mix.effects);
    },
    setListener(x, y, z, yaw) {
      if (x !== listener.x || y !== listener.y || z !== listener.z || yaw !== listener.yaw) listenerRevision++;
      listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw;
      occlusion.setListener(x, y, z); updateSpatial();
    },
    // Install once per world; a null probe restores the unobstructed mix.
    // See audio-space.js for the callback and strictly bounded trace budget.
    setOcclusionProbe(fn) { occlusion.setProbe(fn); },
    // Keep the effects system's live fire array; on/off and later pushes are
    // observed at 4 Hz, while only the four nearest sources receive voices.
    setFireSources(fires) { fireSources = Array.isArray(fires) ? fires : []; fireAmbience?.setSources(fireSources); },
    // An explicitly active receiver is audible only within the mission. The
    // active callback can read the live objective phase without per-frame setup.
    setRadioSources(sources) { radioSources = Array.isArray(sources) ? sources : []; radioAmbience?.setSources(radioSources); },
    setShelter(coverage) {
      if (!Number.isFinite(coverage)) return;
      const target = Math.max(0, Math.min(1, coverage));
      if (Math.abs(target - sheltered) < .01) return;
      sheltered = target; shelterLevels();
    },
    /* the level's ambience: rain (0..1), wind ([x, z], its strength), birds, aircraft, and frogs
       (the water's z line and the world height of its bank calls). Each call
       stays at its emission point when the listener moves or climbs. */
    setAmbience({ rain = 1, wind = [1.6, 0.7], birds = false, aircraft = false, frogs = null, frogsHeight = .2 } = {}) {
      Object.assign(amb0, { rain, wind: Math.hypot(wind[0], wind[1]) / 1.75, birds, aircraft, frogs, frogsHeight: Number.isFinite(frogsHeight) ? frogsHeight : .2 });
      next.gust = next.swell = 0;
      if (rainGain) rainLevels();
    },
    tick,
    advanceActions(dt) { playerActions?.advance(dt); },
    /* the weather and wildlife heard (in the mission) or faded out (the menus) */
    setOutdoors(on) {
      if (!on) cancelHorizon();
      if (!on) cancelAircraft();
      if (!on) actorActions?.cancel();
      if (!on) cancelContacts();
      if (on === outdoors || !amb) return;
      outdoors = on;
      ambienceTarget = on ? 1 : 0;
      amb.gain.setTargetAtTime(ambienceTarget, ctx.currentTime, 0.4);
      if (!on) fireAmbience?.stop();
      if (!on) radioAmbience?.stop();
    },
    /* Where the listener stands, for the echoes (main.js): `closed`, how much of the horizon round
       him is walls, banks or trees within 30 m (0..1), and `dist`, how far off they are on average.
       A street between houses rings with quick, bright, repeated echoes; out in a field a shot
       comes back once, late and dull, off the far hedges. */
    setSpace(closed, dist) {
      const previous = enclosure;
      enclosure = Math.max(0, Math.min(1, closed));
      if (sheltered && weatherExposure && Math.abs(enclosure - previous) > .01) weatherExposure.gain.setTargetAtTime(1 - .65 * sheltered * (.25 + .75 * enclosure), ctx.currentTime, .25);
      if (!echoA) return;
      const t = ctx.currentTime, k = 0.6;
      const first = Math.min(0.2, Math.max(0.03, (2 * dist) / 343));
      echoA.delayTime.setTargetAtTime(first, t, k);
      echoB.delayTime.setTargetAtTime(Math.min(0.45, first * 2.2 + 0.08 * (1 - closed)), t, k);
      echoFb.gain.setTargetAtTime(0.12 + 0.38 * closed, t, k);
      echoLP.frequency.setTargetAtTime(1500 + 2500 * closed, t, k);
      verb.gain.setTargetAtTime(0.22 + 0.25 * closed, t, k);
    },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
    gunshot, garandPing, dryFire, reload, reloadActor, switchWeapon, cancelActions, whizz, impact, explosion, thunder, distant,
    footstep, gear, casing, casingImpact, bodyFall, bodyImpact, cancelContacts, pin, grenadeBounce, ui, daze,
  };
}
