/* Meteora — engine glow and fire.

   The flame follows the ship's speed: a faint glow in the nozzle at a
   standstill, a long plume at cruise, and — once the ship is really moving
   — tongues of fire licking off the end of it. Thrust on top of that makes
   it flare while the ship is accelerating, and the afterburner turns it
   white-hot, stretches it by half again and lights a row of shock diamonds
   along the core.

   Every plume is drawn as a chain of glow sprites from the nozzle along the
   exhaust direction, plus one stretched streak through them for a
   continuous core. That reads from every angle: from the side it is a
   tapered flame, from the chase camera behind it, a bright stacked disc.

   Colours follow the faction — Watch blue-white, civilian warm white, the
   Harrow red-orange — and the size follows each nozzle's exit radius, from
   a Mite's to a capital ship's. Large ships burn a short, wide, steady
   glow rather than a fighter's long flame. Small craft also show their
   attitude thrusters puffing when they are close to the camera. */

import * as THREE from 'three';
import { hardpoints } from './hardpoints.js';
import { hypot3, qRotateInv } from './vec.js';

const STYLES = {
  watch: { core: [0.75, 0.86, 1.0], sheath: [0.32, 0.5, 1.0], fire: [1.0, 0.5, 0.16], boost: [1.0, 0.92, 0.8] },
  civil: { core: [1.0, 0.92, 0.8], sheath: [1.0, 0.62, 0.3], fire: [1.0, 0.5, 0.16], boost: [1.0, 0.95, 0.85] },
  harrow: { core: [1.0, 0.86, 0.7], sheath: [1.0, 0.32, 0.08], fire: [1.0, 0.45, 0.1], boost: [1.0, 0.95, 0.85] },
};
const CHAIN = 14, FIRE = 9;
const RCS_RANGE = 450;

const fract = x => x - Math.floor(x);
// Additive sprites pile up; compress each one so a stack saturates gently
// instead of blowing out into a white disc.
const soft = x => 2.2 * (1 - Math.exp(-x / 2.2));
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const EMBER = [1.0, 0.82, 0.4];

export function createPlumes(glow) {
  const eased = new Map();   // entity id → { power, boost }
  const p = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const local = [0, 0, 0];
  // A fighter in view adds some fifty sprites a frame. Each goes to the
  // batch in one array (glow.addFrom) — passed as a dozen numbers into
  // glow.add, every one would be boxed — and the colours are mixed in
  // place: no garbage a frame.
  const sprite = new Float64Array(12), result = { power: 0, boost: 0 };
  const ring = [0, 0, 0], throat = [0, 0, 0], streak = [0, 0, 0], tail = [0, 0, 0], base = [0, 0, 0], col = [0, 0, 0];
  const put = (x, y, z, size, r, g, b, intensity, ax, ay, az, length) => {
    const o = sprite;
    o[0] = x; o[1] = y; o[2] = z; o[3] = size; o[4] = r; o[5] = g; o[6] = b; o[7] = intensity;
    o[8] = ax; o[9] = ay; o[10] = az; o[11] = length;
    glow.addFrom(o);
  };
  // A flame sprite that drifts past the lens would fill the screen.
  let viewer = false, camX = 0, camY = 0, camZ = 0;
  const nearFade = (x, y, z) => (viewer ? Math.min(1, Math.max(0, (hypot3(x - camX, y - camY, z - camZ) - 5) / 12)) : 1);

  return {
    forget(id) { eased.delete(id); },
    reset() { eased.clear(); },
    // `object` carries the interpolated pose the ship is drawn at.
    add(entity, object, time, dt, camera = null) {
      const ship = entity.ship;
      const style = STYLES[entity.def?.faction === 'harrow' ? 'harrow' : entity.def?.faction === 'civil' ? 'civil' : 'watch'];
      const hp = hardpoints(entity.model);
      const scale = entity.scale ?? 1;
      qRotateInv(local, ship.q, ship.vel);
      const cruise = Math.max(1, ship.stats.fa.forwardSpeed);
      const speed = Math.max(0, -local[2]) / cruise;
      const target = entity.disabled || entity.frozen ? 0.02 : Math.min(1.4, 0.06 + 0.72 * Math.min(speed, 1.3) + 0.3 * Math.min(ship.thrust, 1));
      let e = eased.get(entity.id);
      if (!e) eased.set(entity.id, e = { power: target, boost: 0 });
      e.power += (target - e.power) * (1 - Math.exp(-dt * 8));
      e.boost += ((ship.afterburner ? 1 : 0) - e.boost) * (1 - Math.exp(-dt * 6));
      const power = e.power, boost = e.boost;
      const big = !!entity.big;
      viewer = !!camera;
      if (camera) { camX = camera.position.x; camY = camera.position.y; camZ = camera.position.z; }

      for (const nozzle of hp.nozzles) {
        const r0 = (nozzle.size ?? 0.5) * scale;
        p.set(nozzle.pos[0] * scale, nozzle.pos[1] * scale, nozzle.pos[2] * scale).applyQuaternion(object.quaternion).add(object.position);
        d.set(nozzle.dir[0], nozzle.dir[1], nozzle.dir[2]).applyQuaternion(object.quaternion);
        const seed = nozzle.pos[0] * 13.1 + entity.id;
        const flick = 0.85 + 0.3 * hash(seed, Math.floor(time * 60));
        if (big) {
          // A capital engine: a wide, steady glow and a short bright cone.
          const glowPower = (0.6 + 1.6 * power) * (0.95 + 0.1 * flick);
          put(p.x, p.y, p.z, r0 * 1.6, style.core[0], style.core[1], style.core[2], glowPower * 1.4, 0, 0, 0, 0);
          const L = r0 * (1.2 + 2.8 * power);
          put(p.x + d.x * L * 0.5, p.y + d.y * L * 0.5, p.z + d.z * L * 0.5, r0 * 0.9, style.sheath[0], style.sheath[1], style.sheath[2], glowPower, d.x, d.y, d.z, L);
          for (let i = 1; i <= 4; i++) {
            const t = i / 4, at = L * t;
            const c = mix3(ring, style.core, style.sheath, t);
            put(p.x + d.x * at, p.y + d.y * at, p.z + d.z * at, r0 * (1 + 0.6 * t), c[0], c[1], c[2], glowPower * (1 - t) * 0.9, 0, 0, 0, 0);
          }
          continue;
        }
        side.set(1, 0, 0).applyQuaternion(object.quaternion);
        up.set(0, 1, 0).applyQuaternion(object.quaternion);
        const length = r0 * (1.5 + 12 * power) * (1 + 0.6 * boost);
        // Seen straight down the exhaust (the chase camera's view of its own
        // ship), the whole chain stacks on one spot: dim it there.
        let axial = 1;
        if (camera) {
          side.set(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z).normalize();
          const along = Math.abs(side.dot(d));
          axial = 1 - 0.62 * Math.min(1, Math.max(0, (along - 0.7) / 0.28));
          side.set(1, 0, 0).applyQuaternion(object.quaternion);
        }
        const fireAmount = Math.max(0, Math.min(1, (power - 0.45) / 0.6)) * (1 - 0.5 * boost);

        // The glowing throat, visible even at a standstill.
        mix3(throat, style.core, style.boost, boost);
        put(p.x, p.y, p.z, r0 * (1.3 + 0.9 * power), throat[0], throat[1], throat[2], soft((0.5 + 2.4 * power + 1.4 * boost) * flick) * axial, 0, 0, 0, 0);

        // Continuous core streak, through the hot first part of the flame;
        // it dims if its far end comes near the lens.
        const mid = length * 0.3, reach = length * 0.6;
        mix3(streak, style.sheath, style.boost, 0.35 + 0.5 * boost);
        put(p.x + d.x * mid, p.y + d.y * mid, p.z + d.z * mid, r0 * (0.5 + 0.2 * boost),
          streak[0], streak[1], streak[2],
          soft((0.5 + 1.2 * power + 0.7 * boost) * flick) * axial * nearFade(p.x + d.x * reach, p.y + d.y * reach, p.z + d.z * reach),
          d.x, d.y, d.z, reach);

        // The plume itself, hottest and narrowest at the nozzle.
        for (let i = 0; i < CHAIN; i++) {
          const t = i / (CHAIN - 1);
          const at = length * Math.pow(t, 1.15);
          const jitter = 0.85 + 0.3 * hash(seed + i, Math.floor(time * 45));
          const diamond = 1 + boost * 0.9 * Math.pow(Math.max(0, Math.cos(t * Math.PI * 9)), 6) * (1 - t);
          mix3(tail, style.sheath, style.fire, fireAmount * t);
          mix3(col, mix3(base, style.core, tail, Math.min(1, t * 2.2)), style.boost, boost * (1 - t) * 0.8);
          const size = r0 * (0.75 + 1.1 * t + 0.6 * boost * t) * jitter;
          const x = p.x + d.x * at, y = p.y + d.y * at, z = p.z + d.z * at;
          const intensity = soft(power * Math.pow(1 - t, 1.5) * (1.4 + 1.3 * boost) * diamond * jitter) * axial * nearFade(x, y, z);
          // (Written out here and below: these two loops are most of the
          // sprites, and put is not inlined at every call.)
          const o = sprite;
          o[0] = x; o[1] = y; o[2] = z; o[3] = size; o[4] = col[0]; o[5] = col[1]; o[6] = col[2]; o[7] = intensity;
          o[8] = 0; o[9] = 0; o[10] = 0; o[11] = 0;
          glow.addFrom(o);
        }

        // Tongues of fire at speed: flickering, wandering off the axis.
        if (fireAmount > 0.01) {
          for (let k = 0; k < FIRE; k++) {
            const life = fract(time * (2.2 + hash(seed, k) * 1.5) + hash(k, seed));
            const at = length * (0.35 + 0.75 * life);
            const swing = r0 * (0.4 + 1.6 * life);
            const a = hash(seed * 3 + k, Math.floor(time * 30)) * Math.PI * 2;
            const ox = Math.cos(a) * swing, oy = Math.sin(a) * swing;
            mix3(col, style.fire, EMBER, 1 - life);
            const x = p.x + d.x * at + side.x * ox + up.x * oy, y = p.y + d.y * at + side.y * ox + up.y * oy, z = p.z + d.z * at + side.z * ox + up.z * oy;
            const o = sprite;
            o[0] = x; o[1] = y; o[2] = z; o[3] = r0 * (0.6 + 1.0 * life); o[4] = col[0]; o[5] = col[1]; o[6] = col[2];
            o[7] = fireAmount * 1.6 * (1 - life) * flick * axial * nearFade(x, y, z);
            o[8] = 0; o[9] = 0; o[10] = 0; o[11] = 0;
            glow.addFrom(o);
          }
        }
      }

      // Attitude thrusters, puffing as the flight computer fires them.
      if (!big && camera && entity.rcsFired?.length) {
        const dist = object.position.distanceTo(camera.position);
        if (dist < RCS_RANGE) {
          const fade = 1 - dist / RCS_RANGE;
          for (const fired of entity.rcsFired) {
            const port = hp.rcs[fired.index];
            if (!port) continue;
            p.set(port.pos[0], port.pos[1], port.pos[2]).applyQuaternion(object.quaternion).add(object.position);
            d.set(port.dir[0], port.dir[1], port.dir[2]).applyQuaternion(object.quaternion);
            const k = fired.intensity * fade * (0.5 + 0.7 * hash(fired.index, Math.floor(time * 50)));
            const x = p.x + d.x * 0.35, y = p.y + d.y * 0.35, z = p.z + d.z * 0.35;
            put(x, y, z, 0.16, 0.85, 0.9, 1, 0.5 * k * nearFade(x, y, z), d.x, d.y, d.z, 0.55);
          }
        }
      }
      result.power = power; result.boost = boost;
      return result;
    },
  };
}
