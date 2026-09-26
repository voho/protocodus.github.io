import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_SIZES } from '../world.js';
import { BUILDINGS } from '../buildings.js';
import { encodeGame, decodeGame } from '../save-codec.js';

const directions = [[1,0],[-1,0],[0,1],[0,-1]];
const tileAt = (game,x,y) => x>=0&&y>=0&&x<game.width&&y<game.height ? game.tiles[y*game.width+x] : null;
const isWater = (game,x,y) => tileAt(game,x,y)?.terrain === 'water';
function flood(game,start,accept=(x,y)=>isWater(game,x,y)) {
  const seen = new Uint8Array(game.tiles.length), queue = new Int32Array(game.tiles.length);
  let head=0,tail=0;
  if(accept(start.x,start.y)){const index=start.y*game.width+start.x;seen[index]=1;queue[tail++]=index;}
  while(head<tail){
    const index=queue[head++],x=index%game.width,y=Math.floor(index/game.width);
    for(const [dx,dy] of directions){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=game.width||ny>=game.height)continue;
      const next=ny*game.width+nx;if(seen[next]||!accept(nx,ny))continue;
      seen[next]=1;queue[tail++]=next;
    }
  }
  return seen;
}
function checkStarterShipping(game) {
  const [first,second]=game.cities;
  const berths=[first,second].map(city=>({x:city.x,y:city.y+5}));
  for(const [i,berth] of berths.entries()){
    const tile=tileAt(game,berth.x,berth.y);
    assert.equal(tile.terrain,'water','a starter port fits inside the town catchment');
    assert.equal(tile.detail,'river');
    assert.equal(Math.hypot(berth.x-game.cities[i].x,berth.y-game.cities[i].y),5);
    assert.ok(directions.some(([dx,dy])=>tileAt(game,berth.x+dx,berth.y+dy)?.terrain!=='water'),'ports have a cardinal land bank');
    for(const flag of ['road','rail','bridge','tunnel','building','zone'])assert.ok(!tile[flag],`starter port plot is clear of ${flag}`);
    assert.ok(!game.industries.some(industry=>industry.x===berth.x&&industry.y===berth.y));
  }
  const reachable=flood(game,berths[0]);
  assert.equal(reachable[berths[1].y*game.width+berths[1].x],1,'both opening towns share a navigable water component');
  // Erode one tile around the shipping channel: a connected remaining center
  // proves that this is a broad river, rather than a one-tile or diagonal cut.
  const centers=berths.map(berth=>({...berth,y:berth.y+1}));
  const clear=(x,y)=>isWater(game,x,y)&&directions.every(([dx,dy])=>isWater(game,x+dx,y+dy));
  const channel=flood(game,centers[0],clear);
  assert.equal(channel[centers[1].y*game.width+centers[1].x],1,'starter shipping has a channel with water clearance on both sides');
  assert.equal(game.stations.length,0,'world generation grants no free port');
  assert.equal(game.vehicles.length,0,'world generation grants no free ship');
  for(let x=first.x;x<=second.x;x++)assert.equal(tileAt(game,x,first.y).road,true,'the original short starter road remains connected');
  assert.equal(second.x-first.x+1,25);
  return reachable;
}

for(const biome of ['taiga','tundra','desert'])for(const size of Object.keys(WORLD_SIZES)){
  test(`${biome} ${size}: rivers connect to sea, towns have ports, and roads preserve water`,()=>{
    const game=generateWorld(biome,19281,size),repeat=generateWorld(biome,19281,size);
    assert.deepEqual(game,repeat,'complete river geography and development are deterministic');
    const reachable=checkStarterShipping(game);
    assert.equal(reachable[(game.height-1)*game.width+game.width-1],1,'starter river reaches the open sea');
    let rivers=0,bridges=0;
    for(const [index,tile] of game.tiles.entries()){
      if(tile.detail==='river'){
        rivers++;
        assert.equal(tile.terrain,'water','town construction cannot turn a river into land');
        assert.equal(reachable[index],1,'every river branch joins the shared sea network');
      }
      if(tile.terrain==='water'){
        assert.equal(tile.building,null,'buildings only occupy land');
        if(tile.road){bridges++;assert.equal(tile.bridge,true,'water crossings use bridges instead of dams');assert.equal(tile.elevation,0);}
      }
    }
    assert.ok(rivers>game.width*3,'the world has a substantial branching river network');
    assert.ok(bridges>0,'generated town streets exercise river crossings');
    for(const industry of game.industries)assert.notEqual(tileAt(game,industry.x,industry.y).terrain,'water');
    assert.ok(game.cities.length>=(size==='huge'?30:size==='large'?16:8));
    assert.deepEqual(new Set(game.tiles.flatMap(tile=>tile.building?[tile.building.kind]:[])),new Set(Object.keys(BUILDINGS)),'the starting towns retain the complete building collection');
    const restored=decodeGame(encodeGame(game));
    assert.deepEqual(restored.tiles,game.tiles,'the existing compact codec preserves river details and bridges losslessly');
  });
}

test('different seeded bends preserve starter shipping opportunities at every map size',()=>{
  for(const seed of [0,1,1847,7193,38723])for(const size of Object.keys(WORLD_SIZES)){
    const game=generateWorld('taiga',seed,size);
    checkStarterShipping(game);
    const reachable=flood(game,{x:game.width-1,y:game.height-1});
    for(const [index,tile] of game.tiles.entries())if(tile.detail==='river')assert.equal(reachable[index],1,`seed ${seed}, ${size}: river is connected to sea`);
  }
});
