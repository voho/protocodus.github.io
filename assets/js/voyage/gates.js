/* Hyperspace gates: a heavy ring, three struts, a rippling mouth, and pylon
   lights chasing around the rim. The mouth idles at a shimmer; when traffic
   transits, flash() drives it bright for half a second and blooms a sprite —
   which is all a jump is, seen from outside. */

import * as THREE from 'three';
import { PALETTE, WORLD } from './config.js';
import { gateTexture, glowTexture, hullTexture } from './textures.js';

export function buildGates() {
  const group = new THREE.Group();
  const gates = [];
  const hull = new THREE.MeshStandardMaterial({
    map: hullTexture(), color: 0xe8edf3, roughness: 0.45, metalness: 0.5,
  });

  for (const def of WORLD.gates) {
    const g = new THREE.Group();
    g.position.set(...def.pos);
    g.rotation.y = def.yaw;
    const R = def.radius;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.07, 10, 56), hull);
    g.add(ring);
    // The working edge, lit from within
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.93, R * 0.012, 6, 56),
      new THREE.MeshBasicMaterial({
        color: PALETTE.mint, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    g.add(rim);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(R * 0.1, R * 0.42, R * 0.08), hull);
      strut.position.set(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, 0);
      strut.rotation.z = a + Math.PI / 2;
      g.add(strut);
    }

    const mouthMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: gateTexture() },
        uTime: { value: 0 },
        uActive: { value: 0 },
        uColor: { value: new THREE.Color(PALETTE.mint) },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uActive;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          // Rings falling inward: the event horizon look, cheaply
          float wave = sin(r * 22.0 - uTime * 3.2) * 0.5 + 0.5;
          float base = texture2D(uMap, vUv).a;
          float glow = base * (0.5 + wave * 0.3) * (1.0 - r * 0.35);
          glow *= 1.0 + uActive * 5.0;
          gl_FragColor = vec4(uColor, glow);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 48), mouthMat);
    g.add(mouth);

    // Pylon lights chasing round the rim
    const pylons = [];
    const dotTex = glowTexture(64);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTex, color: PALETTE.yellow, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      s.scale.setScalar(R * 0.17);
      g.add(s);
      pylons.push({ s, i });
    }

    // The bloom a jump leaves behind
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(128), color: 0xdfffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flash.scale.setScalar(R * 3);
    g.add(flash);

    group.add(g);
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, def.yaw, 0));
    gates.push({
      node: g,
      pos: new THREE.Vector3(...def.pos),
      normal,
      radius: R,
      mouthMat,
      pylons,
      flashSprite: flash,
      flashT: 1,
    });
  }

  return {
    group,
    gates,
    flash(i) { const g = gates[i]; if (g) g.flashT = 0; },
    update(dt, t) {
      for (const g of gates) {
        g.mouthMat.uniforms.uTime.value = t;
        g.flashT = Math.min(1, g.flashT + dt * 2.2);
        const burst = 1 - g.flashT;
        g.mouthMat.uniforms.uActive.value = burst;
        g.flashSprite.material.opacity = burst * 0.9;
        g.flashSprite.scale.setScalar(g.radius * (1.5 + (1 - burst) * 2.5));
        for (const { s, i } of g.pylons) {
          const chase = Math.sin(t * 4 - i * (Math.PI / 4)) * 0.5 + 0.5;
          s.material.opacity = 0.25 + chase * 0.75;
        }
      }
    },
  };
}
