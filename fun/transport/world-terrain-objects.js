import { seedNumber, hashNoise } from './world-noise.js';
import { buildingTiles } from './building-sites.js';
import { industryTiles } from './industry-sites.js';
import { terrainObjectGroundIsFlat, terrainObjectTiles } from './terrain-objects.js';
import { groundIsFlat } from './terrain-geometry.js';
import { stationTiles } from './station-sites.js';

const KINDS = new Set(['forest', 'rock', 'mountain']);

// Recipe 6 groups existing, genuinely level land into occasional mature
// terrain objects. A temporary byte mask bounds allocation on continental maps;
// child tiles retain their original terrain and are never duplicated in saves.
export function allocateTerrainObjects(game,{largeLandforms=game.generationVersion>=11}={}) {
  const reserved = new Uint8Array(game.tiles.length), seed = seedNumber(game.seed ?? 0) ^ 0x5e6e8b91;
  const mark = points => { for (const p of points) reserved[p.y * game.width + p.x] = 1; };
  for (let index = 0; index < game.tiles.length; index++) {
    const tile = game.tiles[index], x = index % game.width, y = Math.floor(index / game.width);
    if (tile.road || tile.rail || tile.bridge || tile.tunnel || tile.zone) reserved[index] = 1;
    if (tile.building) mark(buildingTiles({ x, y, building: tile.building }));
    if (tile.terrainObject) mark(terrainObjectTiles({ x, y, object: tile.terrainObject }));
  }
  for (const site of game.industries || []) mark(industryTiles(site));
  for(const station of game.stations||[])mark(stationTiles(station));
  mark([...(game.cities || []), ...(game.zones || [])]);
  const fits = (x, y, size, kind) => {
    // A complete one-tile collar is needed to keep the large sprite off slopes.
    if (x < 1 || y < 1 || x + size >= game.width || y + size >= game.height) return false;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const index = (y + dy) * game.width + x + dx;
      if (reserved[index] || game.tiles[index].terrain !== kind) return false;
    }
    return terrainObjectGroundIsFlat(game, x, y, size);
  };
  // Recipe 11 reserves the rarest, widest landforms first. A full dry, level
  // collar and the actual displayed vertices must agree, so a glacier never
  // bridges a hillside or floats above a valley. No ground height is changed.
  // Smaller formations remain more frequent; forests retain recipe 6 sizes.
  if(largeLandforms)for(const size of [6,5,4,3]){
    const chance={3:.12,4:.10,5:.08,6:.06}[size];
    for(let index=0;index<game.tiles.length;index++){
      const tile=game.tiles[index];
      if(reserved[index]||!['mountain','rock'].includes(tile.terrain))continue;
      const x=index%game.width,y=Math.floor(index/game.width);
      if(hashNoise(x,y,seed^(0x1f123bb5+size*7919))>=chance||!fits(x,y,size,tile.terrain)||!groundIsFlat(game,x,y,size))continue;
      const object={kind:tile.terrain,detail:tile.detail||'',variant:tile.variant||0,footprint:size};
      tile.terrainObject=object;mark(terrainObjectTiles({x,y,object}));
    }
  }
  for (let index = 0; index < game.tiles.length; index++) {
    const tile = game.tiles[index];
    if (reserved[index] || !KINDS.has(tile.terrain) || tile.detail === 'deadwood'||largeLandforms&&tile.terrain!=='forest') continue;
    const x = index % game.width, y = Math.floor(index / game.width), roll = hashNoise(x, y, seed);
    // Independently scattered candidates leave most nature at its small size;
    // suitability follows the continuous landscape, never a placement lattice.
    const chance = tile.terrain === 'forest' ? .045 : tile.terrain === 'rock' ? .035 : .055;
    if (roll >= chance) continue;
    let size = hashNoise(x, y, seed ^ 0x743af281) < .25 ? 3 : 2;
    if (!fits(x, y, size, tile.terrain)) {
      if (size !== 3 || !fits(x, y, 2, tile.terrain)) continue;
      size = 2;
    }
    const object = { kind: tile.terrain, detail: tile.detail || '', variant: tile.variant || 0, footprint: size };
    tile.terrainObject = object;
    mark(terrainObjectTiles({ x, y, object }));
  }
  game.terrainObjectVersion = 1;
  return game;
}
