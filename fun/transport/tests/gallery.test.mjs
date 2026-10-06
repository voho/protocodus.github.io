import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { BIOMES, INDUSTRIES, WORKSHOP, WORKSHOP_RECIPES, TOWN_CARGO } from '../data.js';
import { MARKET, OUTLET, familyCargo } from '../town-market.js';
import { housingCapacity } from '../settlements.js';
import { NATURE_ART_CATALOG } from '../raster-nature.js';
import { galleryCatalog, filterGallery, cargoConsumers, galleryBuildState, galleryDetails } from '../catalog-data.js';
const entries = galleryCatalog(), entry = id => entries.find(item => item.id === id);
const game = biome => ({ biome, day: 0, seed: 1847, money: 400000, routes: [], vehicles: [] });

test('gallery covers every building and industry, keeping the model identity and footprint', () => {
  assert.equal(entries.length, 185);
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  for (const [kind, d] of Object.entries(BUILDINGS)) {
    const found = entry(`building:${kind}`);
    assert.equal(found.name, d.name); assert.equal(found.footprint, d.footprint); assert.equal(found.cost, d.cost); assert.equal(found.tool, kind);
  }
  for (const [kind, d] of Object.entries(INDUSTRIES)) {
    const found = entry(`industry:${kind}`);
    assert.equal(found.footprint, 5); assert.equal(found.inputs, d.inputs); assert.equal(found.outputs, d.outputs); assert.deepEqual(found.biomes, d.biomes);
  }
  for (const id of ['building:factory', 'transport:bus-stop', 'transport:airport-x', 'vehicle:truck', 'nature:forest', 'nature:rock', 'nature:mountain', 'cargo:food']) assert.ok(entry(id), id);
});

test('landscape collection covers every active nature atlas identity', () => {
  const identities = new Set(entries.flatMap(e => Object.values(e.art.atlas || {})));
  for (const [biome, kinds] of Object.entries(NATURE_ART_CATALOG.trees)) for (const kind of kinds) assert.ok(identities.has(`nature-trees-${biome}:${kind}`));
  for (const [biome, kinds] of Object.entries(NATURE_ART_CATALOG.ground)) for (const kind of kinds) assert.ok(identities.has(`nature-ground-${biome}:${kind}`));
  for (const kind of NATURE_ART_CATALOG.mountains) assert.ok(identities.has(`nature-mountains:${kind}`));
  for (const kind of NATURE_ART_CATALOG.rocks) assert.ok(identities.has(`nature-rocks:${kind}`));
  assert.equal(identities.size, 72);
  assert.ok(Object.isFrozen(NATURE_ART_CATALOG.trees.taiga));
});

test('search combines cargo names with category and climate without losing inaccessible entries from all-climates view', () => {
  const grain = filterGallery(entries, { category: 'industry', climate: 'taiga', query: 'grain' });
  assert.ok(grain.some(e => e.kind === 'food-plant')); assert.ok(grain.some(e => e.kind === 'dairy-farm'));
  assert.ok(grain.every(e => e.category === 'industry' && e.biomes.includes('taiga')));
  assert.equal(filterGallery(entries, { climate: 'tundra', query: 'dairy farm' }).length, 0);
  assert.equal(filterGallery(entries, { climate: 'all', query: 'dairy farm' }).length, 1);
  assert.equal(filterGallery(entries, { query: 'DOES NOT EXIST' }).length, 0);
});

test('house capacities and potential monthly contribution use real housing and market rules in every climate', () => {
  for (const biome of Object.keys(BIOMES)) for (const e of entries.filter(e => e.category === 'homes')) {
    const detail = galleryDetails(game(biome), e, biome), facts = new Map(detail.stats), residents = housingCapacity({ kind: e.kind, level: 1 });
    assert.equal(facts.get('Residents at levels 1, 2 and 3'), [1, 2, 3].map(level => housingCapacity({ kind: e.kind, level })).join(', '));
    for (const [family, rate] of Object.entries(MARKET.perResident)) assert.equal(facts.get(`Potential ${family === 'household' ? 'household cargo' : family} a month at level 1`), Math.round(residents * rate * 100) / 100);
    assert.ok(detail.notes.some(n => n.includes('town pool')));
    assert.ok(detail.notes.some(n => n.includes('outlet reach')));
    assert.ok(detail.notes.some(n => familyCargo({ biome }, 'household').every(c => n.includes(c === 'furniture' ? 'Furniture' : 'Goods'))));
  }
});

test('downstream connections are actual recipes, town acceptance and modeled outlets; cafés and pharmacies do not invent freight', () => {
  for (const biome of Object.keys(BIOMES)) for (const source of Object.values(INDUSTRIES).filter(d => d.biomes.includes(biome))) for (const cargo of Object.keys(source.outputs)) {
    for (const target of cargoConsumers(cargo, biome)) {
      if (target.id.startsWith('industry:')) assert.ok(INDUSTRIES[target.id.slice(9)].inputs[cargo] > 0);
      else if (target.id === 'building:factory') assert.ok(WORKSHOP_RECIPES[biome].some(r => r.input === cargo));
      else if (target.id === 'transport:city') assert.ok(TOWN_CARGO.includes(cargo));
      else {
        const kind = target.id.slice(9), d = BUILDINGS[kind], families = d.outlets ? Object.keys(d.outlets) : [OUTLET[kind]];
        assert.ok(families.some(f => familyCargo({ biome }, f).includes(cargo)));
      }
    }
  }
  const retail = cargoConsumers('food', 'taiga').map(e => e.id);
  assert.ok(retail.includes('building:shop-grocery')); assert.ok(retail.includes('building:mall-modern'));
  assert.ok(!retail.includes('building:shop-cafe')); assert.ok(!retail.includes('building:shop-pharmacy'));
  assert.ok(cargoConsumers('lumber', 'taiga').some(e => e.id === 'building:factory'));
  assert.ok(!cargoConsumers('grain', 'taiga').some(e => e.id === 'transport:city'));
  assert.deepEqual(cargoConsumers('passengers', 'taiga').map(e => e.id), ['transport:city']);
  assert.ok(galleryDetails(game('taiga'), entry('cargo:furniture')).consumers.find(group => group.incoming).entries.some(e => e.id === 'building:factory'));
});

test('workshop shows climate recipes and shared processing allowance; inactive climate and locked aircraft do not offer construction', () => {
  for (const biome of Object.keys(BIOMES)) {
    const d = galleryDetails(game(biome), entry('building:factory'), biome);
    assert.deepEqual(d.recipes, WORKSHOP_RECIPES[biome].map(r => ({ inputs: { [r.input]: WORKSHOP.ratio }, outputs: { [r.output]: 1 } })));
    assert.equal(new Map(d.stats).get('Materials processed each day per level'), WORKSHOP.rate);
    assert.ok(d.notes.some(n => n.includes('share')));
  }
  assert.equal(galleryBuildState(game('tundra'), entry('industry:dairy-farm')).available, false);
  assert.equal(galleryBuildState(game('taiga'), entry('transport:airport-x')).available, false);
  assert.equal(galleryBuildState({ ...game('taiga'), day: 731 }, entry('transport:airport-x')).available, true);
  assert.equal(galleryBuildState(game('taiga'), entry('vehicle:truck')).available, false);
});

test('viewing the whole catalog in any preview climate does not modify the company', () => {
  const state = game('taiga'), before = JSON.stringify(state);
  for (const e of entries) for (const biome of e.biomes) {
    galleryDetails(state, e, biome); galleryBuildState(state, e);
  }
  assert.equal(JSON.stringify(state), before);
});
