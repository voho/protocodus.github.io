// A real torso collision, rather than the death's estimated wall-clock delay.
import assert from 'node:assert/strict';
import { ragdollFixture, RAGDOLL_CASES } from './ragdoll-fixture.mjs';
const state = fixture => fixture.rd.positions.map(position => position.toArray());
const results = [];
for (const name of RAGDOLL_CASES) {
  let reference;
  for (const fps of [60, 20, 120, 240]) {
    const hits = [], fixture = ragdollFixture(name, { onImpact: hit => hits.push(hit) }), ordinary = ragdollFixture(name);
    let materialQueries = 0;
    const surfaceUnder = fixture.world.surfaceUnder;
    fixture.world.surfaceUnder = (...args) => { materialQueries++; return surfaceUnder(...args); };
    for (let frame = 0; frame < fps * 6; frame++) {
      fixture.char.update(1 / fps, 0); ordinary.char.update(1 / fps, 0);
      assert.deepEqual(state(fixture), state(ordinary), `${name}: observing contact leaves physics unchanged`);
    }
    assert.equal(hits.length, 1, `${name}/${fps}: exactly one meaningful torso contact`);
    assert.equal(materialQueries, 1, 'material is queried only at the contact');
    assert.equal(fixture.queries, ordinary.queries, 'the callback adds no floor traces');
    assert.ok(['pelvis', 'spine', 'chest'].includes(hits[0].part));
    assert.ok(hits[0].time > .04 && hits[0].speed > .45 && hits[0].speed < 20);
    assert.ok(Object.isFrozen(hits[0]));
    if (reference) assert.deepEqual(hits, reference, `${name}: callback payload is independent of presentation cadence`);
    else reference = hits;
  }
  results.push({ name, ...reference[0] });
}
assert.ok(results.find(result => result.name === 'platform-blast').time > 1, 'a blast off a platform retains its long visible flight');
assert.ok(results.find(result => result.name === 'steps').y > .25, 'stairs use the actual raised contact surface');
assert.equal(results.find(result => result.name === 'crouched').part, 'chest', 'crouched chest contact can precede the pelvis');

for (const cancel of ['dispose', 'cancelImpact']) {
  const hits = [], fixture = ragdollFixture('standing', { onImpact: hit => hits.push(hit) });
  for (let i = 0; i < 120; i++) fixture.rd.step(0);
  assert.equal(hits.length, 0, 'pause cannot invent a body impact');
  fixture.rd.step(1 / 60);
  if (cancel === 'dispose') fixture.char.dispose(); else { fixture.rd.cancelImpact(); fixture.rd.cancelImpact(); }
  for (let i = 0; i < 720; i++) fixture.rd.step(1 / 120);
  assert.equal(hits.length, 0, `${cancel} removes the pending callback`);
}
{
  const hits = [], fixture = ragdollFixture('wall', { onImpact: hit => hits.push(hit) });
  fixture.terrain.height = () => -50;
  for (let i = 0; i < 60; i++) fixture.rd.step(1 / 120);
  assert.equal(hits.length, 0, 'horizontal wall push-outs cannot trigger a floor impact');
}
{
  const hits = [], fixture = ragdollFixture('standing', { onImpact: hit => hits.push(hit) });
  fixture.terrain.height = () => 1.6;
  fixture.rd.step(1 / 120);
  assert.equal(hits.length, 0, 'initial torso penetration has no meaningful incoming fall');
}
{
  const hits = [], fixture = ragdollFixture('standing', { onImpact: hit => hits.push(hit) });
  fixture.world.surfaceUnder = () => 'water';
  for (let i = 0; i < 720; i++) fixture.rd.step(1 / 120);
  assert.equal(hits[0].surface, 'water');
}
console.log('ragdoll-contact-check: seven real-rig contacts at20–240Hz, unchanged physics, one surface lookup, actual stair height, crouched chest, blast flight, pause/dispose/cancel and penetration/wall suppression pass');
