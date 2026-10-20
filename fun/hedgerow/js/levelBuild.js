/* Hedgerow — turns a level description into the world.

   1. Building pads: the ground under houses, the church, the bunker and the
      flak gun is levelled to the height at their centre.
   2. Terrain mesh and heightfield, the collision world with the river.
   3. Props: static ones are merged per material per chunk; vegetation goes
      to the instancer; some stay separate objects (the flak gun, which
      blows up). Their colliders and anchors are placed in the world.
   4. Lights from anchors (street lamps, lit windows), fires.
   5. Enemy definitions resolved against nests, the bunker and anchors.
   6. The river surface, cover points for the AI. */

import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { createWorld } from './world.js';
import { createStaticBatcher, instantiate, worldColliders, worldAnchor } from './assets.js';
import { createVegetation } from './vegetation.js';
import { createWaterMaterial } from './materials.js';
import { buildCoverPoints } from './ai.js';
import { buildDistance } from './distance.js';
import { rectDistance, smoothstep, lerp, DEG, polylineDistance } from './util.js';

const SURFACE = (name) => {
  if (/^(house|church|wall|fountain|cross|bridge|ruin)/.test(name)) return 'stone';
  if (/^(barn|shed|fence|gate|crate|cart|sentry|trench_wall|duckboard|watchtower|log|stump|signpost|pole|tree|pine|oak)/.test(name)) return 'wood';
  if (/^(sandbag|mg_nest|tent)/.test(name)) return 'sandbag';
  if (/^(truck|jeep|barrel|flak|hedgehog|barbed|radio|jerrycan|ammo|lamp)/.test(name)) return 'metal';
  if (/^bunker/.test(name)) return 'concrete';
  if (/^(hedge|bush|haystack|reeds|fern|grass)/.test(name)) return 'foliage';
  if (/^(boulder|outcrop|rocks)/.test(name)) return 'stone';
  return 'stone';
};

const SEPARATE = new Set(['flak38', 'radio_table']);

export function buildLevel(G, L, quality) {
  const models = G.models;
  const missing = new Set();
  const model = (name) => {
    const m = models.get(name);
    if (!m && !missing.has(name)) { missing.add(name); console.warn('[hedgerow] missing model', name); }
    return m;
  };

  /* ---------- 1. pads ---------- */
  const pads = [];
  for (const p of L.props) {
    if (!p.pad) continue;
    const m = model(p.m);
    if (!m) continue;
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    m.box.getSize(size);
    m.box.getCenter(centre);
    const yaw = p.yaw * DEG;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const cx = p.x + centre.x * c + centre.z * s, cz = p.z - centre.x * s + centre.z * c;
    const h = typeof p.y === 'number' ? p.y : L.baseHeight(cx, cz);
    pads.push({ cx, cz, hx: size.x / 2 + 0.6, hz: size.z / 2 + 0.6, yaw, h, margin: 3.5 });
    p._padH = h;
  }
  const height = (x, z) => {
    let h = L.baseHeight(x, z);
    for (const pd of pads) {
      const dx = x - pd.cx, dz = z - pd.cz;
      const reach = Math.max(pd.hx, pd.hz) + pd.margin;
      if (dx * dx + dz * dz > reach * reach * 2) continue;
      const d = rectDistance(x, z, pd.cx, pd.cz, pd.hx, pd.hz, pd.yaw);
      if (d < pd.margin) h = lerp(h, pd.h, smoothstep(pd.margin, 0, d));
    }
    return h;
  };

  /* ---------- 2. terrain and world ---------- */
  const terrain = createTerrain({ bounds: L.bounds, height, splat: L.splat, fine: L.fine }, G.textures, G.shared);
  G.scene.add(terrain.group);
  const far = buildDistance(G, L, { models, matlib: G.matlib, material: terrain.material });
  G.scene.add(far.group);
  const world = createWorld({ ...L.bounds, cell: 8, terrain, water: L.water });
  G.terrain = terrain;
  G.world = world;

  /* ---------- 3. props ---------- */
  const batch = createStaticBatcher(G.matlib, 48);
  const veg = createVegetation(models, G.matlib, { near: quality.treeNear, far: 330 });
  const placed = new Map();       // id -> {model, x, y, z, yaw, object}
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const lamps = [];
  const fires = [];
  const contact = [];

  for (const p of L.props) {
    const m = model(p.m);
    if (!m) continue;
    const yaw = (p.yaw || 0) * DEG;
    const scale = p.scale || 1;
    let y;
    if (typeof p.y === 'number') y = p.y;
    else if (typeof p.y === 'function') y = p.y(p.x, p.z);
    else if (p.y === 'floor') y = L.baseHeight(p.x, p.z);
    else if (p._padH !== undefined) y = p._padH - 0.04;
    else y = minGround(terrain, m, p.x, p.z, yaw, scale) - 0.04;
    const surface = SURFACE(p.m);
    for (const c of worldColliders(m, p.x, y, p.z, yaw, scale, surface)) world.add(c);
    const rec = { model: m, x: p.x, y, z: p.z, yaw, scale, object: null };
    if (p.id) placed.set(p.id, rec);
    if (p.veg) {
      veg.add(p.m, p.x, y, p.z, yaw, scale);
    } else if (SEPARATE.has(p.m)) {
      const o = instantiate(m, G.matlib);
      o.position.set(p.x, y, p.z);
      o.rotation.y = yaw;
      o.scale.setScalar(scale);
      G.scene.add(o);
      rec.object = o;
    } else {
      q.setFromAxisAngle(up, yaw);
      tmpM.compose(pos.set(p.x, y, p.z), q, sc.setScalar(scale));
      batch.add(m, tmpM);
    }
    if (!p.veg && !/^(lamp_post|pole|signpost|bridge|log_bridge|trench_wall|duckboard|barbed|wall_lamp|ivy)/.test(p.m)) contact.push({ m, x: p.x, y, z: p.z, yaw, scale });
    // lights
    if (p.light) {
      const a = worldAnchor(m, 'light', p.x, y, p.z, yaw, scale);
      if (a) {
        lamps.push(G.lights.addStatic({ x: a[0], y: a[1], z: a[2], color: '#ffb35c', intensity: 9, range: 14, flicker: 0.08 }));
        G.halos?.add(a[0], a[1], a[2], '#ffb066', 2.6, 1.0, 0.06);
      }
    }
    for (const k of Object.keys(m.anchors)) {
      if (k === 'lantern') {
        const a = worldAnchor(m, k, p.x, y, p.z, yaw, scale);
        lamps.push(G.lights.addStatic({ x: a[0], y: a[1], z: a[2], color: '#ffb35c', intensity: 6, range: 11, flicker: 0.08 }));
        G.halos?.add(a[0], a[1], a[2], '#ffb066', 2.2, 0.9, 0.06);
        continue;
      }
      if (!k.startsWith('lamp')) continue;
      const a = worldAnchor(m, k, p.x, y, p.z, yaw, scale);
      lamps.push(G.lights.addStatic({ x: a[0], y: a[1], z: a[2], color: '#ff9a48', intensity: 3.5, range: 7, flicker: 0.12 }));
      G.halos?.add(a[0], a[1], a[2], '#ff9a48', 2.2, 0.45, 0.1);
    }
    if (p.fire) {
      const a = worldAnchor(m, 'fire', p.x, y, p.z, yaw, scale) || worldAnchor(m, 'smoke', p.x, y, p.z, yaw, scale) || [p.x, y + 1, p.z];
      fires.push(G.effects.addFire(a[0], a[1], a[2], 1.1));
      G.lights.addStatic({ x: a[0], y: a[1] + 1.2, z: a[2], color: '#ff8a3a', intensity: 22, range: 18, flicker: 0.45 });
      G.halos?.add(a[0], a[1] + 1.0, a[2], '#ff7a30', 6, 0.7, 0.4);
    }
  }

  // scattered vegetation and rocks (mature trees fall back to a scaled-up one)
  for (const s0 of L.scatter) {
    const s = models.has(s0.m) || !s0.alt ? s0 : { ...s0, m: s0.alt, scale: s0.scale * (s0.altScale || 1) };
    const m = model(s.m);
    if (!m) continue;
    const y = terrain.height(s.x, s.z) - (s.rock ? 0.05 : 0.15);
    const yaw = s.yaw * DEG;
    // keep clear of things already placed
    const r = 1.2;
    const near = world.query(s.x - r, s.z - r, s.x + r, s.z + r);
    if (near.length) continue;
    veg.add(s.m, s.x, y, s.z, yaw, s.scale, { cover: !!s.cover });
    if (!s.cover) for (const c of worldColliders(m, s.x, y, s.z, yaw, s.scale, SURFACE(s.m))) world.add(c);
  }
  for (const c of L.cover) {
    const y = terrain.height(c.x, c.z) - 0.04;
    veg.add(c.m, c.x, y, c.z, c.yaw * DEG, c.scale, { cover: true });
  }
  veg.finalize();
  G.scene.add(veg.group);
  const staticGroup = batch.build();
  G.scene.add(staticGroup);
  G.scene.add(contactShadows(contact, terrain));

  // invisible walls along the play bounds
  const B = L.playBounds;
  const wall = (x, z, hx, hz) => world.add({ type: 'box', x, y: 0, z, hx, hy: 60, hz, kind: 'wire' });
  wall(B.minX - 1, (B.minZ + B.maxZ) / 2, 1, (B.maxZ - B.minZ) / 2 + 2);
  wall(B.maxX + 1, (B.minZ + B.maxZ) / 2, 1, (B.maxZ - B.minZ) / 2 + 2);
  wall((B.minX + B.maxX) / 2, B.minZ - 1, (B.maxX - B.minX) / 2 + 2, 1);
  wall((B.minX + B.maxX) / 2, B.maxZ + 1, (B.maxX - B.minX) / 2 + 2, 1);

  /* ---------- 5. enemies ---------- */
  const enemyDefs = [];
  for (const d of L.enemies) {
    const e = { ...d };
    if (d.nest) {
      const n = placed.get(d.nest);
      if (!n) continue;
      const gun = worldAnchor(n.model, 'gun', n.x, n.y, n.z, n.yaw) || [n.x, n.y + 1.05, n.z, n.yaw];
      const gunner = worldAnchor(n.model, 'gunner', n.x, n.y, n.z, n.yaw) || [n.x, n.y, n.z + 0.8, n.yaw];
      e.gun = [gun[0], gun[1], gun[2], n.yaw];
      e.anchor = [gunner[0], gunner[1], gunner[2], n.yaw];
      e.at = [gunner[0], gunner[2]];
    } else if (d.bunker) {
      const b = placed.get(d.bunker);
      if (!b) continue;
      const slit = worldAnchor(b.model, 'slit', b.x, b.y, b.z, b.yaw);
      const gunner = worldAnchor(b.model, 'gunner', b.x, b.y, b.z, b.yaw);
      if (!slit || !gunner) continue;
      const inX = gunner[0] - slit[0], inZ = gunner[2] - slit[2];
      const L2 = Math.hypot(inX, inZ) || 1;
      e.gun = [slit[0] + (inX / L2) * 0.7, slit[1] - 0.22, slit[2] + (inZ / L2) * 0.7, b.yaw];
      e.anchor = [gunner[0], gunner[1], gunner[2], b.yaw];
      e.at = [gunner[0], gunner[2]];
    } else if (d.anchorOf) {
      const [id, name] = d.anchorOf;
      const o = placed.get(id);
      const a = o && worldAnchor(o.model, name, o.x, o.y, o.z, o.yaw);
      if (!a) { console.warn('[hedgerow] anchor missing', id, name); continue; }
      e.anchor = [a[0], a[1], a[2], (d.yaw ?? 180) * DEG];
      e.at = [a[0], a[2]];
    }
    if (d.inTrench) {
      // stand on the trench's centre line
      let best = null;
      for (const k of ['TRENCH_W', 'TRENCH_E', 'TRENCH_C']) {
        const r = polylineDistance(L.lines[k], d.at[0], d.at[1], {});
        if (!best || r.d < best.d) best = r;
      }
      const x = best ? best.px : d.at[0], z = best ? best.pz : d.at[1];
      e.at = [x, z];
      e.anchor = [x, height(x, z), z, (d.yaw ?? 180) * DEG];
    }
    enemyDefs.push(e);
  }

  for (const [x, y, z, size] of L.farFires || []) {
    const f = G.effects.addFire(x, terrain.height(x, z) + 0.5, z, size);
    f.far = true;
    G.lights.addStatic({ x, y: terrain.height(x, z) + 3, z, color: '#ff7a30', intensity: 60, range: 40, flicker: 0.5 });
    G.halos?.add(x, terrain.height(x, z) + 3, z, '#ff7030', 16, 0.5, 0.4);
  }

  /* ---------- 6. river, cover ---------- */
  const water = buildRiver(L.water, G.textures, G.shared);
  G.scene.add(water);
  const cover = buildCoverPoints(world, terrain);

  return { terrain, world, veg, placed, enemyDefs, cover, lamps, fires, water, staticGroup, height };
}

/* Soft dark footprints on the ground under props and buildings: the
   occlusion the bakes cannot put on the terrain itself. */
function contactShadows(list, terrain) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const u = Math.abs(i / 63.5 - 1), v = Math.abs(j / 63.5 - 1);
    const d = Math.max(0, Math.hypot(Math.max(u - 0.55, 0), Math.max(v - 0.55, 0)) / 0.45);
    const a = Math.max(0, 1 - d);
    img.data[(j * 128 + i) * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a) * 0.85);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.55,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, Math.max(1, list.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const size = new THREE.Vector3(), ctr = new THREE.Vector3();
  let n = 0;
  for (const it of list) {
    it.m.box.getSize(size);
    it.m.box.getCenter(ctr);
    if (size.y < 0.15) continue;
    const c0 = Math.cos(it.yaw), s0 = Math.sin(it.yaw);
    const cx = it.x + (ctr.x * c0 + ctr.z * s0) * it.scale, cz = it.z + (-ctr.x * s0 + ctr.z * c0) * it.scale;
    const grow = Math.min(1.6, 0.4 + size.y * 0.08);
    q.setFromAxisAngle(up, it.yaw);
    s.set(size.x * it.scale + grow, 1, size.z * it.scale + grow);
    p.set(cx, Math.max(it.y, terrain.height(cx, cz)) + 0.03, cz);
    m4.compose(p, q, s);
    mesh.setMatrixAt(n++, m4);
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'contact_shadows';
  return mesh;
}

/* The lowest ground under a model's footprint, so it never floats. */
function minGround(terrain, m, x, z, yaw, scale) {
  const b = m.box;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let lo = terrain.height(x, z);
  const sx = Math.min(Math.abs(b.min.x), Math.abs(b.max.x)) * scale * 0.8;
  const sz = Math.min(Math.abs(b.min.z), Math.abs(b.max.z)) * scale * 0.8;
  for (const [lx, lz] of [[sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]]) {
    lo = Math.min(lo, terrain.height(x + lx * c + lz * s, z - lx * s + lz * c));
  }
  return lo;
}

function buildRiver(W, textures, shared) {
  const segs = 100;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const x = W.x0 + (W.x1 - W.x0) * (i / segs);
    const zc = W.riverZ(x);
    for (const side of [-1, 1]) {
      pos.push(x, W.level, zc + side * 13);
      uv.push(x / 10, side);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, createWaterMaterial(textures, shared));
  mesh.name = 'river';
  return mesh;
}
