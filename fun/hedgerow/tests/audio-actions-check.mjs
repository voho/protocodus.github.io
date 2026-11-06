// Render simulation-triggered mechanics with real Web Audio. The fixture
// uses main's ordering: advance existing actions, then create a new shot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Simulation mechanics</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async mode => {
    const [{ createSimulationActions }, { KAR98K_ACTION_TIMING }] = await Promise.all([
      import('/fun/hedgerow/js/audio-actions.js'), import('/fun/hedgerow/js/weapon-action-timing.js'),
    ]);
    const ctx = new OfflineAudioContext(1, 44100 * 6, 44100);
    let clock = 0, state = 'running', allocated = 0;
    Object.defineProperty(ctx, 'currentTime', { get: () => clock });
    Object.defineProperty(ctx, 'state', { get: () => state });
    const queue = createSimulationActions({ ctx, output: ctx.destination });
    const fired = [], events = Object.entries(KAR98K_ACTION_TIMING.shot).filter(([name]) => name !== 'eject');
    const synth = (output, when) => {
      allocated++;
      const source = ctx.createOscillator(), gain = ctx.createGain(); source.frequency.value = 1000;
      gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(.1, when + .002);
      gain.gain.linearRampToValueAtTime(0, when + .025);
      source.connect(gain).connect(output); source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(when); source.stop(when + .03); return source;
    };
    const factor = mode === 'slow' ? 4 : 1;
    // Existing mechanics advance before a shot is born in player.update.
    clock = .05 * factor; queue.advance(.05);
    const born = clock, action = queue.create();
    for (const [name, at] of events) action.at(at, (out, when) => { fired.push({ name, when, age: action.elapsed }); return synth(out, when); });
    const birth = { ...queue.status, allocated, age: action.elapsed };
    let beforeFirst, held;
    if (mode === 'budget') {
      for (let i = 1; i < 100; i++) queue.create().at(.34, synth);
    } else if (mode === 'cue-budget') {
      queue.cancel(); const many = queue.create();
      for (let i = 0; i < 100; i++) many.at(.34, synth);
    }
    const bounded = queue.status;
    for (let frame = 1; frame <= 20; frame++) {
      clock = born + frame * .05 * factor;
      if (mode === 'pause' && frame === 4) {
        const before = { ...queue.status, age: action.elapsed };
        state = 'suspended'; queue.advance(2); state = 'running';
        held = { before, after: { ...queue.status, age: action.elapsed } };
      }
      queue.advance(.05);
      if (frame === 6) beforeFirst = { ...queue.status, allocated };
      if (mode === 'cancel' && frame === 8) queue.cancel();
    }
    const dispatched = queue.status;
    const buffer = await ctx.startRendering(), data = buffer.getChannelData(0);
    const energy = (from, to) => {
      let sum = 0, peak = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) { sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i])); }
      return { rms: Math.sqrt(sum / ((to - from) * 44100)), peak };
    };
    return { born, birth, beforeFirst, held, bounded, dispatched, final: queue.status, fired,
      early: energy(.1, mode === 'slow' ? 1.5 : .38), first: energy(mode === 'slow' ? 1.6 : .4, mode === 'slow' ? 1.65 : .44),
      later: energy(.5, 5.8) };
  }, mode);
  const normal = await render('normal'), slow = await render('slow'), paused = await render('pause'), cancelled = await render('cancel');
  const budget = await render('budget'), cueBudget = await render('cue-budget');
  for (const result of [normal, slow, paused]) {
    assert.equal(result.birth.age, 0, 'a shot born after the main step receives its full mechanical lead-in');
    assert.equal(result.birth.allocated, 0); assert.equal(result.birth.pending, 3);
    assert.equal(result.beforeFirst.allocated, 0, 'no audio source starts before the simulation reaches bolt lift');
    assert.equal(result.early.peak, 0); assert.ok(result.first.rms > .005);
    assert.equal(result.dispatched.dispatched, 3);
  }
  assert.ok(Math.abs(normal.fired[0].when - .401) < .00001);
  assert.ok(Math.abs(slow.fired[0].when - 1.601) < .00001, '4x slower wall-clock rendering keeps the cue on the same simulation pose');
  assert.deepEqual(paused.held.before, paused.held.after, 'an accidental advance during suspended audio changes no pending cue or age');
  assert.ok(cancelled.first.rms > .005); assert.equal(cancelled.later.peak, 0, 'switch/death/reset cancellation removes later bolt actions');
  assert.equal(cancelled.dispatched.pending, 0); assert.equal(cancelled.dispatched.dispatched, 1);
  assert.equal(budget.bounded.active, 4); assert.equal(budget.bounded.evicted, 96);
  assert.equal(cueBudget.bounded.pending, 32); assert.equal(cueBudget.bounded.rejected, 68);
  for (const result of [normal, slow, paused, cancelled, budget, cueBudget]) assert.equal(result.final.active + result.final.pending + result.final.sources, 0);
  console.log(`audio-actions-check: real PCM normal/4x-slow simulation cues, main birth ordering, suspended advance, cancellation, 4-action/32-cue limits and cleanup pass`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
