/* Hedgerow — where a soldier can walk, and the way there.

   A coarse grid over the playable area (2 m cells). A cell is walkable when
   a soldier can stand at its centre: no blocking collider within his
   radius, water not too deep; its height is the ground under his feet —
   the terrain, or a bridge deck above the river. Neighbouring cells
   connect when the step between them is small (no climbing walls, trench
   sides or crates). A* finds a path between two points; the path is then
   pulled straight wherever the line between two of its points stays on
   walkable cells, so soldiers cut across open ground and only bend round
   houses, walls and the river. Built once when the level loads. */

import { MOVE } from './world.js';

const DIAG = Math.SQRT2;

export function createNav(world, { minX, maxX, minZ, maxZ }, { cell = 2, radius = 0.4, slope = 0.7, step = 0.45 } = {}) {
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const n = nx * nz;
  const h = new Float32Array(n).fill(NaN);          // ground height, NaN = no footing
  const th = new Float32Array(n);                    // the terrain under each cell
  const p = { x: 0, y: 0, z: 0 };

  const standable = (x, z, g) => {
    p.x = x; p.z = z;
    if (world.pushOut(p, radius, g, 1.7, 0.45) && Math.hypot(p.x - x, p.z - z) > 0.12) return false;
    return !world.tooDeep(x, z, 0.9, g);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + (i + 0.5) * cell, z = minZ + (j + 0.5) * cell;
    const t = world.terrain ? world.terrain.height(x, z) : 0;
    th[j * nx + i] = t;
    let g = world.groundAt(x, z, t, 0.45);
    if (standable(x, z, g)) { h[j * nx + i] = g; continue; }
    // a deck above (a bridge and its ramps): the highest surface, if there
    // is room to stand on it
    const top = world.groundAt(x, z, 1e4, 0);
    if (top > g + 0.45 && top < g + 10 && standable(x, z, top)) h[j * nx + i] = top;
  }
  // footing on something (a deck, a step): the climb onto it is limited to
  // what a soldier can step up (`step`); over the terrain only the slope
  // between cells (`slope`)
  const raised = new Uint8Array(n);
  for (let k = 0; k < n; k++) raised[k] = h[k] === h[k] && h[k] > th[k] + 0.2 ? 1 : 0;
  const linkH = (a, b) => Math.abs(h[a] - h[b]) <= (raised[a] || raised[b] ? step : slope);
  // raised footing counts only where it joins the ground: bridges stay,
  // the tops of walls, roofs and tree trunks (islands) are dropped
  {
    const seen = new Uint8Array(n);
    for (let k0 = 0; k0 < n; k0++) {
      if (seen[k0] || !raised[k0]) continue;
      const comp = [k0];
      seen[k0] = 1;
      let joins = false;
      for (let q = 0; q < comp.length; q++) {
        const k = comp[q], i = k % nx, j = Math.floor(k / nx);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const o = jj * nx + ii;
          if (!(h[o] === h[o]) || !linkH(o, k)) continue;
          if (!raised[o]) { joins = true; continue; }
          if (!seen[o]) { seen[o] = 1; comp.push(o); }
        }
      }
      if (!joins) for (const k of comp) h[k] = NaN;
    }
  }

  const index = (x, z) => {
    const i = Math.floor((x - minX) / cell), j = Math.floor((z - minZ) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  const centre = (k, out = {}) => { out.x = minX + ((k % nx) + 0.5) * cell; out.z = minZ + (Math.floor(k / nx) + 0.5) * cell; return out; };
  const walkable = (k) => k >= 0 && h[k] === h[k];
  const link = (a, b) => walkable(a) && walkable(b) && linkH(a, b);

  /* the walkable cell nearest to (x, z), within `reach` cells */
  function snap(x, z, reach = 4) {
    const k0 = index(x, z);
    if (walkable(k0)) return k0;
    const i0 = Math.floor((x - minX) / cell), j0 = Math.floor((z - minZ) / cell);
    let best = -1, bd = Infinity;
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (!walkable(k)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /* Is the straight line a → b walkable: on walkable, connected cells, and
     clear of colliders at knee height across a soldier's width (the cells
     only know their centres, 2 m apart; a line can still clip a corner)? */
  function lineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (cell * 0.4)));
    let prev = index(ax, az);
    if (!walkable(prev)) return false;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const k = index(ax + (bx - ax) * t, az + (bz - az) * t);
      if (k !== prev) {
        if (!link(prev, k)) return false;
        prev = k;
      }
    }
    if (d < 1e-3) return true;
    const dx = (bx - ax) / d, dz = (bz - az) / d;
    const ya = h[index(ax, az)] + 0.6, yb = h[index(bx, bz)] + 0.6;
    const dy = (yb - ya) / d;
    const len = Math.hypot(d, yb - ya);
    for (const off of [0, radius - 0.05, -(radius - 0.05)]) {
      const ox = ax - dz * off, oz = az + dx * off;
      if (world.raycast(ox, ya, oz, dx * d / len, dy * d / len, dz * d / len, len, MOVE, { noTerrain: true, noWater: true })) return false;
    }
    return true;
  }

  // A* scratch, reused between searches
  const gCost = new Float32Array(n), from = new Int32Array(n), stamp = new Uint32Array(n), closed = new Uint32Array(n);
  let search = 0;
  const heap = [];
  const fOf = new Float32Array(n);
  const push = (k) => {
    heap.push(k);
    let c = heap.length - 1;
    while (c > 0) {
      const pa = (c - 1) >> 1;
      if (fOf[heap[pa]] <= fOf[heap[c]]) break;
      [heap[pa], heap[c]] = [heap[c], heap[pa]];
      c = pa;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heap.length && fOf[heap[l]] < fOf[heap[m]]) m = l;
        if (r < heap.length && fOf[heap[r]] < fOf[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG]];

  /* A path from (ax, az) to (bx, bz) as world points [{x, z}, ...] ending at
     the goal. When the goal cannot be reached (inside a building, across
     the river away from a crossing) the path ends at the reachable cell
     nearest to it, if that is closer than where we start; null when there
     is no way at all within `maxNodes` expansions. */
  function findPath(ax, az, bx, bz, maxNodes = 12000) {
    const s = snap(ax, az), t = snap(bx, bz);
    if (s < 0 || t < 0) return null;
    if (lineClear(ax, az, bx, bz)) return [{ x: bx, z: bz }];
    search++;
    heap.length = 0;
    const ti = t % nx, tj = Math.floor(t / nx);
    const hEst = (k) => {
      const di = Math.abs((k % nx) - ti), dj = Math.abs(Math.floor(k / nx) - tj);
      return (Math.max(di, dj) + (DIAG - 1) * Math.min(di, dj)) * cell;
    };
    stamp[s] = search; gCost[s] = 0; from[s] = -1; fOf[s] = hEst(s);
    push(s);
    let found = false, expanded = 0, near = s, nearH = hEst(s);
    while (heap.length) {
      const k = pop();
      if (closed[k] === search) continue;
      closed[k] = search;
      if (k === t) { found = true; break; }
      const hk = hEst(k);
      if (hk < nearH) { nearH = hk; near = k; }
      if (++expanded > maxNodes) break;
      const i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj, w] of NB) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const q = jj * nx + ii;
        if (closed[q] === search || !link(k, q)) continue;
        // no cutting corners past a blocked cell
        if (di && dj && (!link(k, j * nx + ii) || !link(k, jj * nx + i))) continue;
        const g = gCost[k] + w * cell + Math.abs(h[q] - h[k]) * 2;
        if (stamp[q] === search && g >= gCost[q]) continue;
        stamp[q] = search; gCost[q] = g; from[q] = k; fOf[q] = g + hEst(q);
        push(q);
      }
    }
    let goal = t;
    if (!found) {
      if (near === s || nearH > hEst(s) - cell) return null;
      goal = near;
      const c = centre(near); bx = c.x; bz = c.z;
    }
    const cells = [];
    for (let k = goal; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    // pull the string: from each kept point, jump to the furthest cell in sight
    const pts = [{ x: ax, z: az }];
    let i = 0;
    const c = {};
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      const a = pts[pts.length - 1];
      for (; j > i + 1; j--) { centre(cells[j], c); if (lineClear(a.x, a.z, c.x, c.z)) break; }
      centre(cells[j], c);
      pts.push({ x: c.x, z: c.z });
      i = j;
    }
    pts.shift();
    if (!pts.length) return [{ x: bx, z: bz }];
    // end exactly at the goal when it can be reached from the last point
    const last = pts[pts.length - 1];
    if (last && lineClear(last.x, last.z, bx, bz)) pts[pts.length - 1] = { x: bx, z: bz };
    return pts;
  }

  return {
    cell, nx, nz, findPath, lineClear,
    walkable: (x, z) => walkable(index(x, z)),
    height: (x, z) => { const k = index(x, z); return walkable(k) ? h[k] : null; },
    /* the nearest walkable point to (x, z), or null */
    nearest(x, z, reach = 4) { const k = snap(x, z, reach); return k < 0 ? null : centre(k); },
    stats() { let w = 0; for (let k = 0; k < n; k++) if (walkable(k)) w++; return { cells: n, walkable: w }; },
  };
}
