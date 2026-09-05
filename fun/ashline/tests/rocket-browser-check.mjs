// Browser QA: set ASHLINE_PLAYWRIGHT and ASHLINE_URL as in browser-check.mjs.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-rocket-qa';
await mkdir(output, {recursive: true});
const advance = (page, seconds) => page.evaluate(async seconds => { const {updateGame} = await import('./sim.js'); for (let i = 0; i < seconds * 20; i++) updateGame(ashline.state, .05); }, seconds);
const clickWorld = async (page, x, y) => {
  const point = await page.evaluate(({x, y}) => { const p = ashline.renderer.worldToScreen(x, y, ashline.view), r = document.querySelector('#world').getBoundingClientRect(); return {x: p.x + r.x, y: p.y + r.y}; }, {x, y});
  await page.mouse.click(point.x, point.y);
};
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  assert.equal(await page.evaluate(() => ashline.assets.loaded), 7);
  const graphics = await page.evaluate(async () => {
    const {drawSprite, drawSpriteShadow, spriteStats} = await import('./assets.js');
    const {BUILDINGS, UNITS, createGame} = await import('./sim.js');
    const {Renderer} = await import('./render.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const e = (type, team = 0) => { const d = BUILDINGS[type] || UNITS[type]; return {id: 2, type, team, kind: BUILDINGS[type] ? 'building' : 'unit', size: d.size, hp: d.hp, maxHp: d.hp, progress: 1, x: 28, y: 28, angle: 0, queue: [], path: [], order: {type: 'idle'}}; };
    const sample = (entity, shadow = false, time = 0) => {
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 96); ctx.scale(1.5, 1.5);
      (shadow ? drawSpriteShadow : drawSprite)(ctx, entity, time); ctx.restore();
      const data = ctx.getImageData(0, 0, 192, 192).data; let mass = 0, mx = 0, my = 0, edge = 0, matte = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255, x = i / 4 % 192, y = Math.floor(i / 4 / 192); mass += alpha; mx += alpha * x; my += alpha * y;
        if (alpha > .1 && (x < 2 || x > 189 || y < 2 || y > 189)) edge++;
        if (alpha > .25 && data[i] > 100 && data[i + 2] > 100 && Math.min(data[i], data[i + 2]) - data[i + 1] > 65) matte++;
      }
      return {data, mass, x: mx / mass, y: my / mass, edge, matte};
    };
    const difference = (a, b) => a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0);
    const rows = [];
    for (const team of [0, 1]) for (const moving of [false, true]) {
      const frames = [], shadowOffsets = [];
      for (let heading = 0; heading < 32; heading++) {
        const unit = {...e('rocket', team), moving, angle: heading * Math.PI / 16};
        const body = sample(unit), shadow = sample(unit, true); frames.push(body);
        shadowOffsets.push({x: shadow.x - body.x, y: shadow.y - body.y});
      }
      rows.push({team, moving, minArea: Math.min(...frames.map(frame => frame.mass)), areaRatio: Math.max(...frames.map(frame => frame.mass)) / Math.min(...frames.map(frame => frame.mass)), edge: frames.reduce((n, frame) => n + frame.edge, 0), matte: frames.reduce((n, frame) => n + frame.matte, 0), shadowsDownRight: shadowOffsets.every(offset => offset.x > 1 && offset.y > 1)});
    }
    const rifle = sample(e('rifle')), rocket = sample(e('rocket')), rail = sample(e('turret')), tower = sample(e('rocketTower'));
    const walking = sample({...e('rocket'), moving: true}, false, .2), idle = sample({...e('rocket'), moving: true}, false, 0);

    // Observe the actual sprite poses used by the barracks' in-world production preview.
    const poses = new Set(), nativeDraw = ctx.drawImage;
    ctx.drawImage = function (source, ...args) { poses.add(source); return nativeDraw.call(this, source, ...args); };
    for (const time of [0, .2]) sample({...e('rocket'), moving: true}, false, time);
    ctx.drawImage = nativeDraw;
    const world = document.createElement('canvas'); world.style.cssText = 'position:absolute;width:448px;height:360px;opacity:0'; document.body.append(world);
    const renderer = new Renderer(world, null), s = createGame('rocket-render');
    s.terrain.fill(0); s.minerals.fill(0); s.effects = []; s.visible[0].fill(1); s.explored[0].fill(1); s.time = .4;
    const view = {x: 30, y: 30, zoom: 38, selected: new Set()}, barracks = e('barracks'), productionSources = new Set();
    const original = renderer.ctx.drawImage;
    renderer.ctx.drawImage = function (source, ...args) { if (poses.has(source)) productionSources.add(source); return original.call(this, source, ...args); };
    s.entities = [barracks];
    for (const progress of [0, 1 / (6 * UNITS.rocket.trainTime) + .001]) { barracks.queue = [{type: 'rocket', progress}]; renderer.draw(s, view); }
    renderer.ctx.drawImage = original;

    // A concealed rocket head draws nothing; visible heads retain only visible trail puffs.
    s.entities = []; renderer.rememberedBuildings.clear(); s.visible[0].fill(0);
    const projectile = {type: 'rocket', weapon: 'rocket', attackerId: 2, targetId: 3, x: 29.5, y: 30.5, tx: 35.5, ty: 30.5, life: .3, maxLife: .6, team: 1};
    const frame = () => { renderer.draw(s, view); return renderer.ctx.getImageData(0, 0, world.width, world.height).data; };
    s.visible[0][30 * s.width + 29] = 1; const noMissile = frame(); s.effects = [projectile]; const hiddenHead = frame();
    s.visible[0].fill(0); s.visible[0][30 * s.width + 32] = 1;
    const puffs = [], nativeEllipse = renderer.ctx.ellipse;
    renderer.ctx.ellipse = function (x, y, rx, ry, ...rest) {
      if (Array.from({length: 7}, (_, index) => index + 1).some(j => Math.abs(rx - (1.5 + j * .35)) < 1e-8 && Math.abs(ry - (1 + j * .3)) < 1e-8)) puffs.push(x / 32);
      return nativeEllipse.call(this, x, y, rx, ry, ...rest);
    };
    const visibleHead = frame(); renderer.ctx.ellipse = nativeEllipse;
    s.effects = []; const noVisibleHead = frame(); world.remove();
    return {loaded: spriteStats().loaded, rocketPoses: spriteStats().frames.rocket, rows, rifleDifference: difference(rifle.data, rocket.data), towerDifference: difference(rail.data, tower.data), walkDifference: difference(idle.data, walking.data), productionPoses: productionSources.size, hiddenHeadDifference: difference(noMissile, hiddenHead), visibleHeadDifference: difference(visibleHead, noVisibleHead), puffs};
  });
  assert.equal(graphics.rocketPoses, 2);
  assert(graphics.rifleDifference > 200 && graphics.towerDifference > 200, 'New infantry and tower have distinct sprites');
  for (const row of graphics.rows) { assert(row.minArea > 60 && row.areaRatio < 1.3 && row.shadowsDownRight); assert.equal(row.edge, 0); assert.equal(row.matte, 0); }
  assert(graphics.walkDifference > 10 && graphics.productionPoses >= 3, 'Rocket infantry walks and switches pose while training');
  assert.equal(graphics.hiddenHeadDifference, 0); assert(graphics.visibleHeadDifference > 20);
  assert.equal(graphics.puffs.length, 3); assert(graphics.puffs.every(x => Math.floor(x) === 32), 'Smoke cannot cross concealed trail cells');

  await page.locator('#seed').fill('ROCKET-BROWSER'); await page.locator('#deploy').click();
  await page.waitForFunction(() => !ashline.paused);
  if (await page.locator('#command-console').isHidden()) await page.locator('#command-toggle').click();
  assert(await page.locator('.build-card[data-type="rocketTower"]').isDisabled(), 'Tower requires barracks technology');
  await page.locator('#train-tab').click();
  assert(await page.locator('.build-card[data-type="rocket"]').isDisabled(), 'Rocket infantry needs a barracks');
  await page.locator('#pause').click();
  const setup = await page.evaluate(async () => {
    const {BUILDINGS, UNITS, canPlace, placeBuilding, getEntity, updateGame} = await import('./sim.js'), s = ashline.state;
    s.ai.nextThink = 1e12; s.teams[0].credits = 20000;
    const core = s.entities.find(e => e.team === 0 && e.type === 'core');
    for (let y = core.y - 10; y < core.y + 5; y++) for (let x = core.x - 2; x < core.x + 14; x++) if (canPlace(s, 0, 'barracks', x, y).ok) {
      const entity = getEntity(s, placeBuilding(s, 0, 'barracks', x, y).id);
      for (let tick = 0; tick < (BUILDINGS.barracks.buildTime + .2) * 20; tick++) updateGame(s, .05);
      return {id: entity.id, trainTime: UNITS.rocket.trainTime, buildTime: BUILDINGS.rocketTower.buildTime};
    }
    throw new Error('No barracks site');
  });
  await page.locator('#resume').click();
  const recruit = page.locator('.build-card[data-type="rocket"]'); await recruit.click();
  assert(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).queue[0]?.type === 'rocket', setup.id));
  await advance(page, setup.trainTime * .3);
  await page.waitForFunction(() => Number(document.querySelector('.build-card[data-type="rocket"] .card-queue-count').textContent.replace(/\D/g, '')) === 1);
  await page.waitForFunction(() => [...document.querySelectorAll('.build-card[data-type="rocket"] [role="progressbar"]')].some(bar => Number(bar.getAttribute('aria-valuenow')) >= 25));
  await page.screenshot({path: `${output}/rocket-training.png`});
  await advance(page, setup.trainTime);
  assert(await page.evaluate(() => ashline.state.entities.some(e => e.team === 0 && e.type === 'rocket')));
  await page.locator('#build-tab').click();
  const spot = await page.evaluate(async () => {
    const {canPlace} = await import('./sim.js'), core = ashline.state.entities.find(e => e.team === 0 && e.type === 'core');
    for (let y = core.y - 10; y < core.y + 8; y++) for (let x = core.x - 2; x < core.x + 16; x++) {
      const p = ashline.renderer.worldToScreen(x, y, ashline.view);
      if (p.x > 40 && p.x < innerWidth - 280 && p.y > 130 && p.y < innerHeight - 150 && canPlace(ashline.state, 0, 'rocketTower', x, y).ok) return {x, y};
    }
  });
  assert(spot); await page.locator('.build-card[data-type="rocketTower"]').click(); await clickWorld(page, spot.x + .2, spot.y + .2);
  assert(await page.evaluate(() => ashline.state.entities.some(e => e.team === 0 && e.type === 'rocketTower' && e.progress < 1)));
  await advance(page, setup.buildTime + .2);
  assert(await page.evaluate(() => ashline.state.entities.some(e => e.team === 0 && e.type === 'rocketTower' && e.progress === 1)));
  await page.locator('#pause').click(); await page.locator('#save-game').click(); await page.locator('#load-game').click();
  assert(await page.evaluate(() => ashline.paused && ['rocket', 'rocketTower'].every(type => ashline.state.entities.some(e => e.team === 0 && e.type === type))));

  // Keep the actual HUD while staging both factions beside existing terrain and minerals.
  await page.evaluate(async () => {
    const {BUILDINGS, UNITS} = await import('./sim.js'), s = ashline.state;
    s.entities = s.entities.filter(e => e.team === 0 && e.kind === 'building' && e.type !== 'rocketTower'); s.effects = [];
    for (const team of [0, 1]) for (const [type, x, y] of [['rifle', 17, 29], ['rocket', 19, 29], ['turret', 21, 29], ['rocketTower', 23, 29]]) {
      const d = BUILDINGS[type] || UNITS[type];
      s.entities.push({id: s.nextId++, kind: BUILDINGS[type] ? 'building' : 'unit', type, team, x, y: y + team * 4, hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, angle: team ? Math.PI * .3 : Math.PI * 1.3, order: {type: 'idle'}, path: [], queue: [], cooldown: 0});
    }
    s.visible[0].fill(1); s.explored[0].fill(1); ashline.view.selected.clear(); document.querySelector('#menu').close(); document.querySelector('#command-console').hidden = true;
  });
  for (const width of [1440, 390]) for (const zoom of [38, 16]) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 900});
    await page.evaluate(zoom => { ashline.view.zoom = zoom; ashline.view.x = 21; ashline.view.y = 32; ashline.renderer.draw(ashline.state, ashline.view); }, zoom);
    await page.screenshot({path: `${output}/rockets-${width}-${zoom}.png`});
  }
  assert.deepEqual(errors, [], 'No console or runtime errors');
  console.log(`Rocket browser checks passed: seven assets, distinct sprites, both factions/headings/shadows, infantry production poses, projectile/trail fog, actual training/tower construction/save-load, and desktop/mobile zoom screenshots. Review: ${output}`);
} finally { await browser.close(); }
