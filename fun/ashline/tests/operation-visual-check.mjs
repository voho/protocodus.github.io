// Optional browser QA. Uses ASHLINE_PLAYWRIGHT, ASHLINE_URL, and ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-operation-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const checks = await page.evaluate(async () => {
    const {BUILDINGS, UNITS, createGame, updateGame} = await import('./sim.js');
    const {Renderer} = await import('./render.js');
    const world = document.createElement('canvas'); world.id = 'operation-preview';
    world.style.cssText = 'position:fixed;left:0;top:0;width:448px;height:360px;z-index:99999'; document.body.append(world);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const renderer = new Renderer(world, null), s = createGame('operation-visual');
    s.terrain.fill(0); s.minerals.fill(0); s.effects = [];
    s.visible.forEach(grid => grid.fill(1)); s.explored.forEach(grid => grid.fill(1));
    const view = {x: 30, y: 30, zoom: 38, selected: new Set()}, rows = [];
    const entity = (type, id = 2, team = 0, x = 28, y = 28) => {
      const d = BUILDINGS[type] || UNITS[type], building = Boolean(BUILDINGS[type]);
      return {id, type, team, kind: building ? 'building' : 'unit', x, y, size: d.size, hp: d.hp, maxHp: d.hp, progress: 1, angle: 0, queue: [], path: [], order: {type: 'idle'}, cargo: 0, unload: 0, unloadDepotId: null, processingAmount: 0, processingTotal: 0};
    };
    const supply = [entity('reactor', 90, 0, 3, 3), entity('reactor', 91, 1, 5, 3)];
    const render = () => { renderer.draw(s, view); return renderer.ctx.getImageData(0, 0, world.width, world.height).data; };
    const frame = (e, time = 1.2) => { s.entities = [...supply, ...(Array.isArray(e) ? e : [e])]; s.time = time; return render(); };
    const difference = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; return n; };
    const groundFirst = frame([], 1.2), groundLater = frame([], 3.7);
    const ashPixels = new Uint8Array(world.width * world.height);
    for (let i = 0; i < groundFirst.length; i += 4) if ([0, 1, 2].some(channel => groundFirst[i + channel] !== groundLater[i + channel])) {
      const x = i / 4 % world.width, y = Math.floor(i / 4 / world.width);
      for (let yy = Math.max(0, y - 2); yy <= Math.min(world.height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(world.width - 1, x + 2); xx++) ashPixels[yy * world.width + xx] = 1;
    }
    const machineryDifference = (a, b) => {
      // Ignore ambient ash and faint compositing edges; real lamps/fans change visibly.
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (!ashPixels[i / 4] && [0, 1, 2].some(channel => Math.abs(a[i + channel] - b[i + channel]) > 4)) n++;
      return n;
    };
    for (const team of [0, 1]) for (const [type, unit] of [['factory', 'tank'], ['barracks', 'scout'], ['refinery', 'harvester']]) {
      const e = entity(type, 2, team), idle = frame(e), idleLater = frame(e, 3.7);
      e.queue = [{type: unit, progress: .1}]; const early = frame(e);
      e.queue[0].progress = .5; const partial = frame(e), frozen = frame(e), moving = frame(e, 3.7);
      e.queue[0].progress = 1; const finished = frame(e);
      e.queue = []; const emptyAgain = frame(e);
      rows.push({type, team, idleStill: machineryDifference(idle, idleLater), started: difference(idle, early), assembling: difference(early, partial), completed: difference(partial, finished), working: machineryDifference(partial, moving), frozen: difference(partial, frozen), returnedIdle: difference(idle, emptyAgain)});
    }
    const factory = entity('factory'); factory.queue = [{type: 'tank', progress: .6}]; const tank = frame(factory);
    factory.queue = [{type: 'artillery', progress: .6}]; const artillery = frame(factory);
    factory.queue.push({type: 'tank', progress: 0}); const waitingTank = frame(factory);
    factory.queue[1].type = 'artillery'; const waitingArtillery = frame(factory);
    const barracks = entity('barracks'); barracks.queue = [{type: 'rifle', progress: .6}]; const rifle = frame(barracks);
    barracks.queue[0].type = 'scout'; const scout = frame(barracks);

    // Actual harvesting starts the processor only after the hauler completes unloading.
    const flow = createGame('visible-delivery'); flow.ai.nextThink = 1e12;
    const refinery = flow.entities.find(e => e.team === 0 && e.type === 'refinery');
    const hauler = flow.entities.find(e => e.team === 0 && e.type === 'harvester');
    const activity = document.createElement('canvas'); activity.width = activity.height = 192;
    const activityContext = activity.getContext('2d', {willReadFrequently: true});
    const machinery = () => {
      activityContext.clearRect(0, 0, 192, 192); activityContext.save(); activityContext.translate(96, 104);
      renderer.drawEntityActivity(activityContext, refinery, flow.time, 1); activityContext.restore();
      return activityContext.getImageData(0, 0, 192, 192).data;
    };
    const initiallyQuiet = !machinery().some(Boolean);
    for (let tick = 0; tick < 2000 && !(hauler.unloadDepotId && hauler.unload >= .25); tick++) updateGame(flow, .05);
    const unloadingQuiet = hauler.unloadDepotId === refinery.id && refinery.processingAmount === 0 && !machinery().some(Boolean);
    for (let tick = 0; tick < 40 && !refinery.processingAmount; tick++) updateGame(flow, .05);
    const processing = machinery(), processingAmount = refinery.processingAmount;
    const processingFrozen = difference(processing, machinery()) === 0;
    updateGame(flow, .5); const processorMoving = difference(processing, machinery()) > 0;
    for (let tick = 0; tick < 150 && refinery.processingAmount > 0; tick++) updateGame(flow, .05);
    const deliveryFinishedQuiet = refinery.processingAmount === 0 && !machinery().some(Boolean);

    // A last-seen active bay and its queue remain frozen after sight is lost.
    const enemy = entity('factory', 5, 1); enemy.queue = [{type: 'tank', progress: .4}];
    frame(enemy); s.visible[0].fill(0); const remembered = frame(enemy, 4);
    const rememberedJob = {...renderer.rememberedBuildings.get(enemy.id).queue[0]};
    enemy.queue[0].type = 'artillery'; enemy.queue[0].progress = .95;
    const hiddenChanged = frame(enemy, 7), rememberedAfter = {...renderer.rememberedBuildings.get(enemy.id).queue[0]};
    const hiddenDestroyed = frame([], 7);
    const hiddenHauler = entity('harvester', 6, 1, 30, 31); hiddenHauler.cargo = 200;
    const hiddenFull = frame(hiddenHauler, 7); hiddenHauler.cargo = 0; const hiddenEmpty = frame(hiddenHauler, 7);
    const memorySafe = difference(remembered, hiddenChanged) === 0 && difference(hiddenChanged, hiddenDestroyed) === 0;
    const cargoHidden = difference(hiddenFull, hiddenEmpty) === 0 && difference(hiddenDestroyed, hiddenEmpty) === 0;

    // Stream particles require visibility of both endpoints. At unload=0 the body frame is unchanged.
    renderer.rememberedBuildings.clear(); s.visible[0].fill(1);
    const depot = entity('refinery', 10, 1, 28, 28), truck = entity('harvester', 11, 1, 32.5, 29.5);
    truck.cargo = 200; truck.harvestPhase = 'return'; truck.order = {type: 'harvest'};
    const pair = [depot, truck], noStream = frame(pair); truck.unloadDepotId = depot.id; const stream = frame(pair);
    const streamFrozen = difference(stream, frame(pair)) === 0;
    s.visible[0][Math.floor(truck.y) * s.width + Math.floor(truck.x)] = 0;
    const hiddenTruck = frame(pair); truck.unloadDepotId = null; const noHiddenTruckStream = frame(pair);
    s.visible[0].fill(1); for (let y = depot.y; y < depot.y + depot.size; y++) for (let x = depot.x; x < depot.x + depot.size; x++) s.visible[0][y * s.width + x] = 0;
    const hiddenDepot = frame(pair); truck.unloadDepotId = depot.id; const noHiddenDepotStream = frame(pair);

    // Retain a small operation scene for normal/minimum-zoom desktop and narrow-screen review.
    s.visible[0].fill(1); renderer.rememberedBuildings.clear();
    const previewFactory = entity('factory', 20, 0, 29, 27); previewFactory.queue = [{type: 'artillery', progress: .75}];
    const previewBarracks = entity('barracks', 21, 0, 33, 27); previewBarracks.queue = [{type: 'scout', progress: .4}];
    const previewRefinery = entity('refinery', 22, 0, 29, 32); previewRefinery.processingAmount = 130; previewRefinery.processingTotal = 200;
    const loadedTruck = entity('harvester', 23, 0, 33.5, 33.5); loadedTruck.cargo = 200; loadedTruck.unload = .3; loadedTruck.unloadDepotId = previewRefinery.id; loadedTruck.harvestPhase = 'return';
    const emptyTruck = entity('harvester', 24, 0, 35.5, 33.5);
    const previewEntities = [previewFactory, previewBarracks, previewRefinery, loadedTruck, emptyTruck];
    world.style.width = '100vw'; world.style.height = '100vh';
    window.operationPreview = zoom => { renderer.resize(); view.x = 32.5; view.y = 30.7; view.zoom = zoom; frame(previewEntities, 2.4); };
    window.operationPreview(38);
    return {rows, unitTypesDiffer: difference(tank, artillery), barracksTypesDiffer: difference(rifle, scout), waitingJobIgnored: difference(waitingTank, waitingArtillery), initiallyQuiet, unloadingQuiet, processingAmount, processingFrozen, processorMoving, deliveryFinishedQuiet, memorySafe, rememberedJob, rememberedAfter, cargoHidden, streamVisible: difference(noStream, stream), streamFrozen, hiddenTruckSafe: difference(hiddenTruck, noHiddenTruckStream) === 0, hiddenDepotSafe: difference(hiddenDepot, noHiddenDepotStream) === 0};
  });
  for (const row of checks.rows) {
    assert.equal(row.idleStill, 0, `${row.type}, faction ${row.team}: idle machinery stays still`);
    assert(row.started > 20 && row.assembling > 10 && row.completed > 10, `${row.type}: the visible unit assembles with queue progress`);
    assert(row.working > 0, `${row.type}: active machinery animates`);
    assert.equal(row.frozen, 0); assert.equal(row.returnedIdle, 0);
  }
  assert(checks.unitTypesDiffer > 20 && checks.barracksTypesDiffer > 20, 'The bay shows the actual tank/artillery/rifle/scout type');
  assert.equal(checks.waitingJobIgnored, 0, 'Waiting queue items do not replace the active assembly');
  assert(checks.initiallyQuiet && checks.unloadingQuiet && checks.processingAmount > 0 && checks.processorMoving && checks.processingFrozen && checks.deliveryFinishedQuiet, 'Real delivery drives a processor from idle through processing back to idle');
  assert(checks.memorySafe && checks.cargoHidden, 'Hidden production, destruction and cargo changes cannot leak through fog');
  assert.deepEqual(checks.rememberedAfter, checks.rememberedJob, 'Remembered queues are deep snapshots');
  assert(checks.streamVisible > 20 && checks.streamFrozen && checks.hiddenTruckSafe && checks.hiddenDepotSafe, 'Unloading streams freeze with simulation time and require both visible endpoints');
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}]]) {
    await page.setViewportSize(viewport);
    for (const zoom of [38, 16]) {
      await page.evaluate(zoom => window.operationPreview(zoom), zoom);
      await page.locator('#operation-preview').screenshot({path: `${output}/operations-${name}-${zoom}.png`});
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Operation visual checks passed: actual-unit assembly stages, idle/active/pause, delivered-mineral processing, frozen enemy memories/cargo, and visible-only unloading streams. Screenshots: ${output}`);
} finally { await browser.close(); }
