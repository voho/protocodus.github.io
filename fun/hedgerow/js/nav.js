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

/* A moving circle against a box with rounded corners, clipped to the part
   of the movement where the body overlaps its vertical span. This catches
   a low ceiling entered while the ground descends between body samples. */
function bodyCrosses(col, ax, az, bx, bz, ya, yb, radius, height, step) {
  let lo = 0, hi = 1;
  const dy = yb - ya, low = col.bottom - height, high = col.top - step;
  if (Math.abs(dy) < 1e-10) {
    if (ya <= low || ya >= high) return false;
  } else {
    let a = (low - ya) / dy, b = (high - ya) / dy;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
    if (lo >= hi - 1e-10) return false;
  }
  const dx = bx - ax, dz = bz - az;
  if (col.type === 'cyl') return circleCrosses(ax - col.x, az - col.z, dx, dz, radius + col.r, lo, hi);
  const rx = ax - col.x, rz = az - col.z;
  const x = rx * col.c - rz * col.s, z = rx * col.s + rz * col.c;
  const vx = dx * col.c - dz * col.s, vz = dx * col.s + dz * col.c;
  if (rectangleCrosses(x, z, vx, vz, col.hx + radius, col.hz, lo, hi) ||
      rectangleCrosses(x, z, vx, vz, col.hx, col.hz + radius, lo, hi)) return true;
  for (const cx of [-col.hx, col.hx]) for (const cz of [-col.hz, col.hz]) {
    if (circleCrosses(x - cx, z - cz, vx, vz, radius, lo, hi)) return true;
  }
  return false;
}

function rectangleCrosses(x, z, vx, vz, hx, hz, lo, hi) {
  for (const [p, v, h] of [[x, vx, hx], [z, vz, hz]]) {
    if (Math.abs(v) < 1e-10) { if (Math.abs(p) >= h) return false; continue; }
    let a = (-h - p) / v, b = (h - p) / v;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
    if (lo >= hi - 1e-10) return false;
  }
  return true;
}

function circleCrosses(x, z, vx, vz, radius, lo, hi) {
  const speed2 = vx * vx + vz * vz;
  const t = speed2 > 1e-12 ? Math.max(lo, Math.min(hi, -(x * vx + z * vz) / speed2)) : lo;
  return (x + vx * t) ** 2 + (z + vz * t) ** 2 < radius * radius - 1e-10;
}

/* The heightfield is linear inside each master-grid triangle. Include the
   X/Z edges and its diagonal, so even a short crest has its actual height. */
function floorKnots(grid, ax, az, bx, bz) {
  if (!grid) return [0, .5, 1];
  const ts = [0, 1];
  for (const [a, b, origin] of [[ax, bx, grid.minX], [az, bz, grid.minZ], [ax + az, bx + bz, grid.minX + grid.minZ]]) {
    if (Math.abs(b - a) < 1e-10) continue;
    const low = Math.ceil((Math.min(a, b) - origin) / grid.res), high = Math.floor((Math.max(a, b) - origin) / grid.res);
    for (let k = low; k <= high; k++) {
      const t = (origin + k * grid.res - a) / (b - a);
      if (t > 1e-8 && t < 1 - 1e-8) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => !i || t - ts[i - 1] > 1e-8);
}


// NPCs use 1.70 m. A taller actor (for example, the 1.78 m standing
// player) must request its own bodyHeight rather than reuse that route.
/* Footing changes when its small support circle enters/leaves a surface,
   not by a ramp interpolated across the edge of a raised deck. */
function supportRanges(col, ax, az, bx, bz, radius = .15) {
  const dx = bx - ax, dz = bz - az;
  const circle = (x, z, r) => {
    const a = dx * dx + dz * dz, b = 2 * (x * dx + z * dz), c = x * x + z * z - r * r;
    if (a < 1e-12) return c <= 0 ? [0, 1] : null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const lo = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)), hi = Math.min(1, (-b + Math.sqrt(disc)) / (2 * a));
    return lo <= hi ? [lo, hi] : null;
  };
  if (col.type === 'cyl') return [circle(ax - col.x, az - col.z, radius + col.r)].filter(Boolean);
  const rx = ax - col.x, rz = az - col.z;
  const x = rx * col.c - rz * col.s, z = rx * col.s + rz * col.c;
  const vx = dx * col.c - dz * col.s, vz = dx * col.s + dz * col.c;
  const rect = (hx, hz) => {
    let lo = 0, hi = 1;
    for (const [p, v, h] of [[x, vx, hx], [z, vz, hz]]) {
      if (Math.abs(v) < 1e-12) { if (Math.abs(p) > h) return null; continue; }
      let a = (-h - p) / v, b = (h - p) / v;
      if (a > b) [a, b] = [b, a];
      lo = Math.max(lo, a); hi = Math.min(hi, b);
      if (lo > hi) return null;
    }
    return [lo, hi];
  };
  // The corner circle calculation uses world velocity; transform its
  // centre back to world coordinates before taking the quadratic.
  const ranges = [rect(col.hx + radius, col.hz), rect(col.hx, col.hz + radius)];
  for (const cx of [-col.hx, col.hx]) for (const cz of [-col.hz, col.hz]) {
    const wx = col.x + cx * col.c + cz * col.s, wz = col.z - cx * col.s + cz * col.c;
    ranges.push(circle(ax - wx, az - wz, radius));
  }
  return ranges.filter(Boolean);
}

export function createNav(world, { minX, maxX, minZ, maxZ }, { cell = 2, radius = 0.4, slope = 0.7, step = 0.45, bodyHeight = 1.7 } = {}) {
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const n = nx * nz;
  const h = new Float32Array(n).fill(NaN);          // ground height, NaN = no footing
  const th = new Float32Array(n);                    // the terrain under each cell
  const p = { x: 0, y: 0, z: 0 };

  const standable = (x, z, g) => {
    p.x = x; p.z = z;
    if (world.pushOut(p, radius, g, bodyHeight, 0.45) && Math.hypot(p.x - x, p.z - z) > 0.12) return false;
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

  const ceilingCandidates = [];
  function headroomClear(ax, az, bx, bz, ya, yb) {
    const bodyRadius = Math.max(.05, radius - .05);
    world.query(Math.min(ax, bx) - bodyRadius, Math.min(az, bz) - bodyRadius,
      Math.max(ax, bx) + bodyRadius, Math.max(az, bz) + bodyRadius, ceilingCandidates);
    const grid = world.terrain?.grid;
    const overheadBottom = Math.min(ya, yb) + step;
    let low = Math.min(ya, yb), high = Math.max(ya, yb), overhead = false;
    // Ordinary walls are already caught by body samples and width rays.
    // Overhead colliders need a continuous circle/box test: a brief graze
    // or a changing floor can put the head into one between samples.
    for (const col of ceilingCandidates) if ((col.flags & MOVE) && col.bottom > overheadBottom) { overhead = true; break; }
    if (!overhead) return true;
    if (grid?.H) {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - grid.minX) / grid.res));
      const i1 = Math.min(grid.nx - 1, Math.ceil((Math.max(ax, bx) - grid.minX) / grid.res));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - grid.minZ) / grid.res));
      const j1 = Math.min(grid.nz - 1, Math.ceil((Math.max(az, bz) - grid.minZ) / grid.res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const y = grid.H[j * grid.nx + i]; low = Math.min(low, y); high = Math.max(high, y);
      }
    } else if (world.terrain) {
      const y = world.terrain.height((ax + bx) * .5, (az + bz) * .5);
      low = Math.min(low, y); high = Math.max(high, y);
    }
    const crossing = ceilingCandidates.filter(col => (col.flags & MOVE) && col.bottom > overheadBottom &&
      col.bottom < high + bodyHeight - 1e-8 && col.top > low + step + 1e-8);
    if (!crossing.length) return true;
    let knots = floorKnots(grid, ax, az, bx, bz);
    const supports = ceilingCandidates.filter(col => (col.flags & MOVE) && col.top <= Math.max(ya, yb) + step + 1e-3 && col.top >= low - step);
    for (const col of supports) for (const range of supportRanges(col, ax, az, bx, bz)) knots.push(...range);
    knots.sort((a, b) => a - b); knots = knots.filter((t, i) => !i || t - knots[i - 1] > 1e-8);
    // A terrain slope can meet either a support top or its step-up
    // eligibility threshold inside one master triangle.
    const crossings = [];
    if (world.terrain) for (let i = 1; i < knots.length; i++) {
      const ta = knots[i - 1], tb = knots[i];
      const ha = world.terrain.height(ax + (bx - ax) * ta, az + (bz - az) * ta);
      const hb = world.terrain.height(ax + (bx - ax) * tb, az + (bz - az) * tb);
      if (Math.abs(hb - ha) < 1e-10) continue;
      for (const col of supports) for (const top of [col.top, col.top - step]) {
        const t = (top - ha) / (hb - ha);
        if (t > 1e-8 && t < 1 - 1e-8) crossings.push(ta + (tb - ta) * t);
      }
    }
    knots.push(...crossings); knots.sort((a, b) => a - b); knots = knots.filter((t, i) => !i || t - knots[i - 1] > 1e-8);
    let py = ya;
    for (let i = 1; i < knots.length; i++) {
      const ta = knots[i - 1], tb = knots[i], epsilon = Math.min(1e-6, (tb - ta) * 1e-4);
      const left = ta + epsilon, right = tb - epsilon;
      const px = ax + (bx - ax) * left, pz = az + (bz - az) * left;
      const x = ax + (bx - ax) * right, z = az + (bz - az) * right;
      const ly = world.groundAt(px, pz, py, step), y = world.groundAt(x, z, ly, step);
      if (Math.abs(ly - py) > step + 1e-3 || Math.abs(y - ly) > step + 1e-3 || world.tooDeep(x, z, .9, y)) return false;
      for (const col of crossing) if (bodyCrosses(col, px, pz, x, z, ly, y, bodyRadius, bodyHeight, step)) return false;
      py = y;
    }
    const end = world.groundAt(bx, bz, py, step);
    return Math.abs(end - py) <= step + 1e-3 && Math.abs(end - yb) < .05;
  }

  /* Is the straight line a → b walkable: on connected cells, with continuous
     footing and room for the whole standing body? Short start connectors
     can begin on clear ground beside an otherwise blocked grid centre. */
  function lineClear(ax, az, bx, bz, physicalOnly = false, feet = null) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / Math.min(0.35, cell * 0.4)));
    let prev = index(ax, az);
    if (!physicalOnly && !walkable(prev)) return false;
    // The centre can be on a wall while the actual point is on the floor
    // beside it. Ask for the support at the real coordinate, preserving
    // the cell's deck height only when there is a surface here to stand on.
    const startY = feet ?? world.groundAt(ax, az, Number.isFinite(h[prev]) ? h[prev] : world.terrain?.height(ax, az) ?? 0, step);
    let ground = startY, previousX = ax, previousZ = az;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const k = index(x, z);
      if (!physicalOnly && k !== prev) {
        if (!link(prev, k)) return false;
        prev = k;
      }
      // A ray between cell-centre heights can sail over a trench that
      // the walking body would fall into. Follow the real footing along
      // the segment and preserve the same step limit used to build it.
      const y = world.groundAt(x, z, ground, step);
      if (Math.abs(y - ground) > step + 1e-3 || world.tooDeep(x, z, .9, y)) return false;
      // Sparse knee/chest rays miss a thin wing at head height, or a bar
      // between those rays. Sweep the complete standing body along its
      // actual footing as well, with the same width as the ray fan.
      p.x = x; p.z = z;
      if (world.pushOut(p, Math.max(.05, radius - .05), y, bodyHeight, step) && Math.hypot(p.x - x, p.z - z) > .02) return false;
      if (!headroomClear(previousX, previousZ, x, z, ground, y)) return false;
      ground = y; previousX = x; previousZ = z;
    }
    if (d < 1e-3) return true;
    const dx = (bx - ax) / d, dz = (bz - az) / d;
    for (const clearance of [0.6, 1.4]) {
      const ya = startY + clearance, yb = ground + clearance;
      const dy = (yb - ya) / d;
      const len = Math.hypot(d, yb - ya);
      for (const off of [0, radius - 0.05, -(radius - 0.05)]) {
        const ox = ax - dz * off, oz = az + dx * off;
        if (world.raycast(ox, ya, oz, dx * d / len, dy * d / len, dz * d / len, len, MOVE, { noTerrain: true, noWater: true })) return false;
      }
    }
    return true;
  }

  function connectedStart(x, z) {
    const nearest = snap(x, z);
    if (nearest < 0) return [];
    const q = centre(nearest);
    if (lineClear(x, z, q.x, q.z, true)) return [{ k: nearest, points: [], cost: Math.hypot(q.x - x, q.z - z) }];
    const i0 = Math.floor((x - minX) / cell), j0 = Math.floor((z - minZ) / cell), candidates = [];
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (!walkable(k) || k === nearest) continue;
      const point = centre(k);
      candidates.push({ k, ...point, d: (point.x - x) ** 2 + (point.z - z) ** 2 });
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const candidate of candidates) if (lineClear(x, z, candidate.x, candidate.z, true)) return [{ k: candidate.k, points: [], cost: Math.sqrt(candidate.d) }];
    return localConnector(x, z);
  }

  /* A narrow bent trench can fit a soldier while fitting no 2 m centre.
     Only when every straight connector failed, search a small finer patch
     for the way out to the ordinary grid. This changes neither the global
     walk radius nor its slope/step thresholds. Every local leg uses the
     same complete body sweep and real footing as the ordinary routes. */
  function localConnector(x, z) {
    const fine = cell / 5, reach = 20, width = reach * 2 + 1;
    const seen = new Uint8Array(width * width), nodes = [], entrances = new Map();
    const key = (i, j) => (j + reach) * width + i + reach;
    const initial = index(x, z);
    let y = world.groundAt(x, z, Number.isFinite(h[initial]) ? h[initial] : world.terrain?.height(x, z) ?? 0, step);
    // The actual body is slightly narrower than the path's safety margin.
    // A valid player beside a wall can be a centimetre inside that margin,
    // making every width ray start in the wall. First take that tiny step
    // outward; never accept a start buried in a wall or push through it.
    const start = { x, z };
    world.pushOut(start, Math.max(.05, radius - .05) + .005, y, bodyHeight, step);
    const adjusted = Math.hypot(start.x - x, start.z - z);
    if (adjusted > .03) return [];
    x = start.x; z = start.z;
    y = world.groundAt(x, z, y, step);
    nodes.push({ i: 0, j: 0, x, z, y, cost: adjusted, from: -1 }); seen[key(0, 0)] = 1;

    function entrancePoints(head, q) {
      const points = [{ x: q.x, z: q.z, y: h[q.k] }];
      for (let at = head; at > 0; at = nodes[at].from) points.push(nodes[at]);
      points.push(nodes[0]); points.reverse();
      const pulled = adjusted > 1e-4 ? [{ x, z }] : [];
      // Keep actual bends, but not every forty-centimetre sample along
      // a straight part. Only the entrance chosen by A* needs pulling.
      for (let at = 0; at < points.length - 1;) {
        let next = points.length - 1;
        for (; next > at + 1; next--) if (lineClear(points[at].x, points[at].z, points[next].x, points[next].z, true, points[at].y)) break;
        pulled.push({ x: points[next].x, z: points[next].z }); at = next;
      }
      return pulled;
    }
    for (let head = 0; head < nodes.length && head < 768; head++) {
      const node = nodes[head], k = index(node.x, node.z);
      if (walkable(k) && !entrances.has(k)) {
        const q = centre(k), support = world.groundAt(q.x, q.z, node.y, step);
        if (Math.abs(support - h[k]) < .05 && lineClear(node.x, node.z, q.x, q.z, true, node.y)) {
          entrances.set(k, { k, local: true, cost: node.cost + Math.hypot(q.x - node.x, q.z - node.z), buildPoints: () => entrancePoints(head, { ...q, k }) });
        }
      }
      for (const [di, dj, weight] of NB) {
        const i = node.i + di, j = node.j + dj;
        if (Math.abs(i) > reach || Math.abs(j) > reach || seen[key(i, j)]) continue;
        const px = x + i * fine, pz = z + j * fine;
        if (index(px, pz) < 0) continue;
        const ground = world.groundAt(px, pz, node.y, step);
        if (Math.abs(ground - node.y) > step + 1e-3 || !lineClear(node.x, node.z, px, pz, true, node.y)) continue;
        seen[key(i, j)] = 1;
        nodes.push({ i, j, x: px, z: pz, y: ground, cost: node.cost + fine * weight, from: head });
      }
    }
    return [...entrances.values()];
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
  const opposite = [1, 0, 3, 2, 7, 6, 5, 4];
  const edges = new Uint8Array(n * 8); // 0 unknown, 1 clear, 2 blocked

  function edgeClear(a, b, direction) {
    const key = a * 8 + direction;
    if (edges[key]) return edges[key] === 1;
    const p = centre(a), q = centre(b);
    // Thin walls and raised beams can sit wholly between two otherwise
    // walkable centres. Cache body-width rays lazily, once per explored
    // undirected edge, rather than allowing height alone to link them.
    const clear = lineClear(p.x, p.z, q.x, q.z);
    edges[key] = edges[b * 8 + opposite[direction]] = clear ? 1 : 2;
    return clear;
  }

  /* A path from (ax, az) to (bx, bz) as world points [{x, z}, ...] ending at
     the goal. When the goal cannot be reached (inside a building, across
     the river away from a crossing) the path ends at the reachable cell
     nearest to it, if that is closer than where we start; null when there
     is no way at all within `maxNodes` expansions. */
  function findPath(ax, az, bx, bz, maxNodes = 12000) {
    return pathFrom(ax, az, bx, bz, maxNodes);
  }

  function pathFrom(ax, az, bx, bz, maxNodes, entrances = null) {
    if (lineClear(ax, az, bx, bz)) return [{ x: bx, z: bz }];
    const starts = entrances || connectedStart(ax, az), t = snap(bx, bz);
    if (!starts.length || t < 0) return null;
    search++;
    heap.length = 0;
    const ti = t % nx, tj = Math.floor(t / nx);
    const hEst = (k) => {
      const di = Math.abs((k % nx) - ti), dj = Math.abs(Math.floor(k / nx) - tj);
      return (Math.max(di, dj) + (DIAG - 1) * Math.min(di, dj)) * cell;
    };
    let found = false, expanded = 0, near = starts[0].k, nearH = hEst(near);
    // A clear centre inside a narrow trench can be a grid island. Seed
    // every physically reached entrance, so A* can choose one connected
    // to the destination instead of stopping at the first isolated cell.
    for (const start of starts) {
      const k = start.k;
      stamp[k] = search; gCost[k] = start.cost; from[k] = -1; fOf[k] = start.cost + hEst(k);
      push(k);
      if (hEst(k) < nearH) { near = k; nearH = hEst(k); }
    }
    while (heap.length) {
      const k = pop();
      if (closed[k] === search) continue;
      closed[k] = search;
      if (k === t) { found = true; break; }
      const hk = hEst(k);
      if (hk < nearH) { nearH = hk; near = k; }
      if (++expanded > maxNodes) break;
      const i = k % nx, j = Math.floor(k / nx);
      for (let direction = 0; direction < NB.length; direction++) {
        const [di, dj, w] = NB[direction];
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const q = jj * nx + ii;
        if (closed[q] === search || !link(k, q)) continue;
        // no cutting corners past a blocked cell
        if (di && dj && (!link(k, j * nx + ii) || !link(k, jj * nx + i))) continue;
        if (!edgeClear(k, q, direction)) continue;
        const g = gCost[k] + w * cell + Math.abs(h[q] - h[k]) * 2;
        if (stamp[q] === search && g >= gCost[q]) continue;
        stamp[q] = search; gCost[q] = g; from[q] = k; fOf[q] = g + hEst(q);
        push(q);
      }
    }
    // A valid centre can belong to a tiny grid island inside a narrow
    // bend. Retry its actual walking exits only after that small component
    // is exhausted; global searches and node-budget failures stay bounded.
    if (!found && !heap.length && expanded <= 64 && expanded < maxNodes && !entrances && starts.length === 1 && !starts[0].local) {
      const exits = localConnector(ax, az).filter(start => closed[start.k] !== search);
      if (exits.length) return pathFrom(ax, az, bx, bz, maxNodes - expanded, [...starts, ...exits]);
    }
    let goal = t;
    if (!found) {
      const q = centre(near);
      if (Math.hypot(q.x - bx, q.z - bz) > Math.hypot(ax - bx, az - bz) - cell) return null;
      goal = near;
      const c = centre(near); bx = c.x; bz = c.z;
    }
    const cells = [];
    for (let k = goal; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    const start = starts.find(s => s.k === cells[0]);
    const startPoints = start.buildPoints ? start.buildPoints() : start.points;
    // pull the string: from each kept point, jump to the furthest cell in sight
    const pts = [{ x: ax, z: az }, ...startPoints];
    // Include the snapped start itself when no later cell is visible.
    // Skipping it assumes that the actual point can reach its first grid
    // neighbour directly, even when the centre was selected from beside
    // an obstacle. `connectedStart` checked this short connector as a body.
    let i = startPoints.length ? 0 : -1;
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
    // Both requested points may snap to the same cell on one side of a
    // crate or wall. The direct line already failed above; returning the
    // requested goal here would route a soldier through that obstacle.
    if (!pts.length) return null;
    // end exactly at the goal when it can be reached from the last point
    const last = pts[pts.length - 1];
    if (last && lineClear(last.x, last.z, bx, bz)) {
      // Replacing the grid centre changes the entire incoming segment.
      // Keep the corner when the exact goal would pull that segment back
      // through the obstacle the route just went around.
      const previous = pts.length > 1 ? pts[pts.length - 2] : { x: ax, z: az };
      if (lineClear(previous.x, previous.z, bx, bz)) pts[pts.length - 1] = { x: bx, z: bz };
      else pts.push({ x: bx, z: bz });
    }
    return pts;
  }

  return {
    cell, nx, nz, bodyHeight, findPath, lineClear,
    walkable: (x, z) => walkable(index(x, z)),
    height: (x, z) => { const k = index(x, z); return walkable(k) ? h[k] : null; },
    /* the nearest walkable point to (x, z), or null */
    nearest(x, z, reach = 4) { const k = snap(x, z, reach); return k < 0 ? null : centre(k); },
    stats() { let w = 0; for (let k = 0; k < n; k++) if (walkable(k)) w++; return { cells: n, walkable: w }; },
  };
}
