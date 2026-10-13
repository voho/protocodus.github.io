/* Meteora — the cockpit's ears.

   Space carries no sound. A fighter's computer can make some, though: it
   turns what the sensors track into sound placed where each thing is —
   every gun that fires, every hit, every engine within a mile — which is
   the conceit Elite and most films use: honest physics, invented ears.

     engine    ours, and not placed, because it is the seat: a dark drone
               whose pitch glides with speed and never steps (a saw, its
               octave and a sine through a lowpass that opens with thrust), a
               rumble that is the thrust itself, and the afterburner's roar
               and crackle swelling over both, lit with a whoomp
     cockpit   target changes, and the lock tone: beeps that quicken as the
               lock builds, then one steady tone while it holds
     ships     the nearest interceptors' engines, each a jet whine placed at
               its ship, dulled by distance and bent by doppler, so a flyby
               rises, roars past and drops
     missiles  the motor hiss of each missile in flight
     shots     ours from the muzzles, theirs from wherever they are
     hits      on rock, on shields and on hulls; on our own ship, close and
               unplaced
     blasts    breaking rocks, warheads, interceptors and our own fighter

   Placement is Web Audio's HRTF panner, with the listener riding the
   camera. Web Audio no longer does doppler, so it is done here, per voice,
   from the closing speed. The sounds themselves are synthesised
   (sounds.js) in slices while the game loads; the context starts on the
   Launch click, as browsers require, and a later click or key retries it
   if the browser held it back. */

import * as THREE from 'three';
import { AUDIO } from './config.js';
import { RATE, doppler, enginePitch, lockBeepInterval, loops, muffle, synthesizeBank } from './sounds.js';

export function createAudio(volume = 0.8) {
  const samples = {};
  const job = synthesizeBank((name, data) => (samples[name] ??= []).push(data));
  const slice = () => {
    const end = performance.now() + 6;
    while (performance.now() < end) if (job.next().done) return;
    setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
  const loopData = loops();

  let ctx = null, master = null, hush = null, sfx = null, cockpit = null, engineBus = null;
  let loopBuffers = null, engine = null, burner = null, lock = null;
  let level = volume, paused = false, wanted = false;
  const buffers = {}, ships = new Map(), missiles = new Map();
  const ear = { pos: [0, 0, 0], vel: [0, 0, 0], ready: false };
  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  let shots = 0, lastBump = -Infinity, lastTarget = null, burning = false, pick = 0;

  /* ---------- the graph ---------- */

  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filter = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
  // A looped noise starting somewhere random, so voices never phase together.
  const loop = name => {
    const s = ctx.createBufferSource();
    s.buffer = loopBuffers[name]; s.loop = true;
    s.start(0, Math.random() * s.buffer.duration);
    return s;
  };
  const toBuffer = data => {
    const b = ctx.createBuffer(1, data.length, RATE);
    b.copyToChannel(data, 0);
    return b;
  };
  const panner = (ref, rolloff, model = 'HRTF') => {
    const p = ctx.createPanner();
    p.panningModel = model; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 20000;
    return p;
  };
  const glide = (param, value, now, tau) => param.setTargetAtTime(value, now, tau);
  // Older Safari has no position AudioParams, only a setter. A new voice
  // jumps to its place rather than gliding there from the origin.
  const place = (p, x, y, z, now, jump = false) => {
    if (!p.positionX) p.setPosition(x, y, z);
    else if (jump) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else { glide(p.positionX, x, now, 0.015); glide(p.positionY, y, now, 0.015); glide(p.positionZ, z, now, 0.015); }
  };

  function build() {
    master = gain(AUDIO.master * level * level);
    hush = gain(paused ? 0 : 1);
    // A soft limiter on the way out: a kill on top of cannon fire on top of
    // the afterburner would otherwise clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 12; limiter.ratio.value = 8;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    master.connect(hush).connect(limiter).connect(ctx.destination);
    sfx = gain(1); cockpit = gain(0.8); engineBus = gain(0.9);
    for (const bus of [sfx, cockpit, engineBus]) bus.connect(master);
    loopBuffers = Object.fromEntries(Object.entries(loopData).map(([k, data]) => [k, toBuffer(data)]));

    engine = { out: gain(0), tone: filter('lowpass', 300, 0.9), a: osc('sawtooth', 40), b: osc('sawtooth', 40), c: osc('sine', 40) };
    // The second saw sits an exact octave up. Detuned saws were tried: at
    // these pitches they beat once every few seconds, and the drone swelled
    // and faded on its own.
    const body = gain(0.5), second = gain(0.35);
    engine.a.connect(engine.tone); engine.b.connect(second).connect(engine.tone); engine.c.connect(body).connect(engine.out);
    engine.tone.connect(engine.out);
    engine.rumbleF = filter('lowpass', 120, 0.8); engine.rumble = gain(0);
    loop('brown').connect(engine.rumbleF).connect(engine.rumble).connect(engine.out);
    engine.flowF = filter('bandpass', 600, 1.2); engine.flow = gain(0);
    loop('noise').connect(engine.flowF).connect(engine.flow).connect(engine.out);
    engine.out.connect(engineBus);

    burner = { out: gain(0), roarF: filter('bandpass', 450, 0.7) };
    loop('noise').connect(burner.roarF).connect(gain(0.9)).connect(burner.out);
    loop('brown').connect(filter('lowpass', 380, 0.8)).connect(burner.out);
    loop('crackle').connect(filter('highpass', 1500)).connect(gain(0.8)).connect(burner.out);
    burner.out.connect(engineBus);

    lock = { out: gain(0), tone: osc('triangle', 1180), next: 0, mode: 'off' };
    lock.tone.connect(lock.out).connect(cockpit);
  }

  /* ---------- one-shots ---------- */

  function bufferFor(name) {
    const takes = samples[name];
    if (!takes?.length) return null;
    const k = Math.floor(Math.random() * takes.length), made = (buffers[name] ??= []);
    return made[k] ?? (made[k] = toBuffer(takes[k]));
  }

  /* A sound at `pos` (world metres), or unplaced when there is none.
     `vel` is the source's velocity, for doppler; `ref` is the distance it
     plays at full `gain`, falling off as ref / distance beyond. */
  function play(name, { pos = null, vel = null, gain: g = 1, rate = 1, ref = 40, bus = sfx } = {}) {
    if (!ctx || ctx.state !== 'running' || paused || shots >= AUDIO.oneShots) return;
    const buffer = bufferFor(name);
    if (!buffer) return;
    let d = 0, bend = 1;
    if (pos) {
      const rx = pos[0] - ear.pos[0], ry = pos[1] - ear.pos[1], rz = pos[2] - ear.pos[2];
      d = Math.hypot(rx, ry, rz);
      if (g * ref / Math.max(ref, d) < 0.004) return;
      if (vel) bend = doppler(rx, ry, rz, vel[0] - ear.vel[0], vel[1] - ear.vel[1], vel[2] - ear.vel[2]);
    }
    const src = ctx.createBufferSource(), amp = gain(g), nodes = [src, amp];
    src.buffer = buffer;
    src.playbackRate.value = rate * bend * (0.97 + 0.06 * Math.random());
    src.connect(amp);
    if (pos) {
      // Far sounds go through the cheaper panner: no ear can place a
      // distant boom to the degree.
      const dull = filter('lowpass', muffle(d)), p = panner(ref, 1, d < 400 ? 'HRTF' : 'equalpower');
      place(p, pos[0], pos[1], pos[2], 0, true);
      amp.connect(dull).connect(p).connect(bus);
      nodes.push(dull, p);
    } else amp.connect(bus);
    shots++;
    src.onended = () => { shots--; for (const n of nodes) n.disconnect(); };
    src.start();
  }

  const velocityOf = (world, id) => world.byId.get(id)?.ship.vel ?? null;
  // Engines worth hearing: every small craft but our own.
  const flyers = world => world.entities.filter(e => e.alive && !e.big && e !== world.player && !e.folding);
  let alarmAt = 0, warnAt = 0, scanAt = 0, weldAt = 0, lastShield = 1;

  function handle(e, world) {
    if (!ctx) return;
    const p = world.player;
    switch (e.type) {
      case 'fire':
        if (e.turret) { play(e.weapon === 'tailgun' ? 'cannon' : 'turret', { pos: e.pos, vel: e.vel, gain: e.weapon === 'tailgun' ? 0.22 : 0.5, rate: e.weapon === 'tailgun' ? 1.25 : 1, ref: e.weapon === 'tailgun' ? 20 : 60 }); break; }
        if (e.team === 0 && e.player) play('cannon', { pos: e.pos, gain: 0.3, rate: e.weapon === 'needle' ? 1.35 : e.weapon === 'breaker' ? 0.62 : e.weapon === 'ion' ? 1.12 : 1, ref: 20 });
        else play(e.team === 0 ? 'cannon' : 'enemyCannon', { pos: e.pos, vel: velocityOf(world, e.shipId), gain: e.team === 0 ? 0.32 : 0.5, ref: 40 });
        break;
      case 'missileLaunch':
        if (e.torpedo) play('torpedoLaunch', { pos: e.pos, gain: e.player ? 0.8 : 0.7, ref: 60 });
        else play('missileLaunch', { pos: e.pos, gain: 0.7, ref: 25 });
        break;
      case 'boltHit': {
        const name = e.kind === 'rock' ? 'hitRock' : e.shielded ? 'hitShield' : 'hitHull';
        if (e.targetId === p?.id) play(name, { gain: 0.85, rate: 0.9 });
        else play(name, { pos: e.pos, vel: e.vel, gain: 0.55, ref: e.big ? 70 : 35 });
        break;
      }
      case 'rockBreak':
        if (e.crumble) play('rockBreak', { pos: e.pos, gain: 0.12, rate: 1.5, ref: 25 });
        // Smaller rocks crack higher.
        else play('rockBreak', { pos: e.pos, vel: e.vel, gain: 0.45 + 0.03 * e.radius, rate: 1.35 - 0.035 * e.radius, ref: 40 + 4 * e.radius });
        break;
      case 'missileExplode': case 'missileExpire': play('blast', { pos: e.pos, vel: e.vel, gain: e.torpedo ? 1.3 : 1, rate: e.torpedo ? 0.7 : 1, ref: e.torpedo ? 220 : 110 }); break;
      case 'missileDestroyed': play('flak', { pos: e.pos, gain: 0.8, rate: 1.2, ref: 80 }); break;
      case 'flak': play('flak', { pos: e.pos, gain: 0.7, ref: 70 }); break;
      case 'shipKilled':
        if (e.team === 0 && e.id === p?.id) play('playerExplosion', { gain: 1.2 });
        else if (e.big) play('bigExplosion', { pos: e.pos, vel: e.vel, gain: 1.5, ref: 600 });
        else play('shipExplosion', { pos: e.pos, vel: e.vel, gain: 1.1, ref: 140 });
        break;
      case 'collision':
        // A scrape reports every step it lasts; it is heard as one knock.
        // Unlike the camera shake, a bump too gentle to do damage is heard.
        if (e.id === p?.id && e.speed > 3 && ctx.currentTime - lastBump > 0.25) {
          lastBump = ctx.currentTime;
          play('hitRock', { gain: Math.min(1, e.speed / 40), rate: 0.6 });
        }
        break;
      case 'radioLine': play('radio', { gain: 0.35, bus: cockpit }); break;
      case 'objective':
        if (e.state === 'done') play('objective', { gain: 0.55, bus: cockpit });
        else if (e.state === 'failed') play('objectiveFail', { gain: 0.6, bus: cockpit });
        break;
      case 'scanned': play('objective', { gain: 0.4, rate: 1.25, bus: cockpit }); break;
      case 'hitMarker': if (e.kill) play('killChime', { gain: 0.35, bus: cockpit }); break;
      case 'score': if (e.streak >= 2) play('streak', { gain: 0.4, rate: Math.pow(2, (Math.min(5, e.streak) - 2) / 6), bus: cockpit }); break;
      case 'detected': play('detected', { gain: 0.6, bus: cockpit }); break;
      case 'foldIn': play('foldIn', { pos: e.pos, gain: e.big ? 1.4 : 0.8, rate: e.big ? 0.7 : 1, ref: e.big ? 500 : 120 }); break;
      case 'foldOut': play('foldOut', { pos: e.pos, gain: e.big ? 1.2 : 0.7, rate: e.big ? 0.7 : 1, ref: e.big ? 500 : 120 }); break;
      case 'beamCharge': play('beamCharge', { pos: e.pos, gain: 1.2, ref: 600 }); break;
      case 'beamFire': play('beamFire', { pos: e.pos, gain: 1.4, ref: 800 }); break;
      case 'tenderDocked': if (e.patientId === p?.id) play('dock', { gain: 0.7, bus: cockpit }); break;
      case 'tenderDone': if (e.patientId === p?.id) play('repairDone', { gain: 0.5, bus: cockpit }); break;
      case 'repairCalled': play('radio', { gain: 0.35, bus: cockpit }); break;
      case 'repairDenied': case 'dryFire': play('uiClick', { gain: 0.4, rate: 0.6, bus: cockpit }); break;
      case 'bankChange': case 'navChange': case 'shieldsLevelled': play('uiClick', { gain: 0.35, bus: cockpit }); break;
      case 'missionWon': play('missionWon', { gain: 0.55, bus: cockpit }); break;
      case 'missionLost': play('missionLost', { gain: 0.55, bus: cockpit }); break;
      case 'hatch': play('rockBreak', { pos: e.pos, gain: 1, rate: 0.6, ref: 120 }); break;
      case 'impact': play('bigExplosion', { pos: e.pos, gain: 1.2, rate: 1.3, ref: 400 }); break;
      case 'jump': play('jump', { gain: 1 }); break;
      case 'shieldsCollapse': if (e.id === p?.id) play('shieldsDown', { gain: 0.6, bus: cockpit }); break;
    }
  }

  /* Cockpit cues that repeat while something holds: the hull alarm,
     torpedo warnings, the scan's ticking, the Tender's welding. */
  function cues(world, now) {
    const p = world.player;
    if (!p?.alive || world.state !== 'flying') return;
    const hullF = p.hull / p.maxHull;
    if (hullF < 0.3 && now > alarmAt) { play('alarm', { gain: 0.32, bus: cockpit }); alarmAt = now + 1.4; }
    const shieldF = p.maxShield ? p.shield / p.maxShield : 1;
    if (shieldF < 0.01 && lastShield >= 0.01) play('shieldsDown', { gain: 0.5, bus: cockpit });
    lastShield = shieldF;
    let inbound = false;
    for (const m of world.weapons.missiles) if (m.team === 1 && m.targetId != null && (m.targetId === p.id || m.hp > 0)) { inbound = true; break; }
    if (inbound && now > warnAt) { play('torpedoWarn', { gain: 0.22, bus: cockpit }); warnAt = now + 1.1; }
    if (world.scanning?.inRange && world.scanning.inCone && now > scanAt) { play('scanTick', { gain: 0.3, bus: cockpit }); scanAt = now + 0.22; }
    const drone = world.repair?.droneId != null ? world.byId.get(world.repair.droneId) : null;
    if (drone?.tender?.state === 'docked' && now > weldAt) { play('weld', { gain: 0.25, bus: cockpit }); weldAt = now + 1.1; }
  }

  /* ---------- continuous voices ---------- */

  // The listener rides the camera; its velocity, for doppler, is the
  // camera's own, so it is right for the chase view and the death view alike.
  function listen(camera, dt, now) {
    const p = camera.position;
    let cut = !ear.ready;
    if (!cut && dt > 0) {
      const vx = (p.x - ear.pos[0]) / dt, vy = (p.y - ear.pos[1]) / dt, vz = (p.z - ear.pos[2]) / dt;
      // A jump faster than anything flies is a cut (a restart, the launch):
      // the ear lands there rather than racing there, and hears no doppler.
      cut = vx * vx + vy * vy + vz * vz > 4e6;
      const k = cut ? 1 : 1 - Math.exp(-dt * 10);
      ear.vel[0] += ((cut ? 0 : vx) - ear.vel[0]) * k;
      ear.vel[1] += ((cut ? 0 : vy) - ear.vel[1]) * k;
      ear.vel[2] += ((cut ? 0 : vz) - ear.vel[2]) * k;
    }
    ear.pos[0] = p.x; ear.pos[1] = p.y; ear.pos[2] = p.z; ear.ready = true;
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const L = ctx.listener;
    // Firefox's listener has no AudioParams either.
    if (!L.forwardX) { L.setPosition(p.x, p.y, p.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); return; }
    place(L, p.x, p.y, p.z, now, cut);
    glide(L.forwardX, fwd.x, now, 0.015); glide(L.forwardY, fwd.y, now, 0.015); glide(L.forwardZ, fwd.z, now, 0.015);
    glide(L.upX, up.x, now, 0.015); glide(L.upY, up.y, now, 0.015); glide(L.upZ, up.z, now, 0.015);
  }

  function driveEngine(p, flying, now) {
    const s = p.ship, on = flying && p.alive;
    const speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]), thrust = Math.min(1, s.thrust);
    const f = enginePitch(speed);
    glide(engine.a.frequency, f, now, 0.08); glide(engine.b.frequency, 2 * f, now, 0.08); glide(engine.c.frequency, f, now, 0.08);
    glide(engine.tone.frequency, f * (5 + 9 * thrust), now, 0.1);
    glide(engine.rumbleF.frequency, 70 + 260 * thrust, now, 0.1);
    glide(engine.rumble.gain, 0.25 + 0.55 * thrust, now, 0.1);
    glide(engine.flowF.frequency, 300 + 6 * speed, now, 0.1);
    glide(engine.flow.gain, 0.02 + 0.06 * Math.min(1, speed / 320), now, 0.2);
    glide(engine.out.gain, on ? 0.12 + 0.2 * thrust : 0, now, on ? 0.15 : 0.06);
    const burn = on && s.afterburner;
    // The burner roars louder and brighter as it builds.
    const build = s.burnRamp ?? 0;
    glide(burner.out.gain, burn ? 0.32 + 0.22 * build : 0, now, burn ? 0.08 : 0.3);
    glide(burner.roarF.frequency, burn ? 800 + 600 * build : 450, now, 0.3);
    if (burn && !burning) play('afterburnerIgnite', { gain: 0.6, bus: engineBus });
    burning = burn;
  }

  function driveLock(world, now) {
    const p = world.player, t = world.target, L = world.lock;
    const live = world.state === 'flying' && p.alive && t?.alive && (p.banks?.[p.bank]?.count ?? 0) > 0 && L.valid !== false && L.targetId === t.id && L.progress > 0;
    const mode = !live ? 'off' : L.locked ? 'locked' : 'locking';
    const g = lock.out.gain;
    if (mode !== lock.mode) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      if (mode === 'locked') {
        play('lockOn', { gain: 0.5, bus: cockpit });
        lock.tone.frequency.setValueAtTime(1560, now);
        g.setTargetAtTime(0.05, now + 0.12, 0.015);
      } else {
        lock.tone.frequency.setValueAtTime(1180, now);
        g.setTargetAtTime(0, now, 0.01);
      }
      lock.next = now;
      lock.mode = mode;
    }
    // Beeps are booked a little ahead on the audio clock, so a slow frame
    // never makes them stutter.
    if (mode === 'locking') {
      while (lock.next < now + 0.12) {
        const at = Math.max(lock.next, now);
        g.setValueAtTime(0, at); g.linearRampToValueAtTime(0.07, at + 0.004);
        g.setValueAtTime(0.07, at + 0.045); g.linearRampToValueAtTime(0, at + 0.05);
        lock.next = at + lockBeepInterval(L.progress);
      }
    }
    const id = t?.alive ? t.id : null;
    if (id !== lastTarget && id !== null && world.state === 'flying') play('targetChange', { gain: 0.45, bus: cockpit });
    lastTarget = id;
  }

  function release(voice, now) {
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setTargetAtTime(0, now, 0.08);
    for (const s of voice.sources) s.stop(now + 0.6);
    voice.sources[0].onended = () => { for (const n of voice.nodes) n.disconnect(); };
  }

  function shipVoice() {
    const out = gain(0), tone = filter('lowpass', 2000, 0.8), p = panner(30, 1.1);
    const a = osc('sawtooth', 80), b = osc('square', 80), bLevel = gain(0.25);
    b.detune.value = -7;
    a.connect(tone); b.connect(bLevel).connect(tone); tone.connect(out);
    const jet = loop('noise'), jetF = filter('bandpass', 1400, 1), jetLevel = gain(0.9);
    jet.connect(jetF).connect(jetLevel).connect(out);
    out.connect(p).connect(sfx);
    return { out, tone, a, b, jet, jetF, panner: p, fresh: true, sources: [a, b, jet], nodes: [out, tone, p, a, b, bLevel, jet, jetF, jetLevel] };
  }

  function missileVoice() {
    const out = gain(0), p = panner(20, 1.2);
    const hiss = loop('noise'), hissF = filter('bandpass', 2400, 0.9), roar = loop('brown'), roarF = filter('lowpass', 500, 0.8);
    hiss.connect(hissF).connect(out); roar.connect(roarF).connect(out);
    out.connect(p).connect(sfx);
    return { out, hiss, hissF, roar, panner: p, fresh: true, sources: [hiss, roar], nodes: [out, p, hiss, hissF, roar, roarF] };
  }

  // Bend, dull and place a voice for a source at `pos` moving at `vel`.
  function aim(voice, pos, vel, now) {
    const rx = pos[0] - ear.pos[0], ry = pos[1] - ear.pos[1], rz = pos[2] - ear.pos[2];
    place(voice.panner, pos[0], pos[1], pos[2], now, voice.fresh);
    voice.fresh = false;
    return {
      bend: doppler(rx, ry, rz, vel[0] - ear.vel[0], vel[1] - ear.vel[1], vel[2] - ear.vel[2]),
      dull: muffle(Math.hypot(rx, ry, rz)),
    };
  }

  /* The nearest few of something get voices; the choice is remade four
     times a second, and a source that drops out fades rather than stops. */
  function choose(voices, sources, range, max, make, now) {
    const near = [];
    for (const s of sources) {
      const d = Math.hypot(s.pos[0] - ear.pos[0], s.pos[1] - ear.pos[1], s.pos[2] - ear.pos[2]);
      if (d < range) near.push({ id: s.id, d });
    }
    near.sort((a, b) => a.d - b.d);
    const keep = new Set(near.slice(0, max).map(n => n.id));
    for (const [id, v] of voices) if (!keep.has(id)) { release(v, now); voices.delete(id); }
    for (const id of keep) if (!voices.has(id)) voices.set(id, make());
  }

  function driveShips(world, now) {
    for (const e of flyers(world)) {
      const v = ships.get(e.id);
      if (!v) continue;
      if (!e.alive) { release(v, now); ships.delete(e.id); continue; }
      const s = e.ship, { bend, dull } = aim(v, s.pos, s.vel, now);
      const speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]), push = Math.min(1, s.thrust + (s.afterburner ? 1 : 0));
      const f = (70 + 0.1 * speed) * bend;
      glide(v.a.frequency, f, now, 0.05); glide(v.b.frequency, f, now, 0.05);
      glide(v.jet.playbackRate, bend, now, 0.05);
      glide(v.jetF.frequency, 1400 * bend * (0.8 + 0.4 * push), now, 0.05);
      glide(v.tone.frequency, Math.min(dull, 600 + 2500 * push), now, 0.05);
      glide(v.out.gain, 0.35 + 0.35 * push, now, 0.1);
    }
  }

  function driveMissiles(world, now) {
    for (const [id, v] of missiles) {
      const m = world.weapons.missiles.find(x => x.id === id);
      if (!m) { release(v, now); missiles.delete(id); continue; }
      const { bend, dull } = aim(v, m.pos, m.vel, now);
      glide(v.hiss.playbackRate, bend, now, 0.04); glide(v.roar.playbackRate, bend, now, 0.04);
      glide(v.hissF.frequency, Math.min(dull, 2400 * bend), now, 0.04);
      glide(v.out.gain, m.motor ? 0.6 : 0, now, 0.05);
    }
  }

  function update(world, camera, dt) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    listen(camera, dt, now);
    driveEngine(world.player, world.state === 'flying', now);
    cues(world, now);
    driveLock(world, now);
    pick -= dt;
    if (pick <= 0) {
      pick = 0.25;
      choose(ships, flyers(world).map(e => ({ id: e.id, pos: e.ship.pos })),
        AUDIO.shipRange, AUDIO.shipVoices, shipVoice, now);
      choose(missiles, world.weapons.missiles.map(m => ({ id: m.id, pos: m.pos })), AUDIO.missileRange, 6, missileVoice, now);
    }
    driveShips(world, now);
    driveMissiles(world, now);
  }

  const resume = () => { if (ctx && wanted && !paused && !document.hidden && ctx.state !== 'running') ctx.resume().catch(() => {}); };
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, resume, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx?.suspend().catch(() => {}); else resume(); });

  return {
    get context() { return ctx; },
    get ready() { return Object.keys(samples).length; },
    // Call from a user gesture.
    start() {
      wanted = true;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
        build();
      }
      resume();
    },
    setVolume(v) {
      level = v;
      if (ctx) glide(master.gain, AUDIO.master * v * v, ctx.currentTime, 0.05);
    },
    setPaused(p) {
      paused = p;
      if (ctx) glide(hush.gain, p ? 0 : 1, ctx.currentTime, 0.05);
      if (!p) resume();
    },
    handle, update,
    // Menu sounds, unplaced.
    ui(name) { play(name === 'hover' ? 'uiHover' : 'uiClick', { gain: name === 'hover' ? 0.18 : 0.35, bus: cockpit }); },
    get ctx() { return ctx; },
    get output() { return master; },
    // A restarted run: no ships or missiles left to hear.
    reset() {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const map of [ships, missiles]) { for (const v of map.values()) release(v, now); map.clear(); }
      lastTarget = null; burning = false; pick = 0;
    },
  };
}
