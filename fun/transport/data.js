import { BUILDINGS } from './buildings.js';
/** Transport's inspectable economy catalog. Values are per production day. */
export const BIOMES = {
  taiga: { name: 'Taiga', description: 'Pine forests, sheltered lakes and iron-rich mountain ridges.', color: '#78934d' },
  tundra: { name: 'Tundra', description: 'Snowy highlands, cold fishing waters and rich oil deposits.', color: '#b6c2ad' },
  desert: { name: 'Desert', description: 'Copper canyons, sunlit dunes and productive river oases.', color: '#cba869' },
};
export const CARGO = {
  passengers: { name: 'Passengers', color: '#edc773', price: 18 },
  timber: { name: 'Timber', color: '#947044', price: 22 },
  lumber: { name: 'Lumber', color: '#c4985b', price: 36 },
  coal: { name: 'Coal', color: '#667078', price: 23 },
  iron: { name: 'Iron ore', color: '#a77562', price: 25 },
  steel: { name: 'Steel', color: '#91a5b5', price: 58 },
  grain: { name: 'Grain', color: '#dbc46e', price: 22 },
  food: { name: 'Food', color: '#accb79', price: 54 },
  furniture: { name: 'Furniture', color: '#c0926e', price: 82 },
  machinery: { name: 'Machinery', color: '#839eac', price: 112 },
  fish: { name: 'Fish', color: '#88c2d1', price: 27 },
  oil: { name: 'Crude oil', color: '#777481', price: 32 },
  fuel: { name: 'Fuel', color: '#d7ad64', price: 66 },
  stone: { name: 'Stone', color: '#a8a59a', price: 20 },
  sand: { name: 'Sand', color: '#dec397', price: 18 },
  glass: { name: 'Glass', color: '#a4d5d1', price: 49 },
  copper: { name: 'Copper ore', color: '#be875e', price: 31 },
  wire: { name: 'Copper wire', color: '#d79468', price: 60 },
  cement: { name: 'Cement', color: '#c0b9a6', price: 40 },
  goods: { name: 'Goods', color: '#bd9ed6', price: 104 },
};
const all = ['taiga', 'tundra', 'desert'];
export const INDUSTRIES = {
  'logging-camp': { name: 'Logging camp', inputs: {}, outputs: { timber: 7 }, cost: 28000, biomes: ['taiga'], terrain: ['forest', 'grass'] },
  sawmill: { name: 'Sawmill', inputs: { timber: 4 }, outputs: { lumber: 3 }, cost: 42000, biomes: ['taiga'] },
  'coal-mine': { name: 'Coal mine', inputs: {}, outputs: { coal: 6 }, cost: 38000, biomes: ['taiga', 'tundra'], terrain: ['mountain', 'rock', 'grass', 'snow'] },
  'iron-mine': { name: 'Iron mine', inputs: {}, outputs: { iron: 5 }, cost: 42000, biomes: ['taiga', 'tundra'], terrain: ['mountain', 'rock', 'grass', 'snow'] },
  'steel-mill': { name: 'Steel mill', inputs: { iron: 3, coal: 2 }, outputs: { steel: 3 }, cost: 78000, biomes: ['taiga', 'tundra'] },
  farm: { name: 'Grain farm', inputs: {}, outputs: { grain: 6 }, cost: 30000, biomes: ['taiga', 'desert'], terrain: ['grass', 'sand'] },
  'food-plant': { name: 'Food plant', inputs: { grain: 4 }, outputs: { food: 3 }, cost: 46000, biomes: ['taiga', 'desert'] },
  'furniture-factory': { name: 'Furniture works', inputs: { lumber: 3, steel: 1 }, outputs: { furniture: 3 }, cost: 74000, biomes: ['taiga'] },
  'machine-works': { name: 'Machine works', inputs: { steel: 3, fuel: 1 }, outputs: { machinery: 2 }, cost: 94000, biomes: ['taiga', 'tundra'] },
  fishery: { name: 'Fishery', inputs: {}, outputs: { fish: 7 }, cost: 30000, biomes: ['tundra'], coastal: true },
  'fish-processor': { name: 'Fish processor', inputs: { fish: 4 }, outputs: { food: 3 }, cost: 42000, biomes: ['tundra'] },
  'oil-well': { name: 'Oil well', inputs: {}, outputs: { oil: 6 }, cost: 44000, biomes: all },
  refinery: { name: 'Oil refinery', inputs: { oil: 4 }, outputs: { fuel: 3 }, cost: 72000, biomes: all },
  quarry: { name: 'Stone quarry', inputs: {}, outputs: { stone: 8 }, cost: 32000, biomes: all, terrain: ['rock', 'mountain', 'grass', 'sand', 'snow'] },
  'cement-works': { name: 'Cement works', inputs: { stone: 5 }, outputs: { cement: 3 }, cost: 48000, biomes: ['desert'] },
  'sand-pit': { name: 'Sand pit', inputs: {}, outputs: { sand: 8 }, cost: 26000, biomes: ['desert'], terrain: ['sand'] },
  glassworks: { name: 'Glassworks', inputs: { sand: 4, fuel: 1 }, outputs: { glass: 4 }, cost: 62000, biomes: ['desert'] },
  'copper-mine': { name: 'Copper mine', inputs: {}, outputs: { copper: 6 }, cost: 38000, biomes: ['desert'], terrain: ['rock', 'mountain', 'sand'] },
  'wire-mill': { name: 'Wire mill', inputs: { copper: 3 }, outputs: { wire: 3 }, cost: 58000, biomes: ['desert'] },
  'goods-factory': { name: 'Goods factory', inputs: { glass: 2, wire: 2, cement: 1 }, outputs: { goods: 3 }, cost: 90000, biomes: ['desert'] },
  'equipment-factory': { name: 'Equipment factory', inputs: { steel: 2, fuel: 1 }, outputs: { goods: 2 }, cost: 88000, biomes: ['tundra'] },
};
export const BUILD_COSTS = {
  road: 180, rail: 420, bridge: 1400, railbridge: 2300, tunnel: 2200, railtunnel: 3400,
  'bus-stop': 3200, 'train-stop': 12000, port: 18000, residential: 420, commercial: 640,
  industrial: 880, city: 45000, bulldoze: 100,
  ...Object.fromEntries(Object.entries(BUILDINGS).map(([kind, building]) => [kind, building.cost])),
  ...Object.fromEntries(Object.entries(INDUSTRIES).map(([kind, industry]) => [kind, industry.cost])),
};
export const VEHICLE_COSTS = { road: 18000, rail: 78000, water: 64000 };
export const VEHICLE_CAPACITIES = { road: 24, rail: 90, water: 140 };
export const TOWN_CARGO = ['food', 'furniture', 'goods', 'fuel', 'stone', 'cement', 'machinery'];
