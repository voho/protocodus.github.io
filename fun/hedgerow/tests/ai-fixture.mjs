// Minimal runtime for behavior checks. The collision and navigation code are
// the game's own; render/audio sinks record effects without needing WebGL.
import './three-hooks.mjs';
const THREE = await import('three');
const { createWorld } = await import('../js/world.js');
const { createEnemies, buildCoverPoints } = await import('../js/ai.js');

const noop = new Proxy({}, { get: () => () => {} });
export const soldier = (x, z, extra = {}) => ({ type: 'rifle', at: [x, z], yaw: 0, group: 'squad', leash: 18, ...extra });

export function aiFixture({ player = [0, 30], boxes = [], world = null, terrain = null, level = null, nav = null, definitions = [] } = {}) {
  terrain ||= world?.terrain || { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  world ||= createWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 180, terrain });
  for (const box of boxes) world.add({ type: 'box', yaw: 0, ...box });
  const handlers = new Map(), shots = [], hits = [], thrown = [];
  const G = {
    world, terrain, level, nav, cover: buildCoverPoints(world, terrain), time: 0, lightning: 0,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    camera: new THREE.PerspectiveCamera(70, 1.6, 0.1, 1000),
    player: { pos: new THREE.Vector3(player[0], world.groundAt(player[0], player[1], 1e4, 0.5), player[1]), vel: new THREE.Vector3(), alive: true, visible: 1, movingSpeed: 0, damage: (...args) => hits.push(args) },
    events: { on(k, f) { if (!handlers.has(k)) handlers.set(k, []); handlers.get(k).push(f); }, emit(k, a) { for (const f of handlers.get(k) || []) f(a); } },
    effects: noop, lights: noop, audio: new Proxy({ gunshot: (...args) => shots.push(args) }, { get: (o, k) => o[k] || (() => {}) }),
    rig: { yaw: 0, addShake() {} }, hud: { awareness() {} },
    shared: { wet: { value: 1 }, time: { value: 0 }, rain: { value: 1 } },
    explosives: { list: [], throwGrenade: (...args) => thrown.push(args) },
    diff: { aware: 1, accuracy: 1, damage: 1 }, stats: { kills: 0, headshots: 0 },
  };
  G.camera.position.copy(G.player.pos).add(new THREE.Vector3(0, 2, -4));
  const enemies = createEnemies(G, definitions);
  for (const e of enemies.list) {
    // Tactical assertions should not depend on the fallback rig's arm pose.
    e.char.muzzleWorld = out => out.set(e.pos.x + Math.sin(e.yaw) * 0.5, e.pos.y + 1.35, e.pos.z + Math.cos(e.yaw) * 0.5);
    e.char.boneWorld = (_name, out) => out.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
  }
  return { G, enemies, shots, hits, thrown };
}

export function advance(G, enemies, seconds, each = null, dt = 1 / 30) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    G.time += dt;
    enemies.update(dt);
    if (each?.(i * dt) === false) break;
  }
}

export function forceCombat(e, G, { phase = 'open', memory = null } = {}) {
  Object.assign(e, { state: 'combat', phase, phaseTimer: 100, awareness: 1, sees: false, exposure: 0, lastSeen: G.time, lastKnown: memory || { x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z }, tacticTimer: 100, aimTimer: 0.6, fireTimer: 0 });
}
