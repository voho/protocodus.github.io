import { noise, hashNoise } from './world-noise.js';
import { isPlantDetail, normalizedDetail } from './terrain-sprites.js';

const FLORA = {
  taiga: ['wildflowers','bluebells','grass-tufts','heather','ferns','berry-bushes'],
  tundra: ['arctic-poppies','cotton-grass','heather','tundra-grass','lichen','willow-scrub'],
  desert: ['desert-flowers','dry-grass','scrub','aloe','agave','prickly-pear'],
};
const ROCK_DETAIL = new Set(['glacial','ice','canyon']);

// This is presentation only: old snow/dune detail codes describe a ground
// material, not a boulder on every tile. Saved ecology and resources stay intact.
export function landscapeScenery(biome, seed, x, y, tile) {
  // Bulldozing and earthworks clear detail. Keep those cleared tiles bare.
  if (!['grass','sand','snow'].includes(tile?.terrain)||!tile.detail) return null;
  const detail=normalizedDetail(tile.detail),chance=hashNoise(x,y,seed+3109);
  const patch=noise(x,y,seed+3121,11.7)*.68+noise(x,y,seed+3137,4.3)*.32;
  if (ROCK_DETAIL.has(detail)&&chance<.025) return {kind:'stone',detail,alpha:.30};
  if (detail==='ice'||detail==='glacier'||detail==='saltflat') return null;
  const supplied=isPlantDetail(detail)&&detail!=='deadwood';
  const cover=supplied ? .15+patch*.16 : (biome==='desert'?.06:.09)+Math.max(0,patch-.32)*.32;
  if (chance>=cover*(tile.terrain==='snow'&&!supplied?.7:1)) return null;
  const palette=FLORA[biome]||FLORA.taiga;
  // Favor small blooms and grasses; larger shrubs/succulents are accents.
  const pick=hashNoise(x,y,seed+3163),index=pick<.28?0:pick<.51?1:pick<.73?2:pick<.87?3:pick<.95?4:5;
  // A habitat code describes a region, not an identical patch on every cell.
  // Pale lichen in particular reads like scree at map scale; use it sparingly
  // among smaller blooms and grasses instead of carpeting the tundra with it.
  const keep=supplied&&hashNoise(x,y,seed+3181)<(detail==='lichen'?.10:.38);
  return {kind:'plant',detail:keep?detail:palette[index],alpha:biome==='desert'?.43:.46};
}
