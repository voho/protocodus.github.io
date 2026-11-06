/* Authored forest bends: a reversible lateral deformation carries the
   ground and everything standing on it through the same broad curves. */
const BENDS = [[296, 374, -10], [406, 482, 12]];
const active = (z) => BENDS.some(([a, b]) => z > a && z < b);
const offset = (z) => BENDS.reduce((sum, [a, b, amount]) => z <= a || z >= b ? sum : sum + amount * Math.sin(Math.PI * (z - a) / (b - a)) ** 2, 0);
const slope = (z) => BENDS.reduce((sum, [a, b, amount]) => z <= a || z >= b ? sum : sum + amount * Math.PI / (b - a) * Math.sin(2 * Math.PI * (z - a) / (b - a)), 0);
const yaw = (degrees, z) => {
  const shear = slope(z); if (!shear) return degrees;
  const a = degrees * Math.PI / 180;
  return Math.atan2(Math.sin(a) + shear * Math.cos(a), Math.cos(a)) * 180 / Math.PI;
};
export const forestRemap = {
  bends: BENDS, active, offset, slope,
  point: (x, z) => [x + offset(z), z], inverse: (x, z) => [x - offset(z), z], yaw,
  line(points, step = 3) {
    if (!points.some((p, i) => active(p[1]) || (i && BENDS.some(([a, b]) => Math.min(p[1], points[i - 1][1]) < b && Math.max(p[1], points[i - 1][1]) > a)))) return points;
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], da = offset(a[1]), db = offset(b[1]);
      // Keep an effectively straight authored patrol as its original two
      // goals. Blind resampling can put a new goal inside a roadside tree
      // even though the actual endpoint-to-endpoint patrol is unobstructed.
      const samples = [0.25, 0.5, 0.75];
      if (a[1] !== b[1]) for (const [lo, hi] of BENDS) for (const z of [lo, (lo + hi) / 2, hi]) {
        const t = (z - a[1]) / (b[1] - a[1]); if (t > 0 && t < 1) samples.push(t);
      }
      const error = Math.max(...samples.map((t) => Math.abs(offset(a[1] + (b[1] - a[1]) * t) - (da + (db - da) * t))));
      const n = error > 0.02 ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)) : 1;
      for (let j = 0; j < n; j++) {
        const t = j / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (!j || active(z)) out.push([x + offset(z), z]);
      }
    }
    const p = points.at(-1); if (p) out.push([p[0] + offset(p[1]), p[1]]);
    return out;
  },
  rect([x0, z0, x1, z1]) {
    let lo = 0, hi = 0;
    for (let z = z0; z <= z1; z += 0.25) { const d = offset(z); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    return [x0 + lo, z0, x1 + hi, z1];
  },
};

// Only the outer shoulder changes. Every original point within the 24 m
// fighting core keeps exactly the same height/splat/roughness calculation.
export function clearingEdge({ x = 0, z = 508, r = 24 } = {}) {
  const expansion = (angle) => 2 + 3 * (0.5 + 0.5 * Math.sin(2 * angle + 0.5)) + 2 * (0.5 + 0.5 * Math.sin(3 * angle - 0.8)) + (0.5 + 0.5 * Math.cos(5 * angle));
  return {
    x, z, r,
    radius: (angle) => r + expansion(angle),
    contains(px, pz) { return Math.hypot(px - x, pz - z) < r + expansion(Math.atan2(pz - z, px - x)); },
    distance(px, pz) {
      const d = Math.hypot(px - x, pz - z); if (d <= r) return d;
      const u = d - r, extra = expansion(Math.atan2(pz - z, px - x));
      return r + u / (1 + extra / 8 * (1 - Math.exp(-u / 8)));
    },
  };
}

// Water follows the same bowl as the ground. A circular disc at the moved
// centre would clip a few centimetres short on the stretched side.
function shapedCrater(c, map) {
  const [x, z] = map.inverse(c.x, c.z);
  if (!map.bends.some(([a, b]) => z + c.r > a && z - c.r < b)) return c;
  return { ...c, waterShape: {
    point(angle, scale = 1) { return map.point(x + Math.cos(angle) * c.r * scale, z + Math.sin(angle) * c.r * scale); },
    contains(px, pz, scale = 1) { const q = map.inverse(px, pz); return Math.hypot(q[0] - x, q[1] - z) <= c.r * scale; },
    bounds(scale = 1) {
      const r = c.r * scale, z0 = z - r, z1 = z + r, samples = [z0, z1];
      for (const [a, b] of map.bends) for (const p of [a, (a + b) / 2, b]) if (p > z0 && p < z1) samples.push(p);
      const offsets = samples.map((p) => map.offset(p));
      return [x - r + Math.min(...offsets), z0, x + r + Math.max(...offsets), z1];
    },
  } };
}

export function remapForestLevel(level) {
  const t = forestRemap;
  const wrap = (fn) => (x, z, ...rest) => fn(x - offset(z), z, ...rest);
  function placed(p) {
    if (!active(p.z)) return p;
    const q = { ...p, x: p.x + offset(p.z) };
    if (typeof p.yaw === 'number') q.yaw = yaw(p.yaw, p.z);
    if (typeof p.y === 'function') q.y = wrap(p.y);
    return q;
  }
  function soldier(e) {
    // Emplacement crews use a placeholder at[0,0]; their real transform
    // comes from the authored prop anchor, including its new facing.
    const anchorId = e.bunker || e.nest || e.anchorOf?.[0];
    const anchor = anchorId ? level.props.find((p) => p.id === anchorId) : null;
    const z = anchor ? anchor.z : e.at[1];
    // Patrol points are navigation goals, not an unobstructed polyline.
    // Preserve the authored goals and let nav find the physical route
    // between them instead of adding goals inside intervening cover.
    return { ...e, at: t.point(...e.at), yaw: yaw(e.yaw, z), ...(e.patrol ? { patrol: e.patrol.map((p) => t.point(...p)) } : {}) };
  }
  const craters = level.craters.map((c) => shapedCrater(placed(c), t));
  const worldPoint = ([x, y, z, ...rest]) => [x + offset(z), y, z, ...rest];
  return {
    ...level, forestRemap: t,
    baseHeight: wrap(level.baseHeight), splat: wrap(level.splat), trackHeight: wrap(level.trackHeight),
    lines: Object.fromEntries(Object.entries(level.lines).map(([key, line]) => [key, t.line(line)])),
    fine: [...level.fine.map((rect) => t.rect(rect)), ...craters.filter((c) => c.waterShape).map((c) => c.waterShape.bounds())],
    props: level.props.map(placed), scatter: level.scatter.map(placed), cover: level.cover.map(placed), clutter: level.clutter.map(placed),
    craters, pickups: level.pickups.map(placed), hints: level.hints.map(placed),
    enemies: level.enemies.map(soldier),
    checkpoints: level.checkpoints.map((p) => !active(p.z) && !active(p.spawn[1]) ? p : ({ ...placed(p), spawn: [...t.point(p.spawn[0], p.spawn[1]), yaw(p.spawn[2] * 180 / Math.PI, p.spawn[1]) * Math.PI / 180] })),
    objectives: level.objectives.map((o) => ({ ...('x' in o ? placed(o) : o), ...(o.marker ? { marker: t.point(...o.marker) } : {}) })),
    farFires: level.farFires.map(worldPoint),
    ...(level.far ? { far: { ...level.far, buildings: level.far.buildings.map(placed) } } : {}),
    ...(level.mist ? { mist: wrap(level.mist) } : {}),
  };
}
