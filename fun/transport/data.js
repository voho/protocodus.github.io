import { BUILDINGS } from './buildings.js';
/** Transport's inspectable economy catalog. Values are per production day. */
export const BIOMES = {
  taiga: { name: 'Taiga', description: 'Pine forests, sheltered lakes and iron-rich mountain ridges.', color: '#78934d' },
  tundra: { name: 'Tundra', description: 'Snowy highlands, cold fishing waters and rich oil deposits.', color: '#b6c2ad' },
  desert: { name: 'Desert', description: 'Copper canyons, sunlit dunes and productive river oases.', color: '#cba869' },
};
export const CARGO = {
  passengers: { name: 'Passengers', color: '#edc773', price: 18, transit: 'express' },
  timber: { name: 'Timber', color: '#947044', price: 22, transit: 'bulk' },
  lumber: { name: 'Lumber', color: '#c4985b', price: 36, transit: 'standard' },
  coal: { name: 'Coal', color: '#667078', price: 23, transit: 'bulk' },
  iron: { name: 'Iron ore', color: '#a77562', price: 25, transit: 'bulk' },
  steel: { name: 'Steel', color: '#91a5b5', price: 58, transit: 'standard' },
  grain: { name: 'Grain', color: '#dbc46e', price: 22, transit: 'standard' },
  food: { name: 'Food', color: '#accb79', price: 54, transit: 'perishable' },
  furniture: { name: 'Furniture', color: '#c0926e', price: 82, transit: 'standard' },
  machinery: { name: 'Machinery', color: '#839eac', price: 112, transit: 'standard' },
  fish: { name: 'Fish', color: '#88c2d1', price: 27, transit: 'perishable' },
  oil: { name: 'Crude oil', color: '#777481', price: 32, transit: 'bulk' },
  fuel: { name: 'Fuel', color: '#d7ad64', price: 66, transit: 'standard' },
  stone: { name: 'Stone', color: '#a8a59a', price: 20, transit: 'bulk' },
  sand: { name: 'Sand', color: '#dec397', price: 18, transit: 'bulk' },
  glass: { name: 'Glass', color: '#a4d5d1', price: 49, transit: 'standard' },
  copper: { name: 'Copper ore', color: '#be875e', price: 31, transit: 'bulk' },
  wire: { name: 'Copper wire', color: '#d79468', price: 60, transit: 'standard' },
  cement: { name: 'Cement', color: '#c0b9a6', price: 40, transit: 'standard' },
  goods: { name: 'Goods', color: '#bd9ed6', price: 104, transit: 'perishable' },
};
/** Days a class is paid in full, then the share of the distance fare it loses each extra day. */
export const TRANSIT_CLASSES = {
  express: { name: 'Express', fullDays: 14, dailyLoss: .015 },
  perishable: { name: 'Time-sensitive', fullDays: 16, dailyLoss: .012 },
  standard: { name: 'Standard', fullDays: 25, dailyLoss: .008 },
  bulk: { name: 'Bulk', fullDays: 45, dailyLoss: .004 },
};
export const TRANSIT_PAY_FLOOR = .5;
/** Distance fare per unit = price × (tiles + HANDLING_TILES) ÷ DISTANCE_TILES. */
export const DISTANCE_TILES = 9, HANDLING_TILES = 12;
/** Fares count at most this multiple of the grid distance between a route's stops. */
export const DETOUR_PAY_LIMIT = 2;
/** Base speeds in tiles per day before weather, slopes, towns and generation. TRAVEL_PACE is the typical realised share. */
export const VEHICLE_SPEEDS = { road: 2.8, rail: 4.6, water: 1.8 };
export const TRAVEL_PACE = { road: .88, rail: .88, water: .78 };
export const STOP_DAYS = { road: .2, rail: .2, water: .2 };
const all = ['taiga', 'tundra', 'desert'];
export const INDUSTRIES = {
  'logging-camp': { footprint: 2, name: 'Logging camp', inputs: {}, outputs: { timber: 7 }, cost: 28000, biomes: ['taiga'], terrain: ['forest', 'grass'] },
  sawmill: { footprint: 2, name: 'Sawmill', inputs: { timber: 4 }, outputs: { lumber: 3 }, cost: 42000, biomes: ['taiga'] },
  'coal-mine': { footprint: 2, name: 'Coal mine', inputs: {}, outputs: { coal: 6 }, cost: 38000, biomes: ['taiga', 'tundra'], terrain: ['mountain', 'rock', 'grass', 'snow'] },
  'iron-mine': { footprint: 2, name: 'Iron mine', inputs: {}, outputs: { iron: 5 }, cost: 42000, biomes: ['taiga', 'tundra'], terrain: ['mountain', 'rock', 'grass', 'snow'] },
  'steel-mill': { footprint: 3, name: 'Steel mill', inputs: { iron: 3, coal: 2 }, outputs: { steel: 3 }, cost: 78000, biomes: ['taiga', 'tundra'] },
  farm: { footprint: 2, name: 'Grain farm', inputs: {}, outputs: { grain: 6 }, cost: 30000, biomes: ['taiga', 'desert'], terrain: ['grass', 'sand'] },
  'food-plant': { footprint: 3, name: 'Food plant', inputs: { grain: 4 }, outputs: { food: 3 }, cost: 46000, biomes: ['taiga', 'desert'] },
  'furniture-factory': { footprint: 3, name: 'Furniture works', inputs: { lumber: 3, steel: 1 }, outputs: { furniture: 3 }, cost: 74000, biomes: ['taiga'] },
  'machine-works': { footprint: 3, name: 'Machine works', inputs: { steel: 3, fuel: 1 }, outputs: { machinery: 2 }, cost: 94000, biomes: ['taiga', 'tundra'] },
  fishery: { footprint: 2, name: 'Fishery', inputs: {}, outputs: { fish: 7 }, cost: 30000, biomes: ['tundra'], coastal: true },
  'fish-processor': { footprint: 2, name: 'Fish processor', inputs: { fish: 4 }, outputs: { food: 3 }, cost: 42000, biomes: ['tundra'] },
  'oil-well': { footprint: 2, name: 'Oil well', inputs: {}, outputs: { oil: 6 }, cost: 44000, biomes: all },
  refinery: { footprint: 3, name: 'Oil refinery', inputs: { oil: 4 }, outputs: { fuel: 3 }, cost: 72000, biomes: all },
  quarry: { footprint: 2, name: 'Stone quarry', inputs: {}, outputs: { stone: 8 }, cost: 32000, biomes: all, terrain: ['rock', 'mountain', 'grass', 'sand', 'snow'] },
  'cement-works': { footprint: 3, name: 'Cement works', inputs: { stone: 5 }, outputs: { cement: 3 }, cost: 48000, biomes: ['desert'] },
  'sand-pit': { footprint: 2, name: 'Sand pit', inputs: {}, outputs: { sand: 8 }, cost: 26000, biomes: ['desert'], terrain: ['sand'] },
  glassworks: { footprint: 2, name: 'Glassworks', inputs: { sand: 4, fuel: 1 }, outputs: { glass: 4 }, cost: 62000, biomes: ['desert'] },
  'copper-mine': { footprint: 2, name: 'Copper mine', inputs: {}, outputs: { copper: 6 }, cost: 38000, biomes: ['desert'], terrain: ['rock', 'mountain', 'sand'] },
  'wire-mill': { footprint: 2, name: 'Wire mill', inputs: { copper: 3 }, outputs: { wire: 3 }, cost: 58000, biomes: ['desert'] },
  'goods-factory': { footprint: 3, name: 'Goods factory', inputs: { glass: 2, wire: 2, cement: 1 }, outputs: { goods: 3 }, cost: 90000, biomes: ['desert'] },
  'equipment-factory': { footprint: 3, name: 'Equipment factory', inputs: { steel: 2, fuel: 1 }, outputs: { goods: 2 }, cost: 88000, biomes: ['tundra'] },
};
export const BUILD_COSTS = {
  road: 180, rail: 420, bridge: 1400, railbridge: 2300, tunnel: 2200, railtunnel: 3400,
  'bus-stop': 3200, 'train-stop': 12000, port: 18000, residential: 420, commercial: 640,
  industrial: 880, city: 45000, bulldoze: 100, raise: 240, lower: 180, level: 280,
  ...Object.fromEntries(Object.entries(BUILDINGS).map(([kind, building]) => [kind, building.cost])),
  ...Object.fromEntries(Object.entries(INDUSTRIES).map(([kind, industry]) => [kind, industry.cost])),
};
export const VEHICLE_COSTS = { road: 18000, rail: 78000, water: 64000 };
export const VEHICLE_CAPACITIES = { road: 24, rail: 90, water: 140 };
/** Daily upkeep before weather and inflation: per vehicle, per company track or road tile, per bridge or tunnel tile, per stop. */
export const VEHICLE_UPKEEP = { road: 22, rail: 90, water: 70 };
export const INFRASTRUCTURE_UPKEEP = { road: .075, rail: .14, structure: .2, stop: { road: 1.2, rail: 4, water: 6 } };
export const TOWN_CARGO = ['food', 'furniture', 'goods', 'fuel', 'stone', 'cement', 'machinery'];
