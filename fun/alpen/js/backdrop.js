/* THE MOUNTAINS ROUND THE RUN, AS MODELLED.

   The horizon used to be photographs: a clear and a storm panorama and three
   hour plates, relit by the dome shader and swapped as the day turned. A
   photograph is a picture of one light, though, and it was being asked to
   stand in for every hour of a fifteen-minute day — the sun crossed the sky
   and the photographed shadows did not move, the alpenglow was painted on
   whether or not the sun was low, and every plate went soft the moment the
   window was wider than the image.

   So the range is a model now, built in Blender by `tools/blender/backdrop.py`
   at its real size — the eye at 2100 m, the main valley eight kilometres
   ahead, a horn of 4350 m at fifteen, ranges out to forty-eight — and then
   made small: every vertex slid along its own line of sight from the eye
   until it stands between R0 and R1 metres away, inside the far plane and
   just behind the game's own ground. The eye cannot tell, because a point
   moved along the ray through it does not move in the picture. The file's
   vertices are those drawn positions; everything else about them is the real
   landscape's.

   The mesh is the shape the eye sees; the detail is in two maps on the frame
   the range was built on — u the bearing, v the log of the distance — where
   a texel is one patch of real ground: its normal and cavity, and its snow,
   forest and ice. It is lit by the sky's own rig — the key from wherever the
   sun or moon is, the hemisphere fill — through those real normals, so a
   face turns from the light as the sun goes round and the snow goes amber
   only when the sun is low. It shades itself too: each vertex carries the
   height of its horizon on eight bearings, and the sun is behind the land
   whenever it is lower than the horizon on its own bearing (interpolated
   between the two either side). Haze is the real distance's, so the far
   ranges are pale and the near ridges are not; the valleys under the eye
   fill with the same air the game's ground goes into at a kilometre, and the
   range stands up out of it.

   The same program draws it into the sky probe the fog reads (`#define
   SKY_PROBE`, an equirectangular projection in the vertex shader), so a ridge
   of the game's own terrain fading out at a kilometre fades into the
   mountains behind it rather than into empty sky. */

import { parseGlb } from './glb.js';

export const BACKDROP_GLB = new URL('../assets/models/backdrop/alps.glb', import.meta.url).href;
export const BACKDROP_SHAPE = new URL('../assets/textures/backdrop/alps-shape.webp', import.meta.url).href;
export const BACKDROP_COVER = new URL('../assets/textures/backdrop/alps-cover.webp', import.meta.url).href;

/* The frame the file was built in. `backdrop.py` writes the same numbers to
   every node's extras and the model check holds the two to each other. */
export const BACKDROP = {
  distance: [2400, 48000],
  radius: [1650, 2800],
  horizons: 8,
  horizonMax: 50,
};

const TAU = Math.PI * 2;
const LND = Math.log(BACKDROP.distance[1] / BACKDROP.distance[0]);
const RSPAN = BACKDROP.radius[1] - BACKDROP.radius[0];
const SKYLINE_BINS = 720;

/* The real distance a drawn radius stands for. */
export function backdropDistance(r) {
  return BACKDROP.distance[0] * Math.exp((r - BACKDROP.radius[0]) / RSPAN * LND);
}

/* One sector's geometry, from the file's primitive. Positions are drawn
   positions; the horizons are normalised bytes — see backdrop.py. */
export function backdropGeometry(THREE, prim) {
  const a = prim.attributes;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.POSITION, 3));
  g.setAttribute('aHorizonA', new THREE.BufferAttribute(a._HORIZON_A, 4, true));
  g.setAttribute('aHorizonB', new THREE.BufferAttribute(a._HORIZON_B, 4, true));
  g.setIndex(new THREE.BufferAttribute(prim.index, 1));
  g.computeBoundingSphere();
  // the piste's wander moves the near ground by up to a hundred metres in
  // the vertex shader (see uLateral), which the culling has to allow for
  g.boundingSphere.radius += 160;
  return g;
}

/* The skyline, as the elevation of the highest vertex on every half degree
   of bearing (dilated by a bin each way, so the line between two vertices
   is never under the table). Bearings are the sun's: from straight down the
   run (-z) towards +x. Used to set the sun behind the peaks. */
export function backdropSkyline(nodes, bins = SKYLINE_BINS) {
  const raw = new Float32Array(bins).fill(-Math.PI / 2);
  for (const node of Object.values(nodes)) {
    for (const prim of node.prims) {
      const p = prim.attributes.POSITION;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i];
        const y = p[i + 1];
        const z = p[i + 2];
        let b = Math.atan2(x, -z);
        if (b < 0) b += TAU;
        const k = Math.min(bins - 1, Math.floor((b / TAU) * bins));
        const e = Math.atan2(y, Math.hypot(x, z));
        if (e > raw[k]) raw[k] = e;
      }
    }
  }
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    out[k] = Math.max(raw[(k + bins - 1) % bins], raw[k], raw[(k + 1) % bins]);
  }
  return out;
}

export function skylineAt(table, bearing) {
  const n = table.length;
  let u = (bearing / TAU) * n;
  u -= Math.floor(u / n) * n;
  const i = Math.floor(u);
  const t = u - i;
  return table[i % n] * (1 - t) + table[(i + 1) % n] * t;
}

/* Where the probe's panorama puts a direction: u is the azimuth from -x
   towards +z over a whole turn (shading.js#n64Sky), so a sector is drawn
   near the u of its own middle bearing. */
function probeU(bearing) {
  const x = Math.sin(bearing);
  const z = -Math.cos(bearing);
  const u = Math.atan2(z, -x) / TAU;
  return u - Math.floor(u);
}

const HORIZON_RAD = (BACKDROP.horizonMax * Math.PI) / 180;

const BACKDROP_VERT = `
  attribute vec4 aHorizonA;
  attribute vec4 aHorizonB;
  uniform float uLateral;
  uniform float uShear;
  uniform vec4 uSunA;
  uniform vec4 uSunB;
#ifdef SKY_PROBE
  uniform float uRef;
#endif
  varying float vAO;
  varying float vSunHorizon;
  varying highp vec3 vReal;
  varying highp vec3 vDir;
  varying highp float vDist;
  void main() {
    float r = length(position.xz);
    float d = ${BACKDROP.distance[0].toFixed(1)} * exp((r - ${BACKDROP.radius[0].toFixed(1)})
      / ${RSPAN.toFixed(1)} * ${LND.toFixed(6)});
    vec3 p = position;
    /* The piste's wander, as real parallax: a step sideways of L metres
       turns a point d away by L/d, which at the radius it is drawn at is
       L·r/d. The near ridges slide across the far ones. */
    p.x -= uLateral * r / d;
    /* And the near ground follows the run down. The model's own shoulder
       falls away at a fixed grade, but the run's pitch changes by the
       chapter; where it is steeper the game's ground drops below the
       shoulder's foot and the eye looked down past its end into nothing
       but haze. So the first few kilometres are swung down (or up) about
       the eye until their foot meets the ground's far edge, easing back to
       the model's true elevations by the valley floor. */
    p.y -= r * uShear * (1.0 - smoothstep(${BACKDROP.distance[0].toFixed(1)}, 9000.0, d));
    vReal = position * (d / r);
    vDist = d;
    vDir = p;
    // The horizon on the sun's bearing, between the two baked either side,
    // and the sky the eight of them leave open.
    vSunHorizon = (dot(aHorizonA, uSunA) + dot(aHorizonB, uSunB)) * ${HORIZON_RAD.toFixed(6)};
    vec4 sa = sin(aHorizonA * ${HORIZON_RAD.toFixed(6)});
    vec4 sb = sin(aHorizonB * ${HORIZON_RAD.toFixed(6)});
    vAO = 1.0 - dot(sa + sb, vec4(0.125));
#ifdef SKY_PROBE
    // The panorama the fog reads: u round the ring, kept within half a turn
    // of this sector's own middle so no triangle spans the join; v the
    // elevation; depth the drawn distance, nearest wins.
    float u = atan(p.z, -p.x) * 0.15915494;
    u -= floor(u - uRef + 0.5);
    float len = length(p);
    float v = asin(p.y / len) * 0.31830989 + 0.5;
    gl_Position = vec4(u * 2.0 - 1.0, v * 2.0 - 1.0,
      clamp((len - 1400.0) / 1600.0, 0.0, 1.0) * 2.0 - 1.0, 1.0);
#else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
#endif
  }
`;

const BACKDROP_FRAG = `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uKeyLight, uSkyFill, uGroundFill, uAlpenglow;
  uniform vec3 uSnow, uRockCool, uRockWarm, uIce, uForest;
  uniform vec3 uHaze, uAir, uGlow;
  uniform float uGlowStrength;
  uniform float uCurtain;
  uniform float uClarity;
  uniform float uValley;
  uniform float uSea;
  uniform float uSeaTop;
  uniform vec2 uSeaDrift;
  uniform float uWhiteout;
  uniform sampler2D uNoise;
  uniform sampler2D uRockDetail;
  uniform sampler2D uShape;
  uniform sampler2D uCover;
  varying float vAO;
  varying float vSunHorizon;
  varying highp vec3 vReal;
  varying highp vec3 vDir;
  varying highp float vDist;
  void main() {
    vec3 dir = normalize(vDir);
    /* The maps, on the frame the range was built in: u the bearing, v the
       log of the distance. Their gradients are taken with the bearing's
       jump behind the eye removed, so the mip choice never sees it. */
    vec2 mapUv = vec2(atan(vReal.x, -vReal.z) * 0.15915494,
      log(vDist / ${BACKDROP.distance[0].toFixed(1)}) / ${LND.toFixed(6)});
    vec2 gx = dFdx(mapUv);
    vec2 gy = dFdy(mapUv);
    gx.x -= floor(gx.x + 0.5);
    gy.x -= floor(gy.x + 0.5);
    vec3 shape = textureGrad(uShape, mapUv, gx, gy).rgb;
    vec3 cover = textureGrad(uCover, mapUv, gx, gy).rgb;
    vec2 nxz = shape.rg * 2.0 - 1.0;
    vec3 n = vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y);
    float cavity = shape.b;

    /* Detail finer than the maps, at the real landscape's scale: a slow
       field for the rock's tone, a fast one and a fine one for grain, and
       the granite strata on the rock, projected three ways so the cliffs
       are not smeared — at two scales turned against each other, because
       one photograph repeating every couple of hundred metres is a pattern
       the eye finds at once on a slope a few kilometres off. */
    vec3 slow = texture2D(uNoise, vReal.xz / 2300.0).rgb;
    vec3 fast = texture2D(uNoise, vReal.xz / 160.0 + vec2(0.37, 0.11)).rgb;
    float fine = texture2D(uNoise, mat2(0.8, -0.6, 0.6, 0.8) * vReal.xz / 47.0 + vec2(0.71, 0.23)).g;
    /* …and all of it only near. A field that repeats every fifty or two
       hundred metres is texture on a slope two kilometres off and a woven
       pattern on one ten kilometres off, where a real forest or rock face
       has no grain left at all, only tone — which the maps carry. */
    float near = 1.0 - smoothstep(2600.0, 7000.0, vDist);
    float mid = 1.0 - smoothstep(5000.0, 16000.0, vDist);
    fast = mix(vec3(0.5), fast, mid);
    fine = mix(0.5, fine, near);
    vec3 an = abs(n) + 0.001;
    vec3 q = vReal / 230.0;
    vec3 r = vec3(0.8 * vReal.x - 0.6 * vReal.z, vReal.y, 0.6 * vReal.x + 0.8 * vReal.z) / 61.0;
    vec3 strata = ((texture2D(uRockDetail, q.zy).rgb + texture2D(uRockDetail, r.zy + 0.31).rgb) * an.x
      + (texture2D(uRockDetail, q.xz).rgb + texture2D(uRockDetail, r.xz + 0.53).rgb) * an.y
      + (texture2D(uRockDetail, q.xy).rgb + texture2D(uRockDetail, r.xy + 0.17).rgb) * an.z)
      / (2.0 * (an.x + an.y + an.z));
    strata = mix(vec3(0.42), strata, mid);
    float grain = dot(strata, vec3(0.2126, 0.7152, 0.0722));

    /* The cover's edges are cut by those fields at their own scale, not by
       the map's texels: magnified on the near ground a texel of the map is
       ten metres, and a hard threshold on it drew the snow line as a
       staircase. */
    float wob = (fast.r - 0.5) * 0.32 + (fine - 0.5) * 0.36;
    float snow = smoothstep(0.18, 0.82, cover.r + wob);
    float forest = smoothstep(0.18, 0.82, cover.g - wob);
    float ice = smoothstep(0.25, 0.75, cover.b + wob * 0.5);
    float total = snow + forest + ice;
    if (total > 1.0) { snow /= total; forest /= total; ice /= total; }
    float rock = clamp(1.0 - snow - forest - ice, 0.0, 1.0);

    vec3 rockColor = mix(uRockCool, uRockWarm, slow.r) * (0.6 + 0.9 * grain);
    /* A forest in January: dark crowns, a little snow lying between them.
       A little: snow is forty times brighter than a spruce crown, so a
       third of it was enough to turn a whole forest belt mid-grey. */
    float crowns = smoothstep(0.3, 0.7, fine + (fast.g - 0.5) * 0.5);
    vec3 forestColor = mix(uForest, uSnow * 0.8, 0.06 + 0.12 * (1.0 - crowns));
    vec3 albedo = uSnow * snow + forestColor * forest + uIce * ice + rockColor * rock;

    // and the strata tilt the light on the rock
    n = normalize(n + vec3(strata.r - 0.5, 0.0, strata.g - 0.5) * 0.25 * rock);

    /* The key, and whether the land round this point hides it: the sun's
       elevation against the horizon on its bearing, softened by a degree
       either side for the sun's own size and the table's coarseness. */
    float sunElev = asin(clamp(uSunDir.y, -1.0, 1.0));
    float lit = smoothstep(vSunHorizon - 0.012, vSunHorizon + 0.022, sunElev);
    float direct = max(0.0, dot(n, uSunDir)) * lit;
    /* The fill is the sky's, blue, with only a little of the snow's bounce:
       a face in shadow a few kilometres off is lit by the sky over it, and
       that is what turns shaded snow blue against sunlit snow. */
    /* Snow in shade at altitude is blue and still bright: the sky over it
       is most of its light. So the occlusion takes only a little away, and
       the fill is the sky's colour pushed a step further towards blue. */
    float open = clamp(vAO * (0.55 + 0.9 * cavity), 0.0, 1.0);
    vec3 fill = mix(uGroundFill * 0.55, uSkyFill, 0.5 + 0.5 * n.y) * (0.52 + 0.4 * open)
      * vec3(0.78, 0.90, 1.14);
    vec3 c = albedo * (fill + uKeyLight * direct * 1.1) * 0.3183099;
    // the alpenglow is light arriving on snow, and it is added
    c += uAlpenglow * direct * (snow + ice);

    /* THE SEA OF CLOUD. On a settled morning the cold air lies in the
       valleys and fills them to a level, and the ridges stand out of it as
       islands — the Nebelmeer, the best view the Alps have. It is a level a
       few hundred metres under the eye, its top heaped into soft rolls by
       the noise field and drifting on the wind, lit like a snowfield from
       above: white where the sun is on it, blue in the hollows between the
       rolls. Anything of the range under that level is under the cloud. */
    if (uSea > 0.002) {
      vec2 sp = vReal.xz / 2600.0 + uSeaDrift;
      float roll = texture2D(uNoise, sp).r * 0.65 + texture2D(uNoise, sp * 3.1 + 0.37).g * 0.35;
      float top = uSeaTop + (roll - 0.5) * 140.0;
      float under = smoothstep(top + 25.0, top - 35.0, vReal.y);
      if (under > 0.0) {
        // the rolls' own slope, from the field, lights them like dunes
        float e = 0.012;
        float rx = texture2D(uNoise, sp + vec2(e, 0.0)).r - texture2D(uNoise, sp - vec2(e, 0.0)).r;
        float rz = texture2D(uNoise, sp + vec2(0.0, e)).r - texture2D(uNoise, sp - vec2(0.0, e)).r;
        vec3 cn = normalize(vec3(-rx * 2.2, 1.0, -rz * 2.2));
        float sunOn = max(0.0, dot(cn, uSunDir) + 0.25) / 1.25;
        vec3 cloudLight = uSkyFill * (0.75 + 0.25 * cn.y) + uKeyLight * sunOn * 1.15;
        vec3 cloud = vec3(0.95, 0.96, 0.98) * cloudLight * 0.3183099;
        c = mix(c, cloud, under * uSea);
      }
    }

    /* Aerial perspective, at the real distance. The air between is lit by
       the sky, and forward-scatters the sun, so the haze towards the sun is
       bright and warm and the haze away from it is blue. Denser over the
       valley floors than over the summits. */
    float sunward = max(0.0, dot(dir, uSunDir));
    vec3 air = uAir + uGlow * (pow(sunward, 6.0) * 0.42 + pow(sunward, 2.0) * 0.08) * uGlowStrength;
    float thick = exp(-max(0.0, vReal.y + 900.0) / 1800.0) * 0.75 + 0.25;
    float through = exp(-vDist * thick / uClarity);
    c = mix(air, c, through);

    /* The air in the valleys: denser low down, so the valley floors are
       hazed more than the slopes over them, and the range stands up out of
       it. (The game's own fogged ground beyond a kilometre takes its colour
       from this, through the sky probe, so the two meet without a seam.) */
    c = mix(c, mix(uHaze, air, 0.5), smoothstep(150.0, -950.0, vReal.y) * uValley);

    // and its foot stands on the curtain the game's ground ends in
    float elevation = vDir.y / length(vDir.xz);
    c = mix(uHaze, c, smoothstep(uCurtain - 0.004, uCurtain + 0.05, elevation));
    c = mix(c, uHaze, uWhiteout);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/* The model in the scene: `group` for the frame, `probeGroup` for the sky
   probe's scene, both empty until the file arrives. `ready` settles either
   way; `loaded` says which. `skyline(bearing)` is the elevation of the
   ridge on a bearing, or -π/2 before (or without) the model. */
export function createBackdrop(THREE, { sunDir, noise, rockDetail }) {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const probeGroup = new THREE.Group();
  const uniforms = {
    uLateral: { value: 0 },
    uSunA: { value: new THREE.Vector4() },
    uSunB: { value: new THREE.Vector4() },
    uSunDir: { value: sunDir },
    uKeyLight: { value: new THREE.Color(0, 0, 0) },
    uSkyFill: { value: new THREE.Color(0.4, 0.45, 0.5) },
    uGroundFill: { value: new THREE.Color(0.4, 0.45, 0.5) },
    uAlpenglow: { value: new THREE.Color(0, 0, 0) },
    // Albedos, not lit colours: the light arrives in the three above.
    uSnow: { value: new THREE.Color('#e9eff7') },
    uRockCool: { value: new THREE.Color('#3d3f45') },
    uRockWarm: { value: new THREE.Color('#4f4844') },
    uIce: { value: new THREE.Color('#c9dbe8') },
    uForest: { value: new THREE.Color('#121c1c') },
    uHaze: { value: new THREE.Color('#d7e2ec') },
    uAir: { value: new THREE.Color('#c9d8ea') },
    uGlow: { value: new THREE.Color('#ffeccc') },
    uGlowStrength: { value: 1 },
    uCurtain: { value: -0.2 },
    uClarity: { value: 26000 },
    uValley: { value: 0.5 },
    uSea: { value: 0 },
    uSeaTop: { value: -560 },
    uSeaDrift: { value: new THREE.Vector2() },
    uShear: { value: 0 },
    uWhiteout: { value: 0 },
    uNoise: { value: noise },
    uRockDetail: rockDetail,
    uShape: { value: null },
    uCover: { value: null },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BACKDROP_VERT,
    fragmentShader: BACKDROP_FRAG,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
    fog: false,
  });
  let table = null;
  let loaded = false;
  let settle = null;
  const ready = new Promise((resolve) => { settle = resolve; });

  function adopt(nodes) {
    const names = Object.keys(nodes).filter((n) => n.startsWith('range_')).sort();
    if (!names.length) throw new Error('backdrop: no range in the file');
    for (const name of names) {
      const node = nodes[name];
      const geometry = backdropGeometry(THREE, node.prims[0]);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'backdrop-range';
      /* After the terrain (0), before the cone (0.7) and the dome (1): the
         depth buffer is already full of mountain where the ground is near,
         and the haze cone and the dome are then spared every pixel this
         covers. */
      mesh.renderOrder = 0.5;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      const [from, to] = node.extras.bearing;
      const probeMaterial = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uRef: { value: probeU(((from + to) / 2) * Math.PI / 180) } },
        defines: { SKY_PROBE: '' },
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
      });
      const probeMesh = new THREE.Mesh(geometry, probeMaterial);
      probeMesh.frustumCulled = false;
      probeMesh.renderOrder = 1;
      probeGroup.add(probeMesh);
    }
    table = backdropSkyline(nodes);
    loaded = true;
  }

  /* The maps are data — normals and fractions — so no colour space, and
     mipmapped and anisotropic, because the far ranges are nothing but
     minification. */
  const map = (url) => new Promise((resolve, reject) => new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    resolve(t);
  }, undefined, reject));

  /* All three files or none: the model without its maps would be drawn
     with no normals at all. */
  function load(fetcher = globalThis.fetch) {
    if (typeof fetcher !== 'function') {
      settle(false);
      return ready;
    }
    Promise.all([
      fetcher(BACKDROP_GLB)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`backdrop: ${res.status}`))))
        .then(parseGlb),
      map(BACKDROP_SHAPE),
      map(BACKDROP_COVER),
    ]).then(([nodes, shape, cover]) => {
      uniforms.uShape.value = shape;
      uniforms.uCover.value = cover;
      adopt(nodes);
      settle(true);
    }).catch((err) => {
      console.warn('Alpen: keeping the procedural ranges —', err ?? 'a map did not load');
      settle(false);
    });
    return ready;
  }

  /* The eight horizons' weights for a sun on `bearing`: the two either side
     of it, shared linearly. */
  function setSun(bearing) {
    const n = BACKDROP.horizons;
    let f = (bearing / TAU) * n;
    f -= Math.floor(f / n) * n;
    const i = Math.floor(f) % n;
    const t = f - Math.floor(f);
    const w = new Float32Array(8);
    w[i] = 1 - t;
    w[(i + 1) % n] += t;
    uniforms.uSunA.value.set(w[0], w[1], w[2], w[3]);
    uniforms.uSunB.value.set(w[4], w[5], w[6], w[7]);
  }

  return {
    group,
    probeGroup,
    uniforms,
    ready,
    load,
    adopt,
    setSun,
    get loaded() { return loaded; },
    skyline: (bearing) => (table ? skylineAt(table, bearing) : -Math.PI / 2),
  };
}
