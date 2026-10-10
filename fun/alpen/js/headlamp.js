/* The rider's night light.

   The mountain already owns the clock. This module only translates its
   continuous `weather.night` signal into something attached to the animated
   head: a small helmet lamp, a fog-aware cone of scattered light, and the
   snow the beam lands on.

   This deliberately is not a THREE.SpotLight. The terrain's snow response is
   authored around one directional sun/moon source, while a moving spotlight
   would add another full light variant to every Lambert material and still
   would not light the custom snow-particle shaders. Two shells do the work
   instead. A fan through the beam's axis, turned to face the lens, draws the
   air the light travels through. A second fan is draped over the snow ahead
   and lit per pixel the way a spotlight would light it: the beam's profile,
   the inverse square of the range and the angle the light strikes the snow
   at. So the lit patch sits a few metres ahead, where a head torch actually
   puts it, fades down the hill, and picks out the faces of the moguls that
   turn towards it. It is drawn twice: once added, which whitens the snow
   the lamp is on, and once multiplied in, which keeps the corduroy and the
   relief under it instead of laying a flat glow over them. The depth buffer
   cuts all of it against the terrain and the trees. Per frame at night: one
   march along the beam for where it lands, and one height lookup per fan
   vertex.

   Helmet-forward is local +X in riderModel. The emitter inherits the animated
   head, while the soft beam itself is solved from real travel projected onto
   the snow. The lamp therefore stays on the forehead but always illuminates
   the downhill line being ridden, including through a carve or switch run. */

export const HEADLAMP = {
  nightFrom: 0.22,      // begins to glow in blue hour / twilight
  nightFull: 0.65,      // fully established earlier for crisp night vision
  fadeIn: 4.5,          // responsive fade per second
  fadeOut: 3.0,
  reach: 60,            // extended 60m search reach for high-speed downhill lines
  marchStep: 0.75,      // initial stride
  marchGrow: 1.32,      // geometric stride growth
  overshoot: 1.05,      // clean seamless connection to terrain hit
  drop: 0.11,           // radians below the snow's line of travel
  angle: 0.42,          // broad 24-degree half-angle with concentrated core
  beam: '#d6edff',      // crisp, high-CRI alpine LED beam
  beamStrength: 0.028,  // visible atmospheric volumetric shaft
  // The lit snow: added (whitens it) and multiplied in (keeps its texture),
  // both against the light arriving at 6 m — see POOL_FRAG.
  poolAdd: 0.6,
  poolMul: 3.0,
  hitTrack: 14.0,       // responsive tracking on changing slope
};

const BEAM_SEG = 8;
// The lit fan over the snow: rows from just ahead of the board to where the
// inverse square has left almost nothing, closer together near the lamp
// where the light changes fastest, and columns a little wider than the cone.
const POOL_ROWS = 10;
const POOL_COLS = 9;
const POOL_NEAR = 1.5;
const POOL_FAR = 36;
const POOL_SPREAD = HEADLAMP.angle * 1.25;
/* Lifted a hand's breadth off the height field and offset in depth as well,
   because the drawn snow between lattice vertices is a chord of the surface
   the drape samples and sits a few centimetres off it on a mogul. */
const POOL_LIFT = 0.1;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const approach = (v, target, rate, dt) => (
  v + (target - v) * (1 - Math.exp(-rate * Math.min(dt, 0.05)))
);

/* A cone surface standing in for illuminated air. Fog is folded in manually:
   ShaderMaterial receives none of Three's scene fog unless it is authored. */
const BEAM_VERT = `
  attribute float aClear;
  varying vec2 vUv;
  varying float vDepth;
  varying float vClear;
  void main() {
    vUv = uv;
    vClear = aClear;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  varying vec2 vUv;
  varying float vDepth;
  varying float vClear;
  void main() {
    if (uStrength <= 0.001) discard;
    float along = vUv.x;
    float across = abs(vUv.y * 2.0 - 1.0);
    // Concentrated core beam + soft peripheral volumetric scatter
    float core = exp(-8.5 * across * across) * 1.75;
    float flood = exp(-2.2 * across * across) * (1.0 - smoothstep(0.65, 1.0, across));
    float radial = core + flood;
    float enter = smoothstep(0.0, 0.08, along);
    float leave = 1.0 - smoothstep(0.60, 0.98, along);
    // Faded into the snow rather than cut by it: the sheet's lower half runs
    // under the slope, and the depth test alone draws that as a hard line.
    float a = uStrength * radial * enter * leave
      * (0.35 + 0.65 * (1.0 - along)) * smoothstep(0.0, 0.8, vClear);
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.75), a * (1.0 - f));
  }
`;

// The fan is written in world space, so its positions are the world.
const POOL_VERT = `
  varying vec3 vWorld;
  varying vec3 vSnowNormal;
  varying float vDepth;
  void main() {
    vWorld = position;
    vSnowNormal = normal;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/* The light arriving at the snow, relative to the light at 6 m on the axis
   of a level beam: the beam's own profile (the same core and flood as the
   air), Lambert at the snow, and the inverse square. The output is
   premultiplied, so one shader serves both blends. */
const POOL_FRAG = `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  uniform vec3 uLampPos;
  uniform vec3 uLampDir;
  uniform float uAngle;
  varying vec3 vWorld;
  varying vec3 vSnowNormal;
  varying float vDepth;
  void main() {
    if (uStrength <= 0.001) discard;
    vec3 ray = vWorld - uLampPos;
    float d2 = max(dot(ray, ray), 1.0);
    vec3 l = ray * inversesqrt(d2);
    float x = acos(clamp(dot(l, uLampDir), -1.0, 1.0)) / uAngle;
    float profile = exp(-8.5 * x * x) * 1.75
      + exp(-2.2 * x * x) * (1.0 - smoothstep(0.65, 1.0, x));
    float lit = profile * max(dot(normalize(vSnowNormal), -l), 0.0) * (36.0 / d2);
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    float a = min(uStrength * lit, 2.5) * (1.0 - f);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.75) * a, a);
  }
`;

function haloTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const glow = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(235,248,255,0.95)');
  glow.addColorStop(0.35, 'rgba(175,220,255,0.45)');
  glow.addColorStop(0.70, 'rgba(100,180,255,0.15)');
  glow.addColorStop(1, 'rgba(60,140,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* The beam is a fan through its own axis, turned about that axis to face the
   lens: the widest silhouette a cone can show from where the camera is, and
   two columns of quads either side of a centre line so the across-profile
   is exact at every vertex rather than smeared over one long triangle. */
function beamGeometry(THREE) {
  const count = (BEAM_SEG + 1) * 3;
  const uv = new Float32Array(count * 2);
  const index = [];
  for (let i = 0; i <= BEAM_SEG; i++) {
    for (let c = 0; c < 3; c++) {
      const k = i * 3 + c;
      uv[k * 2] = i / BEAM_SEG;
      uv[k * 2 + 1] = c / 2;
    }
  }
  for (let i = 0; i < BEAM_SEG; i++) {
    for (let c = 0; c < 2; c++) {
      const a = i * 3 + c;
      index.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aClear', new THREE.BufferAttribute(new Float32Array(count), 1)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

function poolGeometry(THREE) {
  const count = POOL_ROWS * POOL_COLS;
  const index = [];
  for (let i = 0; i + 1 < POOL_ROWS; i++) {
    for (let j = 0; j + 1 < POOL_COLS; j++) {
      const a = i * POOL_COLS + j;
      index.push(a, a + 1, a + POOL_COLS + 1, a, a + POOL_COLS + 1, a + POOL_COLS);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(index);
  return geometry;
}

export function createHeadlamp(THREE, shading, head) {
  const rig = new THREE.Group();
  rig.name = 'rider-headlamp';
  rig.visible = false;
  head.add(rig);

  const aim = new THREE.Group();
  aim.position.set(0.170, 0.205, 0);
  aim.name = 'rider-headlamp-aim';
  rig.add(aim);

  const colour = new THREE.Color(HEADLAMP.beam);
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3(0, 0, -1);
  // For the falling snow (particles.js): where the lamp is and how bright,
  // its axis and half-angle, and its colour, shared by reference.
  const uniforms = {
    uLamp: { value: new THREE.Vector4() },
    uLampDir: { value: new THREE.Vector4(0, 0, -1, HEADLAMP.angle) },
    uLampColor: { value: colour },
  };
  // The same fog range and haze every other surface is drawn into.
  const shared = {
    uColor: { value: colour },
    uFog: shading.uniforms.uSkyHaze,
    uNear: shading.uniforms.uFogNear,
    uFar: shading.uniforms.uFogFar,
  };

  const beamMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uStrength: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeometry(THREE), beamMat);
  beam.name = 'rider-headlamp-beam';
  beam.frustumCulled = false;
  beam.visible = false;

  const lamp = {
    uLampPos: { value: origin },
    uLampDir: { value: direction },
    uAngle: { value: HEADLAMP.angle },
  };
  // `source` is the factor the shader's premultiplied light is taken at:
  // One adds it, DstColor multiplies the snow already drawn by it.
  const poolMaterial = (source) => new THREE.ShaderMaterial({
    uniforms: { ...shared, ...lamp, uStrength: { value: 0 } },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: source,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const poolGeo = poolGeometry(THREE);
  const added = new THREE.Mesh(poolGeo, poolMaterial(THREE.OneFactor));
  const multiplied = new THREE.Mesh(poolGeo, poolMaterial(THREE.DstColorFactor));
  added.frustumCulled = false;
  multiplied.frustumCulled = false;
  // Ahead of every other transparent layer, so it multiplies the snow alone
  // and not the snowfall or the added light drawn over it.
  multiplied.renderOrder = -1;
  const pool = new THREE.Group();
  pool.name = 'rider-headlamp-pool';
  pool.add(added, multiplied);
  pool.visible = false;

  // The lamp itself, seen from in front: the one point of it that faces you.
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(THREE),
    color: colour,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  }));
  glint.scale.setScalar(0.16);
  aim.add(glint);

  let level = 0;
  let distance = -1;          // the snow the beam reached this frame, or -1
  let displayedDistance = 0;  // where the drawn beam meets the snow
  const want = new THREE.Vector3();
  const travel = new THREE.Vector3();
  const side = new THREE.Vector3();
  const toLens = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const along = new THREE.Vector3();
  const across = new THREE.Vector3();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tanAngle = Math.tan(HEADLAMP.angle);

  /* Where the beam first meets the snow: geometric strides out to the
     lamp's reach, then a bisection inside the stride that crossed. */
  function march(height) {
    let prev = 0;
    let step = HEADLAMP.marchStep;
    for (let t = step; t <= HEADLAMP.reach; t += step) {
      p.copy(origin).addScaledVector(direction, t);
      if (p.y <= height(p.x, p.z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) * 0.5;
          p.copy(origin).addScaledVector(direction, mid);
          if (p.y <= height(p.x, p.z)) hi = mid; else lo = mid;
        }
        return hi;
      }
      prev = t;
      step *= HEADLAMP.marchGrow;
    }
    return -1;
  }

  function drawBeam(camera, rider, length, height) {
    p.copy(origin).addScaledVector(direction, length * 0.5);
    toLens.subVectors(camera.position, p);
    side.crossVectors(direction, toLens);
    if (side.lengthSq() < 1e-8) side.copy(rider.right);
    side.normalize();
    const pos = beam.geometry.attributes.position;
    const clear = beam.geometry.attributes.aClear;
    for (let i = 0; i <= BEAM_SEG; i++) {
      const at = (i / BEAM_SEG) * length;
      const half = 0.03 + at * tanAngle;
      for (let c = 0; c < 3; c++) {
        p.copy(origin).addScaledVector(direction, at).addScaledVector(side, half * (c - 1));
        pos.setXYZ(i * 3 + c, p.x, p.y, p.z);
        clear.setX(i * 3 + c, p.y - height(p.x, p.z));
      }
    }
    pos.needsUpdate = true;
    clear.needsUpdate = true;
  }

  /* The fan over the snow, out along the beam's heading and draped vertex
     by vertex, with the snow's normal taken from the draped neighbours. */
  function drawPool(height) {
    forward.set(direction.x, 0, direction.z);
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    const pos = poolGeo.attributes.position;
    const nrm = poolGeo.attributes.normal;
    for (let i = 0; i < POOL_ROWS; i++) {
      const d = POOL_NEAR * (POOL_FAR / POOL_NEAR) ** (i / (POOL_ROWS - 1));
      for (let j = 0; j < POOL_COLS; j++) {
        const phi = POOL_SPREAD * (2 * j / (POOL_COLS - 1) - 1);
        const c = Math.cos(phi) * d;
        const s = Math.sin(phi) * d;
        const x = origin.x + forward.x * c - forward.z * s;
        const z = origin.z + forward.z * c + forward.x * s;
        pos.setXYZ(i * POOL_COLS + j, x, height(x, z) + POOL_LIFT, z);
      }
    }
    for (let i = 0; i < POOL_ROWS; i++) {
      const up = Math.min(i + 1, POOL_ROWS - 1) * POOL_COLS;
      const down = Math.max(i - 1, 0) * POOL_COLS;
      for (let j = 0; j < POOL_COLS; j++) {
        const right = i * POOL_COLS + Math.min(j + 1, POOL_COLS - 1);
        const left = i * POOL_COLS + Math.max(j - 1, 0);
        along.fromBufferAttribute(pos, up + j).sub(p.fromBufferAttribute(pos, down + j));
        across.fromBufferAttribute(pos, right).sub(p.fromBufferAttribute(pos, left));
        n.crossVectors(across, along).normalize();
        nrm.setXYZ(i * POOL_COLS + j, n.x, n.y, n.z);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  function update(weather, dt, rider, camera) {
    const night = smooth01((weather.night - HEADLAMP.nightFrom)
      / (HEADLAMP.nightFull - HEADLAMP.nightFrom));
    level = approach(level, night, night > level ? HEADLAMP.fadeIn : HEADLAMP.fadeOut, dt);
    if (level < 0.002) {
      distance = -1;
      displayedDistance = 0;
      uniforms.uLamp.value.w = 0;
      rig.visible = false;
      beam.visible = false;
      pool.visible = false;
      return;
    }

    aim.getWorldPosition(origin);
    // Along the snow in the direction of travel (where the board points
    // when there is too little travel to read), then dropped below it.
    travel.set(rider.vel.x, 0, rider.vel.z);
    if (travel.lengthSq() < 4) travel.set(rider.heading.x, 0, rider.heading.z);
    if (travel.lengthSq() < 1e-8) travel.set(0, 0, -1);
    travel.normalize();
    const ground = rider.normal;
    travel.addScaledVector(ground, -travel.dot(ground)).normalize();
    want.copy(travel).multiplyScalar(Math.cos(HEADLAMP.drop))
      .addScaledVector(ground, -Math.sin(HEADLAMP.drop)).normalize();
    direction.lerp(want, 1 - Math.exp(-10 * Math.min(dt, 0.05))).normalize();
    uniforms.uLamp.value.set(origin.x, origin.y, origin.z, level);
    uniforms.uLampDir.value.set(direction.x, direction.y, direction.z, HEADLAMP.angle);

    const height = rider.world.height;
    distance = march(height);
    const reach = distance > 0 ? distance : HEADLAMP.reach;
    displayedDistance = displayedDistance > 0
      ? approach(displayedDistance, reach, HEADLAMP.hitTrack, dt) : reach;

    rig.visible = true;
    beam.visible = true;
    pool.visible = true;
    drawBeam(camera, rider, Math.min(HEADLAMP.reach, displayedDistance * HEADLAMP.overshoot), height);
    // Falling snow is what makes a beam visible at all: faint in clear air,
    // a solid shaft in a blizzard.
    beamMat.uniforms.uStrength.value = HEADLAMP.beamStrength * level
      * (0.6 + 1.4 * Math.min(1, weather.snow));
    drawPool(height);
    added.material.uniforms.uStrength.value = HEADLAMP.poolAdd * level;
    multiplied.material.uniforms.uStrength.value = HEADLAMP.poolMul * level;

    // Helmet-forward is local +X: the glint shows only to a lens in front.
    forward.set(1, 0, 0).transformDirection(aim.matrixWorld);
    toLens.subVectors(camera.position, origin).normalize();
    glint.material.opacity = level * smooth01((toLens.dot(forward) - 0.1) / 0.6);
  }

  function reset() {
    distance = -1;
    displayedDistance = 0;
  }

  return {
    rig,
    beam,
    pool,
    uniforms,
    update,
    reset,
    get level() { return level; },
    get origin() { return origin; },
    get direction() { return direction; },
    debug: () => ({
      level,
      hit: distance > 0,
      distance,
      displayedDistance,
      origin: origin.toArray(),
      direction: direction.toArray(),
    }),
  };
}
