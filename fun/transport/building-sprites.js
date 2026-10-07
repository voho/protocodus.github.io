import { BUILDINGS, LEGACY_BUILDING_KINDS } from './buildings.js';
import { drawNativeBuilding } from './native-building-art.js';

export const NATIVE_TOWN_BUILDING_KINDS = Object.freeze([...LEGACY_BUILDING_KINDS, ...Object.keys(BUILDINGS).filter(kind => BUILDINGS[kind].buildOnly)]);
export function drawTownBuilding(c, kind, biome, detail='town', variant=0, { footprint }={}) {
  if(!NATIVE_TOWN_BUILDING_KINDS.includes(kind))return false;
  return drawNativeBuilding(c,kind,biome,{detail,variant,footprint:Number.isInteger(footprint)&&footprint>0?footprint:BUILDINGS[kind].footprint});
}
