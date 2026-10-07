import { BUILDINGS } from './buildings.js';
import { drawNativeBuilding } from './native-building-art.js';

export const TOWN_FEATURE_KINDS = Object.freeze(['park','playground','swimming-pool','sports-field','tennis-courts','ballpark','sports-hall','town-hall','shop-cafe','shop-pharmacy','shop-bookshop']);
export function drawTownFeature(c, kind, biome, detail='town', { footprint }={}) {
  if(!TOWN_FEATURE_KINDS.includes(kind))return false;
  return drawNativeBuilding(c,kind,biome,{detail,footprint:Number.isInteger(footprint)&&footprint>0?footprint:BUILDINGS[kind].footprint});
}
