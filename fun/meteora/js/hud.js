/* Meteora — the flight HUD, drawn on a 2D canvas at screen resolution.

   Aiming, with the mouse:
      ┼   the aim crosshair; the ship turns toward it
      ○   gun pipper: where the bolts will be at the target's range (the
          guns swing toward the crosshair within their gimbal)
      ˄   the nose, where the ship itself points
      ◎   the velocity marker: where the ship is really going
   Targeting:
     ┌ ┐  the target: red hostile, green friendly, amber neutral, with its
     └ ┘  name, class, distance, closing speed, shield and hull; brackets
          close in as a missile locks; a subsystem gets its own marker
      ◇   lead marker: put the crosshair on it and fire
      ▲   arrows on the screen edge for the target and the nav point
   Around the edge: directives and timers (top left), the radio (below
   them), the ships to protect (top right), speed and afterburner (bottom
   left), the radar (bottom centre), shields by quadrant, hull, guns,
   secondary banks and the Tender (bottom right), and warnings (top
   centre). Hits, kills, streaks and score pop up where they happen. */

import * as THREE from 'three';
import { GUNS, PRIMARIES, SECONDARIES } from './loadout.js';
import { gimbal, leadPoint } from './weapons.js';
import { SPEAKERS, readTime } from './mission.js';
import { capOf } from './keys.js';
import { DEFAULT_KEYS } from './controls.js';
import { subsystemWorld } from './compound.js';
import { TENDER } from './drone.js';
import { subsystemName } from './catalog.js';

const subName = sub => subsystemName(sub.kind);

const RED = '#ff3b30', RED_DIM = 'rgba(255, 70, 60, 0.5)', GREEN = '#5dff8f', GREEN_DIM = 'rgba(93, 255, 143, 0.45)';
const INK = 'rgba(225, 235, 248, 0.92)', MUTED = 'rgba(160, 178, 205, 0.75)', DIM = 'rgba(120, 136, 160, 0.6)';
const CYAN = '#7fd8ff', AMBER = '#ffb347', YELLOW = '#ffe066';
const FONT = '"Exo 2", "Space Grotesk", system-ui, sans-serif';
const TITLE = 'Orbitron, "Exo 2", system-ui, sans-serif';
const STREAK = ['', '', 'DOUBLE', 'TRIPLE', 'RAMPAGE', 'UNSTOPPABLE'];

const teamColour = (e, dim = false) => (e.team === 1 ? (dim ? RED_DIM : RED) : e.team === 0 ? (dim ? GREEN_DIM : GREEN) : (dim ? 'rgba(255,179,71,0.5)' : AMBER));
const fmt = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const distanceText = d => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, ui = 1, time = 0;
  const v = new THREE.Vector3(), forwardV = new THREE.Vector3(), inv = new THREE.Quaternion();
  const callouts = [], popups = [], marks = [], hurts = [];
  let streak = null, banner = null, lastHull = null;
  // The player's keys, for the few prompts that name one ({action} in a
  // hint, drawn as a key; the lock and Tender prompts).
  let keys = DEFAULT_KEYS;
  const key = action => capOf(keys[action]);

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    // The HUD is laid out in units that grow with the screen — 1.1 at
    // 1280 × 720, about 1.35 at 1440 × 900, up to 1.7 on a big display —
    // so its text stays easy to read; w and h are in those units.
    ui = Math.max(1.1, Math.min(1.7, Math.min(cw / 1066, ch / 666)));
    w = cw / ui; h = ch / ui;
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
  const pixelsFor = (camera, radius, depth) => radius / Math.max(depth, 1) * (h / 2) / Math.tan(camera.fov * Math.PI / 360);

  // Text widths, by font and text: the same few dozen strings are measured
  // every frame, and a long objective cut to fit is measured once for
  // every letter it loses.
  const widths = new Map();
  const measure = s => {
    const key = `${ctx.font}|${s}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size > 4000) widths.clear();
      width = ctx.measureText(s).width;
      widths.set(key, width);
    }
    return width;
  };
  const text = (s, x, y, size = 13, color = INK, align = 'center', weight = 500, family = FONT) => {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  // The largest size, up to `size`, at which a line fits nine tenths of the
  // screen's width.
  const fitSize = (s, size, weight, family) => {
    ctx.font = `${weight} ${size}px ${family}`;
    return Math.min(size, size * (w * 0.9) / Math.max(1, measure(s)));
  };
  const shadowed = (fn) => { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 4; fn(); ctx.restore(); };

  /* Labels in the world claim their space for the frame, the important
     ones first (the target's, then the nav point's, then the rest): a
     label that would land on another tries a line lower, then a line
     higher, and is left out if neither is free — unless it must show. */
  const slots = [];
  const label = (s, x, y, size = 12, color = INK, weight = 500, must = false) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const half = measure(s) / 2 + 3, tall = size / 2;
    // Never off the edge of the screen.
    x = Math.max(half + 6, Math.min(w - half - 6, x));
    y = Math.max(tall + 6, Math.min(h - tall - 6, y));
    const free = yy => !slots.some(r => x - half < r[2] && x + half > r[0] && yy - tall < r[3] && yy + tall > r[1]);
    let at = [y, y + size + 3, y - size - 3].find(free);
    if (at === undefined) { if (!must) return false; at = y; }
    slots.push([x - half, at - tall, x + half, at + tall]);
    text(s, x, at, size, color, 'center', weight);
    return true;
  };

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

  /* The panels round the edge, this frame: what the edge arrows keep off. */
  const panels = [];
  const blocked = (x, y, pad) => panels.some(r => x > r[0] - pad && x < r[2] + pad && y > r[1] - pad && y < r[3] + pad);
  const edgeArrow = (p, color, label, margin = 46) => {
    let dx = p.view[0], dy = -p.view[1];
    if (Math.hypot(dx, dy) < 1e-6) dy = 1;
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    const cx = w / 2, cy = h / 2;
    let s = Math.min((w / 2 - margin) / Math.max(Math.abs(dx), 1e-6), (h / 2 - margin) / Math.max(Math.abs(dy), 1e-6));
    // Along the same bearing, in from the edge until no panel is under it
    // or its label.
    while (s > 60 && blocked(cx + dx * s, cy + dy * s, 26)) s -= 6;
    const x = cx + dx * s, y = cy + dy * s;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) {
      // Beside the arrow on its inner side, never over it or off screen.
      ctx.font = `500 12px ${FONT}`;
      const half = measure(label) / 2 + 4;
      const lx = Math.max(half + 6, Math.min(w - half - 6, x - dx * (24 + half * Math.abs(dx))));
      const ly = Math.max(14, Math.min(h - 14, y - dy * 26));
      text(label, lx, ly, 12, color);
    }
  };

  const bar = (x, y, width, value, color, label, right = false, height = 5) => {
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, width, height);
    const f = Math.max(0, Math.min(1, value));
    ctx.fillStyle = color; ctx.fillRect(right ? x + width * (1 - f) : x, y, width * f, height);
    if (label) text(label, right ? x + width : x, y - 9, 11, MUTED, right ? 'right' : 'left');
  };

  const panel = (x, y, width, height) => {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.42)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(160, 190, 230, 0.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  };

  /* ---------- the parts ---------- */

  function flightMarks(world, camera, view, fwd, range) {
    const p = world.player, ship = p.ship, pos = view.position;
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
    const nose = project(camera, pos.x + fwd[0] * range, pos.y + fwd[1] * range, pos.z + fwd[2] * range);
    if (nose.on) {
      ctx.strokeStyle = MUTED; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nose.x - 8, nose.y + 5); ctx.lineTo(nose.x, nose.y - 3); ctx.lineTo(nose.x + 8, nose.y + 5); ctx.stroke();
    }
    let pip = null;
    if (view.aimPoint) {
      const aim = [view.aimPoint[0] - ship.pos[0], view.aimPoint[1] - ship.pos[1], view.aimPoint[2] - ship.pos[2]];
      const dir = gimbal(fwd, aim, p.gun.params.gimbal);
      pip = project(camera, pos.x + dir[0] * range, pos.y + dir[1] * range, pos.z + dir[2] * range);
      if (pip.on) {
        ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pip.x, pip.y, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillRect(pip.x - 1, pip.y - 1, 2, 2);
      }
    }
    return pip;
  }

  function others(world, camera, target) {
    for (const e of world.entities) {
      if (!e.alive || e.folding || e === world.player || e === target || e.hidden) continue;
      const q = project(camera, e.ship.pos[0], e.ship.pos[1], e.ship.pos[2]);
      if (!q.on) continue;
      const depth = -q.view[2];
      if (e.big) {
        if (depth > 9000) continue;
        const half = Math.max(10, Math.min(60, pixelsFor(camera, e.radius * 0.3, depth)));
        brackets(q.x, q.y, half, teamColour(e, true), 1, 0.3);
        if (depth < 6000) label(e.name, q.x, q.y - half - 9, 11, teamColour(e, true));
      } else if (e.team === 1) {
        if (depth < 4500) brackets(q.x, q.y, 8, RED_DIM, 1.2, 0.5);
      } else if (e.team === 0) {
        if (depth < 2500) {
          ctx.strokeStyle = GREEN_DIM; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke();
          if (depth < 1500 && e.leaderId === world.player.id) label(e.name, q.x, q.y + 14, 10, GREEN_DIM);
        }
      } else if (e.tags.has('objective') && depth < 3000) {
        brackets(q.x, q.y, 9, 'rgba(255,179,71,0.6)', 1.2, 0.5);
      }
    }
    // Hostile torpedoes: small flashing diamonds.
    for (const m of world.weapons.missiles) {
      if (m.team === 0 || !(m.hp > 0)) continue;
      const q = project(camera, m.pos[0], m.pos[1], m.pos[2]);
      if (!q.on) continue;
      const on = time % 0.4 < 0.25;
      ctx.strokeStyle = on ? '#ff7a2a' : 'rgba(255,122,42,0.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 6, q.y); ctx.lineTo(q.x, q.y + 6); ctx.lineTo(q.x - 6, q.y); ctx.closePath(); ctx.stroke();
    }
  }

  function targetBox(world, camera, view, pip, target, range) {
    const p = world.player, ship = p.ship, pos = view.position;
    const t = target.ship;
    const q = project(camera, t.pos[0], t.pos[1], t.pos[2]);
    const rel = t.vel.map((c, i) => c - ship.vel[i]);
    const toward = t.pos.map((c, i) => c - ship.pos[i]);
    const closing = -(rel[0] * toward[0] + rel[1] * toward[1] + rel[2] * toward[2]) / Math.max(range, 1);
    const colour = teamColour(target);
    const info = `${distanceText(range)}  ${closing >= 0 ? '+' : '−'}${Math.abs(closing).toFixed(0)} m/s`;
    if (q.on) {
      const pixels = pixelsFor(camera, target.radius, -q.view[2]);
      const half = Math.max(16, Math.min(Math.min(w, h) * 0.4, pixels * (target.big ? 0.6 : 1.4) + 6));
      const lock = world.lock;
      ctx.strokeStyle = colour; ctx.lineWidth = 2;
      if (target.big) brackets(q.x, q.y, half, colour, 2, 0.25);
      else ctx.strokeRect(q.x - half, q.y - half, half * 2, half * 2);
      const bank = p.banks[p.bank];
      if (target.team !== 0 && bank && bank.count > 0 && lock.targetId === target.id && (lock.progress > 0 || !lock.valid)) {
        if (!lock.valid) label(`${SECONDARIES[bank.weapon].short} cannot lock this`, q.x, q.y - half - 12, 12, MUTED, 500, true);
        else {
          brackets(q.x, q.y, half + 18 * (1 - lock.progress), lock.locked ? RED : AMBER, lock.locked ? 3 : 2, 0.35);
          label(lock.locked ? 'LOCKED' : 'LOCKING', q.x, q.y - half - 12, 12, lock.locked ? RED : AMBER, 600, true);
        }
      }
      // Name and range under the brackets — or over them, when under would
      // run into the target panel at the bottom of the screen.
      const under = q.y + half + 46 < h - 124, y0 = under ? q.y + half + 13 : q.y - half - (lock.targetId === target.id && lock.progress > 0 ? 40 : 26);
      shadowed(() => {
        label(target.name, q.x, y0, 12, colour, 600, true);
        label(info, q.x, y0 + 14, 11, colour, 500, true);
      });
      if (under) {
        if (target.maxShield > 0) bar(q.x - half, q.y + half + 36, half * 2, target.shield / target.maxShield, CYAN, null, false, 3);
        bar(q.x - half, q.y + half + 41, half * 2, target.hull / Math.max(1, target.maxHull), colour, null, false, 3);
      }
    } else {
      edgeArrow(q, colour, distanceText(range));
    }
    // A selected subsystem.
    const sub = world.targetSub;
    if (sub && target.big) {
      const sp = subsystemWorld([0, 0, 0], target, sub);
      const s = project(camera, sp[0], sp[1], sp[2]);
      if (s.on) {
        const half = Math.max(10, Math.min(40, pixelsFor(camera, sub.r, -s.view[2])));
        ctx.strokeStyle = YELLOW; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, half, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) { ctx.moveTo(s.x + Math.cos(a) * half, s.y + Math.sin(a) * half); ctx.lineTo(s.x + Math.cos(a) * (half + 8), s.y + Math.sin(a) * (half + 8)); }
        ctx.stroke();
        shadowed(() => label(`${subName(sub).toUpperCase()} ${Math.round(100 * sub.hull / sub.maxHull)}%`, s.x, s.y - half - 12, 11, YELLOW, 600, true));
      } else edgeArrow(s, YELLOW, subName(sub));
    }
    // Lead marker for hostiles in gun range.
    if (target.team !== 0) {
      const gunSpeed = p.gun.params.speed;
      const at = sub && target.big ? subsystemWorld([0, 0, 0], target, sub) : t.pos;
      const lead = leadPoint([0, 0, 0], ship.pos, ship.vel, at, t.vel, gunSpeed);
      if (lead && range < gunSpeed * p.gun.params.life + (target.big ? target.radius : 0)) {
        const L = project(camera, pos.x + lead[0] - ship.pos[0], pos.y + lead[1] - ship.pos[1], pos.z + lead[2] - ship.pos[2]);
        if (L.on) {
          const onTarget = pip && pip.on && Math.hypot(L.x - pip.x, L.y - pip.y) < (target.big ? 30 : 10);
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
          if (onTarget) label('ON TARGET', L.x, L.y + 22, 11, RED, 600, true);
        }
      }
    }
  }

  function navMarker(world, camera) {
    const n = world.nav;
    if (!n || n.hidden) return;
    const p = world.player.ship;
    const d = Math.hypot(n.pos[0] - p.pos[0], n.pos[1] - p.pos[1], n.pos[2] - p.pos[2]);
    const q = project(camera, n.pos[0], n.pos[1], n.pos[2]);
    if (q.on) {
      ctx.strokeStyle = CYAN; ctx.lineWidth = 1.6;
      const s = 10 + 3 * Math.sin(time * 3);
      ctx.beginPath(); ctx.moveTo(q.x, q.y - s); ctx.lineTo(q.x + s, q.y); ctx.lineTo(q.x, q.y + s); ctx.lineTo(q.x - s, q.y); ctx.closePath(); ctx.stroke();
      shadowed(() => { label(n.name, q.x, q.y - s - 10, 12, CYAN, 600); label(distanceText(d), q.x, q.y + s + 11, 11, CYAN); });
    } else edgeArrow(q, CYAN, `${n.name} ${distanceText(d)}`, 64);
  }

  function scanAndSensors(world, camera, target) {
    const sc = world.scanning;
    if (sc && target) {
      const t = sc.target;
      const q = project(camera, target.ship.pos[0], target.ship.pos[1], target.ship.pos[2]);
      if (q.on) {
        const r = 34;
        ctx.strokeStyle = 'rgba(255, 224, 102, 0.25)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = YELLOW;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t.scan.progress); ctx.stroke();
      }
      const msg = !sc.inRange ? `SCAN · close to ${Math.round(t.scan.range)} m (${distanceText(sc.distance)})` : !sc.inCone ? 'SCAN · bring it ahead of you' : `SCANNING ${Math.round(t.scan.progress * 100)}%`;
      shadowed(() => text(msg, w / 2, h / 2 + 70, 13, YELLOW, 'center', 600));
    }
    // The Harrow's Eyes: their range around them, their attention as an arc.
    if (world.sentries.length) {
      let worst = 0;
      for (const e of world.sentries) {
        if (!e.alive || e.folding) continue;
        const R = e.detectRangeNow ?? 0;
        const d = Math.hypot(e.ship.pos[0] - world.player.ship.pos[0], e.ship.pos[1] - world.player.ship.pos[1], e.ship.pos[2] - world.player.ship.pos[2]);
        worst = Math.max(worst, e.attention ?? 0);
        if (d > R * 2.5 + 400) continue;
        const q = project(camera, e.ship.pos[0], e.ship.pos[1], e.ship.pos[2]);
        if (!q.on) continue;
        const px = pixelsFor(camera, R, -q.view[2]);
        if (px > 8 && px < 4 * Math.max(w, h)) {
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = e.seesPlayer ? 'rgba(255, 70, 60, 0.85)' : 'rgba(255, 140, 90, 0.4)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(q.x, q.y, px, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        if ((e.attention ?? 0) > 0.01) {
          ctx.strokeStyle = RED; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(q.x, q.y, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.attention); ctx.stroke();
        }
      }
      // Our signature: how far away an Eye would notice us now.
      const sig = world.playerSignature ?? 1;
      const x = w / 2 - 90, y = 92;
      bar(x, y, 180, Math.min(1, sig / 2), sig < 0.35 ? GREEN : sig < 0.8 ? AMBER : RED, `SIGNATURE ${Math.round(700 * sig)} m${worst > 0.01 ? ' · WATCHED' : ''}`);
    }
  }

  /* FreeSpace-style radar: what is ahead inside the disc, what is behind
     in the outer ring, by how far off the nose each contact is. */
  function radar(world, view) {
    // Beside the speed panel on a wide screen, above it on a narrow one:
    // never over the ship the chase camera is looking past.
    const R = Math.min(88, Math.max(58, h * 0.09));
    const wide = w >= 1000;
    const cx = wide ? 238 + R : 16 + R, cy = wide ? h - R - 24 : h - 170 - R - 18;
    ctx.fillStyle = 'rgba(6, 12, 20, 0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(127, 216, 255, 0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    inv.copy(view.quaternion).invert();
    const p = world.player.ship.pos;
    // A world direction (v, normalised) to its place on the disc.
    const place = () => {
      v.applyQuaternion(inv);
      const theta = Math.acos(Math.max(-1, Math.min(1, -v.z)));
      const az = Math.atan2(-v.y, v.x);
      const r = theta / Math.PI * R;
      return [cx + Math.cos(az) * r, cy + Math.sin(az) * r];
    };
    // Where the momentum carries us, against where the nose points (the
    // centre): drawn first so the contacts sit on top of it.
    const vel = world.player.ship.vel, speed = Math.hypot(...vel);
    if (speed > 5) {
      v.set(vel[0] / speed, vel[1] / speed, vel[2] / speed);
      const [x, y] = place();
      ctx.strokeStyle = 'rgba(127, 216, 255, 0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    const plot = (pos, colour, size, square = false, ring = false) => {
      v.set(pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]);
      const dist = v.length();
      if (dist < 1) return;
      v.divideScalar(dist);
      const [x, y] = place();
      const fade = dist > 6000 ? 0.45 : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = colour;
      if (square) ctx.fillRect(x - size, y - size, size * 2, size * 2);
      else { ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill(); }
      if (ring) { ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, size + 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    for (const e of world.entities) {
      if (!e.alive || e.folding || e === world.player || e.hidden) continue;
      plot(e.ship.pos, teamColour(e), e.big ? 3.5 : 2, e.big, e === world.target);
    }
    for (const m of world.weapons.missiles) if (m.team === 1 && m.hp > 0 && time % 0.4 < 0.25) plot(m.pos, '#ff7a2a', 2.2);
    if (world.nav && !world.nav.hidden) plot(world.nav.pos, CYAN, 3, true);
    text('RADAR', cx, cy + R + 12, 9, DIM);
  }

  /* Directives, top left. While they are news — the first seconds of a
     mission, and a while after any of them changes — every objective
     shows; after that only what is still to do, and the bonus objectives
     as a count. The pause screen always has the full list. Returns how far
     down the panel reaches. */
  let objectivesNews = 0;
  function directives(world) {
    const rt = world.mission;
    if (!rt) return 0;
    const all = rt.objectives.filter(o => o.state !== 'hidden');
    const news = rt.time < 12 || rt.time - objectivesNews < 8;
    const list = news ? all : all.filter(o => o.state === 'active' && o.kind !== 'bonus');
    const bonus = news ? 0 : all.filter(o => o.state === 'active' && o.kind === 'bonus').length;
    const timers = [...rt.timers.values()].filter(t => t.visible);
    const x = 22, y0 = 22;
    ctx.font = `500 12px ${FONT}`;
    const longest = Math.max(0, ...list.map(o => measure(`○  ${o.text}  00/00`)));
    const width = Math.min(Math.max(220, longest + 24), 380, w * 0.34);
    // The title, then a row each: the panel ends just under the last.
    const rows = list.length + timers.length + (bonus ? 1 : 0);
    const height = rows ? 44 + (rows - 1) * 19 : 26;
    panel(x - 10, y0 - 12, width, height);
    panels.push([x - 10, y0 - 12, x - 10 + width, y0 - 12 + height]);
    text(`${rt.def.number ? `MISSION ${rt.def.number} · ` : ''}${rt.def.title.toUpperCase()}`, x, y0 + 2, 11, AMBER, 'left', 600);
    let y = y0 + 22;
    for (const t of timers) {
      const blocked = t.paused;
      text(`${t.label.toUpperCase()}  ${fmt(t.left)}${blocked ? '  BLOCKED' : ''}`, x, y, 13, blocked ? RED : t.left < 30 ? AMBER : INK, 'left', 600);
      y += 19;
    }
    for (const o of list) {
      const icon = o.state === 'done' ? '✓' : o.state === 'failed' ? '✕' : o.kind === 'bonus' ? '☆' : '○';
      const colour = o.state === 'done' ? GREEN : o.state === 'failed' ? RED : o.kind === 'bonus' ? 'rgba(255, 224, 102, 0.85)' : INK;
      const count = o.count && o.state === 'active' ? `  ${o.count.n}/${o.count.of}` : '';
      const fresh = rt.time - (o.shownAt ?? 0) < 1.2 && o.state === 'active';
      const row = fitLine(`${icon}  ${o.text}`, width - 24 - (count ? measure(count) : 0));
      text(`${row}${count}`, x + (fresh ? 6 * (1 - (rt.time - o.shownAt) / 1.2) : 0), y, 12, colour, 'left');
      y += 19;
    }
    if (bonus) { text(`☆  ${bonus} bonus objective${bonus > 1 ? 's' : ''}`, x, y, 11, 'rgba(255, 224, 102, 0.7)', 'left'); y += 19; }
    return y0 - 12 + height;
  }
  // A line cut to a width, with an ellipsis.
  function fitLine(s, width) {
    if (measure(s) <= width) return s;
    let t = s;
    while (t.length > 4 && measure(`${t}…`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  /* The radio, under the directives: laid out first (so the arrows and
     labels keep off it), drawn last (over everything, the letterbox too). */
  function radioPlan(world, top) {
    const rt = world.mission;
    if (!rt) return [];
    const now = rt.time;
    const lines = rt.radio.filter(l => l.at <= now && now < l.at + l.dur + 2.5).slice(-3);
    const x = 22, width = Math.min(460, w * 0.4);
    let y = Math.max(34, top + 24);
    const plan = [];
    ctx.font = `500 13px ${FONT}`;
    for (const l of lines) {
      const age = now - l.at;
      // Typewriter: the line arrives a little faster than it is read; the
      // box is as tall as the whole line from the start.
      const shown = l.text.slice(0, Math.ceil(l.text.length * Math.min(1, age / Math.max(0.6, l.dur * 0.5))));
      const rows = wrap(shown, width - 20), tall = wrap(l.text, width - 20).length;
      plan.push({ l, x, y, width, rows, tall, alpha: Math.min(1, age * 6) * Math.min(1, (l.dur + 2.5 - age) / 0.8) });
      panels.push([x - 10, y - 12, x - 10 + width, y + 10 + tall * 17]);
      y += 34 + tall * 17;
    }
    return plan;
  }
  function radio(plan) {
    for (const { l, x, y, width, rows, tall, alpha } of plan) {
      const sp = SPEAKERS[l.who] ?? { name: l.who, colour: INK };
      ctx.globalAlpha = alpha;
      panel(x - 10, y - 12, width, 22 + tall * 17);
      text(sp.name.toUpperCase(), x, y, 10, sp.colour, 'left', 700);
      let yy = y + 16;
      for (const row of rows) { text(row, x, yy, 13, INK, 'left'); yy += 17; }
      ctx.globalAlpha = 1;
    }
  }
  const wrapCache = new Map();
  function wrap(s, width) {
    const key = `${ctx.font}|${width}|${s}`;
    if (wrapCache.has(key)) return wrapCache.get(key);
    const words = s.split(' '), out = [];
    let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (measure(t) > width && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    if (wrapCache.size > 400) wrapCache.clear();
    wrapCache.set(key, out);
    return out;
  }

  function escorts(world) {
    const list = world.entities.filter(e => e.alive && e.team === 0 && e !== world.player && (e.tags.has('objective') || e.tags.has('convoy')) && !e.departed).slice(0, 7);
    if (!list.length) return;
    const width = 210, x = w - width - 18;
    let y = 22;
    panel(x - 8, y - 12, width + 16, 20 + list.length * 30);
    panels.push([x - 8, y - 12, x + width + 8, y + 8 + list.length * 30]);
    text('PROTECT', x, y + 2, 11, GREEN, 'left', 600);
    y += 20;
    for (const e of list) {
      const hullF = e.hull / Math.max(1, e.maxHull);
      const hurt = hullF < 0.35 && time % 0.6 < 0.3;
      text(e.name, x, y, 12, hurt ? RED : INK, 'left');
      text(`${Math.round(hullF * 100)}%`, x + width, y, 11, hullF < 0.35 ? RED : MUTED, 'right');
      if (e.maxShield > 0) bar(x, y + 8, width, e.shield / e.maxShield, CYAN, null, false, 2);
      bar(x, y + 11, width, hullF, hullF < 0.35 ? RED : GREEN, null, false, 3);
      y += 30;
    }
  }

  function flightPanel(world) {
    const p = world.player, ship = p.ship;
    const speed = Math.hypot(...ship.vel);
    const x0 = 28, y0 = h - 132;
    panel(x0 - 12, y0 - 18, 214, 150);
    ctx.font = `600 34px ${FONT}`; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${speed.toFixed(0)}`, x0, y0 + 26);
    text('m/s', x0 + 8 + measure(`${speed.toFixed(0)}`), y0 + 16, 12, MUTED, 'left');
    const holding = Math.max(0, ship.cruise) / ship.stats.fa.forwardSpeed;
    bar(x0, y0 + 52, 180, Math.min(1, holding), world.speedLock ? AMBER : CYAN,
      world.speedLock ? `SPEED LOCK ${ship.cruise.toFixed(0)} m/s` : `THROTTLE ${(ship.throttle * 100).toFixed(0)}%`);
    bar(x0, y0 + 82, 180, ship.boost / Math.max(1, ship.stats.boost.capacity), ship.boostLocked ? '#8a6040' : AMBER,
      'AFTERBURNER');
    if (world.speedLock) text('MATCHING TARGET SPEED', x0, y0 + 104, 11, AMBER, 'left');
    else if (world.target) text(`${key('toggleSpeedLock')} · match speed`, x0, y0 + 104, 11, MUTED, 'left');
    const wing = world.entities.filter(e => e.alive && e.leaderId === p.id && e.brain);
    if (wing.length) {
      const order = wing[0].orders?.type ?? 'cover';
      text(`WING ${wing.length} · ${order === 'attack' ? 'ATTACKING' : order === 'form' ? 'FORMING UP' : 'COVERING'}`, x0, y0 + 120, 10, GREEN_DIM, 'left', 600);
    }
  }

  function shipPanel(world) {
    const p = world.player;
    const x1 = w - 228, y0 = h - 150;
    panel(x1 - 12, y0 - 18, 232, 168);
    // Shields by quadrant around a small ship.
    const cx = x1 + 34, cy = y0 + 36, R = 26;
    const cap = p.maxShield / 4 || 1;
    const quads = [[-Math.PI * 0.75, -Math.PI * 0.25, 0], [Math.PI * 0.25, Math.PI * 0.75, 1], [Math.PI * 0.75, Math.PI * 1.25, 2], [-Math.PI * 0.25, Math.PI * 0.25, 3]];
    for (const [a0, a1, k] of quads) {
      const f = Math.max(0, Math.min(1, (p.quad?.[k] ?? 0) / cap));
      ctx.strokeStyle = 'rgba(127, 216, 255, 0.15)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0 + 0.08, a1 - 0.08); ctx.stroke();
      if (f > 0) {
        ctx.strokeStyle = f < 0.25 ? (time % 0.5 < 0.25 ? RED : AMBER) : CYAN;
        ctx.globalAlpha = 0.35 + 0.65 * f;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0 + 0.08, a1 - 0.08); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 8, cy + 9); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 8, cy + 9); ctx.closePath(); ctx.fill();
    text(`SHIELDS ${Math.round(100 * p.shield / Math.max(1, p.maxShield))}%`, cx, cy + R + 14, 10, CYAN, 'center', 600);
    const hullF = p.hull / p.maxHull;
    const bx = x1 + 76;
    bar(bx, y0 + 12, 130, hullF, hullF < 0.3 ? RED : hullF < 0.5 ? AMBER : INK, `HULL ${Math.round(hullF * 100)}%`, false, 6);
    const gun = p.gun, gp = gun.params;
    bar(bx, y0 + 42, 130, gun.heat / gp.lockAt, gun.overheated ? RED : 'rgba(127,216,255,0.6)',
      gun.overheated ? `${(gp.short ?? 'GUNS').toUpperCase()} OVERHEAT` : `${(gp.short ?? 'GUNS').toUpperCase()}`);
    let y = y0 + 66;
    p.banks.forEach((b, i) => {
      const active = i === p.bank;
      const wpn = SECONDARIES[b.weapon];
      text(`${active ? '▶' : ' '} ${wpn.short.toUpperCase()}  ${b.count}/${b.max}`, bx, y, 12, active ? (b.count ? AMBER : RED) : MUTED, 'left', active ? 600 : 500);
      y += 16;
    });
    // The Tender.
    const R2 = world.repair;
    const drone = R2.droneId != null ? world.byId.get(R2.droneId) : null;
    let msg, colour = MUTED;
    if (drone?.alive) {
      const st = drone.tender?.state;
      if (st === 'docked') { msg = `TENDER REPAIRING ${Math.round(100 * p.hull / p.maxHull)}%`; colour = GREEN; }
      else if (st === 'approach') {
        const slow = Math.hypot(...p.ship.vel) < TENDER.dockSpeed;
        msg = slow ? 'TENDER CLOSING · hold your speed' : `TENDER EN ROUTE · slow below ${TENDER.dockSpeed} m/s`;
        colour = slow ? GREEN : AMBER;
      } else msg = 'TENDER LEAVING';
    } else if (R2.charges > 0) {
      const ready = hullF < 0.5;
      msg = `TENDER ×${R2.charges}${ready ? ` · ${key('repair')}` : ''}`;
      colour = ready ? (time % 0.8 < 0.5 ? GREEN : INK) : DIM;
    } else msg = 'NO TENDERS LEFT';
    text(msg, x1 - 2, y0 + 140, 11, colour, 'left', 600);
  }

  /* The Well: how far, how hard it pulls against what the engines can do,
     and — before it is too late — where nothing climbs back out. Above the
     speed panel. */
  function wellGauge(world) {
    const well = world.well;
    if (!well) return;
    const p = world.player, ship = p.ship;
    const r = well.distance(ship.pos), pull = well.accel(ship.pos, [0, 0, 0]);
    const thrust = ship.stats.accel.forward, burn = thrust + ship.stats.accel.boost;
    // Over the speed panel; on a narrow screen the radar is there, so over
    // the ship panel instead.
    const x0 = w >= 1000 ? 28 : w - 228, y0 = w >= 1000 ? h - 208 : h - 228;
    panel(x0 - 12, y0 - 18, 214, 62);
    panels.push([x0 - 12, y0 - 18, x0 + 202, y0 + 44]);
    const fall = pull >= burn, heavy = pull >= thrust, strong = pull >= thrust * 0.5;
    const colour = fall ? RED : heavy ? (time % 0.5 < 0.25 ? RED : AMBER) : strong ? AMBER : CYAN;
    text(`THE WELL ${(r / 1000).toFixed(1)} km`, x0, y0, 11, MUTED, 'left', 600);
    text(`PULL ${pull < 10 ? pull.toFixed(1) : pull.toFixed(0)} m/s²`, x0 + 180, y0, 11, colour, 'right', 600);
    bar(x0, y0 + 14, 180, pull / thrust, colour, null, false, 5);
    text(fall ? 'NO RETURN' : heavy ? 'PULL OVER THRUST · BURN OUT' : strong ? 'HEAVY PULL · KEEP CLIMBING' : `NO RETURN BELOW ${(well.radiusFor(thrust) / 1000).toFixed(1)} km`,
      x0, y0 + 32, 10, fall || heavy ? RED : strong ? AMBER : DIM, 'left', 600);
  }
  // A falling hulk's time to the horizon, worked out twice a second.
  let horizonFor = null, horizonAt = -1, horizonT = Infinity;
  const horizonOf = (world, e) => {
    if (horizonFor !== e || world.time - horizonAt > 0.5) {
      horizonFor = e; horizonAt = world.time;
      horizonT = world.well.timeToHorizon(e.ship.pos, e.ship.vel, { limit: 600 });
    }
    return horizonT;
  };

  /* The target panel, bottom centre: a window the target's picture is
     drawn into (target-view.js, through `viewRect`), its name and class,
     how far and how fast it is closing, its shield and hull, and the
     subsystem picked out on it. */
  let viewRect = null;
  function targetPanel(world, target, range) {
    const W = Math.min(340, w - 520), H = 104;
    if (!target || W < 250) return;
    const x = w / 2 - W / 2, y = h - H - 12;
    const colour = teamColour(target), dim = teamColour(target, true);
    panel(x, y, W, H);
    // The team's colour at the corners.
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + W, y, -1, 1], [x, y + H, 1, -1], [x + W, y + H, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * 10); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * 10, cy); ctx.stroke();
    }
    const pic = { x: x + 6, y: y + 6, w: 126, h: H - 12 };
    ctx.fillStyle = 'rgba(2, 6, 12, 0.6)'; ctx.fillRect(pic.x, pic.y, pic.w, pic.h);
    ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.strokeRect(pic.x + 0.5, pic.y + 0.5, pic.w - 1, pic.h - 1);
    viewRect = { x: pic.x * ui, y: pic.y * ui, w: pic.w * ui, h: pic.h * ui };
    const tx = pic.x + pic.w + 12, tw = x + W - 10 - tx;
    ctx.font = `700 14px ${FONT}`;
    let name = target.name.toUpperCase();
    while (name.length > 4 && measure(name) > tw) name = `${name.slice(0, -2)}…`;
    text(name, tx, y + 17, 14, colour, 'left', 700);
    text(target.proxy ? 'Torpedo in flight' : target.def?.type ?? '', tx, y + 33, 11, MUTED, 'left');
    const p = world.player.ship, t = target.ship;
    const km = range >= 1000 ? `${(range / 1000).toFixed(2)} km` : `${Math.round(range)} m`;
    text(km, tx, y + 53, 17, INK, 'left', 600);
    // Closing speed: how fast the range is falling (▼) or growing (▲).
    const dx = t.pos[0] - p.pos[0], dy = t.pos[1] - p.pos[1], dz = t.pos[2] - p.pos[2], d = Math.hypot(dx, dy, dz) || 1;
    const closing = -((t.vel[0] - p.vel[0]) * dx + (t.vel[1] - p.vel[1]) * dy + (t.vel[2] - p.vel[2]) * dz) / d;
    text(`${closing >= 0 ? '▼' : '▲'} ${Math.abs(closing).toFixed(0)} m/s`, x + W - 10, y + 54, 11, MUTED, 'right', 600);
    let by = y + 72;
    if (target.maxShield > 0) {
      bar(tx, by, tw, target.shield / target.maxShield, CYAN, null, false, 4);
      by += 9;
    }
    const hull = target.hull / Math.max(1, target.maxHull);
    bar(tx, by, tw, hull, hull < 0.3 ? RED : colour, null, false, 5);
    const sub = world.targetSub;
    if (sub && target.big) text(`▸ ${sub.name}${sub.alive === false ? ' · destroyed' : ''}`, tx, y + H - 11, 10, AMBER, 'left', 600);
    else if (world.well && !target.proxy) {
      const t = horizonOf(world, target);
      if (Number.isFinite(t)) text(`HORIZON IN ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, tx, y + H - 11, 10, t < 45 ? RED : AMBER, 'left', 600);
    }
  }

  function warnings(world) {
    const p = world.player, out = [];
    const hullF = p.hull / p.maxHull;
    if (hullF < 0.3) out.push(['HULL CRITICAL', RED, true]);
    else if (hullF < 0.5) out.push(['HULL DAMAGED', AMBER, false]);
    if (p.maxShield > 0 && p.shield < 1) out.push(['SHIELDS DOWN', AMBER, true]);
    let lockOnUs = false;
    const torps = new Map();
    for (const m of world.weapons.missiles) {
      if (m.team !== 1) continue;
      if (m.targetId === p.id) lockOnUs = true;
      if (m.hp > 0 && m.targetId != null) {
        const t = world.byId.get(m.targetId);
        if (t && t.team === 0) torps.set(t.name, (torps.get(t.name) ?? 0) + 1);
      }
    }
    if (lockOnUs) out.push(['MISSILE INBOUND', RED, true]);
    for (const [name, n] of torps) out.push([`TORPEDO${n > 1 ? `ES ×${n}` : ''} INBOUND → ${name.toUpperCase()}`, '#ff7a2a', true]);
    if (world.sentries.some(e => e.alive && e.alarmed && !e.folding)) out.push(['DETECTED', RED, false]);
    if (world.leaving) out.push(['LEAVING THE AREA OF OPERATIONS', AMBER, false]);
    let y = 34;
    for (const [s, colour, blink] of out.slice(0, 4)) {
      if (blink && time % 0.7 > 0.5) { y += 22; continue; }
      shadowed(() => text(s, w / 2, y, 15, colour, 'center', 700));
      y += 22;
    }
  }

  function feedback(world, camera, view, dt) {
    const cx = view.cursor ? (view.cursor[0] * 0.5 + 0.5) * w : w / 2, cy = view.cursor ? (view.cursor[1] * 0.5 + 0.5) * h : h / 2;
    // Hit markers on the crosshair.
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      m.age += dt;
      if (m.age > (m.kill ? 0.5 : 0.18)) { marks.splice(i, 1); continue; }
      const a = 1 - m.age / (m.kill ? 0.5 : 0.18);
      ctx.strokeStyle = m.kill ? `rgba(255, 60, 50, ${a})` : m.shield ? `rgba(160, 225, 255, ${a})` : `rgba(255, 190, 120, ${a})`;
      ctx.lineWidth = m.kill ? 3 : 2;
      const r0 = m.kill ? 10 : 8, r1 = m.kill ? 20 : 14;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(cx + dx * r0, cy + dy * r0); ctx.lineTo(cx + dx * r1, cy + dy * r1); }
      ctx.stroke();
    }
    // Where the hits on us come from: red arcs around the centre.
    for (let i = hurts.length - 1; i >= 0; i--) {
      const hr = hurts[i];
      hr.age += dt;
      if (hr.age > 1) { hurts.splice(i, 1); continue; }
      v.set(hr.from[0], hr.from[1], hr.from[2]).applyQuaternion(inv.copy(view.quaternion).invert());
      const a = Math.atan2(-v.y, v.x);
      ctx.strokeStyle = `rgba(255, 50, 40, ${0.8 * (1 - hr.age)})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.18, a - 0.3, a + 0.3); ctx.stroke();
    }
    // Score popups where the kills happened.
    for (let i = popups.length - 1; i >= 0; i--) {
      const pu = popups[i];
      pu.age += dt;
      if (pu.age > 1.6) { popups.splice(i, 1); continue; }
      let x = w / 2, y = h * 0.42;
      if (pu.pos) {
        const q = project(camera, pu.pos[0], pu.pos[1], pu.pos[2]);
        if (q.on) { x = q.x; y = q.y; }
      }
      const a = Math.min(1, pu.age * 8) * Math.min(1, (1.6 - pu.age) * 2);
      ctx.globalAlpha = a;
      shadowed(() => {
        label(`+${pu.points}${pu.mult > 1 ? `  ×${pu.mult}` : ''}`, x, y - 28 - pu.age * 30, pu.big ? 22 : 16, pu.mult > 1 ? AMBER : '#ffffff', 700, true);
        if (pu.label) label(pu.label, x, y - 10 - pu.age * 30, 11, MUTED, 600);
      });
      ctx.globalAlpha = 1;
    }
    if (streak) {
      streak.age += dt;
      if (streak.age > 1.4) streak = null;
      else {
        const a = Math.min(1, streak.age * 6) * Math.min(1, (1.4 - streak.age) * 2.5);
        const s = 1 + 0.25 * Math.max(0, 1 - streak.age * 5);
        ctx.globalAlpha = a;
        shadowed(() => text(streak.text, w / 2, h * 0.34, fitSize(streak.text, 26 * s, 700, TITLE), AMBER, 'center', 700, TITLE));
        ctx.globalAlpha = 1;
      }
    }
  }

  function vignette(world) {
    const p = world.player, hullF = p.hull / p.maxHull;
    if (!p.alive || hullF >= 0.3) return;
    const pulse = 0.35 + 0.25 * Math.sin(time * 6);
    const k = (1 - hullF / 0.3) * 0.6 + pulse * 0.4;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(255, 20, 10, 0)');
    g.addColorStop(1, `rgba(255, 20, 10, ${0.45 * k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* A hint, with the keys it names drawn as keys: {action} is whatever
     key the player has on that action, {mouse}, {leftClick} and
     {rightClick} the mouse. Laid out word by word, wrapped, each line
     centred. */
  const MOUSE = { mouse: 'Mouse', leftClick: 'Left click', rightClick: 'Right click' };
  const HINT_FONT = `500 13px ${FONT}`, CAP_FONT = `600 12px ${FONT}`;
  function hintLines(s, max) {
    const words = [];
    for (const piece of s.split(/(\{\w+\})/)) {
      const m = /^\{(\w+)\}$/.exec(piece);
      if (m && (MOUSE[m[1]] || keys[m[1]])) { words.push({ text: MOUSE[m[1]] ?? key(m[1]), cap: true }); continue; }
      for (const t of piece.split(/(\s+)/)) if (t) words.push({ text: t, space: /^\s+$/.test(t) });
    }
    for (const word of words) {
      ctx.font = word.cap ? CAP_FONT : HINT_FONT;
      word.width = word.space ? measure(' ') : measure(word.text) + (word.cap ? 14 : 0);
    }
    const lines = [];
    let line = [], width = 0;
    const end = () => {
      while (line.at(-1)?.space) width -= line.pop().width;
      if (line.length) lines.push({ words: line, width });
      line = []; width = 0;
    };
    for (const word of words) {
      if (word.space && !line.length) continue;
      if (!word.space && line.length && width + word.width > max) end();
      line.push(word); width += word.width;
    }
    end();
    return lines;
  }
  function hints(world) {
    const rt = world.mission;
    if (!rt?.hints.length) return;
    const now = rt.time;
    const hint = rt.hints.filter(x => x.at <= now && now < x.until).at(-1);
    if (!hint) return;
    const a = Math.min(1, (now - hint.at) * 4) * Math.min(1, (hint.until - now) * 2);
    const lines = hintLines(hint.text, Math.min(540, w * 0.6));
    // Above the ship and the crosshair over it, growing upward: never over
    // the fighter, the reticle or the instruments.
    const LINE = 24, width = Math.max(...lines.map(l => l.width)) + 40, tall = lines.length * LINE + 14;
    const y = h / 2 - 34 - tall;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(10, 18, 30, 0.75)'; ctx.fillRect(w / 2 - width / 2, y, width, tall);
    ctx.strokeStyle = 'rgba(127, 216, 255, 0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(w / 2 - width / 2 + 0.5, y + 0.5, width - 1, tall - 1);
    lines.forEach((l, i) => {
      let x = w / 2 - l.width / 2;
      const cy = y + 7 + LINE / 2 + i * LINE;
      for (const word of l.words) {
        if (word.cap) {
          // A key: a raised cap with its name on it.
          ctx.fillStyle = 'rgba(127, 216, 255, 0.16)'; ctx.strokeStyle = 'rgba(127, 216, 255, 0.8)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x + 1.5, cy - 10, word.width - 3, 20, 4); else ctx.rect(x + 1.5, cy - 10, word.width - 3, 20);
          ctx.fill(); ctx.stroke();
          text(word.text, x + word.width / 2, cy + 0.5, 12, '#ffffff', 'center', 600);
        } else if (!word.space) text(word.text, x, cy, 13, CYAN, 'left');
        x += word.width;
      }
    });
    ctx.globalAlpha = 1;
  }

  function centreText(dt) {
    for (let i = callouts.length - 1; i >= 0; i--) {
      const c = callouts[i];
      c.age += dt;
      if (c.age > 3) { callouts.splice(i, 1); continue; }
      const a = Math.min(1, c.age * 4) * Math.min(1, (3 - c.age) * 2);
      shadowed(() => text(c.message, w / 2, h * 0.24 + i * 26, 17, c.colour ? c.colour.replace('A', a) : `rgba(233, 237, 243, ${a})`, 'center', 600));
    }
    if (banner) {
      banner.age += dt;
      if (banner.age > banner.duration) { banner = null; return; }
      const a = Math.min(1, banner.age * 3, (banner.duration - banner.age) / 0.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(4, 8, 14, 0.55)'; ctx.fillRect(0, h * 0.4 - 46, w, 92);
      shadowed(() => {
        text(banner.title, w / 2, h * 0.4 - 10, fitSize(banner.title, 30, 700, TITLE), banner.colour, 'center', 700, TITLE);
        if (banner.sub) text(banner.sub, w / 2, h * 0.4 + 26, fitSize(banner.sub, 14, 500, FONT), INK, 'center');
      });
      ctx.globalAlpha = 1;
    }
  }

  return {
    resize,
    callout(message, colour = null) {
      // The same words already on screen just stay longer, they do not stack.
      const same = callouts.find(c => c.message === message);
      if (same) { same.age = 0; return; }
      callouts.push({ message, age: 0, colour }); if (callouts.length > 4) callouts.shift();
    },
    banner(title, sub, colour = INK, duration = Infinity) { banner = { title, sub, colour, age: 0, duration }; },
    clearBanner() { banner = null; },
    reset() { callouts.length = 0; popups.length = 0; marks.length = 0; hurts.length = 0; streak = null; banner = null; lastHull = null; objectivesNews = 0; },
    /* The simulation's events that the HUD shows. */
    handle(e, world) {
      switch (e.type) {
        case 'hitMarker': marks.push({ age: 0, kill: e.kill, shield: e.shield }); break;
        case 'score':
          popups.push({ points: e.points, mult: e.mult, label: e.label, pos: e.pos, age: 0, big: e.points >= 500 });
          if (e.streak >= 2) streak = { text: STREAK[Math.min(5, e.streak)] || `${e.streak}× STREAK`, age: 0 };
          break;
        case 'shipHit':
          if (e.id === world.player?.id && e.pos) {
            const p = world.player.ship.pos;
            hurts.push({ from: [e.pos[0] - p[0], e.pos[1] - p[1], e.pos[2] - p[2]], age: 0 });
            if (hurts.length > 6) hurts.shift();
          }
          break;
        case 'objective':
          objectivesNews = world.mission?.time ?? 0;
          if (e.state === 'done') this.callout(`${e.bonus ? 'BONUS · ' : ''}✓ ${e.text}`, 'rgba(93, 255, 143, A)');
          else if (e.state === 'failed') this.callout(`✕ ${e.text}`, 'rgba(255, 70, 60, A)');
          else if (e.state === 'active' && world.mission?.time > 0.5) this.callout(`${e.bonus ? 'BONUS · ' : 'NEW · '}${e.text}`, 'rgba(255, 224, 102, A)');
          break;
        case 'repairDenied':
          this.callout(e.reason === 'healthy' ? 'Tender only below half hull' : e.reason === 'none' ? 'No Tenders left' : 'A Tender is already on its way');
          break;
        case 'repairCalled': this.callout(`Tender ${e.fold ? 'folding in' : `launching${e.from ? ` from ${e.from}` : ''}`} · slow below ${TENDER.dockSpeed} m/s to dock`, 'rgba(93, 255, 143, A)'); break;
        case 'tenderDone': if (e.patientId === world.player?.id) this.callout('Repairs complete', 'rgba(93, 255, 143, A)'); break;
        case 'shieldsLevelled': this.callout('Shields levelled'); break;
        case 'bankChange': this.callout(`${SECONDARIES[e.weapon]?.name ?? e.weapon} selected`); break;
        case 'dryFire': this.callout(`${SECONDARIES[e.weapon]?.short ?? 'Bank'} empty${world.repair.charges > 0 ? ' · a Tender restocks' : ''}`); break;
        case 'wingOrder': this.callout(e.order === 'attack' ? `Wing: attacking ${e.target ?? 'your target'}` : e.order === 'form' ? 'Wing: forming up' : 'Wing: covering you', 'rgba(93, 255, 143, A)'); break;
      }
    },
    clear() { viewRect = null; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    // Where the target's picture goes this frame, in CSS pixels; null for none.
    get targetViewRect() { return viewRect; },
    setKeys(k) { keys = k; },
    draw(world, camera, view, dt) {
      if (!w) resize();
      time += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * ui, 0, 0, dpr * ui, 0, 0);
      const p = world.player;
      if (!p) return;
      // During the opening shot only the title, the radio and the
      // letterbox are drawn; the instruments come back as it ends. The
      // closing shot takes them away at once.
      const cine = view.cinematic ?? 0, instruments = cine < 0.5 && !view.closing;
      vignette(world);
      const fwdV = forwardV.set(0, 0, -1).applyQuaternion(view.quaternion);
      const fwd = [fwdV.x, fwdV.y, fwdV.z];
      const target = world.target && world.target.alive ? world.target : null;
      const range = target ? Math.max(1, Math.hypot(...target.ship.pos.map((c, i) => c - p.ship.pos[i])) - (target.big ? target.radius * 0.5 : 0)) : 1200;
      slots.length = 0;
      panels.length = 0;
      viewRect = null;
      if (instruments) {
        // The fixed panels along the bottom, claimed before the arrows.
        const R = Math.min(88, Math.max(58, h * 0.09)), wide = w >= 1000;
        panels.push([16, h - 150, 230, h], [w - 240, h - 168, w - 8, h]);
        panels.push(wide ? [234, h - 2 * R - 32, 242 + 2 * R + 8, h] : [12, h - 2 * R - 200, 2 * R + 24, h - 160]);
        if (target && Math.min(340, w - 520) >= 250) panels.push([w / 2 - 170, h - 116, w / 2 + 170, h - 12]);
      }
      // The directives (and under them the radio) first, so the arrows know
      // where they end.
      const directivesEnd = instruments ? directives(world) : 0;
      if (instruments) escorts(world);
      const chatter = radioPlan(world, directivesEnd);
      // Labels in the world keep off the panels too.
      slots.push(...panels);
      if (p.alive && instruments) {
        const pip = flightMarks(world, camera, view, fwd, range);
        // The target's labels first, so the others make room for them.
        if (target) targetBox(world, camera, view, pip, target, range);
        else if (world.entities.some(e => e.alive && e.team === 1 && !e.hidden)) text(`${key('cycleTarget')} · next hostile`, w / 2, h / 2 + 64, 12, MUTED);
        navMarker(world, camera);
        others(world, camera, target);
        scanAndSensors(world, camera, target);
        if (view.cursor) {
          const cx = (view.cursor[0] * 0.5 + 0.5) * w, cy = (view.cursor[1] * 0.5 + 0.5) * h;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(cx + dx * 5, cy + dy * 5); ctx.lineTo(cx + dx * 13, cy + dy * 13); }
          ctx.stroke();
        }
        feedback(world, camera, view, dt);
        radar(world, view);
        flightPanel(world);
        wellGauge(world);
        shipPanel(world);
        targetPanel(world, target, range);
        warnings(world);
      }
      if (instruments) {
        hints(world);
        if (world.missionDef?.id === 'survival') {
          text(`SCORE  ${world.score.toLocaleString('en')}`, w / 2 - 70, 26, 13, INK);
          text(`WAVE  ${world.wave}`, w / 2 + 70, 26, 13, INK);
        }
      }
      if (cine > 0) {
        const bar = Math.round(h * 0.1 * cine);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, bar);
        ctx.fillRect(0, h - bar, w, bar);
      }
      radio(chatter);
      centreText(dt);
    },
  };
}
