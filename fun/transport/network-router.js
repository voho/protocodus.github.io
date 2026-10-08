import { tileAt, buildProblem, constructionCost, networkAlreadyBuilt, priceFor, getVehiclePurchase, BUILD_COSTS, INDUSTRIES, STATION_RADIUS } from './model.js';
import { networkTerrainShape, networkEdgeAllowed } from './terrain-engineering.js';
import { quoteBuildPlan, resolveBuildTool } from './construction-plan.js';
import { industryDistance, industrySize } from './industry-sites.js';
import { stationReach } from './station-sites.js';

const STEPS = [[1,0],[-1,0],[0,1],[0,-1]], START = 4;
// Search-box tile classes; 0 means not classified yet. Only flat ground and
// finished network turn; ramps pass along their axis; crossings run straight.
const BLOCKED = 1, FLAT = 2, RAMP_X = 3, RAMP_Y = 4, CROSSING = 5, BUILT = 6;
const sound = quote => !quote.issues.length && quote.placements.length > 0 && quote.placements.every(p => p.state !== 'blocked' && p.state !== 'slope');
const lineCost = quote => quote.cost;

/** The plain L between two tiles, along the longer axis first unless `first` names the axis. */
export function gridLine(a,b,first=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'x':'y') { const points=[];let x=a.x,y=a.y;points.push({x,y});const stepX=()=>{while(x!==b.x){x+=Math.sign(b.x-x);points.push({x,y});}};const stepY=()=>{while(y!==b.y){y+=Math.sign(b.y-y);points.push({x,y});}};if(first==='x'){stepX();stepY();}else{stepY();stepX();}return points; }

// A capped A* over (tile, arrival axis) states inside one box of the map. It starts from
// any of `starts` and stops at the first state `arrived` accepts, so drags and planned
// connections share the grade rules, the prices and the tie-breaking.
function gradeSearch(game, mode, x0, y0, x1, y1, maxExpanded, deadline) {
  const w = x1 - x0 + 1, cells = w * (y1 - y0 + 1), states = cells * 5, unit = priceFor(game, BUILD_COSTS[mode]), prices = {};
  const kind = new Uint8Array(cells), price = new Float32Array(cells), penalty = new Float32Array(cells);
  const g = new Float32Array(states), parent = new Int32Array(states), closed = new Uint8Array(states);
  let expanded = 0;
  // Passability is build()'s own verdict with unlimited funds, including its
  // side-contact rules against finished ramps; slope axes come from the grade.
  const classify = i => {
    const x = x0 + i % w, y = y0 + (i / w | 0), tile = tileAt(game, x, y), tool = resolveBuildTool(game, mode, x, y);
    if (networkAlreadyBuilt(tile, tool)) return BUILT;
    const shape = tool === mode ? networkTerrainShape(game, x, y) : null;
    if (shape?.kind === 'complex' || buildProblem(game, tool, x, y, { money: Infinity, autoLevel: false })) return BLOCKED;
    price[i] = prices[`${tool}:${tile.terrain}`] ??= constructionCost(game, tool, x, y) / unit;
    return !shape ? CROSSING : shape.kind === 'flat' ? FLAT : shape.axis === 'x' ? RAMP_X : RAMP_Y;
  };
  const at = i => kind[i] || (kind[i] = classify(i));
  // Ties prefer the state nearer the goal, then the lower index, so equal inputs give equal paths.
  let size = 0, heap = new Int32Array(1024), keys = new Float64Array(1024), near = new Int32Array(1024);
  const before = (a, b) => keys[a] < keys[b] || keys[a] === keys[b] && (near[a] < near[b] || near[a] === near[b] && heap[a] < heap[b]);
  const grown = list => { const next = new list.constructor(list.length * 2); next.set(list); return next; };
  const swap = (a, b) => { const s = heap[a], k = keys[a], h = near[a]; heap[a] = heap[b]; keys[a] = keys[b]; near[a] = near[b]; heap[b] = s; keys[b] = k; near[b] = h; };
  const push = (state, cost, h) => { if (size === heap.length) { heap = grown(heap); keys = grown(keys); near = grown(near); } let i = size++; heap[i] = state; keys[i] = cost + h; near[i] = h; while (i && before(i, (i - 1) >> 1)) { swap(i, (i - 1) >> 1); i = (i - 1) >> 1; } };
  const pop = () => { const top = heap[0]; swap(0, --size); for (let i = 0;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < size && before(l, m)) m = l; if (r < size && before(r, m)) m = r; if (m === i) break; swap(i, m); i = m; } return top; };
  const trace = state => { const path = []; for (; state >= 0; state = parent[state]) path.push({ x: x0 + (state / 5 | 0) % w, y: y0 + ((state / 5 | 0) / w | 0) }); return path.reverse(); };
  const search = (starts, arrived, heuristic, entry = () => 0) => {
    closed.fill(0); size = 0;
    for (const start of starts) { const first = start * 5 + START; g[first] = entry(start); parent[first] = -1; closed[first] = 1; push(first, g[first], heuristic(start)); }
    while (size) {
      const state = pop(), i = state / 5 | 0, arrival = state % 5;
      if (closed[state] === 2) continue;
      closed[state] = 2;
      if (arrived(i, state)) return trace(state);
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
  // A ramp touched sideways by the path itself is the one rule the search cannot
  // see, so the quote's refused tiles and their neighbours on the path cost more.
  const steer = (quote, onPath) => {
    for (const p of quote.placements) if (p.state === 'blocked' || p.state === 'slope') for (const [dx, dy] of [[0,0], ...STEPS]) {
      const x = p.x + dx, y = p.y + dy;
      if ((!dx && !dy || onPath.has(y * game.width + x)) && x >= x0 && y >= y0 && x <= x1 && y <= y1) penalty[(y - y0) * w + x - x0] += 24;
    }
  };
  return { at, search, steer, cost: i => Math.fround((at(i) === BUILT ? .6 : price[i]) + penalty[i]), steps: state => parent[state] < 0 ? 0 : parent[parent[state]] < 0 ? 1 : 2, get expanded() { return expanded; } };
}

/**
 * A Road or Rail drag: the plain L when it builds, else the other bend, else a
 * capped A* that follows the grade rules. Read-only; funds never change the path.
 * Returns {path, reason: 'direct'|'flipped'|'routed'|'fallback'|'too-far', expanded}.
 */
export function planNetworkStroke(game, mode, from, to, { margin = 12, maxExpanded = 40000, budgetMs = 8 } = {}) {
  const deadline = performance.now() + budgetMs, line = gridLine(from, to), quote = quoteBuildPlan(game, mode, line);
  if (sound(quote)) return { path: line, reason: 'direct', expanded: 0 };
  let cheapest = lineCost(quote), grid = null;
  const result = (path, reason) => ({ path, reason, expanded: grid ? grid.expanded : 0 });
  if (from.x !== to.x && from.y !== to.y) {
    const flipped = gridLine(from, to, line[1].x === from.x ? 'x' : 'y'), other = quoteBuildPlan(game, mode, flipped);
    if (sound(other)) return result(flipped, 'flipped');
    cheapest = Math.min(cheapest, lineCost(other));
  }
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin), y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(game.width - 1, Math.max(from.x, to.x) + margin), y1 = Math.min(game.height - 1, Math.max(from.y, to.y) + margin);
  const w = x1 - x0 + 1, cells = w * (y1 - y0 + 1);
  if (!tileAt(game, from.x, from.y) || !tileAt(game, to.x, to.y) || (from.x === to.x && from.y === to.y) || cells > 1 << 17) return result(line, 'fallback');
  grid = gradeSearch(game, mode, x0, y0, x1, y1, maxExpanded, deadline);
  const start = (from.y - y0) * w + from.x - x0, goal = (to.y - y0) * w + to.x - x0, gx = to.x - x0, gy = to.y - y0;
  const heuristic = i => Math.abs(i % w - gx) + Math.abs((i / w | 0) - gy);
  if (grid.at(start) === BLOCKED || grid.at(goal) === BLOCKED) return result(line, 'fallback');
  // Validate with the construction quote and retry away from what it refuses.
  for (let attempt = 0; attempt <= 3; attempt++) {
    const path = grid.search([start], i => i === goal, heuristic);
    const onPath = new Set(path?.map(p => p.y * game.width + p.x));
    if (!path || onPath.size !== path.length) break;
    if (path.length - 1 > 1.6 * (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) + 8) return result(line, 'too-far');
    const routed = quoteBuildPlan(game, mode, path);
    if (sound(routed)) return routed.cost > 1.6 * cheapest ? result(line, 'too-far') : result(path, 'routed');
    grid.steer(routed, onPath);
  }
  return result(line, 'fallback');
}

/**
 * The first-route planner: one road or rail from a stop site beside `source` to the
 * network of a stop that already serves `target`, else to a stop site beside it, on the
 * drag router's grade rules and prices. New stops take the path's ends, at ground level
 * and never on a bridge or tunnel. Read-only; `target` is an industry or a town.
 * Returns {ok, mode, path, stops: [{x, y, end, cost}], ends: [stop|null, stop|null], tiles, cost,
 * vehicleCost, expanded} with `ends` the stops it reuses, or {ok: false, reason}.
 */
export function planConnection(game, source, target, mode = 'road', { margin = 10, maxExpanded = 400000, budgetMs = 250 } = {}) {
  const deadline = performance.now() + budgetMs, R = STATION_RADIUS, stopTool = mode === 'rail' ? 'train-stop' : 'bus-stop';
  const industry = site => Boolean(INDUSTRIES[site.kind]), span = site => industry(site) ? industrySize(site) : 1;
  const reach = (site, p) => industry(site) ? industryDistance(site, p) : Math.hypot(site.x - p.x, site.y - p.y);
  let grid = null;
  const fail = reason => ({ ok: false, reason, expanded: grid ? grid.expanded : 0 });
  if (!source || !target || mode !== 'road' && mode !== 'rail') return fail('no-site');
  // A stop already serving an end is reused; one serving both ends counts as the source's.
  const serving = site => game.stations.filter(stop => stop.mode === mode && reach(site, stop) <= stationReach(stop));
  const from = serving(source), to = serving(target).filter(stop => !from.includes(stop));
  const boundsReach = Math.max(R, ...from.map(stationReach), ...to.map(stationReach));
  const x0 = Math.max(0, Math.min(source.x, target.x) - boundsReach - margin), y0 = Math.max(0, Math.min(source.y, target.y) - boundsReach - margin);
  const x1 = Math.min(game.width - 1, Math.max(source.x + span(source), target.x + span(target)) - 1 + boundsReach + margin), y1 = Math.min(game.height - 1, Math.max(source.y + span(source), target.y + span(target)) - 1 + boundsReach + margin);
  const w = x1 - x0 + 1, cells = w * (y1 - y0 + 1);
  if (cells > 1 << 18) return fail('too-far');
  grid = gradeSearch(game, mode, x0, y0, x1, y1, maxExpanded, deadline);
  const index = p => (p.y - y0) * w + p.x - x0, stations = new Set(game.stations.map(stop => stop.y * game.width + stop.x));
  // A new stop stands where its line runs at ground level, never on a bridge, a tunnel or another stop.
  const stopSite = (x, y) => { const k = grid.at((y - y0) * w + x - x0), tile = tileAt(game, x, y); return (k === FLAT || k === RAMP_X || k === RAMP_Y || k === BUILT && !tile.bridge && !tile.tunnel) && !stations.has(y * game.width + x); };
  const catchment = site => {
    const list = [];
    for (let y = Math.max(y0, site.y - R); y <= Math.min(y1, site.y + span(site) - 1 + R); y++) for (let x = Math.max(x0, site.x - R); x <= Math.min(x1, site.x + span(site) - 1 + R); x++) {
      const d = reach(site, { x, y });
      if (d <= R && (d > 0 || !industry(site)) && stopSite(x, y)) list.push((y - y0) * w + x - x0);
    }
    return list;
  };
  const starts = from.length ? from.map(index) : catchment(source);
  // Steps the path still needs at each goal, since a service needs its stops three tiles apart.
  // A serving stop's finished network is joined to it already, so reaching any of it will do.
  const need = new Int8Array(cells).fill(-1), owner = new Int32Array(cells);
  if (to.length) {
    const queue = new Int32Array(cells); let head = 0, tail = 0;
    to.forEach((stop, n) => { const i = index(stop); if (need[i] < 0) { need[i] = 2; owner[i] = n; queue[tail++] = i; } });
    while (head < tail) {
      const i = queue[head++], x = x0 + i % w, y = y0 + (i / w | 0), tile = tileAt(game, x, y);
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy, j = i + dx + dy * w;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || need[j] >= 0 || grid.at(j) !== BUILT || !networkEdgeAllowed(tile, tileAt(game, nx, ny), dx, dy, mode, game, x, y)) continue;
        need[j] = Math.max(0, need[i] - 1); owner[j] = owner[i]; queue[tail++] = j;
      }
    }
  } else for (const i of catchment(target)) need[i] = 2;
  let gx0 = Infinity, gy0 = Infinity, gx1 = -1, gy1 = -1;
  for (let i = 0; i < cells; i++) if (need[i] >= 0) { const x = i % w, y = i / w | 0; gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
  if (!starts.length || gx1 < 0) return fail('no-site');
  const heuristic = i => { const x = i % w, y = i / w | 0; return Math.max(0, gx0 - x, x - gx1) + Math.max(0, gy0 - y, y - gy1); };
  for (let attempt = 0; attempt <= 3; attempt++) {
    const path = grid.search(starts, (i, state) => need[i] >= 0 && grid.steps(state) >= need[i], heuristic, grid.cost);
    const onPath = new Set(path?.map(p => p.y * game.width + p.x));
    if (!path || onPath.size !== path.length) break;
    const quote = quoteBuildPlan(game, mode, path);
    if (!sound(quote)) { grid.steer(quote, onPath); continue; }
    const first = path[0], last = path.at(-1), ends = [from.find(stop => stop.x === first.x && stop.y === first.y) || null, to.length ? to[owner[index(last)]] : null];
    // The path quote already includes the road below each new road stop.
    // Standalone stop construction adds that road itself; a complete connection pays for it once.
    const stops = [first, last].flatMap(({ x, y }, end) => ends[end] ? [] : [{ x, y, end, cost: priceFor(game, BUILD_COSTS[stopTool]) }]);
    // A stop on a finished line passes build()'s own check now; the others wait for their line.
    if (stops.some(({ x, y }) => tileAt(game, x, y)[mode] && buildProblem(game, stopTool, x, y, { money: Infinity }))) return fail('no-site');
    const cost = quote.cost + stops.reduce((sum, stop) => sum + stop.cost, 0);
    return { ok: true, mode, path, stops, ends, tiles: quote.placements.filter(p => p.state !== 'built').length, terrain: quote.terrain, terrainCost: quote.terrainCost, networkCost: quote.networkCost, cost, vehicleCost: getVehiclePurchase(game, mode).cost, expanded: grid.expanded };
  }
  return fail('no-route');
}
