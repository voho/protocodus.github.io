/* The terrain's re-anchors, built off the main thread.

   `createTerrain` posts one job per re-anchor: the seed, the new anchor,
   whether it morphs, and the anchor of the surface it is showing. This runs
   the same `createLattice` from terrain.js over the same seeded modules, so
   what it posts back is what the main thread's own stages would have
   computed, bit for bit, and the main thread only swaps it in.

   The lattice here is a replica of the main thread's. A build reuses the
   heights and surface of the one before it, and its geomorph walks from the
   surface on screen, so the replica keeps the lattice it last built as its
   own live surface and posts copies. Where the main thread laid a surface
   down by itself — the first frame, a restart, a build it had to finish
   itself — the replica lays the same one down first. */

import { createLattice } from './terrain.js';
import { getWorldSeed, setWorldSeed } from './noise.js';

let lattice = null;
// The seed and anchor of the replica's live surface.
let live = null;

// Arrays the main thread has finished with, by size, for the next results.
const spare = new Map();

function take(Type, length) {
  const bytes = length * Type.BYTES_PER_ELEMENT;
  return new Type(spare.get(bytes)?.pop() ?? new ArrayBuffer(bytes));
}

self.onmessage = (event) => {
  const job = event.data;
  if (job.layout) {
    lattice = createLattice(job.layout, job.palette);
    return;
  }
  for (const buffer of job.spare) {
    if (!spare.has(buffer.byteLength)) spare.set(buffer.byteLength, []);
    spare.get(buffer.byteLength).push(buffer);
  }
  setWorldSeed(job.seed);
  const seed = getWorldSeed();
  const { from } = job;
  if (job.morph && !(live?.seed === seed && live.ax === from.ax && live.az === from.az)) {
    lattice.fill(from.ax, from.az, from.ay);
    live = { seed, ax: from.ax, az: from.az };
  }

  const started = performance.now();
  lattice.prepareHeightReuse(job.ax, job.az, live?.ax ?? NaN, live?.az ?? NaN, live?.seed);
  if (job.morph && !lattice.morphSource) {
    throw new Error('terrain worker: the surface to morph from is not this lattice\'s');
  }
  const transfer = [];
  const copy = (array) => {
    const out = take(array.constructor, array.length);
    out.set(array);
    transfer.push(out.buffer);
    return out;
  };
  const morph = () => [lattice.morphDY, lattice.morphDN, lattice.morphDC, lattice.morphDS]
    .map(copy);
  const rows = lattice.vertsZ;
  const stage = (n) => lattice.buildRows(n, job.ax, job.az, job.ay, 0, rows);
  stage(0);
  stage(1);
  let lead = null;
  let follow = null;
  if (job.morph) {
    stage(2);
    lead = morph();
    stage(5);
    stage(6);
    follow = morph();
  }
  lattice.commitSurface();
  live = { seed, ax: job.ax, az: job.az };

  self.postMessage({
    id: job.id,
    seed,
    heights: copy(lattice.heights),
    runnelCuts: copy(lattice.runnelCuts),
    surface: [lattice.positions, lattice.normals, lattice.colors, lattice.surface,
      lattice.groomFrame].map(copy),
    lead,
    follow,
    reusedHeights: lattice.reusedHeights,
    reusedSurfaces: lattice.reusedSurfaces,
    buildMs: performance.now() - started,
  }, transfer);
};
