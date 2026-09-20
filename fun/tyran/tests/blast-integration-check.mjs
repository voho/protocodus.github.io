// Exercise both structure-destruction paths through the real game event loop.
// Serve the repo root; run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  const results = await page.evaluate(async () => {
    const { applyStructureBlast } = await import('./sim.js');
    const results = [], originalHit = tyran.world.hit;
    try {
      for (const trigger of ['projectile', 'airborne explosion']) {
        tyran.launch();
        const state = tyran.state, pilot = state.players[0];
        Object.assign(state, { spawnTimer: Infinity, formationTimer: Infinity, showcase: 9, duration: 1e6, events: [] });
        Object.assign(pilot, { x: 660, y: 550, px: 660, py: 550, vx: 0, vy: 0, blastVx: 0, blastVy: 0, hurt: Infinity });
        const structure = { id: 'large-building', x: 600, y: 550, size: 80, footprint: 80, structural: true, blastRadius: 200, value: 12 };
        // A single controlled destruction result keeps terrain placement out of
        // this test while exercising the real collision callback and FX events.
        let destroyed = false, hitCalls = 0;
        tyran.world.hit = () => { hitCalls++; if (destroyed) return []; destroyed = true; return [structure]; };
        const expectedState = structuredClone(state);
        applyStructureBlast(expectedState, structure);
        const expected = { x: expectedState.players[0].blastVx, y: expectedState.players[0].blastVy };
        if (trigger === 'projectile') state.bullets.push({ x: 600, y: 550, px: 600, py: 550, vx: 0, vy: -300,
          radius: 4, damage: 1000, team: 0, life: 1, age: 0, kind: 'pulse', color: '#9cfff0' });
        else state.events.push({ type: 'explosion', x: 600, y: 550, size: 35 });
        tyran.step(1 / 60);
        const impulse = { x: pilot.blastVx, y: pilot.blastVy };
        const hull = pilot.hull, shield = pilot.shield, credits = state.credits;
        // The already-created ground FX event must never apply another shove.
        state.events.push({ type: 'explosion', ...structure, ground: true });
        tyran.step(1 / 60);
        results.push({ trigger, expected, impulse, decayed: { x: pilot.blastVx, y: pilot.blastVy }, hitCalls,
          destroyed: state.destroyed, credits, finalCredits: state.credits, damage: hull - pilot.hull + shield - pilot.shield });
      }
    } finally { tyran.world.hit = originalHit; }
    return results;
  });
  for (const result of results) {
    assert.ok(result.expected.x > 0, `${result.trigger}: the fixture is within shove range`);
    assert.ok(Math.abs(result.impulse.x - result.expected.x) < 1e-9 && Math.abs(result.impulse.y - result.expected.y) < 1e-9,
      `${result.trigger}: destruction applies exactly one outward impulse`);
    assert.ok(Math.abs(result.decayed.x - result.impulse.x * Math.exp(-1 / 60 / .28)) < 1e-9,
      `${result.trigger}: ground FX does not replay the impulse`);
    assert.equal(result.hitCalls, result.trigger === 'projectile' ? 2 : 1, 'ground FX does not run another scenery collision pass');
    assert.equal(result.destroyed, 1); assert.equal(result.credits, 12); assert.equal(result.finalCredits, 12);
    assert.equal(result.damage, 0, `${result.trigger}: shove remains non-damaging`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS direct projectile and airborne-explosion structure destruction each apply one non-damaging shove');
} finally { await browser.close(); }
