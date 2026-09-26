import { CARGO, INDUSTRIES, TOWN_CARGO } from './data.js';

export function industryCatalog(biome) {
  return Object.entries(INDUSTRIES).filter(([, definition]) => definition.biomes.includes(biome));
}

export function chainProducts(biome) {
  const produced = new Set(industryCatalog(biome).flatMap(([, definition]) => Object.keys(definition.outputs)));
  return Object.keys(CARGO).filter(cargo => produced.has(cargo));
}

/** A complete recipe dependency graph, including every alternative producer. */
export function productionChain(biome, cargo = 'all') {
  const catalog = industryCatalog(biome), selected = new Set();
  const producers = resource => catalog.filter(([, definition]) => (definition.outputs[resource] || 0) > 0);
  function add(kind, definition) {
    if (selected.has(kind)) return;
    selected.add(kind);
    for (const input of Object.keys(definition.inputs)) for (const [source, sourceDefinition] of producers(input)) add(source, sourceDefinition);
  }
  for (const [kind, definition] of cargo === 'all' ? catalog : producers(cargo)) add(kind, definition);
  const edges = [];
  for (const [kind, definition] of catalog) {
    if (!selected.has(kind)) continue;
    for (const [input, amount] of Object.entries(definition.inputs)) {
      for (const [source] of producers(input)) if (selected.has(source)) edges.push({ from: source, to: kind, cargo: input, amount });
    }
  }
  const depths = new Map();
  function level(kind, visiting = new Set()) {
    if (depths.has(kind)) return depths.get(kind);
    if (visiting.has(kind)) return 0;
    visiting.add(kind);
    const incoming = edges.filter(edge => edge.to === kind);
    const depth = incoming.length ? 1 + Math.max(...incoming.map(edge => level(edge.from, new Set(visiting)))) : 0;
    depths.set(kind, depth);
    return depth;
  }
  const nodes = catalog.filter(([kind]) => selected.has(kind)).map(([kind, definition]) => ({ kind, definition, level: level(kind) }));
  const townOutputs = cargo === 'all' ? TOWN_CARGO : TOWN_CARGO.includes(cargo) ? [cargo] : [];
  const townEdges = nodes.flatMap(node => Object.keys(node.definition.outputs)
    .filter(output => townOutputs.includes(output)).map(output => ({ from: node.kind, to: 'towns', cargo: output })));
  if (townEdges.length) {
    nodes.push({ kind: 'towns', definition: { name: 'Towns', inputs: Object.fromEntries([...new Set(townEdges.map(edge => edge.cargo))].map(key => [key, 1])), outputs: {} }, level: 1 + Math.max(...nodes.map(node => node.level)) });
    edges.push(...townEdges);
  }
  return { cargo, nodes, edges, levels: Array.from({ length: nodes.length ? 1 + Math.max(...nodes.map(node => node.level)) : 0 }, (_, index) => nodes.filter(node => node.level === index)) };
}

/** Nearest distinct consumers of this site's output, in straight-line tiles. */
export function findIndustryTargets(game, industry, limit = 5) {
  const output = Object.keys(INDUSTRIES[industry?.kind]?.outputs || {});
  if (!output.length || limit <= 0) return [];
  const targets = [];
  for (const target of game.industries || []) {
    if (target === industry || target.id === industry.id) continue;
    const cargo = output.filter(key => (INDUSTRIES[target.kind]?.inputs[key] || 0) > 0);
    if (cargo.length) targets.push({ id: target.id, kind: 'industry', name: target.name || INDUSTRIES[target.kind].name, x: target.x, y: target.y, cargo });
  }
  const townCargo = output.filter(key => TOWN_CARGO.includes(key));
  if (townCargo.length) for (const city of game.cities || []) targets.push({ id: city.id, kind: 'city', name: city.name, x: city.x, y: city.y, cargo: townCargo.slice() });
  return targets.map(target => ({ ...target, distance: Math.hypot(target.x - industry.x, target.y - industry.y) }))
    .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id))).slice(0, Math.floor(limit));
}

export function nearestTown(game, point) {
  return (game.cities || []).map(city => ({ ...city, distance: Math.hypot(city.x - point.x, city.y - point.y) }))
    .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)))[0] || null;
}

export function defaultChainProduct(biome, industryKind) {
  const products = chainProducts(biome);
  const preference = ['goods', 'furniture', 'machinery', 'food', 'fuel', 'cement', 'stone', ...products];
  return preference.find(cargo => products.includes(cargo) && (!industryKind || productionChain(biome, cargo).nodes.some(node => node.kind === industryKind))) || 'all';
}
