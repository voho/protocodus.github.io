/* Meteora — seeded randomness and noise.

   Everything stochastic in the simulation draws from here, so a seed fully
   determines a run: the belt, the enemy pilots' choices and the spawn
   points. That is what lets the checks pin behaviour exactly, and what
   makes "Launch again" start the same fight as the first launch. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  let spare = null;
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    unit(o) {
      const z = 2 * next() - 1, phi = 2 * Math.PI * next(), r = Math.sqrt(1 - z * z);
      o[0] = r * Math.cos(phi); o[1] = r * Math.sin(phi); o[2] = z;
      return o;
    },
    gauss() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = next();
      const v = next(), m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    },
  };
}

export function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)
    ^ Math.imul(iz | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const lattice = (ix, iy, iz, seed) => hash3(ix, iy, iz, seed) / 2147483647.5 - 1;
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

/* Value noise: hashed lattice values in [−1, 1], blended with the quintic
   fade so the field and its gradient are continuous. */
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const c000 = lattice(ix, iy, iz, seed), c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed), c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed), c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed), c111 = lattice(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export function fbm3(x, y, z, seed, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
