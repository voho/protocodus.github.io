// Derived entity buckets, never part of a save. Entity order is retained so
// floating-point accumulation matches the original full-array traversal.
const caches = new WeakMap();
const CELL = 16;

function index(game) {
  const day = Math.floor(game.day || 0);
  let cache = caches.get(game);
  if (cache && cache.day === day && cache.revision === game.revision &&
      cache.cities === game.cities && cache.industries === game.industries &&
      cache.stations === game.stations && cache.zones === game.zones &&
      cache.cityCount === game.cities.length && cache.industryCount === game.industries.length &&
      cache.stationCount === game.stations.length && cache.zoneCount === game.zones.length) return cache;
  const bucket = items => {
    const cells = new Map();
    items.forEach((entity, order) => {
      const key = `${Math.floor(entity.x / CELL)},${Math.floor(entity.y / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ entity, order });
    });
    return cells;
  };
  cache = { day, revision: game.revision, cities: game.cities, industries: game.industries, stations: game.stations, zones: game.zones,
    cityCount: game.cities.length, industryCount: game.industries.length,
    stationCount: game.stations.length, zoneCount: game.zones.length,
    // Callers already allow two tiles beyond an industry's anchor for older
    // 3×3 sites. Add only the new field extent; precise edge filters follow.
    industryExtra: game.industries.reduce((extra,site)=>Math.max(extra,(site.footprint||1)-3),0),
    cityCells: bucket(game.cities), industryCells: bucket(game.industries),
    stationCells: bucket(game.stations), zoneCells: bucket(game.zones) };
  caches.set(game, cache);
  return cache;
}

function nearby(cells, x, y, radius) {
  const found = [];
  for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
    for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
      for (const record of cells.get(`${cx},${cy}`) || []) {
        const point = record.entity;
        if (Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius) found.push(record);
      }
    }
  }
  found.sort((a, b) => a.order - b.order);
  return found.map(record => record.entity);
}

export function nearbyCities(game, x, y, radius) {
  return game.cities.length <= 16 ? game.cities : nearby(index(game).cityCells, x, y, radius);
}

export function nearbyIndustries(game, x, y, radius) {
  if(game.industries.length<=16)return game.industries;
  const cache=index(game);
  return nearby(cache.industryCells,x,y,radius+cache.industryExtra);
}

export function nearbyStations(game, x, y, radius) {
  return game.stations.length <= 16 ? game.stations : nearby(index(game).stationCells, x, y, radius);
}

export function nearbyZones(game, x, y, radius) {
  return game.zones.length <= 16 ? game.zones : nearby(index(game).zoneCells, x, y, radius);
}
