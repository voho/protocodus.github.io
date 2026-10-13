/* Meteora — shields you can see.

   A ship's shield is invisible until something hits it. Then a shell the
   shape of the hull lights up around the impact: a hexagonal lattice that
   flares where the bolt landed and a ripple that runs out from there and
   fades. Quadrant shields light the side that took the hit. Our shields
   glow cyan; the Harrow's, a dull red. A shield that has just failed
   flickers once and goes dark.

   Each struck ship borrows a shell from a small pool for a moment. */

import * as THREE from 'three';

const POOL = 14, HITS = 4, LIFE = 0.55;

const vertex = /* glsl */`
varying vec3 vN;
varying vec3 vView;
varying float vDepth;
void main() {
  vN = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const fragment = /* glsl */`
uniform vec4 uHits[${HITS}];   // local direction xyz, age (s); age < 0 = empty
uniform vec3 uColour;
uniform float uLife;
uniform float uFlicker;
uniform float uSpot;   // radians: the flare's size, about the same in metres on any hull
uniform float uNear;   // 1 on capital ships: fade where the shell passes close to the camera
varying vec3 vN;
varying vec3 vView;
varying float vDepth;
float hex(vec2 p) {
  p *= vec2(1.0, 1.1547);
  vec2 q = vec2(p.x + p.y * 0.5, p.y);
  vec2 f = fract(q) - 0.5;
  return smoothstep(0.42, 0.5, max(abs(f.x), abs(f.y)));
}
void main() {
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(n.z, n.x);
  float grid = hex(vec2(lon * 9.0, lat * 9.0));
  float sum = 0.0;
  for (int i = 0; i < ${HITS}; i++) {
    vec4 h = uHits[i];
    if (h.w < 0.0) continue;
    float a = clamp(h.w / uLife, 0.0, 1.0);
    float theta = acos(clamp(dot(n, normalize(h.xyz)), -1.0, 1.0));
    float front = a * uSpot * 3.5;
    float ripple = exp(-pow((theta - front) / (uSpot * 0.36), 2.0)) * (1.0 - a);
    float spot = exp(-pow(theta / uSpot, 2.0)) * pow(1.0 - a, 2.0);
    sum += ripple * (0.35 + 0.65 * grid) + spot * (0.6 + 0.4 * grid);
  }
  float rim = pow(1.0 - abs(dot(normalize(vView), n)), 2.0);
  float alpha = clamp(sum * (0.55 + 0.45 * rim) + uFlicker * (0.25 + 0.75 * grid) * rim, 0.0, 1.0);
  alpha *= mix(1.0, smoothstep(30.0, 160.0, vDepth), uNear);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColour * alpha * 2.0, alpha);
}`;

export function createShields(scene) {
  const geometry = new THREE.SphereGeometry(1, 40, 24);
  const shells = [];
  for (let i = 0; i < POOL; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uHits: { value: Array.from({ length: HITS }, () => new THREE.Vector4(0, 0, 1, -1)) },
        uColour: { value: new THREE.Color(0.35, 0.75, 1.0) }, uLife: { value: LIFE }, uFlicker: { value: 0 },
        uSpot: { value: 0.45 }, uNear: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    scene.add(mesh);
    shells.push({ mesh, id: null, idle: 0, hits: 0, flicker: 0 });
  }
  const local = new THREE.Vector3(), inv = new THREE.Quaternion();
  // A flare about 28 m across whatever the hull's size (a fighter's whole
  // side, a capital ship's one plate), and capital shells fade near the eye.
  const sizeFor = (s, extent) => {
    const size = (extent[0] + extent[1] + extent[2]) / 3;
    const u = s.mesh.material.uniforms;
    u.uSpot.value = Math.min(0.45, Math.max(0.05, 28 / size));
    u.uNear.value = size > 60 ? 1 : 0;
  };

  const shellFor = id => {
    let s = shells.find(x => x.id === id);
    if (!s) {
      s = shells.find(x => x.id === null) ?? shells.reduce((a, b) => (a.idle > b.idle ? a : b));
      s.id = id; s.hits = 0;
      for (const h of s.mesh.material.uniforms.uHits.value) h.w = -1;
    }
    s.idle = 0;
    return s;
  };

  return {
    /* A hit on `entity`'s shield at world point `pos`. `extent` is the
       shell's half-size in the ship's frame. */
    hit(entity, pos, extent) {
      if (!entity?.ship) return;
      const s = shellFor(entity.id);
      const q = entity.ship.q;
      inv.set(q[0], q[1], q[2], q[3]).invert();
      local.set(pos[0] - entity.ship.pos[0], pos[1] - entity.ship.pos[1], pos[2] - entity.ship.pos[2]).applyQuaternion(inv);
      local.set(local.x / extent[0], local.y / extent[1], local.z / extent[2]);
      if (local.lengthSq() < 1e-6) local.set(0, 0, -1);
      local.normalize();
      const slot = s.mesh.material.uniforms.uHits.value[s.hits++ % HITS];
      slot.set(local.x, local.y, local.z, 0);
      s.extent = extent;
      sizeFor(s, extent);
      s.mesh.material.uniforms.uColour.value.setRGB(...(entity.team === 1 ? [1.0, 0.3, 0.18] : [0.35, 0.75, 1.0]));
    },
    collapse(entity, extent) {
      const s = shellFor(entity.id);
      s.flicker = 1; s.extent = extent; sizeFor(s, extent);
      s.mesh.material.uniforms.uColour.value.setRGB(...(entity.team === 1 ? [1.0, 0.3, 0.18] : [0.35, 0.75, 1.0]));
    },
    /* Every frame: follow each ship, age the hits, free idle shells. */
    update(dt, poseOf) {
      for (const s of shells) {
        if (s.id === null) continue;
        s.idle += dt;
        const u = s.mesh.material.uniforms;
        let live = false;
        for (const h of u.uHits.value) if (h.w >= 0) { h.w += dt; if (h.w > LIFE) h.w = -1; else live = true; }
        s.flicker = Math.max(0, s.flicker - dt * 2.5);
        u.uFlicker.value = s.flicker * (0.5 + 0.5 * Math.sin(s.idle * 60));
        const pose = poseOf(s.id);
        if ((!live && s.flicker <= 0) || !pose) { s.mesh.visible = false; if (s.idle > 1) s.id = null; continue; }
        s.mesh.visible = true;
        s.mesh.position.copy(pose.position);
        s.mesh.quaternion.copy(pose.quaternion);
        s.mesh.scale.set(s.extent[0], s.extent[1], s.extent[2]);
      }
    },
    clear() { for (const s of shells) { s.id = null; s.mesh.visible = false; } },
  };
}

/* The shell's half-size for an entity: from its collision spheres when it
   has them, else from its radius. */
export function shieldExtent(entity) {
  if (entity.colliders?.length) {
    let x = 0, y = 0, z = 0;
    for (const c of entity.colliders) {
      x = Math.max(x, Math.abs(c.pos[0]) + c.r); y = Math.max(y, Math.abs(c.pos[1]) + c.r); z = Math.max(z, Math.abs(c.pos[2]) + c.r);
    }
    return [x * 1.08, y * 1.08, z * 1.06];
  }
  const r = entity.radius;
  return [r * 1.0, r * 0.62, r * 1.25];
}
