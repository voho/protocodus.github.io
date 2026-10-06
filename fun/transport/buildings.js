// Shared building identities keep generated towns, player construction and sprites in sync.
export const BUILDING_GROUPS = {
  homes: { name: 'Homes', description: 'Three tiers. Nine distinct places to call home.' },
  community: { name: 'Community', description: 'The landmarks that give a town its character.' },
  shops: { name: 'Shops', description: 'High-street businesses and larger shopping centres.' },
  services: { name: 'Services', description: 'Everyday services, from a letter to a night away.' },
};
export const BUILDINGS = {
  'house-cheap-1': { footprint: 1, name: 'Workers’ cottage', group: 'homes', tier: 'Affordable', cost: 1400, residents: 12 },
  'house-cheap-2': { footprint: 1, name: 'Timber cabin', group: 'homes', tier: 'Affordable', cost: 1600, residents: 10 },
  'house-cheap-3': { footprint: 1, name: 'Terraced cottage', group: 'homes', tier: 'Affordable', cost: 1800, residents: 16 },
  'house-normal-1': { footprint: 1, name: 'Gabled family home', group: 'homes', tier: 'Comfortable', cost: 3600, residents: 18 },
  'house-normal-2': { footprint: 1, name: 'Brick villa', group: 'homes', tier: 'Comfortable', cost: 4200, residents: 22 },
  'house-normal-3': { footprint: 1, name: 'Garden bungalow', group: 'homes', tier: 'Comfortable', cost: 3800, residents: 16 },
  'house-expensive-1': { footprint: 2, name: 'Country manor', group: 'homes', tier: 'Prestige', cost: 8500, residents: 28 },
  'house-expensive-2': { footprint: 2, name: 'Grand townhouse', group: 'homes', tier: 'Prestige', cost: 9200, residents: 36 },
  'house-expensive-3': { footprint: 2, name: 'Courtyard villa', group: 'homes', tier: 'Prestige', cost: 10500, residents: 30 },
  school: { footprint: 2, name: 'School', group: 'community', cost: 18000 },
  hospital: { footprint: 2, name: 'Hospital', group: 'community', cost: 34000 },
  'police-station': { footprint: 2, name: 'Police station', group: 'community', cost: 18000 },
  'fire-station': { footprint: 2, name: 'Fire station', group: 'community', cost: 22000 },
  stadium: { footprint: 3, name: 'Stadium', group: 'community', cost: 48000 },
  church: { footprint: 2, name: 'Church', group: 'community', cost: 24000 },
  pub: { footprint: 1, name: 'Village pub', group: 'community', cost: 9500 },
  'shop-grocery': { footprint: 1, name: 'Grocer', group: 'shops', cost: 5500 },
  'shop-bakery': { footprint: 1, name: 'Bakery', group: 'shops', cost: 6000 },
  'shop-butcher': { footprint: 1, name: 'Butcher', group: 'shops', cost: 5800 },
  'shop-hardware': { footprint: 1, name: 'Hardware shop', group: 'shops', cost: 6400 },
  'shop-florist': { footprint: 1, name: 'Florist', group: 'shops', cost: 5200 },
  'service-post-office': { footprint: 1, name: 'Post office', group: 'services', cost: 11000 },
  'service-bank': { footprint: 2, name: 'Bank', group: 'services', cost: 16000 },
  'service-hotel': { footprint: 2, name: 'Hotel', group: 'services', cost: 21000 },
  'service-garage': { footprint: 2, name: 'Garage', group: 'services', cost: 9000 },
  'service-barber': { footprint: 1, name: 'Barber', group: 'services', cost: 6500 },
  'park-village': { footprint: 2, name: 'Village green', group: 'community', tier: 'Parks', cost: 6000, amenity: 1.6, naturalCover: .8, buildOnly: true },
  'park-formal': { footprint: 2, name: 'Formal gardens', group: 'community', tier: 'Parks', cost: 10000, amenity: 2.1, naturalCover: .7, buildOnly: true },
  'park-woodland': { footprint: 3, name: 'Woodland park', group: 'community', tier: 'Parks', cost: 14000, amenity: 2.5, naturalCover: 1, buildOnly: true },
  'mall-neighborhood': { footprint: 2, name: 'Neighbourhood shopping centre', group: 'shops', tier: 'Shopping centres', cost: 12000, shopUnits: 4, outlets: { food: 2, household: 2 }, buildOnly: true },
  'mall-shopping': { footprint: 3, name: 'Shopping mall', group: 'shops', tier: 'Shopping centres', cost: 40000, shopUnits: 8, outlets: { food: 4, household: 4 }, buildOnly: true },
  'mall-modern': { footprint: 3, name: 'Modern shopping mall', group: 'shops', tier: 'Shopping centres', cost: 60000, shopUnits: 12, outlets: { food: 6, household: 6 }, buildOnly: true },
};
// New player projects must not alter the original town generator or save recipes.
export const PROCEDURAL_BUILDING_KINDS = Object.keys(BUILDINGS).filter(k => !BUILDINGS[k].buildOnly);
export const RESIDENTIAL_KINDS = PROCEDURAL_BUILDING_KINDS.filter(k => BUILDINGS[k].group === 'homes');
export const SHOP_KINDS = PROCEDURAL_BUILDING_KINDS.filter(k => BUILDINGS[k].group === 'shops');
export const SERVICE_KINDS = PROCEDURAL_BUILDING_KINDS.filter(k => BUILDINGS[k].group === 'services');
export const COMMUNITY_KINDS = PROCEDURAL_BUILDING_KINDS.filter(k => BUILDINGS[k].group === 'community');
export const PARK_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].naturalCover);
export const MALL_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].outlets);
export function residentialKind(variant = 0, level = 1) { return RESIDENTIAL_KINDS[(Math.max(1,Math.min(3,Math.floor(level))) - 1) * 3 + Math.abs(Math.floor(variant)) % 3]; }
export function commercialKind(variant = 0, level = 1) { return (level > 1 ? SERVICE_KINDS : SHOP_KINDS)[Math.abs(Math.floor(variant)) % 5]; }
