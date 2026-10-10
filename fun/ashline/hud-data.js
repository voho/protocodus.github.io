// Pure derivations for the command interface: event routing, card statistics, idle detection and
// persisted interface settings. They read the game without changing it and only describe the
// player's own forces, so nothing here can expose a position or unit hidden by fog.
import { UNITS, BUILDINGS, RESEARCH, armorMultiplier, unitRole, buildingRole, researchStatus } from './sim.js';
import { ABILITIES } from './abilities.js';

// Saves from before typed events carry only text; these patterns recover the kind from that copy.
const KIND_PATTERNS = [
  [/^Shard delivery:/, 'delivery'], [/ under attack$/, 'underAttack'], [/ promoted to rank \d$/, 'promotion'],
  [/^All hostile nexuses and construction vehicles destroyed/, 'victory'], [/^All nexuses and construction vehicles lost/, 'defeat'],
  [/^All haulers lost/, 'haulersLost'], [/ lost$/, 'unitLost'], [/ destroyed$/, 'structureLost'], [/ ready$/, 'ready'], [/ online$/, 'online'],
  [/: deployment bay blocked$/, 'bayBlocked'], [/^Power shortage/, 'power'], [/^Capacitor reserve engaged/, 'power'], [/^Power grid restored/, 'power'],
  [/: research started$/, 'researchStarted'], [/: research complete$/, 'researchComplete'], [/: upgrade started$/, 'upgradeStarted'], [/: upgrade complete$/, 'upgradeComplete'],
  [/: construction started$/, 'placed'], [/: deployment started$/, 'deployed'], [/wall segments? started/, 'walls'], [/ sold: \+/, 'sold'],
  [/: reachable territory explored$/, 'explored'], [/ training cancelled: \+/, 'trainingCancelled'], [/^Command online/, 'opening'],
  [new RegExp(`: (${Object.values(ABILITIES).flatMap(a => Object.values(a.names)).join('|')})$`), 'ability'],
];
export function eventKind(event) {
  if (typeof event?.kind === 'string') return event.kind;
  const text = String(event?.text ?? '');
  return KIND_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? 'message';
}
function powerStatus(event) {
  return event.status ?? (/^Power shortage/.test(event.text) ? 'brownout' : /^Capacitor/.test(event.text) ? 'reserve' : 'stable');
}

// tone: info, success, caution, warning, loss or comms. alert: worth a jump-to entry and a minimap ping.
// toast: false keeps the line out of the log: deliveries are a sound, brownouts already raise the HUD's
// own low-power warning, placements, sales and project starts answer a click that has its own reply, and
// the objective tracker shows scripted dialogue (as transmissions) and every objective's new, complete or
// failed state. Waves and supply drops are not tracked, so they stay in the log.
// Routes carry no sound: soundscape.js gives every event its one cue, so the log never doubles it.
const ROUTES = {
  opening: { tone: 'info' }, delivery: { toast: false }, explored: { tone: 'info' },
  researchStarted: { toast: false }, researchComplete: { tone: 'success' },
  upgradeStarted: { toast: false }, upgradeComplete: { tone: 'success' },
  placed: { toast: false }, online: { tone: 'success' }, deployed: { toast: false },
  walls: { toast: false }, sold: { toast: false }, trainingCancelled: { tone: 'info' }, mission: { tone: 'info' }, ability: { tone: 'info' },
  underAttack: { tone: 'warning', alert: true }, structureLost: { tone: 'warning', alert: true },
  haulersLost: { tone: 'warning', alert: true }, bayBlocked: { tone: 'warning', alert: true },
  wave: { tone: 'warning', alert: true }, objectiveFailed: { tone: 'warning', toast: false },
  unitLost: { tone: 'loss', alert: true }, promotion: { tone: 'success' }, ready: { tone: 'info' },
  victory: { tone: 'success' }, defeat: { tone: 'warning' }, objective: { tone: 'success', toast: false }, dialogue: { tone: 'comms', toast: false }, message: { tone: 'info' },
};
export function eventRoute(event) {
  const kind = eventKind(event);
  if (kind === 'power') {
    const status = powerStatus(event);
    return { kind, status, tone: status === 'reserve' ? 'caution' : status === 'brownout' ? 'warning' : 'success', toast: status !== 'brownout', alert: false };
  }
  const route = Object.hasOwn(ROUTES, kind) ? ROUTES[kind] : ROUTES.message;
  return { kind, tone: route.tone ?? 'info', toast: route.toast !== false, alert: Boolean(route.alert) };
}

// Whether the player saw the kill behind a promotion. The simulation logs the victim's loss right after
// the promotion, in the same step; only a loss on a tile in current vision confirms it. The log, the
// crew's boast and the promotion stinger all follow this one rule.
export function witnessedKill(game, promotion, victim) {
  return Boolean(victim && victim.time === promotion.time && victim.team !== promotion.team && (victim.kind === 'unitLost' || victim.kind === 'structureLost')
    && Number.isFinite(victim.x) && Number.isFinite(victim.y) && game.visible[0][Math.floor(victim.y) * game.width + Math.floor(victim.x)]);
}

export const ARMOR_CLASSES = { infantry: 'Infantry', light: 'Light vehicles', heavy: 'Heavy armor', building: 'Structures' };
const ARMOR_PROBES = { infantry: { kind: 'unit', type: 'rifle' }, light: { kind: 'unit', type: 'scout' }, heavy: { kind: 'unit', type: 'tank' }, building: { kind: 'building', type: 'core' } };
// Base statistics for a production card, before research, rank or power. DPS is damage per interval.
export function cardStats(type) {
  const unit = UNITS[type], d = unit ?? BUILDINGS[type];
  if (!d) return null;
  const stats = { name: d.name, cost: d.cost, time: d.trainTime ?? d.buildTime, hp: d.hp, armor: unit ? d.armor : 'building', sight: d.sight, power: d.power ?? 0,
    speed: unit ? d.speed : null, range: 0, dps: 0, splash: d.splash ?? 0, multipliers: null, strong: [], weak: [] };
  if (d.damage > 0 && d.interval > 0) {
    stats.range = d.range; stats.dps = d.damage / d.interval;
    stats.multipliers = Object.fromEntries(Object.entries(ARMOR_PROBES).map(([armor, probe]) => [armor, armorMultiplier({ type }, probe)]));
    const values = Object.values(stats.multipliers), best = Math.max(...values);
    // Strong means a clear bonus, or the best class when nothing reaches one; weak means half damage or less.
    stats.strong = Object.keys(stats.multipliers).filter(armor => stats.multipliers[armor] >= 1.2 || (best < 1.2 && best >= 1 && stats.multipliers[armor] === best));
    stats.weak = Object.keys(stats.multipliers).filter(armor => stats.multipliers[armor] <= .5);
  }
  return stats;
}

export const IDLE_GROUPS = ['constructors', 'engineers', 'combat', 'producers', 'labs'];
// Idle forces worth a reminder: armed units waiting more than `away` tiles from any friendly structure,
// engineers with nothing to mend, construction vehicles, empty production bays and laboratories with a
// project still to start.
export function idleSummary(game, team = 0, away = 12) {
  const result = Object.fromEntries(IDLE_GROUPS.map(group => [group, []]));
  if (!game) return result;
  const structures = [], combat = [];
  let research = null;
  for (const e of game.entities) {
    if (e.team !== team || e.hp <= 0) continue;
    if (e.kind === 'building') {
      structures.push({ x: e.x + e.size / 2, y: e.y + e.size / 2 });
      if (e.progress < 1) continue;
      const role = buildingRole(e);
      if ((role === 'barracks' || role === 'factory') && !e.queue?.length) result.producers.push(e);
      else if (role === 'lab' && !e.research) {
        research ??= Object.keys(RESEARCH).some(id => { const status = researchStatus(game, team, id); return status.ok || status.reason === 'Insufficient credits'; });
        if (research) result.labs.push(e);
      }
      continue;
    }
    const role = unitRole(e), idle = e.order?.type === 'idle';
    if (!idle) continue;
    if (role === 'constructor') result.constructors.push(e);
    else if (role === 'engineer') { if (!e.repairTargetId) result.engineers.push(e); }
    else if (UNITS[e.type]?.damage > 0 && !e.targetId && !e.retaliationTargetId && !e.defendReturning) combat.push(e);
  }
  for (const e of combat) if (!structures.some(p => Math.hypot(p.x - e.x, p.y - e.y) <= away)) result.combat.push(e);
  return result;
}

export const SETTINGS_KEY = 'ashline.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ speed: 100, edgeScroll: true, shake: true, tooltips: true });
// Stored settings are advisory: anything missing, malformed or unreadable falls back to the default.
export function readSettings(storage) {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return settings;
    if ([100, 125, 150, 175, 200].includes(saved.speed)) settings.speed = saved.speed;
    for (const key of ['edgeScroll', 'shake', 'tooltips']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  } catch { /* Private browsing or a damaged entry keeps the defaults. */ }
  return settings;
}
export function writeSettings(settings, storage) {
  try { (storage ?? globalThis.localStorage).setItem(SETTINGS_KEY, JSON.stringify({ speed: settings.speed, edgeScroll: settings.edgeScroll, shake: settings.shake, tooltips: settings.tooltips })); return true; }
  catch { return false; }
}
