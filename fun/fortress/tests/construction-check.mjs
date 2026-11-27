import assert from 'node:assert/strict';
import Matter from '../vendor/matter.min.js';
import { buildJoints, updateJoints } from '../joints.js';
import { FortressSimulation } from '../simulation.js';
import './material-profile-check.mjs';

const { Bodies, Body, Engine, Composite } = Matter;
function timber(x, y, width, height, angle = 0) {
  return { kind: 'block', material: 'wood', detail: 'beam', damage: 0, burn: 0, width, height,
    body: Bodies.rectangle(x, y, width, height, { angle, frictionAir: 0 }) };
}

function shove(skew, speed, burn = 0) {
  const angle = skew * Math.PI / 180, post = timber(0, 0, 12, 50);
  const beam = timber(0, -25 - 5 * Math.cos(angle) - 6 * Math.sin(angle), 64, 10, angle);
  post.burn = burn;
  const joints = buildJoints([post, beam]);
  const assembled = joints.size;
  const engine = Engine.create({ gravity: { x: 0, y: 0 } });
  Composite.add(engine.world, [post.body, beam.body]);
  Body.setVelocity(beam.body, { x: speed, y: 0 });
  for (let i = 0; i < 120; i++) {
    updateJoints(joints);
    Engine.update(engine, 1000 / 120);
  }
  return { assembled, remaining: joints.size,
    distance: Matter.Vector.magnitude(Matter.Vector.sub(post.body.position, beam.body.position)),
    travel: post.body.position.x };
}

const square = shove(0, 4);
assert.equal(square.remaining, 1);
assert.ok(square.distance < 31 && square.travel > 50, 'The seated timber frame carries its post with it');
assert.equal(shove(14, 1).remaining, 1, 'A skewed bearing can hold a light shove');
assert.equal(shove(14, 4).remaining, 0, 'The same shove tears apart the narrower skewed seat');
assert.equal(shove(0, 4, .8).remaining, 0, 'Charcoal loses its grip');
assert.ok(shove(0, 12).distance > 100, 'A hard hit pulls even a square joint apart');
assert.equal(shove(40, 1).assembled, 0, 'Steeply skewed pieces are loose');
const rail = timber(0, 0, 100, 12);
assert.equal(buildJoints([rail, timber(0, 12, 90, 12)]).size, 0);
assert.equal(buildJoints([rail, timber(0, -30, 12, 40)]).size, 0, 'An air gap leaves pieces independent');
assert.equal(buildJoints([rail, { ...timber(0, -26, 12, 40), kind: 'fragment' }]).size, 0);

const fort = new FortressSimulation('medium', 6);
assert.ok(fort.joints.size > 20);
const member = [...fort.joints][0].a, neighbors = [...member.joints];
fort.remove(member);
assert.ok(neighbors.every((j) => !fort.joints.has(j) && !j.b.joints.has(j) && !j.a.joints.has(j)));
fort.loadLevel('small', 6, 2);
assert.equal(fort.joints.size, 0, 'Historical sieges keep their original physics on a retry');
console.log('Fortress construction passed material profiles, joint strength, shear, heat and removal.');
