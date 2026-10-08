import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildProblem, buildPath, addRoute, tick, createGame, validateGame, restoreGame, expandWorkshop, stationCoverage } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { constructionDuration, constructionState, isUnderConstruction, stepBuildingConstruction } from '../building-construction.js';
import { housingCapacity } from '../settlements.js';
import { localEnvironment } from '../environment.js';
import { propertyAt, workshopLevels, stepWorkshops } from '../town-market.js';
import { stepIndustries } from '../industry-simulation.js';
import { forecastRoute } from '../route-planner.js';
import { stepContracts } from '../contracts.js';
import { emptyGame, tileAt, line, equivalent } from './helpers.mjs';

const town = (game, x = 30, y = 30) => { const built = build(game, 'city', x, y); assert.ok(built.ok, built.message); return built.city; };
const placed = (game, kind, x, y) => { const outcome = build(game, kind, x, y); assert.ok(outcome.ok, outcome.message); return outcome; };
const clone = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));

test('duration reflects scale and complexity, with industry at most one year', () => {
  assert.equal(constructionDuration('house-cheap-1'), 60);
  assert.equal(constructionDuration('house-normal-1'), 90);
  assert.equal(constructionDuration('house-expensive-1'), 120);
  assert.equal(constructionDuration('shop-grocery'), 90);
  assert.equal(constructionDuration('hospital'), 240);
  assert.equal(constructionDuration('stadium'), 300);
  assert.equal(constructionDuration('farm'), 180);
  assert.equal(constructionDuration('equipment-factory'), 360);
  assert.equal(constructionDuration('factory', {level:3}), 300);
});

test('a paid home reserves its plot immediately, adds no people or rent, and completes once', () => {
  const game = emptyGame(), city = town(game), before = city.population, money = game.money;
  const {building, cost} = placed(game, 'house-cheap-1', 32, 32);
  assert.equal(game.money, money - cost);
  assert.equal(city.population, before);
  assert.equal(housingCapacity(building), 0);
  assert.equal(propertyAt(game, 32, 32).rent, 0);
  assert.ok(buildProblem(game, 'road', 32, 32));
  const start = structuredClone(building.construction);
  assert.equal(constructionState(game, building).stage, 'excavation');
  tick(game, 0); assert.deepEqual(building.construction, start, 'paused time does not advance');
  tick(game, 18); assert.equal(constructionState(game, building).stage, 'frame');
  tick(game, 30); assert.equal(constructionState(game, building).stage, 'finishing');
  tick(game, 11.75); assert.equal(city.population, before); assert.equal(propertyAt(game, 32, 32).rent, 0);
  tick(game, .25);
  assert.equal(constructionState(game, building), null); assert.equal(city.population, before + 12);
  assert.equal(housingCapacity(building), 12); assert.ok(propertyAt(game, 32, 32).rent > 0);
  tick(game, 1); assert.equal(city.population, before + 12, 'completion cannot add residents twice');
  assert.equal(game.notifications.filter(n => /Workers’ cottage completed/.test(n.message)).length, 1);
  assert.equal(validateGame(game), true);
});

test('a civic site provides services only after completion and all its tiles stay reserved', () => {
  const game = emptyGame(); town(game);
  const before = localEnvironment(game, 34, 34).hospital;
  const {building} = placed(game, 'hospital', 34, 34);
  assert.equal(localEnvironment(game, 34, 34).hospital, before);
  assert.ok(buildProblem(game, 'road', 35, 35));
  game.day = building.construction.completeDay; stepBuildingConstruction(game);
  assert.ok(localEnvironment(game, 34, 34).hospital > before);
});

test('a workshop opens after construction; an expansion closes it temporarily and keeps its stores', () => {
  const game = emptyGame(), city = town(game);
  const {building} = placed(game, 'workshop', 33, 33);
  city.workshop = {input:{lumber:100},output:{furniture:20}};
  assert.equal(workshopLevels(game, city), 0);
  stepWorkshops(game); assert.equal(city.workshop.input.lumber, 100);
  assert.equal(expandWorkshop(game, 33, 33).ok, false);
  tick(game, 180);
  assert.equal(workshopLevels(game, city), 1);
  const stock = structuredClone(city.workshop);
  assert.equal(expandWorkshop(game, 33, 33).ok, true);
  assert.equal(workshopLevels(game, city), 0);
  stepWorkshops(game); assert.deepEqual(city.workshop, stock);
  game.day = building.construction.completeDay; stepBuildingConstruction(game);
  assert.equal(workshopLevels(game, city), 2);
  stepWorkshops(game); assert.ok(city.workshop.input.lumber < stock.input.lumber);
});

test('industries can be connected and planned while building, but cannot load, accept or produce freight', () => {
  const game = emptyGame();
  const camp = placed(game, 'logging-camp', 10, 10).industry;
  const mill = placed(game, 'sawmill', 32, 10).industry;
  buildPath(game, 'road', line(12, 34, 16));
  const a = placed(game, 'bus-stop', 12, 16).station, b = placed(game, 'bus-stop', 34, 16).station;
  assert.ok(stationCoverage(game, a).produces.includes('timber'));
  assert.ok(stationCoverage(game, b).accepts.includes('timber'));
  const draft = {mode:'road', cargo:'timber', from:a.id, to:b.id, vehicleCount:1};
  const waiting = forecastRoute(game, draft);
  assert.equal(waiting.revenueMonth, 0); assert.equal(waiting.movedDay, 0);
  assert.equal(waiting.constructionUntil, mill.construction.completeDay);
  assert.match(waiting.constructionNote, /revenue is zero/);
  assert.equal(forecastRoute(game, {...draft,fullLoad:true}).upkeepMonth, waiting.upkeepMonth, 'a closed source cannot hold vehicles for a full load');
  camp.inventory.timber = 100;
  const launched = addRoute(game, {mode:'road', stops:[a.id,b.id], cargo:'timber'}); assert.ok(launched.ok, launched.message);
  const vehicle = game.vehicles[0]; assert.equal(vehicle.load, 0);
  vehicle.load = 20; vehicle.direction = 1; vehicle.progress = launched.route.path.length - 1.01;
  tick(game, .1); assert.equal(mill.received, 0); assert.equal(vehicle.load, 20);
  game.day = camp.construction.completeDay - 1; stepIndustries(game);
  assert.equal(camp.totalProduced, 0); assert.equal(mill.totalProduced, 0);
  camp.inventory.timber = 0;
  game.day++; stepBuildingConstruction(game); stepIndustries(game);
  assert.equal(camp.totalProduced, 0, 'no catch-up output on opening day');
  game.day++; stepIndustries(game); assert.ok(camp.totalProduced > 0 && camp.totalProduced < 100);
  assert.ok(isUnderConstruction(mill), 'the processing factory takes longer');
  assert.equal(camp.openedDay, 180); assert.equal(mill.openedDay, undefined);
  game.day = mill.construction.completeDay; stepBuildingConstruction(game);
  const operating = forecastRoute(game, {...draft, editing:launched.route.id});
  assert.equal(operating.constructionUntil, undefined); assert.ok(operating.revenueMonth > 0);
});

test('pending projects round-trip, old generated buildings remain complete, and malformed projects are rejected', () => {
  const game = emptyGame(); town(game);
  placed(game, 'house-expensive-1', 32, 32); placed(game, 'steel-mill', 58, 58);
  tick(game, 41.5);
  const restored = clone(game); assert.ok(restored); assert.deepEqual(restored.tiles, game.tiles); assert.deepEqual(restored.industries, game.industries);
  tick(game, 80); for(let n=0;n<320;n++)tick(restored,.25);
  equivalent(restored.cities, game.cities); assert.deepEqual(restored.tiles, game.tiles);
  const existing = createGame({size:'regional'}); assert.ok(existing.tiles.some(tile=>tile.building));
  assert.ok(existing.tiles.every(tile=>!isUnderConstruction(tile.building)) && existing.industries.every(site=>!isUnderConstruction(site)));
  const corrupted = clone(game), site = corrupted.industries.at(-1);
  site.construction.completeDay += 1; assert.equal(validateGame(corrupted), false);
});

test('demolishing a pending home does not remove residents or later complete a ghost project', () => {
  const game = emptyGame(), city = town(game), before = city.population;
  placed(game, 'house-cheap-1', 32, 32);
  placed(game, 'bulldoze', 32, 32);
  assert.equal(city.population, before);
  tick(game, 90); assert.equal(city.population, before); assert.equal(tileAt(game,32,32).building, null);
});


test('unfinished industries charge construction upfront and operating upkeep only after opening', () => {
  const game = emptyGame(), {industry} = placed(game, 'logging-camp', 20, 20), money = game.money;
  tick(game, 179);
  assert.equal(game.money, money, 'the paid site has no operating staff while being built');
  tick(game, 1);
  assert.equal(isUnderConstruction(industry), false);
  assert.ok(game.money < money, 'operating upkeep starts on opening day');
});


test('contracts wait for both a producer and its industrial buyer to open', () => {
  const game = emptyGame();
  const camp = placed(game, 'logging-camp', 20, 20).industry, mill = placed(game, 'sawmill', 45, 20).industry;
  camp.owner = mill.owner = 'world'; game.contracts = [];
  stepContracts(game, stationCoverage); assert.equal(game.contracts.length, 0);
  game.day = camp.construction.completeDay; stepBuildingConstruction(game);
  stepContracts(game, stationCoverage); assert.equal(game.contracts.length, 0, 'the buyer is still a building site');
  game.day = mill.construction.completeDay; stepBuildingConstruction(game);
  stepContracts(game, stationCoverage); assert.equal(game.contracts.length, 1);
  assert.equal(game.contracts[0].sourceId, camp.id); assert.equal(game.contracts[0].target.id, mill.id);
});
