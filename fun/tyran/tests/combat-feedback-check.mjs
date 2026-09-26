import assert from 'node:assert/strict';
import { CombatFeedback } from '../combat-feedback.js';

let checks = 0;
function check(name, test) { test(); checks++; console.log(`PASS ${name}`); }
const state = (score = 0, credits = 0) => ({ score, credits, combo: 0, comboTime: 0, comboLabel: '' });
const near = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} is approximately ${b}`);

check('authoritative deltas include overlapping rewards exactly once and account for spending', () => {
  const s = state(1000, 500), feedback = new CombatFeedback(); feedback.reset(s);
  s.score += 475; s.credits += 86;
  feedback.collect(s, [
    { type: 'explosion', value: 300 }, { type: 'explosion', ground: true, value: 45 },
    { type: 'combo', combo: 3, value: 9000 }, { type: 'pickup', bonus: 'credit', value: '+41' },
    { type: 'squadron', bonus: 175 },
  ]);
  assert.equal(feedback.score, 475); assert.equal(feedback.credits, 86);
  assert.equal(feedback.details, 'Squadron cleared');
  const revision = feedback.revision; feedback.collect(s, []);
  assert.equal(feedback.revision, revision); assert.equal(feedback.score, 475); assert.equal(feedback.credits, 86);
  s.credits -= 400; feedback.collect(s, []);
  assert.equal(feedback.credits, 86); assert.equal(feedback.revision, revision, 'Spending changes only the baseline');
  s.credits += 30; feedback.collect(s, []);
  assert.equal(feedback.credits, 116, 'A gain after spending is still counted');
});

check('a rolling burst holds briefly, fades slowly, and refreshes on a new gain', () => {
  const s = state(), feedback = new CombatFeedback(); feedback.reset(s);
  s.score = 100; feedback.collect(s, []);
  const revision = feedback.revision;
  assert.equal(feedback.opacity, 1); feedback.update(.25); assert.equal(feedback.opacity, 1);
  feedback.update(1.875); near(feedback.opacity, .5);
  assert.equal(feedback.revision, revision, 'Fading alone never requests a content rerender');
  s.score += 50; feedback.collect(s, []);
  assert.equal(feedback.score, 150); assert.equal(feedback.opacity, 1);
  feedback.update(3.99); assert(feedback.visible); assert(feedback.opacity > 0);
  const beforeExpiry = feedback.revision; feedback.update(.01);
  assert.equal(feedback.visible, false); assert.equal(feedback.opacity, 0);
  assert.equal(feedback.score, 0); assert.equal(feedback.credits, 0); assert.equal(feedback.details, '');
  assert.equal(feedback.revision, beforeExpiry + 1);
  s.credits += 12; feedback.collect(s, []);
  assert.equal(feedback.score, 0); assert.equal(feedback.credits, 12); assert.equal(feedback.opacity, 1);
});

check('recognized notices refresh the burst and remain bounded to latest distinct types', () => {
  const s = state(), feedback = new CombatFeedback(); feedback.reset(s);
  feedback.collect(s, [{ type: 'pickup', bonus: 'repair' }]); feedback.update(3);
  feedback.collect(s, [{ type: 'nova', cancels: 90 }, { type: 'nova', cancels: 9000 }]);
  assert.equal(feedback.opacity, 1); assert.equal(feedback.details, 'Nova ×2 · Repair');
  feedback.collect(s, [{ type: 'rescue' }, { type: 'pickup', bonus: 'power' }, { type: 'squadron' }]);
  assert.equal(feedback.details, 'Squadron cleared · Power core · Drone rescued · +2 more');
  feedback.collect(s, [{ type: 'pickup', bonus: 'repair' }]);
  assert.equal(feedback.details, 'Repair ×2 · Squadron cleared · Power core · +2 more');
  const known = feedback.details, revision = feedback.revision;
  feedback.update(1);
  feedback.collect(s, Array.from({ length: 10000 }, (_, index) => ({ type: `unknown-${index}`, label: 'arbitrary', value: 1000 })));
  feedback.collect(s, [{ type: 'pickup', bonus: '__proto__' }, { type: 'pickup', bonus: 'credit', value: 9999 }]);
  assert.equal(feedback.details, known); assert.equal(feedback.revision, revision);
  near(feedback.opacity, .8); assert.equal(feedback.score, 0); assert.equal(feedback.credits, 0);
  feedback.update(3); assert.equal(feedback.details, ''); assert.equal(feedback.visible, false);
});

check('combo text follows live state and its end never extends the fade', () => {
  const s = state(), feedback = new CombatFeedback(); feedback.reset(s);
  Object.assign(s, { score: 100, combo: 3, comboTime: 2, comboLabel: 'Triple kill' });
  feedback.collect(s, [{ type: 'combo', combo: 99, label: 'Stale combo', value: 9999 }]);
  assert.equal(feedback.chain, 3); assert.equal(feedback.label, 'Triple kill'); assert.equal(feedback.score, 100);
  feedback.update(2); const opacity = feedback.opacity, revision = feedback.revision;
  s.comboTime = 0; feedback.collect(s, [{ type: 'combo-end' }]);
  assert.equal(feedback.chain, 0); assert.equal(feedback.label, 'Rewards'); assert.equal(feedback.opacity, opacity);
  assert.equal(feedback.revision, revision + 1); feedback.update(2); assert.equal(feedback.visible, false);
  s.combo = 8; s.comboTime = 1; s.comboLabel = 'Mega kill'; feedback.collect(s, []);
  assert.equal(feedback.chain, 8); assert.equal(feedback.visible, false, 'Metadata alone does not create a reward burst');
});

check('a higher explicit combo refreshes feedback even after numeric counters saturate', () => {
  const s = state(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), feedback = new CombatFeedback(); feedback.reset(s);
  Object.assign(s, { combo: 2, comboTime: 2, comboLabel: 'Double kill' });
  feedback.collect(s, [{ type: 'combo', value: 9999 }]);
  assert.equal(feedback.visible, true); assert.equal(feedback.opacity, 1);
  assert.equal(feedback.score, 0); assert.equal(feedback.credits, 0, 'Combo payloads never create another numeric reward');
  feedback.update(2); const faded = feedback.opacity, revision = feedback.revision;
  s.comboTime = 1.5; feedback.collect(s, []);
  assert.equal(feedback.opacity, faded); assert.equal(feedback.revision, revision);
  feedback.collect(s, [{ type: 'combo' }]); assert.equal(feedback.opacity, faded, 'The same combo cannot continually restart the timer');
  Object.assign(s, { combo: 3, comboTime: 2, comboLabel: 'Triple kill' });
  feedback.collect(s, [{ type: 'combo' }]);
  assert.equal(feedback.opacity, 1); assert.equal(feedback.chain, 3); assert.equal(feedback.label, 'Triple kill');
  assert.equal(feedback.score, 0); assert.equal(feedback.credits, 0);
});

check('reset establishes a fresh baseline, and absent baselines never count old campaign rewards', () => {
  const s = state(50000, 1000), feedback = new CombatFeedback();
  feedback.collect(s, []); assert.equal(feedback.visible, false);
  s.score += 80; feedback.collect(s, [{ type: 'captured' }]); assert.equal(feedback.score, 80);
  const revision = feedback.revision; feedback.reset(s);
  assert.equal(feedback.revision, revision + 1); assert.equal(feedback.visible, false);
  assert.equal(feedback.score, 0); assert.equal(feedback.credits, 0); assert.equal(feedback.details, '');
  assert.equal(feedback.chain, 0); assert.equal(feedback.label, 'Rewards');
  s.credits += 5; feedback.collect(s, []); assert.equal(feedback.credits, 5);
  feedback.reset(); feedback.collect(s, []); assert.equal(feedback.visible, false);
});

check('numeric totals saturate and extra-ship overflow cannot double-count credits', () => {
  const s = state(), feedback = new CombatFeedback(); feedback.reset(s);
  s.score = s.credits = Number.MAX_SAFE_INTEGER; feedback.collect(s, [{ type: 'extra-life', credits: 600, value: 9999 }]);
  assert.equal(feedback.score, Number.MAX_SAFE_INTEGER); assert.equal(feedback.credits, Number.MAX_SAFE_INTEGER);
  assert.equal(feedback.details, 'Reserve bonus');
  s.score = s.credits = 0; feedback.collect(s, []);
  s.score = s.credits = Infinity; feedback.collect(s, [{ type: 'extra-life' }]);
  assert.equal(feedback.score, Number.MAX_SAFE_INTEGER); assert.equal(feedback.credits, Number.MAX_SAFE_INTEGER);
  assert.equal(feedback.details, 'Extra ship · Reserve bonus');
});

check('pause belongs to the caller and invalid time cannot advance or reverse the burst', () => {
  const s = state(), feedback = new CombatFeedback(); feedback.reset(s);
  feedback.collect(s, [{ type: 'power-lost' }]);
  const revision = feedback.revision;
  for (const dt of [0, -1, NaN, Infinity]) feedback.update(dt);
  assert.equal(feedback.opacity, 1); assert.equal(feedback.revision, revision);
  feedback.collect(s, []); assert.equal(feedback.opacity, 1, 'Collecting unchanged paused state never ages the burst');
  feedback.update(20); assert.equal(feedback.visible, false);
  const expired = feedback.revision; feedback.update(20); assert.equal(feedback.revision, expired);
});

console.log(`${checks} combat feedback checks passed.`);
