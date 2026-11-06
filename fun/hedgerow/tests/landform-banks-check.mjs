// Natural farm profiles must improve the actual height function while
// retaining the drain's covered floor and default engineered bank API.
import assert from 'node:assert/strict';
import { naturalDrain, organicBankProfile } from '../js/levels/landform-banks.js';
import { hedgeBanks, fieldDrain } from '../js/levels/kit.js';
const line = [[0, 0], [0, 80]], drain = naturalDrain(line, { depth: 0.95, half: 3 });
assert.equal(drain.cut(5, 0, 40), 4.05, 'the crouch-safe centre remains 0.95 m below its banks');
assert.equal(drain.cut(5, 0, 0), 5); assert.equal(drain.cut(5, 0, 80), 5, 'ends fade into the field without a step');
assert.ok(drain.cut(5, 0.4, 40) > 4.05, 'the bottom is rounded rather than a flat constant-width shelf');
assert.equal(drain.wet(1.5, 40), 0, 'upper shoulders are not painted as a uniformly wet mud chute');
assert.ok(drain.wet(0, 40) > 0.99);
let difference = 0, minHalf = Infinity, maxHalf = 0;
for (let s = 5; s < 75; s++) {
  const a = drain.profile(s, 1), b = drain.profile(s, -1);
  difference = Math.max(difference, Math.abs(a.half - b.half));
  minHalf = Math.min(minHalf, a.half, b.half); maxHalf = Math.max(maxHalf, a.half, b.half);
  for (const side of [-1, 1]) {
    let previous = drain.cut(5, 0, s);
    for (let d = 0.1; d <= 4.5; d += 0.1) {
      const h = drain.cut(5, d * side, s);
      assert.ok(h >= 4.05 && h <= 5);
      assert.ok(Math.abs(h - previous) < 0.09, 'the rounded shoulder has no hard cross-section seam'); previous = h;
    }
  }
}
assert.ok(difference > 0.5 && maxHalf - minHalf > 0.7, 'width/asymmetry change slowly along the ditch');
const old = hedgeBanks([line]), organic = hedgeBanks([line], { natural: true });
assert.equal(old.rise(0, 40), 0.85); assert.equal(old.rise(0.5, 40), 0.85, 'default engineered bank behaviour remains unchanged');
for (let z = 3; z < 77; z += 3) for (let x = -5; x < 5; x += 0.2) assert.equal(organic.dist(x, z), old.dist(x, z), 'organic crowns do not reshuffle seeded rough terrain by changing dist()');
const p = organicBankProfile(40, 0);
assert.ok(organic.rise(p.skew + 1.5, 40) < organic.rise(p.skew, 40) * 0.65, 'the bank crown is rounded rather than a flat plinth');
assert.ok(organic.rise(0, 0) < 1e-8, 'bank ends settle gently into the gate opening');
// In an endpoint Voronoi wedge both segments meet at the same closest
// vertex. Projected normal magnitudes can jump there; radial distance must
// remain continuous when the nearest segment changes.
const cornerLine = [[0, 0], [0, 20], [20, 20]], corner = naturalDrain(cornerLine);
assert.ok(Math.abs(corner.cut(5, -1e-5, 21) - corner.cut(5, 1e-5, 21)) < 1e-4, 'drain height is continuous through a corner Voronoi boundary');
const cornerBank = hedgeBanks([cornerLine], { natural: true });
assert.ok(Math.abs(cornerBank.rise(-1e-5, 21) - cornerBank.rise(1e-5, 21)) < 1e-4, 'earth crown is continuous through a corner Voronoi boundary');
for (const x of [-1e-5, 0, 1e-5]) {
  assert.ok(Math.abs(corner.cut(5, x, 21) - corner.cut(5, -1e-5, 21)) < 1e-4, 'the exact endpoint tangent has no drain spike');
  assert.ok(Math.abs(cornerBank.rise(x, 21) - cornerBank.rise(-1e-5, 21)) < 1e-4, 'the exact endpoint tangent has no crown spike');
}
const legacy = fieldDrain(line, { depth: 0.95, half: 3 });
assert.equal(legacy.cut(5, 0, 40), 4.05); assert.equal(legacy.cut(5, 0.4, 40), 4.05, 'the original drain API stays unchanged for other authored uses');
console.log(`landform-banks-check: rounded earth crowns, ${minHalf.toFixed(2)}–${maxHalf.toFixed(2)} m drain half-widths, narrow wet thalweg and preserved default/seed contracts pass`);
