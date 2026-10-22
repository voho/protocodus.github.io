/* Hedgerow — concertina wire.

   Along each of the level's barbed-wire obstacles (the knife rests strung
   with a few strands) a coil of concertina lies on the ground, the wire
   every assault on a Normandy position ran into: loops of rusted steel
   some 85 cm across, each a little different, the coil sagging and leaning
   as it was dragged out and dropped, wet and catching the light of the
   lamps, the fires and a flare in glints along its loops. One mesh, each
   loop a thin tube that is never thinner on screen than about a pixel (its
   vertex shader widens it with distance): from afar the coil reads as a
   dark tangle over the ground, close by as wire. */

import * as THREE from 'three';
import { rng } from './util.js';
import { dimFillSpecular } from './fill.js';

const RW = 0.0028;        // the wire's radius (m)
const SIDES = 5;          // round the wire
const PITCH = 0.2;        // m along the coil from one loop to the next
const PER = 20;           // samples along a loop

/* wires: the obstacles as levelBuild placed them ({x, y, z, yaw, len} in metres and radians) */
export function createConcertina(wires, { seed = 7 } = {}) {
  if (!wires.length) return null;
  const R = rng(seed);
  const pos = [], ctr = [], nrm = [], idx = [];
  const C = new THREE.Vector3(), Cn = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const X = new THREE.Vector3();
  for (const w of wires) {
    const r0 = 0.4 + R() * 0.05, turns = Math.max(6, Math.round(w.len / PITCH)), steps = turns * PER;
    const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
    X.set(c, 0, -s);
    const lean = (R() - 0.5) * 0.3, sag = 0.05 + R() * 0.05, ph = R() * 6.28;
    // the coil's centre line at t (0..1 along it): loops of their own size, sagging between its
    // ends, leaning a little to one side
    const at = (t, out) => {
      const a = t * turns * Math.PI * 2;
      const k = 0.9 + 0.1 * (1 + Math.sin(a * 0.43 + ph) * 0.6 + Math.sin(a * 0.17 + ph * 2.3) * 0.4);
      const r = r0 * k * (1 - sag * Math.sin(Math.PI * t) * 1.5);
      // its loops clipped to each other alternately, so as it was pulled out they lean one way and
      // the next the other and cross: the diamonds of concertina, not a spring
      const tilt = 0.42 * Math.cos(a * 0.5);
      const lx = (t - 0.5) * w.len + r * Math.sin(a) * Math.sin(tilt);
      const ly = r * 0.92 + r * Math.cos(a) * 0.86 + lean * r * Math.sin(a) * 0.25;
      const lz = r * Math.sin(a) * Math.cos(tilt) + lean * 0.08;
      return out.set(w.x + lx * c + lz * s, w.y + ly, w.z - lx * s + lz * c);
    };
    const base = ctr.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      at(t, C);
      at(Math.min(1, t + 1e-4), Cn);
      T.subVectors(Cn, C).normalize();
      if (i === steps) { at(t - 1e-4, Cn); T.subVectors(C, Cn).normalize(); }
      N.crossVectors(T, X).normalize();
      B.crossVectors(T, N).normalize();
      for (let j = 0; j < SIDES; j++) {
        const q = (j / SIDES) * Math.PI * 2, nx = N.x * Math.cos(q) + B.x * Math.sin(q), ny = N.y * Math.cos(q) + B.y * Math.sin(q), nz = N.z * Math.cos(q) + B.z * Math.sin(q);
        ctr.push(C.x, C.y, C.z);
        nrm.push(nx, ny, nz);
        pos.push(C.x + nx * RW, C.y + ny * RW, C.z + nz * RW);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = base + i * SIDES + j, b = base + i * SIDES + (j + 1) % SIDES, d = a + SIDES, e = b + SIDES;
        idx.push(a, b, d, b, e, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 1;
  // weathered galvanised steel, rust coming through, wet: a grey that takes the light of the sky,
  // glossy with the rain, catching the lamps and a flare in glints
  const mat = new THREE.MeshStandardMaterial({ color: '#8a8378', roughness: 0.36, metalness: 0.45 });
  mat.name = 'concertina';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCenter;')
      // never thinner than about a pixel: a coil 30 m off stays a tangle, not a flicker
      .replace('#include <begin_vertex>', `vec3 transformed = aCenter + objectNormal * max(${RW}, length(aCenter - cameraPosition) * 0.0011);`);
    dimFillSpecular(shader);
  };
  mat.customProgramCacheKey = () => 'hedgerow-concertina';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'concertina';
  mesh.receiveShadow = true;
  return mesh;
}
