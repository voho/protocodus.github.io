/* Meteora — the flight HUD, drawn on a 2D canvas at screen resolution.

   Aiming, with the mouse:
      ┼   the aim crosshair follows the mouse; the ship turns toward it
      ○   gun pipper: where the bolts will be at the target's range. The
          guns swing up to 10° toward the crosshair, so inside that cone the
          pipper sits on the crosshair; outside it, it waits at the cone's
          edge while the nose comes round
      ˄   the nose, where the ship itself points
   Targeting:
     ┌ ┐  red square around the selected enemy, with distance and closing
     └ ┘  speed; brackets close in as a missile locks
      ◇   lead marker: where the bolts and the enemy arrive together, solved
          from both velocities — put the crosshair on it and fire
      ▲   an arrow on the screen edge, with the distance, when the target is
          off screen
   The pipper and the diamond are joined by a dashed line, so the correction
   to make is always drawn, not guessed.

   Around it: the velocity marker (where the ship is actually going, which
   with momentum is often not where it points), speed and throttle, flight
   assist, the afterburner, shield and hull, guns and missiles, score and
   wave. */

import * as THREE from 'three';
import { CANNON, MISSILE } from './config.js';
import { gimbal, leadPoint } from './weapons.js';

const RED = '#ff3b30', RED_DIM = 'rgba(255, 70, 60, 0.45)', INK = 'rgba(225, 235, 248, 0.92)';
const MUTED = 'rgba(160, 178, 205, 0.75)', CYAN = '#7fd8ff', AMBER = '#ffb347';
const FONT = '"Space Grotesk", system-ui, sans-serif';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const v = new THREE.Vector3();
  const callouts = [];

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };

  // Screen position of a world point; `behind` when it is behind the camera.
  const project = (camera, x, y, z) => {
    v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    const behind = v.z > 0;
    const view = [v.x, v.y, v.z];
    v.applyMatrix4(camera.projectionMatrix);
    return {
      x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind, view,
      on: !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  };

  const text = (s, x, y, size = 13, color = INK, align = 'center') => {
    ctx.font = `500 ${size}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  const distanceText = d => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);

  const brackets = (x, y, half, color, width, gap = 0.45) => {
    const arm = half * gap;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = x + sx * half, cy = y + sy * half;
      ctx.moveTo(cx - sx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - sy * arm);
    }
    ctx.stroke();
  };

  const edgeArrow = (p, color, label) => {
    let dx = p.view[0], dy = -p.view[1];
    if (Math.hypot(dx, dy) < 1e-6) dy = 1;
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    const margin = 46, cx = w / 2, cy = h / 2;
    const s = Math.min((w / 2 - margin) / Math.max(Math.abs(dx), 1e-6), (h / 2 - margin) / Math.max(Math.abs(dy), 1e-6));
    const x = cx + dx * s, y = cy + dy * s;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) text(label, x - dx * 30, y - dy * 30, 12, color);
  };

  const bar = (x, y, width, value, color, label, right = false) => {
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, width, 5);
    const f = Math.max(0, Math.min(1, value));
    ctx.fillStyle = color; ctx.fillRect(right ? x + width * (1 - f) : x, y, width * f, 5);
    if (label) text(label, right ? x + width : x, y - 9, 11, MUTED, right ? 'right' : 'left');
  };

  return {
    resize,
    callout(message) { callouts.push({ message, age: 0 }); },
    clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    draw(world, camera, view, dt) {
      if (!w) resize();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = world.player, ship = p.ship;
      const pos = view.position;
      const fwdV = new THREE.Vector3(0, 0, -1).applyQuaternion(view.quaternion);
      const fwd = [fwdV.x, fwdV.y, fwdV.z];
      const target = world.target && world.target.alive ? world.target : null;
      const range = target ? Math.hypot(...target.ship.pos.map((c, i) => c - ship.pos[i])) : 1200;

      // Velocity marker: where the ship is going.
      const speed = Math.hypot(...ship.vel);
      if (speed > 5) {
        const m = project(camera, pos.x + ship.vel[0] * 100, pos.y + ship.vel[1] * 100, pos.z + ship.vel[2] * 100);
        if (m.on) {
          ctx.strokeStyle = 'rgba(127, 216, 255, 0.85)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
          ctx.moveTo(m.x - 14, m.y); ctx.lineTo(m.x - 6, m.y); ctx.moveTo(m.x + 6, m.y); ctx.lineTo(m.x + 14, m.y);
          ctx.moveTo(m.x, m.y - 6); ctx.lineTo(m.x, m.y - 12);
          ctx.stroke();
        }
      }

      // The nose: a small chevron where the ship points.
      const nose = project(camera, pos.x + fwd[0] * range, pos.y + fwd[1] * range, pos.z + fwd[2] * range);
      if (nose.on) {
        ctx.strokeStyle = MUTED; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(nose.x - 8, nose.y + 5); ctx.lineTo(nose.x, nose.y - 3); ctx.lineTo(nose.x + 8, nose.y + 5); ctx.stroke();
      }

      // Gun pipper: where the gimballed bolts go at the target's range.
      let pip = null;
      if (view.aimPoint) {
        const aim = [view.aimPoint[0] - ship.pos[0], view.aimPoint[1] - ship.pos[1], view.aimPoint[2] - ship.pos[2]];
        const dir = gimbal(fwd, aim, CANNON.gimbal);
        pip = project(camera, pos.x + dir[0] * range, pos.y + dir[1] * range, pos.z + dir[2] * range);
        if (pip.on) {
          ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(pip.x, pip.y, 12, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = INK; ctx.fillRect(pip.x - 1, pip.y - 1, 2, 2);
        }
      }

      // Other enemies: dim corners.
      for (const e of world.enemies) {
        if (!e.alive || e === target) continue;
        const q = project(camera, ...e.ship.pos);
        if (q.on) brackets(q.x, q.y, 9, RED_DIM, 1.2, 0.5);
      }

      if (target) {
        const t = target.ship;
        const q = project(camera, t.pos[0], t.pos[1], t.pos[2]);
        const rel = t.vel.map((c, i) => c - ship.vel[i]);
        const toward = t.pos.map((c, i) => c - ship.pos[i]);
        const closing = -(rel[0] * toward[0] + rel[1] * toward[1] + rel[2] * toward[2]) / Math.max(range, 1);
        const label = `${distanceText(range)}  ${closing >= 0 ? '+' : '−'}${Math.abs(closing).toFixed(0)} m/s`;
        if (q.on) {
          const pixels = target.radius / Math.max(-q.view[2], 1) * (h / 2) / Math.tan(camera.fov * Math.PI / 360);
          const half = Math.max(16, pixels * 1.4 + 6);
          const lock = world.lock;
          ctx.strokeStyle = RED; ctx.lineWidth = 2;
          ctx.strokeRect(q.x - half, q.y - half, half * 2, half * 2);
          if (p.missiles > 0 && lock.targetId === target.id && lock.progress > 0) {
            brackets(q.x, q.y, half + 18 * (1 - lock.progress), lock.locked ? RED : AMBER, lock.locked ? 3 : 2, 0.35);
            text(lock.locked ? 'LOCK · right click' : 'LOCKING', q.x, q.y - half - 12, 12, lock.locked ? RED : AMBER);
          }
          text(label, q.x, q.y + half + 14, 12, RED);
          const frac = target.hull / target.maxHull;
          ctx.fillStyle = 'rgba(255,60,50,0.25)'; ctx.fillRect(q.x - half, q.y + half + 25, half * 2, 3);
          ctx.fillStyle = RED; ctx.fillRect(q.x - half, q.y + half + 25, half * 2 * frac, 3);
        } else {
          edgeArrow(q, RED, distanceText(range));
        }

        // Lead marker: where to aim so the bolts meet the target.
        const lead = leadPoint([0, 0, 0], ship.pos, ship.vel, t.pos, t.vel, CANNON.speed);
        if (lead && range < CANNON.speed * CANNON.life) {
          const L = project(camera, pos.x + lead[0] - ship.pos[0], pos.y + lead[1] - ship.pos[1], pos.z + lead[2] - ship.pos[2]);
          if (L.on) {
            const onTarget = pip && pip.on && Math.hypot(L.x - pip.x, L.y - pip.y) < 10;
            if (pip && pip.on) {
              ctx.setLineDash([4, 5]);
              ctx.strokeStyle = 'rgba(255, 90, 80, 0.7)'; ctx.lineWidth = 1.2;
              ctx.beginPath(); ctx.moveTo(pip.x, pip.y); ctx.lineTo(L.x, L.y); ctx.stroke();
              ctx.setLineDash([]);
            }
            ctx.fillStyle = onTarget ? RED : 'rgba(255, 59, 48, 0.25)';
            ctx.strokeStyle = RED; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(L.x, L.y - 9); ctx.lineTo(L.x + 9, L.y); ctx.lineTo(L.x, L.y + 9); ctx.lineTo(L.x - 9, L.y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            if (onTarget) text('ON TARGET', L.x, L.y + 22, 11, RED);
          }
        }
      } else if (world.enemies.some(e => e.alive)) {
        text('T  select target', w / 2, h / 2 + 64, 12, MUTED);
      }

      // The aim crosshair, last so it sits on top.
      if (view.cursor) {
        const cx = (view.cursor[0] * 0.5 + 0.5) * w, cy = (view.cursor[1] * 0.5 + 0.5) * h;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(cx + dx * 5, cy + dy * 5); ctx.lineTo(cx + dx * 13, cy + dy * 13);
        }
        ctx.stroke();
      }

      // Bottom left: flight.
      const x0 = 28, y0 = h - 118;
      ctx.font = `600 34px ${FONT}`; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${speed.toFixed(0)}`, x0, y0 + 26);
      text('m/s', x0 + 8 + ctx.measureText(`${speed.toFixed(0)}`).width, y0 + 16, 12, MUTED, 'left');
      bar(x0, y0 + 52, 180, Math.max(0, ship.throttle), CYAN, `THROTTLE ${(ship.throttle * 100).toFixed(0)}%  · W / S`);
      bar(x0, y0 + 82, 180, ship.boost / ship.stats.boost.capacity, ship.boostLocked ? '#8a6040' : AMBER, 'AFTERBURNER · Shift');
      text(ship.fa ? 'FLIGHT ASSIST ON' : 'FLIGHT ASSIST OFF', x0, y0 + 104, 11, ship.fa ? MUTED : AMBER, 'left');

      // Bottom right: ship and weapons.
      const x1 = w - 208;
      bar(x1, y0 + 22, 180, p.shield / p.maxShield, CYAN, 'SHIELD', true);
      bar(x1, y0 + 52, 180, p.hull / p.maxHull, p.hull / p.maxHull < 0.3 ? RED : INK, 'HULL', true);
      bar(x1, y0 + 82, 180, p.gun.heat / CANNON.lockAt, p.gun.overheated ? RED : 'rgba(127,216,255,0.6)',
        p.gun.overheated ? 'CANNONS OVERHEAT' : 'CANNONS · left click', true);
      text(`MISSILES ${p.missiles}/${MISSILE.capacity} · right click`, x1 + 180, y0 + 104, 11, p.missiles ? AMBER : MUTED, 'right');

      // Top: score and wave.
      text(`SCORE  ${world.score.toLocaleString('en')}`, w / 2 - 70, 26, 13, INK);
      text(`WAVE  ${world.wave}`, w / 2 + 70, 26, 13, INK);
      if (world.leaving) text('LEAVING THE FIELD', w / 2, 58, 14, AMBER);

      for (let i = callouts.length - 1; i >= 0; i--) {
        const c = callouts[i];
        c.age += dt;
        if (c.age > 3) { callouts.splice(i, 1); continue; }
        const a = Math.min(1, c.age * 4) * Math.min(1, (3 - c.age) * 2);
        text(c.message, w / 2, h * 0.28 + i * 26, 18, `rgba(233, 237, 243, ${a})`);
      }
    },
  };
}
