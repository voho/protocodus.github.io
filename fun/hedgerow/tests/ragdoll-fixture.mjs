// Real shipped rig with simple instances of the game's actual collider world.
import { parseUntexturedGLB } from './rig-fixture.mjs';
const THREE = await import('three');
const { createCharacter } = await import('../js/character.js');
const { createWorld } = await import('../js/world.js');
const soldier = await parseUntexturedGLB('soldier');
const material = new THREE.MeshBasicMaterial(), matlib = { get: () => material, resolve: value => value || material };

export const RAGDOLL_CASES = ['standing', 'crouched', 'head-hit', 'wall', 'steps', 'slope', 'platform-blast'];
export function ragdollFixture(name, { onImpact } = {}) {
  const height = name === 'slope' ? (x, z) => .12 * z : () => 0;
  const terrain = { height, surfaceAt: () => 'stone', raycast: () => Infinity };
  const world = createWorld({ minX: -25, maxX: 25, minZ: -25, maxZ: 25, terrain });
  const box = (x, z, hx, hz, top) => world.add({ type: 'box', x, y: top / 2, z, hx, hy: top / 2, hz, yaw: 0, surface: 'stone' });
  if (name === 'wall') box(0, 1.2, 2, .2, 3);
  if (name === 'steps') { box(0, 1, 2, .3, .3); box(0, 1.6, 2, .3, .6); box(0, 2.2, 2, .3, .9); }
  if (name === 'platform-blast') box(0, 0, .7, .7, 1.2);
  const char = createCharacter(soldier, matlib, { scene: new THREE.Scene() });
  char.root.position.y = world.groundAt(0, 0, 1e4);
  char.animate(name === 'crouched' ? 'crouch_idle' : 'idle', 'rifle_ready'); char.update(.5, char.root.position.y);
  const impulse = name === 'platform-blast' ? { part: 'all', vel: new THREE.Vector3(2, 3, 2.5) }
    : name === 'head-hit' ? { part: 'head', vel: new THREE.Vector3(1.5, .4, -2.6) }
      : { part: 'body', vel: new THREE.Vector3(0, .4, 3.4) };
  char.die('death_fwd', { world, velocity: new THREE.Vector3(), impulses: [impulse], onImpact });
  const rd = char.ragdoll, start = rd.positions.map(position => position.clone());
  let queries = 0;
  const groundAt = world.groundAt;
  world.groundAt = (...args) => { queries++; return groundAt(...args); };
  return { char, rd, world, terrain, start, get queries() { return queries; } };
}
