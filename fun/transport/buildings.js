// Shared building identities keep generated towns, player construction and sprites in sync.
export const BUILDING_GROUPS = {
  homes: { name: 'Homes', description: 'Three tiers. Nine distinct places to call home.' },
  community: { name: 'Community', description: 'The landmarks that give a town its character.' },
  shops: { name: 'Shops', description: 'Five small businesses for a lively high street.' },
  services: { name: 'Services', description: 'Everyday services, from a letter to a night away.' },
};
export const BUILDINGS = {
  'house-cheap-1': { name: 'Workers’ cottage', group: 'homes', tier: 'Affordable', cost: 1400, residents: 12 },
  'house-cheap-2': { name: 'Timber cabin', group: 'homes', tier: 'Affordable', cost: 1600, residents: 10 },
  'house-cheap-3': { name: 'Terraced cottage', group: 'homes', tier: 'Affordable', cost: 1800, residents: 16 },
  'house-normal-1': { name: 'Gabled family home', group: 'homes', tier: 'Comfortable', cost: 3600, residents: 18 },
  'house-normal-2': { name: 'Brick villa', group: 'homes', tier: 'Comfortable', cost: 4200, residents: 22 },
  'house-normal-3': { name: 'Garden bungalow', group: 'homes', tier: 'Comfortable', cost: 3800, residents: 16 },
  'house-expensive-1': { name: 'Country manor', group: 'homes', tier: 'Prestige', cost: 8500, residents: 28 },
  'house-expensive-2': { name: 'Grand townhouse', group: 'homes', tier: 'Prestige', cost: 9200, residents: 36 },
  'house-expensive-3': { name: 'Courtyard villa', group: 'homes', tier: 'Prestige', cost: 10500, residents: 30 },
  school: { name: 'School', group: 'community', cost: 18000 },
  hospital: { name: 'Hospital', group: 'community', cost: 34000 },
  'police-station': { name: 'Police station', group: 'community', cost: 18000 },
  'fire-station': { name: 'Fire station', group: 'community', cost: 22000 },
  stadium: { name: 'Stadium', group: 'community', cost: 48000 },
  church: { name: 'Church', group: 'community', cost: 24000 },
  pub: { name: 'Village pub', group: 'community', cost: 9500 },
  'shop-grocery': { name: 'Grocer', group: 'shops', cost: 5500 },
  'shop-bakery': { name: 'Bakery', group: 'shops', cost: 6000 },
  'shop-butcher': { name: 'Butcher', group: 'shops', cost: 5800 },
  'shop-hardware': { name: 'Hardware shop', group: 'shops', cost: 6400 },
  'shop-florist': { name: 'Florist', group: 'shops', cost: 5200 },
  'service-post-office': { name: 'Post office', group: 'services', cost: 11000 },
  'service-bank': { name: 'Bank', group: 'services', cost: 16000 },
  'service-hotel': { name: 'Hotel', group: 'services', cost: 21000 },
  'service-garage': { name: 'Garage', group: 'services', cost: 9000 },
  'service-barber': { name: 'Barber', group: 'services', cost: 6500 },
};
export const RESIDENTIAL_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].group === 'homes');
export const SHOP_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].group === 'shops');
export const SERVICE_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].group === 'services');
export const COMMUNITY_KINDS = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].group === 'community');
export function residentialKind(variant = 0, level = 1) { return RESIDENTIAL_KINDS[(Math.max(1,Math.min(3,Math.floor(level))) - 1) * 3 + Math.abs(Math.floor(variant)) % 3]; }
export function commercialKind(variant = 0, level = 1) { return (level > 1 ? SERVICE_KINDS : SHOP_KINDS)[Math.abs(Math.floor(variant)) % 5]; }
