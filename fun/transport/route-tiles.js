// DOM-free: which active land routes run over each tile, so demolition can
// warn before it breaks a service. Ships sail under bridges and are never cut.
const indexes = new WeakMap();

/** Map of y*width+x to the names of active road and rail routes crossing that tile. */
export function routeTileIndex(game) {
  const routes = game.routes || [], cached = indexes.get(game);
  if (cached && cached.networkRevision === game.networkRevision && cached.routes === routes && cached.length === routes.length && routes.every((route, i) => cached.paths[i] === route.path && cached.active[i] === route.active)) return cached.index;
  const index = new Map();
  for (const route of routes) if (route.active && route.mode !== 'water') for (const point of route.path || []) {
    const key = point.y * game.width + point.x, names = index.get(key);
    if (!names) index.set(key, [route.name]); else if (!names.includes(route.name)) names.push(route.name);
  }
  indexes.set(game, { networkRevision: game.networkRevision, routes, length: routes.length, paths: routes.map(route => route.path), active: routes.map(route => route.active), index });
  return index;
}
