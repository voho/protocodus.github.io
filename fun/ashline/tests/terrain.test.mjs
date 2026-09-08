import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,MAP_WIDTH,MAP_HEIGHT,MAP_SIZES,MAP_PROFILES,mapLayout} from '../sim.js';

const open=type=>type===0||type===2||type===5;
function verifyMap(s){
  const n=s.width*s.height;
  assert.equal(s.terrain.length,n);
  assert.equal(s.minerals.length,n);
  assert.equal(s.mineralTypes.length,n);
  const scout=s.entities.find(e=>e.team===0&&e.type==='scout');
  const main=s.regions[Math.floor(scout.y)*s.width+Math.floor(scout.x)];
  assert.ok(main,'starting scout has reachable ground');
  const enemy=s.entities.find(e=>e.team===1&&e.type==='scout');
  assert.equal(s.regions[Math.floor(enemy.y)*s.width+Math.floor(enemy.x)],main,'both bases share a reachable region');
  for(const e of s.entities.filter(e=>e.team===0&&e.kind==='building')){
    assert.ok(s.entities.some(other=>other.team===1&&other.type===e.type&&other.x===s.width-e.x-e.size&&other.y===s.height-e.y-e.size),'starting structures have exactly mirrored footprints');
    for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)assert.equal(s.minerals[y*s.width+x],0,'starting footprints contain no minerals');
  }
  const types=new Set();
  for(let i=0;i<n;i++){
    assert.equal(s.terrain[i],s.terrain[n-1-i],`terrain mirror at ${i}`);
    assert.equal(s.minerals[i],s.minerals[n-1-i],`mineral reserve mirror at ${i}`);
    assert.equal(s.mineralTypes[i],s.mineralTypes[n-1-i],`mineral type mirror at ${i}`);
    if(s.minerals[i]>0){
      types.add(s.mineralTypes[i]);
      assert.ok(open(s.terrain[i]),`resource ${i} is on accessible ground`);
      assert.equal(s.regions[i],main,`resource ${i} is reachable from the bases`);
      const density=s.mineralTypes[i]===3?2:1;
      assert.ok(s.minerals[i]>=320*density&&s.minerals[i]<620*density,'red deposits contain twice the standard reserve range');
      if(density===2)assert.equal(s.minerals[i]%2,0,'red reserve doubles the base integer amount');
    }
  }
  assert.deepEqual([...types].sort(),[1,2,3],'all mineral materials have deposits');
  for(let id=1;id<s.regionSize.length;id++)if(id!==main)assert.ok(s.regionSize[id]<30,`no sealed pocket of ${s.regionSize[id]} tiles`);
  const {start,end,bend}=mapLayout(s);
  for(const direction of [-1,0,1])for(let j=12;j<=88;j++){
    const t=j/100,x=start.x+(end.x-start.x)*t,y=start.y+(end.y-start.y)*t+Math.sin(t*Math.PI)*bend*direction;
    for(const ox of [-.75,.75])for(const oy of [-.75,.75])assert.ok(open(s.terrain[Math.floor(y+oy)*s.width+Math.floor(x+ox)]),'each approach has vehicle clearance');
  }
}

test('new operations default to the larger frontier and validate map options',()=>{
  const s=createGame('DEFAULT');
  assert.equal(s.width,192);assert.equal(s.height,144);
  assert.equal(s.width,MAP_WIDTH);assert.equal(s.height,MAP_HEIGHT);
  assert.equal(s.mapProfile,'rift');
  assert.throws(()=>createGame('BAD','normal',{width:200,height:144}),RangeError);
  assert.throws(()=>createGame('BAD','normal',{profile:'unknown'}),RangeError);
});

for(const [size,dimensions] of Object.entries(MAP_SIZES))for(const profile of Object.keys(MAP_PROFILES)){
  test(`${size} / ${profile}: balanced routes, resources and terrain across six seeds`,()=>{
    for(const seed of ['ASH-001','CINDER-019','LONG-NIGHT','A','0','map-dimensions'])verifyMap(createGame(seed,'normal',{...dimensions,profile}));
  });
}

test('seeded generation is repeatable and independent of difficulty',()=>{
  const a=createGame('REPEAT','easy',{profile:'highlands'}),b=createGame('REPEAT','hard',{profile:'highlands'});
  assert.deepEqual(a.terrain,b.terrain);assert.deepEqual(a.minerals,b.minerals);assert.deepEqual(a.mineralTypes,b.mineralTypes);
  const c=createGame('DIFFERENT','easy',{profile:'highlands'});
  assert.notDeepEqual(a.terrain,c.terrain);
});

test('profiles change terrain structure and preserve the same starting resource budget',()=>{
  const maps=Object.keys(MAP_PROFILES).map(profile=>createGame('PROFILE-CHECK','normal',{profile}));
  const [rift,basin,highlands]=maps;
  const count=(s,type)=>s.terrain.filter(t=>t===type).length;
  assert.ok(count(basin,2)>count(rift,2)*1.5,'basin has substantially more basalt');
  assert.ok(count(highlands,1)>count(basin,1)*1.25,'highlands has substantially more raised rock');
  assert.ok(count(rift,3)>count(basin,3),'rift has more lava');
  const mint=s=>s.minerals.reduce((sum,amount,i)=>sum+(s.mineralTypes[i]===1?amount:0),0);
  assert.equal(mint(rift),mint(basin));assert.equal(mint(rift),mint(highlands));
});

test('original compact dimensions remain available for compatibility',()=>{
  const s=createGame('LEGACY','normal',{width:72,height:56});
  assert.equal(s.terrain.length,4032);
  assert.deepEqual(mapLayout(s),{start:{x:12,y:37},end:{x:59,y:12},bend:10});
  assert.ok(s.entities.every(e=>e.x>=0&&e.y>=0&&e.x<s.width&&e.y<s.height));
});
