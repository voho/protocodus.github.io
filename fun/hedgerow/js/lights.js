/* Hedgerow — light.

   Dusk under rain clouds: a cool hemisphere, a dim low key light from the
   west where the last of the sun is, and fog. Local light comes from a
   fixed pool of point lights (so shaders never recompile) that each frame
   take the strongest "virtual" sources near the camera: lanterns, lit
   windows, fires (flickering), and short flashes from muzzles and
   explosions, which always win a slot.

   One more light casts shadows: each frame it takes the strongest outdoor
   lamp, lantern or fire near the camera (statics marked `shadow`), so the
   houses, props and soldiers near it throw shadows that swing with a
   fire's flicker: a fire's light wanders a little with its flames (wander()),
   higher as it flares up, so the shadows round it dance. It always exists and always casts (a change in the
   number of lights or shadows would recompile every shader); with nothing
   to light it waits far below the level, where there is nothing to draw
   into its shadow map. */

import * as THREE from 'three';

export function createLighting(scene, { pool = 8, shadows = true, shadowSize = 512 } = {}) {
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

  const shadowLight = new THREE.PointLight('#ffffff', 0, 12, 2);
  shadowLight.castShadow = shadows;
  shadowLight.shadow.mapSize.set(shadowSize, shadowSize);
  shadowLight.shadow.camera.near = 0.15;
  shadowLight.shadow.bias = -0.002;
  shadowLight.shadow.normalBias = 0.05;
  shadowLight.shadow.radius = 3;
  shadowLight.position.set(0, -1000, 0);
  scene.add(shadowLight);
  let shadowOf = null;      // the static it is standing in for
  const wp = new THREE.Vector3();

  const statics = [];       // {x,y,z,color,intensity,range,flicker,phase,shadow, far, fog}
  const flashes = [];       // {x,y,z,color,intensity,range,life,age}

  function addStatic(o) {
    const s = {
      x: o.x, y: o.y, z: o.z, color: new THREE.Color(o.color || '#ffb060'),
      intensity: o.intensity ?? 6, range: o.range ?? 12, flicker: o.flicker ?? 0,
      phase: Math.random() * 100, on: true, shadow: !!o.shadow,
    };
    statics.push(s);
    return s;
  }

  /* fog: how much of it the air scatters (volumetric.js), against how much it lights surfaces;
     a flash is brief and often right by the eye (a muzzle), where full scattering would fill
     every view ray with glow, so by default the wet air takes only a quarter of it */
  function flash(x, y, z, color = '#ffb060', intensity = 30, range = 14, life = 0.06, fog = 0.25) {
    if (flashes.length > 12) flashes.shift();
    flashes.push({ x, y, z, color: new THREE.Color(color), intensity, range, life, age: 0, fog });
  }

  const cand = [];
  const active = [];
  function update(dt, time, cam, lightning = 0) {
    // lightning lifts the sky's light a little; its hard light comes from the bolt (flares.js)
    hemi.intensity = 3.2 + lightning * 0.8;
    key.intensity = 1.2 + lightning * 0.6;
    key.position.set(cam.x + 60, 25 + lightning * 40, cam.z + 30);
    key.target.position.set(cam.x, 0, cam.z);

    const flick = (s) => {
      if (!s.flicker) return s.intensity;
      const t = time * 9 + s.phase;
      return s.intensity * (1 - s.flicker * (0.5 + 0.5 * Math.sin(t) * Math.sin(t * 2.31 + 1.3) * Math.sin(t * 0.73)));
    };
    // where a fire's light is now: its flames sway and leap, and the light with them (a lamp's
    // flame, a lantern's, hardly moves); in step with its flicker, higher when it flares up.
    // Not while the shadow map holds still (a flare's shadows are being drawn)
    const sway = shadowLight.shadow.autoUpdate !== false;
    const wander = (s, out) => {
      out.x = s.x; out.y = s.y; out.z = s.z;
      if (!sway || !s.flicker || s.flicker < 0.3) return out;
      const t = time * 9 + s.phase, k = s.flicker / 0.45;
      const up = 0.5 + 0.5 * Math.sin(t) * Math.sin(t * 2.31 + 1.3) * Math.sin(t * 0.73);
      out.x += 0.2 * k * (Math.sin(t * 0.83 + 1.1) * 0.6 + Math.sin(t * 1.97 + 0.4) * 0.4);
      out.z += 0.2 * k * (Math.sin(t * 0.71 + 2.3) * 0.6 + Math.sin(t * 2.13 + 1.7) * 0.4);
      out.y += 0.3 * k * (0.5 - up);
      return out;
    };
    // the shadow caster: the strongest marked light within 45 m
    shadowOf = null;
    let best = 0;
    for (const s of statics) {
      if (!s.on || !s.shadow) continue;
      const d2 = (s.x - cam.x) ** 2 + (s.y - cam.y) ** 2 + (s.z - cam.z) ** 2;
      if (d2 > 45 * 45) continue;
      const sc = s.intensity * s.range / (1 + d2);
      if (sc > best) { best = sc; shadowOf = s; }
    }
    if (shadowOf) {
      shadowLight.position.copy(wander(shadowOf, wp));
      shadowLight.color.copy(shadowOf.color);
      shadowLight.intensity = flick(shadowOf);
      shadowLight.distance = shadowOf.range;
      if (shadowLight.shadow.camera.far !== shadowOf.range) { shadowLight.shadow.camera.far = shadowOf.range; shadowLight.shadow.camera.updateProjectionMatrix(); }
    } else {
      shadowLight.intensity = 0;
      shadowLight.position.set(cam.x, -1000, cam.z);
    }

    cand.length = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += dt;
      if (f.age >= f.life) { flashes.splice(i, 1); continue; }
      // a flash dies fast, then lingers a little
      const k = (1 - f.age / f.life) ** 2;
      // one at the eye (the player's own muzzle) would lay its glow in the rain over the whole view
      // for as long as it is held (frames; a real flash is over in a millisecond): near the eye
      // little of that glow is kept
      const dc = Math.hypot(f.x - cam.x, f.y - cam.y, f.z - cam.z);
      const near = Math.min(1, Math.max(0, (dc - 1.5) / 2.5));
      cand.push({ x: f.x, y: f.y, z: f.z, color: f.color, intensity: f.intensity * k, range: f.range, score: 1e9, fog: f.fog * (0.15 + 0.85 * near * near * (3 - 2 * near)) });
    }
    for (const s of statics) {
      if (!s.on || s === shadowOf) continue;
      const d2 = (s.x - cam.x) ** 2 + (s.y - cam.y) ** 2 + (s.z - cam.z) ** 2;
      // a far light (a flare over the fields) is in the running from any distance
      if (!s.far && d2 > 90 * 90) continue;
      wander(s, wp);
      cand.push({ x: wp.x, y: wp.y, z: wp.z, color: s.color, intensity: flick(s), range: s.range, score: s.intensity * s.range / (1 + d2), fog: s.fog ?? 1, noLight: !!s.noLight });
    }
    cand.sort((a, b) => b.score - a.score);
    active.length = 0;
    // the shadow light is lit too (rain, light in the air): first in the list
    if (shadowOf) active.push({ x: shadowLight.position.x, y: shadowLight.position.y, z: shadowLight.position.z, color: shadowOf.color, intensity: shadowLight.intensity, range: shadowOf.range, score: best });
    for (let i = 0; active.length < 8 && i < cand.length; i++) active.push(cand[i]);
    // the point lights: the candidates that light surfaces (a far light lit by its own means is only haze and glow)
    let ci = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      while (ci < cand.length && cand[ci].noLight) ci++;
      const c = cand[ci++];
      if (!c) { l.intensity = 0; l.position.set(0, -1000, 0); continue; }
      l.position.set(c.x, c.y, c.z);
      l.color.copy(c.color);
      l.intensity = c.intensity;
      l.distance = c.range;
    }
  }

  return { hemi, key, rim, addStatic, flash, update, statics, active, shadowLight, get shadowOf() { return shadowOf; } };
}
