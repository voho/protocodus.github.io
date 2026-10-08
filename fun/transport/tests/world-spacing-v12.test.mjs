import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld, WORLD_GENERATION_VERSION } from '../world.js';
import { build, buildPath, addRoute, stationCoverage, restoreGame, validateGame, tick } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { siteGap, relatedIndustries, industryDistance, industrySpacingProblem, townSpacingProblem, MIN_SITE_GAP, MIN_CONNECTION_LENGTH } from '../industry-sites.js';
import { STATION_RADIUS, AIRPORT_REACH, stationReach, stationServes } from '../station-sites.js';
import { openingSiteProblem } from '../industry-openings.js';
import { emptyGame, line, completeFixtureConstruction } from './helpers.mjs';

const frozen11={taiga:'dd01470c49a07a44cc025a2b10f33a0e5c89675a5b4af144e0eae1848cc661b7',tundra:'fc6429a2afefc865ac00544af358b9bb7da6ac381e326162b9cbfd861d702316',desert:'72a90c4e6cd14a407c7a473345b4c32d92093bbf51d9873af71d6117f4812c38'};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ok=result=>assert.equal(result.ok,true,result.message);
const stopSites=site=>{
  const sites=[],size=site.footprint||1;
  for(let y=site.y-STATION_RADIUS;y<site.y+size+STATION_RADIUS;y++)for(let x=site.x-STATION_RADIUS;x<site.x+size+STATION_RADIUS;x++){
    const point={x,y};if(industryDistance(site,point)<=STATION_RADIUS)sites.push(point);
  }
  return sites;
};
const shortestRoad=(a,b)=>Math.min(...stopSites(a).map(start=>Math.min(...stopSites(b).map(end=>Math.abs(end.x-start.x)+Math.abs(end.y-start.y)))));

for(const biome of ['taiga','tundra','desert']){
  test(`${biome}: recipe 11 remains byte-exact after recipe 12 adds journey spacing`,()=>{
    assert.equal(digest(generateWorld(biome,1847,'square512',11)),frozen11[biome]);
  });
  test(`${biome}: sparse and crowded recipe 12 worlds reserve five road edges beyond both catchments`,()=>{
    assert.equal(WORLD_GENERATION_VERSION,12);
    for(const [seed,options] of [[1847,{townCount:2,industryDistricts:1}],[9731,{townCount:96,industryDistricts:16}]]){
      const world=generateWorld(biome,seed,'square512',12,options);
      assert.equal(world.cities.length,options.townCount);
      const pairs=[];
      for(const [i,city] of world.cities.entries()){
        for(const other of world.cities.slice(i+1))pairs.push([city,other]);
        for(const industry of world.industries)pairs.push([city,industry]);
      }
      for(const [i,industry] of world.industries.entries())for(const other of world.industries.slice(i+1))if(relatedIndustries(industry.kind,other.kind))pairs.push([industry,other]);
      // Euclidean distance is a lower bound on every orthogonal road. Subtract
      // the two radius-four catchments before requiring the five-edge journey.
      for(const [a,b] of pairs)assert.ok(siteGap(a,b)>=MIN_SITE_GAP,`${seed}: ${a.name} and ${b.name} leave ${siteGap(a,b)-STATION_RADIUS*2} travel tiles`);
      const closest=pairs.sort((a,b)=>siteGap(...a)-siteGap(...b)).slice(0,8);
      for(const pair of closest)assert.ok(shortestRoad(...pair)>=MIN_CONNECTION_LENGTH,'enumerate every possible pair of serving stops near the closest sites');
      if(options.townCount===2)assert.equal(digest(generateWorld(biome,seed,'square512',12,options)),digest(world),'new recipe is deterministic');
    }
  });
}

test('new town and related-industry placement reserve full plots and both stop ranges',()=>{
  const game=emptyGame();ok(build(game,'logging-camp',20,20));
  const source=game.industries[0];
  for(const [x,y] of [[36,20],[20,36],[31,31]])assert.match(industrySpacingProblem(game,'sawmill',x,y),/5-tile road/);
  assert.equal(industrySpacingProblem(game,'sawmill',37,20),null);
  const target={x:37,y:20,footprint:5};assert.equal(shortestRoad(source,target),5);
  const before=JSON.stringify(game);assert.equal(build(game,'sawmill',36,20).ok,false);assert.equal(JSON.stringify(game),before);
  ok(build(game,'sawmill',37,20));
  assert.match(townSpacingProblem(game,20,36),/5-tile road/);ok(build(game,'city',20,37));
  assert.match(townSpacingProblem(game,20,49),/5-tile road/);assert.equal(townSpacingProblem(game,20,50),null);
  ok(build(game,'city',20,50));
  assert.match(industrySpacingProblem(game,'oil-well',20,62),/5-tile road/);
  // Opening industries use the same placement gate as player construction.
  assert.equal(openingSiteProblem(game,'farm',30,50),'spacing');
});

test('ordinary stops cover four tiles while airports retain their existing reach',()=>{
  assert.equal(STATION_RADIUS,4);assert.equal(AIRPORT_REACH,7);
  for(const mode of ['road','rail','water']){
    assert.equal(stationServes({mode,x:20,y:20},{x:24,y:20}),true);
    assert.equal(stationServes({mode,x:20,y:20},{x:25,y:20}),false);
  }
  assert.equal(stationReach({mode:'air',axis:'x'}),7);
  assert.equal(stationServes({mode:'air',axis:'x',x:20,y:20},{x:32,y:20}),true);
});

test('old saves preserve working five-tile stops and new stops retain four-tile coverage after reload',()=>{
  const game=emptyGame();ok(build(game,'oil-well',10,20));ok(build(game,'refinery',30,20));
  completeFixtureConstruction(game,...game.industries);
  ok(buildPath(game,'road',line(19,25,20)));
  for(const x of [19,25]){const placed=build(game,'bus-stop',x,20);ok(placed);placed.station.catchmentRadius=5;}
  const route=addRoute(game,{mode:'road',cargo:'oil',stops:game.stations.map(stop=>stop.id)});ok(route);
  delete game.stationReachVersion;for(const stop of game.stations)delete stop.catchmentRadius;
  const geography=structuredClone([game.tiles,game.cities,game.industries]),beforeMoney=game.money;
  const loaded=restoreGame(encodeGame(game));assert.ok(loaded&&validateGame(loaded));
  assert.deepEqual([loaded.tiles,loaded.cities,loaded.industries],geography,'loading never relocates the saved geography');
  assert.equal(loaded.money,beforeMoney);
  for(const stop of loaded.stations){assert.equal(stationReach(stop),5);assert.equal(stationCoverage(loaded,stop).industries.length,1);}
  ok(build(loaded,'bus-stop',19,21));const added=loaded.stations.at(-1);
  assert.equal(stationReach(added),4);assert.deepEqual(stationCoverage(loaded,added).industries,[]);
  const again=restoreGame(encodeGame(loaded));assert.ok(again&&validateGame(again));
  assert.deepEqual(again.stations.map(stationReach),[5,5,4]);
  for(let step=0;step<40;step++)tick(again,.25);
  assert.ok(again.routes[0].delivered>0,'the pre-existing freight service still reaches both plants');
  assert.match(industrySpacingProblem(again,'refinery',27,20,5,[again.industries[0]]),/5-tile road/,'a new related site also accounts for the old source stop’s extra reach');
});
