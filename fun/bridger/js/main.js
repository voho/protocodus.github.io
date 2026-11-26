/* Bridger: build a bridge on the grid, then test it with the real
   simulation. Build mode edits a list of members; test mode runs a sim of a
   copy of it and colours every member by how close it is to breaking. */
import { randomSeed, hashSeed } from '../../shared/rng.js';
import { CELL, MATERIALS, VEHICLES, STEP, createSim, bridgeCost, memberLength, key } from './physics.js';
import { memberProblem, pairKey, isAnchor, jointAllowed, attachmentPoints, roadDeck, DESIGN_NAMES } from './mission.js';
import { createView, draw, stressColor, anchorHalfSize, jointRadius, beamWidth, projectTestBridge } from './render.js';
import { openSurvey, hasSurvey, newRiverSeed } from './survey.js';
import { createSound } from './sound.js';
import { THEMES, THEME_IDS, buildScenery, prepareSceneryArt } from './scenery.js';
import { preloadArt } from './art.js';
import { createCelebration, CELEBRATION_LENGTH } from './celebration.js';

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
let preparedSim = null, assetsPromise = null;
// Each river has its own world, picked from its seed; ?theme= previews one.
const requestedTheme = new URLSearchParams(location.search).get('theme');
const themeOverride = THEME_IDS.includes(requestedTheme) ? requestedTheme : null;
let theme = null, survey = null, pendingSurvey = null, busy = false;
let members = [], undoStack = [], tool = 'wood';
let joints = [], sites = [];
let mode = 'build', sim = null, simClock = 0, resultShown = false, drawnBroken = new Set();
let celebration = null, vehicleGone = false;
let peaks = new Map(), solutionShown = false, started = false, startedAt = 0;
let recentSolutions = [];
let pointer = null, hover = null, drag = null, focus = null, particles = [];
let toastTimer = 0, last = performance.now(), time = 0, frameId = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const peakKey = (m) => `${pairKey(m)}:${m.mat}`;

/* ---------- missions ---------- */

function prepareAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      preloadArt(Object.values(THEMES)).then(() => prepareSceneryArt(ctx)),
      sound.preload(),
      document.fonts.ready,
    ]).catch(error => {
      assetsPromise = null;
      throw error;
    });
  }
  return assetsPromise;
}

function fromHash() {
  const match = /^#(easy|medium|hard)-((?:v[23]-)?[a-z0-9]{3,16})$/i.exec(location.hash);
  return match ? { difficulty: match[1].toLowerCase(), seed: match[2].toLowerCase() } : null;
}

async function load(nextDifficulty, nextSeed, pushRiver = false) {
  cancelDrag();
  if (sim) stopTest();
  if (confirmDialog.open) confirmDialog.close('cancel');
  pendingSurvey?.close();
  const previousMission = mission;
  const current = openSurvey(DIFFICULTIES.includes(nextDifficulty) ? nextDifficulty : 'medium', nextSeed);
  pendingSurvey = current;
  busy = true;
  $('[data-retry]').hidden = true;
  $('[data-loading-text]').textContent = 'Preparing Bridger';
  try {
    const [nextMission] = await Promise.all([current.mission(), prepareAssets()]);
    if (pendingSurvey !== current || !nextMission) return;
    clearTimeout(toastTimer);
    toastEl.classList.remove('on');
    const keepBridge = mission && nextSeed === seed;
    mission = nextMission;
    difficulty = current.difficulty;
    seed = nextSeed;
    recentSolutions = [];
    store('difficulty', difficulty);
    const hash = `#${difficulty}-${seed}`;
    if (location.hash !== hash) {
      if (pushRiver) history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
    }
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
    const themeId = themeOverride || THEME_IDS[hashSeed(`${seed}:world`) % THEME_IDS.length];
    theme = THEMES[themeId];
    document.body.dataset.theme = themeId;
    document.body.dataset.ui = theme.ui;
    stopTest();
    if (win.open) win.close();
    if (!keepBridge || !view) {
      scenery = buildScenery(mission);
      resize();
    }
    updateBudget();
    paintFrame();
    survey?.close();
    survey = current;
    if (!document.body.classList.contains('ready') && !read('seen-help')) help.showModal();
    $('.hud').inert = false;
    document.body.classList.add('ready');
    say(`${VEHICLES[mission.vehicle].name} needs to cross a ${mission.right - mission.left} metre river. Budget ${money(mission.budget)}.${rule ? ` ${note.textContent}` : ''}`);
  } catch (error) {
    if (pendingSurvey !== current) return;
    current.close();
    if (survey && mission === previousMission) {
      history.replaceState(null, '', `#${difficulty}-${seed}`);
      document.querySelector(`input[name="difficulty"][value="${difficulty}"]`).checked = true;
      toast('This river could not be surveyed. Try New river.', true, 5000);
    } else {
      survey?.close();
      survey = mission = null;
      $('.hud').inert = true;
      document.body.classList.remove('ready');
      $('[data-loading-text]').textContent = 'Bridger couldn’t finish loading.';
      $('[data-retry]').hidden = false;
    }
    console.error(error);
  }
  pendingSurvey = null;
  busy = false;
}

function updateBudget() {
  prepareTest();
  hover = null;
  requestFrame();
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
  $('[data-action="clear"]').disabled = !built();
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

function breakDebris(x, y, color) {
  for (let i = 0; i < 10; i++) {
    particles.push({
      x, y, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3.5,
      life: 0.7 + Math.random() * 0.8, color, size: 0.08 + Math.random() * 0.12, square: true,
    });
  }
}

function splashSpray(x, y, speed) {
  if (reducedMotion.matches) return;
  const lift = Math.min(6, 2.3 + speed * 0.5);
  for (let i = 0; i < 34; i++) {
    const side = i % 2 ? 1 : -1;
    const vx = side * (0.25 + Math.random() * 0.7) * lift;
    const vy = lift * (0.35 + Math.random() * 0.85);
    particles.push({
      x: x + side * Math.random() * 0.34, y, vx, vy, life: 2 * vy / 9.81,
      size: 0.021 + Math.random() * 0.036, color: i % 3 ? '#e2f4efb8' : '#a8d9debd',
    });
  }
}

/* ---------- geometry for the pointer ---------- */

function gridAt(px, py) {
  return [Math.round(view.wx(px) / CELL), Math.round(view.wy(py) / CELL)];
}
const screenOf = (p) => [view.sx(p[0] * CELL), view.sy(p[1] * CELL)];
function nearestSite(px, py, options, radius) {
  let best = null, plate = null, shortest = radius;
  const half = anchorHalfSize(view);
  for (const p of options) {
    const [sx, sy] = screenOf(p);
    const d = Math.hypot(sx - px, sy - py);
    if (d < shortest) { shortest = d; best = p; }
    if (Math.abs(sx - px) <= half && Math.abs(sy - py) <= half && isAnchor(mission, p)) plate = p;
  }
  return best || plate;
}
const snapRadius = () => Math.max(9, jointRadius(view), Math.min(20, view.scale * CELL * 0.4));
function memberNear(px, py, existing = members, nodes = null) {
  let best = null, bestD = 14;
  // Walk the paint order backwards so a tap on crossing strokes picks the visible beam.
  for (let i = existing.length - 1; i >= 0; i--) {
    const m = existing[i];
    if (nodes && m.broken) continue;
    const ax = view.sx(nodes ? nodes[m.a].x : m.a[0] * CELL);
    const ay = view.sy(nodes ? nodes[m.a].y : m.a[1] * CELL);
    const dx = view.sx(nodes ? nodes[m.b].x : m.b[0] * CELL) - ax;
    const dy = view.sy(nodes ? nodes[m.b].y : m.b[1] * CELL) - ay;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
    const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    if (d <= beamWidth(view, m.mat) / 2 + 1) return m;
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

function setTool(next, moveFocus = false) {
  cancelDrag();
  hover = null;
  tool = next;
  document.querySelectorAll('[data-tool]').forEach((b) => {
    const selected = b.dataset.tool === tool;
    b.setAttribute('aria-checked', String(selected));
    b.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) b.focus();
  });
}

function erase(px, py, replaceLastEdit) {
  const joint = nearestSite(px, py, joints, Math.max(5, jointRadius(view), Math.min(10, view.scale * CELL * 0.22)));
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
  if (busy || !survey || mode !== 'build' || event.button !== 0 || !event.isPrimary || pointer) return;
  sound.unlock();
  requestFrame();
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
  requestFrame();
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
    const best = memberNear(px, py, sim.beams, sim.nodes);
    if (best) hover = { beam: best, px, py };
  }
}

function onUp(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  requestFrame();
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

function cancelDrag() { drag = null; focus = null; pointer = null; lastTap = null; requestFrame(); }

/* ---------- testing ---------- */

function prepareTest() {
  preparedSim = createSim(mission, members);
  parked = preparedSim.car;
  if (view) projectTestBridge(view, preparedSim);
}

function startTest() {
  last = performance.now();
  clearTimeout(toastTimer);
  toastEl.classList.remove('on');
  cancelDrag();
  if (!started) { started = true; startedAt = performance.now(); track('game_start', { action: 'test' }); }
  sim = preparedSim;
  preparedSim = null;
  simClock = 0;
  resultShown = false;
  drawnBroken = new Set();
  mode = 'test';
  hover = null;
  document.body.classList.add('testing');
  testLabel.textContent = 'Stop';
  $('[data-action="test"]').setAttribute('aria-label', 'Stop the test');
  say(`The ${VEHICLES[mission.vehicle].name.toLowerCase()} is driving onto your bridge.`);
}

function stopTest() {
  requestFrame();
  if (sim) {
    // Keep every member's worst moment on the drawing so weak spots stay visible.
    peaks = new Map();
    members.forEach((m, i) => { const b = sim.beams[i]; if (b) peaks.set(peakKey(m), b.broken ? 1 : b.peak); });
    prepareTest();
  }
  sim = null;
  celebration = null;
  vehicleGone = false;
  particles = [];
  mode = 'build';
  sound.engine(false);
  document.body.classList.remove('testing');
  testLabel.textContent = 'Go!';
  $('[data-action="test"]').setAttribute('aria-label', 'Test the bridge');
  hover = null;
  // A rotation during the drive measured the smaller test toolbar.
  if (measuredInTest) resize();
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
        splashSpray(x, mission.water, speed);
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
      breakDebris((na.x + nb.x) / 2, (na.y + nb.y) / 2, b.mat === 'wood' ? '#c98b4f' : b.mat === 'road' ? '#555b64' : '#b9c8d8');
    }
  });
  if (sim.car.state !== 'crossed') {
    sound.engine(sim.car.state === 'driving' && !document.hidden, sim.car, vehiclePan());
  }
  const strained = sim.beams.reduce((worst, b) =>
    !b.broken && !b.piece && b.usage > (worst?.usage ?? 0.6) ? b : worst, null);
  if (strained && Math.random() < dt * (strained.usage - 0.5) * 4) sound.creak(strained.usage, strained.mat);
  if (sim.result && !resultShown) {
    resultShown = true;
    finishTest(sim.result);
  }
}

function vehiclePan() {
  return Math.max(-1, Math.min(1, 1.5 * (view.sx(sim.car.axles[0].x) / view.width - 0.5)));
}

function driveAway(dt) {
  sim.advanceRunout(dt);
  const rear = sim.runoutRearX(), edge = view.wx(view.width + 2);
  vehicleGone = rear >= edge;
  const distance = Math.max(0.01, edge - celebration.startRear);
  const progress = Math.max(0, Math.min(1, (rear - celebration.startRear) / distance));
  // A wider window can extend the drive, but the receding engine stays quiet.
  const gain = 1 - progress * progress * (3 - 2 * progress);
  celebration.gain = Math.min(celebration.gain, gain);
  sound.engine(!vehicleGone && !document.hidden, sim.car, vehiclePan(), celebration.gain);
}

function finishTest(result) {
  const finishedSim = sim;
  const name = VEHICLES[mission.vehicle].name.toLowerCase();
  const cost = bridgeCost(members);
  if (result === 'win') {
    const broken = sim.brokeCount;
    celebration = createCelebration(mission, sim, reducedMotion.matches);
    celebration.showCard = cost <= mission.budget;
    celebration.startRear = sim.runoutRearX();
    celebration.gain = 1;
    sound.win();
    if (cost > mission.budget) {
      toast(`It works! But it costs ${money(cost)}, which is ${money(cost - mission.budget)} over budget. Try a cheaper shape.`, true, 5200);
      return;
    }
    track('game_end', { result: 'win', score: mission.budget - cost, duration_seconds: Math.round((performance.now() - startedAt) / 1000), hints_used: solutionShown ? 1 : 0 });
    $('[data-win-cost]').textContent = money(cost);
    const saved = mission.budget - cost;
    $('[data-win-title]').textContent = broken ? 'Wobbly, but across!' : 'Safe across!';
    $('[data-win-note]').textContent = `${saved > 0 ? `${money(saved)} left over from ${money(mission.budget)}.` : `Right on the budget of ${money(mission.budget)}.`}${solutionShown ? ' Now try one of your own.' : ' Can you build it cheaper?'}`;
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

let measuredInTest = false;
function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
  if (canvas.width !== width) canvas.width = labelCanvas.width = width;
  if (canvas.height !== height) canvas.height = labelCanvas.height = height;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  labelCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!mission) return;
  const footer = $('.hud-bottom');
  const splitControls = getComputedStyle(footer).display === 'contents';
  let upperEdge = $('.hud-top').getBoundingClientRect().bottom;
  if (splitControls) upperEdge = Math.max(upperEdge,
    $('.budget').getBoundingClientRect().bottom, $('.materials').getBoundingClientRect().bottom);
  const lowerEdge = (splitControls ? $('.toolbar') : footer).getBoundingClientRect().top;
  measuredInTest = mode === 'test';
  view = createView(mission, innerWidth, innerHeight, upperEdge + 6, innerHeight - lowerEdge + 6);
  requestFrame();
}

function requestFrame() {
  if (frameId === null && !document.hidden && mission && view) frameId = requestAnimationFrame(frame);
}

function paintFrame() {
  const effectLength = reducedMotion.matches ? 0.4 : CELEBRATION_LENGTH;
  draw(ctx, labelCtx, {
    mission, view, time, theme, scenery, mode, members, sim, parked, particles, drag, focus,
    celebration: celebration && celebration.elapsed < effectLength ? celebration : null,
    vehicleGone, reducedMotion: reducedMotion.matches,
    hover: hover?.beam?.broken ? null : hover,
    peaks, peakOf: (m) => peaks.get(peakKey(m)),
  });
}

function frame(now) {
  frameId = null;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  const paused = help.open || confirmDialog.open;
  if (mission && view) {
    if (!paused && mode === 'test' && sim && !sim.settled) stepTest(dt);
    const effectLength = reducedMotion.matches ? 0.4 : CELEBRATION_LENGTH;
    if (celebration && !paused) {
      celebration.elapsed += dt;
      driveAway(dt);
      if (vehicleGone && celebration.elapsed >= effectLength) {
        if (celebration.showCard) win.showModal();
        celebration = null;
      }
    }
    for (const p of particles) {
      p.vy -= 9.81 * dt * (p.square ? 0.5 : 1);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
    }
    if (particles.length) particles = particles.filter((p) => p.life > 0);
    if (hover?.beam) {
      hover.label = `${MATERIALS[hover.beam.mat].name} · ${Math.round(hover.beam.usage * 100)}%`;
      hover.color = stressColor(hover.beam.usage);
    }
    paintFrame();
  }
  if (!reducedMotion.matches || (!paused && (celebration || (sim && !sim.settled))) || particles.length) requestFrame();
}

/* ---------- controls ---------- */

function newMission() {
  load(difficulty, newRiverSeed(), true);
}

function showSolution() {
  if (busy || !mission) return;
  const { members: solution, kind } = survey.solution(recentSolutions);
  recentSolutions = [...recentSolutions.slice(-7), solution];
  peaks = new Map();
  commit(solution);
  solutionShown = true;
  sound.place('steel');
  toast(`Here is ${/^[aeiou]/.test(DESIGN_NAMES[kind]) ? 'an' : 'a'} ${DESIGN_NAMES[kind]} that works, for ${money(bridgeCost(solution))}. Press Go! to watch it.`, false, 4200);
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
  const current = survey;
  confirmDialog.returnValue = '';
  confirmDialog.onclose = () => { if (confirmDialog.returnValue === 'ok' && current === survey && !busy) run(); };
  sound.engine(false);
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
  help: () => { sound.engine(false); help.showModal(); },
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
  if (busy || !survey) return;
  sound.unlock();
  if (button.dataset.tool) setTool(button.dataset.tool);
  else actions[button.dataset.action]?.();
});
document.querySelectorAll('input[name="difficulty"]').forEach((radio) => radio.addEventListener('change', () => {
  // Same river, a different budget.
  if (radio.checked && survey) load(radio.value, survey.seed);
}));
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
for (const name of ['pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, (event) => { if (pointer?.id === event.pointerId) cancelDrag(); });
}
window.addEventListener('blur', cancelDrag);
canvas.addEventListener('pointerleave', (event) => { if (!pointer) { hover = null; requestFrame(); } else onMove(event); });
window.addEventListener('resize', resize);
reducedMotion.addEventListener('change', requestFrame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId);
    frameId = null;
    sound.engine(false);
  } else {
    last = performance.now();
    requestFrame();
  }
});
window.addEventListener('hashchange', () => {
  const target = fromHash();
  const selected = pendingSurvey || survey;
  if (!target || (target.seed === selected?.seed && target.difficulty === selected?.difficulty)) return;
  // An externally opened, unsurveyed legacy link gets its own startup.
  // New rivers, difficulty changes and revisits have their proofs in memory.
  if (mission && !hasSurvey(target.seed)) location.reload();
  else load(target.difficulty, target.seed);
});
document.addEventListener('keydown', (event) => {
  if (busy || !survey || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.isContentEditable || event.target.closest?.('input, textarea, select, dialog[open]')) return;
  const k = event.key.toLowerCase();
  const material = event.target.closest?.('[data-tool]');
  if (material && ['arrowleft', 'arrowup', 'arrowright', 'arrowdown'].includes(k)) {
    event.preventDefault();
    const step = k === 'arrowleft' || k === 'arrowup' ? -1 : 1;
    setTool(TOOLS[(TOOLS.indexOf(material.dataset.tool) + step + TOOLS.length) % TOOLS.length], true);
    return;
  }
  if (k === ' ' || k === 'enter') {
    if (event.repeat) { event.preventDefault(); return; }
    if (event.target.closest?.('button, a[href], summary')) return;
    event.preventDefault(); sound.unlock(); actions.test();
    return;
  }
  if (event.repeat) return;
  if (/^[1-4]$/.test(k)) setTool(TOOLS[Number(k) - 1], !!material);
  else if (k === 'u' || k === 'backspace') { event.preventDefault(); actions.undo(); }
  else if (k === 'n') actions.new();
  else if (k === 'm') actions.sound();
  else if (k === 'escape') cancelDrag();
});
help.addEventListener('click', () => sound.unlock(), { once: true });
help.addEventListener('close', () => store('seen-help', '1'));
for (const dialog of [help, confirmDialog]) dialog.addEventListener('close', () => {
  last = performance.now();
  requestFrame();
});

for (const [mat, def] of Object.entries(MATERIALS)) {
  const price = document.querySelector(`[data-price="${mat}"]`);
  if (price) price.textContent = `$${def.cost}/m`;
}
if (!sound.enabled) { const b = $('[data-action="sound"]'); b.classList.add('off'); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Sound off'); }
resize();
const firstRiver = fromHash() ?? { difficulty: read('difficulty') || 'medium', seed: `v2-${randomSeed()}` };
function startGame() {
  const target = fromHash() ?? firstRiver;
  load(target.difficulty, target.seed);
}
$('[data-retry]').addEventListener('click', startGame);
startGame();

// Read-only handles for the browser checks in tests/.
window.bridger = { get mission() { return mission; }, get view() { return view; }, get members() { return members; }, get sim() { return sim; } };
