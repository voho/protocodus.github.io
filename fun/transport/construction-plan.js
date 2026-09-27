import { build, buildProblem, networkAlreadyBuilt, constructionCost, tileAt, quoteStructureSpan, buildStructureSpan, quoteTerraformLevel, buildTerraformLevel, quoteTerraformStroke, buildTerraformStroke, BUILDINGS, INDUSTRIES, industryAt } from './model.js';
import { SPAN_TOOLS, networkTerrainPlanIssues } from './terrain-engineering.js';
import { buildingAt, buildingFootprint, buildingSiteProblem } from './building-sites.js';
import { industryFootprint, industrySiteProblem } from './industry-sites.js';
import { terrainObjectAt } from './terrain-objects.js';

/** Resolve the compact toolbar's intent to an existing, validated model tool. */
export function resolveBuildTool(game, tool, x, y, { preferredMode = 'road' } = {}) {
  const tile = tileAt(game, x, y);
  if (tool === 'road' || tool === 'rail') {
    if (tile?.terrain === 'water') return tool === 'rail' ? 'railbridge' : 'bridge';
    if (tile?.terrain === 'mountain') return tool === 'rail' ? 'railtunnel' : 'tunnel';
  }
  if (tool === 'stop') {
    const mode = tile?.rail && !tile.road ? 'rail' : tile?.road && !tile.rail ? 'road' : preferredMode === 'rail' ? 'rail' : 'road';
    return mode === 'rail' ? 'train-stop' : 'bus-stop';
  }
  return tool;
}

function uniquePoints(points) {
  const unique = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    if (point && Number.isInteger(point.x) && Number.isInteger(point.y)) unique.set(`${point.x},${point.y}`, { x: point.x, y: point.y });
  }
  return [...unique.values()];
}

// A drag crossing several cells of one site demolishes and pays for it once.
function constructionPoints(game, tool, points) {
  const unique = uniquePoints(points);
  if (tool !== 'bulldoze') return unique;
  return uniquePoints(unique.map(point => {
    const nature = terrainObjectAt(game, point.x, point.y);
    return industryAt(game, point.x, point.y) || buildingAt(game, point.x, point.y) || (nature && nature.object.kind !== 'mountain' ? nature : point);
  }));
}

export function quoteBuildPlan(game, tool, points, options) {
  if(tool==='level')return quoteTerraformLevel(game,points,options);
  if(tool==='raise'||tool==='lower')return quoteTerraformStroke(game,tool,points);
  const unique=constructionPoints(game,tool,points);
  if(SPAN_TOOLS.has(tool)&&unique.length>1)return quoteStructureSpan(game,tool,unique);
  const placements = unique.map(({ x, y }) => {
    const resolved = resolveBuildTool(game, tool, x, y, options);
    return { x, y, tool: resolved, cost: constructionCost(game, resolved, x, y) };
  });
  const cost=placements.reduce((sum, placement) => sum + placement.cost, 0);
  if(!placements.length)return {placements,cost};
  if (Object.hasOwn(BUILDINGS, tool) || Object.hasOwn(INDUSTRIES, tool)) {
    const industry = Object.hasOwn(INDUSTRIES, tool), span = industry ? industryFootprint(tool) : buildingFootprint(tool), claimed = new Set();
    let problem = null;
    for (const { x, y } of unique) {
      problem = industry ? industrySiteProblem(game, tool, x, y, span) : buildingSiteProblem(game, tool, x, y, span);
      if (problem) break;
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
  return quotePlacements(game, tool, placements);
}

const moneyText = n => `$${Math.round(n).toLocaleString('en-US')}`;
const tiles = (n, verb) => `${n} tile${n === 1 ? ` ${verb}s` : `s ${verb}`}`;
const BUILDING_BLOCK = 'Clear the building or zone before building a connection.';
// Walk the placements with the balance buildPlan will spend, so the preview
// marks exactly the tiles that release would skip, refuse or cannot pay for.
function quotePlacements(game, tool, placements) {
  const network = tool === 'road' || tool === 'rail', issues = network ? networkTerrainPlanIssues(game, placements) : [], slopes = new Map(issues.map(issue => [issue.y * game.width + issue.x, issue]));
  let balance = game.money;
  for (const p of placements) {
    const tile = tileAt(game, p.x, p.y), problem = buildProblem(game, p.tool, p.x, p.y, { money: Infinity }), issue = slopes.get(p.y * game.width + p.x);
    if (tile && network && networkAlreadyBuilt(tile, p.tool)) p.state = 'built';
    else if (problem && (problem.reason !== 'terrain' || !network)) { p.state = 'blocked'; p.problem = problem.message; }
    else if (problem || issue) { p.state = 'slope'; if (issue) p.issue = issue; }
    else if (p.cost > balance) p.state = 'funds';
    else { p.state = 'ok'; balance -= p.cost; }
  }
  const count = state => placements.filter(p => p.state === state).length, n = placements.length;
  const buildable = count('ok'), blocked = count('blocked'), unaffordable = count('funds'), slope = count('slope');
  const cost = placements.reduce((sum, p) => sum + (p.state === 'blocked' ? 0 : p.cost), 0), first = placements[0];
  if (network) {
    const slopeTiles = placements.filter(p => p.state === 'slope'), junction = slopeTiles.every(p => p.issue?.kind === 'ramp-junction') && slopeTiles[0]?.issue, refusal = placements.find(p => p.state === 'blocked')?.problem;
    const message = slope ? junction ? `Joins the ramp at ${junction.at.x}, ${junction.at.y} from the side — end before it or approach along the slope` : `${tiles(slope, 'need')} flat ground or a straight grade. Level this slope first or drag around ${slope === 1 ? 'it' : 'them'}.`
      : blocked ? blocked === 1 ? refusal : placements.every(p => p.state !== 'blocked' || p.problem === BUILDING_BLOCK) ? `${blocked} tiles are blocked by buildings or zones — drag around them or bulldoze first` : `${blocked} tiles are blocked. ${refusal}`
      : unaffordable ? `Need ${moneyText(cost)} · balance ${moneyText(game.money)}` : 'Follow flat ground or a straight grade.';
    return { placements, cost, issues, buildable, blocked, unaffordable, partial: false, ok: !issues.length && !slope && !blocked && !unaffordable, message };
  }
  // One stop, port or town reads build()'s own verdict; strokes of zones or
  // demolition stay partial and say how much of the drag will be built.
  const refusal = n === 1 || !buildable ? buildProblem(game, first.tool, first.x, first.y) : null, partial = buildable > 0 && buildable < n;
  const message = refusal ? refusal.message : partial ? `Builds ${buildable} of ${n}${blocked ? ` · ${blocked} blocked` : ''}${unaffordable ? ` · funds for ${buildable}` : ''}` : tool === 'city' ? 'A new town center.' : '';
  return { placements, cost, issues, buildable, blocked, unaffordable, partial, ok: !refusal && buildable > 0, message };
}

/** Road and rail strokes are all-or-nothing; zones and demolition may build part of a drag. model.build owns every charge. */
export function buildPlan(game, tool, points, options) {
  if (!Array.isArray(points) || !points.length) return { ok: false, message: 'Choose a construction path.', cost: 0, built: 0, failed: 0, skipped: 0 };
  if(tool==='level')return buildTerraformLevel(game,points,options);
  if(tool==='raise'||tool==='lower')return buildTerraformStroke(game,tool,points);
  const unique=uniquePoints(points);
  if(SPAN_TOOLS.has(tool)&&unique.length>1)return buildStructureSpan(game,tool,unique);
  const quote = quoteBuildPlan(game, tool, points, options), { placements } = quote;
  if((tool==='road'||tool==='rail')&&quote.ok===false)return {ok:false,message:quote.message,cost:0,built:0,failed:placements.length,skipped:0};
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
  const errorText = [...errors].slice(0, 2).map(([message, number]) => `${number}× ${message}`).join(' ');
  const money = `$${Math.round(cost).toLocaleString('en-US')}`;
  const message = count ? `${tool === 'bulldoze' ? 'Cleared' : tool==='raise'?'Raised':tool==='lower'?'Lowered':'Built'} ${count} tile${count === 1 ? '' : 's'} · ${money}${failed ? ` · ${failed} skipped. ${errorText}` : ''}`
    : errors.size ? errorText : skipped ? 'Already built.' : 'Choose valid tiles.';
  return { ok: count > 0 || (skipped > 0 && failed === 0), message, cost, built: count, failed, skipped };
}
