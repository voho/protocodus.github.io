/* Hedgerow — light.

   Dusk under rain clouds: a cool hemisphere, a dim low key light from the
   west where the last of the sun is, and fog. Local light comes from a
   fixed pool of point lights (so shaders never recompile) that each frame
   take the strongest "virtual" sources near the camera: lanterns, lit
   windows, fires (flickering), and short flashes from muzzles and
   explosions, which always win a slot. */

import * as THREE from 'three';

export function createLighting(scene, { pool = 8 } = {}) {
  const hemi = new THREE.HemisphereLight('#6c7888', '#2a241c', 3.2);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#9a8f86', 1.2);
  key.position.set(60, 25, 30);
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight('#566577', 0.3);
  rim.position.set(30, 40, -40);
  scene.add(rim);

  const lights = [];
  for (let i = 0; i < pool; i++) {
    const l = new THREE.PointLight('#ffffff', 0, 10, 2);
    l.position.set(0, -1000, 0);
    scene.add(l);
    lights.push(l);
  }

  const statics = [];       // {x,y,z,color,intensity,range,flicker,phase}
  const flashes = [];       // {x,y,z,color,intensity,range,life,age}

  function addStatic(o) {
    const s = {
      x: o.x, y: o.y, z: o.z, color: new THREE.Color(o.color || '#ffb060'),
      intensity: o.intensity ?? 6, range: o.range ?? 12, flicker: o.flicker ?? 0,
      phase: Math.random() * 100, on: true,
    };
    statics.push(s);
    return s;
  }

  function flash(x, y, z, color = '#ffb060', intensity = 30, range = 14, life = 0.06) {
    if (flashes.length > 12) flashes.shift();
    flashes.push({ x, y, z, color: new THREE.Color(color), intensity, range, life, age: 0 });
  }

  const cand = [];
  const active = [];
  function update(dt, time, cam, lightning = 0) {
    hemi.intensity = 3.2 + lightning * 3.0;
    key.intensity = 1.2 + lightning * 2.5;
    key.position.set(cam.x + 60, 25 + lightning * 40, cam.z + 30);
    key.target.position.set(cam.x, 0, cam.z);

    cand.length = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += dt;
      if (f.age >= f.life) { flashes.splice(i, 1); continue; }
      const k = 1 - f.age / f.life;
      cand.push({ x: f.x, y: f.y, z: f.z, color: f.color, intensity: f.intensity * k, range: f.range, score: 1e9 });
    }
    for (const s of statics) {
      if (!s.on) continue;
      const d2 = (s.x - cam.x) ** 2 + (s.y - cam.y) ** 2 + (s.z - cam.z) ** 2;
      if (d2 > 90 * 90) continue;
      let inten = s.intensity;
      if (s.flicker) {
        const t = time * 9 + s.phase;
        inten *= 1 - s.flicker * (0.5 + 0.5 * Math.sin(t) * Math.sin(t * 2.31 + 1.3) * Math.sin(t * 0.73));
      }
      cand.push({ x: s.x, y: s.y, z: s.z, color: s.color, intensity: inten, range: s.range, score: s.intensity * s.range / (1 + d2) });
    }
    cand.sort((a, b) => b.score - a.score);
    active.length = 0;
    for (let i = 0; i < Math.min(8, cand.length); i++) active.push(cand[i]);
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const c = cand[i];
      if (!c) { l.intensity = 0; l.position.set(0, -1000, 0); continue; }
      l.position.set(c.x, c.y, c.z);
      l.color.copy(c.color);
      l.intensity = c.intensity;
      l.distance = c.range;
    }
  }

  return { hemi, key, rim, addStatic, flash, update, statics, active };
}
