/* Sky, sun, horizon and light — all of it driven by the weather.

   Everything here is at infinity: the whole group is moved to the rider each
   frame and never rotated, so it has parallax with nothing and reads as
   distance. Nothing is baked, because the sky changes all day; every colour
   is a uniform the weather writes each frame, which is also why a full day
   cycle costs no geometry work at all.

   Five pieces, in the order the eye finds them.

   The dome is a three-stop gradient with a warm lobe around whatever is
   currently lighting the sky. That lobe is the cheapest atmosphere in
   graphics: one dot product, and it is most of the difference between a
   painted gradient and a sky with a sun somewhere in it.

   The stars sit just inside the dome and fade in with the night. They are
   the one thing a storm can take away completely.

   The haze cone is the quiet one and the most important. Past the fog
   distance the hill is gone, but its mesh has to stop somewhere, and a
   frustum wide enough to hide that edge at the horizon would cost more
   vertices than the rest of the game put together. So a cone of exactly the
   fog's colour, at exactly the hill's average pitch, is drawn under
   everything. Inside the fog it is hidden by real ground; outside it, it
   *is* the ground, and the seam cannot be seen because both are the same
   number.

   The ranges are three rings of silhouette, each fading to the haze colour
   at its base, so mountains rise out of the curtain instead of standing in
   front of it. They are drawn without fog, because they are already painted
   as though they had it.

   And the light is two lamps: a key from wherever the sun or moon is, and a
   sky-to-snow hemisphere that fills the shadows. Snow is one colour over the
   entire screen; that fill is what stops it reading as a blank page. */

import { snoise2 } from './noise.js';
import { TERRAIN } from './config.js';

const RADIUS = 2900;

const DOME_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = `
  precision mediump float;
  uniform vec3 uZenith, uMid, uHorizon, uGlow, uSunDir;
  uniform float uGlowStrength;
  varying vec3 vDir;
  void main() {
    float up = vDir.y;
    vec3 c = mix(
      mix(uHorizon, uMid, smoothstep(-0.06, 0.30, up)),
      uZenith,
      smoothstep(0.26, 0.90, up)
    );
    // One dot product of atmosphere: the sky is brighter and warmer near
    // whatever is lighting it, and the effect is strongest at the horizon
    float lobe = max(0.0, dot(vDir, uSunDir));
    c += uGlow * (pow(lobe, 7.0) * 0.85 + pow(lobe, 2.0) * 0.14)
       * uGlowStrength * (1.0 - smoothstep(0.1, 0.75, up) * 0.55);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const STAR_VERT = `
  attribute float aSize;
  attribute float aTwinkle;
  varying float vFade;
  uniform float uAlpha;
  uniform float uTime;
  void main() {
    vFade = uAlpha * (0.55 + 0.45 * sin(uTime * 1.7 + aTwinkle * 40.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const STAR_FRAG = `
  precision mediump float;
  varying float vFade;
  void main() {
    if (vFade <= 0.01) discard;
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, vFade);
  }
`;

const RANGE_VERT = `
  attribute float aMix;
  varying float vMix;
  void main() {
    vMix = aMix;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RANGE_FRAG = `
  precision mediump float;
  uniform vec3 uHaze, uPeak;
  varying float vMix;
  void main() { gl_FragColor = vec4(mix(uHaze, uPeak, vMix), 1.0); }
`;

export function createSky(THREE) {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(0, 0.4, -1).normalize();

  // --- dome ----------------------------------------------------------------
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color('#123a7a') },
      uMid: { value: new THREE.Color('#74a3de') },
      uHorizon: { value: new THREE.Color('#eaf0f8') },
      uGlow: { value: new THREE.Color('#ffeccc') },
      uSunDir: { value: sunDir },
      uGlowStrength: { value: 1 },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 20), domeMat);
  dome.renderOrder = -20;
  group.add(dome);

  // --- stars ---------------------------------------------------------------
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const stars = (() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const twinkle = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Upper hemisphere only, weighted away from the horizon where the
      // haze would have eaten them anyway
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const y = Math.abs(u) * 0.92 + 0.06;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * r * RADIUS * 0.97;
      pos[i * 3 + 1] = y * RADIUS * 0.97;
      pos[i * 3 + 2] = Math.sin(a) * r * RADIUS * 0.97;
      size[i] = 1 + Math.random() * 2.2;
      twinkle[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
    const p = new THREE.Points(g, starMat);
    p.renderOrder = -19;
    p.frustumCulled = false;
    return p;
  })();
  group.add(stars);

  // --- the light in the sky ------------------------------------------------
  const glowTex = (() => {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.66)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.renderOrder = -18;
  group.add(glow);

  const discTex = (() => {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    // Hard-edged, but not aliased: the quantise pass downstream is
    // unforgiving about a stair-stepped circle
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s * 0.46);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTex, transparent: true, depthWrite: false, fog: false,
  }));
  disc.renderOrder = -17;
  group.add(disc);

  // --- the haze the hill dissolves into ------------------------------------
  const coneH = RADIUS * 0.95 * TERRAIN.grade;
  const hazeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(RADIUS * 0.95, coneH, 44, 1, true), hazeMat,
  );
  // The apex sits at the rider, dropped clear of the deepest hollow the
  // noise can dig, so real ground is never undercut by it
  cone.position.y = -16 - coneH / 2;
  cone.renderOrder = -16;
  group.add(cone);

  // --- the ranges ----------------------------------------------------------
  const rangeMats = [];

  function range(radius, height, tint, seed, segments) {
    const pos = new Float32Array(segments * 6 * 3);
    const mix = new Float32Array(segments * 6);
    const base = -radius * TERRAIN.grade - 40;

    const profile = (i) => {
      const a = ((i % segments) / segments) * Math.PI * 2;
      const x = Math.cos(a) * 9;
      const z = Math.sin(a) * 9;
      const h = snoise2(x, z, seed) * 0.55
        + snoise2(x * 2.7, z * 2.7, seed + 1) * 0.3
        + snoise2(x * 6.1, z * 6.1, seed + 2) * 0.15;
      return height * (0.40 + 0.60 * (h * 0.5 + 0.5));
    };

    let p = 0;
    let m = 0;
    const put = (ang, y, k) => {
      pos[p] = Math.cos(ang) * radius;
      pos[p + 1] = y;
      pos[p + 2] = Math.sin(ang) * radius;
      mix[m] = k;
      p += 3;
      m += 1;
    };

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const h0 = profile(i);
      const h1 = profile(i + 1);
      // Every range melts into the curtain at its foot, so nothing ever
      // stands *in front of* the horizon. Snow sits on the tops, so the
      // mix is by height rather than by ring.
      const m0 = Math.min(1, h0 / height);
      const m1 = Math.min(1, h1 / height);
      put(a0, base, 0); put(a1, base + h1, m1); put(a1, base, 0);
      put(a0, base, 0); put(a0, base + h0, m0); put(a1, base + h1, m1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHaze: { value: new THREE.Color('#e3ecf6') },
        uPeak: { value: new THREE.Color(tint) },
      },
      vertexShader: RANGE_VERT,
      fragmentShader: RANGE_FRAG,
      side: THREE.DoubleSide,
      fog: false,
    });
    rangeMats.push({ mat, tint: new THREE.Color(tint), depth: radius });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -15;
    mesh.frustumCulled = false;
    return mesh;
  }

  group.add(range(2200, 640, '#b6c6dc', 21, 76));
  group.add(range(1750, 540, '#8ea6c8', 33, 64));
  group.add(range(1320, 400, '#6c86ac', 47, 56));

  // --- light ---------------------------------------------------------------
  const lights = new THREE.Group();
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  lights.add(key, key.target);
  const hemi = new THREE.HemisphereLight('#74a3de', '#dfe8f4', 1.35);
  lights.add(hemi);

  const peakTmp = new THREE.Color();
  const fill = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  let time = 0;

  /* The whole sky follows the rider, unrotated, and everything in it is
     re-coloured from the weather. Sixteen uniform writes a frame. */
  function update(pos, w, dt) {
    time += dt;
    group.position.set(pos.x, pos.y, pos.z);
    lights.position.set(pos.x, pos.y, pos.z);

    sunDir.set(
      Math.sin(w.azimuth) * Math.cos(w.elevation),
      Math.sin(w.elevation),
      -Math.cos(w.azimuth) * Math.cos(w.elevation),
    ).normalize();

    domeMat.uniforms.uZenith.value.copy(w.zenith);
    domeMat.uniforms.uMid.value.copy(w.mid);
    domeMat.uniforms.uHorizon.value.copy(w.horizon);
    domeMat.uniforms.uGlow.value.copy(w.glow);
    domeMat.uniforms.uGlowStrength.value = 1 - w.storm * 0.8;

    starMat.uniforms.uAlpha.value = w.star * (1 - w.storm) * 0.9;
    starMat.uniforms.uTime.value = time;

    // Sun by day, moon by night: the same disc, smaller and cooler, and a
    // glow that a storm can smother entirely
    const moon = w.moon;
    disc.position.copy(sunDir).multiplyScalar(RADIUS * 0.85);
    disc.scale.setScalar(RADIUS * (0.085 - moon * 0.032));
    disc.material.color.copy(w.key);
    disc.material.opacity = (1 - w.storm) * (0.55 + 0.45 * (1 - moon));
    disc.visible = w.elevation > -0.02 && w.storm < 0.92;

    // Small and faint. An additive sprite this far out covers a lot of sky
    // for very little scale, and a sun that blows out the middle of the
    // frame takes the mountain with it.
    glow.position.copy(sunDir).multiplyScalar(RADIUS * 0.84);
    glow.scale.setScalar(RADIUS * (0.20 - moon * 0.10));
    glow.material.color.copy(w.glow);
    glow.material.opacity = (1 - w.storm) * (0.5 - moon * 0.28);
    glow.visible = glow.material.opacity > 0.02;

    hazeMat.color.copy(w.haze);
    for (const r of rangeMats) {
      r.mat.uniforms.uHaze.value.copy(w.haze);
      // The ranges are behind a lot of air, and a storm is more air. They
      // give up their colour long before the near hill does.
      peakTmp.copy(r.tint).lerp(w.haze, w.storm * 0.85);
      // and they take the sky's own tint, so a dusk range is a dusk colour
      peakTmp.lerp(w.mid, 0.28);
      r.mat.uniforms.uPeak.value.copy(peakTmp);
    }

    key.position.copy(sunDir).multiplyScalar(520);
    key.target.position.set(0, 0, 0);
    key.color.copy(w.key);
    key.intensity = w.keyI;
    // The fill takes the sky's hue but not its saturation. Snow bounce is
    // pale; lighting a whole mountain with undiluted #6f9ad6 turns every
    // surface the sun is not on into flat blue paper.
    fill.copy(w.mid).lerp(WHITE, 0.5);
    hemi.color.copy(fill);
    fill.copy(w.haze).lerp(WHITE, 0.35);
    hemi.groundColor.copy(fill);
    hemi.intensity = w.hemiI;
  }

  return { group, lights, sunDir, update };
}
