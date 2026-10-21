/* Hedgerow — illumination flares over the front.

   Every half minute or so a flare goes up somewhere ahead over the fields
   and the woods (110–250 m away), climbs on a streak of sparks, bursts open
   100–150 m up and sinks under its parachute for about twenty-five seconds,
   drifting with the wind. Magnesium white and flickering, it lights the
   roofs, the fields and the rain from above: a directional light along its
   direction (it is far enough for its rays to be parallel over the 80 m
   round the player) that casts shadows there — houses, walls, soldiers and
   the trees, trunks and crowns, lay long shadows that swing as it drifts and
   lengthen as it sinks. The shadow map is drawn only while a flare burns,
   every other frame (shadowing; main.js makes the trunks cast and holds the
   lamps' shadow still meanwhile): about 0.8 ms a frame at 2048² on an M1 Max. In the light pool (lights.js) it is a far light that
   lights no surface itself: it puts a little glow in the wet air (most of
   it would make a fog bank of the whole sky), lights the smoke and the
   rain; the cloud deck round it lights up (sky.js) and it trails smoke
   (effects.js). Nothing about it touches the fighting: the enemy sees as
   well as before.

   When no flare burns, a lightning stroke (weather.js) takes the same
   light for its fraction of a second: blue-white from the bolt's direction,
   low over the horizon, so houses, walls, soldiers and trees throw long hard
   shadows and its light stands in the rain in shafts (lightning()). */

import * as THREE from 'three';
import { rng } from './util.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the burning point: a white core in a soft glow */
function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

export function createFlares(G, { seed = 41, peak = 78000, shadows = 0 } = {}) {
  const R = rng(seed);
  const light = G.lights.addStatic({ x: 0, y: -1000, z: 0, color: '#eef4ff', intensity: 0, range: 340, flicker: 0.12 });
  light.on = false;
  light.far = true;
  light.noLight = true;
  light.fog = 0.005;
  // the light on the ground: parallel rays from the flare, shadows over the 80 m round the player
  const sun = new THREE.DirectionalLight('#eef4ff', 0);
  sun.name = 'flare_light';
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadows, shadows);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 1; sc.far = 400;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    sun.shadow.autoUpdate = false;
  }
  G.scene.add(sun, sun.target);
  const toFlare = new THREE.Vector3();
  let frame = 0;
  const FLARE_COL = new THREE.Color('#eef4ff'), BOLT_COL = new THREE.Color('#d6e2ff');
  const boltDir = new THREE.Vector3();
  let struck = false, boltFrame = 0;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(1, 1, 1).multiplyScalar(10), blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, fog: true,
  }));
  core.name = 'flare';
  core.scale.setScalar(7);
  core.visible = false;
  G.scene.add(core);
  let f = null;
  let timer = 12 + R() * 10;            // the first one soon after the start
  const dir = new THREE.Vector3();

  function launch(cam) {
    // somewhere ahead over the front (the mission runs north), off to either side
    const a = (R() - 0.5) * 2.4;
    const dist = 110 + R() * 140;
    const x = cam.x + Math.sin(a) * dist, z = cam.z + Math.cos(a) * dist;
    const ground = G.terrain.height(x, z);
    const apex = ground + 100 + R() * 50;
    f = { x, z, y: apex, t: 0, rise: 1.3, burn: 22 + R() * 8, smoke: 0, popped: false, vx: 0, vy: 0, vz: 0 };
    G.effects.flareLaunch(x, ground + 2, z, apex - ground - 2, f.rise);
  }

  function off(sky) {
    light.on = false;
    light.intensity = 0;
    sun.intensity = 0;
    core.visible = false;
    sky.uniforms.uFlare.value = 0;
  }

  /* the wind it drifts on, the sky to light */
  function update(dt, cam, wind, sky) {
    if (!f) {
      timer -= dt;
      if (timer <= 0) { launch(cam); timer = 26 + R() * 30; }
      return;
    }
    f.t += dt;
    if (f.t < f.rise) return;
    if (!f.popped) {
      f.popped = true;
      struck = false;
      sun.color.copy(FLARE_COL);
      f.vx = wind.x * 0.9; f.vz = wind.z * 0.9; f.vy = -2.4;
      light.on = true;
      core.visible = true;
      G.audio?.distant?.('flare');
    }
    const tb = f.t - f.rise;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    // it catches over half a second, burns, gutters out over the last three
    const k = Math.min(1, tb / 0.5) * (1 - smoothstep(f.burn - 3, f.burn, tb));
    light.x = f.x; light.y = f.y; light.z = f.z;
    light.intensity = peak * k;
    core.position.set(f.x, f.y, f.z);
    core.material.opacity = k * (0.85 + 0.15 * Math.sin(f.t * 31) * Math.sin(f.t * 17.3));
    f.smoke -= dt;
    if (f.smoke <= 0) { f.smoke = 0.2; G.effects.smokePuff(f.x, f.y + 0.8, f.z, 1.8, '#8c8e8a', 7); }
    dir.set(f.x - cam.x, f.y - cam.y, f.z - cam.z);
    const d2 = dir.lengthSq();
    dir.normalize();
    sky.uniforms.uFlareDir.value.copy(dir);
    sky.uniforms.uFlare.value = k;
    // on the ground round the player: as bright as the flare is there, from where it is
    const flick = 1 - 0.12 * (0.5 + 0.5 * Math.sin(f.t * 9) * Math.sin(f.t * 20.8 + 1.3));
    sun.intensity = peak * k * flick / d2;
    const gy = G.terrain.height(cam.x, cam.z);
    sun.target.position.set(cam.x, gy, cam.z);
    toFlare.copy(dir).multiplyScalar(220);
    sun.position.set(cam.x, gy, cam.z).add(toFlare);
    sun.target.updateMatrixWorld();
    // the shadow map every other frame (the flare's light turns well under a degree a second)
    if (sun.castShadow && (++frame & 1)) sun.shadow.needsUpdate = true;
    if (tb >= f.burn) { f = null; off(sky); }
  }

  let vegCasters = null;
  /* what in the vegetation casts while a flare burns: trunks, branches, rocks, and the
     crowns' leaf cards cut out by their own alpha (not the ground cover, not the far cards) */
  function castersOf(group) {
    if (vegCasters) return vegCasters;
    vegCasters = [];
    for (const m of group.children) {
      if (!m.isInstancedMesh) continue;
      const card = !!m.material.alphaToCoverage;
      if (card && !/:nat_(leaf|conifer)$/.test(m.name)) continue;
      if (card) m.customDepthMaterial = new THREE.MeshDepthMaterial({ map: m.material.map, alphaTest: 0.5 });
      vegCasters.push(m);
    }
    return vegCasters;
  }

  /* this frame's lightning (weather.js: its flash, the direction of the strike): when no
     flare burns, the stroke lights the scene through the same light, with its shadows */
  function lightning(flash, dir, cam) {
    if (f && f.popped) return;                 // a burning flare holds the light
    if (flash <= 0.02) {
      if (struck) { struck = false; sun.intensity = 0; }
      return;
    }
    // a new strike (another direction): its shadows drawn again from the start
    if (!struck || boltDir.distanceToSquared(dir) > 1e-6) { boltDir.copy(dir); boltFrame = 0; }
    struck = true;
    sun.color.copy(BOLT_COL);
    sun.intensity = 11 * flash;
    const gy = G.terrain.height(cam.x, cam.z);
    sun.target.position.set(cam.x, gy, cam.z);
    sun.position.copy(boltDir).multiplyScalar(220).add(sun.target.position);
    sun.target.updateMatrixWorld();
    if (sun.castShadow && (boltFrame++ & 1) === 0) sun.shadow.needsUpdate = true;
  }

  return {
    update, lightning, light: sun, castersOf,
    get active() { return !!f; },
    /* its shadows are being drawn this frame */
    get shadowing() { return sun.castShadow && sun.intensity > 0; },
    /* draw its shadow map once with everything that could ever cast in it, so the shaders
       it needs are compiled before the first flare bursts (not in the middle of it) */
    warm(renderer, scene, camera, casters) {
      if (!sun.castShadow) return;
      const was = casters.map((m) => m.castShadow);
      for (const m of casters) m.castShadow = true;
      sun.shadow.needsUpdate = true;
      renderer.render(scene, camera);
      casters.forEach((m, i) => { m.castShadow = was[i]; });
    },
    /* one now (checks): the one burning, if any, goes out first */
    launchNow(cam, sky = G.sky) { f = null; off(sky); launch(cam); },
  };
}
