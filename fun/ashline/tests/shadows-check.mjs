// Optional browser regression: use ASHLINE_PLAYWRIGHT and ASHLINE_URL as in browser-check.mjs.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const result = await page.evaluate(async () => {
    const { drawSprite, drawSpriteShadow } = await import('./assets.js');
    const { BUILDINGS, UNITS, createGame } = await import('./sim.js');
    const { Renderer } = await import('./render.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }), shadowImages = new Set();
    const drawImage = ctx.drawImage;
    const entity = (type, team = 0) => {
      const d = BUILDINGS[type] || UNITS[type];
      return { id: 19, kind: BUILDINGS[type] ? 'building' : 'unit', type, team, hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, angle: 0, order: { type: 'idle' }, queue: [], path: [] };
    };
    const sample = (e, shadow, time = .25) => {
      let anchor;
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 96);
      if (shadow) ctx.drawImage = function (image, ...args) { shadowImages.add(image); const matrix = this.getTransform(); anchor = { x: matrix.e, y: matrix.f }; return drawImage.call(this, image, ...args); };
      (shadow ? drawSpriteShadow : drawSprite)(ctx, e, time); ctx.drawImage = drawImage; ctx.restore();
      const data = ctx.getImageData(0, 0, 192, 192).data;
      let mass = 0, mx = 0, my = 0;
      for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; mass += a; mx += (i / 4 % 192) * a; my += Math.floor(i / 4 / 192) * a; }
      return { data, mass, x: mx / mass, y: my / mass, anchor };
    };
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const rows = [];
    for (const type of Object.keys(UNITS)) for (const moving of [false, true]) {
      const offsets = [];
      for (let heading = 0; heading < 16; heading++) {
        const e = { ...entity(type), moving, angle: heading * Math.PI / 8 };
        const body = sample(e, false), shadow = sample(e, true);
        offsets.push({ x: shadow.x - body.x, y: shadow.y - body.y, anchor: shadow.anchor });
        if (shadow.mass <= 0) throw Error(`Missing ${type} shadow`);
        if (!same(shadow.data, sample({ ...e, team: 1 }, true).data)) throw Error(`Faction changes ${type} shadow`);
      }
      rows.push({ type, moving, minX: Math.min(...offsets.map(p => p.x)), minY: Math.min(...offsets.map(p => p.y)),
        // Compare ground anchors: roof side extrusion changes a sprite's alpha centroid as it turns.
        driftX: Math.max(...offsets.map(p => p.anchor.x)) - Math.min(...offsets.map(p => p.anchor.x)), driftY: Math.max(...offsets.map(p => p.anchor.y)) - Math.min(...offsets.map(p => p.anchor.y)) });
    }
    const buildings = [];
    for (const type of Object.keys(BUILDINGS)) {
      const e = entity(type), body = sample(e, false), shadow = sample(e, true), half = sample({ ...e, progress: .5 }, true);
      buildings.push({ type, dx: shadow.x - body.x, dy: shadow.y - body.y, mass: shadow.mass, half: half.mass,
        empty: sample({ ...e, progress: 0 }, true).mass, dead: sample({ ...e, hp: 0 }, true).mass });
    }
    const rifle = { ...entity('rifle'), moving: true };
    const frozen = same(sample(rifle, true, .25).data, sample(rifle, true, .25).data);
    const deadUnits = Object.keys(UNITS).every(type => sample({ ...entity(type), hp: 0 }, true).mass === 0);

    // Isolate a real Renderer. The hidden object sits close enough to cast into visible ground.
    const world = document.createElement('canvas'); world.style.cssText = 'width:640px;height:480px;position:absolute;opacity:0'; document.body.append(world);
    const renderer = new Renderer(world, null), s = createGame('shadow-fog-boundary');
    s.time = 4; s.entities = []; s.effects = []; s.terrain.fill(0); s.minerals.fill(0);
    s.explored[0].fill(0); s.visible[0].fill(0);
    const visibility = () => { s.visible[0].fill(0); for (let y = 0; y < s.height; y++) for (let x = 31; x < s.width; x++) { s.visible[0][y * s.width + x] = 1; s.explored[0][y * s.width + x] = 1; } };
    visibility();
    const view = { x: 30, y: 30, zoom: 32, selected: new Set() }, draw = renderer.ctx.drawImage;
    let casts = 0;
    renderer.ctx.drawImage = function (image, ...args) { if (shadowImages.has(image)) casts++; return draw.call(this, image, ...args); };
    const scene = () => { casts = 0; renderer.draw(s, view); return { data: renderer.ctx.getImageData(0, 0, world.width, world.height).data, casts }; };
    const clean = scene(), hidden = { ...entity('tank', 1), x: 30.8, y: 30.5 };
    s.entities.push(hidden); const hiddenAdded = scene();
    hidden.x = 30.9; hidden.angle = Math.PI; const hiddenMoved = scene();
    s.entities = []; const hiddenRemoved = scene();
    s.entities = [{ ...hidden, x: 31.2 }]; const visibleUnit = scene();
    const fogUnitSafe = [hiddenAdded, hiddenMoved, hiddenRemoved].every(frame => frame.casts === 0 && same(clean.data, frame.data));

    const factory = { ...entity('factory', 1), x: 28, y: 28 };
    s.entities = [factory]; const unseenBuilding = scene();
    const unseenBuildingSafe = unseenBuilding.casts === 0 && same(clean.data, unseenBuilding.data);
    s.visible[0][29 * s.width + 30] = 1; s.explored[0].fill(1); const discovered = scene();
    visibility(); const remembered = scene();
    factory.hp = 1; factory.progress = .3; factory.queue = [{ type: 'tank', progress: .9 }]; const changedHiddenBuilding = scene();
    s.entities = []; const destroyedHiddenBuilding = scene();
    const memorySafe = remembered.casts === 0 && changedHiddenBuilding.casts === 0 && destroyedHiddenBuilding.casts === 0
      && same(remembered.data, changedHiddenBuilding.data) && same(remembered.data, destroyedHiddenBuilding.data);
    world.remove();
    return { rows, buildings, frozen, deadUnits, fogUnitSafe, unseenBuildingSafe, memorySafe, visibleCasts: visibleUnit.casts, discoveredCasts: discovered.casts };
  });
  for (const row of result.rows) {
    assert(row.minX > 1 && row.minY > 1, `${row.type}: shadows stay lower-right through all headings`);
    assert(row.driftX < .01 && row.driftY < .01, `${row.type}: light displacement never rotates with the unit`);
  }
  for (const row of result.buildings) {
    assert(row.mass > 0 && row.dx > 1 && row.dy > 1, `${row.type}: visible lower-right cast shadow`);
    assert(row.half > row.mass * .35 && row.half < row.mass * .65, `${row.type}: construction shadow grows gradually`);
    assert.equal(row.empty, 0); assert.equal(row.dead, 0);
  }
  assert(result.deadUnits && result.frozen);
  assert.equal(result.visibleCasts, 1); assert.equal(result.discoveredCasts, 1);
  assert(result.fogUnitSafe, 'Hidden moving units cannot cast onto visible ground');
  assert(result.unseenBuildingSafe, 'Unknown structures cannot expose shadows across fog boundaries');
  assert(result.memorySafe, 'Remembered structures cast no live shadows and reveal no hidden mutations or destruction');
  assert.deepEqual(errors, []);
  console.log('Shadow checks passed: all units/headings/poses/factions, all buildings, fixed lighting, construction, death, pause, and hidden/remembered enemies beside visible ground.');
} finally { await browser.close(); }
