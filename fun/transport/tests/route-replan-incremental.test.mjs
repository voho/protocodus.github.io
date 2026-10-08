import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildStructureSpan, invalidateNetworkPoints, refreshRouteConnections, removeRoute, restoreGame, tick } from '../model.js';
import { buildPlan } from '../construction-plan.js';
import { captureUndo, finishUndo, canUndo, undoConstruction } from '../construction-undo.js';
import { networkChangesSince, setNetworkJournalEnabled } from '../network-index.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

const list=changes=>changes&&[...changes];
const town=(game,x,y)=>game.cities.push({id:`city-t${x}-${y}`,name:`Testford ${x}-${y}`,x,y,population:400,activity:20,growth:0,passengers:300,delivered:0,supplies:0,lastServiceDay:null});
const stopAt=(game,x,y)=>game.stations.find(stop=>stop.x===x&&stop.y===y);
const route=(game,mode,a,b)=>{const result=addRoute(game,{mode,stops:[stopAt(game,...a).id,stopAt(game,...b).id],cargo:'passengers'});assert.equal(result.ok,true,result.message);return result.route;};

test('the network journal answers the cells of contiguous model-owned revisions only',()=>{
  const game=emptyGame(),base=game.networkRevision,w=game.width;
  assert.deepEqual(list(networkChangesSince(game,base)),[],'an unchanged revision needs no work');
  assert.equal(networkChangesSince(game,base-1),null,'the fixture set this revision directly');
  build(game,'road',10,10);build(game,'road',11,10);
  assert.deepEqual(list(networkChangesSince(game,base)),[10*w+10,10*w+11]);
  assert.deepEqual(list(networkChangesSince(game,base+1)),[10*w+11]);
  for(const revision of [undefined,-1,base+3,1.5])assert.equal(networkChangesSince(game,revision),null,String(revision));
  game.networkRevision++;build(game,'road',12,10);
  assert.equal(networkChangesSince(game,base),null,'no entry covers a revision set outside invalidateNetwork');
  assert.deepEqual(list(networkChangesSince(game,base+3)),[10*w+12]);
  const loaded=restoreGame(structuredClone(game));assert.ok(loaded);
  assert.equal(networkChangesSince(loaded,loaded.networkRevision-1),null,'a restored company starts without history');
  game.tiles=game.tiles.map(tile=>({...tile}));
  assert.equal(networkChangesSince(game,base+3),null,'replaced tiles forget the journal');
  invalidateNetworkPoints(game,[{x:1,y:1}]);const after=game.networkRevision;
  invalidateNetworkPoints(game,null);
  assert.equal(networkChangesSince(game,after-1),null,'an edit without points ends the known history');
  setNetworkJournalEnabled(false);
  try{assert.equal(networkChangesSince(game,game.networkRevision-1),null);}finally{setNetworkJournalEnabled(true);}
});

test('overflowing the network journal by entries or by cells drops the oldest coverage',()=>{
  const game=emptyGame(),base=game.networkRevision;
  for(let n=0;n<65;n++)invalidateNetworkPoints(game,[{x:n,y:3}]);
  assert.equal(networkChangesSince(game,base),null,'65 edits exceed the 64-entry ring');
  assert.equal(networkChangesSince(game,base+1).length,64);
  const busy=emptyGame(),start=busy.networkRevision,wide=Array.from({length:9000},(_,n)=>({x:n%busy.width,y:Math.floor(n/busy.width)}));
  invalidateNetworkPoints(busy,wide);invalidateNetworkPoints(busy,wide);
  assert.equal(networkChangesSince(busy,start),null,'18,000 cells exceed the 16,384-cell budget');
  assert.equal(networkChangesSince(busy,start+1).length,9000);
});

test('a distant edit keeps a live route and its vehicles untouched; a near one replans it',()=>{
  const game=emptyGame();
  for(const [x,y] of [[20,24],[46,24]])town(game,x,y);
  for(const {x,y} of line(20,46,20))Object.assign(tileAt(game,x,y),{road:true});
  game.networkRevision++;
  for(const x of [20,46])assert.equal(build(game,'bus-stop',x,20).ok,true);
  const service=route(game,'road',[20,20],[46,20]),path=service.path;tick(game,.3);
  const vehicles=structuredClone(game.vehicles),notices=game.notifications.length;
  assert.equal(build(game,'road',80,60).ok,true);refreshRouteConnections(game);
  assert.equal(service.path,path,'the path is kept, not searched again');assert.equal(service.pathRevision,game.networkRevision);
  assert.deepEqual(game.vehicles,vehicles);assert.equal(game.notifications.length,notices);
  assert.equal(build(game,'road',18,20).ok,true);refreshRouteConnections(game);
  assert.equal(service.path,path,'two tiles behind the first stop is still out of reach');
  assert.equal(build(game,'road',33,21).ok,true);refreshRouteConnections(game);
  assert.notEqual(service.path,path,'a tile beside the path is searched again');assert.deepEqual(service.path,path);
  assert.equal(build(game,'bulldoze',33,20).ok,true);refreshRouteConnections(game);
  assert.equal(service.active,false);const broken=service.path;
  assert.equal(build(game,'road',90,70).ok,true);refreshRouteConnections(game);
  assert.equal(service.active,false,'a disconnected route is always searched again');assert.equal(service.path,broken);
  assert.equal(build(game,'road',33,20).ok,true);refreshRouteConnections(game);
  assert.equal(service.active,true);assert.equal(service.status,'Running');
});

// Two identical companies: one skips unaffected routes, its twin searches every route after every edit.
function world(){
  const game=emptyGame();game.money=1e9;
  for(const tile of game.tiles)tile.elevation=2/7;
  const set=(x,y,props)=>Object.assign(tileAt(game,x,y),props);
  // A river valley splits the road grid; spans cross it on two rows.
  const valley=[2,2,1,0,0,1,2,2];
  for(let y=2;y<=48;y++)valley.forEach((height,i)=>set(60+i,y,i===3?{terrain:'water',elevation:0,detail:'river'}:{elevation:height/7}));
  for(let y=6;y<=42;y+=6){for(let x=6;x<=60;x++)set(x,y,{road:true});for(let x=66;x<=120;x++)set(x,y,{road:true});}
  for(let x=6;x<=120;x+=6)if(x<=60||x>=66)for(let y=6;y<=42;y++)set(x,y,{road:true});
  // A rail tree: one trunk through a ridge, branches and twigs.
  for(let y=54;y<=66;y++)for(const x of [98,99])set(x,y,{elevation:3/7});
  for(let x=4;x<=120;x++)if(x<97||x>99)set(x,60,{rail:true});
  for(const bx of [10,30,50,70,90]){for(let y=61;y<=88;y++)set(bx,y,{rail:true});for(let x=bx+1;x<=bx+7;x++)set(x,76,{rail:true});}
  // A lake for ports.
  for(let y=70;y<=92;y++)for(let x=100;x<=124;x++)set(x,y,{terrain:'water',elevation:0});
  game.revision++;game.networkRevision++;
  for(const y of [12,30]){const span=buildStructureSpan(game,'bridge',line(60,66,y));assert.equal(span.ok,true,span.message);}
  const tunnel=buildStructureSpan(game,'railtunnel',line(96,100,60));assert.equal(tunnel.ok,true,tunnel.message);
  const stops=[['bus-stop',[[9,9,12,9],[27,9,30,9],[45,9,48,9],[9,27,12,27],[27,27,30,27],[45,27,48,27],[27,39,30,39],[75,15,78,15],[87,33,90,33],[117,39,120,39],[105,9,108,9]]],
    ['train-stop',[[14,56,14,60],[38,64,38,60],[62,56,62,60],[84,64,84,60],[116,56,116,60],[26,84,30,84],[46,84,50,84],[74,72,74,76],[7,86,10,88]]],
    ['port',[[104,66,104,70],[116,66,116,70],[96,84,100,84]]]];
  for(const [tool,sites] of stops)for(const [tx,ty,x,y] of sites){town(game,tx,ty);const result=build(game,tool,x,y);assert.equal(result.ok,true,`${tool} ${x},${y}: ${result.message}`);}
  for(const [a,b] of [[[12,9],[30,9]],[[12,9],[48,27]],[[30,9],[78,15]],[[12,27],[90,33]],[[48,9],[120,39]],[[30,27],[30,39]],[[48,27],[108,9]],[[30,39],[90,33]],[[12,9],[120,39]],[[78,15],[90,33]]])route(game,'road',a,b);
  for(const [a,b] of [[[14,60],[38,60]],[[84,60],[116,60]],[[14,60],[30,84]],[[62,60],[74,76]],[[50,84],[62,60]],[[10,88],[116,60]],[[38,60],[84,60]]])route(game,'rail',a,b);
  for(const [a,b] of [[[104,70],[116,70]],[[116,70],[100,84]],[[100,84],[104,70]]])route(game,'water',a,b);
  game.notifications=[];
  return game;
}
function mulberry(seed){return()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// Each edit is chosen from the journaled company and then applied to both companies unchanged.
function chooseEdit(game,random){
  const pick=items=>items[Math.floor(random()*items.length)],int=(lo,hi)=>lo+Math.floor(random()*(hi-lo+1));
  const straight=(x,y,length)=>random()<.5?line(x,Math.min(game.width-1,x+length),y):Array.from({length:length+1},(_,i)=>({x,y:Math.min(game.height-1,y+i)}));
  const network=()=>{
    if(random()<.5){const path=pick(game.routes).path;return path[int(0,path.length-1)];}
    for(;;){const x=int(0,game.width-1),y=int(0,game.height-1),tile=tileAt(game,x,y);if(tile.road||tile.rail)return{x,y};}
  };
  const roll=random();
  if(roll<.16)return{kind:'build',tool:'road',points:[{x:int(2,125),y:int(2,50)}]};
  if(roll<.24)return{kind:'build',tool:'road',points:straight(int(2,118),int(2,46),int(1,8))};
  if(roll<.32)return{kind:'build',tool:'rail',points:random()<.5?[{x:int(2,125),y:int(52,93)}]:straight(int(2,118),int(52,88),int(1,8))};
  if(roll<.48)return{kind:'build',tool:'bulldoze',points:[network()]};
  if(roll<.52){const p=network();return{kind:'build',tool:'bulldoze',points:straight(p.x,p.y,int(1,4))};}
  if(roll<.58)return random()<.6?{kind:'build',tool:'bridge',points:line(60,66,6*int(1,7))}:{kind:'build',tool:'railtunnel',points:line(96,100,int(56,64))};
  if(roll<.68){const p=network(),tile=tileAt(game,p.x,p.y);return random()<.25?{kind:'build',tool:'port',points:[{x:random()<.5?100:int(100,124),y:random()<.5?70:int(70,92)}]}:{kind:'build',tool:tile.rail&&!tile.road?'train-stop':'bus-stop',points:[p]};}
  if(roll<.74)return{kind:'build',tool:'bulldoze',points:[pick(game.stations)]};
  if(roll<.78)return{kind:'build',tool:'city',points:[{x:int(2,125),y:int(2,93)}]};
  if(roll<.84){const stop=pick(game.stations),other=pick(game.stations.filter(s=>s.mode===stop.mode&&s!==stop));return other?{kind:'route',mode:stop.mode,stops:[stop.id,other.id]}:{kind:'none'};}
  if(roll<.88)return{kind:'retire',index:int(0,game.routes.length-1)};
  if(roll<.94)return{kind:'undo'};
  return{kind:'plan',tool:pick(['road','rail','bulldoze']),points:straight(int(2,118),int(2,88),int(1,6))};
}
function applyEdit(game,edit,undo){
  if(edit.kind==='build')return buildPlan(game,edit.tool,edit.points.map(({x,y})=>({x,y})));
  if(edit.kind==='route')return addRoute(game,{mode:edit.mode,stops:edit.stops,cargo:'passengers'});
  if(edit.kind==='retire')return game.routes[edit.index]?removeRoute(game,game.routes[edit.index].id):null;
  if(edit.kind==='undo')return undo.entry&&canUndo(game,undo.entry)?undoConstruction(game,undo.entry):null;
  if(edit.kind==='plan'){const entry=captureUndo(game,edit.tool,edit.points),result=buildPlan(game,edit.tool,edit.points);undo.entry=finishUndo(entry,game,result)||undo.entry;return result;}
  return null;
}
const summary=result=>result&&{ok:result.ok,message:result.message,cost:result.cost};
function compare(fast,full,label){
  assert.equal(fast.networkRevision,full.networkRevision,label);
  assert.deepStrictEqual(fast.routes,full.routes,`${label}: routes`);
  assert.deepStrictEqual(fast.vehicles,full.vehicles,`${label}: vehicles`);
  assert.deepStrictEqual(fast.notifications,full.notifications,`${label}: notifications`);
  assert.equal(fast.money,full.money,`${label}: money`);
}
function withJournal(enabled,run){setNetworkJournalEnabled(enabled);try{return run();}finally{setNetworkJournalEnabled(true);}}

for(const seed of [17,2024])test(`300 random edits replan exactly as a full search of every route (seed ${seed})`,()=>{
  const fast=world(),full=withJournal(false,world),random=mulberry(seed),undo={fast:{},full:{}};
  compare(fast,full,'fixture');
  let kept=0,searched=0;
  for(let step=0;step<300;step++){
    const edit=chooseEdit(fast,random),label=`step ${step} ${JSON.stringify(edit)}`,paths=new Map(fast.routes.map(r=>[r,r.path])),revision=fast.networkRevision;
    const outcome=withJournal(true,()=>{const result=applyEdit(fast,edit,undo.fast);refreshRouteConnections(fast);return result;});
    const expected=withJournal(false,()=>{const result=applyEdit(full,edit,undo.full);refreshRouteConnections(full);return result;});
    assert.deepStrictEqual(summary(outcome),summary(expected),label);
    compare(fast,full,label);
    if(fast.networkRevision!==revision)for(const [r,path] of paths)if(r.active&&fast.routes.includes(r))r.path===path?kept++:searched++;
    withJournal(true,()=>tick(fast,.5));withJournal(false,()=>tick(full,.5));
    compare(fast,full,`${label} + tick`);
  }
  assert.deepStrictEqual(fast.tiles,full.tiles);assert.deepStrictEqual(fast.stations,full.stations);assert.deepStrictEqual(fast.cities,full.cities);
  assert.ok(kept>searched,`most live routes skip a network edit (${kept} kept, ${searched} searched)`);
  assert.ok(searched>50,`near edits still replan (${searched} searched)`);
});
