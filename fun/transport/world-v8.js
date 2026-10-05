import { INDUSTRIES } from './data.js';
import { BUILDINGS, residentialKind, SHOP_KINDS } from './buildings.js';
import { seedNumber, randomSource, hashNoise, noise } from './world-noise.js';
import { generatedElevation } from './world-tiles.js';
import { buildingFootprint, placeBuildingSite } from './building-sites.js';
import { industryFootprint, industrySiteProblem, industrySpacingProblem } from './industry-sites.js';
import { generateTerrainV8, levelElevation, WATER_POND } from './world-terrain-v8.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Settlement sizes. A town's buildings stay within `radius` of its centre, so
// the ten-tile town reach always covers them. Each civic kind comes with the
// chance that a town of that size has one.
const PROFILES = {
  hamlet: { radius: 3, population: [170, 240], fill: .72, civic: { pub: .45, playground: .35 }, shops: [0, 1] },
  village: { radius: 5, population: [450, 550], fill: .8, civic: { pub: .9, church: .75, playground: .7, school: .4, 'sports-field': .35, 'service-post-office': .3, park: .25, 'police-station': .2, 'fire-station': .15 }, shops: [1, 3] },
  town: { radius: 7, population: [950, 550], fill: .86, civic: { 'town-hall': .8, church: 1, pub: 1, school: 1, 'service-post-office': .9, 'police-station': .9, playground: .9, park: .8, 'service-garage': .7, 'fire-station': .7, 'sports-field': .7, 'service-bank': .5, 'tennis-courts': .5, 'service-barber': .4, 'swimming-pool': .4, 'sports-hall': .3 }, shops: [3, 5] },
  city: { radius: 9, population: [1500, 600], fill: .9, civic: { 'town-hall': 1, church: 1, pub: 1, school: 1, 'service-post-office': 1, 'service-garage': 1, 'service-bank': 1, 'police-station': 1, 'fire-station': 1, hospital: 1, park: 1, playground: 1, 'service-hotel': .8, 'sports-field': .8, 'tennis-courts': .8, 'swimming-pool': .8, 'service-barber': .7, 'sports-hall': .7, stadium: .35, ballpark: .3 }, shops: [5, 8] },
};
// The opening town shows a little of everything a town can have.
const SHOWCASE = ['town-hall', 'church', 'pub', 'school', 'park', 'playground', 'service-post-office', 'service-bank', 'service-garage', 'police-station', 'service-barber', 'service-hotel'];
// Where each civic kind stands, as a share of the town's radius from its centre.
const PLACE = { 'town-hall': .1, church: .25, pub: .15, 'service-post-office': .2, 'service-bank': .25, 'service-barber': .3, 'service-hotel': .35, park: .4, school: .55, 'police-station': .5, playground: .6, 'fire-station': .6, hospital: .7, 'sports-hall': .7, 'swimming-pool': .75, 'tennis-courts': .8, 'service-garage': .85, 'sports-field': .95, stadium: 1, ballpark: 1 };
// A town's buildings stay within this many tiles of its centre, the reach that counts them as the town's.
const REACH = 10;

// The renderer's vertex heights (terrain-geometry.js): each vertex takes the
// level of the tile to its south-east, any corner touching water is 0, and
// neighbouring vertices never differ by more than one level.
function vertexLevels(tiles, width, height) {
  const stride = width + 1, field = new Uint8Array(stride * (height + 1));
  const at = (x, y) => tiles[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    const wet = at(x - 1, y - 1).terrain === 'water' || at(x, y - 1).terrain === 'water' || at(x - 1, y).terrain === 'water' || at(x, y).terrain === 'water';
    field[y * stride + x] = wet ? 0 : Math.round(clamp(at(x, y).elevation, 0, 1) * 7);
  }
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    const i = y * stride + x;
    if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
    if (y) { field[i] = Math.min(field[i], field[i - stride] + 1); if (x) field[i] = Math.min(field[i], field[i - stride - 1] + 1); if (x < width) field[i] = Math.min(field[i], field[i - stride + 1] + 1); }
  }
  for (let y = height; y >= 0; y--) for (let x = width; x >= 0; x--) {
    const i = y * stride + x;
    if (x < width) field[i] = Math.min(field[i], field[i + 1] + 1);
    if (y < height) { field[i] = Math.min(field[i], field[i + stride] + 1); if (x < width) field[i] = Math.min(field[i], field[i + stride + 1] + 1); if (x) field[i] = Math.min(field[i], field[i + stride - 1] + 1); }
  }
  return field;
}

// Save recipe 8: drainage-shaped terrain, towns at river crossings, shores and
// valley floors, with streets on levelled ground and a civic core.
export function generateWorldV8(biome, seed, size, config) {
  const terrain = generateTerrainV8(biome, seed, config), { width, height, tiles } = terrain;
  const game = { width, height, size, generationVersion: 8, tiles, cities: [], industries: [], zones: [], stations: [], routes: [], vehicles: [] };
  const site = { ...game, biome };
  const numericSeed = seedNumber(seed), random = randomSource(numericSeed ^ 0x3a8f21c7);
  const vertices = settle(site, biome, numericSeed, random, config, terrain);
  placeIndustries(site, biome, numericSeed, random, config, vertices);
  return game;
}

function settle(game, biome, seed, random, config, terrain) {
  const { width, height, tiles } = game, land = terrain.land, { cx: ax, cy: ay } = terrain.opening;
  const tile = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  const level = t => Math.round(clamp(t.elevation, 0, 1) * 7);
  const buildable = t => t && t.terrain !== 'water' && t.terrain !== 'mountain' && t.terrain !== 'rock';

  // Each tile's level, or -1 where nothing can be built: the site search reads it about a hundred times per site.
  const ground = new Int8Array(width * height);
  for (let i = 0; i < ground.length; i++) ground[i] = buildable(tiles[i]) ? level(tiles[i]) : -1;
  // Town sites: dry, even ground a few tiles back from a river, lake or coast.
  // In the desert only the water's edge is worth settling.
  const candidates = [];
  for (let y = 12; y < height - 12; y += 3) for (let x = 12; x < width - 12; x += 3) {
    const i = y * width + x, lv = ground[i];
    if (lv < 0 || terrain.distance[i] < 3) continue;
    let even = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (ground[i + dy * width + dx] === lv) even++;
    if (even < 30) continue;
    // Room to grow: level, dry ground out to six tiles, sampled every other tile.
    let room = 0;
    for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) { const n = ground[i + dy * width + dx]; if (n >= 0 && Math.abs(n - lv) <= 1) room++; }
    room /= 49;
    const d = terrain.distance[i], shore = d <= 8 ? 1 : Math.max(0, 1 - (d - 8) / (biome === 'desert' ? 12 : 34));
    const score = even / 49 * .5 + room * .8 + shore * (biome === 'desert' ? 2.4 : 1) + Math.min(1, terrain.near[i] / 2.4) * .35 - Math.max(0, lv - 3) * .18
      + noise(x, y, seed + 4211, Math.max(40, width / 9)) * .6 + hashNoise(x, y, seed + 4217) * .25;
    candidates.push({ x, y, score, room });
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const towns = [{ x: ax, y: ay, starter: true }, { x: ax + 24, y: ay, starter: true }];
  const far = (x, y, spacing) => towns.every(town => Math.hypot(town.x - x, town.y - y) >= spacing);
  for (const pass of [0, 1, 2]) for (const c of candidates) {
    if (towns.length >= config.towns) break;
    const spacing = pass === 2 ? 12 : pass === 1 ? 14 : 15 + hashNoise(c.x >> 3, c.y >> 3, seed + 4223) * 6;
    if (far(c.x, c.y, spacing)) towns.push({ x: c.x, y: c.y, score: c.score, room: c.room });
  }
  // A rugged seed still gets every town: any dry tile far enough from the rest.
  for (let attempt = 0; towns.length < config.towns && attempt < config.towns * 2000; attempt++) {
    const x = 12 + Math.floor(random() * (width - 24)), y = 12 + Math.floor(random() * (height - 24));
    if (buildable(tile(x, y)) && far(x, y, 12)) towns.push({ x, y, score: 0, room: 0 });
  }
  if (towns.length !== config.towns) throw new Error('Could not find enough habitable town sites in this world.');
  // The best, roomiest sites grow into the largest towns: about a tenth become cities.
  const ranked = towns.slice(2).sort((a, b) => b.score + b.room - a.score - a.room);
  ranked.forEach((town, rank) => { const share = rank / Math.max(1, ranked.length); town.profile = share < .1 ? 'city' : share < .28 ? 'town' : share < .68 ? 'village' : 'hamlet'; });
  towns[0].profile = 'town'; towns[1].profile = 'village';

  // Level each town's ground: tiles one level above the town's usual level
  // come down to it, so streets and houses stand flat without stone plinths.
  const lower = (x, y, target) => { const t = tile(x, y); if (buildable(t) && level(t) === target + 1) t.elevation = generatedElevation(Math.round(levelElevation(target) * 1024) / 1024); };
  const usualLevel = (cx, cy, r) => {
    const counts = new Array(8).fill(0);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const t = tile(cx + dx, cy + dy); if (buildable(t)) counts[level(t)]++; }
    return counts.indexOf(Math.max(...counts));
  };
  for (const town of towns) {
    const r = PROFILES[town.profile].radius + 1, target = usualLevel(town.x, town.y, r);
    // Ponds inside a town were drained long ago; they would leave pits in its streets.
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const x = town.x + dx, y = town.y + dy, t = tile(x, y);
      if (t && terrain.kind[y * width + x] === WATER_POND) Object.assign(t, { terrain: land, detail: '', elevation: generatedElevation(Math.round(levelElevation(Math.max(1, target)) * 1024) / 1024) });
    }
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) lower(town.x + dx, town.y + dy, target);
  }
  // The opening road runs on a levelled bed, so the first route always has its road.
  const roadLevel = Math.max(1, usualLevel(ax + 12, ay, 3));
  for (let x = ax - 1; x <= ax + 25; x++) for (let y = ay - 1; y <= ay + 1; y++) { const t = tile(x, y); if (t.terrain !== 'water') { t.elevation = generatedElevation(Math.round(levelElevation(roadLevel) * 1024) / 1024); if (t.terrain === 'mountain' || t.terrain === 'rock') t.terrain = land; } }
  const vertices = vertexLevels(tiles, width, height), stride = width + 1;
  const vertex = (x, y) => vertices[y * stride + x];
  const flat = (x, y) => { const h = vertex(x, y); return vertex(x + 1, y) === h && vertex(x, y + 1) === h && vertex(x + 1, y + 1) === h; };
  // Streets run on flat ground or straight up a slope along their own axis.
  const graded = (x, y, horizontal) => horizontal ? vertex(x, y) === vertex(x, y + 1) && vertex(x + 1, y) === vertex(x + 1, y + 1) : vertex(x, y) === vertex(x + 1, y) && vertex(x, y + 1) === vertex(x + 1, y + 1);

  // Every tile under a building, and the town centres kept open for their first stop.
  const placed = new Set(), centres = new Set(towns.map(town => town.y * width + town.x));
  const street = (x, y) => {
    const t = tile(x, y);
    if (t.terrain === 'water') t.bridge = true;
    else { t.terrain = land; t.detail = ''; }
    t.road = true; t.publicRoad = true; t.building = null;
  };
  // Lay one street tile, or a short bridge to the bank beyond. False ends the street.
  const extend = (x, y, dx, dy) => {
    const t = tile(x, y);
    if (!t || x < 2 || y < 2 || x >= width - 2 || y >= height - 2 || placed.has(y * width + x)) return false;
    if (t.road) return true;
    if (t.terrain === 'water') {
      let bank = 0;
      for (let step = 1; step <= 4; step++) { const n = tile(x + dx * step, y + dy * step); if (!n || placed.has((y + dy * step) * width + x + dx * step) || n.terrain === 'mountain' || n.terrain === 'rock') break; if (n.terrain !== 'water') { bank = step; break; } }
      if (!bank || !buildable(tile(x + dx * bank, y + dy * bank)) || !graded(x + dx * bank, y + dy * bank, dx !== 0)) return false;
      for (let step = 0; step <= bank; step++) street(x + dx * step, y + dy * step);
      return true;
    }
    if (!buildable(t) || !graded(x, y, dx !== 0)) return false;
    street(x, y);
    return true;
  };

  const nameLists = {
    taiga: { names: ['Alderbrook', 'Pinehaven', 'Cedar Falls', 'Northmere'], prefixes: ['Birch', 'Willow', 'Cedar', 'Elm', 'Fern', 'Oak', 'Moss', 'Ash'] },
    tundra: { names: ['Frostholm', 'Whitehaven', 'Snowbridge', 'Northwatch'], prefixes: ['Ice', 'Frost', 'Winter', 'Snow', 'White', 'North', 'Glacier', 'Silver'] },
    desert: { names: ['Sunspire', 'Copper Mesa', 'Oasis Springs', 'Redstone'], prefixes: ['Amber', 'Copper', 'Dune', 'Palm', 'Sun', 'Golden', 'Red', 'Saffron'] },
  }[biome] || { names: [], prefixes: ['North'] };
  const suffixes = ['ford', 'haven', 'field', 'mere', 'ridge', 'bridge', 'brook', 'vale'], nameCounts = new Map();
  // The opening towns share one straight road.
  for (let x = ax; x <= ax + 24; x++) if (!extend(x, ay, 1, 0)) street(x, ay);

  for (let n = 0; n < towns.length; n++) {
    const town = towns[n], profile = PROFILES[town.profile], R = profile.radius, cx = town.x, cy = town.y;
    const baseName = nameLists.names[n] || nameLists.prefixes[(n - 4) % nameLists.prefixes.length] + suffixes[Math.floor((n - 4) / nameLists.prefixes.length) % suffixes.length];
    const occurrence = (nameCounts.get(baseName) || 0) + 1; nameCounts.set(baseName, occurrence);
    const [low, range] = profile.population;
    const city = { id: `city-${n + 1}`, name: baseName + (occurrence > 1 ? ' ' + occurrence : ''), x: cx, y: cy,
      population: n === 0 ? 740 : n === 1 ? 615 : low + Math.floor(random() * range), activity: 0, growth: 0,
      passengers: n < 2 ? 90 : 35 + Math.floor(random() * 95), delivered: 0, supplies: 0, lastServiceDay: null };
    game.cities.push(city);

    // The main street follows the direction with more open ground (east-west
    // for the opening towns); cross streets and back lanes make the blocks.
    let horizontal = true;
    if (!town.starter) {
      const reach = (dx, dy) => { let open = 0; for (let k = -R; k <= R; k++) if (buildable(tile(cx + dx * k, cy + dy * k))) open++; return open; };
      const across = reach(0, 1), along = reach(1, 0);
      horizontal = along === across ? random() < .5 : along > across;
    }
    const point = (a, b) => horizontal ? [cx + a, cy + b] : [cx + b, cy + a];
    const lay = (a, b, da, db) => { const [x, y] = point(a, b), [dx, dy] = horizontal ? [da, db] : [db, da]; return extend(x, y, dx, dy); };
    if (!lay(0, 0, 1, 0) && !town.starter) { horizontal = !horizontal; lay(0, 0, 1, 0); }
    const reachOf = [0, 0];
    for (const [k, dir] of [[0, -1], [1, 1]]) {
      const length = R + (town.starter ? 0 : Math.floor(random() * 2));
      for (let a = 1; a <= length; a++) { if (!lay(a * dir, 0, dir, 0)) break; reachOf[k] = a; }
    }
    // A centre too steep for a street moves onto the main street beside it, where a first stop can stand.
    if (!tile(cx, cy).road) { const beside = [point(1, 0), point(-1, 0)].find(([x, y]) => tile(x, y).road); if (beside) [city.x, city.y] = beside; }
    const crosses = [], spacing = R >= 7 ? 2 : 3;
    if (R > 3 || random() < .7) for (const [k, dir] of [[0, -1], [1, 1]]) {
      for (let a = 1 + Math.floor(random() * 2); a <= reachOf[k]; a += 3 + Math.floor(random() * spacing)) {
        const along = a * dir, lengthHere = Math.max(1, Math.round((R - a * .5) * (.7 + random() * .45)));
        for (const side of [-1, 1]) {
          if (random() < .18) continue;
          let reached = 0;
          for (let b = 1; b <= lengthHere; b++) { if (!lay(along, b * side, 0, side)) break; reached = b; }
          if (reached) crosses.push({ a: along, side, reached });
        }
      }
    }
    // Back lanes three or four tiles out join neighbouring cross streets; a
    // city has a second ring further out.
    for (const side of [-1, 1]) for (let ring = 0, b = 0; ring < (R >= 9 ? 2 : R >= 5 ? 1 : 0); ring++) {
      b += 3 + Math.floor(random() * 2);
      const ends = crosses.filter(c => c.side === side && c.reached >= b).map(c => c.a).sort((p, q) => p - q);
      for (let i = 0; i + 1 < ends.length; i++) {
        if (random() < .2) continue;
        for (let a = ends[i] + 1; a < ends[i + 1]; a++) if (!lay(a, b * side, 1, 0)) break;
      }
    }

    // Lots: flat, free ground beside a street inside the town's oval.
    const inTown = (x, y) => { const a = horizontal ? x - cx : y - cy, b = horizontal ? y - cy : x - cx; return (a / (R + 1.5)) ** 2 + (b / (R * .8 + 1.5)) ** 2 <= 1; };
    const free = (x, y) => { const t = tile(x, y); return buildable(t) && !t.road && !t.building && !placed.has(y * width + x) && !centres.has(y * width + x) && flat(x, y) && inTown(x, y) && Math.max(Math.abs(x - city.x), Math.abs(y - city.y)) <= REACH; };
    const frontage = (x, y) => SIDES.some(([dx, dy]) => tile(x + dx, y + dy)?.road);
    const distanceOf = (x, y) => Math.hypot(horizontal ? x - cx : y - cy, (horizontal ? y - cy : x - cx) * 1.25);
    const build = (kind, x, y, extent) => {
      const result = placeBuildingSite(game, kind, x, y, { size: extent });
      if (!result) return false;
      for (let dy = 0; dy < extent; dy++) for (let dx = 0; dx < extent; dx++) placed.add((y + dy) * width + x + dx);
      return true;
    };
    // Put a building of the given extent as close as possible to a distance
    // from the centre, on free flat ground with a street along one side.
    const settleAt = (kind, target) => {
      const extent = buildingFootprint(kind);
      let best = null, bestScore = Infinity;
      for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) {
        let ok = true, road = false;
        for (let dy = 0; dy < extent && ok; dy++) for (let dx = 0; dx < extent; dx++) { if (!free(x + dx, y + dy)) { ok = false; break; } if (frontage(x + dx, y + dy)) road = true; }
        if (!ok || !road) continue;
        const score = Math.abs(distanceOf(x + (extent - 1) / 2, y + (extent - 1) / 2) - target) + hashNoise(x, y, seed + n) * .8;
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
      return best && build(kind, best.x, best.y, extent);
    };
    const civic = n === 0 ? SHOWCASE : Object.entries(profile.civic).filter(([, chance]) => random() < chance).map(([kind]) => kind);
    for (const kind of civic) settleAt(kind, PLACE[kind] * R);
    const [shopLow, shopRange] = profile.shops, shopCount = n === 0 ? SHOP_KINDS.length : shopLow + Math.floor(random() * (shopRange - shopLow + 1));
    for (let s = 0; s < shopCount; s++) settleAt(SHOP_KINDS[(n + s) % SHOP_KINDS.length], 1 + s * .6);
    // Homes fill the remaining lots, denser and grander towards the centre,
    // with the odd prestige house on a roomy plot further out.
    const lots = [];
    for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) if (free(x, y) && frontage(x, y)) lots.push({ x, y, d: distanceOf(x, y) + hashNoise(x, y, seed + 4229) * .6 });
    lots.sort((a, b) => a.d - b.d);
    for (const lot of lots) {
      if (!free(lot.x, lot.y)) continue;
      const edge = clamp(lot.d / (R + 1), 0, 1), roll = hashNoise(lot.x, lot.y, seed + 4231);
      if (n > 0 && roll > profile.fill * (1 - edge * edge * .45)) continue;
      const variant = Math.floor(hashNoise(lot.x, lot.y, seed + 4233) * 3), tier = random();
      if (R >= 5 && edge > .45 && tier < .1 && build(residentialKind(variant, 3), lot.x, lot.y, 2)) continue;
      const comfortable = edge < .4 ? .6 : edge < .75 ? .38 : .2;
      build(residentialKind(variant, tier < comfortable ? 2 : 1), lot.x, lot.y, 1);
    }
    // Generations of farming opened the woods around a town: fields and
    // meadows out to a ragged edge, with old trees left in its gardens.
    const clearing = R + 4 + R * .5, span = Math.ceil(clearing) + 3;
    for (let y = cy - span; y <= cy + span; y++) for (let x = cx - span; x <= cx + span; x++) {
      const t = tile(x, y);
      if (t?.terrain !== 'forest') continue;
      const edge = Math.hypot(x - cx, y - cy) / clearing + (noise(x, y, seed + 4239, 4) - .5) * .5;
      if (edge > 1 || (inTown(x, y) ? hashNoise(x, y, seed + 4237) < .15 : edge > .8 && hashNoise(x, y, seed + 4237) < .3)) continue;
      t.terrain = land;
      const roll = hashNoise(x, y, seed + 4243);
      t.detail = biome === 'desert' ? (roll < .4 ? 'dry-grass' : roll < .55 ? 'desert-flowers' : '') : biome === 'tundra' ? (roll < .3 ? 'tundra-grass' : roll < .45 ? 'shrubs' : '') : (roll < .3 ? 'wildflowers' : roll < .5 ? 'grass-tufts' : roll < .6 ? 'shrubs' : '');
    }
  }

  // Every building design appears somewhere: the largest towns host the rest.
  const present = new Set(tiles.flatMap(t => t.building ? [t.building.kind] : []));
  const hosts = game.cities.map((city, index) => ({ city, town: towns[index] })).sort((a, b) => PROFILES[b.town.profile].radius - PROFILES[a.town.profile].radius || b.city.population - a.city.population);
  for (const kind of Object.keys(BUILDINGS)) {
    if (present.has(kind)) continue;
    const extent = buildingFootprint(kind);
    host: for (const { city, town } of hosts) {
      const R = PROFILES[town.profile].radius + 2;
      for (let r = 1; r <= R; r++) for (let y = city.y - r; y <= city.y + r; y++) for (let x = city.x - r; x <= city.x + r; x++) {
        if (Math.max(Math.abs(x - city.x), Math.abs(y - city.y)) !== r || Math.max(x + extent - 1 - city.x, y + extent - 1 - city.y, city.x - x, city.y - y) > REACH) continue;
        let ok = true, road = false;
        for (let dy = 0; dy < extent && ok; dy++) for (let dx = 0; dx < extent; dx++) {
          const t = tile(x + dx, y + dy);
          if (!buildable(t) || t.road || t.building || placed.has((y + dy) * width + x + dx) || centres.has((y + dy) * width + x + dx) || !flat(x + dx, y + dy)) { ok = false; break; }
          if (SIDES.some(([sx, sy]) => tile(x + dx + sx, y + dy + sy)?.road)) road = true;
        }
        if (!ok || !road || !placeBuildingSite(game, kind, x, y, { size: extent })) continue;
        for (let dy = 0; dy < extent; dy++) for (let dx = 0; dx < extent; dx++) placed.add((y + dy) * width + x + dx);
        present.add(kind);
        break host;
      }
    }
  }
  return vertices;
}

// Industry districts: a full set of the climate's chains around one town.
// Extraction follows its resource, factories stay just outside the towns, and
// related sites keep the shared spacing, so each link in a chain needs a route.
function placeIndustries(game, biome, seed, random, config, vertices) {
  const { width, height, tiles } = game;
  // Tiles no industry may take: streets, buildings, town centres and earlier sites.
  const taken = new Uint8Array(width * height);
  for (let i = 0; i < tiles.length; i++) if (tiles[i].road || tiles[i].rail || tiles[i].bridge || tiles[i].tunnel || tiles[i].zone) taken[i] = 1;
  for (let i = 0; i < tiles.length; i++) { const b = tiles[i].building; if (b) for (let dy = 0; dy < (b.footprint || 1); dy++) for (let dx = 0; dx < (b.footprint || 1); dx++) taken[i + dy * width + dx] = 1; }
  for (const city of game.cities) taken[city.y * width + city.x] = 1;
  const open = (x, y, size) => { for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (taken[(y + dy) * width + x + dx]) return false; return true; };
  const tile = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.00001, random()))) * Math.cos(random() * Math.PI * 2);
  const kinds = Object.keys(INDUSTRIES).filter(kind => INDUSTRIES[kind].biomes.includes(biome));
  // Bucket towns by area, so the distance-to-town check stays local.
  const bucket = 32, columns = Math.ceil(width / bucket), townGrid = new Map();
  for (const city of game.cities) { const key = Math.floor(city.y / bucket) * columns + Math.floor(city.x / bucket); townGrid.set(key, [...(townGrid.get(key) || []), city]); }
  const nearTown = (x, y, gap) => {
    for (let by = Math.floor((y - gap) / bucket); by <= Math.floor((y + gap) / bucket); by++) for (let bx = Math.floor((x - gap) / bucket); bx <= Math.floor((x + gap) / bucket); bx++) {
      for (const city of townGrid.get(by * columns + bx) || []) if (Math.abs(city.x - x) <= gap && Math.abs(city.y - y) <= gap) return true;
    }
    return false;
  };
  const resource = kind => kind === 'logging-camp' ? 'forest' : kind.includes('mine') || kind === 'quarry' ? 'rock' : kind === 'sand-pit' ? 'sand' : kind === 'farm' ? 'grass' : null;
  const habitat = (kind, x, y, extent) => {
    let forest = 0, rocky = 0, water = 0, open = 0, sand = 0;
    for (let dy = -4; dy <= 4 + extent; dy += 2) for (let dx = -4; dx <= 4 + extent; dx += 2) {
      const terrain = tile(x + dx, y + dy)?.terrain;
      if (terrain === 'forest') forest++;
      else if (terrain === 'mountain' || terrain === 'rock') rocky++;
      else if (terrain === 'water') water++;
      else if (terrain) { open++; if (terrain === 'sand') sand++; }
    }
    const anchor = tile(x, y).terrain;
    if (kind === 'logging-camp') return forest * 7 + (anchor === 'forest' ? 45 : -40) - water * 2;
    if (kind.includes('mine') || kind === 'quarry') return rocky * 7 + (anchor === 'rock' || anchor === 'mountain' ? 50 : 0);
    if (kind === 'farm') return open * 4 - forest * 3 - rocky * 7 + water * (biome === 'desert' ? 9 : 2) + (anchor === 'grass' ? 30 : 0);
    if (kind === 'sand-pit') return sand * 5 - water * 3;
    if (kind === 'oil-well') return open * 2 - rocky * 2 + noise(x, y, seed + 4241, 31) * 85;
    if (INDUSTRIES[kind].coastal) return water * 6 + open;
    return open * 2 - rocky * 8 - water * 3 - forest;
  };
  // Mines need rock nearby, logging camps woodland, farms open fields, sand pits dunes.
  const deposit = (kind, x, y, extent) => {
    let found = 0;
    for (let dy = -3; dy <= extent + 2; dy++) for (let dx = -3; dx <= extent + 2; dx++) {
      const terrain = tile(x + dx, y + dy)?.terrain;
      if (kind === 'logging-camp' ? terrain === 'forest' : kind === 'farm' ? terrain === 'grass' || terrain === 'sand' : kind === 'sand-pit' ? terrain === 'sand' : terrain === 'rock' || terrain === 'mountain') found++;
    }
    return found >= (kind === 'farm' || kind === 'sand-pit' ? 20 : kind === 'logging-camp' ? 14 : 4);
  };
  // A site whose corners differ in height would stand on a stone plinth.
  const stride = width + 1;
  const rough = (x, y, extent) => {
    let low = 7, high = 0;
    for (let dy = 0; dy <= extent; dy++) for (let dx = 0; dx <= extent; dx++) { const h = vertices[(y + dy) * stride + x + dx]; low = Math.min(low, h); high = Math.max(high, h); }
    return high - low;
  };
  const anchors = [game.cities[0]];
  // Districts spread out: each takes the farthest of a few random towns.
  while (anchors.length < config.clusters) {
    let best = null, bestDistance = -1;
    for (let k = 0; k < 6; k++) {
      const city = game.cities[Math.floor(random() * game.cities.length)];
      const distance = Math.min(...anchors.map(a => Math.hypot(a.x - city.x, a.y - city.y)));
      if (distance > bestDistance) { best = city; bestDistance = distance; }
    }
    anchors.push(best);
  }
  for (const [district, anchor] of anchors.entries()) {
    const extent = district === 0 ? 24 : 20 + random() ** 2 * (30 + Math.sqrt(width) * 1.2);
    for (const kind of kinds) {
      const def = INDUSTRIES[kind], size = industryFootprint(kind), extraction = !Object.keys(def.inputs).length, wanted = resource(kind);
      let best = null, bestScore = -Infinity;
      const consider = (x, y, scale = extent, strict = true) => {
        if (x < 3 || y < 3 || x + size >= width - 3 || y + size >= height - 3 || !open(x, y, size) || nearTown(x + (size >> 1), y + (size >> 1), 11)) return;
        const distance = Math.hypot(x - anchor.x, y - anchor.y);
        const score = habitat(kind, x, y, size) + (wanted && tile(x, y).terrain === wanted ? 25 : 0) - rough(x, y, size) * 60 - distance / scale * (extraction ? 35 : 85) + hashNoise(x, y, seed + district * 251) * 22;
        // The deposit and the full site rules only need to confirm a candidate that would win.
        if (score > bestScore && !(strict && wanted && !deposit(kind, x, y, size)) && !industrySiteProblem(game, kind, x, y, size) && !industrySpacingProblem(game, kind, x, y, size)) { best = { x, y }; bestScore = score; }
      };
      for (let attempt = 0; attempt < 140; attempt++) {
        const spread = extent * (extraction ? .75 + random() * 1.7 : .35 + random() * .55);
        consider(Math.round(anchor.x + gaussian() * spread), Math.round(anchor.y + gaussian() * spread));
      }
      if (best) { const { x, y } = best; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) consider(x + dx, y + dy); }
      // Prospect further afield before settling for any open ground.
      for (let ring = 2; !best && ring <= 8; ring++) for (let attempt = 0; attempt < 120; attempt++) consider(Math.round(anchor.x + gaussian() * extent * ring), Math.round(anchor.y + gaussian() * extent * ring), extent * ring);
      for (let attempt = 0; !best && attempt < 20000; attempt++) consider(3 + Math.floor(random() * (width - 6)), 3 + Math.floor(random() * (height - 6)), width, attempt < 10000);
      if (!best) throw new Error(`Could not place ${kind} in this world.`);
      const inventory = Object.fromEntries([...Object.keys(def.inputs), ...Object.keys(def.outputs)].map(cargo => [cargo, 0]));
      if (extraction) for (const [cargo, rate] of Object.entries(def.outputs)) inventory[cargo] = rate * 12;
      game.industries.push({ id: `industry-${game.industries.length + 1}`, kind, name: def.name, x: best.x, y: best.y, footprint: size, capacity: 1, inventory, production: 0, totalProduced: 0, activity: 0, shipped: 0, received: 0, idleDays: 0, owner: 'world' });
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) taken[(best.y + dy) * width + best.x + dx] = 1;
    }
  }
}
