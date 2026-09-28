import { tileAt, buildProblem, constructionCost, networkAlreadyBuilt, priceFor, BUILD_COSTS } from './model.js';
import { networkTerrainShape, networkEdgeAllowed } from './terrain-engineering.js';
import { quoteBuildPlan, resolveBuildTool } from './construction-plan.js';

const STEPS = [[1,0],[-1,0],[0,1],[0,-1]], START = 4;
// Search-box tile classes; 0 means not classified yet. Only flat ground and
// finished network turn; ramps pass along their axis; crossings run straight.
const BLOCKED = 1, FLAT = 2, RAMP_X = 3, RAMP_Y = 4, CROSSING = 5, BUILT = 6;
const sound = quote => !quote.issues.length && quote.placements.every(p => p.state !== 'blocked' && p.state !== 'slope');
const lineCost = quote => quote.placements.reduce((sum, p) => sum + p.cost, 0);

/** The plain L between two tiles, along the longer axis first unless `first` names the axis. */
export function gridLine(a,b,first=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'x':'y') { const points=[];let x=a.x,y=a.y;points.push({x,y});const stepX=()=>{while(x!==b.x){x+=Math.sign(b.x-x);points.push({x,y});}};const stepY=()=>{while(y!==b.y){y+=Math.sign(b.y-y);points.push({x,y});}};if(first==='x'){stepX();stepY();}else{stepY();stepX();}return points; }

/**
 * A Road or Rail drag: the plain L when it builds, else the other bend, else a
 * capped A* that follows the grade rules. Read-only; funds never change the path.
 * Returns {path, reason: 'direct'|'flipped'|'routed'|'fallback'|'too-far', expanded}.
 */
export function planNetworkStroke(game, mode, from, to, { margin = 12, maxExpanded = 40000, budgetMs = 8 } = {}) {
  const deadline = performance.now() + budgetMs, line = gridLine(from, to), quote = quoteBuildPlan(game, mode, line);
  if (sound(quote)) return { path: line, reason: 'direct', expanded: 0 };
  let cheapest = lineCost(quote), expanded = 0;
  const result = (path, reason) => ({ path, reason, expanded });
  if (from.x !== to.x && from.y !== to.y) {
    const flipped = gridLine(from, to, line[1].x === from.x ? 'x' : 'y'), other = quoteBuildPlan(game, mode, flipped);
    if (sound(other)) return result(flipped, 'flipped');
    cheapest = Math.min(cheapest, lineCost(other));
  }
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin), y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(game.width - 1, Math.max(from.x, to.x) + margin), y1 = Math.min(game.height - 1, Math.max(from.y, to.y) + margin);
  const w = x1 - x0 + 1, cells = w * (y1 - y0 + 1), states = cells * 5, unit = priceFor(game, BUILD_COSTS[mode]), prices = {};
  if (!tileAt(game, from.x, from.y) || !tileAt(game, to.x, to.y) || (from.x === to.x && from.y === to.y) || cells > 1 << 17) return result(line, 'fallback');
  const kind = new Uint8Array(cells), price = new Float32Array(cells), penalty = new Float32Array(cells);
  const g = new Float32Array(states), parent = new Int32Array(states), closed = new Uint8Array(states);
  const start = (from.y - y0) * w + from.x - x0, goal = (to.y - y0) * w + to.x - x0, gx = to.x - x0, gy = to.y - y0;
  const heuristic = i => Math.abs(i % w - gx) + Math.abs((i / w | 0) - gy);
  // Passability is build()'s own verdict with unlimited funds, including its
  // side-contact rules against finished ramps; slope axes come from the grade.
  const classify = i => {
    const x = x0 + i % w, y = y0 + (i / w | 0), tile = tileAt(game, x, y), tool = resolveBuildTool(game, mode, x, y);
    if (networkAlreadyBuilt(tile, tool)) return BUILT;
    const shape = tool === mode ? networkTerrainShape(game, x, y) : null;
    if (shape?.kind === 'complex' || buildProblem(game, tool, x, y, { money: Infinity })) return BLOCKED;
    price[i] = prices[`${tool}:${tile.terrain}`] ??= constructionCost(game, tool, x, y) / unit;
    return !shape ? CROSSING : shape.kind === 'flat' ? FLAT : shape.axis === 'x' ? RAMP_X : RAMP_Y;
  };
  const at = i => kind[i] || (kind[i] = classify(i));
  if (at(start) === BLOCKED || at(goal) === BLOCKED) return result(line, 'fallback');
  // Ties prefer the state nearer the goal, then the lower index, so equal inputs give equal paths.
  let size = 0, heap = new Int32Array(1024), keys = new Float64Array(1024), near = new Int32Array(1024);
  const before = (a, b) => keys[a] < keys[b] || keys[a] === keys[b] && (near[a] < near[b] || near[a] === near[b] && heap[a] < heap[b]);
  const grown = list => { const next = new list.constructor(list.length * 2); next.set(list); return next; };
  const swap = (a, b) => { const s = heap[a], k = keys[a], h = near[a]; heap[a] = heap[b]; keys[a] = keys[b]; near[a] = near[b]; heap[b] = s; keys[b] = k; near[b] = h; };
  const push = (state, cost, h) => { if (size === heap.length) { heap = grown(heap); keys = grown(keys); near = grown(near); } let i = size++; heap[i] = state; keys[i] = cost + h; near[i] = h; while (i && before(i, (i - 1) >> 1)) { swap(i, (i - 1) >> 1); i = (i - 1) >> 1; } };
  const pop = () => { const top = heap[0]; swap(0, --size); for (let i = 0;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < size && before(l, m)) m = l; if (r < size && before(r, m)) m = r; if (m === i) break; swap(i, m); i = m; } return top; };
  const trace = state => { const path = []; for (; state >= 0; state = parent[state]) path.push({ x: x0 + (state / 5 | 0) % w, y: y0 + ((state / 5 | 0) / w | 0) }); return path.reverse(); };
  const search = () => {
    closed.fill(0); size = 0;
    const first = start * 5 + START; g[first] = 0; parent[first] = -1; closed[first] = 1; push(first, 0, heuristic(start));
    while (size) {
      const state = pop(), i = state / 5 | 0, arrival = state % 5;
      if (closed[state] === 2) continue;
      closed[state] = 2;
      if (i === goal) return trace(state);
      if (expanded >= maxExpanded || !(++expanded & 127) && performance.now() > deadline) return null;
      const here = kind[i], x = x0 + i % w, y = y0 + (i / w | 0), tile = tileAt(game, x, y);
      for (let d = 0; d < 4; d++) {
        const turn = arrival !== START && d !== arrival, ramp = d < 2 ? RAMP_X : RAMP_Y, [dx, dy] = STEPS[d], nx = x + dx, ny = y + dy;
        if (arrival !== START && d === (arrival ^ 1) || turn && here !== FLAT && here !== BUILT || (here === RAMP_X || here === RAMP_Y) && here !== ramp) continue;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const j = i + dx + dy * w, next = at(j), t = j * 5 + d;
        if (next === BLOCKED || (next === RAMP_X || next === RAMP_Y) && next !== ramp || closed[t] === 2) continue;
        if (!networkEdgeAllowed(tile, tileAt(game, nx, ny), dx, dy, mode, game, x, y)) continue;
        const cost = Math.fround(g[state] + (next === BUILT ? .6 : price[j]) + (turn ? .2 : 0) + penalty[j]);
        if (closed[t] === 1 && cost >= g[t]) continue;
        g[t] = cost; parent[t] = state; closed[t] = 1; push(t, cost, heuristic(j));
      }
    }
    return null;
  };
  const penalise = (x, y) => { if (x >= x0 && y >= y0 && x <= x1 && y <= y1) penalty[(y - y0) * w + x - x0] += 24; };
  // Validate with the construction quote; a ramp touched sideways by the path
  // itself is the one rule the search cannot see, so steer away and retry.
  for (let attempt = 0; attempt <= 3; attempt++) {
    const path = search();
    const onPath = new Set(path?.map(p => p.y * game.width + p.x));
    if (!path || onPath.size !== path.length) break;
    if (path.length - 1 > 1.6 * (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) + 8) return result(line, 'too-far');
    const routed = quoteBuildPlan(game, mode, path);
    if (sound(routed)) return routed.cost > 1.6 * cheapest ? result(line, 'too-far') : result(path, 'routed');
    for (const p of routed.placements) if (p.state === 'blocked' || p.state === 'slope') for (const [dx, dy] of [[0,0], ...STEPS]) if (!dx && !dy || onPath.has((p.y + dy) * game.width + p.x + dx)) penalise(p.x + dx, p.y + dy);
  }
  return result(line, 'fallback');
}
