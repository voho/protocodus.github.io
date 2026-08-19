/* Warp: what a nav jump looks like. A shell of radial streaks parented to the
   camera stretches past it while the stars dim and the field of view opens —
   three cheats that together read as sudden enormous speed. The page owns the
   scroll tween; this module only owns the light show, driven by strength(). */

import * as THREE from 'three';
import { glowTexture } from './textures.js';

export function buildWarp(camera, quality) {
  const group = new THREE.Group();
  camera.add(group);

  const n = quality.streaks;
  const pos = new Float32Array(n * 2 * 3);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    // A ring of directions ahead of the camera, kept off-axis so the middle
    // of the frame — where the destination is — stays clear.
    const a = Math.random() * Math.PI * 2;
    const r = 0.25 + Math.random() * 1.1;
    seeds.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: -(1 + Math.random() * 3),
      len: 0.4 + Math.random() * 1.2,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xbfffec, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  group.add(lines);

  // A soft bloom dead ahead, for the tunnel's mouth
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(128), color: 0xdffff4, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  core.position.set(0, 0, -30);
  core.scale.setScalar(30);
  group.add(core);

  let strength = 0;

  return {
    get strength() { return strength; },
    set(s) {
      strength = THREE.MathUtils.clamp(s, 0, 1);
      lines.visible = strength > 0.01;
      mat.opacity = strength * 0.85;
      core.material.opacity = strength * 0.5;
      if (!lines.visible) return;
      const scale = 22;
      for (let i = 0; i < n; i++) {
        const s6 = i * 6;
        const sd = seeds[i];
        // Anchored near the camera, stretched away from it by strength
        pos[s6] = sd.x * scale;
        pos[s6 + 1] = sd.y * scale;
        pos[s6 + 2] = sd.z * scale;
        pos[s6 + 3] = sd.x * scale * (1 + strength * 0.4);
        pos[s6 + 4] = sd.y * scale * (1 + strength * 0.4);
        pos[s6 + 5] = sd.z * scale - sd.len * scale * strength * 6;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
