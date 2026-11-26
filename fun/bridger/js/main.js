/* Bridger: build a bridge on the grid, then test it with the real
   simulation. Build mode edits a list of members; test mode runs a sim of a
   copy of it and colours every member by how close it is to breaking. */
import { randomSeed, hashSeed } from '../../shared/rng.js';
import { CELL, MATERIALS, VEHICLES, STEP, createSim, bridgeCost, memberLength, key } from './physics.js';
import { createMission, memberProblem, pairKey, jointAllowed, attachmentPoints, randomSolution, roadDeck, DESIGN_NAMES } from './mission.js';
import { createView, draw, stressColor } from './render.js';
import { createSound } from './sound.js';
import { THEMES, THEME_IDS, buildScenery } from './scenery.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const labelCanvas = $('[data-labels]');
const labelCtx = labelCanvas.getContext('2d');
const sound = createSound();
const toastEl = $('[data-toast]');
const status = $('[data-status]');
const help = $('[data-dialog="help"]');
const win = $('[data-dialog="win"]');
const confirmDialog = $('[data-dialog="confirm"]');
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
const requestedTheme = new URLSearchParams(location.search).get('theme');
const themeOverride = THEME_IDS.includes(requestedTheme) ? requestedTheme : null;
let theme = null;
let members = [], undoStack = [], tool = 'wood';
let joints = [], sites = [];
let mode = 'build', sim = null, simClock = 0, resultShown = false, drawnBroken = new Set();
let peaks = new Map(), solutionShown = false, started = false, startedAt = 0;
let recentSolutions = [];
let pointer = null, hover = null, drag = null, focus = null, particles = [];
let toastTimer = 0, last = performance.now(), time = 0;

const peakKey = (m) => `${pairKey(m)}:${m.mat}`;

/* ---------- missions ---------- */

function fromHash() {
  const match = /^#(easy|medium|hard)-((?:v2-)?[a-z0-9]{3,16})$/i.exec(location.hash);
  return match ? { difficulty: match[1].toLowerCase(), seed: match[2].toLowerCase() } : null;
}

function load(nextDifficulty, nextSeed, keepBridge = false) {
  cancelDrag();
  document.body.classList.add('busy');
  // Let the "surveying" curtain paint before the solver takes the thread.
  setTimeout(() => {
    try {
      difficulty = DIFFICULTIES.includes(nextDifficulty) ? nextDifficulty : 'medium';
      seed = nextSeed;
      mission = createMission(difficulty, seed);
      recentSolutions = [];
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
    const rule = mission.clearance;
    const note = $('[data-clearance-note]');
    note.hidden = !rule;
    note.textContent = !rule ? '' : rule.kind === 'channel'
      ? 'Keep the marked channel clear for boats.'
      : `Build no higher than ${rule.y0 - mission.deck} m above the road.`;
    if (!keepBridge) {
      let saved = null;
      try { saved = JSON.parse(read(`bridge-${seed}`) || 'null'); } catch { /* broken save */ }
      const deck = roadDeck(mission);
      // Older saves always contained the original road. New saves also record gaps.
      const roads = new Set(deck.map(pairKey));
      const savedMembers = Array.isArray(saved) ? saved : saved?.members;
      members = Array.isArray(saved) || !Array.isArray(savedMembers) ? [...deck] : [];
      for (const m of Array.isArray(savedMembers) ? savedMembers : []) {
        if (!m || !Object.hasOwn(MATERIALS, m.mat) ||
            ![m.a, m.b].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) continue;
        if (m.mat === 'road' && !roads.has(pairKey(m))) continue;
        if (!memberProblem(mission, members, m)) members.push(m);
      }
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
    scenery = buildScenery(mission);
    stopTest();
    if (win.open) win.close();
    resize();
    updateBudget();
    document.body.classList.remove('busy');
    document.body.classList.add('ready');
    say(`${VEHICLES[mission.vehicle].name} needs to cross a ${mission.right - mission.left} metre river. Budget ${money(mission.budget)}.${rule ? ` ${note.textContent}` : ''}`);
  }, 30);
}

function updateBudget() {
  const points = new Map(mission.anchors.map((p) => [key(p), p]));
  for (const m of members) {
    points.set(key(m.a), m.a);
    points.set(key(m.b), m.b);
  }
  joints = [...points.values()];
  for (const m of members) {
    for (const p of attachmentPoints(m)) if (jointAllowed(mission, p)) points.set(key(p), p);
  }
  sites = [...points.values()];
  const cost = bridgeCost(members);
  $('[data-cost]').textContent = money(cost);
  $('[data-limit]').textContent = money(mission.budget);
  const ratio = cost / mission.budget;
  $('[data-meter]').style.width = `${Math.min(100, ratio * 100)}%`;
  const box = $('[data-budget]');
  box.classList.toggle('over', ratio > 1);
  box.classList.toggle('close', ratio > 0.9 && ratio <= 1);
  undoButton.disabled = undoStack.length === 0;
  store(`bridge-${seed}`, JSON.stringify({ members: members.map(({ a, b, mat }) => ({ a, b, mat })) }));
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
  channel: () => 'Leave the marked shipping channel clear for boats.',
  ceiling: () => 'Keep the bridge at or below the marked height limit.',
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
function nearestSite(px, py, options, radius) {
  let best = null, shortest = radius;
  for (const p of options) {
    const [sx, sy] = screenOf(p);
    const d = Math.hypot(sx - px, sy - py);
    if (d < shortest) { shortest = d; best = p; }
  }
  return best;
}
const snapRadius = () => Math.max(9, Math.min(20, view.scale * CELL * 0.4));
function memberNear(px, py, existing = members) {
  let best = null, bestD = 14;
  for (const m of existing) {
    const [ax, ay] = screenOf(m.a), [bx, by] = screenOf(m.b);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
const reach = (mat) => MATERIALS[mat].maxLength;
function reachTarget(drag, px, py) {
  const { from, mat, targets } = drag;
  const snap = nearestSite(px, py, targets, snapRadius());
  if (snap) return snap;
  const target = gridAt(px, py);
  const max = reach(mat) / CELL;
  if (Math.hypot(target[0] - from[0], target[1] - from[1]) <= max + 1e-6) return target;
  const wx = view.wx(px) / CELL, wy = view.wy(py) / CELL;
  let best = from, bestD = Infinity;
  for (let x = Math.ceil(from[0] - max); x <= from[0] + max; x++) {
    for (let y = Math.ceil(from[1] - max); y <= from[1] + max; y++) {
      if (Math.hypot(x - from[0], y - from[1]) > max + 1e-6) continue;
      const d = Math.hypot(x - wx, y - wy);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best;
}

/* ---------- building ---------- */

// Projection onto the member, allowing for rounding a displayed socket to 6 decimals.
function along(m, p) {
  const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1];
  const x = p[0] - m.a[0], y = p[1] - m.a[1];
  if (Math.abs(x * dy - y * dx) > 2e-6 * Math.hypot(dx, dy)) return -1;
  return (x * dx + y * dy) / (dx * dx + dy * dy);
}
function pieces(m, points) {
  const inside = points.map((p) => ({ p, t: along(m, p) }))
    .filter(({ t }) => t > 1e-6 && t < 1 - 1e-6)
    .sort((a, b) => a.t - b.t);
  if (!inside.length) return [m];
  const cuts = [m.a];
  for (const { p } of inside) {
    const prev = cuts[cuts.length - 1];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 2e-6) cuts.push(p);
  }
  cuts.push(m.b);
  return cuts.slice(1).map((b, i) => ({ a: cuts[i], b, mat: m.mat }));
}

function plan(from, to, mat) {
  const add = [];
  const onDeck = (p) => p[1] === 0 && Number.isInteger(p[0]) && p[0] >= 0 && p[0] <= mission.span;
  // Drawing across a gap in the deck reinstalls its original road pieces.
  const repair = onDeck(from) && onDeck(to);
  const proposed = repair
    ? roadDeck(mission).slice(Math.min(from[0], to[0]), Math.max(from[0], to[0]))
    : pieces({ a: from, b: to, mat }, sites);
  for (const piece of proposed) {
    // A drag may follow an existing beam for part of its length.
    if (members.some((m) => [piece.a, piece.b].every((p) => {
      const t = along(m, p);
      return t >= -1e-6 && t <= 1 + 1e-6;
    }))) continue;
    const problem = memberProblem(mission, members, piece);
    if (problem) return { add: [], problem };
    add.push(piece);
  }
  return { add, problem: add.length ? null : 'exists' };
}

function build(planned) {
  const ends = new Map();
  for (const m of planned.add) { ends.set(key(m.a), m.a); ends.set(key(m.b), m.b); }
  const points = [...ends.values()];
  return [...members.flatMap((m) => m.mat === 'road' ? [m] : pieces(m, points)), ...planned.add];
}

function setTool(next) {
  cancelDrag();
  hover = null;
  tool = next;
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === tool)));
}

function erase(px, py, replaceLastEdit) {
  const joint = nearestSite(px, py, joints, Math.max(5, Math.min(10, view.scale * CELL * 0.22)));
  const source = replaceLastEdit ? undoStack[undoStack.length - 1] : members;
  let next = joint ? source.filter((m) => key(m.a) !== key(joint) && key(m.b) !== key(joint)) : source;
  if (next.length === source.length) {
    const member = memberNear(px, py, source);
    if (!member) return;
    next = source.filter((m) => m !== member);
  }
  // A first click may have swapped the material. Undo the entire double-click as one edit.
  if (replaceLastEdit) { members = next; updateBudget(); }
  else commit(next);
  hover = null;
  sound.erase();
}

function swapMaterial(m) {
  if (m.mat === tool || m.mat === 'road') return;
  const swapped = { ...m, mat: tool };
  const problem = memberProblem(mission, members.filter((o) => o !== m), swapped);
  if (problem) { toast(PROBLEMS[problem]?.(tool) || 'That doesn\'t fit there.', true); sound.buzz(); return; }
  commit(members.map((o) => (o === m ? swapped : o)));
  sound.place(tool, memberLength(m));
}

/* A double click or double tap erases whatever is under it, with any tool. */
const DOUBLE_TAP_MS = 450;
let lastTap = null;

function onDown(event) {
  sound.unlock();
  if (!mission || mode !== 'build' || event.button !== 0 || !event.isPrimary || pointer) return;
  const x = event.offsetX, y = event.offsetY;
  const previous = lastTap && lastTap.members === members && lastTap.tool === tool &&
    lastTap.type === event.pointerType && performance.now() - lastTap.at < DOUBLE_TAP_MS &&
    Math.hypot(x - lastTap.x, y - lastTap.y) < Math.min(12, view.scale * CELL * 0.35) ? lastTap : null;
  lastTap = null;
  hover = null;
  canvas.setPointerCapture?.(event.pointerId);
  pointer = { id: event.pointerId, x, y, moved: false, previous };
  if (tool === 'erase') return;
  const from = nearestSite(x, y, sites, snapRadius());
  if (!from) return;
  const targets = sites.filter((p) => key(p) !== key(from) &&
    memberLength({ a: from, b: p }) <= reach(tool) + 1e-6 && !plan(from, p, tool).problem);
  drag = { from, to: null, ok: false, mat: tool, targets };
  focus = [...from, reach(tool) / CELL];
}

function updateDrag(px, py) {
  const to = reachTarget(drag, px, py);
  if (drag.to && key(to) === key(drag.to)) return;
  drag.to = key(to) === key(drag.from) ? null : to;
  drag.plan = drag.to ? plan(drag.from, to, drag.mat) : null;
  drag.ok = !!drag.plan && !drag.plan.problem;
  if (drag.ok) {
    drag.next = build(drag.plan);
    drag.cost = bridgeCost(drag.next) - bridgeCost(members);
  }
  hover = null;
}

function onMove(event) {
  if (!mission || !event.isPrimary || (pointer && pointer.id !== event.pointerId)) return;
  const px = event.offsetX, py = event.offsetY;
  if (pointer && Math.hypot(px - pointer.x, py - pointer.y) > 6) pointer.moved = true;
  if (drag) { if (pointer.moved) updateDrag(px, py); }
  else updateHover(px, py);
}

function updateHover(px, py) {
  hover = null;
  if (mode === 'build') {
    const m = memberNear(px, py);
    if (!m) return;
    const peak = peaks.get(peakKey(m));
    hover = {
      member: m, px, py, targets: tool === 'erase' ? [] : attachmentPoints(m).filter((p) => jointAllowed(mission, p)),
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
  const { x, y, previous } = pointer;
  if (Math.hypot(event.offsetX - x, event.offsetY - y) > 6) pointer.moved = true;
  if (!pointer.moved) {
    const before = members;
    if (previous) {
      if (tool !== 'erase') erase(previous.x, previous.y, previous.changed);
    } else {
      const m = memberNear(x, y);
      if (tool === 'erase') erase(x, y, false);
      else if (m) swapMaterial(m);
      else if (!drag) toast('Drag from a bolt, joint or marked spot on a beam.');
      lastTap = { x, y, at: performance.now(), type: event.pointerType, tool, members, changed: before !== members };
    }
  } else if (drag) {
    updateDrag(event.offsetX, event.offsetY);
    if (drag.ok) {
      commit(drag.next);
      sound.place(drag.plan.add[0].mat, memberLength({ a: drag.from, b: drag.to }));
    } else if (drag.to) {
      toast(PROBLEMS[drag.plan.problem]?.(drag.mat) || 'That beam doesn\'t fit there.', true);
      sound.buzz();
    }
  }
  drag = null; focus = null; pointer = null;
}

function cancelDrag() { drag = null; focus = null; pointer = null; lastTap = null; }

/* ---------- testing ---------- */

function startTest() {
  cancelDrag();
  sound.prepareSplash();
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
        const { x, speed } = sim.waterEntry;
        const mass = sim.car.axles.reduce((sum, axle) => sum + axle.mass, 0);
        const pan = Math.max(-0.8, Math.min(0.8, 2 * view.sx(x) / view.width - 1));
        sound.splash(mass, speed, pan);
        burst(x, mission.water, '#e3f4ff', 40, 5);
      }
      if (event === 'fall') sound.engine(false);
      if (event.startsWith('impact:') && sim.car.axles[0].y > mission.water) sound.thud(Number(event.slice(7)));
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
  const pan = Math.max(-0.75, Math.min(0.75, 1.5 * (view.sx(sim.car.axles[0].x) / view.width - 0.5)));
  sound.engine(driving && !document.hidden, sim.car, pan);
  const strained = sim.beams.reduce((worst, b) =>
    !b.broken && !b.piece && b.usage > (worst?.usage ?? 0.6) ? b : worst, null);
  if (strained && Math.random() < dt * (strained.usage - 0.5) * 4) sound.creak(strained.usage, strained.mat);
  if (sim.result && !resultShown) {
    resultShown = true;
    finishTest(sim.result);
  }
}

function finishTest(result) {
  const finishedSim = sim;
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
      if (sim !== finishedSim) return;
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
      if (sim === finishedSim) toast(result === 'collision'
        ? `The ${name} hit an obstacle. Check for low beams or fallen pieces in its path.`
        : 'The road gave way. Look for red beams and try bracing them with triangles.', true, 4600);
    }, 900);
  }
}

/* ---------- loop ---------- */

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  labelCanvas.width = Math.round(innerWidth * ratio);
  labelCanvas.height = Math.round(innerHeight * ratio);
  labelCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
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
    draw(ctx, labelCtx, {
      mission, view, time, theme, scenery, mode, members, sim, parked, particles, drag, focus,
      hover: hover?.beam?.broken ? null : hover,
      peakOf: (m) => peaks.get(peakKey(m)),
    });
  }
  requestAnimationFrame(frame);
}

/* ---------- controls ---------- */

function newMission() {
  load(difficulty, `v2-${randomSeed()}`);
}

function showSolution() {
  document.body.classList.add('busy');
  $('[data-loading-text]').textContent = 'Designing a bridge';
  setTimeout(() => {
    const { members: solution, kind } = randomSolution(mission, Math.random, 600, recentSolutions);
    recentSolutions = [...recentSolutions.slice(-7), solution];
    commit(solution);
    solutionShown = true;
    peaks = new Map();
    document.body.classList.remove('busy');
    $('[data-loading-text]').textContent = 'Surveying the river';
    sound.place('steel');
    toast(`Here is ${/^[aeiou]/.test(DESIGN_NAMES[kind]) ? 'an' : 'a'} ${DESIGN_NAMES[kind]} that works, for ${money(bridgeCost(solution))}. Press Go! to watch it.`, false, 4200);
  }, 30);
}

/* Anything that throws away the player's bridge asks first. Nothing built
   yet means nothing to lose, so it just goes ahead. */
const built = () => mission && (members.length !== mission.span || members.some((m) => m.mat !== 'road'));
function confirmThen(title, text, ok, run) {
  cancelDrag();
  if (!built()) { run(); return; }
  $('[data-confirm-title]').textContent = title;
  $('[data-confirm-text]').textContent = text;
  $('[data-confirm-ok]').textContent = ok;
  confirmDialog.returnValue = '';
  confirmDialog.onclose = () => { if (confirmDialog.returnValue === 'ok') run(); };
  confirmDialog.showModal();
}

const actions = {
  test: () => (mode === 'build' ? startTest() : stopTest()),
  undo: () => {
    if (mode !== 'build' || !undoStack.length) return;
    cancelDrag();
    members = undoStack.pop(); updateBudget(); sound.erase();
  },
  clear: () => confirmThen('Clear the bridge?', 'This removes your supports and restores the full road.', 'Clear', () => {
    commit(roadDeck(mission)); peaks = new Map(); sound.erase();
  }),
  solution: () => confirmThen('Show a solution?', 'It replaces the bridge you built. Undo brings yours back.', 'Show solution', showSolution),
  new: () => confirmThen('Start a new river?', 'Your bridge here stays saved, but you leave this river. Its link takes you back.', 'New river', newMission),
  next: () => { win.close(); newMission(); },
  improve: () => { win.close(); stopTest(); },
  help: () => help.showModal(),
  sound: () => {
    const on = sound.toggle();
    if (on && mode === 'test') sound.prepareSplash();
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
canvas.addEventListener('pointercancel', (event) => { if (pointer?.id === event.pointerId) cancelDrag(); });
canvas.addEventListener('pointerleave', (event) => { if (!pointer) hover = null; else onMove(event); });
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.engine(false); });
window.addEventListener('hashchange', () => {
  const target = fromHash();
  if (target && (target.seed !== seed || target.difficulty !== difficulty)) load(target.difficulty, target.seed);
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest?.('input, dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
  const k = event.key.toLowerCase();
  if (k === ' ' || k === 'enter') { event.preventDefault(); sound.unlock(); actions.test(); }
  else if (k >= '1' && k <= '4') setTool(TOOLS[Number(k) - 1]);
  else if (k === 'u' || k === 'backspace') actions.undo();
  else if (k === 'n') actions.new();
  else if (k === 'm') actions.sound();
  else if (k === 'escape') cancelDrag();
});
help.addEventListener('click', () => sound.unlock(), { once: true });
help.addEventListener('close', () => store('seen-help', '1'));

for (const [mat, def] of Object.entries(MATERIALS)) {
  const price = document.querySelector(`[data-price="${mat}"]`);
  if (price) price.textContent = `$${def.cost}/m`;
}
if (!sound.enabled) { const b = $('[data-action="sound"]'); b.classList.add('off'); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Sound off'); }
resize();
const initial = fromHash();
load(initial?.difficulty || read('difficulty') || 'medium', initial?.seed || `v2-${randomSeed()}`);
if (!read('seen-help')) help.showModal();
requestAnimationFrame(frame);

// Read-only handles for the browser checks in tests/.
window.bridger = { get mission() { return mission; }, get view() { return view; }, get members() { return members; }, get sim() { return sim; } };
