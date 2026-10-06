import { BUILDINGS, BUILDING_GROUPS } from './buildings.js';
import { BIOMES, CARGO, INDUSTRIES, BUILD_COSTS, WORKSHOP, WORKSHOP_RECIPES, TOWN_CARGO, VEHICLE_SPEEDS, VEHICLE_UPKEEP, INFRASTRUCTURE_UPKEEP, isTownTraffic } from './data.js';
import { MARKET, OUTLET, familyCargo } from './town-market.js';
import { housingCapacity } from './settlements.js';
import { BIOME_NATURE } from './terrain-sprites.js';
import { NATURE_ART_CATALOG } from './raster-nature.js';
import { EXTRA_TREE_ART, HOLLOW_TREE_ART, CACTUS_ART } from './tree-art-catalog.js';
import { priceFor, airAvailable, AIR_DEBUT_YEAR } from './economy-pricing.js';
import { getVehiclePurchase } from './model.js';
import { AIRPORT_REACH, STATION_RADIUS } from './station-sites.js';
import { defaultChainProduct } from './chains.js';

const climates = Object.keys(BIOMES);
const extraNatureHeights = Object.fromEntries([...Object.values(EXTRA_TREE_ART).flat(),...HOLLOW_TREE_ART,...CACTUS_ART].map(art=>[art.id,art.heightMetres]));
const hollowTreeKinds = new Set(HOLLOW_TREE_ART.map(tree=>tree.id));
const cactusKinds = new Set(CACTUS_ART.map(plant=>plant.id));
const title = name => name.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
export const GALLERY_CATEGORIES = Object.freeze({ all: 'Everything', homes: 'Homes', community: 'Community & parks', shops: 'Shops & malls', services: 'Amenities', industry: 'Industries & farms', transport: 'Transport', nature: 'Landscape', cargo: 'Cargo' });

const infrastructure = [
  ['road', 'Road', 'Drag a line to connect road stops. Bridges and tunnels are chosen automatically where possible.', 'road'],
  ['rail', 'Railway', 'Drag a line to connect rail stations. Trains need a continuous railway.', 'rail'],
  ['bus-stop', 'Road stop', 'Serves nearby towns and industries. A missing road tile is built with the stop.', 'bus-stop', 'road'],
  ['train-stop', 'Rail station', 'Place on a railway near towns or industries, then connect another station.', 'train-stop', 'rail'],
  ['port', 'Port', 'Place on water beside a bank. Ships follow connected rivers, lakes and seas.', 'port', 'water'],
  ['airport-x', 'Airport', 'A 6 × 2 runway on clear, level land near a town. Planes carry passengers and mail.', 'airport', 'air'],
  ['bridge', 'Road bridge', 'Cross water or lower land between flat banks at the same height.', 'road-bridge'],
  ['railbridge', 'Rail bridge', 'Carry trains across water or lower land between flat ends at the same height.', 'rail-bridge'],
  ['tunnel', 'Road tunnel', 'Cross higher dry ground between flat portal sites at the same height.', 'road-tunnel'],
  ['railtunnel', 'Rail tunnel', 'Carry trains through higher dry ground between flat portal sites.', 'rail-tunnel'],
];
const vehicles = [
  ['bus', 'Bus', 'road', 'passengers', 'Carries passengers between two different towns, loading at both ends.'],
  ['truck', 'Freight truck', 'road', 'goods', 'Carries cargo from an industry that supplies it to a buyer; returns empty.'],
  ['mail-truck', 'Mail truck', 'road', 'mail', 'Carries mail between two different towns, loading at both ends.'],
  ['passenger-train', 'Passenger train', 'rail', 'passengers', 'Connects two towns over a continuous railway.'],
  ['freight-train', 'Freight train', 'rail', 'goods', 'Moves industrial cargo between connected rail stations.'],
  ['ferry', 'Passenger ferry', 'water', 'passengers', 'Connects towns across connected waterways.'],
  ['freighter', 'Cargo ship', 'water', 'goods', 'Moves industrial cargo between ports along connected water.'],
  ['tanker', 'Tanker', 'water', 'oil', 'The cargo ship body used to carry crude oil and fuel.'],
  ['airliner', 'Airliner', 'air', 'passengers', 'Flies between airports serving two different towns; also available for mail.'],
];

/** Every player-facing identity, built from the same catalogs the simulation uses. */
export function galleryCatalog() {
  const entries = Object.entries(BUILDINGS).map(([kind, definition]) => ({
    id: `building:${kind}`, kind, type: 'building', category: definition.group,
    name: definition.name, biomes: climates, footprint: definition.footprint,
    cost: definition.cost, tool: kind, art: { type: 'building', kind },
    description: definition.residents ? 'A home with its own garden. Nearby transport, amenities and greenery support the town.' :
      definition.naturalCover ? 'Public green space that improves the surrounding neighborhood.' :
      definition.group === 'shops' ? 'A local business that supports town development and passenger activity.' :
      definition.group === 'services' ? 'A neighborhood amenity that supports local development.' : 'A public amenity that helps nearby neighborhoods develop.',
  }));
  entries.push({ id: 'building:factory', kind: 'factory', type: 'workshop', category: 'industry', name: 'Town workshop', biomes: climates, footprint: WORKSHOP.footprint, cost: WORKSHOP.cost, tool: 'workshop', art: { type: 'building', kind: 'factory' }, description: 'Processes materials delivered to its town into products for another town. Place within 10 tiles of a town center.' });
  for (const [kind, definition] of Object.entries(INDUSTRIES)) entries.push({
    id: `industry:${kind}`, kind, type: 'industry', category: 'industry', name: definition.name,
    biomes: definition.biomes, footprint: definition.footprint, cost: definition.cost, tool: kind,
    art: { type: 'industry', kind }, inputs: definition.inputs, outputs: definition.outputs,
    description: definition.farming ? 'A fenced farm with a 2 × 2 building yard and surrounding fields inside its 5 × 5 plot.' : Object.keys(definition.inputs).length ? 'Deliver every required input, then carry the products onward to a customer.' : 'Produces raw materials. Connect a freight stop and carry them to the next stage.',
  });
  for (const [kind, name, description, artKind, mode] of infrastructure) entries.push({ id: `transport:${kind}`, kind, type: 'infrastructure', category: 'transport', name, description, biomes: climates, cost: BUILD_COSTS[kind], tool: kind, mode, footprint: kind === 'airport-x' ? '6 × 2' : 1, art: { type: 'infrastructure', kind: artKind } });
  for (const [kind, name, mode, cargo, description] of vehicles) entries.push({ id: `vehicle:${kind}`, kind, type: 'vehicle', category: 'transport', name, description, biomes: climates, mode, cargo, art: { type: 'vehicle', mode, cargo } });
  entries.push({ id: 'transport:city', kind: 'city', type: 'town', category: 'transport', name: 'Town', biomes: climates, cost: BUILD_COSTS.city, tool: 'city', description: 'Towns supply passengers and mail and buy finished cargo. Found a town, add roads and homes, then connect regular transport.', art: { type: 'building', kind: 'town-hall' } });
  for (const [kind, name, description] of [
    ['forest', 'Woodland', 'Trees add natural cover and improve the local environment. Groves can occupy 1 × 1, 2 × 2 or 3 × 3 plots.'],
    ['rock', 'Rock outcrop', 'Natural rocky ground. Larger outcrops occupy a shared parcel; bulldozing any part clears that parcel.'],
    ['mountain', 'Mountain ridge', 'Higher rocky terrain. Roads may need a tunnel, bridge or a different alignment.'],
    ['grass', 'Grassland', 'Open land for roads, towns and buildings, where the slope and site allow it.'],
    ['sand', 'Sand', 'Dry terrain found around dunes, shorelines and desert sites.'],
    ['snow', 'Snowfield', 'Cold open terrain, often at higher elevations in the tundra.'],
    ['water', 'Water', 'Ships travel on connected water. Ports need a bank; bridges allow a road or railway crossing.'],
  ]) entries.push({ id: `nature:${kind}`, kind, type: 'nature', category: 'nature', name, description, biomes: climates, art: { type: 'nature', kind } });
  const flora = new Map();
  function addNature(biome, group, detail, atlas) {
    const id = `nature:${group}:${detail}`;
    if (!flora.has(id)) flora.set(id, { id, kind: detail, type: 'nature', category: 'nature', name: title(detail), biomes: [], description: group === 'trees' ? 'A tree species or growth stage in this climate. Trees and their shadows follow the same world scale.' : ['mountains', 'rocks'].includes(group) ? 'A geological landscape feature. Related exposures vary across the terrain.' : 'Natural ground vegetation that adds local cover. It can be cleared before construction.', art: { type: 'nature', kind: group === 'trees' ? 'tree' : group === 'mountains' ? 'mountain' : group === 'rocks' ? 'rock' : 'terrain-detail', detail, atlas: {} } });
    const item = flora.get(id);
    if (extraNatureHeights[detail]) item.heightMetres = extraNatureHeights[detail];
    if (group==='trees'&&hollowTreeKinds.has(detail)) item.description='An older tundra tree with a hollow trunk and sparse branches. It is part of the natural woodland.';
    if (group==='plants'&&cactusKinds.has(detail)) item.description='A desert cactus with a distinctive natural shape. It can be cleared before construction.';
    if (!item.biomes.includes(biome)) item.biomes.push(biome);
    if (atlas) item.art.atlas[biome] = atlas;
  }
  for (const [biome, nature] of Object.entries(BIOME_NATURE)) for (const [group, names] of Object.entries(nature)) for (const detail of names) addNature(biome, group, detail);
  for (const [biome, kinds] of Object.entries(NATURE_ART_CATALOG.trees)) for (const detail of kinds) addNature(biome, 'trees', detail, `nature-trees-${biome}:${detail}`);
  for (const [biome, kinds] of Object.entries(NATURE_ART_CATALOG.ground)) for (const detail of kinds) addNature(biome, 'plants', detail, `nature-ground-${biome}:${detail}`);
  for (const detail of NATURE_ART_CATALOG.mountains) for (const biome of climates.filter(b => BIOME_NATURE[b].mountains.includes(detail))) addNature(biome, 'mountains', detail, `nature-mountains:${detail}`);
  for (const detail of NATURE_ART_CATALOG.rocks) addNature(detail.split('-')[0], 'rocks', detail, `nature-rocks:${detail}`);
  entries.push(...flora.values());
  for (const [kind, definition] of Object.entries(CARGO)) entries.push({ id: `cargo:${kind}`, kind, type: 'cargo', category: 'cargo', name: definition.name, biomes: climates, description: kind === 'passengers' || kind === 'mail' ? 'Travels between different towns and loads at both ends. Create a separate route for this traffic.' : 'Choose this cargo when launching a freight route between an industry that supplies it and a buyer.', art: { type: 'cargo', kind } });
  return entries;
}

export function filterGallery(entries, { category = 'all', climate = 'all', query = '' } = {}) {
  const words = String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (category === 'all' || entry.category === category) && (climate === 'all' || entry.biomes.includes(climate)) && words.every(word => [entry.name, entry.kind, entry.description, ...Object.keys(entry.inputs || {}), ...Object.keys(entry.outputs || {})].join(' ').toLocaleLowerCase().includes(word)));
}

/** Downstream identities include actual industry recipes, workshops and town outlets. */
export function cargoConsumers(cargo, biome) {
  const result = Object.entries(INDUSTRIES).filter(([, d]) => d.biomes.includes(biome) && d.inputs[cargo] > 0).map(([kind, d]) => ({ id: `industry:${kind}`, name: d.name, role: 'Industry input' }));
  if ((WORKSHOP_RECIPES[biome] || []).some(recipe => recipe.input === cargo)) result.push({ id: 'building:factory', name: 'Town workshops', role: 'Delivered through a town stop' });
  if (TOWN_CARGO.includes(cargo)) result.push({ id: 'transport:city', name: 'Towns', role: 'Deliver to a stop serving a town' });
  else if (isTownTraffic(cargo)) result.push({ id: 'transport:city', name: 'A different town', role: 'Travels both ways between town stops' });
  for (const [kind, d] of Object.entries(BUILDINGS)) {
    const families = d.outlets ? Object.keys(d.outlets) : OUTLET[kind] ? [OUTLET[kind]] : [];
    if (families.some(family => familyCargo({ biome }, family).includes(cargo))) result.push({ id: `building:${kind}`, name: d.name, role: 'Retail outlet, supplied through its town' });
  }
  return result;
}

export function galleryBuildState(game, entry) {
  if (!entry.tool) return { available: false, reason: entry.type === 'vehicle' ? 'Buy vehicles when creating or expanding a route.' : 'This object occurs naturally in the world.' };
  if (!entry.biomes.includes(game.biome)) return { available: false, reason: `Available in ${entry.biomes.map(b => BIOMES[b].name).join(' or ')}.` };
  if (entry.mode === 'air' && !airAvailable(game)) return { available: false, reason: `Air travel opens in ${AIR_DEBUT_YEAR}.` };
  return { available: true, reason: '' };
}

/** Read-only base rules. House demand is a potential town contribution, never independent inventory. */
export function galleryDetails(game, entry, biome = game.biome) {
  const context = { ...game, biome }, stats = [], notes = [], recipes = [], consumers = [];
  if (entry.footprint) stats.push(['Site', typeof entry.footprint === 'string' ? `${entry.footprint} tiles` : `${entry.footprint} × ${entry.footprint} tiles`]);
  if (entry.cost) stats.push(['Build price today', priceFor(game, entry.cost)]);
  if (entry.type === 'building') {
    const d = BUILDINGS[entry.kind];
    stats.push(['Collection', BUILDING_GROUPS[d.group].name]);
    if (d.residents) {
      const capacity = [1, 2, 3].map(level => housingCapacity({ kind: entry.kind, level }));
      stats.push(['Residents at levels 1, 2 and 3', capacity.join(', ')]);
      for (const [family, rate] of Object.entries(MARKET.perResident)) stats.push([`Potential ${family === 'household' ? 'household cargo' : family} a month at level 1`, Math.round(capacity[0] * rate * 100) / 100]);
      notes.push('Food, household and fuel orders belong to the town. These figures are the potential contribution of a full home; outlet reach and total town population determine actual monthly orders.');
      notes.push(`Household cargo in ${BIOMES[biome].name}: ${familyCargo(context, 'household').map(c => CARGO[c].name).join(', ')}.`);
      notes.push('Residents contribute passengers and mail to the town pool. Daily arrivals vary with local amenities, weather and surroundings. Serve a stop near the town center to carry them.');
    } else {
      const outlets = d.outlets || (OUTLET[entry.kind] ? { [OUTLET[entry.kind]]: 1 } : {});
      for (const [family, units] of Object.entries(outlets)) {
        stats.push([`${title(family)} outlets per level`, units]);
        for (const cargo of familyCargo(context, family)) consumers.push({ cargo, incoming: true, entries: Object.entries(INDUSTRIES).filter(([, def]) => def.biomes.includes(biome) && def.outputs[cargo] > 0).map(([kind, def]) => ({ id: `industry:${kind}`, name: def.name, role: 'Produces deliveries for its town' })) });
      }
      if (d.group === 'shops' || d.group === 'services') stats.push(['Shop capacity per level', d.shopUnits || 1]);
      if (d.naturalCover) stats.push(['Natural cover', `${Math.round(d.naturalCover * 100)}% per site tile`]);
      if (Object.keys(outlets).length) notes.push('Deliver these products to a freight stop serving the town. Shops contribute to town demand; they do not hold separate cargo inventories.');
      else notes.push('Supports neighborhood development and town activity. This building has no separate production recipe or freight inventory.');
    }
  } else if (entry.type === 'industry') {
    recipes.push({ inputs: entry.inputs, outputs: entry.outputs });
    stats.push(['Recipe period', 'Base quantities per production day']);
    if (INDUSTRIES[entry.kind].farming) stats.push(['Building yard', '2 × 2 tiles, within the fenced plot']);
    notes.push('Figures assume capacity 1. Supply every input; actual production varies with capacity, conditions and available stock.');
    const d = INDUSTRIES[entry.kind];
    if (d.coastal) notes.push('Needs a coastal site beside water.');
    if (d.terrain) notes.push(`Allowed ground: ${d.terrain.map(title).join(', ')}.`);
    for (const cargo of Object.keys(entry.outputs)) consumers.push({ cargo, entries: cargoConsumers(cargo, biome) });
  } else if (entry.type === 'workshop') {
    for (const r of WORKSHOP_RECIPES[biome] || []) recipes.push({ inputs: { [r.input]: WORKSHOP.ratio }, outputs: { [r.output]: 1 } });
    stats.push(['Materials processed each day per level', WORKSHOP.rate], ['Input and output storage for each cargo per level', WORKSHOP.store], ['Maximum level', WORKSHOP.maxLevel]);
    notes.push('Recipes share the workshop’s processing allowance. Town workshops pool their inventory; each level adds processing and storage. Carry products to a different town.');
    for (const cargo of new Set((WORKSHOP_RECIPES[biome] || []).map(r => r.output))) consumers.push({ cargo, entries: cargoConsumers(cargo, biome).filter(e => e.id !== entry.id) });
  } else if (entry.type === 'vehicle') {
    const purchase = getVehiclePurchase(game, entry.mode);
    stats.push(['Current model capacity', purchase.capacity], ['Current purchase price', purchase.cost], ['Base speed, tiles a day', VEHICLE_SPEEDS[entry.mode] * purchase.speedMultiplier], ['Base upkeep for 30 days', VEHICLE_UPKEEP[entry.mode] * 30]);
    notes.push('Speed and upkeep vary with conditions; upkeep also follows current prices. Vehicles are bought through routes.');
    if (entry.mode === 'air' && !airAvailable(game)) notes.push(`Air travel opens in ${AIR_DEBUT_YEAR}.`);
  } else if (entry.type === 'infrastructure') {
    if (entry.mode) stats.push(['Catchment', `${entry.mode === 'air' ? AIRPORT_REACH : STATION_RADIUS} tiles`], ['Base stop upkeep for 30 days', INFRASTRUCTURE_UPKEEP.stop[entry.mode] * 30]);
    notes.push(entry.mode ? 'Place a second connected stop, then launch a route. Towns supply passengers and mail; industries need cargo that matches their recipes.' : 'After building the network, add stops near customers and create a route. Company roads and railways have upkeep costs.');
  } else if (entry.type === 'town') {
    stats.push(['Starting residents when founded', 80], ['Building and workshop catchment', '10 tiles'], ['Passenger and freight stop reach', `${STATION_RADIUS} tiles`]);
    notes.push(`Towns buy ${TOWN_CARGO.map(c => CARGO[c].name.toLowerCase()).join(', ')}. Food, household goods and fuel generate monthly retail orders; construction materials support development.`);
    notes.push('Town workshops also take their climate’s materials and supply products. Passengers and mail need routes between different towns.');
  } else if (entry.type === 'cargo') {
    stats.push(['Base cargo fare', CARGO[entry.kind].price], ['Transit class', title(CARGO[entry.kind].transit)]);
    notes.push('The fare also depends on distance, travel time and current prices.');
    consumers.push({ cargo: entry.kind, entries: cargoConsumers(entry.kind, biome) });
    const sources = Object.entries(INDUSTRIES).filter(([, d]) => d.biomes.includes(biome) && d.outputs[entry.kind] > 0).map(([kind, d]) => ({ id: `industry:${kind}`, name: d.name, role: 'Supplies this cargo' }));
    if ((WORKSHOP_RECIPES[biome] || []).some(recipe => recipe.output === entry.kind)) sources.push({ id: 'building:factory', name: 'Town workshops', role: 'Produced in the town’s shared inventory' });
    if (isTownTraffic(entry.kind)) sources.push({ id: 'transport:city', name: 'Towns', role: 'Residents and amenities supply the town pool' });
    if (sources.length) consumers.unshift({ cargo: entry.kind, incoming: true, entries: sources });
  } else if (entry.type === 'nature' && entry.heightMetres) {
    stats.push(['Typical mature height', `${Math.round(entry.heightMetres * 10) / 10} m`]);
  }
  return { stats, notes, recipes, consumers, chain: entry.type === 'industry' && entry.biomes.includes(game.biome) ? { cargo: defaultChainProduct(game.biome, entry.kind), industryKind: entry.kind } : null };
}
