// Source-ground registration and real renderer checks for the reported fishery
// and equipment-factory parcels. Rendering alone cannot validate a bad datum:
// inspect the retained source pixels as well as the final world placement.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-industry-parcel-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], failures = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    await page.route('**/industry-parcel-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1100px;height:760px}</style><canvas id="world"></canvas>' }));
    await page.goto(new URL('industry-parcel-qa', base).href);
    const source = await page.evaluate(async () => {
      const [{ createRenderer }, { industryAt }, atlas] = await Promise.all([import('./renderer.js'), import('./model.js'), import('./atlas-runtime.js')]);
      await atlas.preloadWorldArt({ cells: [16, 32, 64, 128, 256, 512], waitMs: 30000 });
      const folder = './assets/world/plot-buildings-v2/industries-2/';
      const metadata = await (await fetch(folder + 'atlas.json')).json();
      const fishery = metadata.sprites.find(sprite => sprite.kind === 'fishery');
      const image = new Image(); image.src = folder + metadata.source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0);
      // The outer yard base is visible at the extreme right of this measured
      // source region. The previously accepted inner quay vertex was 68px left.
      const region = { x: 400, y: 320, width: 20, height: 16 };
      const rgba = c.getImageData(region.x, region.y, region.width, region.height).data;
      let rightmost = -1;
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) if (rgba[(y * region.width + x) * 4 + 3] > 96) rightmost = Math.max(rightmost, region.x + x);
      const game = { biome: 'tundra', seed: 1847, width: 96, height: 96, tiles: Array.from({ length: 96 * 96 }, (_, variant) => ({ terrain: 'grass', elevation: 0, detail: '', variant, cleared: true })), revision: 1, networkRevision: 1, day: 0, cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [], terrainObjects: [] };
      const world = document.querySelector('#world');
      const renderer = createRenderer(world, game, { layers: { grid: true, weather: false, names: false, industryIcons: false, trees: false, routes: false } });
      const hash = () => { let h = 2166136261; for (const b of world.getContext('2d').getImageData(0, 0, world.width, world.height).data) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
      // A matching legacy site registers the compact sheet on demand. Its
      // arrival must replace already cached native scenery without resizing
      // the site, changing the world, or requiring another camera gesture.
      game.industries = [{ id: 'compact-arrival', kind: 'equipment-factory', x: 35, y: 35, footprint: 3, stock: {}, inputStock: {} }];
      game.revision++; renderer.setZoom(2); renderer.focus(36, 36);
      const revisionBefore = atlas.worldArtRevision();
      renderer.render(1000, { settle: true }); const nativeHash = hash();
      await atlas.preloadWorldArt({ cells: [16, 32, 64, 128, 256, 512], waitMs: 30000 });
      renderer.render(1000, { settle: true }); const paintedHash = hash();
      const compactReady = atlas.atlasAvailable('industry:equipment-factory:tundra:footprint-3');
      window.parcelQA = { game, world, renderer, industryAt, hash };
      return { rightmost, observed: fishery.originalMeasurements, registration: fishery.registrationPlan, errors: atlas.worldArtStats().errors, compactReady, nativeHash, paintedHash, revisionBefore, revisionAfter: atlas.worldArtRevision() };
    });
    const corners = source.observed.visibleOppositeGroundVerticesSource;
    assert.ok(source.rightmost >= 414, 'retained fishery source contains the outer yard corner');
    assert.ok(Math.abs(corners[1][0] - source.rightmost) <= 5, 'physical registration uses the outer yard boundary, never the inner quay');
    for (const axis of [0, 1]) assert.equal(source.observed.groundCenterSource[axis], (corners[0][axis] + corners[1][axis]) / 2, 'full opposite parcel corners define ground centre');
    assert.equal(source.registration.clipping.clippedNonNoiseSourcePixels, 0);
    assert.deepEqual(source.errors, []);
    assert.equal(source.compactReady, true, 'matching legacy site lazily loads its dedicated painting');
    assert.ok(source.revisionAfter > source.revisionBefore, 'late compact artwork publishes a new revision');
    assert.notEqual(source.paintedHash, source.nativeHash, 'late artwork replaces the already cached native fallback');

    for (const kind of ['fishery', 'equipment-factory']) for (const span of [3, 5]) for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ kind, span, zoom }) => {
        const q = parcelQA;
        // x/y 35 put the industry across both six-tile terrain chunk edges.
        const site = { id: kind, kind, x: 35, y: 35, footprint: span, stock: {}, inputStock: {} };
        q.game.industries = [site]; q.game.revision++;
        const before = JSON.stringify(q.game), centre = 35 + (span - 1) / 2;
        q.renderer.setZoom(zoom); q.renderer.focus(centre, centre); q.renderer.render(1000, { settle: true });
        const first = q.hash(); q.renderer.render(1000, { settle: true }); const repeated = q.hash();
        q.renderer.focus(centre + 9, centre - 9); q.renderer.render(1000, { settle: true });
        q.renderer.focus(centre, centre); q.renderer.render(1000, { settle: true });
        const restored = q.hash();
        const picks = [];
        for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < span; dx++) {
          const p = q.renderer.worldToScreen(site.x + dx, site.y + dy);
          const tile = q.renderer.screenToInspectTile(p.x, p.y);
          picks.push(tile && q.industryAt(q.game, tile.x, tile.y)?.id);
        }
        // Keep the review boundary above artwork, so its relation to the real
        // occupied parcel is visible even under an opaque factory yard.
        const c = q.world.getContext('2d'); c.save(); c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        c.strokeStyle = '#ffe769'; c.lineWidth = 1.5; c.beginPath();
        [[35, 35], [35 + span, 35], [35 + span, 35 + span], [35, 35 + span]].forEach(([x, y], i) => { const p = q.renderer.gridPointToScreen(x, y); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
        c.closePath(); c.stroke(); c.restore();
        return { first, repeated, restored, picks, immutable: before === JSON.stringify(q.game), image: q.world.toDataURL('image/png').split(',')[1], stats: q.renderer.getStats() };
      }, { kind, span, zoom });
      const label = `${kind}/span${span}/zoom${zoom}/dpr${dpr}`;
      assert.equal(result.repeated, result.first, `${label}: stable fixed-clock rendering`);
      assert.equal(result.restored, result.first, `${label}: complete parcel survives pan/cache reuse`);
      assert.ok(result.picks.every(id => id === kind), `${label}: every reserved tile inspects the same industry`);
      assert.equal(result.immutable, true, `${label}: artwork does not change the world`);
      assert.deepEqual(result.stats.worldArtwork.errors, []);
      if (kind === 'equipment-factory' && span === 3) assert.ok(Object.keys(result.stats.worldArtwork.rasterizedEntries).some(id => id.startsWith('industry:equipment-factory:tundra:footprint-3')), `${label}: final painted compact artwork was submitted`);
      const filename = `${kind}-span${span}-zoom${zoom}-dpr${dpr}.png`;
      await writeFile(`${output}/${filename}`, Buffer.from(result.image, 'base64'));
      profiles.push({ kind, span, zoom, dpr, filename, picks: result.picks.length, first: result.first, restored: result.restored });
    }
    await page.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ profiles, errors, failures }, null, 2) + '\n');
  console.log(JSON.stringify({ output, profiles: profiles.length, inspectedTiles: profiles.reduce((sum, profile) => sum + profile.picks, 0), errors }));
} finally { await browser.close(); }
