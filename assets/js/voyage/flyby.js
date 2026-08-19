/* The overture: the moment the boot curtain lifts, a capital ship crosses
   overhead — close enough that its hull fills the top of the frame the way a
   certain 1977 opening shot taught everyone a spaceship should — holds its
   course for a few seconds, then stretches and jumps. It exists for exactly
   one pass and removes itself. */

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { hullTexture, glowTexture } from './textures.js';

export function buildFlyby(scene, camera) {
  const ship = new THREE.Group();
  // A touch of self-light: the pass happens with the sun on the far side,
  // and a silhouette with windows is a monolith, not a ship.
  const hull = new THREE.MeshStandardMaterial({
    map: hullTexture(), color: 0xd7dde4, roughness: 0.5, metalness: 0.45,
    emissive: 0x232933, emissiveIntensity: 0.55,
  });

  // A long wedge: widest at the stern, drawn to a chisel bow
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 15, 130, 4), hull);
  body.rotation.x = Math.PI / 2;
  body.rotation.y = Math.PI / 4;
  body.scale.y = 0.42;
  ship.add(body);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 76), hull);
  keel.position.set(0, -4.5, -18);
  ship.add(keel);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 10), hull);
  tower.position.set(0, 6, -44);
  ship.add(tower);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(13, 2.6, 4), hull);
  bridge.position.set(0, 9.5, -44);
  ship.add(bridge);

  // A belly of lit windows: rows of tiny points, the same trick as the station
  const wn = 220;
  const wpos = new Float32Array(wn * 3);
  for (let i = 0; i < wn; i++) {
    const z = -55 + Math.random() * 110;
    const half = 13 * (1 - (z + 65) / 130) + 1.5;
    wpos[i * 3] = (Math.random() - 0.5) * half * 1.7;
    wpos[i * 3 + 1] = -2.5 - Math.random() * 2.5;
    wpos[i * 3 + 2] = z;
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  ship.add(new THREE.Points(wgeo, new THREE.PointsMaterial({
    map: glowTexture(32), color: 0xcfe4ff, size: 1.3, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })));

  // Three engines, bright enough to read as the thing pushing all this mass
  for (const x of [-7, 0, 7]) {
    const e = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(64), color: PALETTE.engine, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    e.position.set(x * 0.8, -1, -67);
    e.scale.setScalar(13);
    ship.add(e);
  }

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(128), color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flash.scale.setScalar(160);

  scene.add(ship);
  ship.visible = false;

  let t = -1;   // idle until play()
  const DURATION = 9;

  return {
    play() {
      t = 0;
      ship.visible = true;
    },
    update(dt) {
      if (t < 0) return;
      t += dt;
      const u = t / DURATION;
      if (u >= 1) {
        scene.remove(ship);
        t = -1;
        return;
      }
      // The pass: nearly overhead, belly filling the top of the frame, then
      // away toward the station and gone in a stretch of light. Almost all
      // of the motion is depth — that is what keeps the hull on screen long
      // enough to read — and all of it is relative to where the camera
      // actually is, so the shot composes at any viewport. The 1977 opening,
      // done with arithmetic.
      const cam = camera.position;
      const depth = Math.pow(u, 0.8);
      const eased = u < 0.8 ? depth : Math.pow(0.8, 0.8) + (u - 0.8) * (1 + (u - 0.8) * 22);
      ship.position.set(
        cam.x + 4 - u * 46,
        cam.y + 26 - u * 50,
        cam.z + 50 - eased * 820,
      );
      ship.lookAt(ship.position.x - 9, ship.position.y - 9, ship.position.z - 160);
      if (u > 0.8) {
        // The jump: stretch along the course, bloom, gone
        const j = (u - 0.8) / 0.2;
        ship.scale.z = 1 + j * 26;
        if (!flash.parent) {
          flash.position.copy(ship.position);
          scene.add(flash);
        }
        flash.material.opacity = Math.sin(j * Math.PI) * 0.8;
        if (u > 0.98) scene.remove(flash);
      }
    },
  };
}
