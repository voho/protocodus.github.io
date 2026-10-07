import { INDUSTRIES } from './data.js';
import { drawNativeBuilding } from './native-building-art.js';
const farms=new Set(['farm','dairy-farm','vegetable-farm','orchard','livestock-farm']);
export function drawNativeFarmCore(c,kind,r,biome,detail='town',footprint=2){
  return farms.has(kind)?drawNativeBuilding(c,kind,biome,{detail,footprint,industry:true,farmCore:true}):false;
}
export function drawProcessingPlant(c,kind,r,biome,detail='town',footprint=5){
  return Object.hasOwn(INDUSTRIES,kind)?drawNativeBuilding(c,kind,biome,{detail,footprint,industry:true}):false;
}
