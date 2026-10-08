import { build, buildProblem, constructionCost, tileAt, quoteNetworkConstruction, buildNetworkConstruction, quoteTerraformLevel, buildTerraformLevel, quoteTerraformStroke, buildTerraformStroke, BUILDINGS, INDUSTRIES, industryAt, stationAt } from './model.js';
import { buildingAt, buildingFootprint, buildingSiteProblem } from './building-sites.js';
import { industryFootprint, industrySiteProblem, industrySpacingProblem } from './industry-sites.js';
import { terrainObjectAt } from './terrain-objects.js';
import { hasRoadAccess } from './environment.js';
import { money as moneyText, tiles as tileCount } from './copy.js';
import { townOf } from './town-market.js';
import { stationSiteAt, AIRPORT_LENGTH } from './station-sites.js';

/** Resolve the compact toolbar's intent to an existing, validated model tool. */
export function resolveBuildTool(game, tool, x, y, { preferredMode = 'road', airportAxis = 'x' } = {}) {
  const tile = tileAt(game, x, y);
  if (tool === 'road' || tool === 'rail') {
    if (tile?.terrain === 'water') return tool === 'rail' ? 'railbridge' : 'bridge';
    if (tile?.terrain === 'mountain') return tool === 'rail' ? 'railtunnel' : 'tunnel';
  }
  if (tool === 'stop') {
    const mode = tile?.rail && !tile.road ? 'rail' : tile?.road && !tile.rail ? 'road' : preferredMode === 'rail' ? 'rail' : 'road';
    return mode === 'rail' ? 'train-stop' : 'bus-stop';
  }
  if (tool === 'airport') return airportAxis === 'y' ? 'airport-y' : 'airport-x';
  return tool;
}
/** The airport tool centres its 6 × 2 site on the pointer: the model's anchor is the site's north-west tile. */
export function airportPlacement(point, axis = 'x') { const along = Math.floor((AIRPORT_LENGTH - 1) / 2); return axis === 'y' ? { x: point.x, y: point.y - along, tool: 'airport-y' } : { x: point.x - along, y: point.y, tool: 'airport-x' }; }

function uniquePoints(points) {
  const unique = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    if (point && Number.isInteger(point.x) && Number.isInteger(point.y)) unique.set(`${point.x},${point.y}`, { x: point.x, y: point.y });
  }
  return [...unique.values()];
}

const ZONE_TOOLS = new Set(['residential', 'commercial', 'industrial']);
const NETWORK_TOOLS = new Set(['road','rail','bridge','railbridge','tunnel','railtunnel']);
/** The tiles of a zone stroke that could take this zone: networks, stops, town centers, buildings, industries, water, mountains and tiles already so zoned are left out. */
export function zonePlanPoints(game, kind, points) {
  return uniquePoints(points).filter(({ x, y }) => {
    const tile = tileAt(game, x, y);
    return tile && !tile.road && !tile.rail && tile.zone !== kind && tile.terrain !== 'water' && tile.terrain !== 'mountain' && !stationAt(game, x, y) && !industryAt(game, x, y) && !buildingAt(game, x, y) && !game.cities.some(city => city.x === x && city.y === y);
  });
}

const NOTHING_TO_CLEAR = 'There’s nothing to bulldoze here.';
// A drag crossing several cells of one site demolishes and pays for it once.
// Zone strokes skip what they cannot claim and demolition skips empty ground;
// one tile, or a stroke with nothing left, keeps its tiles so the quote gives build()'s own refusal.
function constructionPoints(game, tool, points, options) {
  const unique = uniquePoints(points);
  if (tool === 'airport') return uniquePoints(unique.map(point => airportPlacement(point, options?.airportAxis)));
  if (ZONE_TOOLS.has(tool)) { const kept = unique.length > 1 ? zonePlanPoints(game, tool, unique) : unique; return kept.length ? kept : unique; }
  if (tool !== 'bulldoze') return unique;
  const sites = uniquePoints(unique.map(point => {
    const nature = terrainObjectAt(game, point.x, point.y), airport = stationSiteAt(game, point.x, point.y);
    return industryAt(game, point.x, point.y) || buildingAt(game, point.x, point.y) || (airport?.mode === 'air' ? airport : null) || (nature && nature.object.kind !== 'mountain' ? nature : point);
  })), kept = sites.length > 1 ? sites.filter(p => buildProblem(game, 'bulldoze', p.x, p.y, { money: Infinity })?.message !== NOTHING_TO_CLEAR) : sites;
  return kept.length ? kept : sites;
}

export function quoteBuildPlan(game, tool, points, options) {
  if(tool==='level')return quoteTerraformLevel(game,points,options);
  if(tool==='raise'||tool==='lower')return quoteTerraformStroke(game,tool,points);
  const unique=constructionPoints(game,tool,points,options);
  if(!unique.length)return {placements:[],cost:0};
  if(NETWORK_TOOLS.has(tool))return quoteNetworkConstruction(game,tool,unique);
  const placements = unique.map(({ x, y }) => {
    const resolved = resolveBuildTool(game, tool, x, y, options);
    return { x, y, tool: resolved, cost: constructionCost(game, resolved, x, y) };
  });
  const cost=placements.reduce((sum, placement) => sum + placement.cost, 0);
  if(!placements.length)return {placements,cost};
  if (Object.hasOwn(BUILDINGS, tool) || Object.hasOwn(INDUSTRIES, tool)) {
    const industry = Object.hasOwn(INDUSTRIES, tool), span = industry ? industryFootprint(tool) : buildingFootprint(tool), claimed = new Set(), planned = industry ? [...game.industries] : null;
    let problem = null;
    for (const { x, y } of unique) {
      problem = industry ? industrySiteProblem(game, tool, x, y, span) || industrySpacingProblem(game, tool, x, y, span, planned) : buildingSiteProblem(game, tool, x, y, span);
      if (problem) break;
      if (industry) planned.push({ kind: tool, name: INDUSTRIES[tool].name, x, y, footprint: span });
      for (let dy = 0; dy < span && !problem; dy++) for (let dx = 0; dx < span; dx++) {
        const index = (y + dy) * game.width + x + dx;
        if (claimed.has(index)) { problem = 'Building sites must not overlap.'; break; }
        claimed.add(index);
      }
      if (problem) break;
    }
    problem ||= cost > game.money ? `Need $${Math.round(cost).toLocaleString('en-US')} for this construction.` : null;
    return { placements, cost, span, ok: unique.length > 0 && !problem, message: problem || `${span} × ${span} site` };
  }
  // A workshop reads build()'s own verdict and names the town it joins.
  if (tool === 'workshop') { const quote = quotePlacements(game, tool, placements), { x, y } = placements[0]; return { ...quote, span: 2, message: quote.ok ? `2 × 2 site near ${townOf(game, x, y).name}` : quote.message }; }
  return quotePlacements(game, tool, placements);
}

// Walk the placements with the balance buildPlan will spend, so the preview
// marks exactly the tiles that release would skip, refuse or cannot pay for.
function quotePlacements(game, tool, placements) {
  const issues = [];
  let balance = game.money;
  for (const p of placements) {
    const problem = buildProblem(game, p.tool, p.x, p.y, { money: Infinity });
    if (problem) { p.state = 'blocked'; p.problem = problem.message; }
    else if (p.cost > balance) p.state = 'funds';
    else { p.state = 'ok'; balance -= p.cost; }
    // A zone develops only with a road beside it; the tile is still zoned, since streets may follow.
    if (ZONE_TOOLS.has(tool) && p.state !== 'blocked' && !hasRoadAccess(game, p.x, p.y)) p.needsRoad = true;
  }
  const count = state => placements.filter(p => p.state === state).length, n = placements.length;
  const buildable = count('ok'), blocked = count('blocked'), unaffordable = count('funds');
  const cost = placements.reduce((sum, p) => sum + (p.state === 'blocked' ? 0 : p.cost), 0), first = placements[0];
  // One stop, port or town reads build()'s own verdict; strokes of zones or
  // demolition stay partial and say how much of the drag will be built.
  const refusal = n === 1 || !buildable ? buildProblem(game, first.tool, first.x, first.y) : null, partial = buildable > 0 && buildable < n;
  const message = refusal ? refusal.message : partial ? `Builds ${buildable} of ${n}.${blocked ? ` ${tileCount(blocked)} ${blocked === 1 ? 'is' : 'are'} blocked.` : ''}${unaffordable ? ` Funds cover ${buildable}.` : ''}` : tool === 'city' ? 'A new town center.' : n===1&&first.tool==='bus-stop'&&!tileAt(game,first.x,first.y)?.road ? 'Road underneath included in the price.' : '';
  return { placements, cost, issues, buildable, blocked, unaffordable, partial, ok: !refusal && buildable > 0, message, ...ZONE_TOOLS.has(tool) && { needRoad: placements.filter(p => p.needsRoad).length } };
}

/** Road and rail strokes are all-or-nothing; zones and demolition may build part of a drag. model.build owns every charge. */
export function buildPlan(game, tool, points, options) {
  if (!Array.isArray(points) || !points.length) return { ok: false, message: 'Choose a construction path.', cost: 0, built: 0, failed: 0, skipped: 0 };
  if(tool==='level')return buildTerraformLevel(game,points,options);
  if(tool==='raise'||tool==='lower')return buildTerraformStroke(game,tool,points);
  const unique=uniquePoints(points);
  if(NETWORK_TOOLS.has(tool))return buildNetworkConstruction(game,tool,unique);
  const quote = quoteBuildPlan(game, tool, points, options), { placements } = quote;
  if (placements.length === 1) {
    const placement = placements[0], result = build(game, placement.tool, placement.x, placement.y);
    return { ...result, cost: result.cost || 0, built: result.ok && !result.unchanged ? 1 : 0, failed: result.ok ? 0 : 1, skipped: result.ok && result.unchanged ? 1 : 0 };
  }
  let count = 0, cost = 0, skipped = 0;
  const errors = new Map();
  for (const placement of placements) {
    const result = build(game, placement.tool, placement.x, placement.y);
    if (result.ok) {
      if (result.unchanged) skipped++; else count++;
      cost += result.cost || 0;
    } else errors.set(result.message, (errors.get(result.message) || 0) + 1);
  }
  const failed = [...errors.values()].reduce((sum, number) => sum + number, 0);
  const errorText = [...errors.keys()].slice(0, 2).join(' ');
  const message = count ? `${tool === 'bulldoze' ? 'Cleared' : tool==='raise'?'Raised':tool==='lower'?'Lowered':'Built'} ${tileCount(count)}.${cost > 0 ? ` ${moneyText(cost)} spent.` : ''}${failed ? ` ${tileCount(failed)} skipped. ${errorText}` : ''}`
    : errors.size ? errorText : skipped ? 'Already built.' : 'Choose valid tiles.';
  return { ok: count > 0 || (skipped > 0 && failed === 0), message, cost, built: count, failed, skipped };
}
