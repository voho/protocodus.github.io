/* Three particle systems, two shaders.

   Falling snow, the spray off the edge, and the streaks that appear once the
   run is genuinely quick. The first two are points with a per-particle size
   and alpha, so one small ShaderMaterial covers both — round, soft-edged, fog
   applied by hand because a custom shader does not get three's for free.

   The spray is the one that matters. It is the only thing on screen whose
   quantity is a direct read of how hard the board is working: a clean carve
   throws a little, a slide throws a wall of it, and a landing throws all of
   it at once. Take it away and the same physics stops feeling like anything.

   Everything in here was rewritten when the resolution was, and for the same
   reason: it all used to be sized against a fixed 288-line framebuffer.

   The point size is the sharp edge of that. `RENDER.height` no longer exists,
   because there is no longer one height — the buffer is whatever the window
   and the resolution governor between them decide, and it changes on every
   resize and every time the governor moves. So the metres-to-pixels
   conversion is read at the moment it is used rather than captured at module
   load, which is the difference between a snowflake that is the right size
   everywhere and one that is right on exactly one monitor.

   The spray then grew up. It used to be a cone of identically-shrinking dots
   under one gravity that decayed towards a dead stop in mid-air. Now every
   particle is somewhere on a scale from a thrown chunk to airborne dust: the
   dust falls slowly, swells as it disperses, tumbles sideways, and — the part
   that actually reads — decays towards the *wind's* velocity rather than
   towards zero, so a rooster tail hangs behind the rider and drifts off down
   the mountain instead of stopping dead in the air it was thrown into.

   And the streaks stopped being lines. A one-pixel LineSegment at 288 lines
   was a chunky white dash; the same primitive at native resolution on a
   retina panel is a hairline, and a screen full of hairlines does not read as
   speed, it reads as a scratched lens. They are camera-facing ribbons now,
   held at a constant handful of pixels wide however far away they are, soft
   across their width and fading out along their length. */

import { SNOW, STREAKS, SKY, RENDER } from './config.js';

const VERT = `
  precision mediump float;
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying float vDepth;
  uniform float uScale;
  uniform float uMax;
  uniform float uStretch;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    // Clamped at both ends: under a pixel a particle flickers, and over a
    // hundred or so it is a white sheet across the lens — and some drivers
    // quietly refuse to draw a point that big at all
    gl_PointSize = clamp(aSize * uScale * uStretch / max(0.001, vDepth), 1.0, uMax);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uAxis;
  uniform float uStretch;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    vec2 axis = normalize(uAxis + vec2(0.0001, 0.0));
    vec2 across = vec2(-axis.y, axis.x);
    vec2 q = vec2(dot(d, axis), dot(d, across) * uStretch);
    float r = dot(q, q);
    if (r > 0.25 || vAlpha <= 0.001) discard;
    float a = vAlpha * (1.0 - smoothstep(0.06, 0.25, r));
    // Anything inside arm's reach of the lens is on its way to being a
    // full-screen blob, so it is faded out before it can become one
    a *= smoothstep(0.25, 1.05, vDepth);
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.8), a * (1.0 - f));
  }
`;

function pointMaterial(THREE, color, maxSize = 96) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFog: { value: new THREE.Color(SKY.haze) },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uScale: { value: 300 },
      uMax: { value: maxSize },
      uAxis: { value: new THREE.Vector2(0, 1) },
      uStretch: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
}

function pointCloud(THREE, count, color, maxSize = 96) {
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const points = new THREE.Points(geo, pointMaterial(THREE, color, maxSize));
  points.frustumCulled = false;
  return { points, geo, position, size, alpha };
}

/* Pixels per metre, for something one metre from the lens.

   Point size is authored in metres and `gl_PointSize` is in framebuffer
   pixels, so this is the conversion, and it depends on two things that both
   move at runtime: the field of view, which the camera opens with speed, and
   the height of the buffer, which the resolution governor rewrites whenever
   the frame clock asks it to. The default reads `RENDER.buffer.height` at
   call time for exactly that reason — this used to take a constant, and a
   constant is wrong on every machine but one. */
export function pointScale(camera, height = RENDER.buffer.height) {
  return height / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

/* ==========================================================================
   Falling snow — a cube of it that travels with the camera
   ========================================================================== */

export function createSnowfall(THREE) {
  const n = SNOW.count;
  const cloud = pointCloud(THREE, n, '#ffffff', 72);
  const { position, size, alpha, geo } = cloud;
  const box = SNOW.box;
  const drift = new Float32Array(n * 2);
  // Per-flake fall rate, flutter amplitude and flutter phase. Without them
  // fourteen hundred flakes descend in fourteen hundred parallel lines at
  // identical speed, which at this count reads as a moving texture rather
  // than as weather.
  const fall = new Float32Array(n);
  const swing = new Float32Array(n);
  const phase = new Float32Array(n);
  let clock = 0;
  let seeded = false;

  for (let i = 0; i < n; i++) {
    size[i] = SNOW.size * (0.55 + Math.random() * 0.9);
    alpha[i] = 0.35 + Math.random() * 0.5;
    drift[i * 2] = (Math.random() - 0.5) * 1.6;
    drift[i * 2 + 1] = (Math.random() - 0.5) * 1.6;
    // A big flake is a big loose aggregate: it falls slowly and wanders on
    // the way down. A small one is nearer to a pellet and drops straight.
    const heavy = size[i] / SNOW.size;   // 0.55 … 1.45
    fall[i] = SNOW.fall * (1.3 - heavy * 0.45);
    swing[i] = 0.15 + heavy * 0.5;       // m/s of lateral wander
    phase[i] = Math.random() * Math.PI * 2;
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
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    clock += dt;
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
      const a = clock * (1.4 + swing[i] * 1.8) + phase[i];
      position[j] += (drift[i * 2] + wx + Math.cos(a) * swing[i]) * dt;
      position[j + 1] -= fall[i] * dt;
      position[j + 2] += (drift[i * 2 + 1] + wz + Math.sin(a * 0.7) * swing[i] * 0.7) * dt;
      // The box is a torus around the camera: anything that leaves one face
      // arrives at the opposite one, so the field is endless and finite
      position[j] = wrap(position[j], c.x);
      position[j + 1] = wrap(position[j + 1], c.y);
      position[j + 2] = wrap(position[j + 2], c.z);
    }
    geo.attributes.position.needsUpdate = true;
    const uniforms = cloud.points.material.uniforms;
    uniforms.uScale.value = pointScale(camera);
    // Project the fall-and-wind vector onto the camera plane. The point stays
    // one draw call, but a storm now cuts diagonally across the view instead
    // of reading as a cloud of circular dots.
    const e = camera.matrixWorld.elements;
    const fallSpeed = -SNOW.fall;
    const sx = wx * e[0] + fallSpeed * e[1] + wz * e[2];
    const sy = wx * e[4] + fallSpeed * e[5] + wz * e[6];
    const sl = Math.hypot(sx, sy) || 1;
    uniforms.uAxis.value.set(sx / sl, sy / sl);
    uniforms.uStretch.value = 1 + Math.min(2.0, Math.hypot(wx, wz) * 0.085 + 0.25);
  }

  return { points: cloud.points, update, setIntensity };
}

/* ==========================================================================
   Spray — thrown off the edge, and everywhere on a landing
   ========================================================================== */

export function createSpray(THREE) {
  const n = SNOW.sprayCount;
  const cloud = pointCloud(THREE, n, '#ffffff', 56);
  const { position, size, alpha, geo } = cloud;
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const maxLife = new Float32Array(n);
  // What kind of snow this particle is: 0 is a thrown chunk, 1 is airborne
  // dust. Everything that differs between the two — weight, drag, how long
  // it lasts, how far it swells, how hard the wind gets hold of it — is a
  // blend on this one number, which is why there is one update loop and not
  // two systems.
  const fine = new Float32Array(n);
  const born = new Float32Array(n);   // birth size, in metres
  const grow = new Float32Array(n);   // and how much of itself it gains by the end
  const tumble = new Float32Array(n); // lateral wander, m/s²
  const spin = new Float32Array(n);   // and how fast that wander swings round
  const phase = new Float32Array(n);
  let head = 0;

  /* `power` is how hard: it scales the cone, the size and how long the
     powder hangs. `dir` is where the board is throwing it. */
  function burst(pos, dirX, dirZ, count, power) {
    const p = Math.min(1, power);
    for (let k = 0; k < count; k++) {
      const i = head;
      head = (head + 1) % n;
      const j = i * 3;
      const spread = 0.4 + power * 0.5;
      // A gentle carve lifts dust; a landing breaks the crust and throws
      // lumps of it, so weight is biased in with power
      const f = Math.random() * (1 - 0.45 * p);
      fine[i] = f;
      position[j] = pos.x + (Math.random() - 0.5) * 0.7;
      position[j + 1] = pos.y + 0.1 + Math.random() * 0.25;
      position[j + 2] = pos.z + (Math.random() - 0.5) * 0.7;
      vel[j] = dirX * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      vel[j + 1] = (0.9 + Math.random() * 1.5) * (1.4 + power * 1.7) * (1 - 0.3 * f);
      vel[j + 2] = dirZ * power * (0.5 + Math.random()) + (Math.random() - 0.5) * spread * 4;
      maxLife[i] = SNOW.sprayLife * (0.45 + Math.random() * 0.75) * (1 + f * 0.85);
      life[i] = maxLife[i];
      born[i] = SNOW.spraySize * (0.4 + Math.random() * 1.1) * (0.7 + power * 0.4);
      grow[i] = 0.5 + f * 1.5;
      tumble[i] = (0.7 + Math.random() * 2.4) * (0.35 + f);
      spin[i] = (2 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1);
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = born[i];
      alpha[i] = 0;
    }
  }

  function update(dt, camera, wind) {
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) {
        if (alpha[i] !== 0) alpha[i] = 0;
        continue;
      }
      const j = i * 3;
      life[i] -= dt;
      const f = fine[i];
      const age = maxLife[i] - life[i];

      // Weight. Dust is mostly air and barely falls; a chunk of crust falls
      // at very nearly the rate the rider does.
      vel[j + 1] -= (3.4 + (1 - f) * 9.6) * dt;

      // Lateral tumble: a slow swing that turns as the particle ages, so a
      // rooster tail frays outwards instead of staying a clean cone
      const a = phase[i] + age * spin[i];
      vel[j] += Math.cos(a) * tumble[i] * dt;
      vel[j + 2] += Math.sin(a) * tumble[i] * dt;

      /* Drag, and the one line that changed the whole look of this.

         Powder is mostly air: it slows fast, which is what makes it read as
         snow rather than as gravel. It used to slow towards *nothing*, which
         quietly claimed the air was still — so a plume hung exactly where it
         was thrown, in a game with a wind vector that is already blowing the
         snowfall sideways. Now the horizontal velocity decays towards the
         wind instead, and the plume drifts off down the mountain with
         everything else in the sky. */
      const k = Math.exp(-(1.7 + f * 2.3) * dt);
      vel[j] = wx + (vel[j] - wx) * k;
      vel[j + 1] *= k;
      vel[j + 2] = wz + (vel[j + 2] - wz) * k;

      position[j] += vel[j] * dt;
      position[j + 1] += vel[j + 1] * dt;
      position[j + 2] += vel[j + 2] * dt;

      // A puff disperses: it swells as it fades, which is the whole reason
      // half a dozen particles read as a cloud rather than as half a dozen
      // particles
      const t = Math.max(0, life[i]) / maxLife[i];
      size[i] = born[i] * (1 + grow[i] * (1 - t));
      // Fading in over the first breath of its life stops a burst arriving
      // as a wall of hard dots on the frame it was fired
      const rise = Math.min(1, age * 14);
      alpha[i] = rise * t * t * (0.85 - f * 0.3);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    cloud.points.material.uniforms.uScale.value = pointScale(camera);
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

/* Every streak is the same shape pointing the same way — back along the
   direction of travel, by a length set by the speed — so the direction and
   the length are a uniform and not an attribute, and the only things that
   move per frame are the anchor points and their alphas.

   The width is held in pixels rather than metres. A ribbon whose thickness
   is fixed in the world is a dash near the lens and a hairline twenty metres
   out, and the far ones are most of the field; a constant few pixels is what
   the chunky low-resolution line was giving for free, and it is what the eye
   reads as motion blur rather than as damage to the screen. The conversion
   is `pointScale` run backwards, so the ribbons and the powder agree about
   what a pixel is worth at a given distance. */
const S_VERT = `
  attribute float aEnd;
  attribute float aSide;
  attribute float aAlpha;
  uniform vec3 uDir;
  uniform float uWidth;
  uniform float uScale;
  varying float vAlpha;
  varying float vDepth;
  varying float vSide;
  varying float vEnd;
  void main() {
    vAlpha = aAlpha;
    vSide = aSide;
    vEnd = aEnd;
    vec4 mv = modelViewMatrix * vec4(position + uDir * aEnd, 1.0);
    vDepth = -mv.z;
    vec3 axis = (modelViewMatrix * vec4(uDir, 0.0)).xyz;
    vec3 side = cross(axis, mv.xyz);
    float l = length(side);
    // A streak aimed straight at the eye has no side to speak of; it also
    // has no length on screen, so which way it is widened cannot matter
    side = l > 1e-5 ? side / l : vec3(1.0, 0.0, 0.0);
    mv.xyz += side * (aSide * 0.5 * uWidth * vDepth / max(uScale, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const S_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vDepth;
  varying float vSide;
  varying float vEnd;
  void main() {
    if (vAlpha <= 0.002) discard;
    // Soft across the width and fading along the length: the head of a
    // streak is where the air is, the tail is where it has already been
    float across = 1.0 - vSide * vSide;
    float along = 1.0 - vEnd * vEnd;
    float near = smoothstep(1.4, 5.5, vDepth);
    float far = 1.0 - smoothstep(28.0, 72.0, vDepth);
    gl_FragColor = vec4(uColor, vAlpha * across * along * near * far);
  }
`;

export function createStreaks(THREE) {
  const n = STREAKS.count;
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(n * 12);   // four corners a streak
  const alpha = new Float32Array(n * 4);
  const end = new Float32Array(n * 4);
  const side = new Float32Array(n * 4);
  const index = new Uint16Array(n * 6);
  const home = new Float32Array(n * 3);
  const age = new Float32Array(n);
  const radial = new Float32Array(n);   // where in the disc it sits, 0 at the axis
  const jitter = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const v = i * 4;
    end[v] = 0; end[v + 1] = 0; end[v + 2] = 1; end[v + 3] = 1;
    side[v] = -1; side[v + 1] = 1; side[v + 2] = 1; side[v + 3] = -1;
    const q = i * 6;
    index[q] = v; index[q + 1] = v + 1; index[q + 2] = v + 2;
    index[q + 3] = v; index[q + 4] = v + 2; index[q + 5] = v + 3;
    jitter[i] = 0.55 + Math.random() * 0.7;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uDir: { value: new THREE.Vector3(0, 0, 1) },
      uWidth: { value: 2 },
      uScale: { value: 300 },
    },
    vertexShader: S_VERT,
    fragmentShader: S_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /* Kept under the name it had. It is a Mesh now rather than LineSegments,
     but it is still the one thing `main.js` adds to the scene and renaming
     it would buy nothing but a broken import. */
  const lines = new THREE.Mesh(geo, material);
  lines.frustumCulled = false;

  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const up = new THREE.Vector3();
  let placed = false;

  /* A streak is a fixed point in the world with a ribbon drawn back along the
     direction of travel. It does not move — the rider passes it — which is
     exactly why it reads as speed rather than as weather. */
  function respawn(i, camera) {
    const a = Math.random() * Math.PI * 2;
    const f = Math.sqrt(0.05 + Math.random() * 0.95);
    const r = STREAKS.radius * f;
    const d = 4 + Math.random() * STREAKS.ahead;
    const j = i * 3;
    home[j] = camera.position.x + fwd.x * d + rgt.x * Math.cos(a) * r + up.x * Math.sin(a) * r;
    home[j + 1] = camera.position.y + fwd.y * d + rgt.y * Math.cos(a) * r + up.y * Math.sin(a) * r;
    home[j + 2] = camera.position.z + fwd.z * d + rgt.z * Math.cos(a) * r + up.z * Math.sin(a) * r;
    radial[i] = f;
    age[i] = 0;
  }

  // Blanked streaks are also aged back to nothing, so a field that thins out
  // and thickens again fades its streaks in rather than snapping them on
  const blank = (i) => {
    const v = i * 4;
    alpha[v] = 0; alpha[v + 1] = 0; alpha[v + 2] = 0; alpha[v + 3] = 0;
    age[i] = 0;
  };

  function update(dt, camera, velocity, speed) {
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0);
    rgt.crossVectors(fwd, up).normalize();
    up.crossVectors(rgt, fwd).normalize();

    const t = Math.min(1, Math.max(0, (speed - STREAKS.from) / (STREAKS.full - STREAKS.from)));
    const active = Math.round(n * t * t);
    const len = speed * STREAKS.length;
    const inv = 1 / (speed || 1);

    material.uniforms.uDir.value.set(-velocity.x * inv * len, -velocity.y * inv * len,
      -velocity.z * inv * len);
    // Thin when the field first appears, and never more than about three
    // pixels: past that they stop being air and start being bars
    material.uniforms.uWidth.value = 1.4 + t * 1.9;
    material.uniforms.uScale.value = pointScale(camera);

    if (!placed) {
      placed = true;
      for (let i = 0; i < n; i++) respawn(i, camera);
    }

    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (i >= active) {
        blank(i);
        continue;
      }
      // Behind the camera, or too far off to one side: put it back in front
      const dx = home[j] - camera.position.x;
      const dy = home[j + 1] - camera.position.y;
      const dz = home[j + 2] - camera.position.z;
      const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
      if (along < -2 || along > STREAKS.ahead + 30 || (dx * dx + dy * dy + dz * dz) > 4900) {
        respawn(i, camera);
        blank(i);
        continue;
      }
      age[i] += dt;
      /* Three things hold the field back from being a white cage.

         It fades in over a tenth of a second, because a streak that appears
         at full strength four metres in front of the lens is a flash.

         It is dimmer near the axis of travel than at the edge of the disc,
         which is what real motion blur does — nothing moves at the vanishing
         point — and it is what keeps the middle of the frame, the part the
         player is actually reading, clear.

         And every streak has its own brightness, so the field has depth in
         it rather than being one flat sheet of identical marks. */
      const a = 0.30 * t * jitter[i]
        * (0.3 + 0.7 * radial[i])
        * Math.min(1, age[i] * 9);
      const v = i * 4;
      alpha[v] = a; alpha[v + 1] = a; alpha[v + 2] = a; alpha[v + 3] = a;
      for (let c = 0; c < 4; c++) {
        const k = (i * 4 + c) * 3;
        position[k] = home[j];
        position[k + 1] = home[j + 1];
        position[k + 2] = home[j + 2];
      }
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  return { lines, update };
}
