/* Hedgerow — rainwater standing in the shell craters.

   Every crater of the level (L.craters: where, how wide, how deep) whose
   bowl holds water gets a pond: a disc at two fifths of its depth, a
   little wider than the water, so the bowl's own sides and rim cut its
   edge where they rise out of it. One mesh, drawn with the river's water
   (materials.js) but still: murky, mirroring the sky and the fires, rain
   rings on it, browner where it is shallow and a broken line of scum
   where it laps the mud (it knows its depth from the ground map). The
   ground map keeps the grass, the stones and the twigs out of it. */

import * as THREE from 'three';
import { createWaterMaterial } from './materials.js';

const SEG = 20;

export function createPonds(craters, terrain, textures, shared) {
  const list = [], pos = [], idx = [];
  for (const c of craters || []) {
    const bottom = terrain.height(c.x, c.z);
    const y = bottom + c.h * 0.42;
    // only a bowl that holds it: its rim all round higher than the water
    let rim = Infinity;
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2;
      rim = Math.min(rim, terrain.height(c.x + Math.cos(t) * c.r, c.z + Math.sin(t) * c.r));
    }
    if (rim < y + 0.06) continue;
    const R = c.r * 0.9, base = pos.length / 3;
    pos.push(c.x, y, c.z);
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      pos.push(c.x + Math.cos(t) * R, y, c.z + Math.sin(t) * R);
    }
    for (let i = 0; i < SEG; i++) idx.push(base, base + 1 + ((i + 1) % SEG), base + 1 + i);
    list.push({ x: c.x, z: c.z, r: R, y });
  }
  if (!list.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, createWaterMaterial(textures, shared, { flow: [0, 0] }));
  mesh.name = 'ponds';
  return { mesh, list };
}
