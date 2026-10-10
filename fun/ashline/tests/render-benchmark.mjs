// Renderer workload report: counts Canvas 2D operations for one battlefield frame at three
// populations and times repeated draws. Counts are the stable signal; headless timings depend on
// the machine and on software rasterization, so they are reported, never asserted. This is a
// measurement tool, not a pass/fail check: run it alone, never alongside other browser checks.
// Run with ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs against a local server (ASHLINE_URL).
// ASHLINE_DPR (default 1), ASHLINE_DRAWS (timed draws per scene, default 12) and
// ASHLINE_SCREENSHOTS (optional output folder) adjust the run.
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const base = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const dpr = Number(process.env.ASHLINE_DPR || 1), draws = Number(process.env.ASHLINE_DRAWS || 12);
const output = process.env.ASHLINE_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/render-benchmark.html', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><body style="margin:0;background:#111b20"><canvas id="world" style="width:1440px;height:900px;display:block"></canvas><canvas id="minimap" style="position:fixed;right:12px;bottom:12px;width:200px;height:150px"></canvas></body>' }));
  await page.goto(new URL('render-benchmark.html', base).href);
  const scenes = {};
  for (const population of [0, 200, 2000]) {
    scenes[population] = await page.evaluate(async ({ population, draws }) => {
      const { startAssets, spriteNativeZoom } = await import('./assets.js');
      const { createGame, addEntity, raceUnit } = await import('./sim.js');
      const { Renderer } = await import('./render.js');
      await startAssets();
      const s = createGame('PERF-VAST-2026', 'normal', { width: 224, height: 168, profile: 'rift', races: ['organics', 'aiUnity'] });
      s.ai.nextThink = 1e12; s.time = 30;
      s.visible.forEach(grid => grid.fill(1)); s.explored.forEach(grid => grid.fill(1));
      const core = s.entities.find(e => e.team === 0 && e.kind === 'building');
      const zoom = spriteNativeZoom(1) * .75, view = { x: core.x + 6, y: core.y + 2, zoom, selected: new Set() };
      let seed = 7;
      const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const roles = ['rifle', 'rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'engineer', 'harvester'];
      const halfW = 1440 / zoom / 2 - 1, halfH = 900 / zoom / 2 - 1;
      for (let i = 0; i < population; i++) {
        const team = i % 2, role = roles[i % roles.length];
        const u = addEntity(s, team, 'unit', raceUnit(s, team, role), view.x + (next() * 2 - 1) * halfW, view.y + (next() * 2 - 1) * halfH);
        u.angle = next() * Math.PI * 2; u.moving = i % 3 === 0;
        if (i % 4 === 0) u.lastShot = s.time - .04;
        if (i % 7 === 0) u.hp = u.maxHp * .3;
        if (i % 11 === 0) u.lastHit = s.time - .02;
        if (i % 13 === 0) view.selected.add(u.id);
        if (role === 'harvester') u.cargo = (i * 37) % 201;
      }
      // A battle-sized effect load proportional to the population.
      for (let i = 0; i < population / 4; i++) {
        const x = view.x + (next() * 2 - 1) * halfW, y = view.y + (next() * 2 - 1) * halfH;
        const kind = i % 10, life = .1 + next() * .2;
        if (kind < 6) s.effects.push({ type: 'shot', weapon: 'rifle', x, y, tx: x + 3, ty: y + 1, life: .08, maxLife: .13, team: i % 2 });
        else if (kind < 8) s.effects.push({ type: 'rocket', weapon: 'rocket', x, y, tx: x + 4, ty: y - 2, life, maxLife: .4, team: i % 2, targetId: 0, attackerId: 0, damage: 1 });
        else if (kind < 9) s.effects.push({ type: 'shell', weapon: 'artillery', x, y, tx: x + 6, ty: y + 2, life: .2, maxLife: .35, team: i % 2 });
        else s.effects.push({ type: 'explosion', x, y, life: .3, maxLife: .6, team: i % 2, size: 1 });
      }
      const world = document.getElementById('world'), minimap = document.getElementById('minimap');
      const renderer = new Renderer(world, minimap);
      renderer.draw(s, view); renderer.draw(s, view);
      const proto = CanvasRenderingContext2D.prototype, counts = {}, originals = [];
      const methods = ['drawImage', 'save', 'restore', 'createRadialGradient', 'createLinearGradient', 'createPattern', 'fill', 'stroke', 'fillRect', 'strokeRect',
        'clearRect', 'ellipse', 'arc', 'rect', 'beginPath', 'clip', 'setTransform', 'translate', 'rotate', 'scale', 'fillText', 'getImageData', 'putImageData', 'setLineDash'];
      let main = false;
      for (const name of methods) {
        const original = proto[name]; originals.push([name, original]);
        proto[name] = function (...args) { const key = this === renderer.ctx ? name : `other.${name}`; counts[key] = (counts[key] || 0) + 1; return original.apply(this, args); };
      }
      const props = [];
      for (const name of ['shadowBlur', 'filter', 'globalCompositeOperation']) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name); props.push([name, descriptor]);
        Object.defineProperty(proto, name, { ...descriptor, set(value) {
          if ((name === 'shadowBlur' && value) || (name === 'filter' && value !== 'none') || name === 'globalCompositeOperation') {
            const key = this === renderer.ctx ? `${name}=` : `other.${name}=`; counts[key] = (counts[key] || 0) + 1;
          }
          descriptor.set.call(this, value);
        } });
      }
      // The full minimap rebuild runs on a wall-clock interval; measure the per-frame overlay path.
      renderer.lastMinimap = performance.now();
      renderer.draw(s, view);
      for (const [name, original] of originals) proto[name] = original;
      for (const [name, descriptor] of props) Object.defineProperty(proto, name, descriptor);
      const times = [];
      for (let i = 0; i < draws; i++) {
        renderer.lastMinimap = performance.now();
        const start = performance.now(); renderer.draw(s, view); renderer.ctx.getImageData(0, 0, 1, 1); times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const total = Object.entries(counts).reduce((sum, [key, value]) => key.startsWith('other.') ? sum : sum + value, 0);
      window.benchmarkRenderer = { renderer, s, view };
      return { units: s.entities.filter(e => e.kind === 'unit').length, effects: s.effects.length, mainOperations: total, counts,
        medianMs: +times[Math.floor(times.length / 2)].toFixed(2), meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) };
    }, { population, draws });
    if (output) await page.locator('#world').screenshot({ path: `${output}/render-benchmark-${population}.png` });
  }
  if (errors.length) throw new Error(errors.join('; '));
  const rows = Object.entries(scenes).map(([population, scene]) => ({ population: Number(population), units: scene.units, effects: scene.effects,
    drawImage: scene.counts.drawImage || 0, saves: scene.counts.save || 0, restores: scene.counts.restore || 0,
    radialGradients: scene.counts.createRadialGradient || 0, linearGradients: scene.counts.createLinearGradient || 0,
    ellipses: scene.counts.ellipse || 0, arcs: scene.counts.arc || 0, fills: scene.counts.fill || 0, strokes: scene.counts.stroke || 0,
    shadowBlur: scene.counts['shadowBlur='] || 0, filters: scene.counts['filter='] || 0, mainOperations: scene.mainOperations,
    medianMs: scene.medianMs, meanMs: scene.meanMs }));
  console.table(rows);
  console.log(JSON.stringify({ dpr, draws, scenes }, null, 2));
} finally { await browser.close(); }
