import test from 'node:test';
import assert from 'node:assert/strict';
import {build,buildPath,addRoute,tick,stationCoverage,drainDeliveryEvents,validateGame,restoreGame} from '../model.js';
import {INDUSTRIES,TOWN_CARGO} from '../data.js';
import {stepIndustries} from '../industry-simulation.js';
import {industryTiles} from '../industry-sites.js';
import {productionChain,findIndustryTargets} from '../chains.js';
import {routeCargoList,validateRoutePlan,forecastRoute} from '../route-planner.js';
import {paymentRateSeries} from '../payment-rates.js';
import {ensureMarket,townLedger} from '../town-market.js';
import {cargoIcon} from '../cargo-icons.js';
import {encodeGame} from '../save-codec.js';
import {emptyGame,line,equivalent} from './helpers.mjs';

const newKinds=['dairy-farm','vegetable-farm','orchard','livestock-farm','dairy-plant','cannery','meat-packer'];
const inputs=['milk','produce','livestock'];
const ok=result=>assert.equal(result.ok,true,result.message);

test('new farms and processors reserve their full fields and factory sites and expose usable food chains',()=>{
  for(const biome of ['taiga','desert']){
    const game=emptyGame(biome);
    for(let i=0;i<newKinds.length;i++){
      const result=build(game,newKinds[i],10+i*13,20);ok(result);
      assert.equal(result.industry.owner,'player');assert.equal(industryTiles(result.industry).length,25);
    }
    const graph=productionChain(biome,'food');
    for(const kind of newKinds)assert.ok(graph.nodes.some(node=>node.kind===kind),`${biome} food graph includes ${kind}`);
    for(const [source,target,cargo]of [['farm','dairy-farm','grain'],['dairy-farm','dairy-plant','milk'],['vegetable-farm','cannery','produce'],['orchard','cannery','produce'],['farm','livestock-farm','grain'],['livestock-farm','meat-packer','livestock']])assert.ok(graph.edges.some(edge=>edge.from===source&&edge.to===target&&edge.cargo===cargo));
    for(const processor of ['dairy-plant','cannery','meat-packer'])assert.ok(graph.edges.some(edge=>edge.from===processor&&edge.to==='towns'&&edge.cargo==='food'));
  }
});

test('feed and processing conserve every new recipe input and cannot manufacture output without supply',()=>{
  for(const kind of ['dairy-farm','livestock-farm','dairy-plant','cannery','meat-packer']){
    const game=emptyGame(),result=build(game,kind,20,20);ok(result);const site=result.industry,def=INDUSTRIES[kind];
    Object.assign(site,{lastProductionDay:0,nextProductionDay:1,nextReviewDay:1000});game.day=1;stepIndustries(game);
    assert.equal(site.totalProduced,0,`${kind} waits for its input`);
    for(const [cargo,amount]of Object.entries(def.inputs))site.inventory[cargo]=amount*10;
    Object.assign(site,{nextProductionDay:2});game.day=2;stepIndustries(game);
    assert.ok(site.totalProduced>0,`${kind} processes supplied cargo`);
    const batches=site.totalProduced/Object.values(def.outputs).reduce((sum,n)=>sum+n,0);
    for(const [cargo,amount]of Object.entries(def.inputs))assert.ok(Math.abs(site.inventory[cargo]-(10-batches)*amount)<1e-8,`${kind} consumes ${cargo} exactly`);
    for(const [cargo,amount]of Object.entries(def.outputs))assert.ok(Math.abs(site.inventory[cargo]-batches*amount)<1e-8,`${kind} makes ${cargo} exactly`);
  }
  for(const kind of ['vegetable-farm','orchard']){
    const game=emptyGame(),result=build(game,kind,20,20);ok(result);
    Object.assign(result.industry,{lastProductionDay:0,nextProductionDay:1,nextReviewDay:1000});game.day=1;stepIndustries(game);
    assert.ok(result.industry.inventory.produce>0,`${kind} harvests fruit or vegetables without an imported input`);
  }
});

function foodFixture(farm,processor,cargo){
  const game=emptyGame(),fed=Object.keys(INDUSTRIES[farm].inputs).length>0;
  if(fed)ok(build(game,'farm',10,5));
  const sourceX=fed?30:10,plantX=sourceX+20,townX=plantX+30;
  ok(build(game,farm,sourceX,5));ok(build(game,processor,plantX,7));
  ok(build(game,'city',townX,12));ok(buildPath(game,'road',line(10,townX,12)));
  ok(build(game,'shop-grocery',townX+1,11));ok(build(game,'shop-bakery',townX+3,11));
  for(const x of [...fed?[10]:[],sourceX,plantX,townX])ok(build(game,'bus-stop',x,12));
  const byX=x=>game.stations.find(stop=>stop.x===x).id,routes=[];
  if(fed){const feed=addRoute(game,{mode:'road',cargo:'grain',stops:[byX(10),byX(sourceX)]});ok(feed);routes.push(feed.route);}
  const ingredient=addRoute(game,{mode:'road',cargo,stops:[byX(sourceX),byX(plantX)]});ok(ingredient);routes.push(ingredient.route);
  const final=addRoute(game,{mode:'road',cargo:'food',stops:[byX(plantX),byX(townX)]});ok(final);routes.push(final.route);
  const city=game.cities[0];ensureMarket(game,city);
  return{game,city,routes,ingredient:ingredient.route,final:final.route};
}

for(const [farm,processor,cargo]of [['dairy-farm','dairy-plant','milk'],['vegetable-farm','cannery','produce'],['livestock-farm','meat-packer','livestock']])test(`${farm} → ${processor} → town shops transports ingredients and earns food demand bonuses`,()=>{
  const {game,city,routes,ingredient,final}=foodFixture(farm,processor,cargo),outlet=townLedger(game,city,new Map());
  assert.equal(outlet.outlets.food,2,'the grocer and bakery are both food outlets');
  const [from,to]=ingredient.stops;
  assert.ok(validateRoutePlan(game,{mode:'road',cargo,from,to}).valid);
  assert.ok(forecastRoute(game,{mode:'road',cargo,from,to,vehicleCount:1}).movedDay>=0,'the route forecast supports the new ingredient');
  assert.ok(stationCoverage(game,game.stations.at(-1)).accepts.includes('food'));
  for(const raw of inputs)assert.equal(stationCoverage(game,game.stations.at(-1)).accepts.includes(raw),false,'shops require the processed food');
  let maximumSupply=0,paidFood=0;
  for(let step=0;step<180*4;step++){
    tick(game,.25);maximumSupply=Math.max(maximumSupply,city.market.supplied.food);
    for(const event of drainDeliveryEvents(game))if(event.cargo==='food')paidFood+=event.amount;
  }
  assert.ok(routes.every(route=>route.delivered>0),'every feed, ingredient and shop delivery leg runs');
  assert.ok(paidFood>0&&maximumSupply>0,'processed food reaches the shops');
  assert.ok(final.marketBonus>0,'wanted food earns the existing shop demand premium');
  assert.ok(city.lastSupply.food>0&&city.supplies>0);
  assert.ok(validateGame(game));
});

test('new cargo has distinct icons, time-sensitive rates and consumers while optional factories survive saves',()=>{
  const {game}=foodFixture('dairy-farm','dairy-plant','milk');
  for(const cargo of inputs){
    assert.ok(routeCargoList(game).includes(cargo));assert.ok(paymentRateSeries(game).some(series=>series.cargo===cargo&&series.full>0));
    assert.ok(cargoIcon(cargo).includes(`data-cargo-icon="${cargo}"`));assert.notEqual(cargoIcon(cargo).split('</title>')[1],cargoIcon('goods').split('</title>')[1],'the pictogram has its own artwork rather than the generic crates fallback');
    assert.equal(TOWN_CARGO.includes(cargo),false);
  }
  tick(game,23.75);
  const before=structuredClone(game),saved=encodeGame(game),loaded=restoreGame(JSON.parse(JSON.stringify(saved)));
  assert.ok(loaded&&validateGame(loaded));
  assert.ok(loaded.industries.some(site=>site.kind==='dairy-farm')&&loaded.industries.some(site=>site.kind==='dairy-plant'));
  assert.ok(findIndustryTargets(loaded,loaded.industries.find(site=>site.kind==='dairy-farm')).some(target=>target.cargo.includes('milk')));
  tick(game,17.25);tick(loaded,17.25);
  // Save restore rebuilds transient revision/caches; compare the authoritative
  // production, transport and market state rather than cache bookkeeping.
  for(const key of ['industries','vehicles','cities','money','totalDelivered','totalRevenue'])equivalent(loaded[key],game[key],key);
  assert.ok(before.industries.some(site=>site.inventory.milk!==undefined));
});
