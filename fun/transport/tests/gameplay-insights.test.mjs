import test from 'node:test';
import assert from 'node:assert/strict';
import { townService, industryStatus, routeHealth, nextProject } from '../gameplay-insights.js';
import { emptyGame } from './helpers.mjs';

const site = (id, kind, x, inventory = {}) => ({ id, kind, x, y: 12, inventory, capacity: 1 });
const routeGame = () => ({
  day: 10, cities: [], industries: [site('source','logging-camp',10),site('buyer','sawmill',30)],
  stations: [{id:'a',x:10,y:10},{id:'b',x:30,y:10}],
  routes: [{id:'r',active:true,cargo:'timber',stops:['a','b']}], vehicles: [],
});

test('town service distinguishes planned coverage from recent deliveries and uses the real five-tile radius', () => {
  const game=routeGame(),city={x:10,y:15,lastServiceDay:null};
  assert.equal(townService(game,city).label,'Awaiting deliveries');
  city.lastServiceDay=5;assert.equal(townService(game,city).served,true);
  city.y=15.1;assert.equal(townService(game,city).connected,false);
  city.y=15;city.lastServiceDay=-30;assert.equal(townService(game,city).served,false);
  game.routes[0].active=false;assert.equal(townService(game,city).label,'No service');
});

test('factory explanations identify every missing ingredient and distinguish full stock from production', () => {
  const mill=site('mill','steel-mill',10,{coal:100});
  assert.deepEqual(industryStatus(mill).missing,['iron']);
  mill.inventory.iron=.01;assert.equal(industryStatus(mill).state,'producing','fractional recipes can operate');
  mill.inventory.steel=900;assert.equal(industryStatus(mill).state,'full');
  mill.capacity=2;assert.equal(industryStatus(mill).state,'producing','capacity also controls storage');
});

test('route diagnostics explain missing customers, empty sources and blocked processing', () => {
  const game=routeGame(),route=game.routes[0];
  assert.equal(routeHealth(game,route).label,'Waiting for cargo');
  game.vehicles.push({routeId:'r',load:10});assert.equal(routeHealth(game,route).state,'running');
  game.industries[1].inventory.timber=900;assert.equal(routeHealth(game,route).label,'Buyer full');
  game.industries.pop();assert.equal(routeHealth(game,route).label,'No buyer');
  game.industries=[];assert.equal(routeHealth(game,route).label,'No producer');
  route.active=false;assert.equal(routeHealth(game,route).label,'Disconnected');
});

test('a processing route points back to its missing input instead of recommending more vehicles', () => {
  const game=routeGame();game.routes[0].cargo='steel';
  game.industries=[site('source','steel-mill',10,{coal:5}),site('buyer','machine-works',30)];
  assert.equal(routeHealth(game,game.routes[0]).label,'Needs inputs');
  assert.match(routeHealth(game,game.routes[0]).detail,/iron/);
});

test('optional projects progress through deliberate freight and town building, not passive starter bus revenue', () => {
  const game=emptyGame();game.cities=[{id:'home',name:'Home',x:15,y:12}];
  game.industries=[site('source','logging-camp',10),site('buyer','sawmill',30)];
  game.totalDelivered=10000;game.routes=[{cargo:'passengers',delivered:10000}];
  assert.equal(nextProject(game).target,'source');
  game.routes.push({cargo:'timber',delivered:10});assert.match(nextProject(game).title,/100/);
  game.routes[1].delivered=100;assert.equal(nextProject(game).action,'chains');
  game.routes.push({cargo:'lumber',delivered:1});assert.equal(nextProject(game).action,'towns');
  game.zones.push({x:1,y:1});assert.equal(nextProject(game).action,'atlas');
});
