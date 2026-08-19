/* Ship traffic. Every vessel lives one loop forever: jump in at a gate, cruise
   a curved lane to a docking cradle — holding pattern if the cradles are full —
   sit a while, slide out, cruise to a gate and jump away. The jumps flash the
   gate, the cruise banks into its curve, and the whole schedule is staggered
   so the sky is never empty and never synchronised.

   Ships are boxes and cones with an engine glow. At the distances involved,
   silhouette and motion are the whole design. */

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { glowTexture } from './textures.js';

const HULL_TINTS = [0xbac2cd, 0x9aa5b2, 0xd0d6df, 0xaab3bf];
const ACCENTS = [PALETTE.mint, PALETTE.yellow, 0xff6a4d];

const STATES = {
  HYPER_IN: 0, CRUISE_IN: 1, HOLD: 2, DOCKING: 3, DWELL: 4,
  UNDOCK: 5, CRUISE_OUT: 6, HYPER_OUT: 7, GONE: 8,
};

let sharedGlow = null;
let hullMats = null;

function materials() {
  if (!hullMats) {
    sharedGlow = glowTexture(64);
    hullMats = HULL_TINTS.map((c) => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.6, metalness: 0.4,
    }));
  }
  return hullMats;
}

/* Ships face +Z when unrotated; the engine sits at -Z. */
function makeShip(rng) {
  const mats = materials();
  const hull = mats[Math.floor(rng() * mats.length)];
  const accent = new THREE.MeshBasicMaterial({ color: ACCENTS[Math.floor(rng() * ACCENTS.length)] });
  const ship = new THREE.Group();
  const kind = rng();

  if (kind < 0.4) {
    // Shuttle: a capsule body with two side pods
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 5, 4, 8), hull);
    body.rotation.x = Math.PI / 2;
    ship.add(body);
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.4, 6), hull);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(s * 2.4, -0.3, -0.5);
      ship.add(pod);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 4), accent);
    stripe.position.set(0, 1.55, 0.4);
    ship.add(stripe);
    ship.userData.size = 8;
  } else if (kind < 0.72) {
    // Hauler: a spine with containers slung under it and a cab up front
    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 14), hull);
    ship.add(spine);
    const boxGeo = new THREE.BoxGeometry(2.6, 2.2, 3.4);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(boxGeo, mats[(i + 1) % mats.length]);
      c.position.set(0, -1.6, 4 - i * 4.2);
      ship.add(c);
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.4), hull);
    cab.position.set(0, 0.4, 7.6);
    ship.add(cab);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.4), accent);
    stripe.position.set(0, 1.5, 7.6);
    ship.add(stripe);
    ship.userData.size = 16;
  } else {
    // Corvette: a wedge with wings — everyone's favourite silhouette
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 4), hull);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.z = Math.PI / 4;
    nose.position.z = 3;
    ship.add(nose);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 5), hull);
    tail.position.z = -2.6;
    ship.add(tail);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 3.2), hull);
      wing.position.set(s * 3.4, 0, -2.4);
      wing.rotation.z = s * -0.24;
      ship.add(wing);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.8), accent);
      tip.position.set(s * 6, s * -1.35 * 0.9, -2.4);
      ship.add(tip);
    }
    ship.userData.size = 11;
  }

  const engine = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedGlow, color: PALETTE.engine, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  engine.position.z = -ship.userData.size / 2 - 0.5;
  engine.scale.setScalar(3.2);
  ship.add(engine);
  // The drive plume: a stretched glow that only shows at speed
  const plume = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedGlow, color: PALETTE.engine, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  plume.center.set(0.5, 1);
  plume.scale.set(1.6, 10, 1);
  plume.position.z = -ship.userData.size / 2 - 1;
  plume.material.rotation = Math.PI;
  ship.add(plume);

  ship.userData.engine = engine;
  ship.userData.plume = plume;
  // Scaled well past "correct": at lane distances a true-scale shuttle is a
  // dead pixel, and traffic that cannot be seen is traffic that is not there.
  const scale = 1.8 + rng() * 1.4;
  ship.scale.setScalar(scale);
  return ship;
}

/* A cruise leg: a Catmull-Rom from A to B with jittered mid points, so no two
   crossings of the same lane trace the same line. */
function lane(from, to, rng, lift = 1) {
  const mid1 = from.clone().lerp(to, 0.35);
  const mid2 = from.clone().lerp(to, 0.7);
  const jitter = (v, amt) => v.add(new THREE.Vector3(
    (rng() - 0.5) * amt, (rng() - 0.5) * amt * lift, (rng() - 0.5) * amt,
  ));
  jitter(mid1, 160);
  jitter(mid2, 120);
  return new THREE.CatmullRomCurve3([from.clone(), mid1, mid2, to.clone()]);
}

export function buildTraffic(quality, docks, gatesApi) {
  const group = new THREE.Group();
  const rng = Math.random;
  const gates = gatesApi.gates;
  const ships = [];

  for (let i = 0; i < quality.traffic; i++) {
    const node = makeShip(rng);
    group.add(node);
    ships.push({
      node,
      state: STATES.GONE,
      // Stagger the first arrivals across the first half minute
      wait: rng() * 24,
      t: 0,
      duration: 1,
      curve: null,
      dock: null,
      gate: 0,
      holdAngle: rng() * Math.PI * 2,
      speedScale: 0.75 + rng() * 0.5,
    });
  }

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const freeDock = () => docks.find((d) => !d.busy);

  const enter = (ship) => {
    ship.gate = Math.floor(rng() * gates.length);
    const gate = gates[ship.gate];
    gatesApi.flash(ship.gate);
    const dock = freeDock();
    const target = dock
      ? dock.pos.clone().add(dock.approach.clone().multiplyScalar(70))
      : new THREE.Vector3(220, 30, 0);
    if (dock) { dock.busy = true; ship.dock = dock; }
    const start = gate.pos.clone().add(gate.normal.clone().multiplyScalar(6));
    ship.curve = lane(start, target, rng);
    ship.state = STATES.CRUISE_IN;
    ship.t = 0;
    ship.duration = (14 + rng() * 8) / ship.speedScale;
    ship.node.visible = true;
    // Arrive stretched by the jump, settle over the first moments
    ship.node.scale.z = ship.node.scale.x * 14;
    ship.stretch = 1;
  };

  const leave = (ship) => {
    ship.gate = Math.floor(rng() * gates.length);
    const gate = gates[ship.gate];
    const start = ship.node.position.clone();
    const target = gate.pos.clone().add(gate.normal.clone().multiplyScalar(4));
    ship.curve = lane(start, target, rng);
    ship.state = STATES.CRUISE_OUT;
    ship.t = 0;
    ship.duration = (13 + rng() * 7) / ship.speedScale;
  };

  const setPose = (ship, u) => {
    const { curve, node } = ship;
    curve.getPoint(u, tmp);
    curve.getPoint(Math.min(1, u + 0.012), tmp2);
    node.position.copy(tmp);
    if (tmp2.distanceToSquared(tmp) > 0.0001) {
      node.lookAt(tmp2);
      // Bank into the turn: roll by how hard the tangent is swinging
      const t1 = curve.getTangent(Math.max(0, u - 0.02));
      const t2 = curve.getTangent(Math.min(1, u + 0.02));
      const swing = t1.cross(t2).dot(up);
      node.rotateZ(THREE.MathUtils.clamp(swing * 30, -0.7, 0.7));
    }
  };

  return {
    group,
    update(dt, t) {
      for (const ship of ships) {
        const { node } = ship;
        // Recover from a jump's stretch wherever the ship is
        if (ship.stretch > 0) {
          ship.stretch = Math.max(0, ship.stretch - dt * 2.4);
          node.scale.z = node.scale.x * (1 + 13 * ship.stretch);
        }

        switch (ship.state) {
          case STATES.GONE:
            ship.wait -= dt;
            node.visible = false;
            if (ship.wait <= 0) enter(ship);
            break;

          case STATES.CRUISE_IN:
          case STATES.CRUISE_OUT: {
            ship.t += dt / ship.duration;
            const u = THREE.MathUtils.smoothstep(Math.min(ship.t, 1), 0, 1);
            setPose(ship, u);
            const speed = Math.sin(Math.min(ship.t, 1) * Math.PI);
            ship.node.userData.plume.material.opacity = speed * 0.55;
            ship.node.userData.engine.material.opacity = 0.4 + speed * 0.6;
            if (ship.t >= 1) {
              if (ship.state === STATES.CRUISE_IN) {
                if (ship.dock) {
                  ship.state = STATES.DOCKING;
                  ship.t = 0;
                } else {
                  ship.state = STATES.HOLD;
                  ship.t = 8 + rng() * 10;
                }
              } else {
                // Through the gate and gone
                gatesApi.flash(ship.gate);
                ship.state = STATES.HYPER_OUT;
                ship.t = 0;
              }
            }
            break;
          }

          case STATES.HOLD: {
            // Race-track pattern round the station until a cradle frees up
            ship.holdAngle += dt * 0.12;
            node.position.set(
              Math.cos(ship.holdAngle) * 230,
              30 + Math.sin(ship.holdAngle * 2) * 12,
              Math.sin(ship.holdAngle) * 230,
            );
            tmp.set(
              Math.cos(ship.holdAngle + 0.05) * 230,
              30 + Math.sin((ship.holdAngle + 0.05) * 2) * 12,
              Math.sin(ship.holdAngle + 0.05) * 230,
            );
            node.lookAt(tmp);
            node.userData.plume.material.opacity = 0.2;
            ship.t -= dt;
            const dock = freeDock();
            if (dock) {
              dock.busy = true;
              ship.dock = dock;
              ship.curve = lane(node.position, dock.pos.clone().add(dock.approach.clone().multiplyScalar(70)), rng, 0.4);
              ship.state = STATES.CRUISE_IN;
              ship.t = 0;
              ship.duration = 8 / ship.speedScale;
            } else if (ship.t <= 0) {
              leave(ship);   // gave up waiting; someone else gets the slot
            }
            break;
          }

          case STATES.DOCKING: {
            ship.t += dt / 5;
            const u = THREE.MathUtils.smoothstep(Math.min(ship.t, 1), 0, 1);
            tmp.copy(ship.dock.pos).add(tmp2.copy(ship.dock.approach).multiplyScalar(70 * (1 - u)));
            node.position.copy(tmp);
            tmp2.copy(ship.dock.pos).sub(tmp);
            if (tmp2.lengthSq() > 0.001) node.lookAt(tmp.clone().add(tmp2));
            node.userData.plume.material.opacity = 0;
            node.userData.engine.material.opacity = 0.35;
            if (ship.t >= 1) {
              ship.state = STATES.DWELL;
              ship.t = 7 + rng() * 9;
            }
            break;
          }

          case STATES.DWELL:
            ship.t -= dt;
            // Riding lights while berthed
            node.userData.engine.material.opacity = 0.18 + Math.sin(t * 2.2) * 0.06;
            if (ship.t <= 0) {
              ship.state = STATES.UNDOCK;
              ship.t = 0;
            }
            break;

          case STATES.UNDOCK: {
            ship.t += dt / 4;
            const u = THREE.MathUtils.smoothstep(Math.min(ship.t, 1), 0, 1);
            node.position.copy(ship.dock.pos).add(tmp.copy(ship.dock.approach).multiplyScalar(70 * u));
            if (ship.t >= 1) {
              ship.dock.busy = false;
              ship.dock = null;
              leave(ship);
            }
            break;
          }

          case STATES.HYPER_OUT:
            // Stretch along the travel axis and vanish
            ship.t += dt * 3;
            node.translateZ(dt * 900 * ship.t);
            node.scale.z = node.scale.x * (1 + ship.t * 20);
            if (ship.t >= 1) {
              node.visible = false;
              node.scale.z = node.scale.x;
              ship.state = STATES.GONE;
              ship.wait = 4 + rng() * 16;
            }
            break;
        }
      }
    },
  };
}

/* Two liners that never dock: enormous, distant, slow — they exist so the eye
   occasionally catches something crossing the deep background and the system
   feels bigger than the story in front of it. */
export function buildLiners() {
  const group = new THREE.Group();
  const mats = materials();
  const liners = [];
  for (let i = 0; i < 2; i++) {
    const ship = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 90, 8), mats[i % mats.length]);
    body.rotation.x = Math.PI / 2;
    ship.add(body);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 14), mats[(i + 1) % mats.length]);
    bridge.position.set(0, 8, -18);
    ship.add(bridge);
    const windows = new THREE.Mesh(
      new THREE.BoxGeometry(12.5, 1, 70),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    windows.position.y = 0;
    ship.add(windows);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sharedGlow, color: PALETTE.engine, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.z = -48;
    glow.scale.setScalar(16);
    ship.add(glow);
    group.add(ship);
    liners.push({
      node: ship,
      a: [new THREE.Vector3(-1400, 60, 900), new THREE.Vector3(900, -140, -1900)][i],
      b: [new THREE.Vector3(1500, 220, -700), new THREE.Vector3(-1200, 40, -400)][i],
      period: [260, 340][i],
      offset: [0, 0.55][i],
    });
  }
  const tmp = new THREE.Vector3();
  return {
    group,
    update(dt, t) {
      for (const l of liners) {
        const u = ((t / l.period) + l.offset) % 1;
        l.node.position.lerpVectors(l.a, l.b, u);
        tmp.lerpVectors(l.a, l.b, u + 0.01);
        l.node.lookAt(tmp);
      }
    },
  };
}
