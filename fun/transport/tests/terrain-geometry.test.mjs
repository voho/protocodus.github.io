import test from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT_STEP, MAX_HEIGHT, TERRAIN_SLOPE_LIMIT, projectGround, projectTerrainPoint, surfaceHeight, tileSurface, groundIsFlat, pickGround, pickTerrainSurface, transportHeight, bridgeDeckHeight, bridgeSurface, bridgeApproachSurface, terrainGeometryStats, clearTerrainGeometryCache } from '../terrain-geometry.js';
import { TERRAIN_HEIGHT_VIEWS } from '../terrain-view.js';
import { facetLight } from '../terrain-mesh.js';
import { TERRAIN_SLOPE_SHAPES } from '../terrain-slope-shapes.js';

const close=(a,b,message='')=>assert.ok(Math.abs(a-b)<1e-8,`${message}: ${a} ≠ ${b}`);
function world(width=64,height=64,elevation=6/16){return{width,height,revision:0,tiles:Array.from({length:width*height},()=>({terrain:'grass',elevation,road:false,rail:false,bridge:false,tunnel:false}))};}
const tile=(game,x,y)=>game.tiles[y*game.width+x];
const area=([a,b,c])=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function roundtrip(game,u,v){const p=projectGround(game,u,v),picked=pickGround(game,p.x,p.y);assert.ok(picked,`${u},${v} has a projected surface`);close(picked.x,u,'picked u');close(picked.y,v,'picked v');}

test('eight vertex heights project an elevated quadrilateral without changing saved heights',()=>{
  const game=world(),before=JSON.stringify(game),surface=tileSurface(game,20,20);
  assert.equal(MAX_HEIGHT,7);assert.equal(HEIGHT_STEP,12);assert.equal(surface.triangles.length,2);assert.equal(surface.corners.length,4);
  close(surface.center.height,3);close(surface.center.y,41*16-3*HEIGHT_STEP);
  assert.deepEqual(surface.triangles,[[surface.nw,surface.ne,surface.se],[surface.nw,surface.se,surface.sw]]);
  for(const p of surface.corners)close(p.height,surface.center.height,'uniform multi-tile sites stay level');
  for(const u of [19,20,21,22,23])for(const v of [19,20,21,22,23])close(surfaceHeight(game,u,v),surface.center.height);
  assert.equal(JSON.stringify(game),before);
});

test('all relief views preserve terrain levels and have unfolded, reversible projected faces',()=>{
  const game=world(36,36);let seed=1847;
  for(const t of game.tiles){seed=(Math.imul(seed,1664525)+1013904223)>>>0;t.elevation=(seed>>>8)/0xffffff;if(seed%11===0)t.terrain='water';}
  const before=JSON.stringify(game),cached=terrainGeometryStats(game).builtChunks;
  for(const {value:heightStep} of TERRAIN_HEIGHT_VIEWS){
    for(let y=0;y<36;y++)for(let x=0;x<36;x++){
      const surface=tileSurface(game,x,y,heightStep);
      for(const triangle of surface.triangles)assert.ok(area(triangle)>=128-1e-8,`${heightStep}px relief keeps ${x},${y} front facing`);
      close(surface.center.height,surfaceHeight(game,x+.5,y+.5),'height remains a terrain level');
      if((x+y)%7===0){const u=x+.37,v=y+.64,p=projectGround(game,u,v,heightStep),picked=pickGround(game,p.x,p.y,heightStep);assert.ok(picked);close(picked.x,u);close(picked.y,v);}
    }
  }
  const warmed=terrainGeometryStats(game).builtChunks;
  assert.ok(warmed>cached);
  projectGround(game,20,20,0);projectGround(game,20,20,14);
  assert.equal(terrainGeometryStats(game).builtChunks,warmed,'views share cached levels without rebuilding the world');
  assert.equal(JSON.stringify(game),before,'changing projection never writes saved terrain');
});

test('flattened relief removes slope lighting without changing bridge or engineering heights',()=>{
  const game=crossing(),before=JSON.stringify(game),deck=bridgeDeckHeight(game,25,20);
  for(const {value:heightStep} of TERRAIN_HEIGHT_VIEWS){
    const slope=tileSurface(game,28,20,heightStep).triangles[0];
    if(heightStep===0)close(facetLight(slope,heightStep),1,'a visibly flat surface uses flat lighting');
    const point=projectTerrainPoint(25.5,20.5,deck,heightStep);
    close(point.y,46*16-deck*heightStep);
    close(transportHeight(game,25,20),deck,'bridge level is independent of its displayed relief');
  }
  assert.equal(JSON.stringify(game),before);
});

test('an isolated raise or lower moves one shared vertex and its adjacent faces',()=>{
  for(const delta of [-1,1]){
    const game=world(64,64,3/7),before=projectGround(game,20,20),centerBefore=projectGround(game,20.5,20.5);tile(game,20,20).elevation=(3+delta)/7;game.revision++;
    const after=projectGround(game,20,20),surface=tileSurface(game,20,20);
    close(after.y-before.y,-delta*HEIGHT_STEP);close(surface.center.y,centerBefore.y,'the equal-height diagonal keeps the other half tile level');
    assert.notEqual(surface.center.height,surface.nw.height);close(surface.center.height,surface.ne.height);
    close(surfaceHeight(game,20.25,20.25),3+delta/2,'the triangular corner rises halfway to the edited vertex');
    assert.deepEqual(surface.nw,tileSurface(game,19,19).se,'neighboring cells use the edited vertex');
    for(const [u,v]of[[20.5,20.5],[20.12,20.22],[20.9,20.1],[20.1,20.9],[20.93,20.91],[20,20],[21,21]])roundtrip(game,u,v);
  }
});

test('scenery flatness rejects straight inclines, corner slopes and large-site interior peaks',()=>{
  const flat=world(64,64,3/7);assert.equal(groundIsFlat(flat,20,20),true);assert.equal(groundIsFlat(flat,20,20,3),true);
  const incline=world(64,64,3/7);for(const y of[20,21])tile(incline,21,y).elevation=4/7;
  const ramp=tileSurface(incline,20,20);assert.equal(ramp.nw.height,ramp.sw.height);assert.equal(ramp.ne.height,ramp.se.height);assert.notEqual(ramp.nw.height,ramp.ne.height);
  assert.equal(groundIsFlat(incline,20,20),false,'a straight buildable grade is still not level ground for scenery');
  const corner=world(64,64,3/7);tile(corner,21,21).elevation=4/7;
  assert.equal(groundIsFlat(corner,20,20),false,'one raised corner tilts the tile');
  const large=world(64,64,3/7);tile(large,21,21).elevation=4/7;
  for(const [x,y]of[[20,20],[23,20],[23,23],[20,23]])assert.equal(surfaceHeight(large,x,y),3);
  assert.equal(groundIsFlat(large,20,20,3),false,'matching outer corners cannot conceal an interior peak');
  tile(large,21,21).elevation=3/7;large.revision++;assert.equal(groundIsFlat(large,20,20,3),true,'leveling the point restores the plot');
  tile(large,21,21).elevation=2/7;large.revision++;assert.equal(groundIsFlat(large,20,20,3),false,'an interior hollow is also sloped');
});

test('water is completely planar at sea level and the dry banks ramp into its shared edges',()=>{
  const game=world(64,64,1);for(let y=0;y<64;y++)for(let x=0;x<32;x++)Object.assign(tile(game,x,y),{terrain:'water',elevation:.9});
  for(const y of [1,15,31,62]){
    const sea=tileSurface(game,31,y);for(const p of [...sea.corners,sea.center])assert.equal(p.height,0);
    const bank=tileSurface(game,32,y);assert.equal(bank.nw.height,0);assert.equal(bank.sw.height,0);assert.ok(bank.center.height>0);assert.ok(bank.center.height<=TERRAIN_SLOPE_LIMIT);
    assert.deepEqual(sea.ne,bank.nw);assert.deepEqual(sea.se,bank.sw);
    for(const x of [31.2,31.8,32,32.1,32.5,32.9,34.2])roundtrip(game,x,y+.4);
  }
});

test('diagonal shoreline faces stay unfolded and pickable across chunk boundaries',()=>{
  for(const [wx,wy]of[[20,20],[31,31],[32,32]]){
    const game=world(64,64,1);Object.assign(tile(game,wx,wy),{terrain:'water',elevation:0});
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const x=wx+dx,y=wy+dy,surface=tileSurface(game,x,y);
      for(const triangle of surface.triangles)assert.ok(area(triangle)>=256-1e-8,`shore at ${wx},${wy}: ${x},${y} has an unfolded face`);
      for(const [u,v]of[[.5,.5],[.2,.1],[.8,.1],[.9,.8],[.1,.8]])roundtrip(game,x+u,y+v);
      const right=tileSurface(game,x+1,y),below=tileSurface(game,x,y+1);
      assert.deepEqual(surface.ne,right.nw);assert.deepEqual(surface.se,right.sw);
      assert.deepEqual(surface.sw,below.nw);assert.deepEqual(surface.se,below.ne);
    }
  }
});

test('the integer vertex field contains all eight levels and the exact Chebyshev lower envelope',()=>{
  const terraced=world(128,24);for(let y=0;y<terraced.height;y++)for(let x=0;x<terraced.width;x++)tile(terraced,x,y).elevation=Math.floor(x/16)/7;
  const levels=new Set();for(let y=0;y<=terraced.height;y++)for(let x=0;x<=terraced.width;x++){
    const h=surfaceHeight(terraced,x,y);assert.ok(Number.isInteger(h));levels.add(h);
  }
  assert.deepEqual([...levels].sort((a,b)=>a-b),[0,1,2,3,4,5,6,7]);
  for(let level=0;level<8;level++)close(surfaceHeight(terraced,level*16+8,12),level);
  const game=world(18,18);let seed=1847;for(const t of game.tiles){seed=(Math.imul(seed,1664525)+1013904223)>>>0;t.elevation=(seed>>>8)/0xffffff;if(seed%23===0)t.terrain='water';}
  const source=(x,y)=>{
    const at=(u,v)=>tile(game,Math.max(0,Math.min(game.width-1,u)),Math.max(0,Math.min(game.height-1,v)));
    return [[-1,-1],[0,-1],[-1,0],[0,0]].some(([dx,dy])=>at(x+dx,y+dy).terrain==='water')?0:Math.round(at(x,y).elevation*7);
  };
  for(let y=0;y<=game.height;y++)for(let x=0;x<=game.width;x++){
    let expected=7;for(let sy=0;sy<=game.height;sy++)for(let sx=0;sx<=game.width;sx++)expected=Math.min(expected,source(sx,sy)+Math.max(Math.abs(sx-x),Math.abs(sy-y)));
    close(surfaceHeight(game,x,y),expected,`Chebyshev envelope at ${x},${y}`);
  }
});

test('neighboring tiles and independently rebuilt chunks share exactly the same vertices',()=>{
  const game=world(96,96);for(let y=0;y<96;y++)for(let x=0;x<96;x++)tile(game,x,y).elevation=(5+Math.sin(x*.17)+Math.cos(y*.31))/16;
  for(const [x,y]of[[31,31],[32,32],[63,31],[63,63],[64,64]]){
    const a=tileSurface(game,x,y),b=tileSurface(game,x+1,y),c=tileSurface(game,x,y+1);
    assert.deepEqual(a.ne,b.nw);assert.deepEqual(a.se,b.sw);assert.deepEqual(a.sw,c.nw);assert.deepEqual(a.se,c.ne);
    clearTerrainGeometryCache(game);assert.deepEqual(tileSurface(game,x,y),a,'halo seams are independent of cache population');
  }
});

test('every triangle stays unfolded for checkerboard, cliffs and steep random saved elevations',()=>{
  for(const kind of ['checkerboard','cliff','random']){
    const game=world(36,36);let seed=1847;
    for(let y=0;y<36;y++)for(let x=0;x<36;x++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const t=tile(game,x,y);
      t.elevation=kind==='cliff'?(x+y>36?1:0):(seed>>>8)/0xffffff;
      if(kind==='checkerboard'&&(x+y)%2===0)t.terrain='water';
      if(kind==='random'&&seed%11===0)t.terrain='water';
    }
    for(let y=0;y<36;y++)for(let x=0;x<36;x++){
      const surface=tileSurface(game,x,y),diagonal=surface.se.height-surface.nw.height;
      assert.ok(Math.abs(diagonal)<=TERRAIN_SLOPE_LIMIT);
      for(const triangle of surface.triangles)assert.ok(area(triangle)>=256,`${kind} ${x},${y} has a front-facing triangle`);
      if((x+y)%13===0)roundtrip(game,x+.37,y+.64);
    }
  }
});

test('inverse picking handles world edges, high plateaus and off-map points',()=>{
  const game=world(64,64,1);
  for(const [u,v]of[[0,0],[64,0],[0,64],[64,64],[.5,.5],[63.5,.5],[.5,63.5],[63.5,63.5],[30.25,40.75]])roundtrip(game,u,v);
  assert.equal(pickGround(game,-100000,-100000),null);assert.equal(pickGround(game,NaN,0),null);
  assert.deepEqual(projectTerrainPoint(3,2,5),{u:3,v:2,x:32,y:20,height:5});
});

test('geometry cache invalidates on revision and replacement tiles without modifying either world',()=>{
  const game=world(64,64,3/7);const original=projectGround(game,20.25,20.25);tile(game,20,20).elevation+=1/7;game.revision++;
  const raised=projectGround(game,20.25,20.25);assert.ok(raised.y<original.y);assert.ok(terrainGeometryStats(game).builtChunks>0);
  game.tiles=game.tiles.map(t=>({...t,elevation:1/16}));const low=projectGround(game,20.25,20.25);assert.ok(low.y>original.y);
  const snapshot=JSON.stringify(game);for(let n=0;n<20;n++)roundtrip(game,20+n*.1,20.3);assert.equal(JSON.stringify(game),snapshot);
});

test('2048² geometry uses bounded local reads and a bounded chunk LRU',()=>{
  let reads=0;const constant={terrain:'grass',elevation:.5,road:false,rail:false,bridge:false};
  const tiles=new Proxy({length:2048*2048},{get(target,key){if(/^\d+$/.test(String(key))){reads++;return constant;}return Reflect.get(target,key);}}),game={width:2048,height:2048,revision:0,tiles};
  roundtrip(game,1024.5,1024.5);assert.ok(reads<16000,`one distant center read ${reads} cells, not the full world`);
  const after=terrainGeometryStats(game);for(let n=0;n<20;n++)projectGround(game,1024.5,1024.5);assert.equal(terrainGeometryStats(game).builtChunks,after.builtChunks,'warm centers reuse local fields');
  for(let n=0;n<140;n++)projectGround(game,(n%60)*32+10.5,Math.floor(n/60)*32+10.5);
  const stats=terrainGeometryStats(game);assert.ok(stats.cachedChunks<=stats.cacheLimit);assert.ok(stats.bytes<=1024*1024);assert.ok(reads<500000,`140 distant chunks stay bounded (${reads} tile reads)`);
});

test('large ordinary fleets reuse chunk bridge absence without repeating neighborhood reads',()=>{
  const game=world(256,256,2/7);for(const t of game.tiles){t.road=true;t.rail=true;}
  let reads=0;
  game.tiles=new Proxy(game.tiles,{get(target,key){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key);}});
  const points=Array.from({length:1000},(_,i)=>({x:8+(i%100)*2,y:8+Math.floor(i/100)*20}));
  for(const mode of ['road','rail'])for(const p of points)close(transportHeight(game,p.x,p.y,mode),2);
  const warmed=terrainGeometryStats(game).builtChunks;reads=0;
  for(const mode of ['road','rail'])for(const p of points)close(transportHeight(game,p.x+.1,p.y,mode),2);
  assert.equal(terrainGeometryStats(game).builtChunks,warmed,'moving fleets reuse the warmed terrain fields');
  assert.ok(reads<=points.length*5,`ordinary road and rail queries avoid per-vehicle neighborhood scans (${reads} reads)`);
});

test('chunk bridge absence includes neighboring banks and clears after building or removing spans',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const bank of [31,32]){
    const game=world(64,64,0),at=(along,across=20)=>axis==='x'?{x:along,y:across}:{x:across,y:along};
    const p=at(bank),side=at(bank,21),deck=at(bank===31?32:31);
    tile(game,p.x,p.y)[mode]=true;tile(game,side.x,side.y)[mode]=true;
    assert.equal(bridgeApproachSurface(game,p.x,p.y,mode),null,'warm the chunk before construction');
    Object.assign(tile(game,deck.x,deck.y),{terrain:'water',[mode]:true,bridge:true,structureAxis:axis});game.revision++;
    const surface=bridgeApproachSurface(game,p.x,p.y,mode);assert.ok(surface,'a bridge across the chunk boundary raises its bank');
    const taper=bridgeApproachSurface(game,side.x,side.y,mode);assert.ok(taper,'the shared side taper is included');assert.equal(taper.directions.length,0);
    tile(game,deck.x,deck.y).bridge=false;game.revision++;
    assert.equal(bridgeApproachSurface(game,p.x,p.y,mode),null,'removing the span restores cached absence');
    game.tiles=game.tiles.map((t,index)=>index===deck.y*game.width+deck.x?{...t,bridge:true}:t);
    assert.ok(bridgeApproachSurface(game,p.x,p.y,mode),'replacement tiles invalidate absence even at the same revision');
  }
});

function crossing(explicit=true){
  const game=world(64,64,6/16);for(let y=0;y<64;y++)for(let x=24;x<=27;x++)Object.assign(tile(game,x,y),{terrain:'water',elevation:0});
  for(let x=20;x<=31;x++)tile(game,x,20).road=true;
  for(let x=24;x<=27;x++)Object.assign(tile(game,x,20),{bridge:true,...explicit?{structureAxis:'x',structureLevel:6}:{}});
  return game;
}
test('bridge decks follow the visible banks with water clearance and vehicles blend onto the same deck',()=>{
  for(const explicit of [true,false]){
    const game=crossing(explicit),span=bridgeSurface(game,25,20),bank=surfaceHeight(game,23.5,20.5);
    close(span.height,Math.max(bank,1));assert.equal(span.axis,'x');assert.equal(span.legacy,!explicit);assert.equal(span.from.x,23);assert.equal(span.to.x,28);
    for(let x=24;x<=27;x++){close(bridgeDeckHeight(game,x,20),span.height);close(transportHeight(game,x,20),span.height);assert.equal(transportHeight(game,x,20,'water'),0);}
    close(transportHeight(game,23,20),bridgeApproachSurface(game,23,20).center.height);close(transportHeight(game,23.5,20),span.height);
    assert.equal(bridgeDeckHeight(game,20,20),null);assert.equal(transportHeight(game,20.2,20),surfaceHeight(game,20.7,20.5));
    const before=span.height;tile(game,23,20).elevation=1/16;game.revision++;assert.ok(bridgeDeckHeight(game,25,20)<=before);
  }
});

test('long bridges share one constant portal-derived deck across distant viewports',()=>{
  const game=world(512,32,8/16);
  for(let y=0;y<32;y++)for(let x=20;x<490;x++)Object.assign(tile(game,x,y),{terrain:'water',elevation:0});
  for(let x=19;x<=490;x++)tile(game,x,16).road=true;
  for(let x=20;x<490;x++)Object.assign(tile(game,x,16),{bridge:true,structureAxis:'x',structureLevel:8});
  const center=bridgeSurface(game,255,16);assert.equal(center.from.x,19);assert.equal(center.to.x,490);
  for(const x of [20,127,255,383,489])assert.equal(bridgeSurface(game,x,16),center,'all visible pieces use the same cached span');
  assert.equal(center.height,Math.max(surfaceHeight(game,19.5,16.5),1));
});

function approachCrossing(mode,axis,elevation=0,explicit=true){
  const game=world(40,40,elevation),at=(along,across=20)=>axis==='x'?{x:along,y:across}:{x:across,y:along};
  for(let along=18;along<=21;along++)for(let across=0;across<40;across++){
    const p=at(along,across);Object.assign(tile(game,p.x,p.y),{terrain:'water',elevation:0});
  }
  for(let along=16;along<=23;along++){
    const p=at(along),interior=along>=18&&along<=21;
    Object.assign(tile(game,p.x,p.y),{[mode]:true,bridge:interior,...interior&&explicit?{structureAxis:axis,structureLevel:0}:{}});
  }
  return {game,at};
}
test('low-bank road and rail bridges have one shared raised deck without rewriting saved spans',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const explicit of [true,false]){
    const {game,at}=approachCrossing(mode,axis,0,explicit);
    const saved=JSON.stringify(game),middle=at(19),span=bridgeSurface(game,middle.x,middle.y,mode);
    assert.equal(span.height,1,'even sea-level banks leave visible space under the deck');assert.equal(span.axis,axis);assert.equal(span.legacy,!explicit);
    for(const [along,expected] of [[16.5,0],[17,.5],[17.25,.75],[17.5,1],[18,1],[19.5,1],[21,1],[21.5,1],[21.75,.75],[22,.5],[22.5,0]]){
      const p=at(along);
      close(transportHeight(game,p.x,p.y,mode),expected,`${mode}/${axis} at ${along}`);
      close(transportHeight(game,p.x,p.y,'water'),0,'ships retain their water-level path');
    }
    assert.equal(JSON.stringify(game),saved,'presentation clearance preserves legacy and explicit engineering metadata');
  }
});


test('uneven bridge banks ramp to the deck by the shared edge and stay level over water',()=>{
  for(const lowBank of [23,28]){
    const game=crossing();tile(game,lowBank,20).elevation=1/16;tile(game,lowBank+1,21).elevation=1/16;game.revision++;
    const deck=bridgeDeckHeight(game,25,20),ground=surfaceHeight(game,lowBank+.5,20.5),direction=lowBank===23?1:-1,surface=bridgeApproachSurface(game,lowBank,20);
    assert.ok(deck>ground);assert.ok(surface.center.height>=ground);close(transportHeight(game,lowBank,20),surface.center.height);
    close(transportHeight(game,lowBank+direction*.25,20),(surface.center.height+deck)/2);
    close(transportHeight(game,lowBank-direction*.5,20),surfaceHeight(game,lowBank-direction*.5+.5,20.5),'the outer edge still meets unchanged land');
    for(const offset of [.5,.75,1])close(transportHeight(game,lowBank+direction*offset,20),deck,`bank${lowBank} offset${offset}`);
  }
});

test('bridge approaches are continuous and monotonic at fine steps in both travel directions',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const elevation of [0,1/16,6/16])for(const explicit of [true,false]){
    const {game,at}=approachCrossing(mode,axis,elevation,explicit),height=along=>{const p=at(along);return transportHeight(game,p.x,p.y,mode);};
    const deck=height(19),before=JSON.stringify(game);
    for(const direction of [-1,1]){
      let previous=null;
      for(let step=0;step<=7000;step++){
        const along=direction===1?16+step/1000:23-step/1000,current=height(along);
        if(previous!==null)assert.ok(Math.abs(current-previous)<=.002+1e-8,`${mode}/${axis} continuous at ${along} moving ${direction}`);
        if(along>=17.5&&along<=21.5)close(current,deck,'carriers stay on the deck at integer and fractional positions');
        previous=current;
      }
      for(const bank of [17,22]){
        const towardDeck=bank===17?1:-1,outer=bank-towardDeck*.5,start=height(outer),rise=Math.sign(deck-start);
        let previousHeight=direction===1?start:deck;
        for(let step=0;step<=1000;step++){
          const fraction=direction===1?step/1000:1-step/1000,current=height(outer+towardDeck*fraction);
          if(rise)assert.ok((current-previousHeight)*rise*direction>=-1e-8,'the bank never dips before climbing onto the bridge');
          else close(current,deck,'a bank already at deck level stays level');
          previousHeight=current;
        }
      }
    }
    assert.equal(JSON.stringify(game),before,'continuous movement only changes presentation');
  }
});

test('approach painting, fractional carrier anchors and picking share all four faces',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const elevation of [0,6/16])for(const bank of [17,22]){
    const {game,at}=approachCrossing(mode,axis,elevation),p=at(bank),original=tileSurface(game,p.x,p.y),saved=JSON.stringify(game);
    for(const {value:heightStep} of TERRAIN_HEIGHT_VIEWS){
      const surface=bridgeApproachSurface(game,p.x,p.y,mode,heightStep);
      assert.ok(surface);assert.equal(surface.triangles.length,4);
      assert.equal(bridgeApproachSurface(game,p.x,p.y,mode,heightStep),surface,'hot geometry and pick queries share the same surface');
      const {dx,dy,height}=surface.directions[0],shore=dx===1?['ne','se']:dx===-1?['nw','sw']:dy===1?['sw','se']:['nw','ne'];
      for(const corner of ['nw','ne','se','sw'])close(surface[corner].height,shore.includes(corner)?height:original[corner].height,'only shore corners lift');
      for(const face of surface.triangles){
        assert.ok(area(face)>0,'raised approach faces never fold over');
        for(const weights of [[.2,.3,.5],[.15,.75,.1],[.7,.1,.2]]){
          const u=face.reduce((sum,point,i)=>sum+point.u*weights[i],0),v=face.reduce((sum,point,i)=>sum+point.v*weights[i],0),expected=face.reduce((sum,point,i)=>sum+point.height*weights[i],0);
          close(transportHeight(game,u-.5,v-.5,mode),expected,'fractional positions sample the containing painted triangle');
          const projected=projectTerrainPoint(u,v,expected,heightStep),picked=pickTerrainSurface(surface,projected.x,projected.y);
          assert.ok(picked);close(picked.x,u,'raised approach pick u');close(picked.y,v,'raised approach pick v');
        }
      }
      assert.equal(pickTerrainSurface(surface,surface.center.x+1000,surface.center.y),null);
      assert.equal(pickTerrainSurface(surface,NaN,surface.center.y),null);
    }
    assert.equal(JSON.stringify(game),saved);
  }
  assert.equal(pickTerrainSurface(null,0,0),null);
});

test('side junctions share ramp edges and stay continuous through turns onto and off both banks',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const explicit of [true,false])for(const elevation of [0,6/16])for(const bank of [17,22]){
    const {game,at}=approachCrossing(mode,axis,elevation,explicit);
    for(let across=17;across<=23;across++){const p=at(bank,across);tile(game,p.x,p.y)[mode]=true;}
    const saved=JSON.stringify(game),bankPoint=at(bank),bankSurface=bridgeApproachSurface(game,bankPoint.x,bankPoint.y,mode);
    for(const side of [-1,1]){
      const adjacent=at(bank,20+side),surface=bridgeApproachSurface(game,adjacent.x,adjacent.y,mode);
      assert.ok(surface,'a side street receives one tile of taper');assert.deepEqual(surface.directions,[],'a taper does not invent a direct bridge connection');
      const outer=at(bank,20+side*2);assert.equal(bridgeApproachSurface(game,outer.x,outer.y,mode),null,'the taper ends at unchanged ground');
      const shared=surface.corners.filter(point=>bankSurface.corners.some(other=>other.u===point.u&&other.v===point.v));
      assert.equal(shared.length,2);
      for(const point of shared)close(point.height,bankSurface.corners.find(other=>other.u===point.u&&other.v===point.v).height,'both painted cells share the entire edge');
      for(const edge of [20+side*.5,20+side*1.5])for(const acrossRoad of [-.4,0,.4]){
        const before=at(bank+acrossRoad,edge-1e-7),after=at(bank+acrossRoad,edge+1e-7);
        assert.ok(Math.abs(transportHeight(game,before.x,before.y,mode)-transportHeight(game,after.x,after.y,mode))<1e-6,'side and outer taper boundaries are continuous across road width');
      }
      const bridgeDirection=bank===17?1:-1,path=[at(bank,20+side*3),bankPoint,at(bank+bridgeDirection*2)];
      for(const direction of [-1,1]){
        const points=direction===1?path:[...path].reverse();let previous=null;
        for(let segment=0;segment<points.length-1;segment++){
          const a=points[segment],b=points[segment+1],steps=(Math.abs(b.x-a.x)+Math.abs(b.y-a.y))*1000;
          for(let step=0;step<=steps;step++){
            const fraction=step/steps,current=transportHeight(game,a.x+(b.x-a.x)*fraction,a.y+(b.y-a.y)*fraction,mode);
            if(previous!==null)assert.ok(Math.abs(current-previous)<=.002+1e-8,`${mode}/${axis} side ${side} bank ${bank} continuous corner entry/exit`);
            previous=current;
          }
        }
      }
      for(const {value:heightStep} of TERRAIN_HEIGHT_VIEWS){
        const raised=bridgeApproachSurface(game,adjacent.x,adjacent.y,mode,heightStep);
        for(const face of raised.triangles){
          const u=face.reduce((sum,point)=>sum+point.u,0)/3,v=face.reduce((sum,point)=>sum+point.v,0)/3,height=face.reduce((sum,point)=>sum+point.height,0)/3;
          close(transportHeight(game,u-.5,v-.5,mode),height,'side taper anchoring matches its painted face');
          const point=projectTerrainPoint(u,v,height,heightStep),picked=pickTerrainSurface(raised,point.x,point.y);
          assert.ok(picked);close(picked.x,u);close(picked.y,v);
        }
      }
    }
    assert.equal(JSON.stringify(game),saved,'side transitions never alter the saved network or terrain');
  }
});

test('approaches only follow connected span endpoints and rebuild after network changes',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y']){
    const {game,at}=approachCrossing(mode,axis),bank=at(17),side=at(19,19),interior=at(19);
    tile(game,side.x,side.y).terrain='grass';tile(game,side.x,side.y)[mode]=true;
    assert.equal(bridgeApproachSurface(game,side.x,side.y,mode),null,'a road next to the side of a bridge is not a ramp');
    assert.equal(bridgeApproachSurface(game,interior.x,interior.y,mode),null,'a bridge deck is not a bank');
    assert.equal(bridgeApproachSurface(game,bank.x,bank.y,mode==='road'?'rail':'road'),null,'a different network cannot attach');
    assert.equal(bridgeApproachSurface(game,bank.x,bank.y,'water'),null);
    const surface=bridgeApproachSurface(game,bank.x,bank.y,mode);assert.ok(surface);
    tile(game,bank.x,bank.y)[mode]=false;game.revision++;
    assert.equal(bridgeApproachSurface(game,bank.x,bank.y,mode),null,'removed connections clear the approach');
    tile(game,bank.x,bank.y)[mode]=true;game.revision++;
    assert.notEqual(bridgeApproachSurface(game,bank.x,bank.y,mode),surface,'restored connections rebuild the shared surface');
    tile(game,bank.x,bank.y).tunnel=true;game.revision++;
    assert.equal(bridgeApproachSurface(game,bank.x,bank.y,mode),null,'tunnel portals retain their own treatment');
  }
});


test('all canonical corner shapes use two consistent triangles, a finite catalog and reversible picking',()=>{
  const observed=new Set();
  for(let mask=0;mask<16;mask++){
    const game=world(36,36,3/7);
    for(const [i,[x,y]]of [[20,20],[21,20],[21,21],[20,21]].entries())if(mask&(1<<i))tile(game,x,y).elevation=4/7;
    const expectedKind=mask===0||mask===15?'flat':[3,6,9,12].includes(mask)?'ramp':[1,2,4,8].includes(mask)?'raised':[5,10].includes(mask)?'ridge':'lowered';
    const original=JSON.stringify(game);
    for(const {value:heightStep}of TERRAIN_HEIGHT_VIEWS){
      const surface=tileSurface(game,20,20,heightStep);observed.add(surface.slope);
      assert.equal(surface.slope.kind,expectedKind);assert.equal(surface.triangles.length,2);
      assert.ok(TERRAIN_SLOPE_SHAPES.includes(surface.slope));
      const flatFaces=surface.triangles.filter(face=>face.every(p=>p.height===face[0].height)).length;
      assert.equal(flatFaces,expectedKind==='flat'?2:['raised','lowered'].includes(expectedKind)?1:0,'corner wedges have exactly one level half-tile');
      for(const face of surface.triangles){
        assert.ok(area(face)>=128,'every canonical face stays unfolded even in Steep view');
        const u=face.reduce((sum,p)=>sum+p.u,0)/3,v=face.reduce((sum,p)=>sum+p.v,0)/3;
        close(surfaceHeight(game,u,v),face.reduce((sum,p)=>sum+p.height,0)/3,'rendering and engineering use the same plane');
      }
      for(const [a,b]of[[.15,.2],[.8,.15],[.8,.75],[.2,.85],[.5,.5]]){
        const point=projectGround(game,20+a,20+b,heightStep),picked=pickGround(game,point.x,point.y,heightStep);
        assert.ok(picked);close(picked.x,20+a);close(picked.y,20+b);
      }
    }
    assert.equal(JSON.stringify(game),original,'choosing a tile shape never rewrites saved elevations');
  }
  assert.equal(observed.size,15,'all-high corners normalize to flat; there are only fifteen slope shapes');
});
