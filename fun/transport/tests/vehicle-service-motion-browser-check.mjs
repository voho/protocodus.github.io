// Actual vehicle artwork at terminal reversals and tunnel mouths. A position
// helper alone cannot catch collapsed bodies, ghost badges or stale hit areas.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-vehicle-service-motion';
await mkdir(output, { recursive: true });
const results = [], errors = [];
const profiles = [{ name: 'desktop', width: 1440, height: 900, zoom: 2, dpr: 1 }, { name: 'laptop-retina', width: 1024, height: 768, zoom: 1, dpr: 2 }];

async function harness(profile) {
  const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.TRANSPORT_BASELINE_RENDERER) {
    const source = await readFile(process.env.TRANSPORT_BASELINE_RENDERER, 'utf8');
    await page.route('**/renderer.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
  await page.route('**/vehicle-service-motion-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>' }));
  await page.goto(new URL('vehicle-service-motion-qa', base).href);
  await page.evaluate(async () => {
    const [{ createRenderer }, { placeVehicle, shownProgress }, { railConsistPoses }, { isUndergroundAt }, geometry, art] = await Promise.all([
      import('./renderer.js'), import('./model.js'), import('./rail-consist.js'), import('./structure-visibility.js'), import('./terrain-geometry.js'), import('./atlas-runtime.js'),
    ]);
    await art.preloadWorldArt({ waitMs: 12000 });
    const canvas = document.querySelector('canvas');
    window.serviceMotionQA = { createRenderer, placeVehicle, shownProgress, railConsistPoses, isUndergroundAt, geometry, canvas };
  });
  return page;
}

async function renderedCase(page, options) {
  return page.evaluate(options => {
    const q = serviceMotionQA, { mode, axis, engineered, tunnel, short, zoom } = options, width = 64;
    const game = { width, height: 64, seed: 1, biome: 'taiga', day: 1, revision: 1, networkRevision: 1, industries: [], cities: [], stations: [], routes: [], vehicles: [], zones: [], tiles: Array.from({ length: width * 64 }, (_, i) => {
      const along = axis === 'x' ? i % width : Math.floor(i / width), mountain = tunnel && along >= 15 && along <= 25;
      return { terrain: mountain ? 'mountain' : 'grass', elevation: (mountain ? 5 : 2) / 7, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null };
    }) };
    const path = Array.from({ length: short ? 2 : 21 }, (_, i) => ({ x: axis === 'x' ? 10 + i : 20, y: axis === 'y' ? 10 + i : 20 }));
    for (const p of path) {
      const tile = game.tiles[p.y * width + p.x]; tile[mode] = true;
      if (tile.terrain === 'mountain') Object.assign(tile, { tunnel: true, ...engineered ? { structureAxis: axis, structureLevel: 5 } : {} });
    }
    const route = { id: 'route', mode, cargo: 'grain', active: true, stops: [], path, number: 1 }, vehicle = { id: 'vehicle', routeId: route.id, progress: 0, direction: 1, load: 10, capacity: 20, level: 1 };
    game.routes = [route]; game.vehicles = [vehicle];
    const renderer = q.createRenderer(q.canvas, game, { layers: { grid: false, names: false, industryIcons: false, trees: false, buildings: false, weather: false, vehicles: true, vehicleLoads: true, stations: false, routes: false } });
    renderer.setZoom(zoom);
    const context = q.canvas.getContext('2d'), frames = [], max = path.length - 1;
    const film = document.createElement('canvas'); film.width = 960; film.height = tunnel ? 360 : 360;
    const strip = film.getContext('2d'); let filmIndex = 0;
    const terminal = [
      ...[.3, .1, .01, 0].map(progress => ({ progress: Math.min(progress, max), direction: -1, end: 'near' })),
      ...[0, .01, .1, .3].map(progress => ({ progress: Math.min(progress, max), direction: 1, end: 'near' })),
      ...[.3, .1, .01, 0].map(distance => ({ progress: max - Math.min(distance, max), direction: 1, end: 'far' })),
      ...[0, .01, .1, .3].map(distance => ({ progress: max - Math.min(distance, max), direction: -1, end: 'far' })),
    ];
    const portals = [14.6, 14.8, 14.9, 15.5, 16, 20, 25.1, 25.25, 25.8, 26.4];
    // Away from the terminal easing region, invert the consist's mapping so
    // road and rail engines cross exactly the same physical portal samples.
    const sequence = tunnel ? [1, -1].flatMap(direction => (direction > 0 ? portals : [...portals].reverse()).map(along => ({ direction, along, progress: mode === 'rail' ? (along - 10 - 34 / 32) * max / (max - 34 / 32) : along - 10 }))) : terminal;
    let priorEnd;
    for (const sample of sequence) {
      Object.assign(vehicle, { progress: sample.progress, direction: sample.direction }); q.placeVehicle(route, vehicle);
      const consist = mode === 'rail' ? q.railConsistPoses(path, q.shownProgress(route, vehicle)) : null;
      const poses = consist ? [consist.engine, ...consist.coaches] : [{ x: vehicle.x, y: vehicle.y, angle: vehicle.angle }];
      const engine = poses[0], along = axis === 'x' ? engine.x : engine.y;
      // Portal photos follow the engine; terminal strips keep a fixed camera
      // so a sudden reversal cannot be hidden by reframing the world.
      if (tunnel || priorEnd !== sample.end) renderer.focus(tunnel ? engine.x : axis === 'x' ? sample.end === 'near' ? 11 : 10 + max : 20, tunnel ? engine.y : axis === 'y' ? sample.end === 'near' ? 11 : 10 + max : 20);
      priorEnd = sample.end;
      const calls = [], draw = context.drawImage;
      context.drawImage = function (image, ...args) {
        if (image.vehicleFrame) { const transform = this.getTransform(); calls.push({ kind: image.vehicleFrame.kind, frame: image.vehicleFrame, x: transform.e / devicePixelRatio, y: transform.f / devicePixelRatio, width: args.at(-2) * Math.hypot(transform.a, transform.b) / devicePixelRatio }); }
        return draw.call(this, image, ...args);
      };
      try { renderer.render(1000, { settle: true }); } finally { context.drawImage = draw; }
      const comparePixels = calls.length === 0 || !tunnel && [3, 4, 11, 12].includes(frames.length);
      const plain = comparePixels ? q.canvas.toDataURL() : null, badgeCount = Object.values(renderer.getStats().vehicleIndicators).reduce((sum, count) => sum + count, 0), rect = q.canvas.getBoundingClientRect();
      const expected = poses.map((pose, index) => {
        const p = renderer.worldToScreen(pose.x, pose.y), height = q.geometry.transportHeight(game, pose.x, pose.y, mode);
        p.y += (q.geometry.surfaceHeight(game, pose.x + .5, pose.y + .5) - height) * 12 * zoom;
        return { ...p, kind: mode === 'road' ? 'truck' : index === 0 ? 'locomotive' : 'wagon', underground: q.isUndergroundAt(game, pose.x, pose.y, mode), along: axis === 'x' ? pose.x : pose.y };
      });
      const picks = calls.map(call => renderer.vehicleAt(rect.left + call.x, rect.top + call.y)?.id || null);
      const follow = renderer.vehicleWorldPoint(vehicle);
      renderer.render(1000, { settle: true, selectedVehicleId: vehicle.id, hoverRef: `vehicle:${vehicle.id}` });
      const fullyHidden = expected.every(p => p.underground), hiddenPick = renderer.vehicleAt(rect.left + expected[0].x, rect.top + expected[0].y)?.id || null;
      const record = { ...sample, along, engine, expected, calls, picks, follow, badgeCount, fullyHidden, hiddenPick, selectionUnchanged: fullyHidden ? plain === q.canvas.toDataURL() : null, image: plain };
      frames.push(record);
      const selectedFrame = tunnel ? sample.direction === 1 && [14.6, 14.9, 16, 20, 25.25, 26.4].includes(sample.along) : sample.end === 'far' && [9, 11, 12, 13, 14, 15].includes(frames.length - 1);
      if (selectedFrame && filmIndex < 6) {
        const target = expected[0], sourceX = (target.x - 160) * devicePixelRatio, sourceY = (target.y - 85) * devicePixelRatio, x = filmIndex % 3 * 320, y = Math.floor(filmIndex / 3) * 180;
        strip.drawImage(q.canvas, sourceX, sourceY, 320 * devicePixelRatio, 160 * devicePixelRatio, x, y + 20, 320, 160);
        strip.fillStyle = '#f7f6ef'; strip.fillRect(x, y, 320, 20); strip.fillStyle = '#1e3228'; strip.font = '12px sans-serif';
        strip.fillText(`${mode} ${axis} ${sample.direction > 0 ? '→' : '←'} ${along.toFixed(3)} bodies:${calls.length}`, x + 4, y + 14); filmIndex++;
      }
    }
    const reversals = tunnel ? [] : [[3, 4], [11, 12]].map(([a, b]) => ({ before: frames[a].image, after: frames[b].image }));
    for (const frame of frames) delete frame.image;
    return { frames, reversals: reversals.map(pair => pair.before === pair.after), png: film.toDataURL() };
  }, options);
}

async function appFollow(profile) {
  const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await createWorldFromMenu(page, { generationVersion: 11 });
  await page.locator('#dismiss-objective').click();
  const fixture = await page.evaluate(async () => {
    const { placeVehicle } = await import('./model.js'), g = transport.game, route = g.routes[0], vehicle = g.vehicles.find(v => v.routeId === route.id);
    // Reuse the real opening service and its towns/stops in isolated storage.
    // A rail version exercises the same actual inspector and Follow button.
    route.mode = 'rail'; for (const stop of g.stations) if (route.stops.includes(stop.id)) stop.mode = 'rail';
    for (const point of route.path) g.tiles[point.y * g.width + point.x].rail = true;
    g.vehicles = [vehicle]; vehicle.progress = 4; vehicle.direction = 1; placeVehicle(route, vehicle);
    g.revision++; g.networkRevision++; route.pathRevision = g.networkRevision; transport.simulation.motion.reset();
    const renderer = transport.renderer, render = renderer.render, context = document.querySelector('#world').getContext('2d');
    window.serviceFollowQA = { vehicle, route, placeVehicle, last: null };
    renderer.render = (now, view = {}) => {
      const calls = [], draw = context.drawImage;
      context.drawImage = function (image, ...args) { if (image.vehicleFrame) { const m = this.getTransform(); calls.push({ kind: image.vehicleFrame.kind, x: m.e / devicePixelRatio, y: m.f / devicePixelRatio }); } return draw.call(this, image, ...args); };
      try { render(now, view); } finally { context.drawImage = draw; }
      serviceFollowQA.last = { revision: g.revision, calls, point: renderer.vehicleWorldPoint(vehicle), camera: renderer.getCamera(), indicators: renderer.getStats().vehicleIndicators };
    };
    renderer.setZoom(2); const point = renderer.vehicleWorldPoint(vehicle); renderer.focus(point.x, point.y);
    return { id: vehicle.id, max: route.path.length - 1 };
  });
  await page.waitForFunction(() => serviceFollowQA.last?.calls.some(call => call.kind === 'locomotive'));
  const hit = await page.evaluate(() => {
    const r = document.querySelector('#world').getBoundingClientRect(), engine = serviceFollowQA.last.calls.find(call => call.kind === 'locomotive');
    return { x: r.left + engine.x, y: r.top + engine.y - 3 };
  });
  await page.mouse.click(hit.x, hit.y);
  await page.locator('[data-vehicle-action="follow"]').click();
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  const frames = [];
  async function position(progress, direction, name) {
    await page.evaluate(({ progress, direction }) => {
      const q = serviceFollowQA; Object.assign(q.vehicle, { progress, direction }); q.placeVehicle(q.route, q.vehicle);
      transport.simulation.motion.reset(); transport.game.revision++;
    }, { progress, direction });
    await page.waitForFunction(() => serviceFollowQA.last?.revision === transport.game.revision);
    assert.equal(await page.locator('[data-vehicle-action="follow"]').getAttribute('aria-pressed'), 'true', 'actual Follow remains engaged through reversals and tunnels');
    const frame = await page.evaluate(() => {
      const q = serviceFollowQA, rect = document.querySelector('#world').getBoundingClientRect();
      return { ...q.last, selectionTag: Boolean(document.querySelector('#map-overlays .map-tag')), picks: q.last.calls.map(call => transport.renderer.vehicleAt(rect.left + call.x, rect.top + call.y)?.id || null) };
    });
    assert.ok(frame.picks.every(id => id === fixture.id), 'the actual app picks each displayed coach');
    if (name) await page.screenshot({ path: `${output}/${profile.name}-app-${name}.png` });
    frames.push({ progress, direction, name, ...frame }); return frame;
  }
  await position(fixture.max - .2, 1);
  const arrival = await position(fixture.max, 1, 'terminal-arrival');
  const returnTrip = await position(fixture.max, -1, 'terminal-return');
  assert.deepEqual(returnTrip.point, arrival.point, 'Follow does not jump when the train reverses');
  assert.equal(returnTrip.camera.x, arrival.camera.x); assert.equal(returnTrip.camera.y, arrival.camera.y);
  assert.equal(new Set(returnTrip.calls.map(call => `${call.x},${call.y}`)).size, 3, 'the actual app retains three distinct terminal bodies');
  await position(fixture.max - .2, -1);

  await page.evaluate(() => {
    const g = transport.game, route = serviceFollowQA.route;
    for (const point of route.path.slice(8, 17)) Object.assign(g.tiles[point.y * g.width + point.x], { terrain: 'mountain', elevation: 5 / 7, tunnel: true });
    g.revision++; g.networkRevision++; route.pathRevision = g.networkRevision;
  });
  for (const progress of [6.8, 7.6, 8.3, 12, 16.1, 16.8, 17.6]) {
    const frame = await position(progress, 1, progress === 12 ? 'tunnel-underground' : progress === 17.6 ? 'tunnel-emerged' : null);
    if (progress === 12) { assert.equal(frame.calls.length, 0); assert.equal(Object.values(frame.indicators).reduce((sum, n) => sum + n, 0), 0); assert.equal(frame.selectionTag, false, 'the DOM selection tag cannot reveal a fully underground train'); }
    if (progress === 17.6) { assert.equal(frame.calls.length, 3, 'the complete train reappears while Follow remains active'); assert.equal(frame.selectionTag, true, 'the selected train gets its name tag back after leaving the tunnel'); }
  }
  await page.close(); return { label: `${profile.name}-actual-app-follow`, frames };
}

try {
  for (const profile of profiles) {
    if (process.env.TRANSPORT_APP_FOLLOW_ONLY) {
      results.push(await appFollow(profile));
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      continue;
    }
    const page = await harness(profile);
    for (const axis of ['x', 'y']) for (const short of [false, true]) {
      const result = await renderedCase(page, { mode: 'rail', axis, short, tunnel: false, zoom: profile.zoom });
      const label = `${profile.name}-rail-${axis}-${short ? 'short' : 'terminal'}`;
      await writeFile(`${output}/${label}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
      results.push({ label, frames: result.frames, reversals: result.reversals });
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      assert.deepEqual(result.reversals, [true, true], `${label}: the exact reversal frame changes neither position nor artwork`);
      for (const frame of result.frames) {
        assert.equal(frame.calls.length, 3, `${label}: all three bodies remain visible`);
        assert.equal(new Set(frame.calls.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size, 3, `${label}: coaches never collapse onto another body`);
        assert.ok(Math.hypot(frame.follow.x - frame.engine.x, frame.follow.y - frame.engine.y) < 1e-8, `${label}: camera follow uses the drawn engine`);
        for (const expected of frame.expected) assert.ok(frame.calls.some(call => call.kind === expected.kind && Math.hypot(call.x - expected.x, call.y - expected.y) < 1.5), `${label}: every real body follows its shared pose`);
        assert.ok(frame.picks.every(id => id === 'vehicle'), `${label}: every visible body picks the same train`);
      }
    }
    for (const mode of ['road', 'rail']) for (const axis of ['x', 'y']) for (const engineered of [false, true]) {
      const result = await renderedCase(page, { mode, axis, engineered, tunnel: true, zoom: profile.zoom });
      const label = `${profile.name}-${mode}-${axis}-${engineered ? 'engineered' : 'automatic'}-tunnel`;
      if (axis === 'x') await writeFile(`${output}/${label}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
      results.push({ label, frames: result.frames });
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      for (const frame of result.frames) {
        const visible = frame.expected.filter(p => !p.underground);
        assert.equal(frame.calls.length, visible.length, `${label}@${frame.along}: every body independently crosses the portal mouth`);
        for (const expected of visible) assert.ok(frame.calls.some(call => call.kind === expected.kind && Math.hypot(call.x - expected.x, call.y - expected.y) < 1.5), `${label}: exposed artwork stays attached to its track position`);
        assert.ok(frame.picks.every(id => id === 'vehicle'), `${label}: exposed coaches remain selectable while the engine is inside`);
        assert.ok(Math.hypot(frame.follow.x - frame.engine.x, frame.follow.y - frame.engine.y) < 1e-8, `${label}: follow position stays continuous underground`);
        assert.equal(frame.badgeCount, visible.length ? 1 : 0, `${label}: the badge stays with an exposed body and vanishes underground`);
        if (frame.fullyHidden) { assert.equal(frame.hiddenPick, null); assert.equal(frame.selectionUnchanged, true, `${label}: selection and locator cannot reveal an underground vehicle`); }
        // Independent physical boundary expectations, not just the helper's verdict.
        assert.equal(frame.expected[0].underground, frame.along > 14.82 && frame.along < 25.18, `${label}: the body disappears at the mouth, not the tile edge`);
      }
    }
    await page.close();
    if (!process.env.TRANSPORT_BASELINE_RENDERER) {
      results.push(await appFollow(profile));
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Vehicle service motion: ${results.length} rendered cases, ${results.reduce((sum, result) => sum + result.frames.length, 0)} frames passed. Evidence: ${output}`);
} finally { await browser.close(); }
