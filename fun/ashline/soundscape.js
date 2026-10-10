// Fog-safe glue between the simulation and audio.js. It turns new effects and typed events into positioned
// cues, unit acknowledgements, ambient beds and the soundtrack's combat intensity. It only reads the state:
// every cue about another team is gated on the player's current vision, and the state is never written.
import { teamRace, unitRole, buildingRole, getEntity } from './sim.js';
import { RECIPES, VOICE_ROLES, voiceFamily, voiceKey } from './soundbank.js';
import { VOLUME_CHANNELS } from './audio.js';
import { witnessedKill } from './hud-data.js';

const AREA = 6; // Identical cues within one AREA×AREA tile cell merge into one louder cue per frame.
const FRAME_LIMITS = { weapon: 6, impact: 5 };
const INTENSITY_HALF_LIFE = 6;
const SPOT_GAP = 8, SPOT_COOLDOWN = 25;
// Cues heard from events, by kind. Positioned kinds use the event's own-entity point; the rest are centred.
// Events that echo the player's own click (placed, walls, sold, deployed, research and upgrade starts,
// cancelled training) are answered by that click's cue at once, so they have none here.
const STINGERS = {
  underAttack: 'alert.underAttack', unitLost: 'alert.unitLost', structureLost: 'alert.structureLost', researchComplete: 'alert.research',
  upgradeComplete: 'alert.upgrade', promotion: 'alert.promotion', objectiveFailed: 'alert.objectiveFailed', wave: 'alert.wave', mission: 'alert.objectiveNew',
  bayBlocked: 'alert.warning', haulersLost: 'alert.warning', explored: 'alert.explored', online: 'buildComplete', ready: 'unitReady',
};
const POWER = { brownout: 'alert.powerDown', reserve: 'alert.reserve', stable: 'alert.powerUp' };
// Interface chimes that many buildings or units can trigger at once (wall lines, mass production).
const CENTRED_GAP = { buildComplete: .8, unitReady: .6, 'alert.explored': 2 };
const INTENSITY = { weapon: .035, impact: .06, 'death.infantry': .05, 'death.robot': .05, 'death.vehicle': .1, 'death.small': .1, 'death.building': .22, 'alert.underAttack': .25 };
const HEAVY = new Set(['tank', 'artillery', 'rocketTower', 'turret']);
const INFANTRY = new Set(['rifle', 'rocket']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Older saves recorded events as text only; route them by their fixed wording.
export function eventKind(event) {
  if (event.kind) return event.kind;
  const text = String(event.text || '');
  if (text.startsWith('Shard delivery:')) return 'delivery';
  if (/ under attack$/.test(text)) return 'underAttack';
  if (/ promoted to rank \d$/.test(text)) return 'promotion';
  if (/: research complete$/.test(text)) return 'researchComplete';
  if (/: upgrade complete$/.test(text)) return 'upgradeComplete';
  if (/^Power shortage/.test(text)) return 'power';
  if (/ online$/.test(text)) return 'online';
  if (/ ready$/.test(text)) return 'ready';
  if (/^All haulers lost/.test(text)) return 'haulersLost';
  if (/deployment bay blocked$/.test(text)) return 'bayBlocked';
  if (/^(?!Hostile|All ).* destroyed$/.test(text)) return 'structureLost';
  if (/ lost$/.test(text)) return 'unitLost';
  return '';
}

// Camera placement: pan follows the screen position; level holds across the view and falls to silence
// about one and a half screens beyond its edge, where combat also sounds muffled.
export function placeCue(x, y, view, screen) {
  const halfWidth = Math.max(1, screen.width) / 2, halfHeight = Math.max(1, screen.height) / 2;
  const nx = (x - view.x) * view.zoom / halfWidth, ny = (y - view.y) * view.zoom / halfHeight, d = Math.hypot(nx, ny);
  return { pan: clamp(nx * .8, -.85, .85), gain: d <= 1 ? 1 - .2 * d : Math.max(0, .8 * (1 - (d - 1) / 2)), distant: d > 1.15 };
}

// The lead voice of a selection: its most common role, preferring armed units over haulers and support.
function leadUnit(units) {
  const counts = new Map();
  for (const unit of units) { const role = unitRole(unit); counts.set(role, (counts.get(role) || 0) + 1); }
  const weight = role => (counts.get(role) || 0) + (['harvester', 'engineer', 'constructor'].includes(role) ? 0 : 1000);
  return units.reduce((best, unit) => weight(unitRole(unit)) > weight(unitRole(best)) ? unit : best, units[0]);
}
function speakerVoice(speaker, text) {
  const name = String(speaker || ''), seed = [...`${name}|${text}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const family = /unity|mainframe|relay|archive|cohort|severed|spire/i.test(name) ? 'unity' : /vael/i.test(name) ? 'vael' : 'human';
  const roles = family === 'unity' ? ['constructor', 'artillery', 'tank'] : family === 'vael' ? ['rocket'] : ['engineer', 'rifle', 'tank', 'scout'];
  return { key: voiceKey(family, roles[seed % roles.length], 'transmission'), variant: seed % 3 };
}

export function createSoundscape(audio, { clock = () => performance.now() / 1000 } = {}) {
  let game = null, heard = new WeakSet(), cursor = 0, lastEvent = null, lastTime = 0, nextScan = 0;
  let pending = [], landings = [], intensity = 0, nextAmbient = 0, lastContact = -Infinity, lastSpotted = -Infinity;
  let lastAck = -Infinity, lastSelect = { signature: '', at: -Infinity, count: 0 }, selectSpoke = -Infinity, timed = [], replies = [];
  const deaths = new Map(), centredAt = new Map(), stats = { cues: 0, merged: 0, dropped: 0, landings: 0, stingers: 0, voices: 0 };

  const visible = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    return Number.isFinite(x) && Number.isFinite(y) && ix >= 0 && iy >= 0 && ix < game.width && iy < game.height && Boolean(game.visible[0][iy * game.width + ix]);
  };
  const heat = (name, scale = 1) => { intensity = Math.min(1, intensity + (INTENSITY[name] ?? INTENSITY[RECIPES[name]?.category] ?? 0) * scale); };
  function cue(name, x, y, gain = 1) { pending.push({ name, x, y, gain }); heat(name, gain); }
  function centred(name) { pending.push({ name, centred: true }); heat(name); }
  const weaponName = (team, weapon) => {
    const name = `${teamRace(game, team)}.${weapon}`;
    return RECIPES[name] ? name : RECIPES[`organics.${weapon}`] ? `organics.${weapon}` : 'organics.rifle';
  };
  function visibleEnemyUnit() {
    const sight = game.visible[0], width = game.width;
    for (const e of game.entities) if (e.team !== 0 && e.kind === 'unit' && e.hp > 0 && sight[Math.floor(e.y) * width + Math.floor(e.x)]) return true;
    return false;
  }

  function reset(state) {
    game = state; heard = new WeakSet(state.effects); cursor = state.events.length; lastEvent = state.events.at(-1) || null;
    lastTime = nextScan = state.time; pending = []; landings = []; timed = []; replies = []; intensity = 0; deaths.clear(); centredAt.clear();
    lastContact = visibleEnemyUnit() ? state.time : -Infinity; lastSpotted = -Infinity; lastSelect = { signature: '', at: -Infinity, count: 0 }; selectSpoke = -Infinity;
    const race = teamRace(state, 0), keys = [];
    for (const role of VOICE_ROLES) for (const context of ['select', 'move', 'attack']) keys.push(voiceKey(voiceFamily(race, role), role, context));
    audio.prewarmVoices?.(keys);
  }
  // Events since the last tick. A trimmed or replaced log resumes after the last event heard, or skips
  // ahead rather than replaying old alerts.
  function freshEvents() {
    const events = game.events;
    let from = cursor;
    if (from > events.length || from > 0 && events[from - 1] !== lastEvent) {
      const found = lastEvent ? events.lastIndexOf(lastEvent) : -1;
      from = found >= 0 ? found + 1 : events.length;
    }
    cursor = events.length; lastEvent = events.at(-1) || null;
    return events.slice(from);
  }
  function hearEvent(event, next) {
    const kind = eventKind(event), own = event.team === 0 || event.team === undefined;
    if (kind === 'unitLost' || kind === 'structureLost') deaths.set(`${event.x},${event.y}`, { kind, role: event.role });
    if (!own) {
      // A rival's ability is heard only where the player can see it happen.
      if (kind === 'ability' && visible(event.x, event.y)) cue(`${teamRace(game, event.team)}.${event.ability}`, event.x, event.y, .8);
      return;
    }
    if (kind === 'delivery') { if (Number.isFinite(event.x)) cue('delivery', event.x, event.y, .8); return; }
    if (kind === 'ability') {
      if (Number.isFinite(event.x)) cue(`${teamRace(game, 0)}.${event.ability}`, event.x, event.y); else centred(`${teamRace(game, 0)}.${event.ability}`);
      if (VOICE_ROLES.includes(event.role)) reply(event, 'ability');
      return;
    }
    if (kind === 'dialogue') {
      const voice = speakerVoice(event.speaker, event.text);
      if (audio.voice(voice.key, { variant: voice.variant })) stats.voices++;
      return;
    }
    if (kind === 'ready' && VOICE_ROLES.includes(event.role) && clock() - lastAck > 5) reply(event, 'ready');
    // The HUD's rule for promotions: news only for a living unit's kill the player saw; any other waits
    // silently until the unit is next selected.
    if (kind === 'promotion') { const unit = getEntity(game, event.entityId); if (unit?.kind !== 'unit' || unit.hp <= 0 || !witnessedKill(game, event, next)) return; }
    const name = kind === 'power' ? POWER[event.status] : kind === 'objective' ? (event.status === 'new' || /^New objective/.test(event.text) ? 'alert.objectiveNew' : 'alert.objective') : STINGERS[kind];
    if (name) centred(name);
  }
  function hearEffect(effect) {
    const type = effect.type;
    if (type === 'shot' || type === 'shell' || type === 'rocket') {
      const name = weaponName(effect.team, effect.weapon), source = visible(effect.x, effect.y), target = visible(effect.tx, effect.ty);
      if (source) cue(name, effect.x, effect.y, HEAVY.has(effect.weapon) ? 1 : .9);
      // A hidden shooter is heard only at its visible impact end; hidden launchers and guns stay silent.
      else if (target && type === 'shot') cue(name, effect.tx, effect.ty, .65);
      if (type === 'shell' && Number.isFinite(effect.tx)) {
        if (!source && target) cue('impact.whistle', effect.tx, effect.ty, .8);
        if (landings.length < 256) landings.push({ at: game.time + Math.max(.05, effect.life ?? .35), x: effect.tx, y: effect.ty });
      }
      return;
    }
    if (type !== 'explosion' || effect.weapon === 'artillery' || !visible(effect.x, effect.y)) return;
    const until = game.time + Math.max(.05, effect.life ?? .6);
    if (effect.weapon === 'rocket' || effect.weapon === 'rocketTower') { timed.push({ fx: effect, until, name: effect.weapon === 'rocketTower' ? 'impact.rocketHeavy' : 'impact.rocket', x: effect.x, y: effect.y }); return; }
    // A death: the loss event from the same step names what was destroyed.
    const death = deaths.get(`${effect.x},${effect.y}`), race = teamRace(game, effect.team);
    let name;
    if (death?.kind === 'structureLost' || !death && effect.size >= 2) name = (effect.size || 1) >= 2 ? 'death.building' : 'death.small';
    else if (death && INFANTRY.has(death.role)) name = race === 'aiUnity' ? 'death.robot' : 'death.infantry';
    else name = 'death.vehicle';
    timed.push({ fx: effect, until, name, x: effect.x, y: effect.y });
  }
  // A unit line. It counts as said even when muted or not yet rendered, so the comms text that repeats
  // it never depends on the audio.
  function speak(role, context) {
    lastAck = clock();
    if (audio.voice(voiceKey(voiceFamily(teamRace(game, 0), role), role, context))) stats.voices++;
  }
  // Lines a unit's own news brings (ready, ability); the HUD collects them with takeReplies.
  function reply(event, context) {
    speak(event.role, context);
    if (replies.length < 8) replies.push({ entityId: event.entityId, context });
  }
  // A blast or landing is heard when the picture shows it: the renderer holds a shell's kills until the
  // shell lands and a rocket's blast until the drawn rocket arrives (blastTime, on its drawn clock).
  // A blast the picture never drew (sight changed before a frame) stays silent. No picture: at once.
  function due(item, picture) {
    if (!picture) return true;
    if (!item.fx) return item.at <= picture.drawClock;
    const at = picture.blastTime(item.fx);
    if (at == null && game.time > item.until) item.expired = true;
    return at != null && at <= picture.drawClock;
  }

  return {
    stats,
    get intensity() { return intensity; },
    reset,
    // Called after every simulation step, so effects that live for a single tick are never missed.
    tick(state) {
      if (state !== game) reset(state);
      const now = game.time;
      if (now > lastTime) intensity *= .5 ** ((now - lastTime) / INTENSITY_HALF_LIFE);
      lastTime = now;
      const fresh = freshEvents();
      fresh.forEach((event, i) => hearEvent(event, fresh[i + 1]));
      for (const effect of game.effects) if (!heard.has(effect)) { heard.add(effect); hearEffect(effect); }
      deaths.clear();
      for (let i = landings.length - 1; i >= 0; i--) {
        const landing = landings[i];
        if (now + 1e-9 < landing.at) continue;
        landings.splice(i, 1);
        // Visibility is checked again at landing time.
        if (visible(landing.x, landing.y)) { timed.push({ at: landing.at, name: 'impact.shell', x: landing.x, y: landing.y }); stats.landings++; }
      }
      if (now >= nextScan) {
        nextScan = now + .25;
        if (visibleEnemyUnit()) {
          if (now - lastContact > SPOT_GAP && now - lastSpotted > SPOT_COOLDOWN) { centred('alert.enemySpotted'); lastSpotted = now; }
          lastContact = now;
        }
      }
    },
    // Called once per drawn frame, after the draw: merges this frame's cues by kind and area, places them
    // against the camera and refreshes the ambient beds and music intensity. picture is the renderer
    // (drawClock, blastTime) whose timeline blasts and landings follow.
    frame(state, view, screen, picture = null) {
      if (state !== game) reset(state);
      if (timed.length) {
        let keep = 0;
        for (const item of timed) {
          if (due(item, picture)) cue(item.name, item.x, item.y);
          else if (!item.expired) timed[keep++] = item;
        }
        timed.length = keep;
      }
      const wall = clock(), groups = new Map();
      for (const item of pending) {
        if (item.centred) {
          const gap = CENTRED_GAP[item.name] ?? 0;
          if (groups.has(item.name) || wall - (centredAt.get(item.name) ?? -Infinity) < gap) { stats.merged++; continue; }
          groups.set(item.name, item); continue;
        }
        const key = `${item.name}|${Math.floor(item.x / AREA)}|${Math.floor(item.y / AREA)}`, group = groups.get(key);
        if (group) { group.x += item.x; group.y += item.y; group.count++; group.gain = Math.max(group.gain, item.gain); stats.merged++; }
        else groups.set(key, { ...item, count: 1 });
      }
      pending = [];
      const zoomScale = view.zoom && screen.levels?.length ? .85 + .15 * clamp((view.zoom - screen.levels[0]) / Math.max(1e-6, screen.levels.at(-1) - screen.levels[0]), 0, 1) : 1;
      const placed = [];
      for (const group of groups.values()) {
        if (group.centred) { if (audio.play(group.name)) { stats.stingers++; centredAt.set(group.name, wall); } continue; }
        const at = placeCue(group.x / group.count, group.y / group.count, view, screen);
        const gain = at.gain * group.gain * zoomScale * Math.min(1.4, 1 + .25 * Math.log2(group.count));
        if (gain < .05) { stats.dropped++; continue; }
        placed.push({ name: group.name, pan: at.pan, gain, distant: at.distant, category: RECIPES[group.name]?.category });
      }
      // The loudest cues of each combat category win when a frame holds more than the budget.
      placed.sort((a, b) => b.gain - a.gain);
      const used = {};
      for (const item of placed) {
        const limit = FRAME_LIMITS[item.category];
        if (limit && (used[item.category] = (used[item.category] || 0) + 1) > limit) { stats.dropped++; continue; }
        if (audio.play(item.name, { pan: item.pan, gain: item.gain, distant: item.distant })) stats.cues++;
      }
      if (wall >= nextAmbient) { nextAmbient = wall + .25; this.ambience(view, screen); }
    },
    // Ambient beds from what the camera shows: wind grows as the view widens, lava only from cells the
    // player currently sees, industry from friendly refineries processing shards and busy production bays.
    ambience(view, screen) {
      const halfWidth = screen.width / 2 / view.zoom, halfHeight = screen.height / 2 / view.zoom, width = game.width;
      const x0 = Math.max(0, Math.floor(view.x - halfWidth)), x1 = Math.min(width, Math.ceil(view.x + halfWidth));
      const y0 = Math.max(0, Math.floor(view.y - halfHeight)), y1 = Math.min(game.height, Math.ceil(view.y + halfHeight));
      const step = (x1 - x0) * (y1 - y0) > 6000 ? 2 : 1, sight = game.visible[0], terrain = game.terrain;
      let lava = 0, lavaX = 0;
      for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
        const index = y * width + x;
        if (terrain[index] === 3 && sight[index]) { lava++; lavaX += x + .5; }
      }
      let industry = 0, industryPan = 0;
      for (const e of game.entities) {
        if (e.team !== 0 || e.kind !== 'building' || e.hp <= 0 || (e.progress ?? 1) < 1) continue;
        const role = buildingRole(e), busy = role === 'refinery' ? e.processingAmount > 0 || e.queue?.length > 0 : (role === 'barracks' || role === 'factory') && e.queue?.length > 0;
        if (!busy) continue;
        const at = placeCue(e.x + e.size / 2, e.y + e.size / 2, view, screen);
        industry += at.gain; industryPan += at.pan * at.gain;
      }
      const levels = screen.levels, far = levels?.length ? 1 - clamp((view.zoom - levels[0]) / Math.max(1e-6, levels.at(-1) - levels[0]), 0, 1) : .5;
      const lavaCells = lava * step * step;
      audio.setAmbient?.({
        wind: { gain: .3 + .45 * far, pan: 0 },
        lava: { gain: lavaCells ? Math.min(1, Math.sqrt(lavaCells / 60)) * .9 : 0, pan: lava ? clamp((lavaX / lava - view.x) / Math.max(1, halfWidth) * .8, -.8, .8) : 0 },
        industry: { gain: Math.min(.9, industry * .35), pan: industry ? clamp(industryPan / industry, -.8, .8) : 0 },
      });
      audio.setIntensity?.(intensity);
    },
    // Unit acknowledgement for a player command: the lead unit's voice line, returned as {unit, context}
    // so the HUD's comms text says the same line, or false when nobody answers. Rapidly re-selecting the
    // same squad turns its reply annoyed. Explore orders are voiced as a move but keep their own text.
    acknowledge(context, units) {
      if (!game || !units?.length) return false;
      const lead = leadUnit(units), role = unitRole(lead);
      if (lead.team !== 0 || !VOICE_ROLES.includes(role)) return false;
      const wall = clock();
      let line = context === 'harvest' && role !== 'harvester' ? 'move' : context;
      if (context === 'select') {
        const signature = `${lead.id}:${units.length}`;
        lastSelect = signature === lastSelect.signature && wall - lastSelect.at < 1.2 ? { signature, at: wall, count: lastSelect.count + 1 } : { signature, at: wall, count: 1 };
        if (lastSelect.count >= 4) { line = 'annoyed'; lastSelect.count = 0; }
        // The second click of a double click belongs to the first click's reply: it counts toward
        // annoyance but does not cut that line off.
        else if (wall - selectSpoke < .25 || wall - lastAck < .12) return false;
        selectSpoke = wall;
      }
      speak(role, line === 'explore' ? 'move' : line);
      return { unit: lead, context: line };
    },
    // Replies voiced from the player's own events since the last call, as [{entityId, context}].
    takeReplies() {
      const taken = replies;
      replies = [];
      return taken;
    },
  };
}

// Pause-menu mix sliders (#volume-<channel>, values 0–100) bound to the engine's persisted settings.
export function bindAudioControls(audio, root = document) {
  for (const channel of VOLUME_CHANNELS) {
    const input = root.getElementById(`volume-${channel}`), output = root.getElementById(`volume-${channel}-value`);
    if (!input) continue;
    const show = () => { const text = `${input.value}%`; if (output) output.value = text; input.setAttribute('aria-valuetext', text); };
    input.value = String(Math.round(audio.settings.volumes[channel] * 100)); show();
    input.addEventListener('input', () => { audio.setVolume(channel, input.valueAsNumber / 100); show(); });
  }
}
