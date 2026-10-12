/* Meteora — what is left flying: hull shards and rock chips.

   Nothing in vacuum slows a fragment down, so debris flies dead straight
   at whatever speed the blast gave it, tumbling, until it is far away.
   Hull shards are torn plates of the ship's own colours that come out
   glowing and cool through orange to dark metal over a second or two;
   while they are hot, explosions.js trails smoke and fire behind them.
   Rock chips are the belt's smallest rock scaled down, wearing its baked
   surface, so a broken rock throws out pieces of itself.

   Two instanced meshes, lit like everything else. A piece shrinks away at
   the end of its life rather than popping out. */

import * as THREE from 'three';
import { makeRng } from './rng.js';

/* A torn plate: an irregular hexagon, a little thicker at one end, with
   faceted normals so the sun glints off its faces as it turns. */
function shardGeometry() {
  const rng = makeRng(41);
  const ring = [];
  for (let k = 0; k < 6; k++) {
    const a = (k + rng.range(-0.3, 0.3)) / 6 * Math.PI * 2, r = rng.range(0.55, 1);
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const top = ring.map(([x, z]) => [x, 0.12 + 0.08 * x, z]), bottom = ring.map(([x, z]) => [x, -0.12 + 0.05 * z, z]);
  const p = [];
  const tri = (a, b, c) => p.push(...a, ...b, ...c);
  for (let k = 1; k < 5; k++) { tri(top[0], top[k + 1], top[k]); tri(bottom[0], bottom[k], bottom[k + 1]); }
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    tri(top[k], top[j], bottom[j]); tri(top[k], bottom[j], bottom[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

// Heat in the instance's emissive: dull red when barely warm, white when fresh.
function heatMaterial(base) {
  base.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aHeat;\nvarying float vHeat;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;');
    shader.fragmentShader = 'varying float vHeat;\n' + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * vHeat * vHeat * 5.0 + vec3(1.0, 0.75, 0.45) * pow(vHeat, 4.0) * 9.0;`);
  };
  base.customProgramCacheKey = () => 'meteora-debris-heat';
  return base;
}

function pieces(capacity) {
  return Array.from({ length: capacity }, () => ({
    pos: [0, 0, 0], vel: [0, 0, 0], base: [0, 0, 0], axis: new THREE.Vector3(1, 0, 0), spin: 0, angle: 0,
    scale: [1, 1, 1], age: 0, life: 1, heat: 0, trail: 0, color: null,
  }));
}

export function createDebris(scene, chipModel, { shards = 96, chips = 128 } = {}) {
  const shardGeo = shardGeometry();
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(shards), 1);
  heat.setUsage(THREE.DynamicDrawUsage);
  shardGeo.setAttribute('aHeat', heat);
  const shardMesh = new THREE.InstancedMesh(shardGeo,
    heatMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.65, roughness: 0.42, emissive: 0x000000 })), shards);
  // Every instance has a colour from the start, so the shader is built
  // with instance colours once rather than again at the first explosion.
  shardMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(shards * 3).fill(1), 3);
  const chipMesh = new THREE.InstancedMesh(chipModel.lod1, chipModel.material, chips);
  const chipScale = 1 / chipModel.lod1.boundingSphere.radius;
  for (const mesh of [shardMesh, chipMesh]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  const live = { shards: [], chips: [] }, pool = { shards: pieces(shards), chips: pieces(chips) };
  const KINDS = ['shards', 'chips'];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const tint = new THREE.Color();

  const spawn = (kind, x, y, z, vx, vy, vz, life) => {
    const list = live[kind];
    // Full: the oldest piece makes way.
    const piece = pool[kind].pop() ?? list.shift();
    piece.pos[0] = x; piece.pos[1] = y; piece.pos[2] = z;
    piece.vel[0] = vx; piece.vel[1] = vy; piece.vel[2] = vz;
    piece.age = 0; piece.life = life; piece.angle = 0; piece.trail = 0;
    list.push(piece);
    return piece;
  };

  const draw = (mesh, list, scaleBy) => {
    list.forEach((piece, k) => {
      const shrink = Math.min(1, (piece.life - piece.age) / 0.5);
      q.setFromAxisAngle(piece.axis, piece.angle);
      m.compose(p.set(piece.pos[0], piece.pos[1], piece.pos[2]), q,
        s.set(piece.scale[0], piece.scale[1], piece.scale[2]).multiplyScalar(shrink * scaleBy));
      mesh.setMatrixAt(k, m);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    shardMesh, chipMesh,
    get count() { return live.shards.length + live.chips.length; },
    // A plate about `size` metres across, of colour `color` (THREE.Color),
    // glowing with `hot` (0–1). `base` on the returned piece is the frame
    // its trail settles into.
    shard(x, y, z, vx, vy, vz, size, color, hot, life, rng) {
      const piece = spawn('shards', x, y, z, vx, vy, vz, life);
      piece.axis.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      if (piece.axis.lengthSq() === 0) piece.axis.set(0, 1, 0);
      piece.spin = rng.range(1.5, 9) * (rng.next() < 0.5 ? -1 : 1);
      piece.scale[0] = size * rng.range(0.35, 0.8); piece.scale[1] = size * rng.range(0.6, 1.3);
      piece.scale[2] = size * rng.range(0.4, 0.9);
      piece.heat = hot;
      piece.color = color;
      return piece;
    },
    chip(x, y, z, vx, vy, vz, size, life, rng) {
      const piece = spawn('chips', x, y, z, vx, vy, vz, life);
      piece.axis.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      if (piece.axis.lengthSq() === 0) piece.axis.set(0, 1, 0);
      piece.spin = rng.range(0.8, 6) * (rng.next() < 0.5 ? -1 : 1);
      piece.scale[0] = size * rng.range(0.7, 1.3); piece.scale[1] = size * rng.range(0.7, 1.3); piece.scale[2] = size;
      piece.heat = 0;
      return piece;
    },
    /* Moves and cools every piece. `trail(piece, dt)` is called for each
       hot shard, for explosions.js to leave smoke and fire behind it. */
    update(dt, trail) {
      for (const kind of KINDS) {
        const list = live[kind];
        for (let k = list.length - 1; k >= 0; k--) {
          const piece = list[k];
          piece.age += dt;
          if (piece.age >= piece.life) { list.splice(k, 1); pool[kind].push(piece); continue; }
          for (let i = 0; i < 3; i++) piece.pos[i] += piece.vel[i] * dt;
          piece.angle += piece.spin * dt;
          if (piece.heat > 0) {
            piece.heat *= Math.exp(-dt / 0.9);
            if (piece.heat < 0.01) piece.heat = 0;
            else trail?.(piece, dt);
          }
        }
      }
      draw(shardMesh, live.shards, 1);
      draw(chipMesh, live.chips, chipScale);
      live.shards.forEach((piece, k) => {
        heat.array[k] = piece.heat;
        shardMesh.setColorAt(k, tint.copy(piece.color));
      });
      heat.clearUpdateRanges(); heat.addUpdateRange(0, live.shards.length); heat.needsUpdate = true;
      if (live.shards.length) shardMesh.instanceColor.needsUpdate = true;
    },
    clear() {
      for (const kind of KINDS) { pool[kind].push(...live[kind]); live[kind].length = 0; }
      shardMesh.count = 0; chipMesh.count = 0;
    },
  };
}
