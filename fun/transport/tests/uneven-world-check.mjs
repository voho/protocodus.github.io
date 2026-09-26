// An isolated, sequential comparison, deliberately outside the *.test.mjs suite.
// Run: node tests/uneven-world-check.mjs [--quick] [--output=/tmp/transport-uneven-qa]
// Each child releases its complete map before the next 2048² map is generated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const mean = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const variance = values => mean(values.map(value => (value - mean(values)) ** 2));
const cv = values => Math.sqrt(variance(values)) / (mean(values) || 1);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] || 0;
const round = number => Math.round(number * 1000) / 1000;
const legacyHashes = {
  taiga: 'b274899b12b844f752c479e06c73ab5e15743565d5c3fbac9eca279f78194d82',
  tundra: 'a65ce2a006ac578d54c9cbeaa97ee4045dd7ad3e96e7ddbf9d54c60409381397',
  desert: '1868a17505177dde18593d02bc1e47a4f00f0bc0c5a3f9f7ef4405018dc85e45',
};

if (process.argv.includes('--child')) {
  const spec = JSON.parse(process.argv.at(-1));
  const { generateWorld, NEW_WORLD_SIZES } = await import('../world.js');
  const { INDUSTRIES } = await import('../data.js');
  const { findPath } = await import('../model.js');
  const start = performance.now();
  const world = generateWorld(spec.biome, spec.seed, spec.size, spec.version);
  const generationMs = performance.now() - start;
  globalThis.gc?.();
  const memory = process.memoryUsage();
  const { width, height, tiles, cities, industries } = world;
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const tileAt = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  const config = NEW_WORLD_SIZES[spec.size];
  check(width === config.width && height === config.height && tiles.length === width * height, 'dimensions match the selected world');
  check(cities.length === config.towns, 'every requested town is generated');
  check(new Set(cities.map(city => city.name)).size === cities.length, 'town names remain distinct');
  check(cities.every(city => tileAt(city.x, city.y)?.terrain !== 'water'), 'all town centers stand on land');
  check(generationMs < 30000, 'generation stays under a generous 30-second local budget');
  check(memory.heapUsed < 1.25 * 1024 ** 3, 'a single object grid fits a 1.25 GiB heap budget');

  const industryCounts = {};
  for (const site of industries) {
    industryCounts[site.kind] = (industryCounts[site.kind] || 0) + 1;
    check(tileAt(site.x, site.y)?.terrain !== 'water', `industry ${site.id} stands on land`);
    if (INDUSTRIES[site.kind].coastal) check([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(site.x + dx, site.y + dy)?.terrain === 'water'), `coastal industry ${site.id} has an actual shore`);
  }
  for (const [kind, definition] of Object.entries(INDUSTRIES)) if (definition.biomes.includes(spec.biome)) {
    check(industryCounts[kind] === config.clusters, `${kind}: all ${config.clusters} production sites exist`);
  }

  const terrainNames = ['grass', 'forest', 'water', 'sand', 'snow', 'rock', 'mountain'];
  const terrainCounts = Object.fromEntries(terrainNames.map(name => [name, 0]));
  const regions = Array.from({ length: 64 }, () => ({ land: 0, water: 0, forest: 0, mountain: 0, towns: 0 }));
  let waterBuildings = 0, waterDams = 0, unknownTerrain = 0, forestEdges = 0, forestInterior = 0, riverCount = 0;
  const regionFor = (x, y) => regions[Math.floor(y * 8 / height) * 8 + Math.floor(x * 8 / width)];
  for (let y = 0, index = 0; y < height; y++) for (let x = 0; x < width; x++, index++) {
    const tile = tiles[index], region = regionFor(x, y);
    if (!Object.hasOwn(terrainCounts, tile.terrain)) { unknownTerrain++; continue; }
    terrainCounts[tile.terrain]++;
    if (tile.terrain === 'water') {
      region.water++; waterBuildings += Boolean(tile.building); waterDams += Boolean((tile.road || tile.rail) && !tile.bridge);
      if (tile.detail === 'river') riverCount++;
    } else {
      region.land++;
      if (tile.terrain === 'mountain' || tile.terrain === 'rock') region.mountain++;
      if (tile.terrain === 'forest') {
        region.forest++;
        if (x + 1 < width) { forestEdges++; forestInterior += tiles[index + 1].terrain === 'forest'; }
        if (y + 1 < height) { forestEdges++; forestInterior += tiles[index + width].terrain === 'forest'; }
      }
    }
  }
  check(unknownTerrain === 0, 'logical terrain categories remain compatible');
  check(waterBuildings === 0, 'buildings never occupy water');
  check(waterDams === 0, 'streets crossing water form bridges rather than dams');
  check(riverCount > width, 'world contains a substantial navigable river network');
  check(terrainCounts.water / tiles.length > .025 && terrainCounts.water / tiles.length < .60, 'water leaves substantial room for both shipping and land transport');
  for (const city of cities.slice(2)) regionFor(city.x, city.y).towns++;

  const starterRoad = findPath(world, cities[0], cities[1], 'road');
  check(starterRoad?.length === 25, 'starter towns retain the short 25-tile road connection');
  function berths(city) {
    const result = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy > 25) continue;
      const x = city.x + dx, y = city.y + dy, tile = tileAt(x, y);
      if (!tile || tile.terrain !== 'water' || tile.road || tile.rail || tile.bridge || tile.tunnel || tile.building || tile.zone) continue;
      if (industries.some(site => site.x === x && site.y === y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => { const bank = tileAt(x + ox, y + oy); return bank && bank.terrain !== 'water'; })) result.push(y * width + x);
    }
    return result;
  }
  const fromBerths = berths(cities[0]), toBerths = berths(cities[1]);
  check(fromBerths.length > 0 && toBerths.length > 0, 'both starter towns have an empty shoreline berth within port coverage');
  const seen = new Uint8Array(tiles.length), queue = [], targets = new Set(toBerths);
  for (const index of fromBerths) { seen[index] = 1; queue.push(index); }
  let connectedBerths = false, mouth = false, visitedRivers = 0;
  // One traversal verifies both the shared starter shipping route and its outlet
  // to an edge sea; no assumptions about a particular coastline orientation.
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], x = index % width, y = Math.floor(index / width);
    if (targets.has(index)) connectedBerths = true;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) mouth = true;
    visitedRivers += tiles[index].detail === 'river';
    for (const next of [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y ? index - width : -1, y + 1 < height ? index + width : -1]) {
      if (next >= 0 && !seen[next] && tiles[next].terrain === 'water') { seen[next] = 1; queue.push(next); }
    }
  }
  check(connectedBerths, 'starter port sites share cardinally navigable water');
  check(mouth, 'starter river reaches a sea at the world edge');
  check(visitedRivers === riverCount, 'every river branch joins the same navigable watershed');

  const activeRegions = regions.filter(region => region.land > width * height / 64 * .2);
  const forestFractions = activeRegions.map(region => region.forest / region.land);
  const mountainFractions = activeRegions.map(region => region.mountain / region.land);
  const townCounts = activeRegions.map(region => region.towns);
  const nearestTown = cities.slice(2).map(city => Math.min(...cities.filter(other => other !== city).map(other => Math.hypot(city.x - other.x, city.y - other.y))));
  const footprints = cities.slice(2).map(city => {
    let count = 0;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) count += Boolean(tileAt(city.x + dx, city.y + dy)?.building);
    return count;
  });
  const resourceSupport = {};
  const resourceHabitat = {
    'logging-camp': ['forest'], farm: ['grass'], 'coal-mine': ['rock', 'mountain'],
    'iron-mine': ['rock', 'mountain'], 'copper-mine': ['rock', 'mountain'], quarry: ['rock', 'mountain'], 'sand-pit': ['sand'],
  };
  for (const [kind, habitats] of Object.entries(resourceHabitat)) {
    const fractions = industries.filter(site => site.kind === kind).map(site => {
      let suitable = 0, total = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (!dx && !dy) continue;
        const tile = tileAt(site.x + dx, site.y + dy); if (!tile) continue;
        total++; suitable += habitats.includes(tile.terrain);
      }
      return suitable / total;
    });
    if (fractions.length) resourceSupport[kind] = round(mean(fractions));
  }

  let fingerprint;
  if (spec.size === 'square512') {
    fingerprint = createHash('sha256').update(JSON.stringify(world)).digest('hex');
    if (spec.version === 1 && spec.seed === 1847) check(fingerprint === legacyHashes[spec.biome], 'the frozen version-1 save recipe is unchanged');
    if (spec.determinism) {
      const replay = generateWorld(spec.biome, spec.seed, spec.size, spec.version);
      check(createHash('sha256').update(JSON.stringify(replay)).digest('hex') === fingerprint, 'replaying the same recipe produces exactly the same world');
    }
  }
  const palettes = {
    taiga: { grass: '#879468', forest: '#385e46', water: '#518eaa', sand: '#c6b582', snow: '#d7dfd5', rock: '#878c7a', mountain: '#aaa99b' },
    tundra: { grass: '#a4ac92', forest: '#547469', water: '#639cae', sand: '#c6b582', snow: '#d7dfd5', rock: '#8b9692', mountain: '#f0f1e7' },
    desert: { grass: '#8d9c61', forest: '#687e41', water: '#508d9d', sand: '#c6a575', snow: '#d7dfd5', rock: '#a17559', mountain: '#ce8b64' },
  };
  const palette = Object.fromEntries(Object.entries(palettes[spec.biome]).map(([name, color]) => [name, color.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16))]));
  const edge = 512, block = width / edge, rgba = new Uint8Array(edge * edge * 4);
  for (let ay = 0; ay < edge; ay++) for (let ax = 0; ax < edge; ax++) {
    const counts = new Uint8Array(terrainNames.length); let river = false, road = false;
    for (let by = 0; by < block; by++) for (let bx = 0; bx < block; bx++) {
      const tile = tiles[(ay * block + by) * width + ax * block + bx];
      counts[terrainNames.indexOf(tile.terrain)]++; river ||= tile.terrain === 'water' && tile.detail === 'river'; road ||= tile.road;
    }
    const terrain = river ? 'water' : terrainNames[counts.indexOf(Math.max(...counts))];
    const color = road && !river ? [189, 176, 139] : palette[terrain];
    const offset = (ay * edge + ax) * 4;
    rgba.set([...color, 255], offset);
  }
  console.log(JSON.stringify({
    ...spec, generationMs: Math.round(generationMs), heapMiB: Math.round(memory.heapUsed / 1024 ** 2), rssMiB: Math.round(memory.rss / 1024 ** 2),
    width, height, towns: cities.length, industries: industries.length, industryCounts, failures, fingerprint,
    terrain: Object.fromEntries(Object.entries(terrainCounts).map(([name, count]) => [name, round(count / tiles.length)])),
    regions: { forestRange: round(percentile(forestFractions, .9) - percentile(forestFractions, .1)), forestCV: round(cv(forestFractions)), mountainRange: round(percentile(mountainFractions, .9) - percentile(mountainFractions, .1)), forestNeighborAgreement: round(forestInterior / Math.max(1, forestEdges)) },
    placement: { nearestTownCV: round(cv(nearestTown)), nearestTownMean: round(mean(nearestTown)), emptyLandRegions: activeRegions.filter(region => !region.towns).length, landRegions: activeRegions.length, townRegionFano: round(variance(townCounts) / Math.max(.01, mean(townCounts))), buildingFootprintCV: round(cv(footprints)) },
    resourceSupport, starter: { roadLength: starterRoad?.length, berths: [fromBerths.length, toBerths.length], connectedBerths, mouth, riverTiles: riverCount, reachableRiverTiles: visitedRivers },
    atlas: { edge, rgba: Buffer.from(rgba).toString('base64'), cities: cities.map(({ x, y }, index) => ({ x: x / width * edge, y: y / height * edge, starter: index < 2 })), industries: industries.map(({ x, y }) => ({ x: x / width * edge, y: y / height * edge })) },
  }));
} else {
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || '/tmp/transport-uneven-qa';
  await mkdir(output, { recursive: true });
  const quick = process.argv.includes('--quick');
  const cases = [];
  for (const seed of quick ? [1847] : [1847, 7193]) for (const biome of ['taiga', 'tundra', 'desert']) cases.push({ biome, seed, size: 'square512' });
  if (!quick) for (const size of ['square1024', 'square2048']) ['taiga', 'tundra', 'desert'].forEach((biome, index) => cases.push({ biome, seed: [1847, 7193, 90210][index], size }));
  const runtime = process.env.TRANSPORT_PLAYWRIGHT || 'playwright';
  const { chromium } = await import(runtime);
  const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1240, height: 794 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const comparisons = [], allFailures = [];
  try {
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;background:#15251f;color:#edf0e7;font:15px system-ui;padding:24px 36px}h1{margin:0;font-size:27px;font-weight:600}#subtitle{color:#aeb9ac;margin:7px 0 18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:36px}h2{font-size:18px;margin:0 0 10px}canvas{width:548px;height:548px;image-rendering:pixelated;border:1px solid #78897b}.metrics{line-height:1.65;font-size:14px;margin-top:8px;color:#c5d0bf}.legend{margin-top:12px;color:#aeb9ac;font-size:13px}.gold{color:#f1c361}.white{color:#fff4de}.mint{color:#87f1c2}
      </style></head><body><h1>Regional geography · <span id="title"></span></h1><p id="subtitle"></p><div class="pair"><section><h2>Version 1 · existing saves</h2><canvas id="old" width="512" height="512"></canvas><div class="metrics" id="old-metrics"></div></section><section><h2>Version 2 · new worlds</h2><canvas id="new" width="512" height="512"></canvas><div class="metrics" id="new-metrics"></div></section></div><div class="legend"><span class="white">● Towns</span> &nbsp; <span class="mint">◯ Starter towns</span> &nbsp; <span class="gold">◆ Industries</span> &nbsp; Terrain colors show native forest, open ground, mountains and water. Both atlases use the same scale.</div></body></html>`);
    for (const spec of cases) {
      const pair = [];
      for (const version of [1, 2]) {
        const result = execFileSync(process.execPath, ['--expose-gc', '--max-old-space-size=2048', self, '--child', JSON.stringify({ ...spec, version, determinism: version === 2 && spec.size === 'square512' && spec.seed === 1847 })], { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2, timeout: 120000 });
        pair.push(JSON.parse(result));
      }
      await page.evaluate(({ spec, pair }) => {
        document.querySelector('#title').textContent = spec.biome[0].toUpperCase() + spec.biome.slice(1);
        document.querySelector('#subtitle').textContent = `${pair[0].width} × ${pair[0].height} tiles · seed ${spec.seed} · ${pair[0].towns} towns · ${pair[0].industries} industries`;
        for (let i = 0; i < pair.length; i++) {
          const result = pair[i], id = i ? 'new' : 'old', canvas = document.querySelector('#' + id), ctx = canvas.getContext('2d');
          const raw = atob(result.atlas.rgba), bytes = Uint8ClampedArray.from(raw, char => char.charCodeAt(0));
          ctx.putImageData(new ImageData(bytes, 512, 512), 0, 0);
          for (const site of result.atlas.industries) { ctx.fillStyle = '#f1c361'; ctx.fillRect(site.x - 1, site.y - 1, 2, 2); }
          for (const city of result.atlas.cities) {
            ctx.beginPath(); ctx.arc(city.x, city.y, city.starter ? 4 : 2.2, 0, Math.PI * 2); ctx.fillStyle = city.starter ? '#87f1c2' : '#fff4de'; ctx.fill(); ctx.strokeStyle = '#20382c'; ctx.lineWidth = .8; ctx.stroke();
          }
          document.querySelector('#' + id + '-metrics').textContent = `Town spacing variation ${result.placement.nearestTownCV.toFixed(2)} · Empty land regions ${result.placement.emptyLandRegions}/${result.placement.landRegions}\nForest regional range ${(result.regions.forestRange * 100).toFixed(0)}% · Generation ${result.generationMs} ms · Heap ${result.heapMiB} MiB`;
          document.querySelector('#' + id + '-metrics').style.whiteSpace = 'pre-line';
        }
      }, { spec, pair });
      const artifact = `${output}/${spec.size}-${spec.biome}-${spec.seed}.png`;
      await page.screenshot({ path: artifact, fullPage: true });
      const clean = pair.map(({ atlas, ...metrics }) => metrics);
      comparisons.push({ ...spec, artifact, old: clean[0], current: clean[1] });
      for (const result of clean) for (const failure of result.failures) allFailures.push(`${spec.size}/${spec.biome}/${spec.seed}/v${result.version}: ${failure}`);
      console.log(JSON.stringify({ ...spec, generationMs: pair.map(result => result.generationMs), nearestTownCV: pair.map(result => result.placement.nearestTownCV), forestRange: pair.map(result => result.regions.forestRange), forestNeighborAgreement: pair.map(result => result.regions.forestNeighborAgreement), failures: pair.map(result => result.failures), artifact }));
      await writeFile(`${output}/report.json`, JSON.stringify({ comparisons, failures: allFailures }, null, 2));
    }
  } finally { await context.close(); await browser.close(); }
  const regional = comparisons.filter(result => result.size === 'square512');
  const averages = Object.fromEntries(['old', 'current'].map(version => [version, {
    townSpacingCV: round(mean(regional.map(pair => pair[version].placement.nearestTownCV))),
    townRegionFano: round(mean(regional.map(pair => pair[version].placement.townRegionFano))),
    forestRange: round(mean(regional.map(pair => pair[version].regions.forestRange))),
    forestNeighborAgreement: round(mean(regional.map(pair => pair[version].regions.forestNeighborAgreement))),
    buildingFootprintCV: round(mean(regional.map(pair => pair[version].placement.buildingFootprintCV))),
  }]));
  // Assert geographic variety over a seed/biome ensemble, rather than requiring
  // every individual random map to improve every statistic in the same way.
  assert.ok(averages.current.townSpacingCV > averages.old.townSpacingCV * 1.1, 'new towns have substantially more varied spacing over the sampled ensemble');
  assert.ok(averages.current.buildingFootprintCV > averages.old.buildingFootprintCV * 1.1, 'town footprints vary beyond the previous repeated city template');
  assert.ok(averages.current.forestNeighborAgreement > averages.old.forestNeighborAgreement, 'forest regions become more locally coherent, rather than noisier');
  await writeFile(`${output}/report.json`, JSON.stringify({ comparisons, averages, failures: allFailures }, null, 2));
  console.log(JSON.stringify({ averages, mapsCompared: comparisons.length * 2, report: `${output}/report.json` }));
  assert.deepEqual(allFailures, [], 'generated worlds satisfy transport, settlement, and compatibility invariants');
}
