/* The abyss: a pocket of true dark below the station where the fun section
   lives. The darkness itself is painted by nebula.js; this module is what
   lives in it — bioluminescent medusae pulsing on their own slow clocks,
   marine snow that never stops falling, faint shafts of light from the world
   above, and two small glowing rings standing for the two games. Everything
   down here moves the way water makes things move, which in space it has no
   right to — that wrongness is the homage. */

import * as THREE from 'three';
import { PALETTE, WORLD } from './config.js';
import { glowTexture } from './textures.js';

export function buildAbyss(quality) {
  const group = new THREE.Group();
  const center = new THREE.Vector3(...WORLD.abyss.pos);
  const R = WORLD.abyss.radius;
  group.position.copy(center);
  const glow = glowTexture(64);

  /* ---- Medusae ----------------------------------------------------------- */
  const jellies = [];
  for (let i = 0; i < quality.jellies; i++) {
    const jelly = new THREE.Group();
    const hue = 0.42 + Math.random() * 0.14;     // green-cyan family
    const color = new THREE.Color().setHSL(hue, 1, 0.62);

    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    jelly.add(bell);
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    heart.scale.setScalar(1.9);
    jelly.add(heart);

    // Tentacles: line strips whose points are re-posed every frame
    const tentacles = [];
    for (let k = 0; k < 5; k++) {
      const segs = 11;
      const pos = new Float32Array((segs + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      jelly.add(line);
      tentacles.push({
        geo, pos, segs,
        a: (k / 5) * Math.PI * 2,
        r: 0.5 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const a = Math.random() * Math.PI * 2;
    const r = R * (0.15 + Math.random() * 0.7);
    jelly.position.set(Math.cos(a) * r, (Math.random() - 0.5) * R * 0.9, Math.sin(a) * r);
    const size = 10 + Math.random() * 14;
    jelly.scale.setScalar(size);
    group.add(jelly);
    jellies.push({
      node: jelly, bell, heart, tentacles,
      clock: Math.random() * 10,
      rate: 0.5 + Math.random() * 0.4,
      drift: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5),
      home: jelly.position.clone(),
    });
  }

  /* ---- Marine snow -------------------------------------------------------- */
  const n = quality.snow;
  const snowPos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    snowPos[i * 3] = (Math.random() - 0.5) * R * 2.4;
    snowPos[i * 3 + 1] = (Math.random() - 0.5) * R * 2.2;
    snowPos[i * 3 + 2] = (Math.random() - 0.5) * R * 2.4;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    map: glow, color: 0x9fd8cc, size: 2.6, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  group.add(snow);

  /* ---- Light shafts from above -------------------------------------------- */
  const shafts = [];
  for (let i = 0; i < 4; i++) {
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(30 + Math.random() * 40, R * 2.4),
      new THREE.MeshBasicMaterial({
        color: 0x2b8078, transparent: true, opacity: 0.05 + Math.random() * 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    shaft.position.set((Math.random() - 0.5) * R * 1.4, R * 0.2, (Math.random() - 0.5) * R * 1.4);
    shaft.rotation.y = Math.random() * Math.PI;
    shaft.rotation.z = (Math.random() - 0.5) * 0.18;
    group.add(shaft);
    shafts.push({ shaft, w: 0.05 + Math.random() * 0.08, phase: Math.random() * 7 });
  }

  /* ---- Two artifacts: the games, as rings of light ------------------------ */
  const artifacts = [];
  for (const [dx, dz, color] of [[-60, 30, PALETTE.mint], [70, -40, PALETTE.yellow]]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.5, 8, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    ring.position.set(dx, -20 + Math.random() * 30, dz);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(34);
    ring.add(halo);
    group.add(ring);
    artifacts.push({ ring, phase: Math.random() * 5 });
  }

  const tmp = new THREE.Vector3();
  let fade = 0;
  return {
    group,
    update(dt, t, camera) {
      // The abyss belongs to the dive. Above it, everything here is out —
      // no shafts across the hero, no medusa photobombing the crew section.
      const target = camera
        ? THREE.MathUtils.smoothstep(-camera.position.y, 120, 320)
        : 1;
      fade += (target - fade) * Math.min(1, dt * 2);
      group.visible = fade > 0.01;
      if (!group.visible) return;

      for (const j of jellies) {
        j.clock += dt * j.rate;
        // The bell swims: a slow contraction, a squashed pulse, a nudge upward
        const pulse = Math.sin(j.clock) * 0.5 + 0.5;
        const squeeze = 1 - Math.pow(pulse, 3) * 0.28;
        j.bell.scale.set(squeeze, 1 + Math.pow(pulse, 3) * 0.35, squeeze);
        j.bell.material.opacity = 0.45 * fade;
        j.heart.material.opacity = (0.5 + pulse * 0.5) * fade;
        j.node.position.addScaledVector(j.drift, dt * (0.4 + pulse));
        // Long leash back to home, so the shoal never disperses
        tmp.copy(j.home).sub(j.node.position);
        j.node.position.addScaledVector(tmp, dt * 0.02);
        j.node.rotation.y += dt * 0.05;

        for (const ten of j.tentacles) {
          const { pos, segs } = ten;
          for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const sway = Math.sin(j.clock * 1.6 - u * 4 + ten.phase) * 0.28 * u;
            pos[s * 3] = Math.cos(ten.a) * (ten.r + sway);
            pos[s * 3 + 1] = -u * (2.4 + Math.sin(j.clock + ten.phase) * 0.4);
            pos[s * 3 + 2] = Math.sin(ten.a) * (ten.r + sway * 0.7);
          }
          ten.geo.attributes.position.needsUpdate = true;
        }
        for (const child of j.node.children) {
          if (child.isLine) child.material.opacity = 0.55 * fade;
        }
      }
      snow.material.opacity = 0.45 * fade;

      // Snow falls; what leaves the bottom returns to the top
      const p = snowGeo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] -= dt * (2.4 + (i % 5));
        p[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.7;
        if (p[i * 3 + 1] < -R * 1.1) p[i * 3 + 1] = R * 1.1;
      }
      snowGeo.attributes.position.needsUpdate = true;

      for (const s of shafts) {
        s.shaft.rotation.z = Math.sin(t * s.w + s.phase) * 0.16;
        s.shaft.material.opacity = (0.045 + (Math.sin(t * 0.3 + s.phase) * 0.5 + 0.5) * 0.05) * fade;
      }
      for (const a of artifacts) {
        a.ring.rotation.x = t * 0.2 + a.phase;
        a.ring.rotation.y = t * 0.13;
        a.ring.material.opacity = 0.8 * fade;
        a.ring.children[0].material.opacity = (0.35 + (Math.sin(t * 0.8 + a.phase) * 0.5 + 0.5) * 0.3) * fade;
      }
    },
  };
}
