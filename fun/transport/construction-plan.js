import { build, constructionCost, tileAt, quoteStructureSpan, buildStructureSpan } from './model.js';
import { SPAN_TOOLS, terraformProblem } from './terrain-engineering.js';

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

export function quoteBuildPlan(game, tool, points, options) {
  const unique=uniquePoints(points);
  if(SPAN_TOOLS.has(tool)&&unique.length>1)return quoteStructureSpan(game,tool,unique);
  const placements = unique.map(({ x, y }) => {
    const resolved = resolveBuildTool(game, tool, x, y, options);
    return { x, y, tool: resolved, cost: constructionCost(game, resolved, x, y) };
  });
  const cost=placements.reduce((sum, placement) => sum + placement.cost, 0);
  if(tool==='raise'||tool==='lower'){
    const problem=unique.map(p=>terraformProblem(game,tool,p.x,p.y)).find(Boolean)|| (cost>game.money?`Need $${Math.round(cost).toLocaleString('en-US')} to shape these tiles.`:null);
    return {placements,cost,ok:unique.length>0&&!problem,message:problem||'Change each tile by one level.'};
  }
  return { placements, cost };
}

/** Preserve buildPath's partial success policy; model.build owns every charge. */
export function buildPlan(game, tool, points, options) {
  if (!Array.isArray(points) || !points.length) return { ok: false, message: 'Choose a construction path.', cost: 0, built: 0, failed: 0, skipped: 0 };
  const unique=uniquePoints(points);
  if(SPAN_TOOLS.has(tool)&&unique.length>1)return buildStructureSpan(game,tool,unique);
  const { placements } = quoteBuildPlan(game, tool, points, options);
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
  return { ok: count > 0 || skipped > 0, message, cost, built: count, failed, skipped };
}
