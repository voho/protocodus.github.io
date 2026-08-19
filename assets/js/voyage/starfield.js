/* The starfield: thousands of points on three nested shells, twinkling in a
   shader, plus a handful of genuinely bright named-feeling stars with flares
   and one distant sun. The shells are spheres rather than a box so there is
   no direction the camera can face that runs out of sky. */

import * as THREE from 'three';
import { glowTexture, flareTexture } from './textures.js';
import { WORLD } from './config.js';

export function buildStarfield(quality) {
  const group = new THREE.Group();
  const n = quality.stars;

  const pos = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const size = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  const color = new THREE.Color();

  const abyss = new THREE.Vector3(...WORLD.abyss.pos);
  const dir = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    // Three shells, weighted toward the far one so parallax stays subtle
    const shell = Math.random();
    const r = shell < 0.5 ? 2600 + Math.random() * 1800
      : shell < 0.8 ? 1500 + Math.random() * 900
        : 900 + Math.random() * 500;
    dir.randomDirection();
    // The abyss is a hole in the sky: thin the stars behind it so the dark
    // pocket the camera dives into reads as depth rather than paint.
    if (dir.dot(abyss.clone().normalize()) > 0.86 && Math.random() < 0.8) {
      dir.randomDirection();
    }
    pos[i * 3] = dir.x * r;
    pos[i * 3 + 1] = dir.y * r;
    pos[i * 3 + 2] = dir.z * r;
    phase[i] = Math.random() * Math.PI * 2;
    size[i] = 1.7 + Math.pow(Math.random(), 3) * 4.6;

    // Real skies are not white: a scatter of warm and cool giants
    const k = Math.random();
    if (k < 0.12) color.setHSL(0.09, 0.65, 0.78);       // amber
    else if (k < 0.24) color.setHSL(0.58, 0.55, 0.8);   // blue
    else if (k < 0.28) color.setHSL(0.45, 0.7, 0.75);   // a mint few, on brand
    else color.setHSL(0.6, 0.08, 0.85);                 // near-white
    tint[i * 3] = color.r;
    tint[i * 3 + 1] = color.g;
    tint[i * 3 + 2] = color.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: glowTexture(64) },
      uDim: { value: 1 },     // warp pulls this down so the streaks own the sky
    },
    vertexShader: /* glsl */`
      attribute float aPhase;
      attribute float aSize;
      attribute vec3 aTint;
      uniform float uTime;
      varying float vTwinkle;
      varying vec3 vTint;
      void main() {
        vTint = aTint;
        // Two incommensurate rates so the twinkle never synchronises
        vTwinkle = 0.72 + 0.28 * sin(uTime * (0.6 + aPhase * 0.23) + aPhase * 7.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1900.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uDim;
      varying float vTwinkle;
      varying vec3 vTint;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        gl_FragColor = vec4(vTint * vTwinkle * uDim, a * vTwinkle * uDim);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;   // one sphere of sky; culling it is never right
  group.add(points);

  // A few heroes with diffraction spikes, hand-placed clear of the station
  const flare = flareTexture();
  const heroes = [
    [1800, 900, -2400, 0xcfe4ff, 90],
    [-2200, -300, -1500, 0xffe9c4, 70],
    [900, 1900, 1500, 0xbfffe9, 60],
    [2400, -700, 800, 0xffffff, 52],
  ];
  for (const [x, y, z, c, s] of heroes) {
    const m = new THREE.SpriteMaterial({
      map: flare, color: c, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(m);
    sp.position.set(x, y, z);
    sp.scale.setScalar(s);
    group.add(sp);
  }

  // The system's sun, far along the light direction, so the glare in shot
  // and the shading on the hull agree about where the light is coming from.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flare, color: 0xfff2d8, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunSprite.position.set(...WORLD.sun.dir).multiplyScalar(4200);
  sunSprite.scale.setScalar(520);
  group.add(sunSprite);

  return {
    group,
    setDim(v) { mat.uniforms.uDim.value = v; },
    update(dt, t) { mat.uniforms.uTime.value = t; },
  };
}
