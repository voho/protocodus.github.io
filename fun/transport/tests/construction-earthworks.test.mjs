import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planNetworkConstruction,earthworksView} from '../construction-earthworks.js';
import {networkTerrainPlanProblem,planStructureSpan,networkEdgeAllowed} from '../terrain-engineering.js';
import {surfaceHeight} from '../terrain-geometry.js';

function world(width=40,height=40,level=2){return{width,height,revision:0,networkRevision:0,biome:'taiga',cities:[],industries:[],stations:[],tiles:Array.from({length:width*height},()=>({terrain:'grass',elevation:level/7,detail:'',road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null}))};}
const tile=(game,x,y)=>game.tiles[y*game.width+x];
const line=(x0,x1,y)=>Array.from({length:x1-x0+1},(_,i)=>({x:x0+i,y}));
function assertPlan(game,plan){
  assert.equal(plan.ok,true,plan.message);const view=earthworksView(game,plan.terrain);
  assert.equal(networkTerrainPlanProblem(view,plan.placements),null);
  for(const p of plan.terrain){assert.equal(surfaceHeight(view,p.x,p.y),p.level);assert.equal(p.steps,Math.abs(surfaceHeight(game,p.x,p.y)-p.level));}
  return view;
}

test('legal roads and straight grades require no ground changes and previews are read-only',()=>{
  for(const mode of ['road','rail']){
    const game=world(),points=line(10,20,20),before=structuredClone(game),plan=planNetworkConstruction(game,mode,points);
    assertPlan(game,plan);assert.deepEqual(plan.terrain,[]);assert.deepEqual(game,before);
    assert.equal(planNetworkConstruction(game,mode,points),plan,'repeat pointer previews reuse the same pure geometry');
    game.revision++;assert.notEqual(planNetworkConstruction(game,mode,points),plan);
  }
});

test('a corner slope is prepared by the cheapest local visible earthwork for road and rail',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y']){
    const game=world();tile(game,12,12).elevation=3/7;
    const points=axis==='x'?line(10,14,12):Array.from({length:5},(_,i)=>({x:12,y:10+i})),before=structuredClone(game);
    const plan=planNetworkConstruction(game,mode,points);assertPlan(game,plan);
    assert.deepEqual(plan.terrain,[{x:12,y:12,level:2,steps:1}]);assert.deepEqual(game,before);
    assert.ok(plan.affected.some(p=>p.x===11&&p.y===11),'the undo/release collar includes adjoining cells');
  }
});

test('a turn across a side grade is automatically flattened without changing a legal straight grade',()=>{
  const game=world();for(let y=0;y<40;y++)for(let x=20;x<40;x++)tile(game,x,y).elevation=3/7;
  const straight=planNetworkConstruction(game,'road',line(16,23,20));assertPlan(game,straight);assert.equal(straight.terrain.length,0);
  const turn=[...line(16,19,20),{x:19,y:21},{x:19,y:22}];
  const plan=planNetworkConstruction(game,'road',turn);assertPlan(game,plan);assert.ok(plan.terrain.length>0);
});

test('water and occupied shared corners are never moved by automatic preparation',()=>{
  for(const kind of ['road','rail','zone','building','station','industry','city','water']){
    const game=world();tile(game,12,12).elevation=3/7;
    // Protect the raised corner and the three alternative corners, leaving no
    // permissible flat target for the requested cell.
    for(const [x,y] of [[11,11],[13,11],[13,13],[11,13]]){
      if(kind==='zone')tile(game,x,y).zone='residential';
      else if(kind==='building')tile(game,x,y).building={kind:'house-cheap-1',level:1};
      else if(kind==='station')game.stations.push({id:`${x},${y}`,x,y,mode:'road'});
      else if(kind==='industry')game.industries.push({id:`${x},${y}`,kind:'farm',x,y,footprint:1});
      else if(kind==='city')game.cities.push({id:`${x},${y}`,x,y});
      else if(kind==='water'){tile(game,x,y).terrain='water';tile(game,x,y).elevation=0;}
      else tile(game,x,y)[kind]=true;
    }
    const before=structuredClone(game),plan=planNetworkConstruction(game,'road',[{x:12,y:12}]);
    // A fully flattened water collar may make the cell legal without changes.
    if(plan.ok)assert.equal(plan.terrain.length,0);else assert.deepEqual(plan.terrain,[]);
    assert.deepEqual(game,before,kind);
  }
});

test('mixed road and rail strokes retain water bridges and mountain tunnels while preparing land',()=>{
  for(const mode of ['road','rail']){
    const game=world();tile(game,12,20).elevation=3/7;
    for(let y=0;y<40;y++)for(let x=16;x<=18;x++)Object.assign(tile(game,x,y),{terrain:'water',elevation:0});
    for(let y=0;y<40;y++)for(let x=22;x<=24;x++)Object.assign(tile(game,x,y),{terrain:'mountain',elevation:5/7});
    const plan=planNetworkConstruction(game,mode,line(10,26,20));assertPlan(game,plan);
    assert.ok(plan.terrain.length>0);assert.equal(plan.placements.find(p=>p.x===17).tool,mode==='rail'?'railbridge':'bridge');assert.equal(plan.placements.find(p=>p.x===22).tool,mode==='rail'?'railtunnel':'tunnel');
    for(const p of plan.terrain)assert.notEqual(tile(game,p.x,p.y).terrain,'water');
  }
});

test('explicit spans prepare unequal banks and portals using one shared engineering height',()=>{
  for(const tool of ['bridge','railbridge','tunnel','railtunnel'])for(const axis of ['x','y']){
    const game=world(),bridge=tool.endsWith('bridge'),at=(along,across=20)=>axis==='x'?{x:along,y:across}:{x:across,y:along},points=Array.from({length:7},(_,i)=>at(10+i));
    for(let along=12;along<=15;along++)for(let across=17;across<=23;across++){const p=at(along,across);tile(game,p.x,p.y).elevation=(bridge?1:4)/7;}
    for(let along=16;along<=18;along++)for(let across=17;across<=23;across++){const p=at(along,across);tile(game,p.x,p.y).elevation=3/7;}
    const before=structuredClone(game),plan=planNetworkConstruction(game,tool,points),view=assertPlan(game,plan);
    assert.ok(plan.terrain.length>0,tool);assert.equal(planStructureSpan(view,tool,points,{engineeredBanks:true}).ok,true);
    assert.equal(new Set(plan.placements.map(p=>p.level)).size,1);assert.deepEqual(game,before);
  }
});

test('bridges can meet straight shoreline banks without moving the river',()=>{
  const game=world(),points=line(15,19,20);
  for(let y=0;y<40;y++)for(let x=16;x<=18;x++)Object.assign(tile(game,x,y),{terrain:'water',elevation:0});
  const before=structuredClone(game),plan=planNetworkConstruction(game,'bridge',points);
  assertPlan(game,plan);assert.equal(plan.height,1);assert.equal(plan.terrain.length,0);assert.deepEqual(game,before);
  const committed=structuredClone(game);
  for(const p of plan.placements)Object.assign(tile(committed,p.x,p.y),{road:true,...p.interior?{bridge:true,structureAxis:p.axis,structureLevel:p.level}:{}});
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];assert.equal(networkEdgeAllowed(tile(committed,a.x,a.y),tile(committed,b.x,b.y),b.x-a.x,b.y-a.y,'road',committed,a.x,a.y),true,'the engineered shore bank actually connects to the deck');
  }
});

test('a mountain cut resolves to ordinary road on the exact prepared terrain',()=>{
  const game=world();Object.assign(tile(game,22,20),{terrain:'mountain',elevation:5/7});
  const plan=planNetworkConstruction(game,'road',line(20,24,20)),view=assertPlan(game,plan);
  assert.equal(tile(view,22,20).terrain,'grass');assert.equal(plan.placements.find(p=>p.x===22).tool,'road');
});

test('a long drag batches independent crowns into one bounded cold preview',()=>{
  const length=192,game=world(length+20,40),original=game.tiles;let reads=0;
  for(let x=12;x<length+10;x+=3)tile(game,x,20).elevation=3/7;
  game.tiles=new Proxy(original,{get:(tiles,key)=>{if(/^\d+$/.test(String(key)))reads++;return Reflect.get(tiles,key);}});
  const start=performance.now(),plan=planNetworkConstruction(game,'road',line(10,length+9,20)),elapsed=performance.now()-start;
  assert.equal(plan.ok,true,plan.message);assert.equal(plan.terrain.length,64);assert.equal(plan.terrain.reduce((sum,p)=>sum+p.steps,0),64);
  assert.ok(reads<150000,`one local combined terrain view reads ${reads} tiles`);
  assert.ok(elapsed<150,`a cold192-tile preview took ${elapsed.toFixed(1)}ms`);
});

test('a protected final bump refuses a long drag before preparing all earlier bumps',()=>{
  const length=192,game=world(length+20,40);let last=0;
  for(let x=12;x<length+10;x+=3){tile(game,x,20).elevation=3/7;last=x;}
  tile(game,last-1,19).building={kind:'house-cheap-1',level:1,footprint:1};
  const before=structuredClone(game),start=performance.now(),plan=planNetworkConstruction(game,'road',line(10,length+9,20)),elapsed=performance.now()-start;
  assert.equal(plan.ok,false);assert.deepEqual(plan.terrain,[]);assert.deepEqual(game,before);
  assert.ok(elapsed<100,`a protected cold192-tile preview took ${elapsed.toFixed(1)}ms`);
});

test('large worlds use sparse local views and keep all changed visible vertices explicit',()=>{
  let reads=0;const width=2048,height=2048,base={terrain:'grass',elevation:2/7,detail:'',road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null};
  const tiles=new Proxy({length:width*height},{get:(array,key)=>/^\d+$/.test(String(key))?(reads++,Number(key)===1024*width+1024?{...base,elevation:3/7}:base):Reflect.get(array,key)});
  const game={width,height,tiles,revision:0,networkRevision:0,biome:'taiga',cities:[],industries:[],stations:[]};
  const plan=planNetworkConstruction(game,'road',line(1022,1026,1024));assertPlan(game,plan);
  assert.equal(plan.terrain.length,1);assert.ok(reads<100000,`local planning read ${reads} source tiles`);
});
