import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildStructureSpan, constructionCost, createGame, findPath, loadGame, quoteStructureSpan, refreshRouteConnections, restoreGame, saveGame, validateGame } from '../model.js';
import { buildPlan, quoteBuildPlan } from '../construction-plan.js';
import { stepEcology } from '../environment.js';
import { encodeGame } from '../save-codec.js';
import { terrainLevel, landHeightLevel, LAND_HEIGHT_LEVELS, LAND_HEIGHT_VALUE_COUNT } from '../terrain-elevation.js';
import { networkTerrainShape, planStructureSpan } from '../terrain-engineering.js';
import { surfaceHeight } from '../terrain-geometry.js';
import { releaseTerrainObjects } from '../terrain-objects.js';
import { emptyGame, line, tileAt } from './helpers.mjs';

function levelGame(biome = 'taiga') {
  const game = emptyGame(biome);
  for (const tile of game.tiles) tile.elevation = 2 / 7;
  return game;
}

function prepareSpan(game, tool, axis = 'x', origin = {x:10,y:10}) {
  const points = Array.from({ length: 5 }, (_, i) => ({ x: origin.x+(axis==='x'?i:0), y: origin.y+(axis==='y'?i:0) }));
  const tunnel = tool.includes('tunnel');
  for (const [index, point] of points.entries()) {
    // A valley/ridge runs across the crossing, so its approaches have a
    // straight grade rather than a one-cell mound with compound corners.
    for(let offset=-3;offset<=3;offset++){
      const tile = tileAt(game, point.x+(axis==='y'?offset:0), point.y+(axis==='x'?offset:0));
      tile.elevation = (index <= 1 || index === points.length - 1 ? 2 : tunnel ? 3 : 1) / 7;
      tile.terrain = 'grass'; tile.detail = '';
    }
  }
  game.revision++;
  return points;
}

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('eight vertex values preserve the legacy sixteen-unit save helpers',()=>{
  assert.equal(LAND_HEIGHT_VALUE_COUNT,8);assert.equal(LAND_HEIGHT_LEVELS,7);
  for(let height=0;height<=7;height++){
    const tile={terrain:'grass',elevation:height/7};
    assert.equal(landHeightLevel(tile),height);assert.equal(terrainLevel(tile),Math.round(height*16/7));
  }
  for(let height=1;height<7;height++){
    const game=levelGame();for(const tile of game.tiles)tile.elevation=height/7;
    const raised=build(game,'raise',12,12);assert.equal(raised.ok,true);assert.equal(raised.level,height+1);
    assert.equal(tileAt(game,12,12).elevation,(height+1)/7);assert.equal(surfaceHeight(game,12,12),height+1);
    assert.equal(build(game,'lower',12,12).level,height);assert.equal(tileAt(game,12,12).elevation,height/7);
  }
});

test('earthworks use visible vertex height and reject a raise that neighboring points would clamp',()=>{
  const game=levelGame();tileAt(game,12,12).elevation=1;
  assert.equal(landHeightLevel(tileAt(game,12,12)),7);assert.equal(surfaceHeight(game,12,12),3);
  const before=structuredClone(game),quote=quoteBuildPlan(game,'raise',[{x:12,y:12}]);
  assert.equal(quote.ok,false);assert.match(quote.message,/neighboring points/);
  assert.equal(build(game,'raise',12,12).ok,false);assert.deepEqual(game,before);
  const lowered=build(game,'lower',12,12);assert.equal(lowered.level,2);
  assert.equal(tileAt(game,12,12).elevation,2/7);assert.equal(surfaceHeight(game,12,12),2);
});

test('each vertex protects water and construction in all four adjoining cells',()=>{
  for(const [dx,dy] of [[0,0],[-1,0],[0,-1],[-1,-1]])for(const kind of ['water','road','building']){
    const game=levelGame(),tile=tileAt(game,12+dx,12+dy);
    if(kind==='water'){tile.terrain='water';tile.elevation=0;}
    if(kind==='road')tile.road=true;
    if(kind==='building')tile.building={kind:'house-cheap-1',level:1};
    const before=structuredClone(game);
    assert.equal(build(game,'raise',12,12).ok,false,`${kind} at ${dx},${dy}`);
    assert.equal(buildPlan(game,'level',[{x:12,y:12}],{targetLevel:3}).ok,false);
    assert.deepEqual(game,before);
  }
});

test('leveling validates the outside boundary before charging for a raised plateau',()=>{
  const game=levelGame(),points=Array.from({length:9},(_,n)=>({x:12+n%3,y:12+Math.floor(n/3)})),before=structuredClone(game);
  const quote=quoteBuildPlan(game,'level',points,{targetLevel:4});assert.equal(quote.ok,false);assert.match(quote.message,/neighboring points/);
  assert.equal(buildPlan(game,'level',points,{targetLevel:4}).ok,false);assert.deepEqual(game,before);
  const valid=quoteBuildPlan(game,'level',points,{targetLevel:3}),result=buildPlan(game,'level',points,{targetLevel:3});
  assert.equal(valid.cost,9*280);assert.equal(result.cost,valid.cost);assert.equal(result.ok,true);
  for(const point of points)assert.equal(surfaceHeight(game,point.x,point.y),3);
});

test('raise, lower and leveling cannot propagate a height change into distant occupied ground',()=>{
  for(const tool of ['raise','lower','level']){
    const game=levelGame();for(const tile of game.tiles)tile.elevation=6/7;
    tileAt(game,20,20).elevation=2/7;tileAt(game,23,20).road=true;
    assert.equal(surfaceHeight(game,20,20),2);assert.equal(surfaceHeight(game,23,20),5);
    const before=structuredClone(game),options=tool==='level'?{targetLevel:1}:undefined;
    const quote=quoteBuildPlan(game,tool,[{x:20,y:20}],options);
    assert.equal(quote.ok,false);assert.match(quote.message,/move nearby buildings or networks/);
    assert.equal(buildPlan(game,tool,[{x:20,y:20}],options).ok,false);assert.deepEqual(game,before);
  }
});

test('a lowering stroke captures every target before earlier edits propagate into later points',()=>{
  const game=levelGame();for(const tile of game.tiles)tile.elevation=6/7;
  tileAt(game,20,20).elevation=2/7;
  const points=[{x:20,y:20},{x:21,y:20},{x:22,y:20}],before=points.map(p=>surfaceHeight(game,p.x,p.y)),money=game.money;
  assert.deepEqual(before,[2,3,4]);
  const quote=quoteBuildPlan(game,'lower',points);assert.equal(quote.ok,true);assert.deepEqual(quote.placements.map(p=>p.level),[1,2,3]);
  const result=buildPlan(game,'lower',points);assert.equal(result.ok,true);assert.equal(result.cost,quote.cost);assert.equal(game.money,money-quote.cost);
  assert.deepEqual(points.map(p=>surfaceHeight(game,p.x,p.y)),[1,2,3]);
  assert.deepEqual(points.map(p=>tileAt(game,p.x,p.y).elevation),[1/7,2/7,3/7]);
});

test('raising and lowering move exactly one terrain level, charge the quote and respect inflation', () => {
  const game = levelGame(), point = { x: 12, y: 12 }, tile = tileAt(game, point.x, point.y);
  tile.elevation = .27;
  const cost = constructionCost(game, 'raise', point.x, point.y), oldMoney = game.money, revision = game.revision;
  assert.ok(cost > 0);
  const quote = quoteBuildPlan(game, 'raise', [point]), raised = buildPlan(game, 'raise', [point]);
  assert.equal(raised.ok, true); assert.equal(raised.cost, cost); assert.equal(quote.cost, cost);
  assert.equal(landHeightLevel(tile), 3); assert.equal(tile.elevation, 3 / 7);
  assert.equal(game.money, oldMoney - cost); assert.ok(game.revision > revision);
  assert.equal(build(game, 'lower', point.x, point.y).ok, true);
  assert.equal(landHeightLevel(tile), 2);
  game.day = 365 * 3;
  assert.ok(constructionCost(game, 'raise', point.x, point.y) > cost);
});

test('earthworks reject water, level limits, insufficient funds and every occupied site without mutation', () => {
  const cases = [
    ['raise', (game, tile) => { tile.elevation = 1; }],
    ['lower', (game, tile) => { tile.elevation = 1 / 7; }],
    ['raise', (game, tile) => { tile.terrain = 'water'; tile.elevation = 0; }],
    ['lower', game => { game.money = 0; }],
    ['raise', (game, tile) => { tile.road = true; }],
    ['lower', (game, tile) => { tile.rail = true; }],
    ['raise', (game, tile) => { tile.building = { kind: 'house-cheap-1', level: 1 }; }],
    ['lower', (game, tile) => { tile.zone = 'residential'; game.zones.push({ x: 12, y: 12, kind: 'residential', progress: 0 }); }],
    ['raise', game => { game.stations.push({ id: 'test-stop', name: 'Stop', x: 12, y: 12, mode: 'road' }); }],
    ['lower', game => { game.cities.push({ id: 'test-city', x: 12, y: 12 }); }],
    ['raise', game => { game.industries.push({ id: 'test-industry', kind: 'farm', x: 11, y: 11, footprint: 2 }); }],
  ];
  for (const [tool, setup] of cases) {
    const game = levelGame(); setup(game, tileAt(game, 12, 12)); const before = structuredClone(game);
    assert.equal(build(game, tool, 12, 12).ok, false, String(setup));
    assert.deepEqual(game, before, 'rejected earthworks do not charge or edit the world');
  }
});

for (const tool of ['bridge', 'railbridge', 'tunnel', 'railtunnel']) for (const axis of ['x', 'y']) {
  test(`${tool}: a ${axis}-axis span connects matching ground levels with preserved terrain and a repeat costs nothing`, () => {
    const game = levelGame(), points = prepareSpan(game, tool, axis), mode = tool.startsWith('rail') ? 'rail' : 'road';
    const terrain = points.map(point => ({ ...tileAt(game, point.x, point.y) }));
    const before = structuredClone(game), quote = quoteBuildPlan(game, tool, points);
    assert.deepEqual(game, before, 'construction preview is read-only');
    assert.ok(quote.cost > 0);
    const result = buildPlan(game, tool, points);
    assert.equal(result.ok, true, result.message); assert.equal(result.built, points.length);
    assert.equal(result.cost, quote.cost); assert.equal(game.money, before.money - result.cost);
    for (const [index, point] of points.entries()) {
      const tile = tileAt(game, point.x, point.y), interior = index > 0 && index < points.length - 1;
      assert.equal(tile[mode], true); assert.equal(tile.terrain, terrain[index].terrain);
      assert.equal(tile.elevation, terrain[index].elevation);
      assert.equal(Boolean(tile.bridge), interior && tool.includes('bridge'));
      assert.equal(Boolean(tile.tunnel), interior && tool.includes('tunnel'));
      assert.equal(tile.structureLevel, interior ? 5 : undefined);
      assert.equal(tile.structureAxis, interior ? axis : undefined);
    }
    assert.deepEqual(findPath(game, points[0], points.at(-1), mode), points);
    const money = game.money, repeated = buildPlan(game, tool, points);
    assert.equal(repeated.ok, true); assert.equal(repeated.cost, 0); assert.equal(repeated.built, 0);
    assert.equal(quoteBuildPlan(game, tool, points).cost, 0); assert.equal(game.money, money);
  });
}

for(const tool of ['bridge','railbridge','tunnel','railtunnel'])for(const shape of ['compound','sidehill']){
  test(`${tool}: new ${shape} approaches pay to satisfy ordinary slope rules`,()=>{
    for(const axis of ['x','y'])for(const endpoint of [0,4]){
      const game=levelGame(),points=prepareSpan(game,tool,axis),end=points[endpoint];
      const at=(along,across)=>tileAt(game,end.x+(axis==='x'?along:across),end.y+(axis==='x'?across:along));
      if(shape==='compound')at(1,1).elevation=0;
      else {
        // The lower shared edge produces an exact side-facing ramp. The
        // limiter lowers its opposite vertices equally, not the saved ends.
        at(0,1).elevation=0;at(1,1).elevation=0;
      }
      game.revision++;
      const classified=networkTerrainShape(game,end.x,end.y);
      assert.equal(classified.kind,shape==='compound'?'complex':'incline');
      if(shape==='sidehill')assert.equal(classified.axis,axis==='x'?'y':'x','the ground is climbable only across the span');
      const before=structuredClone(game);
      const strict=planStructureSpan(game,tool,points);assert.equal(strict.ok,false);assert.match(strict.message,/Level both end tiles/);
      const quote=quoteStructureSpan(game,tool,points);assert.equal(quote.ok,true,quote.message);assert.ok(quote.terrainCost>0);
      assert.equal(quoteBuildPlan(game,tool,points).cost,quote.cost);assert.deepEqual(game,before,'quoted preparation never mutates terrain');
      for(const commit of [buildStructureSpan,buildPlan]){
        const builtGame=structuredClone(before),result=commit(builtGame,tool,points);
        assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.equal(result.built,points.length);
        assert.ok(findPath(builtGame,points[0],points.at(-1),tool.startsWith('rail')?'rail':'road'));
      }
    }
  });
}

for(const tool of ['bridge','railbridge','tunnel','railtunnel'])test(`${tool}: existing legacy approaches can be reused and repaired`,()=>{
  const game=levelGame(),points=prepareSpan(game,tool),mode=tool.startsWith('rail')?'rail':'road';
  tileAt(game,10,11).elevation=1/7;tileAt(game,15,10).elevation=1/7;
  for(const point of [points[0],points.at(-1)])tileAt(game,point.x,point.y)[mode]=true;
  game.revision++;
  assert.equal(networkTerrainShape(game,10,10).kind,'complex');
  const quote=quoteStructureSpan(game,tool,points),money=game.money,result=buildStructureSpan(game,tool,points);
  assert.equal(quote.ok,true);assert.equal(result.ok,true,result.message);assert.equal(result.built,3);
  assert.equal(result.cost,quote.cost);assert.equal(game.money,money-quote.cost);
  assert.deepEqual(findPath(game,points[0],points.at(-1),mode),points);
  assert.equal(buildPlan(game,tool,points).cost,0);
});

for(const tool of ['bridge','railtunnel'])test(`${tool}: old intermediate deck codes survive save/load and partial repairs`,()=>{
  const game=levelGame(),points=line(10,14,10),mode=tool.startsWith('rail')?'rail':'road',structure=tool.endsWith('bridge')?'bridge':'tunnel';
  for(const tile of game.tiles)tile.elevation=6/16;
  for(const [i,p] of points.entries()){
    const tile=tileAt(game,p.x,p.y);tile[mode]=true;
    if(i>0&&i<4){tile.elevation=(structure==='bridge'?2:8)/16;tile[structure]=true;tile.structureLevel=6;tile.structureAxis='x';}
  }
  assert.equal(validateGame(game),true);const loaded=restoreGame(structuredClone(game));assert.ok(loaded);
  const repeated=quoteStructureSpan(loaded,tool,points);assert.equal(repeated.ok,true);assert.equal(repeated.level,6);assert.equal(repeated.height,3);assert.equal(repeated.cost,0);
  assert.equal(build(loaded,'bulldoze',12,10).ok,true);
  const repair=buildStructureSpan(loaded,tool,points);assert.equal(repair.ok,true,repair.message);assert.equal(repair.level,6);assert.equal(repair.height,3);
  assert.equal(tileAt(loaded,12,10).structureLevel,6);assert.equal(validateGame(loaded),true);
  assert.deepEqual(findPath(loaded,points[0],points.at(-1),mode),points);
});

test('bridges cross a mixture of valley floor and water without changing shoreline or ship connectivity', () => {
  const game = levelGame(), points = line(10,16,10),profile=[2,2,1,0,0,1,2,2];
  for(let y=5;y<=15;y++)for(let x=10;x<=17;x++)tileAt(game,x,y).elevation=profile[x-10]/7;
  for (let y = 8; y <= 12; y++) Object.assign(tileAt(game, 13, y), { terrain: 'water', elevation: 0, detail: 'river' });
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  assert.deepEqual(findPath(game, { x: 13, y: 8 }, { x: 13, y: 12 }, 'water'), Array.from({ length: 5 }, (_, i) => ({ x: 13, y: 8 + i })));
  assert.equal(tileAt(game, 13, 10).detail, 'river');
  assert.equal(tileAt(game, 13, 10).elevation, 0);
});

test('invalid span geometry, protected terrain, obstructions and funds fail atomically', () => {
  const cases = [
    ['bridge', (game, points) => points.slice(0, 2)],
    ['bridge', (game, points) => [points[0], points[2], points[4]]],
    ['bridge', (game, points) => [points[0], points[1], { x: 11, y: 11 }]],
    ['tunnel', (game, points) => { Object.assign(tileAt(game, 12, 10), { terrain: 'water', elevation: 0 }); return points; }],
    ['bridge', (game, points) => { tileAt(game, 12, 10).building = { kind: 'house-cheap-1', level: 1 }; return points; }],
    ['tunnel', (game, points) => { game.industries.push({ id: 'occupied-industry', kind: 'farm', x: 11, y: 9, footprint: 2 }); return points; }],
    ['bridge', (game, points) => { game.money = 1; return points; }],
  ];
  for (const [tool, alter] of cases) {
    const game = levelGame(), points = alter(game, prepareSpan(game, tool)), before = structuredClone(game);
    const quote = quoteBuildPlan(game, tool, points);
    assert.equal(quote.ok, false, String(alter));
    const result = buildPlan(game, tool, points);
    assert.equal(result.ok, false, String(alter)); assert.equal(result.cost, 0); assert.equal(result.built, 0);
    assert.deepEqual(game, before, 'a failed span never leaves a partial bridge or tunnel');
  }
});

test('mismatched banks and insufficient interior clearance include paid preparation',()=>{
  for(const kind of ['bank','bridge','tunnel']){
    const tool=kind==='tunnel'?'tunnel':'bridge',game=levelGame(),points=prepareSpan(game,tool);
    for(let y=10;y<=11;y++)for(let x=kind==='bank'?14:12;x<=(kind==='bank'?15:13);x++)tileAt(game,x,y).elevation=(kind==='bank'?1:2)/7;
    assert.equal(planStructureSpan(game,tool,points).ok,false,'the unchanged strict span is still invalid');
    const before=structuredClone(game),quote=quoteBuildPlan(game,tool,points);assert.equal(quote.ok,true,quote.message);assert.ok(quote.terrainCost>0);assert.deepEqual(game,before);
    const result=buildPlan(game,tool,points);assert.equal(result.ok,true,result.message);assert.equal(result.cost,quote.cost);assert.ok(findPath(game,points[0],points.at(-1),'road'));
  }
});

test('span paths reject side entry and wrong deck heights, but retain ordinary and legacy connections', () => {
  for (const tool of ['bridge', 'tunnel']) {
    const game = levelGame(), points = prepareSpan(game, tool);
    assert.equal(buildPlan(game, tool, points).ok, true);
    // These saved surface roads predate the span; new slope construction has its own tests.
    for (let y = 8; y < 10; y++) tileAt(game, 12, y).road = true;
    assert.equal(findPath(game, { x: 12, y: 8 }, points[0]), null, 'surface roads cannot enter the side of an engineered span');
    // Lower both west-side corners so the bank centre is below the deck. A
    // single corner edit now leaves the opposite canonical half-tile level.
    for(const y of [10,11])tileAt(game,10,y).elevation=1/7;game.revision++;
    assert.equal(findPath(game, points[0], points.at(-1)), null, 'ground cannot connect one level below the deck or portal');
    for(const y of [10,11])tileAt(game,10,y).elevation=2/7;game.revision++;
    assert.ok(findPath(game, points[0], points.at(-1)));
    assert.equal(build(game, 'bulldoze', 12, 10).ok, true);
    assert.equal(tileAt(game, 12, 10).structureLevel, undefined);
    assert.equal(tileAt(game, 12, 10).structureAxis, undefined);
    assert.equal(findPath(game, points[0], points.at(-1)), null);
  }
  const game = levelGame();
  for (let x = 10; x <= 12; x++) {
    const tile = tileAt(game, x, 10); tile.elevation = x / 16;
    tile.road = true; // Saved nonconforming roads remain connected after the new construction rule.
  }
  assert.ok(findPath(game, { x: 10, y: 10 }, { x: 12, y: 10 }), 'legacy sloping ground roads stay connected');
  Object.assign(tileAt(game, 13, 10), { terrain: 'water', elevation: 0 });
  assert.equal(build(game, 'bridge', 13, 10).ok, true);
  assert.ok(findPath(game, { x: 10, y: 10 }, { x: 13, y: 10 }), 'untagged legacy water bridges remain compatible');
});

test('ecology preserves engineered heights and built spans as the surroundings evolve', () => {
  const game = levelGame(), points = prepareSpan(game, 'tunnel');
  assert.equal(buildPlan(game, 'tunnel', points).ok, true);
  for (let i = 0; i < 3; i++) assert.equal(build(game, 'raise', 20+i*3, 20).ok, true);
  const elevation = game.tiles.map(tile => tile.elevation), span = points.map(point => structuredClone(tileAt(game, point.x, point.y)));
  for (let day = 1; day <= 80; day++) { game.day = day; stepEcology(game); }
  assert.deepEqual(game.tiles.map(tile => tile.elevation), elevation);
  assert.deepEqual(points.map(point => tileAt(game, point.x, point.y)), span);
});

test('active routes disconnect and resume when an engineered crossing is removed and repaired', () => {
  const game = levelGame(), points = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  game.cities = [7, 17].map((x, index) => ({
    id: `engineering-town-${index}`, name: `Town ${index}`, x, y: 10,
    population: 300, activity: 0, growth: 0, passengers: 80, delivered: 0, supplies: 0, lastServiceDay: null,
  }));
  const a = build(game, 'bus-stop', 10, 10), b = build(game, 'bus-stop', 14, 10);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(addRoute(game, { name: 'Valley crossing', stops: [a.station.id, b.station.id] }).ok, true);
  const route = game.routes[0]; refreshRouteConnections(game);
  assert.equal(route.active, true); assert.deepEqual(route.path, points);
  const revision = game.networkRevision;
  assert.equal(build(game, 'bulldoze', 12, 10).ok, true); assert.ok(game.networkRevision > revision);
  refreshRouteConnections(game); assert.equal(route.active, false); assert.equal(route.status, 'Disconnected');
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  refreshRouteConnections(game); assert.equal(route.active, true); assert.equal(route.status, 'Running');
  assert.deepEqual(route.path, points); assert.equal(validateGame(game), true);
});

test('local saves preserve lowered ground and bridge/tunnel deck metadata', () => withStorage(() => {
  const game = levelGame(), bridge = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', bridge).ok, true);
  const tunnel = prepareSpan(game, 'railtunnel', 'x', {x:20,y:10});
  assert.equal(buildPlan(game, 'railtunnel', tunnel).ok, true);
  assert.equal(build(game, 'lower', 15, 15).ok, true);
  assert.equal(validateGame(game), true); assert.equal(saveGame(game).ok, true);
  const restored = loadGame(); assert.ok(restored); assert.deepEqual(restored.tiles, game.tiles);
  assert.equal(restored.money, game.money);
  assert.deepEqual(findPath(restored, bridge[0], bridge.at(-1)), bridge);
  assert.deepEqual(findPath(restored, tunnel[0], tunnel.at(-1), 'rail'), tunnel);
}));

test('procedural saves keep earthworks and structures as sparse changes to the original generated map', () => {
  const game = createGame({ size: 'square512', seed: 413 });
  const cleared=Array.from({length:90},(_,i)=>({x:i%10,y:Math.floor(i/10)}));
  releaseTerrainObjects(game,cleared);
  for (const point of cleared) Object.assign(tileAt(game, point.x, point.y), {
    terrain: 'grass', elevation: 2 / 7, detail: '',
    road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null,
  });
  const points=prepareSpan(game,'bridge','x',{x:2,y:4});
  assert.equal(buildPlan(game, 'bridge', points).ok, true);
  Object.assign(tileAt(game, 8, 2), { terrain: 'grass', elevation: 4 / 16, road: false, rail: false, building: null, zone: null });
  assert.equal(build(game, 'lower', 8, 2).ok, true);
  const saved = encodeGame(game);
  assert.equal(saved.format, 'transport-procedural-v1'); assert.ok(saved.tiles.count <= 120,'a graded crossing stays a sparse edit to the generated world');
  const restored = restoreGame(JSON.parse(JSON.stringify(saved))); assert.ok(restored);
  assert.deepEqual(restored.tiles, game.tiles);
  assert.deepEqual(findPath(restored, points[0], points.at(-1)), points);
});

test('save validation rejects malformed engineering metadata while preserving untagged old structures', () => {
  const game = levelGame(), points = prepareSpan(game, 'bridge');
  assert.equal(buildPlan(game, 'bridge', points).ok, true); assert.equal(validateGame(game), true);
  const corruptions = [
    tile => { tile.structureLevel = 0; },
    tile => { tile.structureLevel = 17; },
    tile => { tile.structureLevel = 4.5; },
    tile => { tile.structureAxis = 'z'; },
    tile => { delete tile.structureLevel; },
    tile => { delete tile.structureAxis; },
    tile => { tile.bridge = false; },
    tile => { tile.tunnel = true; },
    tile => { tile.road = false; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(game); corrupt(tileAt(invalid, 12, 10));
    assert.equal(validateGame(invalid), false, String(corrupt));
    assert.equal(restoreGame(invalid), null);
  }
  for (const point of points) { delete tileAt(game, point.x, point.y).structureLevel; delete tileAt(game, point.x, point.y).structureAxis; }
  assert.equal(validateGame(game), true, 'old saves with no engineering metadata still load');
});
