/* Three particle systems, one shader.

   Falling snow, the spray off the edge, and the streaks that appear once the
   run is genuinely quick. All three are points with a per-particle size and
   alpha, so one small ShaderMaterial covers the lot — round, soft-edged, fog
   applied by hand because a custom shader does not get three's for free.

   The spray is the one that matters. It is the only thing on screen whose
   quantity is a direct read of how hard the board is working: a clean carve
   throws a little, a slide throws a wall of it, and a landing throws all of
   it at once. Take it away and the same physics stops feeling like anything. */

import { SNOW, STREAKS, SKY, RENDER } from './config.js';

const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying float vDepth;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_PointSize = max(1.0, aSize * uScale / max(0.001, vDepth));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25 || vAlpha <= 0.001) discard;
    float a = vAlpha * (1.0 - smoothstep(0.06, 0.25, r));
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.8), a * (1.0 - f));
  }
`;

function pointMaterial(THREE, color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFog: { value: new THREE.Color(SKY.haze) },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uScale: { value: 300 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
}

function pointCloud(THREE, count, color) {
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const points = new THREE.Points(geo, pointMaterial(THREE, color));
  points.frustumCulled = false;
  return { points, geo, position, size, alpha };
}

/* Point size is in metres at one metre; this converts it to pixels for the
   framebuffer and field of view actually in use. */
export function pointScale(camera, height) {
  return height / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

/* ==========================================================================
   Falling snow — a cube of it that travels with the camera
   ========================================================================== */

export function createSnowfall(THREE) {
  const n = SNOW.count;
  const cloud = pointCloud(THREE, n, '#ffffff');
  const { position, size, alpha, geo } = cloud;
  const box = SNOW.box;
  const drift = new Float32Array(n * 2);
  let seeded = false;

  for (let i = 0; i < n; i++) {
    size[i] = SNOW.size * (0.55 + Math.random() * 0.9);
    alpha[i] = 0.35 + Math.random() * 0.5;
    drift[i * 2] = (Math.random() - 0.5) * 1.6;
    drift[i * 2 + 1] = (Math.random() - 0.5) * 1.6;
  }
  geo.attributes.aSize.needsUpdate = true;
  geo.attributes.aAlpha.needsUpdate = true;

  const wrap = (v, c) => {
    let d = v - c;
    d -= Math.floor(d / box + 0.5) * box;
    return c + d;
  };

  /* Weather thins the snowfall by drawing fewer of the same particles
     rather than by resizing anything, so a blizzard easing off is one
     integer moving and no allocation at all. */
  function setIntensity(t) {
    geo.setDrawRange(0, Math.max(0, Math.min(n, Math.round(n * t))));
  }

  function update(dt, camera, wind) {
    const c = camera.position;
    if (!seeded) {
      seeded = true;
      for (let i = 0; i < n; i++) {
        position[i * 3] = c.x + (Math.random() - 0.5) * box;
        position[i * 3 + 1] = c.y + (Math.random() - 0.5) * box;
        position[i * 3 + 2] = c.z + (Math.random() - 0.5) * box;
      }
    }
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      position[j] += (drift[i * 2] + wind.x) * dt;
      position[j + 1] -= SNOW.fall * dt;
      position[j + 2] += (drift[i * 2 + 1] + wind.z) * dt;
      // The box is a torus around the camera: anything that leaves one face
      // arrives at the opposite one, so the field is endless and finite
      position[j] = wrap(position[j], c.x);
      position[j + 1] = wrap(position[j + 1], c.y);
      position[j + 2] = wrap(position[j + 2], c.z);
    }
    geo.attributes.position.needsUpdate = true;
    cloud.points.material.uniforms.uScale.value = pointScale(camera, RENDER.height);
  }

  return { points: cloud.points, update, setIntensity };
}

/* ==========================================================================
   Spray — thrown off the edge, and everywhere on a landing
   ========================================================================== */

export function createSpray(THREE) {
  const n = SNOW.sprayCount;
  const cloud = pointCloud(THREE, n, '#ffffff');
  const { position, size, alpha, geo } = cloud;
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const maxLife = new Float32Array(n);
  let head = 0;

  /* `power` is how hard: it scales the cone, the size and how long the
     powder hangs. `dir` is where the board is throwing it. */
  function burst(pos, dirX, dirZ, count, power) {
    for (let k = 0; k < count; k++) {
      const i = head;
      head = (head + 1) % n;
      const j = i * 3;
      const spread = 0.4 + power * 0.5;
      position[j] = pos.x + (Math.random() - 0.5) * 0.7;
      position[j + 1] = pos.y + 0.1 + Math.random() * 0.25;
      position[j + 2] = pos.z + (Math.random() - 0.5) * 0.7;
      vel[j] = dirX * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      vel[j + 1] = (0.9 + Math.random() * 1.5) * (1.4 + power * 1.7);
      vel[j + 2] = dirZ * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      maxLife[i] = SNOW.sprayLife * (0.45 + Math.random() * 0.75);
      life[i] = maxLife[i];
      size[i] = SNOW.spraySize * (0.5 + Math.random() * 1.2) * (0.7 + power * 0.4);
    }
  }

  function update(dt, camera) {
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) {
        if (alpha[i] !== 0) alpha[i] = 0;
        continue;
      }
      const j = i * 3;
      life[i] -= dt;
      vel[j + 1] -= 11 * dt;
      // Powder is mostly air: it slows fast, which is what makes it read as
      // snow rather than as gravel
      const k = Math.exp(-2.4 * dt);
      vel[j] *= k; vel[j + 1] *= k; vel[j + 2] *= k;
      position[j] += vel[j] * dt;
      position[j + 1] += vel[j + 1] * dt;
      position[j + 2] += vel[j + 2] * dt;
      const t = Math.max(0, life[i]) / maxLife[i];
      alpha[i] = t * t * 0.9;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    cloud.points.material.uniforms.uScale.value = pointScale(camera, RENDER.height);
  }

  function clear() {
    for (let i = 0; i < n; i++) { life[i] = 0; alpha[i] = 0; }
    geo.attributes.aAlpha.needsUpdate = true;
  }

  return { points: cloud.points, burst, update, clear };
}

/* ==========================================================================
   Streaks — the air itself, once there is enough of it going past
   ========================================================================== */

const S_VERT = `
  attribute float aAlpha;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const S_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    if (vAlpha <= 0.002) discard;
    float near = 1.0 - smoothstep(1.5, 6.0, vDepth);
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - near) * (1.0 - smoothstep(30.0, 70.0, vDepth)));
  }
`;

export function createStreaks(THREE) {
  const n = STREAKS.count;
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(n * 6);
  const alpha = new Float32Array(n * 2);
  const home = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const lines = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffffff') } },
    vertexShader: S_VERT,
    fragmentShader: S_FRAG,
    transparent: true,
    depthWrite: false,
  }));
  lines.frustumCulled = false;

  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const up = new THREE.Vector3();
  let placed = false;

  /* A streak is a fixed point in the world with a line drawn back along the
     direction of travel. It does not move — the rider passes it — which is
     exactly why it reads as speed rather than as weather. */
  function respawn(i, camera) {
    const a = Math.random() * Math.PI * 2;
    const r = STREAKS.radius * Math.sqrt(0.05 + Math.random() * 0.95);
    const d = 4 + Math.random() * STREAKS.ahead;
    const j = i * 3;
    home[j] = camera.position.x + fwd.x * d + rgt.x * Math.cos(a) * r + up.x * Math.sin(a) * r;
    home[j + 1] = camera.position.y + fwd.y * d + rgt.y * Math.cos(a) * r + up.y * Math.sin(a) * r;
    home[j + 2] = camera.position.z + fwd.z * d + rgt.z * Math.cos(a) * r + up.z * Math.sin(a) * r;
  }

  function update(dt, camera, velocity, speed) {
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0);
    rgt.crossVectors(fwd, up).normalize();
    up.crossVectors(rgt, fwd).normalize();

    const t = Math.min(1, Math.max(0, (speed - STREAKS.from) / (STREAKS.full - STREAKS.from)));
    const active = Math.round(n * t * t);
    const len = speed * STREAKS.length;
    const vx = velocity.x / (speed || 1);
    const vy = velocity.y / (speed || 1);
    const vz = velocity.z / (speed || 1);

    if (!placed) {
      placed = true;
      for (let i = 0; i < n; i++) respawn(i, camera);
    }

    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const k = i * 6;
      if (i >= active) {
        alpha[i * 2] = 0;
        alpha[i * 2 + 1] = 0;
        continue;
      }
      // Behind the camera, or too far off to one side: put it back in front
      const dx = home[j] - camera.position.x;
      const dy = home[j + 1] - camera.position.y;
      const dz = home[j + 2] - camera.position.z;
      const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
      if (along < -2 || along > STREAKS.ahead + 30 || (dx * dx + dy * dy + dz * dz) > 4900) {
        respawn(i, camera);
        continue;
      }
      position[k] = home[j];
      position[k + 1] = home[j + 1];
      position[k + 2] = home[j + 2];
      position[k + 3] = home[j] - vx * len;
      position[k + 4] = home[j + 1] - vy * len;
      position[k + 5] = home[j + 2] - vz * len;
      const a = 0.5 * t;
      alpha[i * 2] = a;
      alpha[i * 2 + 1] = 0;
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  return { lines, update };
}

