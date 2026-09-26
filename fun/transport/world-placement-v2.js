import { INDUSTRIES } from './data.js';
import { BUILDINGS, residentialKind, commercialKind, COMMUNITY_KINDS } from './buildings.js';
import { seedNumber, randomSource, hashNoise, noise } from './world-noise.js';

// Settlement regions represent fertile valleys and trade corridors. Their sizes,
// weights and orientations vary independently, leaving room for quiet wilderness.
// This file is part of save recipe 2: preserve it when adding later recipes.
export function populateWorldV2(game, biome, seed, config, { starterX, starterY, land }) {
  const { width, height, tiles } = game;
  const numericSeed = seedNumber(seed), random = randomSource(numericSeed ^ 0x628cf315);
  const tile = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  const habitable = t => t && t.terrain !== 'water' && t.terrain !== 'mountain';
  const plain = t => habitable(t) && t.terrain !== 'rock';
  const clampX = x => Math.max(12, Math.min(width - 13, Math.round(x)));
  const clampY = y => Math.max(12, Math.min(height - 13, Math.round(y)));
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.00001, random()))) * Math.cos(random() * Math.PI * 2);
  const profiles = [
    { type: 'hamlet', rx: 3, ry: 3, population: 170, range: 240, fill: .60 },
    { type: 'town', rx: 5, ry: 4, population: 450, range: 550, fill: .77 },
    { type: 'town', rx: 7, ry: 6, population: 950, range: 850, fill: .88 },
    { type: 'corridor', rx: 10, ry: 3, population: 430, range: 690, fill: .72 },
  ];
  const footprint = () => {
    const roll = random(), p = { ...profiles[roll < .32 ? 0 : roll < .72 ? 1 : roll < .89 ? 2 : 3] };
    p.rx += Math.floor(random() * 2); p.ry += Math.floor(random() * 2);
    p.vertical = random() < .5; p.bend = random() < .5 ? -1 : 1;
    return p;
  };
  const favorable = (x, y) => {
    if (!plain(tile(x, y))) return false;
    let flat = 0;
    for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) if (plain(tile(x + dx, y + dy))) flat++;
    return flat >= 12;
  };
  const regions = [{ x: starterX + 8, y: starterY - 13, spread: 26, aspect: 1.4, angle: -.2, weight: 1.2 }];
  const regionCount = Math.max(3, Math.round(config.towns / 9));
  for (let attempt = 0; regions.length < regionCount && attempt < regionCount * 100; attempt++) {
    const x = clampX((.045 + random() * .91) * width), y = clampY((.045 + random() * .91) * height);
    if (!favorable(x, y)) continue;
    if (regions.some(region => Math.hypot(region.x - x, region.y - y) < width * .07)) continue;
    regions.push({ x, y, spread: (18 + Math.sqrt(width) * .55) * (.6 + random() * 1.5), aspect: .55 + random() * 1.25, angle: random() * Math.PI, weight: .3 + random() ** 2 * 3.4 });
  }
  const regionWeight = regions.reduce((sum, region) => sum + region.weight, 0);
  const chooseRegion = () => {
    let value = random() * regionWeight;
    for (const region of regions) { value -= region.weight; if (value <= 0) return region; }
    return regions[regions.length - 1];
  };
  const locations = [{ x: starterX, y: starterY }, { x: starterX + 24, y: starterY }];
  for (let attempt = 0; locations.length < config.towns && attempt < config.towns * 500; attempt++) {
    const region = chooseRegion();
    const outlying = random() < .10 || attempt > config.towns * 180;
    const gx = gaussian() * region.spread, gy = gaussian() * region.spread * region.aspect;
    const x = clampX(outlying ? random() * width : region.x + Math.cos(region.angle) * gx - Math.sin(region.angle) * gy);
    const y = clampY(outlying ? random() * height : region.y + Math.sin(region.angle) * gx + Math.cos(region.angle) * gy);
    const spacing = 15 + hashNoise(x >> 3, y >> 3, numericSeed + 241) * 6;
    if (locations.some(location => Math.hypot(location.x - x, location.y - y) < spacing)) continue;
    if (!favorable(x, y)) continue;
    // Regional fertility encourages connected valleys without requiring every
    // town to sit on the same river or use the same coastline distance.
    if (!outlying && noise(x, y, numericSeed + 611, Math.max(24, width / 8)) < .22 && random() < .8) continue;
    locations.push({ x, y, profile: footprint() });
  }
  // Unusually mountainous seeds get a deterministic broad fallback, rather than
  // dropping towns or flattening mountains. The normal clustered pass fills first.
  for (let attempt = 0; locations.length < config.towns && attempt < config.towns * 1500; attempt++) {
    const x = clampX(random() * width), y = clampY(random() * height);
    if (!favorable(x, y) || locations.some(location => Math.hypot(location.x - x, location.y - y) < 14)) continue;
    locations.push({ x, y, profile: footprint() });
  }
  if (locations.length !== config.towns) throw new Error('Could not find enough habitable town sites in this world.');
  const names = biome === 'taiga' ? ['Alderbrook', 'Pinehaven', 'Cedar Falls', 'Northmere'] : biome === 'tundra' ? ['Frostholm', 'Whitehaven', 'Snowbridge', 'Northwatch'] : ['Sunspire', 'Copper Mesa', 'Oasis Springs', 'Redstone'];
  const prefixes = biome === 'taiga' ? ['Birch', 'Willow', 'Cedar', 'Elm', 'Fern', 'Oak', 'Moss', 'Ash'] : biome === 'tundra' ? ['Ice', 'Frost', 'Winter', 'Snow', 'White', 'North', 'Glacier', 'Silver'] : ['Amber', 'Copper', 'Dune', 'Palm', 'Sun', 'Golden', 'Red', 'Saffron'];
  const suffixes = ['ford', 'haven', 'field', 'mere', 'ridge', 'bridge', 'brook', 'vale'];
  const allKinds = Object.keys(BUILDINGS), nameCounts = new Map();
  const publicRoad = (x, y, starter = false) => {
    const t = tile(x, y); if (!t || (!starter && (t.building || (!habitable(t) && !(t.road && t.bridge))))) return false;
    if (t.terrain === 'water') t.bridge = true;
    else { t.terrain = land; t.detail = ''; t.elevation = .25; }
    t.road = true; t.publicRoad = true; t.building = null;
    return true;
  };
  const plantBuilding = (t, kind) => {
    t.terrain = land; t.detail = ''; t.elevation = .25;
    t.building = { kind, level: 1 };
  };
  for (let i = 0; i < locations.length; i++) {
    const { x: cx, y: cy, profile } = locations[i];
    const baseName = names[i] || prefixes[(i - 4) % prefixes.length] + suffixes[Math.floor((i - 4) / prefixes.length) % suffixes.length];
    const occurrence = (nameCounts.get(baseName) || 0) + 1; nameCounts.set(baseName, occurrence);
    const city = { id: `city-${i + 1}`, name: baseName + (occurrence > 1 ? ' ' + occurrence : ''), x: cx, y: cy, population: i < 2 ? 740 - i * 125 : profile.population + Math.floor(random() * profile.range), activity: 0, growth: 0, passengers: i < 2 ? 90 : 35 + Math.floor(random() * 95), delivered: 0, supplies: 0, lastServiceDay: null };
    game.cities.push(city);
    if (i < 2) {
      const plots = [];
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const t = tile(cx + dx, cy + dy);
        if (t.terrain === 'water') { if (dx % 4 === 0 || dy % 4 === 0) publicRoad(cx + dx, cy + dy, true); continue; }
        t.terrain = land; t.detail = ''; t.elevation = .25;
        if (dx % 4 === 0 || dy % 4 === 0) publicRoad(cx + dx, cy + dy, true);
        else if (Math.abs(dx) === 2 && Math.abs(dy) === 2) t.detail = biome === 'taiga' ? 'wildflowers' : biome === 'tundra' ? 'shrubs' : 'scrub';
        else plots.push({ t, dx, dy, order: random() });
      }
      plots.sort((a, b) => a.order - b.order);
      for (let p = 0; p < plots.length; p++) {
        const { t, dx, dy } = plots[p]; if (p > 25 && random() > .48) continue;
        const kind = i === 0 && p < allKinds.length ? allKinds[p] : p < 3 ? COMMUNITY_KINDS[(i + p * 2) % COMMUNITY_KINDS.length] : Math.abs(dx) + Math.abs(dy) < 5 && random() < .66 ? commercialKind(i + p, p % 3 === 0 ? 2 : 1) : residentialKind(i + p, 1 + (Math.floor(i / 3) + Math.floor(p / 8)) % 3);
        plantBuilding(t, kind);
      }
      continue;
    }
    const { rx, ry, vertical, bend, fill } = profile;
    const point = (a, b) => vertical ? [cx + b, cy + a] : [cx + a, cy + b];
    const streets = new Set();
    const street = (a, b, da = 0, db = 0) => {
      const [x, y] = point(a, b);
      if (tile(x, y)?.terrain === 'water' && !tile(x, y).road) {
        if (!da && !db) return false;
        // A street may cross a narrow stream only when a dry, unbuilt opposite
        // bank is in reach. Wide water and mountain slopes end the street.
        let bank = 0;
        for (let distance = 1; distance <= 4; distance++) {
          const [tx, ty] = point(a + da * distance, b + db * distance), t = tile(tx, ty);
          if (!t || t.building || t.terrain === 'mountain') break;
          if (t.terrain !== 'water') { bank = distance; break; }
        }
        if (!bank) return false;
        for (let distance = 0; distance <= bank; distance++) {
          const [tx, ty] = point(a + da * distance, b + db * distance), t = tile(tx, ty);
          if (t.terrain === 'water') { t.road = true; t.bridge = true; t.publicRoad = true; }
          else publicRoad(tx, ty);
          streets.add(ty * width + tx);
        }
        return true;
      }
      if (!publicRoad(x, y)) return false;
      streets.add(y * width + x); return true;
    };
    street(0, 0);
    // A winding main street and unequal spurs make hamlets, compact town cores,
    // and long valley settlements without stamping the same square street grid.
    for (const direction of [-1, 1]) {
      let previousB = 0;
      for (let step = 1; step <= rx; step++) {
        const a = step * direction, b = Math.trunc(step / 5) * bend * direction;
        if (b !== previousB && !street(a - direction, b, 0, b - previousB)) break;
        if (!street(a, b, direction, 0)) break;
        previousB = b;
        if (step === 2 || (step > 2 && (step + i) % 3 === 0)) for (const side of [-1, 1]) {
          const length = Math.max(1, ry - Math.floor(random() * 3) - (step > rx * .7 ? 1 : 0));
          for (let distance = 1; distance <= length; distance++) if (!street(a, b + distance * side, 0, side)) break;
        }
      }
    }
    const plots = [];
    for (const index of streets) {
      const x = index % width, y = Math.floor(index / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tx = x + dx, ty = y + dy, t = tile(tx, ty);
        if (!plain(t) || t.road || t.building) continue;
        const px = tx - cx, py = ty - cy;
        const edge = (vertical ? Math.abs(py) / (rx + 2) : Math.abs(px) / (rx + 2));
        const density = fill * (1 - edge * .36);
        if (hashNoise(tx, ty, numericSeed + i * 31) > density) continue;
        const p = plots.length;
        const kind = p === 0 && profile.type !== 'hamlet' ? COMMUNITY_KINDS[i % COMMUNITY_KINDS.length] : Math.abs(px) + Math.abs(py) < 5 && random() < .37 ? commercialKind(i + p, 1 + (i % 3 === 0 ? 1 : 0)) : residentialKind(i + p, profile.type === 'hamlet' ? 1 : 1 + Math.floor(random() * 3));
        plantBuilding(t, kind); plots.push(t);
      }
    }
  }
  for (let x = starterX; x <= starterX + 24; x++) publicRoad(x, starterY, true);

  const kinds = Object.keys(INDUSTRIES).filter(kind => INDUSTRIES[kind].biomes.includes(biome));
  const placed = new Set();
  const coastal = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tile(x + dx, y + dy)?.terrain === 'water');
  const occupied = (x, y) => {
    const t = tile(x, y);
    return !t || x < 2 || y < 2 || x >= width - 2 || y >= height - 2 || t.terrain === 'water' || t.road || t.building || placed.has(y * width + x) || game.cities.some(city => Math.abs(city.x - x) < 6 && Math.abs(city.y - y) < 6);
  };
  const naturalShore = [];
  if (kinds.some(kind => INDUSTRIES[kind].coastal)) {
    // A single bounded-spacing shoreline catalogue lets coastal sites follow
    // actual rivers, lakes and seas; no artificial one-tile fish ponds are made.
    for (let y = 2; y < height - 2; y += 2) for (let x = 2; x < width - 2; x += 2) {
      if (habitable(tile(x, y)) && coastal(x, y)) naturalShore.push(y * width + x);
    }
  }
  const resourcePools = new Map();
  const resourceTerrain = kind => kind === 'logging-camp' ? 'forest' : kind.includes('mine') || kind === 'quarry' ? 'rock' : kind === 'sand-pit' ? 'sand' : kind === 'farm' ? 'grass' : null;
  const matchesResource = (terrain, resource) => !resource || terrain === resource || (resource === 'rock' && terrain === 'mountain');
  const resourceCandidates = resource => {
    if (!resourcePools.has(resource)) {
      const points = [];
      for (let y = 3; y < height - 3; y += 5) for (let x = 3; x < width - 3; x += 5) {
        const tx = x + Math.floor(hashNoise(x, y, numericSeed + 1963) * 3), ty = y + Math.floor(hashNoise(x, y, numericSeed + 1973) * 3);
        if (matchesResource(tile(tx, ty)?.terrain, resource)) points.push(ty * width + tx);
      }
      resourcePools.set(resource, points);
    }
    return resourcePools.get(resource);
  };
  const habitatScore = (kind, x, y) => {
    let forest = 0, rocky = 0, water = 0, open = 0, sand = 0;
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const terrain = tile(x + dx, y + dy)?.terrain;
      if (terrain === 'forest') forest++;
      else if (terrain === 'mountain' || terrain === 'rock') rocky++;
      else if (terrain === 'water') water++;
      else if (terrain) { open++; if (terrain === 'sand') sand++; }
    }
    const terrain = tile(x, y).terrain;
    if (kind === 'logging-camp') return forest * 7 + (terrain === 'forest' ? 45 : -70) - water * 2;
    if (kind.includes('mine') || kind === 'quarry') return rocky * 6 + (terrain === 'rock' || terrain === 'mountain' ? 60 : -70);
    if (kind === 'farm') return open * 4 - forest * 3 - rocky * 7 + (biome === 'desert' ? water * 7 + (terrain === 'grass' ? 60 : 0) : water * 2);
    if (kind === 'sand-pit') return sand * 5 + (terrain === 'sand' ? 40 : -80) - water * 3;
    if (kind === 'oil-well') return open * 2 - rocky * 2 + noise(x, y, numericSeed + 1711, 31) * 85;
    return open * 2 - rocky * 8 - water * 3 - forest;
  };
  for (let district = 0; district < config.clusters; district++) {
    const anchor = game.cities[district === 0 ? 0 : Math.floor(random() * game.cities.length)];
    const extent = district === 0 ? 25 : 20 + random() ** 2 * (30 + Math.sqrt(width) * 1.2);
    for (const kind of kinds) {
      const def = INDUSTRIES[kind], extraction = Object.keys(def.inputs).length === 0;
      let best = null, bestScore = -Infinity;
      const consider = (x, y, distanceScale = extent) => {
        if (occupied(x, y)) return;
        if (!matchesResource(tile(x, y).terrain, resourceTerrain(kind))) return;
        if (def.coastal && !coastal(x, y)) return;
        // Independent irregular resource deposits outrank a geometrically neat
        // radius around the town, while distance still keeps chains practical.
        const distance = Math.hypot(x - anchor.x, y - anchor.y);
        const score = habitatScore(kind, x, y) - distance / distanceScale * (extraction ? 35 : 85) + hashNoise(x, y, numericSeed + district * 251) * 22;
        if (score > bestScore) { best = { x, y }; bestScore = score; }
      };
      if (def.coastal) {
        // Spatial proximity plus a seeded tie-break chooses a natural shore;
        // even an inland district can reach the nearest real fishing waters.
        for (const index of naturalShore) {
          const x = index % width, y = Math.floor(index / width);
          const distance = Math.hypot(x - anchor.x, y - anchor.y);
          if (best && distance > best.distance + 18) continue;
          if (occupied(x, y)) continue;
          const score = -distance + hashNoise(x, y, numericSeed + district * 251) * 12;
          if (score > bestScore) { bestScore = score; best = { x, y, distance }; }
        }
      } else {
        for (let attempt = 0; attempt < 120; attempt++) {
          const spread = extent * (extraction ? .75 + random() * 1.7 : .35 + random() * .55);
          consider(clampX(anchor.x + gaussian() * spread), clampY(anchor.y + gaussian() * spread));
        }
        // Search the best deposit's immediate neighbourhood, so resource sites
        // hug actual rock outcrops/forest patches rather than a random nearby tile.
        if (best) {
          const { x, y } = best;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) consider(x + dx, y + dy);
        }
      }
      if (!best && resourceTerrain(kind)) {
        // A district in an open plain may have no local ore, or a desert town
        // may have no farmland. Prospect the nearest real regional habitat;
        // never manufacture a lonely rock/tree tile to satisfy the catalogue.
        let nearest = null, nearestDistance = Infinity;
        for (const index of resourceCandidates(resourceTerrain(kind))) {
          const x = index % width, y = Math.floor(index / width), distance = Math.hypot(x - anchor.x, y - anchor.y);
          if (distance < nearestDistance && !occupied(x, y)) { nearest = { x, y }; nearestDistance = distance; }
        }
        if (nearest) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) consider(nearest.x + dx, nearest.y + dy, Math.max(extent, nearestDistance));
      }
      if (!best) for (let attempt = 0; attempt < 2500 && !best; attempt++) consider(clampX(random() * width), clampY(random() * height), width);
      if (!best) throw new Error(`Could not place ${kind} in this world.`);
      const { x, y } = best, t = tile(x, y); placed.add(y * width + x);
      if (kind === 'logging-camp') { t.terrain = 'forest'; if (!t.detail || !['pine', 'spruce', 'fir', 'oak', 'birch', 'aspen'].includes(t.detail)) t.detail = 'pine'; }
      else if (kind.includes('mine') || kind === 'quarry') { t.terrain = 'rock'; t.detail = biome === 'desert' ? 'canyon' : 'glacial'; }
      else if (kind === 'sand-pit') { t.terrain = 'sand'; t.detail = 'dunes'; }
      else { t.terrain = kind === 'farm' ? 'grass' : land; t.detail = ''; }
      t.elevation = .25;
      const inventory = Object.fromEntries([...Object.keys(def.inputs), ...Object.keys(def.outputs)].map(cargo => [cargo, 0]));
      if (extraction) for (const [cargo, rate] of Object.entries(def.outputs)) inventory[cargo] = rate * 12;
      game.industries.push({ id: `industry-${game.industries.length + 1}`, kind, name: def.name, x, y, capacity: 1, inventory, production: 0, totalProduced: 0, activity: 0, shipped: 0, received: 0, idleDays: 0, owner: 'world' });
    }
  }
  return game;
}
