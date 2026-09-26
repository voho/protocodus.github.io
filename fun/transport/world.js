import { INDUSTRIES } from './data.js';
import { BUILDINGS, residentialKind, commercialKind, COMMUNITY_KINDS } from './buildings.js';
import { BIOME_NATURE } from './terrain-sprites.js';

export function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function randomSource(seed) {
  let state = seedNumber(seed);
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ (n >>> 15), n | 1); n ^= n + Math.imul(n ^ (n >>> 7), n | 61); return ((n ^ (n >>> 14)) >>> 0) / 4294967296; };
}
export function hashNoise(x, y, seed) {
  let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, seed, scale) {
  const a = Math.floor(x / scale), b = Math.floor(y / scale);
  const fx = x / scale - a, fy = y / scale - b;
  const tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
  const top = hashNoise(a, b, seed) * (1 - tx) + hashNoise(a + 1, b, seed) * tx;
  const bottom = hashNoise(a, b + 1, seed) * (1 - tx) + hashNoise(a + 1, b + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}
export const WORLD_SIZES = {
  regional: { width: 128, height: 96, label: 'Regional', description: '128 × 96 · 8 towns · a compact county' },
  large: { width: 256, height: 192, label: 'Large', description: '256 × 192 · 16 towns · room to expand' },
  huge: { width: 512, height: 384, label: 'Huge', description: '512 × 384 · 32 towns · an entire region' },
};

// Terrain stays in seven gameplay categories; details supply local visual character.
export function generateWorld(biome, seed, size = 'huge') {
  if (!Object.prototype.hasOwnProperty.call(WORLD_SIZES, size)) size = 'huge';
  const { width, height } = WORLD_SIZES[size], numericSeed = seedNumber(seed), random = randomSource(seed);
  const phase = random() * Math.PI * 2, scale = width / 100;
  const land = biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';
  const nature = BIOME_NATURE[biome];
  const starterX = Math.round(width * .43), starterY = Math.round(height * .47);
  const westRiver = y => width * .20 + Math.sin(y / (9 * scale) + phase) * 4 * scale + Math.sin(y / (3 * scale)) * scale;
  const eastRiver = y => width * .72 + Math.sin(y / (12 * scale) + phase) * 5 * scale;
  const lakes = Array.from({ length: size === 'huge' ? 13 : size === 'large' ? 7 : 4 }, () => ({
    x: (.12 + random() * .66) * width, y: (.1 + random() * .77) * height,
    rx: 3.5 + random() * 4.5 * Math.sqrt(scale), ry: 2.5 + random() * 3.5 * Math.sqrt(scale),
  }));
  // A small lake beside the first two towns makes the opening view easy to read.
  lakes.push({x:Math.round(width*.43)+15,y:Math.round(height*.47)-10,rx:6,ry:4.5});
  const tiles = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const n = noise(x, y, numericSeed, 8 * Math.sqrt(scale));
    const fine = noise(x, y, numericSeed + 9, 3.5), vegetation = noise(x, y, numericSeed + 53, 5.5);
    const habitat = hashNoise(Math.floor(x / 3), Math.floor(y / 3), numericSeed + 71);
    const choose = choices => choices[Math.min(choices.length - 1, Math.floor(habitat * choices.length))];
    const continent = noise(x, y, numericSeed + 101, 22 * scale);
    const coast = width * .875 + Math.sin(y / (8 * scale) + phase) * 5 * scale + (continent - .5) * 14 * scale;
    const south = height * .96 + Math.sin(x / (16 * scale) + phase) * 3 * scale;
    const riverWidth = 1 + Math.sqrt(scale) * .65;
    const nearRiver = Math.min(Math.abs(x - westRiver(y)), Math.abs(x - eastRiver(y)));
    let water = x > coast || y > south || x < 2 + Math.sin(y / (8 * scale)) * scale;
    if (!water) for (const lake of lakes) {
      if (((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / lake.ry) ** 2 < .78 + fine * .45) { water = true; break; }
    }
    // Reserve the two opening town sites before carving rivers. Random lakes
    // must not submerge their centers, but later streets never fill a river.
    if (Math.abs(y - starterY) <= 4 && [starterX, starterX + 24].some(cx => Math.abs(x - cx) <= 4)) water = false;
    const ridgeY = height * .20 + Math.sin(x / (12 * scale) + phase) * 5 * scale;
    const ridge = Math.exp(-(((y - ridgeY) / (3.5 * scale)) ** 2)) * .60;
    const ridgeX = width * .61 + Math.sin(y / (11 * scale) + phase) * 4 * scale;
    const ridgeTwo = Math.exp(-(((x - ridgeX) / (2.5 * scale)) ** 2)) * .46 * Math.max(0, Math.sin(y / height * Math.PI));
    let elevation = Math.round((n * .52 + ridge + ridgeTwo) * 1024) / 1024;
    let terrain = land, detail = '';
    if (water) { terrain = 'water'; elevation = 0; }
    else if (elevation > .64) { terrain = 'mountain'; detail = nature.mountains[Math.min(nature.mountains.length - 1, Math.floor(hashNoise(Math.floor(x / 6), Math.floor(y / 6), numericSeed + 81) * nature.mountains.length))]; }
    else if (elevation > .53 || fine > .86) { terrain = 'rock'; detail = biome === 'desert' ? 'canyon' : 'glacial'; }
    else if (biome === 'taiga') {
      if (n + vegetation * .27 > .53) { terrain = 'forest'; detail = habitat > .97 ? 'deadwood' : vegetation > .67 ? choose(['birch','aspen']) : vegetation < .35 ? 'oak' : choose(['pine','spruce','fir']); }
      else detail = nearRiver < riverWidth + 2.8 ? (fine > .5 ? 'reeds' : 'marsh') : vegetation > .5 ? choose(['wildflowers','bluebells','ferns','berry-bushes','']) : choose(['grass-tufts','heather','shrubs','','']);
    } else if (biome === 'tundra') {
      if (n > .49 && vegetation > .40) { terrain = 'forest'; detail = habitat > .95 ? 'deadwood' : choose(['pine','larch','dwarf-birch','dwarf-pine']); }
      else if (n < .35) { terrain = 'grass'; detail = vegetation > .45 ? choose(['arctic-poppies','cotton-grass','heather','willow-scrub','tundra-grass']) : choose(['lichen','shrubs','marsh','']); }
      else detail = nearRiver < riverWidth + 1.7 ? 'ice' : fine > .58 ? choose(['glacial','lichen','heather']) : 'snow';
    } else {
      if (nearRiver < riverWidth + 3.4) { terrain = vegetation > .51 ? 'forest' : 'grass'; detail = terrain === 'forest' ? (habitat > .97 ? 'deadwood' : choose(['palm','acacia','joshua','tamarisk'])) : choose(['reeds','desert-flowers','dry-grass']); }
      else detail = vegetation > .60 ? choose(['cactus','agave','prickly-pear','aloe','desert-flowers']) : fine < .23 ? 'saltflat' : vegetation < .36 ? choose(['scrub','dry-grass','']) : 'dunes';
    }
    tiles.push({ terrain, elevation, detail, variant: Math.floor(random() * 16), road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
  }
  const game = { width, height, size, tiles, cities: [], industries: [], zones: [], stations: [], routes: [], vehicles: [] };
  const tile = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  const riverTiles = new Set();
  function carveRiver(points, radius) {
    // Overlapping circular samples leave a continuous channel even around a
    // steep bend. The narrowest tributaries still have a three-tile channel.
    const paint = (cx, cy) => {
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const t = tile(x, y); if (!t) continue;
        t.terrain = 'water'; t.elevation = 0; t.detail = 'river'; riverTiles.add(y * width + x);
      }
    };
    for (let p = 1; p < points.length; p++) {
      const [ax, ay] = points[p - 1], [bx, by] = points[p];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let step = 0; step <= steps; step++) paint(ax + (bx - ax) * step / steps, ay + (by - ay) * step / steps);
    }
  }
  const mainWidth = 1.65 + Math.sqrt(scale) * .3;
  // Two meandering trunks meet the southern sea. An east-west river joins
  // them and opens into the eastern sea, rather than ending in isolated lakes.
  for (const river of [westRiver, eastRiver]) carveRiver(Array.from({ length: height }, (_, y) => [river(y), y]), mainWidth);
  const townRiver = x => {
    if (x < starterX - 6) return starterY + 6 + Math.sin((x - starterX + 6) / (12 * Math.sqrt(scale))) * 4 * Math.sqrt(scale);
    if (x > starterX + 30) return starterY + 6 + Math.sin((x - starterX - 30) / (12 * Math.sqrt(scale))) * 4 * Math.sqrt(scale);
    return starterY + 6 + (x > starterX && x < starterX + 24 ? Math.sin((x - starterX) / 24 * Math.PI) ** 2 * 1.4 : 0);
  };
  // Starting at the western edge guarantees a confluence with the western
  // trunk regardless of its bends. Both ends join the world's existing seas.
  carveRiver(Array.from({ length: width }, (_, x) => [x, townRiver(x)]), 1.65);
  for (const [sourceX, sourceY, mouthX] of [[width * .40, height * .07, width * .34], [width * .52, height * .83, width * .56], [width * .10, height * .77, width * .20]]) {
    const mouthY = townRiver(mouthX), points = [];
    for (let step = 0; step <= 48; step++) {
      const t = step / 48, bend = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 3 + phase) * 2.7 * Math.sqrt(scale);
      points.push([sourceX + (mouthX - sourceX) * t + bend, sourceY + (mouthY - sourceY) * t]);
    }
    carveRiver(points, 1.65);
  }
  // A thin riparian strip gives each climate readable riverbanks. It reuses
  // existing terrain/details and does not add any persistent tile properties.
  for (const index of riverTiles) {
    const x = index % width, y = Math.floor(index / width);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const t = tile(x + dx, y + dy);
      if (!t || t.terrain === 'water' || t.terrain === 'mountain' || t.terrain === 'rock' || t.terrain === 'forest') continue;
      if (biome === 'desert') { t.terrain = 'grass'; t.detail = t.variant % 5 === 0 ? 'desert-flowers' : 'reeds'; }
      else t.detail = biome === 'tundra' ? (t.variant % 5 === 0 ? 'reeds' : t.variant % 3 ? 'cotton-grass' : 'willow-scrub') : (t.variant % 3 ? 'reeds' : 'ferns');
    }
  }
  // Port berths sit on water within the five-tile town catchment, immediately
  // beyond the southern street. Keep the bank itself dry and unbuilt.
  for (const cx of [starterX, starterX + 24]) {
    const bank = tile(cx, starterY + 4);
    bank.terrain = land; bank.elevation = .25; bank.detail = '';
  }
  const names = biome === 'taiga' ? ['Alderbrook', 'Pinehaven', 'Cedar Falls', 'Northmere'] : biome === 'tundra' ? ['Frostholm', 'Whitehaven', 'Snowbridge', 'Northwatch'] : ['Sunspire', 'Copper Mesa', 'Oasis Springs', 'Redstone'];
  const prefixes = biome === 'taiga' ? ['Birch','Willow','Cedar','Elm','Fern','Oak','Moss','Ash'] : biome === 'tundra' ? ['Ice','Frost','Winter','Snow','White','North','Glacier','Silver'] : ['Amber','Copper','Dune','Palm','Sun','Golden','Red','Saffron'];
  const suffixes = ['ford','haven','field','mere','ridge','bridge','brook','vale'];
  const locations = [[starterX, starterY], [starterX + 24, starterY]];
  const cityCount = size === 'huge' ? 32 : size === 'large' ? 16 : 8;
  // Stratified candidates spread towns across the landmass; a local search follows habitable valleys.
  const columns = size === 'huge' ? 6 : size === 'large' ? 4 : 3;
  const rows = Math.ceil(cityCount / columns);
  const separation = size === 'huge' ? 24 : size === 'large' ? 19 : 14;
  for (let attempt = 0; locations.length < cityCount && attempt < cityCount * 200; attempt++) {
    const cell = attempt % (columns * rows);
    const x = Math.round((.08 + ((cell % columns) + .25 + random() * .5) / columns * .73) * width);
    const y = Math.round((.07 + (Math.floor(cell / columns) + .20 + random() * .6) / rows * .79) * height);
    if (locations.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < separation)) continue;
    if (!tile(x,y) || ['water','mountain'].includes(tile(x,y).terrain)) continue;
    let habitable = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (tile(x + dx,y + dy) && !['water','mountain'].includes(tile(x + dx,y + dy).terrain)) habitable++;
    if (habitable < 66) continue;
    locations.push([x, y]);
  }
  const allKinds = Object.keys(BUILDINGS);
  const publicRoad = (x, y) => {
    const t = tile(x,y); if (!t) return;
    if (t.terrain === 'water') t.bridge = true;
    else { t.terrain = land; t.detail = ''; t.elevation = .25; }
    t.road = true; t.publicRoad = true; t.building = null;
  };
  for (let i = 0; i < locations.length; i++) {
    const [cx, cy] = locations[i];
    const name = names[i] || prefixes[(i - 4) % prefixes.length] + suffixes[Math.floor((i - 4) / prefixes.length) % suffixes.length];
    const city = { id: `city-${i + 1}`, name, x: cx, y: cy, population: i < 2 ? 740 - i * 125 : 340 + Math.floor(random() * 860), activity: 0, growth: 0, passengers: 90, delivered: 0, supplies: 0, lastServiceDay: null };
    game.cities.push(city);
    const plots = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const t = tile(cx + dx, cy + dy);
      if (t.terrain === 'water') {
        if (dx % 4 === 0 || dy % 4 === 0) publicRoad(cx + dx, cy + dy);
        continue;
      }
      t.terrain = land; t.detail = ''; t.elevation = .25;
      if (dx % 4 === 0 || dy % 4 === 0) publicRoad(cx + dx, cy + dy);
      else if(Math.abs(dx)===2&&Math.abs(dy)===2)t.detail=biome==='taiga'?'wildflowers':biome==='tundra'?'shrubs':'scrub';
      else plots.push({ t, dx, dy, order: random() });
    }
    plots.sort((a,b) => a.order - b.order);
    for (let p = 0; p < plots.length; p++) {
      const { t, dx, dy } = plots[p];
      if (p > 25 && random() > .48) continue;
      let kind;
      if (i === 0 && p < allKinds.length) kind = allKinds[p];
      else if (p < 3) kind = COMMUNITY_KINDS[(i + p * 2) % COMMUNITY_KINDS.length];
      else if (Math.abs(dx) + Math.abs(dy) < 5 && random() < .66) kind = commercialKind(i + p, p % 3 === 0 ? 2 : 1);
      else kind = residentialKind(i + p, 1 + (Math.floor(i / 3) + Math.floor(p / 8)) % 3);
      t.building = { kind, level: 1 };
    }
  }
  // Keep the first trip short, legible and profitable regardless of the world's size.
  for (let x = starterX; x <= starterX + 24; x++) publicRoad(x, starterY);

  const kinds = Object.keys(INDUSTRIES).filter(kind => INDUSTRIES[kind].biomes.includes(biome));
  const clusters = size === 'huge' ? 6 : size === 'large' ? 3 : 1;
  const placed = new Set();
  for (let cluster = 0; cluster < clusters; cluster++) {
    const anchor = game.cities[cluster === 0 ? 0 : Math.min(game.cities.length - 1, Math.floor(cluster * game.cities.length / clusters))];
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k], def = INDUSTRIES[kind];
      const angle = k / kinds.length * Math.PI * 2 + cluster * .73;
      const radius = (size === 'regional' ? 12 : 17) + (k % 3) * 3;
      let x = Math.max(3, Math.min(width - 4, Math.round(anchor.x + Math.cos(angle) * radius)));
      let y = Math.max(3, Math.min(height - 4, Math.round(anchor.y + Math.sin(angle) * radius)));
      let best = null, bestScore = Infinity;
      for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
        const tx=x+dx, ty=y+dy, t=tile(tx,ty);
        if (!t || tx < 2 || ty < 2 || tx > width-3 || ty > height-3 || t.building || t.road || t.terrain==='water' || placed.has(`${tx},${ty}`)) continue;
        if (game.cities.some(c => Math.abs(c.x-tx)<6 && Math.abs(c.y-ty)<6)) continue;
        const coastal = [[1,0],[-1,0],[0,1],[0,-1]].some(([ax,ay]) => tile(tx+ax,ty+ay)?.terrain==='water');
        const score = dx*dx + dy*dy + (def.terrain && !def.terrain.includes(t.terrain) ? 35 : 0) + (def.coastal && !coastal ? 500 : 0);
        if (score < bestScore) { best={x:tx,y:ty};bestScore=score; }
      }
      if (!best) continue;
      ({x,y}=best);
      const t=tile(x,y); placed.add(`${x},${y}`);
      if (kind === 'logging-camp') { t.terrain='forest';t.detail='pine'; }
      else if (kind.includes('mine') || kind==='quarry') { t.terrain='rock';t.detail=biome==='desert'?'canyon':'glacial'; }
      else if (kind==='sand-pit') { t.terrain='sand';t.detail='dunes'; }
      else { t.terrain=land;t.detail=''; }
      t.elevation=.25;
      if (def.coastal && ![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>tile(x+dx,y+dy)?.terrain==='water')) {
        // A compact fish pond is guaranteed when an inland regional cluster lacks a coast.
        const water=tile(x,y+1);if(water&&!water.building&&!water.road&&!placed.has(`${x},${y+1}`)){water.terrain='water';water.elevation=0;water.detail='';}
      }
      const inventory = Object.fromEntries([...Object.keys(def.inputs),...Object.keys(def.outputs)].map(cargo=>[cargo,0]));
      if (!Object.keys(def.inputs).length) for (const [cargo,rate] of Object.entries(def.outputs)) inventory[cargo]=rate*12;
      game.industries.push({id:`industry-${game.industries.length+1}`,kind,name:def.name,x,y,capacity:1,inventory,production:0,totalProduced:0,activity:0,shipped:0,received:0,idleDays:0,owner:'world'});
    }
  }
  return game;
}
