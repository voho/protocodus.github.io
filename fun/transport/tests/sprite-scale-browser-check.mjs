// The complete catalog at native game sizes. Screenshots deliberately preserve
// parcel scale so a door or vehicle can be compared across every building.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-sprite-scale-qa';
await mkdir(output, { recursive: true });
const errors = [], rows = [], integrity = [], worlds = [];
const defaultFamilies = ['catalog', 'houses', 'industries', 'cores', 'legacy'];
const allFamilies = [...defaultFamilies, 'features'];
const families = process.env.TRANSPORT_SCALE_FAMILIES ? process.env.TRANSPORT_SCALE_FAMILIES.split(',') : defaultFamilies;
assert.ok(families.length && families.every(family => allFamilies.includes(family)), 'select known sprite families');
const biomes = ['taiga', 'tundra', 'desert'];
const folders = [
  ...biomes.flatMap(biome => ['buildings-civic', 'buildings-commerce-camera-v2', 'buildings-town-features', 'town-variety-v1/civic-retail', 'town-variety-v1/shop-alternates'].map(family => `assets/world/${family}/${biome}`)),
  ...['taiga', 'taiga-extra', 'tundra', 'tundra-extra', 'desert', 'desert-extra'].map(family => `assets/world/industries-${family}`),
  ...['taiga', 'desert'].flatMap(biome => [`assets/world/food-industry-v1/${biome}`, `assets/world/farm-cores-v1/${biome}`]),
];
async function houseFolders(directory = new URL('../assets/houses/', import.meta.url), relative = 'assets/houses') {
  const children = await readdir(directory, { withFileTypes: true });
  if (children.some(child => child.name === 'atlas.json')) folders.push(relative);
  for (const child of children.filter(child => child.isDirectory())) await houseFolders(new URL(`${child.name}/`, directory), `${relative}/${child.name}`);
}
await houseFolders();
const activeFolders = folders.filter(folder => folder.startsWith('assets/houses/') ? families.includes('catalog') || families.includes('houses') : folder.includes('/buildings-town-features/') ? families.includes('catalog') || families.includes('features') : folder.includes('/buildings-') || folder.includes('/town-variety-') ? families.includes('catalog') : families.some(family => ['industries', 'cores', 'legacy'].includes(family)));
const manifests = await Promise.all(activeFolders.map(async folder => {
  let metadata;
  try { metadata = JSON.parse(await readFile(new URL(`../${folder}/atlas.json`, import.meta.url), 'utf8')); }
  catch (error) {
    if (!folder.includes('buildings-town-features') || error.code !== 'ENOENT') throw error;
    metadata = { columns: 4, rows: 3, order: ['park', 'playground', 'swimming-pool', 'sports-field', 'tennis-courts', 'ballpark', 'sports-hall', 'town-hall', 'shop-cafe', 'shop-pharmacy', 'shop-bookshop', null] };
  }
  return { folder, columns: metadata.columns, rows: metadata.rows, order: metadata.order, house: folder.startsWith('assets/houses/') };
}));

const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('tools/sprite-scale-gallery.html', base).href);
    await page.evaluate(() => window.spriteScaleGalleryReady);
    assert.deepEqual(await page.evaluate(() => spriteScaleGallery.stats().errors), [], 'all active generated sheets decode');
    for (const biome of biomes) for (const zoom of [.5, 1, 2]) for (const family of families) {
      const { profile, industryRasterDraws } = await page.evaluate(profile => {
        const count = () => Object.entries(spriteScaleGallery.stats().rasterizedEntries).filter(([kind]) => kind.startsWith('industry:')).reduce((sum, [, draws]) => sum + draws, 0);
        const before = count(), rows = spriteScaleGallery.show(profile);
        return { profile: rows, industryRasterDraws: count() - before };
      }, { biome, zoom, family });
      if (family === 'legacy') assert.equal(industryRasterDraws, 0, 'one-, two- and three-tile saved parcels keep calibrated native features instead of shrinking five-tile generated artwork');
      rows.push(...profile.map(row => ({ ...row, family })));
      for (const row of profile) {
        const label = `${family}/${row.kind}/${biome}/zoom${zoom}/DPR${dpr}/design${row.design}/rotation${row.rotation}/span${row.span}`;
        assert.equal(row.ready, true, `${label} has its current authored artwork loaded`);
        assert.equal(row.width, row.expectedWidth, `${label} retains its full parcel width`);
        assert.equal(row.height, row.expectedHeight, `${label} retains its full sprite envelope`);
        assert.ok(row.ink > 0, `${label} remains visible at this zoom`);
        assert.equal(row.edge, 0, `${label} remains isolated from neighboring sprite cells`);
        if (family === 'industries') assert.equal(row.span, 5, `${label} uses a 5×5 parcel`);
      }
      if (family === 'houses') for (const kind of new Set(profile.map(row => row.kind))) assert.equal(new Set(profile.filter(row => row.kind === kind).map(row => row.hash)).size, 6, `${kind}/${biome}/${zoom}/DPR${dpr} preserves three recognizable designs in both rotations`);
      // Complete sheets for every climate at Region and Town. Detail captures
      // retain one of each family for close review without huge duplicate files.
      if (dpr === 1 && (zoom !== 2 || biome === 'taiga')) await page.screenshot({ path: `${output}/${biome}-${family}-zoom${zoom}-dpr${dpr}.png`, fullPage: true });
      else if (dpr === 2 && biome === 'taiga' && zoom === .5) await page.screenshot({ path: `${output}/${biome}-${family}-zoom${zoom}-dpr${dpr}.png`, fullPage: true });
    }

    if (dpr === 1) integrity.push(...await page.evaluate(async manifests => {
      const results = [];
      for (const manifest of manifests) for (const cell of [16, 32, 64, 128, 256]) {
        const file = manifest.house ? `house-atlas${cell === 256 ? '' : `-${cell}`}.png` : `atlas-${cell}.png`;
        const image = new Image(); image.src = new URL(`../${manifest.folder}/${file}`, location.href).href; await image.decode();
        if (image.naturalWidth !== manifest.columns * cell || image.naturalHeight !== manifest.rows * cell) throw new Error(`Invalid density dimensions: ${manifest.folder}/${file}`);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = cell; const c = canvas.getContext('2d', { willReadFrequently: true });
        for (let index = 0; index < manifest.columns * manifest.rows; index++) {
          c.clearRect(0, 0, cell, cell); c.drawImage(image, index % manifest.columns * cell, Math.floor(index / manifest.columns) * cell, cell, cell, 0, 0, cell, cell);
          const pixels = c.getImageData(0, 0, cell, cell).data; let ink = 0, edge = 0, edgeAlphaMax = 0;
          for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
            const alpha = pixels[(y * cell + x) * 4 + 3], boundary = !x || !y || x === cell - 1 || y === cell - 1;
            if (boundary) edgeAlphaMax = Math.max(edgeAlphaMax, alpha);
            if (alpha > 16) { ink++; if (boundary) edge++; }
          }
          results.push({ folder: manifest.folder, cell, index, kind: manifest.order[index], ink, edge, edgeAlphaMax });
        }
      }
      return results;
    }, manifests));

    // The real renderer consumes 5×5 industry sprites, while farms compose a
    // separate 2×2 barn, fields and fences. Flat isolated plots make every field
    // cell inspectable, including cells that contain no barn pixels.
    if (families.some(family => ['industries', 'cores', 'legacy'].includes(family))) worlds.push(...await page.evaluate(async () => {
      const [{ createRenderer }, model, { INDUSTRIES }, fields] = await Promise.all([import('../renderer.js'), import('../model.js'), import('../data.js'), import('../farm-fields-art.js')]);
      const canvas = document.createElement('canvas'); canvas.style.width = '900px'; canvas.style.height = '650px'; document.querySelector('main').replaceChildren(canvas);
      const c = canvas.getContext('2d'), original = c.drawImage.bind(c), draws = [];
      c.drawImage = (image, ...args) => { if (args.length === 4) draws.push({ width: args[2], height: args[3], sourceWidth: image.width, sourceHeight: image.height }); return original(image, ...args); };
      const result = [];
      for (const biome of ['taiga', 'tundra', 'desert']) {
        const game = model.createGame({ biome, size: 'square512', seed: 1847, generationVersion: 10, townCount: 2, industryDistricts: 1 });
        const generated = game.industries.map(site => site.footprint);
        for (const tile of game.tiles) Object.assign(tile, { terrain: biome === 'desert' ? 'sand' : 'grass', detail: '', elevation: .25, publicRoad: false, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null, terrainObject: null });
        for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
        game.terrainObjects = []; game.money = 1_000_000;
        const renderer = createRenderer(canvas, game, { sceneryBatching: false, layers: { weather: false, routes: false, names: false, industryIcons: false, trees: false } });
        for (const [kind, definition] of Object.entries(INDUSTRIES).filter(([, definition]) => definition.biomes.includes(biome))) {
          const site = { id: kind, kind, name: definition.name, x: 40, y: 40, footprint: 5, stock: {}, delivered: {}, inputs: {}, lastProduction: 0 };
          game.industries = [site]; game.stations = []; game.revision++; game.networkRevision++;
          const portPoint = { x: site.x + 9, y: site.y + 4 };
          game.tiles[portPoint.y * game.width + portPoint.x].terrain = 'water';
          const port = model.build(game, 'port', portPoint.x, portPoint.y);
          const portCovered = port.ok && model.stationCoverage(game, port.station).industries.some(industry => industry.id === site.id);
          renderer.setGame(game);
          for (const zoom of [.5, 1, 2]) {
            draws.length = 0; renderer.setZoom(zoom); renderer.focus(42, 42); renderer.render(0);
            const stats = renderer.getStats(), farm = fields.isLargeFarm(site), projection = draws.filter(draw => draw.width === (farm ? 96 : 240) && draw.height === (farm ? 108 : 252));
            const perimeter = [], picked = [];
            for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
              const point = renderer.worldToScreen(site.x + dx, site.y + dy), rect = canvas.getBoundingClientRect(), hit = renderer.screenToInspectTile(point.x + rect.left, point.y + rect.top);
              if (farm) picked.push(hit.x === site.x && hit.y === site.y);
              if (!dx || !dy || dx === 4 || dy === 4) perimeter.push(...fields.farmFenceSections(site, site.x + dx, site.y + dy));
            }
            const edgeStop = { id: 'edge-stop', name: 'Edge loading bay', x: site.x + 9, y: site.y + 4, mode: 'road' };
            const coverage = model.stationCoverage(game, edgeStop);
            let markerPick = null, markerGateTile = null;
            if (farm) {
              renderer.setLayers({ industryIcons: true }); renderer.render(0);
              const marker = renderer.industryMarker(site), rect = canvas.getBoundingClientRect();
              const hit = renderer.screenToInspectTile(marker.x + rect.left, marker.y + rect.top);
              markerPick = hit.x === site.x && hit.y === site.y;
              markerGateTile = renderer.screenToTile(marker.x + rect.left, marker.y + rect.top - 5 - (marker.size + 6) / 2);
              renderer.setLayers({ industryIcons: false });
            }
            result.push({ biome, kind, zoom, dpr: devicePixelRatio, generated, farm, picked, projection, markerPick, markerGateTile, portOpened: Boolean(port.ok), portCovered, rasterScale: stats.rasterScale, fenceSections: perimeter.length, fenceWithinParcel: perimeter.every(section => [...section.a, ...section.b].every(Number.isFinite) && [section.a, section.b].every(([x, y]) => x >= site.x && x <= site.x + 5 && y >= site.y && y <= site.y + 5)), edgeCovered: coverage.industries.some(industry => industry.id === site.id) });
          }
        }
      }
      return result;
    }));
    await context.close();
  }
  for (const row of integrity) {
    const label = `${row.folder}/${row.kind || 'empty'}/${row.cell}`;
    if (row.kind) assert.ok(row.ink > 0, `${label} contains its complete cutout`);
    else assert.equal(row.ink, 0, `${label} unused atlas cells remain empty`);
    // Eight transparent master pixels become half a pixel at the emergency
    // 16px density. Its antialiasing can leave a faint fractional fringe; the
    // actual game-size profiles above still reject meaningful body pixels at
    // the output boundary, while recording fractional fringe opacity.
    if (row.cell === 16) assert.ok(row.edgeAlphaMax <= 64, `${label} has no opaque body pixels on its cell boundary`);
    else assert.equal(row.edge, 0, `${label} has transparent isolation gutters`);
  }
  for (const row of worlds) {
    const label = `${row.kind}/${row.biome}/${row.zoom}/DPR${row.dpr}`;
    assert.ok(row.generated.length && row.generated.every(span => span === 5), `${label} recipe 10 generates only 5×5 industry parcels`);
    assert.ok(row.projection.length > 0, `${label} reaches the actual ${row.farm ? '2×2 barn' : '5×5 industry'} renderer path`);
    assert.equal(row.edgeCovered, true, `${label} loading coverage measures the far parcel edge`);
    assert.equal(row.portOpened, true, `${label} a real port builds beside the distant shore`);
    assert.equal(row.portCovered, true, `${label} the port serves the five-tile parcel from its far edge`);
    if (row.farm) {
      assert.ok(row.picked.length === 25 && row.picked.every(Boolean), `${label} every farm cell inspects its site`);
      assert.ok(row.fenceSections >= 20, `${label} retains fences around the fields`);
      assert.equal(row.fenceWithinParcel, true, `${label} fences follow the 5×5 boundary`);
      assert.equal(row.markerPick, true, `${label} the actual resource marker inspects its farm`);
      assert.deepEqual(row.markerGateTile, { x: 42, y: 44 }, `${label} the resource marker attaches to the visible five-tile gate`);
    }
  }
  assert.deepEqual(errors, []);
  const summary = { spriteProfiles: rows.length, catalogKinds: new Set(rows.filter(row => row.family === 'catalog' && !row.auxiliary).map(row => row.kind)).size, workshopProfiles: rows.filter(row => row.auxiliary).length, houseVariants: rows.filter(row => row.family === 'houses').length, industryKinds: new Set(rows.filter(row => row.family === 'industries').map(row => row.kind)).size, atlasDensities: manifests.length * 5, populatedAtlasCells: integrity.filter(row => row.kind).length, rendererProfiles: worlds.length, errors };
  if (families.includes('catalog')) assert.equal(summary.catalogKinds, 43, 'every building catalog identity appears');
  if (families.includes('industries')) assert.equal(summary.industryKinds, 28, 'every industry identity appears');
  if (families.includes('features')) assert.equal(new Set(rows.map(row => row.kind)).size, 11, 'every recent town-feature identity appears');
  await writeFile(`${output}/results.json`, JSON.stringify({ summary, rows, integrity, worlds }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
