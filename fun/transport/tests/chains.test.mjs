import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRIES } from '../data.js';
import { chainProducts, defaultChainProduct, findIndustryTargets, industryCatalog, nearestTown, productionChain } from '../chains.js';

test('complex desert goods trace every raw source, shared refinery and town delivery', () => {
  const graph = productionChain('desert', 'goods');
  assert.deepEqual(new Set(graph.nodes.map(node => node.kind)), new Set(['oil-well', 'refinery', 'sand-pit', 'glassworks', 'copper-mine', 'wire-mill', 'quarry', 'cement-works', 'goods-factory', 'towns']));
  assert.equal(graph.nodes.find(node => node.kind === 'goods-factory').level, 3);
  assert.equal(graph.nodes.find(node => node.kind === 'towns').level, 4);
  assert.equal(graph.edges.filter(edge => edge.to === 'goods-factory').length, 3);
  assert.ok(graph.edges.some(edge => edge.from === 'refinery' && edge.to === 'glassworks' && edge.cargo === 'fuel'));
  assert.deepEqual(graph.edges.filter(edge => edge.to === 'towns').map(edge => edge.cargo), ['goods']);
});

test('every biome catalog is complete and each node input has an upstream edge', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const graph = productionChain(biome);
    assert.equal(graph.nodes.filter(node => node.kind !== 'towns').length, industryCatalog(biome).length);
    for (const node of graph.nodes.filter(node => node.kind !== 'towns')) {
      for (const cargo of Object.keys(node.definition.inputs)) assert.ok(graph.edges.some(edge => edge.to === node.kind && edge.cargo === cargo));
      assert.ok(graph.nodes.some(candidate => candidate.kind === node.kind));
      const product = defaultChainProduct(biome, node.kind);
      assert.ok(productionChain(biome, product).nodes.some(candidate => candidate.kind === node.kind));
    }
    for (const edge of graph.edges) assert.ok(graph.nodes.find(node => node.kind === edge.from).level < graph.nodes.find(node => node.kind === edge.to).level);
    for (const cargo of chainProducts(biome)) assert.ok(productionChain(biome, cargo).nodes.length);
  }
});

test('upstream graphs omit unrelated recipes and never create a false town consumer', () => {
  const graph = productionChain('taiga', 'steel');
  assert.deepEqual(new Set(graph.nodes.map(node => node.kind)), new Set(['iron-mine', 'coal-mine', 'steel-mill']));
  assert.deepEqual(productionChain('desert', 'steel').nodes, []);
  assert.deepEqual(productionChain('taiga', 'not-a-resource').edges, []);
});

test('coal consumers are the five closest steel mills, not arbitrary nearby buildings', () => {
  const source = { id: 'source', kind: 'coal-mine', name: 'Coal mine', x: 0, y: 0 };
  const consumers = Array.from({ length: 8 }, (_, index) => ({ id: `mill-${index}`, kind: 'steel-mill', name: `Steel mill ${index}`, x: 12 - index, y: 0 }));
  const game = { industries: [source, ...consumers, { id: 'other', kind: 'farm', x: 1, y: 0 }], cities: [{ id: 'town', name: 'Town', x: 0, y: 1 }] };
  const targets = findIndustryTargets(game, source);
  assert.equal(targets.length, 5);
  assert.deepEqual(targets.map(target => target.distance), [5, 6, 7, 8, 9]);
  assert.ok(targets.every(target => target.kind === 'industry' && target.cargo.length === 1 && target.cargo[0] === 'coal'));
});

test('fuel targets include both consuming industries and towns with stable distance order', () => {
  const source = { id: 'oil', kind: 'refinery', name: 'Refinery', x: 5, y: 5 };
  const game = { industries: [source, { id: 'machine', kind: 'machine-works', name: 'Machine works', x: 8, y: 9 }, { id: 'steel', kind: 'steel-mill', x: 6, y: 5 }], cities: [{ id: 'town', name: 'Pine', x: 5, y: 7 }] };
  const targets = findIndustryTargets(game, source);
  assert.deepEqual(targets.map(target => [target.kind, target.id, target.distance]), [['city', 'town', 2], ['industry', 'machine', 5]]);
  assert.deepEqual(targets[0].cargo, ['fuel']);
  assert.deepEqual(findIndustryTargets(game, source, 0), []);
  assert.equal(nearestTown(game, source).name, 'Pine');
  assert.equal(nearestTown({ cities: [] }, source), null);
});

test('every produced cargo has a truthful consumer list for all recipe definitions', () => {
  const industries = Object.keys(INDUSTRIES).map((kind, index) => ({ id: kind, name: INDUSTRIES[kind].name, kind, x: index, y: 0 }));
  const game = { industries, cities: [] };
  for (const source of industries) for (const target of findIndustryTargets(game, source, 100)) {
    assert.notEqual(target.id, source.id);
    assert.ok(target.cargo.every(cargo => INDUSTRIES[source.kind].outputs[cargo] > 0 && INDUSTRIES[industries.find(site => site.id === target.id).kind].inputs[cargo] > 0));
  }
});
