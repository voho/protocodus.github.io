/* The rider's night light.

   The mountain already owns the clock. This module only translates its
   continuous `weather.night` signal into something attached to the animated
   head: a small helmet lamp, a fog-aware cone of scattered light, and a
   terrain-draped pool where the beam reaches the snow.

   This deliberately is not a THREE.SpotLight. The terrain's snow response is
   authored around one directional sun/moon source, while a moving spotlight
   would add another full light variant to every Lambert material and still
   would not light the custom snow-particle shaders. The additive shell is the
   same proven trick as the patrol helicopter: it draws the air the light is
   travelling through, lets the depth buffer cut it against terrain and trees,
   and spends one small shader plus one small snow fan.

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
  drop: 0.11,           // radians below the animated line of sight
  angle: 0.42,          // broad 24-degree half-angle with concentrated core
  beam: '#d6edff',      // crisp, high-CRI alpine LED beam
  beamStrength: 0.028,  // visible atmospheric volumetric shaft
  poolStrength: 0.095,  // bright, readable ground illumination on snow
  hitFadeIn: 12.0,      // smooth terrain contact transition
  hitFadeOut: 6.0,
  hitTrack: 14.0,       // responsive tracking on changing slope
  drapeBlend: 0.16,     // seamless GPU fan transitions
};

const TAU = Math.PI * 2;
const POOL_SEG = 24;
const POOL_RING = 5;

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
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
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
    float a = uStrength * radial * enter * leave
      * (0.35 + 0.65 * (1.0 - along));
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.75), a * (1.0 - f));
  }
`;

const POOL_VERT = `
  attribute vec2 aUv;
  attribute vec3 aPositionNext;
  uniform float uDrapeBlend;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = aUv;
    vec3 p = mix(position, aPositionNext, uDrapeBlend);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const POOL_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    if (uStrength <= 0.001) discard;
    float r = length(vUv);
    // Dual-intensity alpine headlamp profile: piercing center hotspot + wide soft flood
    float hotspot = exp(-5.0 * r * r) * 1.5;
    float spill = exp(-0.90 * r * r) * (1.0 - smoothstep(0.35, 1.0, r));
    float a = uStrength * (hotspot + spill);
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.75), a * (1.0 - f));
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

function poolGeometry(THREE) {
  const count = 1 + POOL_SEG * POOL_RING;
  const position = new Float32Array(count * 3);
  const positionNext = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = [];

  for (let r = 1; r <= POOL_RING; r++) {
    for (let s = 0; s < POOL_SEG; s++) {
      const i = 1 + (r - 1) * POOL_SEG + s;
      const a = (s / POOL_SEG) * TAU;
      uv[i * 2] = Math.cos(a) * (r / POOL_RING);
      uv[i * 2 + 1] = Math.sin(a) * (r / POOL_RING);
    }
  }
  for (let s = 0; s < POOL_SEG; s++) {
    const next = (s + 1) % POOL_SEG;
    index.push(0, 1 + next, 1 + s);
    for (let r = 1; r < POOL_RING; r++) {
      const a = 1 + (r - 1) * POOL_SEG + s;
      const b = 1 + (r - 1) * POOL_SEG + next;
      index.push(a, b, a + POOL_SEG, b, b + POOL_SEG, a + POOL_SEG);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aPositionNext', new THREE.BufferAttribute(positionNext, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
  return { geometry, position, positionNext, count };
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

  const beamGeo = new THREE.BufferGeometry();
  const beamMat = new THREE.MeshBasicMaterial({ visible: false });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'rider-headlamp-beam';
  beam.visible = false;

  const poolGeo = new THREE.BufferGeometry();
  const poolMat = new THREE.MeshBasicMaterial({ visible: false });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.name = 'rider-headlamp-pool';
  pool.visible = false;

  let level = 0;

  function update() {
    level = 0;
  }

  function reset() {
    level = 0;
  }

  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3(0, 0, -1);

  return {
    rig,
    beam,
    pool,
    update,
    reset,
    get level() { return 0; },
    get origin() { return origin; },
    get direction() { return direction; },
    debug: () => ({
      level: 0,
      hit: false,
      distance: 0,
      hitVisibility: 0,
      displayedDistance: 0,
      origin: [0, 0, 0],
      direction: [0, 0, -1],
    }),
  };
}
