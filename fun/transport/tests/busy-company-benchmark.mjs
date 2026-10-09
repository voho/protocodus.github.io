// A played company on a real generated world: every producer that can reach its nearest buyer by road, and
// neighbouring towns, run real routes built with the game's own connection planner. Times whole daily steps.
// With --model, an immutable baseline copy builds and ticks the same company in the same process, alternating
// which side goes first, and must reach an identical state (SHA-1 of every field and tile).
// node --max-old-space-size=6144 tests/busy-company-benchmark.mjs --size=1024 --days=120
// Optional: --model=/absolute/baseline/model.js --seed=1847 --biome=taiga --fleet=4 --warm=10 --profile
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const size = Number(arg('size', 1024)), days = Number(arg('days', 120)), seed = Number(arg('seed', 1847)), biome = arg('biome', 'taiga');
const fleet = Number(arg('fleet', 4)), warm = Number(arg('warm', 10));
const load = async root => ({
  m: await import(new URL('model.js', root)), router: await import(new URL('network-router.js', root)),
  plan: await import(new URL('construction-plan.js', root)), data: await import(new URL('data.js', root)),
});
const here = new URL('../', import.meta.url);
const sides = [...(arg('model', null) ? [{ label: 'baseline', ...(await load(new URL('./', pathToFileURL(arg('model'))))) }] : []), { label: 'current', ...(await load(here)) }];

function connect(side, game, source, target, cargo) {
  const { m, router, plan } = side, route = router.planConnection(game, source, target, 'road');
  if (!route.ok) return false;
  const ids = route.ends.map(stop => stop?.id), line = plan.buildPlan(game, 'road', route.path);
  if (!line.ok) return false;
  for (const stop of route.stops) { const built = plan.buildPlan(game, 'bus-stop', [stop]); if (!built.ok) return false; ids[stop.end] = built.station.id; }
  return m.addRoute(game, { mode: 'road', stops: ids, cargo, vehicleCount: fleet }).ok;
}
function company(side) {
  const { m, data } = side, game = m.createGame({ size: `square${size}`, seed, biome });
  game.money = 1e12;
  let routes = 0;
  const centre = site => ({ x: site.x + 2, y: site.y + 2 });
  for (const source of game.industries.slice()) for (const cargo of Object.keys(data.INDUSTRIES[source.kind].outputs)) {
    const from = centre(source), buyer = game.industries.filter(site => data.INDUSTRIES[site.kind].inputs[cargo]).map(site => ({ site, d: Math.hypot(centre(site).x - from.x, centre(site).y - from.y) })).filter(b => b.d <= 70).sort((a, b) => a.d - b.d)[0];
    if (buyer && connect(side, game, source, buyer.site, cargo)) routes++;
  }
  for (const [i, town] of game.cities.entries()) {
    const other = game.cities.slice(i + 1).map(city => ({ city, d: Math.hypot(city.x - town.x, city.y - town.y) })).filter(b => b.d <= 45).sort((a, b) => a.d - b.d)[0];
    if (other && connect(side, game, town, other.city, 'passengers')) routes++;
  }
  m.refreshRouteConnections(game);
  return { game, routes };
}
for (const side of sides) { const at = performance.now(); Object.assign(side, company(side)); side.buildMs = performance.now() - at; side.times = []; }
for (let day = 0; day < days; day++) for (const side of day % 2 ? sides.slice().reverse() : sides) { const at = performance.now(); side.m.tick(side.game, 1); if (day >= warm) side.times.push(performance.now() - at); }
const digest = game => { const sha = createHash('sha1'), { tiles, ...rest } = game; sha.update(JSON.stringify(rest)); for (let i = 0; i < tiles.length; i += 4096) sha.update(JSON.stringify(tiles.slice(i, i + 4096))); return sha.digest('hex'); };
const report = Object.fromEntries(sides.map(({ label, game, routes, buildMs, times }) => {
  const sorted = times.slice().sort((a, b) => a - b), at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return [label, { digest: digest(game), routes, vehicles: game.vehicles.length, day: game.day, money: Math.round(game.money - 1e12), buildMs: Math.round(buildMs), medianMs: +at(.5).toFixed(2), p95Ms: +at(.95).toFixed(2), maxMs: +sorted.at(-1).toFixed(2), totalMs: Math.round(times.reduce((a, b) => a + b, 0)) }];
}));
if (report.baseline) assert.equal(report.current.digest, report.baseline.digest, 'the busy company reaches an identical state');
console.log(JSON.stringify({ size, biome, seed, days, fleet, ...report, ...(report.baseline && { medianSpeedup: +(report.baseline.medianMs / report.current.medianMs).toFixed(2) }) }));
