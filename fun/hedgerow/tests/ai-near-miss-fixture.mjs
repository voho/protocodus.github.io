// One reproducible actual player shot with real collision, damage and hearing.
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
const THREE = await import('three');
const { createWorld } = await import('../js/world.js');
const { createPlayer } = await import('../js/player.js');
const { createCameraRig } = await import('../js/camera.js');
const { DEFAULT_SETTINGS } = await import('../js/config.js');

const noop = () => {}, services = new Proxy({}, { get: () => noop });
export function nearMiss({ distance = 120, observed = false } = {}) {
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ minX: -120, maxX: 120, minZ: -220, maxZ: 180, terrain });
  const f = aiFixture({ world, terrain, player: [0, -distance], boxes: [
    { x: 0, y: 2, z: .8, hx: .25, hy: 2, hz: .2, surface: 'stone' },
    { x: 4, y: 2, z: 0, hx: .2, hy: 2, hz: 50, surface: 'stone' },
  ], definitions: [soldier(1.5, 0, { hold: true }), soldier(8, 0, { hold: true })] });
  const { G, enemies } = f;
  G.hud = services; G.effects = services; G.lights = services; G.audio = services; G.debris = services;
  G.level = { playBounds: world.bounds }; G.rig = createCameraRig(G.camera, world); G.enemies = enemies.list;
  Object.assign(G.stats, { shots: 0, hits: 0, headHits: 0, damageTaken: 0 });
  const impacts = [], noises = [], suppression = [];
  G.effects = new Proxy({ impact: (...args) => impacts.push(args) }, { get: (o, k) => o[k] || noop });
  G.events.on('noise', event => noises.push(event));
  const P = createPlayer(G); G.player = P;
  let realContact = null;
  if (observed) {
    P.reset([0, 40, 0]); const e = enemies.list[0];
    forceCombat(e, G); e.perceiveTimer = 0; advance(G, enemies, .05);
    if (!e.sees) throw new Error('The real-sighting control is occluded');
    realContact = { ...e.lastKnown };
  }
  P.reset([0, -distance, 0]); G.rig.pitch = 0; G.rig.aimT = 1; G.camera.position.set(0, 1.4, -distance);
  for (const e of enemies.list) {
    e.perceiveTimer = 1e6;
    const suppress = e.suppress;
    e.suppress = (duration, from) => { suppression.push({ id: e.id, duration, from: from?.toArray() }); suppress(duration, from); };
  }
  const input = { mouseL: true, mouseR: true, held: () => false, pressed: () => false, fired: () => true, consumeMouse: () => [0, 0], consumeWheel: () => 0 };
  // Zero cone radius makes the one actual player shot reproducible. Its
  // spread/recoil code still runs; no enemy or damage path is replaced.
  const ammoBefore = P.ammo[P.weapon].mag;
  const random = Math.random; Math.random = () => 0;
  try { G.time += 1 / 60; P.update(1 / 60, input, DEFAULT_SETTINGS); } finally { Math.random = random; }
  const snapshot = e => ({ id: e.id, health: e.health, suppressed: e.suppressed, state: e.state, lastSeen: e.lastSeen, lastKnown: e.lastKnown && { ...e.lastKnown }, contact: e.contact && { ...e.contact }, pendingContact: e.pendingContact });
  const beforeDelivery = enemies.list.map(snapshot);
  P.visible = 0; advance(G, enemies, 2);
  const record = { ammoBefore, ammoAfter: P.ammo[P.weapon].mag, shots: G.stats.shots, hits: G.stats.hits, source: P.pos.toArray(), impacts, noises, suppression, realContact, beforeDelivery, afterDelivery: enemies.list.map(snapshot) };
  return { ...f, P, record };
}
