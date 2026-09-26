// Compare prepared opaque terrain against the original substrate + terrain passes.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('worlds.js', process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/').href);
  await page.setContent('');
  const result = await page.evaluate(async () => {
    const { WorldRenderer } = await import('./worlds.js');
    const { MAP_TILE_SIZE } = await import('./tile-map.js');
    const TILE = 800, MARGIN = MAP_TILE_SIZE, W = 640, H = 900;
    const world = new WorldRenderer(); await world.ready;
    world.warmEpoch++; world.warmJobs = []; world.queueWarm = () => {};
    const surface = (width, height) => new OffscreenCanvas(width, height);
    const compare = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let max = 0, total = 0, changed = 0, aboveTwo = 0, opaque = true;
      for (let i = 0; i < x.length; i++) {
        if (i % 4 === 3) { opaque &&= x[i] === 255; continue; }
        const delta = Math.abs(x[i] - y[i]); max = Math.max(max, delta); total += delta; if (delta) changed++; if (delta > 2) aboveTwo++;
      }
      return { max, mean: total / (x.length * .75), changed, aboveTwoFraction: aboveTwo / (x.length * .75), opaque };
    };
    // Transparent materials expose the exact substrate phase independently of
    // map colors, including negative strip rows and the 600/800px repeat mismatch.
    const originalTerrain = world.terrain, originalTileAt = world.tileAt;
    const empty = surface(MAP_TILE_SIZE, MAP_TILE_SIZE), phase = [];
    world.terrain = { getMaterial: () => empty, get: () => empty };
    world.tileAt = () => ({ variant: 0, cornerMasks: [0, 0, 0, 0] });
    world.setViewport(W);
    for (const density of [1, 2]) {
      world.detailScale = density; world.tiles.clear();
      for (const row of [-4, -1, 0, 1, 4]) {
        const tile = world.getTile(row), expected = surface(tile.width, tile.height), c = expected.getContext('2d');
        c.scale(density, density); c.translate(MARGIN, 0); world.drawSubstrate(c, TILE, -row * TILE);
        phase.push({ density, row, ...compare(tile, expected) });
      }
    }
    world.terrain = originalTerrain; world.tileAt = originalTileAt;
    const pictures = [];
    for (const index of [0, 4, 6, 9]) {
      world.setWorld(index, 'opaque-ground-qa'); world.setViewport(W);
      for (const density of [1, 2]) {
        world.detailScale = density; world.tiles.clear();
        const legacy = new Map();
        const legacyTile = row => {
          if (legacy.has(row)) return legacy.get(row);
          const out = surface((world.mapWidth + MARGIN * 2) * density, TILE * density), c = out.getContext('2d');
          c.scale(density, density);
          for (let y = 0; y < TILE / MAP_TILE_SIZE; y++) for (let col = -1; col <= world.mapWidth / MAP_TILE_SIZE; col++) {
            const tile = world.tileAt(col, row * (TILE / MAP_TILE_SIZE) + y), x = col * MAP_TILE_SIZE + MARGIN, py = y * MAP_TILE_SIZE;
            c.globalAlpha = .86; c.drawImage(world.terrain.getMaterial(0, tile.variant), x, py, MAP_TILE_SIZE, MAP_TILE_SIZE); c.globalAlpha = 1;
            for (let material = 1; material < 4; material++) if (tile.cornerMasks[material]) c.drawImage(world.terrain.get(material, tile.variant, tile.cornerMasks[material]), x, py, MAP_TILE_SIZE, MAP_TILE_SIZE);
          }
          legacy.set(row, out); return out;
        };
        for (const [scroll, scale, parallax] of [[0, 1, 0], [799.75, .75, -7.25], [-801.5, 1.3, 8.5]]) {
          const width = Math.ceil(W * scale), height = Math.ceil(H * scale), actual = surface(width, height), expected = surface(width, height);
          for (const [target, old] of [[actual, false], [expected, true]]) {
            const c = target.getContext('2d'); c.scale(scale, scale); c.translate(parallax, 0);
            if (old) world.drawSubstrate(c, H, scroll);
            else { c.fillStyle = world.palette.low; c.fillRect(-MARGIN, 0, world.mapWidth + MARGIN * 2, H); }
            for (let row = Math.floor(-scroll / TILE); row <= Math.floor((H - scroll) / TILE); row++) c.drawImage(old ? legacyTile(row) : world.getTile(row), -MARGIN, row * TILE + scroll, world.mapWidth + MARGIN * 2, TILE + .5);
          }
          pictures.push({ index, density, scroll, scale, parallax, ...compare(actual, expected) });
        }
      }
    }
    // The actual render path must use the completed strips without submitting
    // their substrate again, while retaining the same cached strip identities.
    world.setWorld(0); world.setViewport(W); world.detailScale = 1; world.tiles.clear();
    world.drawGroundScenery = world.drawCloudShadows = world.drawAtmosphere = () => {};
    const target = surface(W, H), c = target.getContext('2d'), cached = world.getTile(0);
    let substrateCalls = 0, terrainCalls = 0;
    const vignetteCalls = [];
    const substrate = world.drawSubstrate.bind(world), drawImage = c.drawImage.bind(c);
    world.drawSubstrate = (...args) => { substrateCalls++; return substrate(...args); };
    world.getTile(1); substrateCalls = 0;
    c.drawImage = (...args) => {
      if (world.tiles.has(0) && [...world.tiles.values()].includes(args[0])) terrainCalls++;
      if (args[0] === world.vignetteSprite) vignetteCalls.push(args.slice(1));
      return drawImage(...args);
    };
    world.draw(c, W, H, 0, 0, 'low', W / 2, false);
    const vignette = [];
    for (const width of [320, 640.25, 1200, 3651.3]) for (const scale of [.75, 1, 1.7]) {
      const height = 120, actual = surface(Math.ceil(width * scale), Math.ceil(height * scale)), expected = surface(actual.width, actual.height);
      for (const [target, old] of [[actual, false], [expected, true]]) {
        const c = target.getContext('2d'); c.fillStyle = '#294b3d'; c.fillRect(0, 0, target.width, target.height); c.scale(scale, scale);
        if (old) c.drawImage(world.vignetteSprite, 0, 0, width, height);
        else for (const [sx, sy, sw, sh, dx, dy, dw, dh] of vignetteCalls) c.drawImage(world.vignetteSprite, sx, sy, sw, sh, dx / W * width, dy / H * height, dw / W * width, dh / H * height);
      }
      vignette.push({ width, scale, ...compare(actual, expected) });
    }
    const vignetteArea = vignetteCalls.reduce((area, call) => area + call[6] * call[7], 0) / (W * H);
    const activityReference = (c, prop, time, quality, motion) => {
      if (prop.hp <= 0) return;
      const stage = prop.hp / prop.maxHp <= .35 ? 2 : prop.hp / prop.maxHp <= .7 ? 1 : 0;
      const power = [1, .52, .19][stage], phase = prop.variant * 1.79 + prop.x * .009, clock = motion ? time : 0;
      const pulse = .76 + Math.sin(clock * 1.6 + phase) * .24, s = prop.size, x = prop.x, y = prop.y;
      c.save();
      const lx = x + s * .22, ly = y - s * .16, r = Math.round(s * .13);
      c.globalAlpha = power * pulse * .2; c.drawImage(world.lightSprite, Math.round(lx - r), Math.round(ly - r), r * 2, r * 2);
      c.globalAlpha = power * pulse * .65; c.fillStyle = world.palette.fog;
      c.fillRect(Math.round(lx), Math.round(ly), Math.max(1, Math.round(s * .022)), 1);
      if (quality !== 'low') {
        if (prop.type === 'radar' || prop.type === 'satellite') {
          const angle = clock * .72 + phase, reach = s * .19;
          c.save(); c.translate(x, y - s * .07); c.rotate(angle); c.globalAlpha = power * .24;
          c.drawImage(world.radarSweepSprite, -reach, -reach, reach * 2, reach * 2); c.restore();
        } else if (['pylon', 'tower', 'dome'].includes(prop.type)) {
          c.globalAlpha = power * pulse * .13; c.drawImage(world.lightSprite, x - s * .23, y - s * .29, s * .46, s * .46);
        }
        if (motion && ['station', 'refinery', 'building', 'fortress'].includes(prop.type)) for (let n = 0; n < 2; n++) {
          const age = ((clock * .22 + phase + n * .5) % 1 + 1) % 1, radius = s * (.12 + age * .17);
          c.globalAlpha = power * Math.sin(age * Math.PI) * .095;
          c.drawImage(world.cloudSprite, x - s * .22 + age * s * .17 - radius, y - s * .22 - age * s * .3 - radius * .66, radius * 2, radius * 1.32);
        }
      }
      c.restore();
    };
    const siteReference = (c, prop, time, motion) => {
      if (prop.hp <= 0) return;
      const stage = prop.hp / prop.maxHp <= .35 ? 2 : prop.hp / prop.maxHp <= .7 ? 1 : 0;
      const power = [1, .8, .6][stage], s = prop.size, pulse = .88 + Math.sin((motion ? time : 0) * 2 + prop.phase) * .12, r = s * .59;
      c.save(); c.translate(prop.x, prop.y);
      c.globalAlpha = .35 * power * pulse; c.drawImage(world.siteSprites.supplyHalo, -r, -r, r * 2, r * 2);
      const size = Math.max(27, Math.min(44, s * .56));
      c.globalAlpha = power; c.drawImage(world.siteSprites.badges[prop.bonus], -size * .5, -size * .5, size, size);
      c.restore();
    };
    const contextState = c => JSON.stringify([c.globalAlpha, c.fillStyle, c.strokeStyle, c.lineWidth, c.globalCompositeOperation, ...['a', 'b', 'c', 'd', 'e', 'f'].map(key => c.getTransform()[key])]);
    const activity = [];
    for (const type of ['station', 'refinery', 'building', 'fortress', 'radar', 'satellite', 'pylon', 'tower', 'dome', 'bunker', 'solar', 'crawler', 'hauler', 'cache']) {
      let maxDifference = 0, saves = 0, restores = 0, statePreserved = true;
      for (const hp of [100, 60, 20, 0]) for (const motion of [true, false]) for (const quality of ['high', 'low']) {
        const prop = { id: type, type, hp, maxHp: 100, variant: 3, x: 123.25, y: 117.5, size: 70, phase: 1.7, groundRole: 'cache', bonus: 'rapid' };
        const actual = surface(280, 280), expected = surface(280, 280);
        for (const [target, old] of [[actual, false], [expected, true]]) {
          const c = target.getContext('2d'); c.fillStyle = '#20362c'; c.fillRect(0, 0, 280, 280);
          c.setTransform(1.1, .08, -.04, .95, 11.5, 17.25); c.globalAlpha = .43; c.fillStyle = '#b311ce'; c.strokeStyle = '#37eecc'; c.lineWidth = 4; c.globalCompositeOperation = 'screen';
          const before = contextState(c);
          if (!old) for (const method of ['save', 'restore']) { const original = c[method].bind(c); c[method] = () => { if (method === 'save') saves++; else restores++; original(); }; }
          if (type === 'cache') { if (old) siteReference(c, prop, 3.7, motion); else world.drawGroundSite(c, prop, 3.7, motion); }
          else if (old) activityReference(c, prop, 3.7, quality, motion); else world.drawStructureActivity(c, prop, 3.7, quality, motion);
          statePreserved &&= contextState(c) === before;
        }
        maxDifference = Math.max(maxDifference, compare(actual, expected).max);
      }
      activity.push({ type, maxDifference, saves, restores, statePreserved });
    }
    return { phase, pictures, substrateCalls, terrainCalls, cacheRetained: world.getTile(0) === cached, activity, vignette, vignetteArea };
  });
  for (const sample of result.phase) assert.equal(sample.max, 0, `substrate phase remains exact at row ${sample.row}, density ${sample.density}`);
  console.log(JSON.stringify(result));
  for (const sample of result.pictures) {
    assert(sample.opaque, 'prepared terrain fully covers the arena');
    // Precomposition changes alpha rounding and filtering at raster edges. The
    // image must remain within 6/255 there, with under 0.1% beyond two levels.
    assert(sample.max <= 6 && sample.mean <= .08 && sample.aboveTwoFraction < .001, `ground pixels retain their appearance: ${JSON.stringify(sample)}`);
  }
  for (const sample of result.activity) {
    assert(sample.maxDifference <= 1, `structure/site pixels remain equivalent: ${JSON.stringify(sample)}`);
    assert(sample.statePreserved, `structure/site drawing preserves caller state: ${sample.type}`);
    const rotating = ['radar', 'satellite'].includes(sample.type);
    assert.equal(sample.saves, rotating ? 6 : 0, 'only rotated radar passes need a native state stack');
    assert.equal(sample.restores, sample.saves);
  }
  for (const sample of result.vignette) assert(sample.max <= 1, `cropped vignette retains pixels: ${JSON.stringify(sample)}`);
  assert(result.vignetteArea <= .454, 'cropped vignette submits under 46% of its original quad area');
  assert.equal(result.substrateCalls, 0, 'prepared flight submits no separate substrate passes');
  assert.equal(result.terrainCalls, 2, 'two cached strips cover the arena');
  assert(result.cacheRetained, 'drawing reuses completed strip surfaces');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS opaque ground phase/pixels/coverage/caches and equivalent structure/site drawing with fewer state stacks.');
} finally { await browser.close(); }
