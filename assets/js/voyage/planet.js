/* The planet: big enough to own a corner of the sky, close enough that the
   habitat ring section plays out against it. One custom shader does the whole
   performance — day map lit by the same sun the station uses, city lights
   fading in across the terminator, and a blue scattering rim — plus an
   additive back-face shell for the halo, a ring, and one small moon. */

import * as THREE from 'three';
import { planetTexture, cityTexture, ringTexture } from './textures.js';
import { WORLD } from './config.js';

export function buildPlanet() {
  const group = new THREE.Group();
  const { pos, radius } = WORLD.planet;
  group.position.set(...pos);

  const sunDir = new THREE.Vector3(...WORLD.sun.dir).normalize();

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 72, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: planetTexture() },
        uCity: { value: cityTexture() },
        uSun: { value: sunDir },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uDay;
        uniform sampler2D uCity;
        uniform vec3 uSun;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec3 n = normalize(vNormal);
          float ndl = dot(n, uSun);
          // A soft terminator: the eye expects dawn to take a while
          float day = smoothstep(-0.12, 0.28, ndl);
          vec3 ground = texture2D(uDay, vUv).rgb * (0.06 + 0.94 * day);
          // Cities belong to the night, and to the dusk band most of all
          float night = 1.0 - smoothstep(-0.22, 0.05, ndl);
          vec3 lights = texture2D(uCity, vUv).rgb * night * 1.4;
          // Rayleigh-flavoured rim, strongest where the surface grazes the eye
          float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
          vec3 sky = vec3(0.25, 0.55, 0.9) * rim * (0.25 + 0.75 * day);
          gl_FragColor = vec4(ground + lights + sky, 1.0);
        }`,
    }),
  );
  group.add(surface);

  // The halo: the atmosphere seen past the limb, additive and back-facing so
  // it only ever appears as a rind around the disc.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 72, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir } },
      vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec3 n = normalize(vNormal);
          float rim = pow(1.0 - abs(dot(n, normalize(vView))), 3.5);
          float lit = 0.2 + 0.8 * smoothstep(-0.3, 0.4, dot(n, uSun));
          gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * rim * lit, rim * lit);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(halo);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.45, radius * 2.2, 96, 1),
    // A 2D canvas hands its pixels over premultiplied; telling the material
    // so is what keeps the gaps between bands transparent instead of sooty.
    new THREE.MeshBasicMaterial({
      map: ringTexture(),
      transparent: true,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      opacity: 0.5,
    }),
  );
  // RingGeometry maps its texture radially only if the UVs say so; the stock
  // UVs are planar, so rewrite them to (radiusFraction, 0..1).
  {
    const uv = ring.geometry.attributes.uv;
    const p = ring.geometry.attributes.position;
    const inner = radius * 1.45;
    const outer = radius * 2.2;
    for (let i = 0; i < uv.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      uv.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
  }
  ring.rotation.x = Math.PI / 2 - 0.32;
  ring.rotation.y = 0.52;
  group.add(ring);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.14, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 1 }),
  );
  group.add(moon);

  return {
    group,
    update(dt, t) {
      surface.rotation.y = t * 0.004;
      const a = t * 0.021 + 2.2;
      moon.position.set(Math.cos(a) * radius * 2.9, radius * 0.5, Math.sin(a) * radius * 2.9);
    },
  };
}
