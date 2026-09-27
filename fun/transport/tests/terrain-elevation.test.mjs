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
  for(const biome of ['taiga','tundra','desert'])for(const lighting of [false,true]){
    const game=world();game.biome=biome;
    for(let y=0;y<16;y++)for(let x=0;x<20;x++)Object.assign(game.tiles[y*20+x],{elevation:(x+y)/40,terrain:['grass','forest','sand','snow','rock','mountain'][Math.floor(x/3)%6]});
    const a=terrainReliefRaster(game,{x0:0,y0:0,x1:12,y1:12},6,{lighting}),b=terrainReliefRaster(game,{x0:6,y0:4,x1:18,y1:16},6,{lighting});
    for(let y=0;y<8*6;y++)for(let x=0;x<6*6;x++){
      const ai=((y+4*6)*a.width+x+6*6)*4,bi=(y*b.width+x)*4;
      assert.deepEqual(a.pixels.slice(ai,ai+4),b.pixels.slice(bi,bi+4),`${biome} mixed materials share exact seam pixels`);
    }
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

test('biome materials retain natural color separation and subtle nonrepeating ground variation',()=>{
  const sample=(biome,terrain,elevation=.4)=>{
    const game=world();game.biome=biome;for(const t of game.tiles)Object.assign(t,{terrain,elevation});
    const raster=terrainReliefRaster(game,{x0:2,y0:2,x1:18,y1:14},6,{lighting:false}),mean=[0,0,0],colors=new Set();let lo=255,hi=0;
    for(let i=0;i<raster.pixels.length;i+=4){for(let c=0;c<3;c++)mean[c]+=raster.pixels[i+c];lo=Math.min(lo,raster.pixels[i+1]);hi=Math.max(hi,raster.pixels[i+1]);colors.add(raster.pixels.slice(i,i+3).join(','));}
    return{mean:mean.map(v=>v/(raster.pixels.length/4)),range:hi-lo,colors:colors.size};
  };
  const grass=sample('taiga','grass'),sand=sample('desert','sand'),moss=sample('tundra','grass'),snow=sample('tundra','snow'),summit=sample('tundra','mountain',.95);
  assert.ok(grass.mean[1]>grass.mean[0]+12&&grass.mean[1]>grass.mean[2]+25,'grass keeps green and earthy tones');
  assert.ok(sand.mean[0]>sand.mean[1]+18&&sand.mean[1]>sand.mean[2]+30,'sand reads as warm mineral ground');
  assert.ok(snow.mean[1]>moss.mean[1]+35,'tundra moss and snow remain distinct');
  assert.ok(summit.mean[1]>=snow.mean[1],'high tundra summits carry snow instead of bare dark caps');
  for(const material of[grass,sand,moss,snow]){assert.ok(material.colors>50,'world-space patches provide many subtle tones');assert.ok(material.range>=10&&material.range<65,'grain stays restrained enough for sprites and slope lighting');}
});

test('mesh albedo skips legacy smooth illumination while retaining the same materials',()=>{
  const flat=world(6),bounds={x0:2,y0:2,x1:18,y1:14};
  assert.deepEqual(terrainReliefRaster(flat,bounds),terrainReliefRaster(flat,bounds,6,{lighting:false}));
  const hill=world();for(let y=0;y<hill.height;y++)for(let x=0;x<hill.width;x++)hill.tiles[y*hill.width+x].elevation=(3+x*.45)/16;
  const unlit=terrainReliefRaster(hill,bounds,6,{lighting:false}),lit=terrainReliefRaster(hill,bounds);
  assert.notDeepEqual(unlit.pixels,lit.pixels,'the projected mesh receives albedo without a second smooth slope shadow');
  assert.deepEqual(unlit,terrainReliefRaster(hill,bounds,6,{lighting:false}));
});

test('material raster cost reads only a local collar on a 2048-square world',()=>{
  let reads=0;const source=Object.freeze({terrain:'grass',elevation:.4}),tiles=new Proxy({length:2048*2048},{get(target,key){if(/^\d+$/.test(String(key))){reads++;return source;}return Reflect.get(target,key);}});
  const game={width:2048,height:2048,biome:'taiga',seed:418,tiles},raster=terrainReliefRaster(game,{x0:1020,y0:1020,x1:1028,y1:1028},6,{lighting:false});
  assert.equal(raster.width,48);assert.equal(raster.height,48);assert.ok(reads>=64&&reads<=256,`bounded source reads: ${reads}`);
});
