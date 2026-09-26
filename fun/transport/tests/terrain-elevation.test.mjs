import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainLevel,terrainElevation,sampleTerrainHeight,terrainReliefRaster} from '../terrain-elevation.js';

const world=(level=4)=>({width:20,height:16,biome:'taiga',seed:418,tiles:Array.from({length:320},()=>({terrain:'grass',elevation:level/16}))});
const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test('saved elevation defines bounded levels and flat land has no artificial slopes',()=>{
  const game=world(6);
  assert.equal(terrainLevel({terrain:'water',elevation:.9}),0);
  assert.equal(terrainLevel({elevation:2}),16);
  assert.equal(terrainLevel({elevation:-2}),0);
  for(const [x,y]of[[.01,.01],[2.2,5.9],[19.99,15.99],[5.5,5.5]]){
    const h=sampleTerrainHeight(game,x,y);near(h.height,6);near(h.dx,0);near(h.dy,0);
  }
});
test('a tile one level up forms a smooth hill through its neighboring tiles',()=>{
  const game=world();game.tiles[8*20+8].elevation=5/16;
  const center=sampleTerrainHeight(game,8.5,8.5),left=sampleTerrainHeight(game,7.5,8.5),right=sampleTerrainHeight(game,9.5,8.5);
  assert.ok(center.height>left.height&&left.height>4);near(left.height,right.height);
  assert.ok(left.dx>0&&right.dx<0);near(center.dx,0);near(center.dy,0);
  near(sampleTerrainHeight(game,5.5,8.5).height,4);
});
test('mixed levels have continuous height and slope across interpolation seams',()=>{
  const game=world();for(let y=0;y<16;y++)for(let x=0;x<20;x++)game.tiles[y*20+x].elevation=((x*3+y*7)%16)/16;
  for(const x of [1.5,7.5,8.5,16.5]){
    const a=sampleTerrainHeight(game,x-1e-7,8.37),b=sampleTerrainHeight(game,x+1e-7,8.37);
    near(a.height,b.height,1e-5);near(a.dx,b.dx,1e-5);near(a.dy,b.dy,1e-5);
  }
  for(let x=0;x<20;x+=.2){const h=sampleTerrainHeight(game,x,7.1);assert.ok(h.height>=0&&h.height<=16);}
});
test('separately cached ground chunks contain identical pixels in their overlap',()=>{
  const game=world();for(let y=0;y<16;y++)for(let x=0;x<20;x++)game.tiles[y*20+x].elevation=(x+y)/40;
  const a=terrainReliefRaster(game,{x0:0,y0:0,x1:12,y1:12}),b=terrainReliefRaster(game,{x0:6,y0:4,x1:18,y1:16});
  for(let y=0;y<8*6;y++)for(let x=0;x<6*6;x++){
    const ai=((y+4*6)*a.width+x+6*6)*4,bi=(y*b.width+x)*4;
    assert.deepEqual(a.pixels.slice(ai,ai+4),b.pixels.slice(bi,bi+4));
  }
});
test('terrain rendering is deterministic, bounded to a chunk and leaves saved state untouched',()=>{
  for(const biome of ['taiga','tundra','desert']){
    const game=world();game.biome=biome;game.tiles[8*20+8].elevation=.8;
    const before=JSON.stringify(game),bounds={x0:4,y0:4,x1:12,y1:12};
    const a=terrainReliefRaster(game,bounds),b=terrainReliefRaster(game,bounds);
    assert.deepEqual(a,b);assert.equal(a.width,48);assert.equal(a.height,48);assert.equal(a.pixels.length,48*48*4);
    assert.equal(JSON.stringify(game),before);
    assert.ok(a.pixels.every((value,index)=>index%4!==3||value===255));
  }
});

test('natural fractional elevations form an even hillside without integer-level terraces',()=>{
  const game=world();
  for(let y=0;y<game.height;y++)for(let x=0;x<game.width;x++)game.tiles[y*game.width+x].elevation=(4+x*.075)/16;
  assert.equal(terrainLevel(game.tiles[5]),4);
  near(terrainElevation(game.tiles[5]),4.375);
  for(let x=3;x<17;x+=.125){
    const h=sampleTerrainHeight(game,x+.5,8.5);
    near(h.height,4+x*.075);near(h.dx,.075);near(h.dy,0);
  }
});
