import { BUILDINGS, residentialKind, commercialKind } from './buildings.js';
import { galleryCatalog } from './catalog-data.js';
import { buildingAt, buildingSize } from './building-sites.js';
import { industryContains, industrySize } from './industry-sites.js';
import { stationSiteAt } from './station-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { natureVariant, natureDensity } from './nature-placement.js';
import { normalizedDetail } from './terrain-sprites.js';
import { landscapeScenery } from './landscape-scenery.js';
import { rasterCactusIdentity, rasterForestComposition, rasterTreeIdentity } from './raster-nature.js';
import { atlasAvailable } from './atlas-runtime.js';
import { groundIsFlat } from './terrain-geometry.js';
import { farmCrop } from './farm-fields-art.js';

const entries = new Map(galleryCatalog().map(entry => [entry.id, entry]));
const tileAt = (game, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;

/** Resolve the same contemporary identity the map draws for an old saved building. */
export function selectionBuildingKind(building, variant = 0) {
  return ['house', 'apartment'].includes(building?.kind) ? residentialKind(variant, building.level || 1) :
    ['shop', 'office'].includes(building?.kind) ? commercialKind(variant, building.level || 1) : building?.kind;
}

export function selectionVehicleKind(route) {
  if (route?.mode === 'air') return 'airliner';
  if (route?.mode === 'water') return ['oil', 'fuel'].includes(route.cargo) ? 'tanker' : ['passengers', 'mail'].includes(route.cargo) ? 'ferry' : 'freighter';
  if (route?.mode === 'rail') return ['passengers', 'mail'].includes(route.cargo) ? 'passenger-train' : 'freight-train';
  return route?.cargo === 'passengers' ? 'bus' : route?.cargo === 'mail' ? 'mail-truck' : 'truck';
}

/** A read-only field-guide selection; saved footprints and artwork seeds stay intact. */
export function selectionGallery(game, selection, { available = atlasAvailable, layers = {} } = {}) {
  if (!selection) return null;
  const result = (entryId, position, preview = {}, related = []) => {
    const entry = entries.get(entryId);
    return entry ? { entryId, climate: entry.biomes.includes(game.biome) ? game.biome : entry.biomes[0], position, preview, related } : null;
  };
  if (selection.vehicle !== undefined && selection.vehicle !== null) {
    const vehicle = (game.vehicles || []).find(v => v.id === selection.vehicle), route = vehicle && (game.routes || []).find(r => r.id === vehicle.routeId);
    return route ? result(`vehicle:${selectionVehicleKind(route)}`, null, { level: vehicle.level || 0, cargo: route.cargo, mode: route.mode }) : null;
  }
  let { x, y } = selection;
  const initial = tileAt(game, x, y);
  if (!initial) return null;
  const requested = selection.kind || '';
  if (requested === 'city') return result('transport:city', { x, y });
  const station = stationSiteAt(game, x, y);
  if (station && requested !== 'industry') return result(`transport:${station.mode === 'air' ? 'airport-x' : station.mode === 'water' ? 'port' : station.mode === 'rail' ? 'train-stop' : 'bus-stop'}`, { x: station.x, y: station.y }, { axis: station.axis || 'x' });
  const industry = (game.industries || []).find(site => industryContains(site, x, y));
  if (industry) return result(`industry:${industry.kind}`, { x: industry.x, y: industry.y }, { footprint: industrySize(industry), variant: industry.kind === 'farm' && industrySize(industry) >= 5 ? +(farmCrop(industry, game.seed || 0) === 'corn') : industry.x + industry.y });
  const building = buildingAt(game, x, y);
  if (building) {
    const tile = tileAt(game, building.x, building.y), variant = tile.variant ?? building.x * 13 + building.y;
    const kind = selectionBuildingKind(building.building, variant);
    if (BUILDINGS[kind] || kind === 'factory') return result(`building:${kind}`, { x: building.x, y: building.y }, { variant, level: building.building.level || 1, footprint: buildingSize(building.building) });
  }
  if ((game.cities || []).some(city => city.x === x && city.y === y) && !initial.zone) return result('transport:city', { x, y });
  const nature = terrainObjectAt(game, x, y);
  // Mountain parcels remain terrain geometry; unlike a grove they are not one upright object.
  if (nature && nature.object.kind !== 'mountain') { x = nature.x; y = nature.y; }
  const tile = tileAt(game, x, y), position = { x, y };
  if (tile.road || tile.rail) {
    const rail = !tile.road && tile.rail;
    const crossing = tile.bridge || tile.terrain === 'water' ? rail ? 'railbridge' : 'bridge' : tile.tunnel || tile.terrain === 'mountain' ? rail ? 'railtunnel' : 'tunnel' : rail ? 'rail' : 'road';
    return result(`transport:${crossing}`, position);
  }
  if (tile.zone && !tile.building) return result('transport:city', position);
  const footprint = nature && nature.object.kind !== 'mountain' ? terrainObjectSize(nature.object) : 1;
  const variant = footprint > 1 ? nature.object.variant || 0 : natureVariant(game, x, y, tile);
  const detail = footprint > 1 ? nature.object.detail || '' : tile.detail || '';
  const terrain = footprint > 1 ? nature.object.kind : tile.terrain;
  if (terrain === 'forest') {
    const density = footprint > 1 ? 1 : natureDensity(game, x, y, tile);
    const trees = rasterForestComposition(game.biome, detail, variant, { density, footprint });
    const identities = trees.map(tree => rasterTreeIdentity(tree, game.biome));
    // A whole grove uses its native fallback if any tree atlas is unavailable.
    // Only claim exact generated species when the map can display that grove.
    const related = layers.trees !== false && groundIsFlat(game, x, y, footprint) && identities.every(available) ? [...new Set(identities)].map(id => `nature:trees:${id.split(':')[1]}`).filter(id => entries.has(id)) : [];
    return result('nature:forest', position, { variant, detail, footprint, level: density }, related);
  }
  if (terrain === 'rock' || terrain === 'mountain') return result(`nature:${terrain}`, position, { variant, detail, footprint });
  const scenery = groundIsFlat(game, x, y) ? landscapeScenery(game.biome, game.seed || 0, x, y, tile) : null;
  if (scenery && (scenery.kind === 'stone' || layers.trees !== false)) {
    const normalized = normalizedDetail(scenery.detail), cactus = game.biome === 'desert' ? rasterCactusIdentity(normalized, variant) : null;
    const id = cactus && available(cactus) ? `nature:plants:${cactus.split(':')[1]}` : `nature:plants:${normalized}`;
    if (entries.has(id)) return result(id, position, { variant, detail: normalized, footprint: 1 });
  }
  return result(`nature:${['grass', 'sand', 'snow', 'water'].includes(terrain) ? terrain : 'grass'}`, position);
}
