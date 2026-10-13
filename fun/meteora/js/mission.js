/* Meteora — missions: briefings, objectives, radio and the script.

   A mission is a plain object (see missions/m01.js): what the briefing
   says and shows, what it recommends, the belt it happens in, a `setup` that
   places the opening scene and a `script` — a generator that reads like a
   screenplay:

     *script(m) {
       yield m.say('doukas', 'Lantern, Perpetua. Nav Alpha is the Saint Amaro\'s last fix.');
       m.objective('alpha', 'Fly to Nav Alpha');
       yield m.until(() => m.near(m.player, m.navPoint('alpha'), 400));
       m.complete('alpha');
     }

   `yield` takes a wait: `m.wait(seconds)`, `m.until(test, timeout)`, a
   radio line (which lasts as long as it takes to read), or nothing (the
   next tick). `m.thread(gen)` runs another script alongside. Scripts tick
   at 20 Hz inside the fixed step, use the world's seeded RNG and never the
   clock, so a mission plays the same way every time it is given the same
   inputs — which is how the checks play every mission headless.

   The runtime also keeps the objectives (primary ones must all succeed;
   bonus ones raise the medal), countdown timers, the radio log, the
   tutorial hints, and the rules every mission shares: the player's death
   loses it, a failed critical objective loses it. */

import { spawn, spawnPlayer, foldOut as worldFoldOut } from './world.js';
import { fireBeam } from './turrets.js';
import { count as diffCount } from './difficulty.js';
import { qLookRotation, qRotate, normalize, sub } from './vec.js';

const TICK = 1 / 20;
export const SPEAKERS = {
  doukas: { name: 'Cmdr. Doukas', colour: '#ffb347' },
  saint: { name: 'Saint', colour: '#7fd8ff' },
  wren: { name: 'Wren', colour: '#8dffa8' },
  okonkwo: { name: 'Dr. Okonkwo', colour: '#d6b4ff' },
  ferrante: { name: 'Capt. Ferrante', colour: '#f2efe6' },
  perpetua: { name: 'Perpetua', colour: '#ffb347' },
  varlaam: { name: 'Varlaam', colour: '#f2d27a' },
  mule: { name: 'Mule convoy', colour: '#f2d27a' },
  halo: { name: 'Halo Lead', colour: '#7fd8ff' },
  ember: { name: 'Ember Lead', colour: '#ff9a6a' },
  harrow: { name: '▲ UNKNOWN SIGNAL', colour: '#ff4a3a' },
  tender: { name: 'Tender', colour: '#8dffa8' },
  you: { name: 'Lantern One', colour: '#e9edf3' },
  system: { name: 'Flight computer', colour: '#a0b2cd' },
};

export const readTime = text => Math.min(9, 1.6 + text.length * 0.055);

export function defineMission(def) {
  return { ...def, create: world => createRuntime(world, def) };
}

function createRuntime(world, def) {
  // The player first, so the opening scene can be laid out around them.
  const start = def.start ?? {};
  const q = [0, 0, 0, 1];
  if (start.forward) qLookRotation(q, start.forward, [0, 1, 0]);
  const player = spawnPlayer(world, world.loadout, start.pos ?? world.field.cfg.spawn, q);
  if (start.speed) {
    const f = [-(2 * (q[0] * q[2] + q[3] * q[1])), -(2 * (q[1] * q[2] - q[3] * q[0])), -(1 - 2 * (q[0] * q[0] + q[1] * q[1]))];
    player.ship.vel = f.map(v => v * start.speed);
    player.ship.throttle = start.speed / player.ship.stats.fa.forwardSpeed;
  }
  const rt = {
    // The first step ticks the script, so a mission's opening happens at once.
    def, world, time: 0, acc: TICK, started: false, threads: [], objectives: [], byId: new Map(),
    timers: new Map(), radio: [], hints: [], flags: {}, handlers: new Map(), cursor: 0,
    outcome: null, reason: null, outcomeAt: null, rearm: def.rearm ?? null, scoreKill: def.scoreKill ? e => def.scoreKill(e, world) : null,
    music: def.music ?? 'calm', lastLine: null,
  };
  const m = makeApi(rt);
  rt.m = m;
  def.setup?.(m);
  if (def.script) rt.threads.push({ gen: def.script(m), wait: null, name: 'main' });
  rt.start = () => { rt.started = true; };
  rt.step = dt => step(rt, dt);
  rt.flush = () => { if (rt.started) dispatch(rt); };
  return rt;
}

/* ---------- the scheduler ---------- */

function ready(rt, w) {
  if (!w) return true;
  if (w.t != null && rt.time < w.t) return false;
  if (w.pred) {
    if (w.timeout != null && rt.time >= w.timeout) { w.timedOut = true; return true; }
    try { return !!w.pred(); } catch (error) { console.warn('meteora mission wait', error); return true; }
  }
  return true;
}

function runThreads(rt) {
  for (let i = 0; i < rt.threads.length; i++) {
    const th = rt.threads[i];
    let guard = 0;
    while (!th.done && ready(rt, th.wait) && guard++ < 64) {
      let r;
      try { r = th.gen.next(th.wait?.timedOut ? false : true); }
      catch (error) { console.error(`meteora mission ${rt.def.id} (${th.name})`, error); th.done = true; break; }
      if (r.done) { th.done = true; break; }
      th.wait = r.value ?? null;
      if (rt.outcome) break;
    }
  }
  rt.threads = rt.threads.filter(t => !t.done);
}

/* Handlers see every event once, the step it happens: the frame drains
   the event list (and resets the cursor) only after the steps have run. */
function dispatch(rt) {
  const events = rt.world.events;
  if (rt.cursor > events.length) rt.cursor = 0;
  for (; rt.cursor < events.length; rt.cursor++) {
    const ev = events[rt.cursor];
    const list = rt.handlers.get(ev.type);
    if (list) for (const fn of list) { try { fn(ev); } catch (error) { console.error('meteora mission handler', error); } }
  }
}

function step(rt, dt) {
  if (!rt.started) return;
  const w = rt.world;
  rt.time += dt;
  dispatch(rt);
  for (const t of rt.timers.values()) {
    if (!t.paused && t.left > 0) {
      t.left = Math.max(0, t.left - dt);
      if (t.left === 0) w.events.push({ type: 'timerDone', id: t.id });
    }
  }
  rt.acc += dt;
  if (rt.acc < TICK) return;
  rt.acc -= TICK;
  if (rt.acc > TICK) rt.acc = 0;
  if (!rt.outcome) {
    if (w.state === 'dead') lose(rt, rt.flags.deathReason ?? 'Lantern One was destroyed.');
    else runThreads(rt);
  }
}

function win(rt, text) {
  if (rt.outcome) return;
  rt.outcome = 'won'; rt.reason = text ?? null; rt.outcomeAt = rt.time;
  for (const o of rt.objectives) {
    if (o.state !== 'active') continue;
    // A won mission has met its primaries; bonuses still open either held
    // to the end (passOnWin) or were missed.
    if (o.kind === 'primary') o.state = 'done';
    else o.state = o.passOnWin ? 'done' : 'failed';
  }
  rt.world.events.push({ type: 'missionWon', text });
}
function lose(rt, reason) {
  if (rt.outcome) return;
  rt.outcome = 'lost'; rt.reason = reason; rt.outcomeAt = rt.time;
  rt.world.events.push({ type: 'missionLost', reason });
}

/* ---------- the API scripts use ---------- */

function makeApi(rt) {
  const w = rt.world;
  const entityOf = x => (typeof x === 'string' ? m.get(x) : x);
  const posOf = x => (Array.isArray(x) ? x : x?.ship ? x.ship.pos : x?.pos ?? null);
  const m = {
    get world() { return w; },
    get player() { return w.player; },
    get rng() { return w.rng; },
    get diff() { return w.diff; },
    get time() { return rt.time; },
    get flags() { return rt.flags; },
    /* How many ships a wave of `base` is at this difficulty. */
    n: base => diffCount(w.diff, base),

    /* ---- waits ---- */
    wait: seconds => ({ t: rt.time + seconds }),
    until: (pred, timeout = null) => ({ pred, timeout: timeout == null ? null : rt.time + timeout }),
    thread(gen, name = 'thread') { rt.threads.push({ gen, wait: null, name }); },

    /* ---- radio and hints ---- */
    say(who, text, { delay = 0 } = {}) {
      const at = Math.max(rt.time + delay, rt.lastLine ? rt.lastLine.at + rt.lastLine.dur : 0);
      const line = { who, text, at, dur: readTime(text) };
      rt.radio.push(line);
      rt.lastLine = line;
      w.events.push({ type: 'radio', who, text, at });
      return { t: line.at + line.dur };
    },
    hint(text, seconds = 7) {
      if (rt.def.hints === false) return;
      rt.hints.push({ text, at: rt.time, until: rt.time + seconds });
      w.events.push({ type: 'hint', text });
    },
    music(mood) { rt.music = mood; w.events.push({ type: 'music', mood }); },

    /* ---- objectives ---- */
    objective(id, text, { bonus = false, hidden = false, count = null, critical = true, passOnWin = false } = {}) {
      let o = rt.byId.get(id);
      if (!o) {
        o = { id, text, kind: bonus ? 'bonus' : 'primary', state: hidden ? 'hidden' : 'active', count, critical: !bonus && critical, passOnWin, shownAt: rt.time };
        rt.objectives.push(o); rt.byId.set(id, o);
      } else { o.text = text; if (!hidden && o.state === 'hidden') o.state = 'active'; }
      if (!hidden) w.events.push({ type: 'objective', id, text, bonus, state: 'active' });
      return o;
    },
    show(id) {
      const o = rt.byId.get(id);
      if (o && o.state === 'hidden') { o.state = 'active'; o.shownAt = rt.time; w.events.push({ type: 'objective', id, text: o.text, bonus: o.kind === 'bonus', state: 'active' }); }
    },
    complete(id) {
      const o = rt.byId.get(id);
      if (!o || o.state === 'done' || o.state === 'failed') return;
      o.state = 'done';
      w.events.push({ type: 'objective', id, text: o.text, bonus: o.kind === 'bonus', state: 'done' });
    },
    fail(id, reason) {
      const o = rt.byId.get(id);
      if (!o || o.state === 'done' || o.state === 'failed') return;
      o.state = 'failed';
      w.events.push({ type: 'objective', id, text: o.text, bonus: o.kind === 'bonus', state: 'failed' });
      if (o.kind === 'primary' && o.critical) lose(rt, reason ?? `Objective failed: ${o.text}`);
    },
    progress(id, n, of) {
      const o = rt.byId.get(id);
      if (o) o.count = { n, of };
    },
    stateOf: id => rt.byId.get(id)?.state ?? null,
    done: id => rt.byId.get(id)?.state === 'done',
    failed: id => rt.byId.get(id)?.state === 'failed',

    /* ---- timers ---- */
    timer(id, label, seconds, { paused = false, visible = true, objective = null } = {}) {
      const t = { id, label, left: seconds, total: seconds, paused, visible, objective };
      rt.timers.set(id, t);
      return t;
    },
    timeLeft: id => rt.timers.get(id)?.left ?? 0,
    pauseTimer(id, paused = true) { const t = rt.timers.get(id); if (t) t.paused = paused; },
    removeTimer(id) { rt.timers.delete(id); },

    /* ---- the cast ---- */
    spawn(cls, o = {}) {
      const e = spawn(w, cls, o);
      if (o.objective) e.tags.add('objective');
      return e;
    },
    /* A wing on a leader: names `${prefix} 2`, `${prefix} 3`… and slots
       echeloned behind and beside. */
    wing(cls, count, { prefix = 'Lantern', first = 2, leader = w.player, pos = null, names = null, ...o } = {}) {
      // Slots are in the leader's frame (x right, y up, +z astern): wingmen
      // start beside and behind, never across the leader's nose.
      const slots = [[36, 4, 32], [-36, -4, 32], [64, 8, 56], [-64, -8, 56], [92, 12, 80]];
      const out = [];
      for (let k = 0; k < count; k++) {
        const slot = slots[k % slots.length];
        const base = pos ?? leader.ship.pos;
        const off = qRotate([0, 0, 0], leader.ship.q, slot);
        const at = [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
        const e = spawn(w, cls, { team: 0, name: names?.[k] ?? `${prefix} ${first + k}`, pos: at, q: [...leader.ship.q], slot, leader, orders: { type: 'cover' }, missiles: 4, ...o });
        e.ship.vel = [...leader.ship.vel];
        out.push(e);
      }
      return out;
    },
    /* A group arriving through fold space around a point, facing `toward`. */
    group(cls, count, at, { toward = null, spread = 140, fold = true, names = null, ...o } = {}) {
      const out = [];
      const centre = posOf(at);
      const look = toward ? normalize([0, 0, 0], sub([0, 0, 0], posOf(toward), centre)) : null;
      for (let k = 0; k < count; k++) {
        const off = w.rng.unit([0, 0, 0]);
        const pos = centre.map((c, i) => c + off[i] * spread * Math.sqrt(w.rng.next()));
        const q = [0, 0, 0, 1];
        if (look) qLookRotation(q, look, [0, 1, 0]);
        out.push(spawn(w, cls, { pos, q, fold, name: names?.[k], throttle: 0.9, ...o }));
      }
      return out;
    },
    /* A point `distance` from `from` on a bearing away from where the
       player is looking, for waves that should come from off screen. */
    offscreen(from, distance) {
      const p = w.player.ship;
      const fwd = [0, 0, -1];
      const q = p.q; const x = q[0], y = q[1], z = q[2], ww = q[3];
      // forward of the player
      fwd[0] = -(2 * (x * z + ww * y)); fwd[1] = -(2 * (y * z - ww * x)); fwd[2] = -(1 - 2 * (x * x + y * y));
      let d;
      for (let k = 0; k < 40; k++) {
        d = w.rng.unit([0, 0, 0]);
        d[1] *= 0.35;
        normalize(d, d);
        if (d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2] < 0.2) break;
      }
      const c = posOf(from);
      return [c[0] + d[0] * distance, c[1] + d[1] * distance, c[2] + d[2] * distance];
    },
    get(name) { return w.entities.find(e => e.name === name && !e.departed) ?? null; },
    tagged(tag, { alive = true } = {}) { return w.entities.filter(e => e.tags.has(tag) && (!alive || e.alive)); },
    alive(x) {
      if (Array.isArray(x)) return x.filter(e => e.alive).length;
      if (typeof x === 'string') return m.tagged(x).length;
      return x?.alive ? 1 : 0;
    },
    dist(a, b) {
      const p = posOf(entityOf(a)), q = posOf(entityOf(b));
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    },
    near(a, b, r) { return m.dist(a, b) <= r; },

    /* ---- navigation ---- */
    nav(id, name, pos, { r = 400, hidden = false } = {}) {
      const n = { id, name, pos: [...pos], r, hidden };
      w.navs.push(n);
      if (!w.nav && !hidden) w.nav = n;
      return n;
    },
    navPoint: id => w.navs.find(n => n.id === id) ?? null,
    showNav(id, select = true) { const n = m.navPoint(id); if (n) { n.hidden = false; if (select) w.nav = n; } },
    hideNav(id) { const n = m.navPoint(id); if (n) { n.hidden = true; if (w.nav === n) w.nav = w.navs.find(x => !x.hidden) ?? null; } },

    /* ---- orders and acts ---- */
    order(e, orders) { for (const x of [].concat(e)) { if (!x) continue; x.orders = orders; if (x.brain) x.brain.retarget = 0; } },
    foldOut(e) { for (const x of [].concat(e)) if (x) worldFoldOut(w, x); },
    beam(owner, target) { return fireBeam(w, owner, target); },
    freeze(team, on = true) { for (const e of w.entities) if (e.team === team) e.frozen = on; },
    target(e) { w.target = e; w.targetSub = null; },

    /* ---- events and outcome ---- */
    on(type, fn) { (rt.handlers.get(type) ?? rt.handlers.set(type, []).get(type)).push(fn); },
    flag(name, value) { rt.flags[name] = value; },
    win(text) { win(rt, text); },
    lose(reason) { lose(rt, reason); },
    get outcome() { return rt.outcome; },
  };
  return m;
}

/* What the debrief needs from a finished mission. */
export function results(world) {
  const rt = world.mission;
  const objectives = rt.objectives.filter(o => o.state !== 'hidden' || o.kind === 'bonus');
  const primary = objectives.filter(o => o.kind === 'primary');
  const bonus = objectives.filter(o => o.kind === 'bonus');
  const won = rt.outcome === 'won';
  const bonusDone = bonus.filter(o => o.state === 'done').length;
  const medal = !won ? null : bonusDone === bonus.length && bonus.length > 0 ? 'gold' : bonusDone > 0 ? 'silver' : 'bronze';
  const par = rt.def.par ?? 600;
  const timeBonus = won ? Math.round(Math.max(0, par - rt.time) * 4 * world.diff.score) : 0;
  const objectiveScore = won ? Math.round((primary.length * 500 + bonusDone * 1000) * world.diff.score) : 0;
  return {
    id: rt.def.id, title: rt.def.title, won, died: world.state === 'dead', reason: rt.reason, time: rt.time, medal,
    objectives: objectives.map(o => ({ id: o.id, text: o.text, kind: o.kind, state: o.state })),
    bonusDone, bonusTotal: bonus.length,
    score: world.score + timeBonus + objectiveScore, combatScore: world.score, timeBonus, objectiveScore,
    stats: { ...world.stats, accuracy: world.stats.shots ? world.stats.hits / world.stats.shots : 0 },
    flags: { ...rt.flags }, difficulty: world.diffKey,
  };
}
