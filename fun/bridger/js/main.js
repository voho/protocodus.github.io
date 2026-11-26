/* Bridger: build a bridge on the grid, then test it with the real
   simulation. Build mode edits a list of members; test mode runs a sim of a
   copy of it and colours every member by how close it is to breaking. */
import { randomSeed, hashSeed } from '../../shared/rng.js';
import { CELL, MATERIALS, VEHICLES, STEP, createSim, bridgeCost, memberLength, key } from './physics.js';
import { createMission, memberProblem, pairKey, isAnchor, randomSolution, roadDeck, DESIGN_NAMES } from './mission.js';
import { createView, draw, stressColor } from './render.js';
import { createSound } from './sound.js';
import { THEMES, THEME_IDS, buildScenery } from './scenery.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const sound = createSound();
const toastEl = $('[data-toast]');
const status = $('[data-status]');
const help = $('[data-dialog="help"]');
const win = $('[data-dialog="win"]');
const undoButton = $('[data-action="undo"]');
const testLabel = $('[data-test-label]');
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TOOLS = ['wood', 'steel', 'cable', 'erase'];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const read = (name) => { try { return localStorage.getItem(`bridger-${name}`); } catch { return null; } };
const store = (name, value) => { try { localStorage.setItem(`bridger-${name}`, value); } catch { /* private mode */ } };
const track = (event, fields = {}) => window.protocodusAnalytics?.track(event, {
  game_name: 'bridger', game_mode: 'mission', difficulty, level: mission?.vehicle, ...fields,
});

let difficulty = 'medium', seed = '', mission = null, view = null, parked = null, scenery = null;
// Each river has its own world, picked from its seed; ?theme= previews one.
const themeOverride = THEMES[new URLSearchParams(location.search).get('theme')] ? new URLSearchParams(location.search).get('theme') : null;
let theme = null;
let members = [], undoStack = [], tool = 'wood';
let mode = 'build', sim = null, simClock = 0, resultShown = false, drawnBroken = new Set();
let peaks = new Map(), solutionShown = false, started = false, startedAt = 0;
let pointer = null, hover = null, drag = null, focus = null, particles = [];
let toastTimer = 0, last = performance.now(), time = 0;

const peakKey = (m) => `${pairKey(m)}:${m.mat}`;

/* ---------- missions ---------- */

function fromHash() {
  const match = /^#(easy|medium|hard)-([a-z0-9]{3,16})$/i.exec(location.hash);
  return match ? { difficulty: match[1].toLowerCase(), seed: match[2].toLowerCase() } : null;
}

function load(nextDifficulty, nextSeed, keepBridge = false) {
  document.body.classList.add('busy');
  // Let the "surveying" curtain paint before the solver takes the thread.
  setTimeout(() => {
    try {
      difficulty = DIFFICULTIES.includes(nextDifficulty) ? nextDifficulty : 'medium';
      seed = nextSeed;
      mission = createMission(difficulty, seed);
    } catch (error) {
      $('[data-loading]').classList.add('failed');
      $('[data-loading-text]').textContent = 'This river could not be surveyed. Try a new one.';
      throw error;
    }
    store('difficulty', difficulty);
    history.replaceState(null, '', `#${difficulty}-${seed}`);
    document.querySelectorAll('input[name="difficulty"]').forEach((r) => { r.checked = r.value === difficulty; });
    $('[data-seed]').textContent = seed;
    $('[data-vehicle-name]').textContent = VEHICLES[mission.vehicle].name;
    $('[data-river-width]').textContent = `${mission.right - mission.left} m river`;
    if (!keepBridge) {
      let saved = null;
      try { saved = JSON.parse(read(`bridge-${seed}`) || 'null'); } catch { /* broken save */ }
      members = [...roadDeck(mission), ...(Array.isArray(saved) ? saved.filter((m) => m && MATERIALS[m.mat] && m.mat !== 'road' && !memberProblem(mission, [], m)) : [])];
      undoStack = [];
      peaks = new Map();
      solutionShown = false;
      started = false;
    }
    parked = createSim(mission, []).car;
    const themeId = themeOverride || THEME_IDS[hashSeed(`${seed}:world`) % THEME_IDS.length];
    theme = THEMES[themeId];
    document.body.dataset.theme = themeId;
    document.body.dataset.ui = theme.ui;
    scenery = buildScenery(mission, theme);
    stopTest();
    if (win.open) win.close();
    resize();
    updateBudget();
    document.body.classList.remove('busy');
    document.body.classList.add('ready');
    say(`${VEHICLES[mission.vehicle].name} needs to cross a ${mission.right - mission.left} metre river. Budget ${money(mission.budget)}.`);
  }, 30);
}

function updateBudget() {
  const cost = bridgeCost(members);
  $('[data-cost]').textContent = money(cost);
  $('[data-limit]').textContent = money(mission.budget);
  const ratio = cost / mission.budget;
  $('[data-meter]').style.width = `${Math.min(100, ratio * 100)}%`;
  const box = $('[data-budget]');
  box.classList.toggle('over', ratio > 1);
  box.classList.toggle('close', ratio > 0.9 && ratio <= 1);
  undoButton.disabled = undoStack.length === 0;
  store(`bridge-${seed}`, JSON.stringify(members.map(({ a, b, mat }) => ({ a, b, mat }))));
}

function commit(next) {
  undoStack.push(members);
  if (undoStack.length > 200) undoStack.shift();
  members = next;
  updateBudget();
}

/* ---------- feedback ---------- */

function say(text) { status.textContent = text; }
function toast(text, bad = false, ms = 2800) {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
  say(text);
}
const PROBLEMS = {
  long: (mat) => `${MATERIALS[mat].name} can only be ${MATERIALS[mat].maxLength.toFixed(0)} m long.`,
  ground: () => 'You can\'t build in the rock or the water.',
  anchors: () => 'Those two bolts are already fixed to the ground.',
  steep: () => 'Road that steep would be too hard to drive up.',
  exists: () => 'There is already a beam there.',
};

function burst(x, y, color, count, spread = 3, square = false) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y, vx: (Math.random() - 0.5) * spread * 2, vy: Math.random() * spread * 1.4,
      life: 0.7 + Math.random() * 0.8, color, size: 0.08 + Math.random() * 0.12, square,
    });
  }
}

/* ---------- geometry for the pointer ---------- */

function gridAt(px, py) {
  return [Math.round(view.wx(px) / CELL), Math.round(view.wy(py) / CELL)];
}
const screenOf = (p) => [view.sx(p[0] * CELL), view.sy(p[1] * CELL)];
function isJoint(p) {
  return isAnchor(mission, p) || members.some((m) => key(m.a) === key(p) || key(m.b) === key(p));
}
function memberNear(px, py, radius = 14) {
  let best = null, bestD = radius;
  for (const m of members) {
    const [ax, ay] = screenOf(m.a), [bx, by] = screenOf(m.b);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
function jointNear(px, py) {
  const g = gridAt(px, py);
  const [sx, sy] = screenOf(g);
  return Math.hypot(px - sx, py - sy) < Math.max(18, view.scale * CELL * 0.45) && isJoint(g) ? g : null;
}
const reach = (mat) => MATERIALS[mat].maxLength;
/* The grid point under the pointer, pulled in to the longest beam allowed. */
function reachTarget(from, px, py, mat) {
  let target = gridAt(px, py);
  const max = reach(mat);
  if (Math.hypot(target[0] - from[0], target[1] - from[1]) * CELL <= max + 1e-6) return target;
  const wx = view.wx(px) / CELL, wy = view.wy(py) / CELL;
  let best = from, bestD = Infinity;
  const r = Math.ceil(max / CELL);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (Math.hypot(dx, dy) * CELL > max + 1e-6) continue;
      const d = Math.hypot(from[0] + dx - wx, from[1] + dy - wy);
      if (d < bestD) { bestD = d; best = [from[0] + dx, from[1] + dy]; }
    }
  }
  return best;
}

/* ---------- building ---------- */

/* A beam splits where it runs through an existing joint, so a line drawn
   across the bridge joins everything it touches. */
function pieces(from, to, mat, existing) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const steps = gcd(Math.abs(dx), Math.abs(dy));
  const cuts = [from];
  for (let k = 1; k < steps; k++) {
    const p = [from[0] + dx / steps * k, from[1] + dy / steps * k];
    if (isAnchor(mission, p) || existing.some((m) => key(m.a) === key(p) || key(m.b) === key(p))) cuts.push(p);
  }
  cuts.push(to);
  return cuts.slice(1).map((b, i) => ({ a: cuts[i], b, mat }));
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/* What a drag from one point to another would build: { add, problem }. */
function plan(from, to, mat) {
  const add = [];
  let problem = null;
  for (const piece of pieces(from, to, mat, members)) {
    const p = memberProblem(mission, [...members, ...add], piece);
    if (!p) add.push(piece);
    else if (p !== 'exists') problem = problem || p;
  }
  if (problem) return { add: [], problem };
  if (!add.length) return { add, problem: 'exists' };
  return { add, problem: null };
}


const ROAD_STAYS = 'The road stays flat. Build under or over it to hold it up.';

function setTool(next) {
  tool = next;
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === tool)));
}

function erase(px, py) {
  const joint = jointNear(px, py);
  if (joint && !isAnchor(mission, joint)) {
    const k = key(joint);
    const next = members.filter((m) => m.mat === 'road' || (key(m.a) !== k && key(m.b) !== k));
    if (next.length !== members.length) { commit(next); sound.erase(); return; }
  }
  const m = memberNear(px, py);
  if (!m) return;
  if (m.mat === 'road') { toast(ROAD_STAYS); sound.buzz(); return; }
  commit(members.filter((o) => o !== m));
  sound.erase();
}

function swapMaterial(m) {
  if (m.mat === tool) return;
  if (m.mat === 'road') { toast(ROAD_STAYS); sound.buzz(); return; }
  const swapped = { ...m, mat: tool };
  const problem = memberProblem(mission, members.filter((o) => o !== m), swapped);
  if (problem) { toast(PROBLEMS[problem]?.(tool) || 'That doesn\'t fit there.', true); sound.buzz(); return; }
  commit(members.map((o) => (o === m ? swapped : o)));
  sound.place(tool);
}

function onDown(event) {
  sound.unlock();
  if (!mission || mode !== 'build' || event.button > 0) return;
  canvas.setPointerCapture?.(event.pointerId);
  pointer = { id: event.pointerId, x: event.offsetX, y: event.offsetY, moved: false };
  if (tool === 'erase') { erase(pointer.x, pointer.y); pointer = null; return; }
  const from = jointNear(pointer.x, pointer.y);
  if (from) {
    drag = { from, to: null, ok: false, mat: tool };
    focus = [...from, reach(tool) / CELL];
  } else {
    pointer.member = memberNear(pointer.x, pointer.y);
  }
}

function onMove(event) {
  if (!mission) return;
  const px = event.offsetX, py = event.offsetY;
  if (pointer && pointer.id === event.pointerId && Math.hypot(px - pointer.x, py - pointer.y) > 6) pointer.moved = true;
  if (drag) {
    const to = reachTarget(drag.from, px, py, drag.mat);
    const same = to[0] === drag.from[0] && to[1] === drag.from[1];
    drag.to = same ? null : to;
    drag.plan = same ? null : plan(drag.from, to, drag.mat);
    drag.ok = !!drag.plan && !drag.plan.problem;
    hover = null;
    return;
  }
  updateHover(px, py);
}

function updateHover(px, py) {
  hover = null;
  if (mode === 'build') {
    const m = memberNear(px, py);
    if (!m) return;
    const peak = peaks.get(peakKey(m));
    hover = {
      member: m, px, py,
      label: `${MATERIALS[m.mat].name} · ${memberLength(m).toFixed(1)} m${peak != null ? ` · ${Math.round(peak * 100)}% last test` : ''}`,
      color: peak != null ? stressColor(peak) : '#fff',
    };
  } else if (sim) {
    let best = null, bestD = 14;
    for (const b of sim.beams) {
      if (b.broken) continue;
      const na = sim.nodes[b.a], nb = sim.nodes[b.b];
      const ax = view.sx(na.x), ay = view.sy(na.y), dx = view.sx(nb.x) - ax, dy = view.sy(nb.y) - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) hover = { beam: best, px, py };
  }
}

function onUp(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (drag) {
    if (drag.to && drag.ok) {
      commit([...members, ...drag.plan.add]);
      sound.place(drag.mat);
    } else if (drag.to) {
      toast(PROBLEMS[drag.plan.problem]?.(drag.mat) || 'That beam doesn\'t fit there.', true);
      sound.buzz();
    } else if (!pointer.moved) {
      const m = memberNear(pointer.x, pointer.y, 10);
      if (m) swapMaterial(m);
    }
  } else if (!pointer.moved) {
    if (pointer.member) swapMaterial(pointer.member);
    else toast('Start a beam from a red bolt or a joint.');
  }
  drag = null; focus = null; pointer = null;
}

function cancelDrag() { drag = null; focus = null; pointer = null; }

/* ---------- testing ---------- */

function startTest() {
  cancelDrag();
  if (!started) { started = true; startedAt = performance.now(); track('game_start', { action: 'test' }); }
  sim = createSim(mission, members);
  simClock = 0;
  resultShown = false;
  drawnBroken = new Set();
  mode = 'test';
  hover = null;
  document.body.classList.add('testing');
  document.querySelector('[data-test-only]').hidden = false;
  testLabel.textContent = 'Stop';
  $('[data-action="test"]').setAttribute('aria-label', 'Stop the test');
  say(`The ${VEHICLES[mission.vehicle].name.toLowerCase()} is driving onto your bridge.`);
}

function stopTest() {
  if (sim) {
    // Keep every member's worst moment on the drawing so weak spots stay visible.
    peaks = new Map();
    members.forEach((m, i) => { const b = sim.beams[i]; if (b) peaks.set(peakKey(m), b.broken ? 1 : b.peak); });
  }
  sim = null;
  mode = 'build';
  sound.engine(false);
  document.body.classList.remove('testing');
  document.querySelector('[data-test-only]').hidden = true;
  testLabel.textContent = 'Go!';
  $('[data-action="test"]').setAttribute('aria-label', 'Test the bridge');
  hover = null;
}

function stepTest(dt) {
  simClock += Math.min(dt, 0.1);
  while (simClock >= STEP) {
    simClock -= STEP;
    sim.step();
    for (const event of sim.events) {
      if (event === 'splash') {
        sound.splash();
        const a = sim.car.axles[0];
        burst(a.x, mission.water, '#e3f4ff', 40, 5);
      }
      if (event === 'fall') sound.engine(false);
    }
  }
  sim.beams.forEach((b, i) => {
    if (b.broken && !drawnBroken.has(i)) {
      drawnBroken.add(i);
      const na = sim.nodes[b.a], nb = sim.nodes[b.b];
      sound.snap(b.mat);
      burst((na.x + nb.x) / 2, (na.y + nb.y) / 2, b.mat === 'wood' ? '#c98b4f' : b.mat === 'road' ? '#555b64' : '#b9c8d8', 10, 2.5, true);
    }
  });
  const driving = sim.car.state === 'driving';
  sound.engine(driving, 1 + 0.1 * Math.sin(time * 3));
  if (sim.result && !resultShown) {
    resultShown = true;
    finishTest(sim.result);
  }
}

function finishTest(result) {
  const name = VEHICLES[mission.vehicle].name.toLowerCase();
  const cost = bridgeCost(members);
  if (result === 'win') {
    const broken = sim.brokeCount;
    if (cost > mission.budget) {
      toast(`It works! But it costs ${money(cost)}, which is ${money(cost - mission.budget)} over budget. Try a cheaper shape.`, true, 5200);
      sound.win();
      return;
    }
    sound.win();
    for (let i = 0; i < 70; i++) {
      const colors = ['#ffd23f', '#ff5a4a', '#3ccf6e', '#5fb4ea', '#c9a6f2'];
      particles.push({ x: mission.right + 2 + Math.random() * 6, y: 4 + Math.random() * 4, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, life: 1.6 + Math.random(), color: colors[i % 5], size: 0.12, square: true });
    }
    track('game_end', { result: 'win', score: mission.budget - cost, duration_seconds: Math.round((performance.now() - startedAt) / 1000), hints_used: solutionShown ? 1 : 0 });
    setTimeout(() => {
      if (mode !== 'test') return;
      $('[data-win-cost]').textContent = money(cost);
      const saved = mission.budget - cost;
      $('[data-win-title]').textContent = broken ? 'Wobbly, but across!' : 'Safe across!';
      $('[data-win-note]').textContent = `${saved > 0 ? `${money(saved)} left over from ${money(mission.budget)}.` : `Right on the budget of ${money(mission.budget)}.`}${solutionShown ? ' Now try one of your own.' : ' Can you build it cheaper?'}`;
      win.showModal();
    }, 1100);
  } else {
    sound.fail();
    testLabel.textContent = 'Fix it';
    setTimeout(() => {
      if (mode === 'test') toast(`Splash! Red beams were close to breaking. Make them stronger or add triangles.`, true, 4600);
    }, 900);
  }
}

/* ---------- loop ---------- */

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!mission) return;
  const top = $('.hud-top').getBoundingClientRect().bottom + 6;
  const bottom = innerHeight - $('.hud-bottom').getBoundingClientRect().top + 6;
  view = createView(mission, innerWidth, innerHeight, top, bottom);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  if (mission && view) {
    if (mode === 'test' && sim) stepTest(dt);
    for (const p of particles) {
      p.vy -= 9.81 * dt * (p.square ? 0.5 : 1);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    if (hover?.beam) {
      hover.label = `${MATERIALS[hover.beam.mat].name} · ${Math.round(hover.beam.usage * 100)}%`;
      hover.color = stressColor(hover.beam.usage);
    }
    draw(ctx, {
      mission, view, time, theme, scenery, mode, members, sim, parked, particles, drag, focus,
      hover: hover?.beam?.broken ? null : hover,
      peakOf: (m) => peaks.get(peakKey(m)),
    });
  }
  requestAnimationFrame(frame);
}

/* ---------- controls ---------- */

function newMission() {
  load(difficulty, randomSeed());
}

function showSolution() {
  document.body.classList.add('busy');
  $('[data-loading-text]').textContent = 'Designing a bridge';
  setTimeout(() => {
    const { members: solution, kind } = randomSolution(mission);
    commit(solution);
    solutionShown = true;
    peaks = new Map();
    document.body.classList.remove('busy');
    $('[data-loading-text]').textContent = 'Surveying the river';
    sound.place('steel');
    toast(`Here is ${/^[aeiou]/.test(DESIGN_NAMES[kind]) ? 'an' : 'a'} ${DESIGN_NAMES[kind]} that works, for ${money(bridgeCost(solution))}. Press Go! to watch it.`, false, 4200);
  }, 30);
}

const actions = {
  test: () => (mode === 'build' ? startTest() : stopTest()),
  undo: () => { if (mode === 'build' && undoStack.length) { members = undoStack.pop(); updateBudget(); sound.erase(); } },
  clear: () => { if (members.some((m) => m.mat !== 'road')) { commit(roadDeck(mission)); peaks = new Map(); sound.erase(); } },
  solution: showSolution,
  new: newMission,
  next: () => { win.close(); newMission(); },
  improve: () => { win.close(); stopTest(); },
  help: () => help.showModal(),
  sound: () => {
    const on = sound.toggle();
    const button = $('[data-action="sound"]');
    button.classList.toggle('off', !on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  },
  share: async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link to this river copied.'); } catch { toast(location.href); }
  },
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action], [data-tool]');
  if (!button) return;
  sound.unlock();
  if (button.dataset.tool) setTool(button.dataset.tool);
  else actions[button.dataset.action]?.();
});
document.querySelectorAll('input[name="difficulty"]').forEach((radio) => radio.addEventListener('change', () => {
  // Same river, a different budget.
  if (radio.checked) load(radio.value, seed, true);
}));
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('pointerleave', (event) => { if (!pointer) hover = null; else onMove(event); });
window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => {
  const target = fromHash();
  if (target && (target.seed !== seed || target.difficulty !== difficulty)) load(target.difficulty, target.seed);
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest?.('input, dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
  const k = event.key.toLowerCase();
  if (k === ' ' || k === 'enter') { event.preventDefault(); actions.test(); }
  else if (k >= '1' && k <= '4') setTool(TOOLS[Number(k) - 1]);
  else if (k === 'u' || k === 'backspace') actions.undo();
  else if (k === 'n') newMission();
  else if (k === 'm') actions.sound();
  else if (k === 'escape') cancelDrag();
});
help.addEventListener('close', () => store('seen-help', '1'));

for (const [mat, def] of Object.entries(MATERIALS)) {
  const price = document.querySelector(`[data-price="${mat}"]`);
  if (price) price.textContent = `$${def.cost}/m`;
}
if (!sound.enabled) { const b = $('[data-action="sound"]'); b.classList.add('off'); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Sound off'); }
resize();
const initial = fromHash();
load(initial?.difficulty || read('difficulty') || 'medium', initial?.seed || randomSeed());
if (!read('seen-help')) help.showModal();
requestAnimationFrame(frame);

// Read-only handles for the browser checks in tests/.
window.bridger = { get mission() { return mission; }, get view() { return view; }, get members() { return members; }, get sim() { return sim; } };
