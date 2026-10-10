// Objective tracker, scripted transmissions and the pause-menu objective. Operation progress comes from the
// saved mission state; skirmishes show optional commander's goals derived from the player's own statistics.
// Everything shown here is the player's own state or a mission's deliberately published facts.
import { MISSIONS } from './campaign.js';
import { objectiveVoid } from './mission.js';
import { commanderGoals, missionTime } from './debrief.js';

const $ = id => document.getElementById(id);
const fmt = value => Math.floor(value).toLocaleString('en-US');
export const clock = seconds => { const t = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const FAIL_TEXT = {
  coreLost: 'Losing every nexus and construction vehicle ends the operation.',
  allUnitsLost: 'Losing every field unit ends the operation.',
};
const failRule = rule => rule.type === 'allUnitsLost' && rule.armed ? 'Losing every armed unit ends the operation.' : FAIL_TEXT[rule.type];
// How long a transmission stays on screen, in real milliseconds, scaled by its length. A line that has others
// waiting behind it gives way after its reading time; older waiting lines drop beyond the queue limit.
const transmissionMs = text => Math.min(14000, 6000 + text.length * 45);
const readingMs = text => Math.min(9000, 2500 + text.length * 40);
const TRANSMISSION_QUEUE = 6;
// Short landscape screens start with the tracker folded, like phones.
const COMPACT = '(max-width: 680px), (max-height: 500px)';

// Progress text for one objective; empty when a tick says everything.
export function objectiveProgress(s, o, state) {
  const m = s.mission, count = o.count ?? 1;
  switch (o.type) {
    case 'destroyTagged': {
      // Only losses the player witnessed count. A group of structures placed with the operation is a set of
      // published points, so its total shows; a group with units never shows one, which would count forces
      // under fog.
      const total = m.counters[`tagged:${o.tag}`] || 0, seen = state.state === 'done' ? total : Math.min(total, state.progress);
      if (!m.counters[`mobile:${o.tag}`]) return total > 1 ? `${seen} / ${total}` : '';
      return state.progress ? `${fmt(state.progress)} destroyed` : '';
    }
    case 'survive': return state.state === 'active' ? `${clock(o.seconds - state.progress)} left` : '';
    case 'endure': return clock(state.progress);
    case 'holdZone': return `${clock(state.progress)} / ${clock(o.seconds)}`;
    case 'reachZone': case 'build': case 'train': return count > 1 || o.type !== 'reachZone' ? `${Math.min(count, state.progress)} / ${count}` : '';
    case 'deliver': return `${fmt(Math.min(o.amount, state.progress))} / ${fmt(o.amount)}`;
    case 'kills': return `${fmt(Math.min(o.count, state.progress))} / ${fmt(o.count)}`;
    case 'protectTagged': { const total = m.counters[`tagged:${o.tag}`] || 0; return o.all && total > 1 ? `${state.progress} / ${total} standing` : ''; }
    case 'limitLosses': {
      // Each limited category against its own limit, from the player's own statistics; the label names a
      // single category, so only a double limit spells them out.
      const stats = s.teams[0].stats, both = o.units !== undefined && o.structures !== undefined, parts = [];
      if (o.units !== undefined) parts.push(`${fmt(stats ? stats.lost : state.progress)} / ${fmt(o.units)}${both ? ' units' : ''}`);
      if (o.structures !== undefined) parts.push(`${fmt(stats ? stats.structuresLost : state.progress)} / ${fmt(o.structures)}${both ? ' structures' : ''}`);
      return `${parts.join(' · ')} lost`;
    }
    default: return '';
  }
}

// Revealed objectives in display order (primaries first) with progress, plus how many remain classified.
export function objectiveRows(s) {
  const def = s.mission && MISSIONS[s.mission.id];
  if (!def) return null;
  // An objective that cannot apply (veterans nobody brought) is neither listed nor counted as classified.
  const rows = def.objectives.map((o, i) => ({ o, state: s.mission.objectives[i] })).filter(({ o }) => !objectiveVoid(s.mission, o.id));
  const shown = rows.filter(({ state }) => state.revealed).sort((a, b) => Number(Boolean(a.o.secondary)) - Number(Boolean(b.o.secondary)));
  return {
    def,
    // A zone is a static mission point, so locating it never reveals anything hidden.
    rows: shown.map(({ o, state }) => { const zone = o.zone === undefined ? null : s.mission.zones.find(z => z.id === o.zone); return { id: o.id, label: o.label, secondary: Boolean(o.secondary), state: state.state, progress: objectiveProgress(s, o, state), ...(zone ? { zone: { x: zone.x, y: zone.y, label: zone.label } } : {}) }; }),
    classified: rows.length - shown.length,
  };
}

// A rival's hold on a contested zone is public: the zone is lit for both claimants.
function contestLine(s, def) {
  const rule = (def.fail || []).find(r => r.type === 'rivalHold');
  if (!rule) return null;
  const who = (rule.label || 'Rival').replace(/^The (\w)/, (_, letter) => letter.toUpperCase());
  return { label: `${who} hold`, progress: `${clock(s.mission.counters[`rivalHold:${rule.zone}`] || 0)} / ${clock(rule.seconds)}` };
}

// focus(x, y) centres the camera on a zone; transmit(line) runs as each queued transmission comes on screen
// (the place for a transmission sound).
export function createObjectivesHud({ focus, transmit } = {}) {
  let shownFor = null, structure = '', measured = '', nodes = [], collapsed = matchMedia(COMPACT).matches;
  // Transmissions run on a clock that advances only while the HUD keeps updating, so a line is not used up
  // while the game is paused or the tab is hidden.
  let queue = [], showing = null, clockMs = 0, lastNow = performance.now();
  const done = new Map();
  const panel = $('objectives'), list = $('objectives-list'), toggle = $('objectives-toggle'), transmission = $('transmission');
  // The tracker never reaches the tactical map below it on the left edge (it can on short landscape screens);
  // its list scrolls instead.
  const fit = () => {
    const map = document.querySelector('.tactical-map')?.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const below = map && map.height && map.left < box.right && map.right > box.left && map.top > box.top;
    panel.style.maxHeight = below ? `${Math.max(36, Math.floor(map.top - 8 - box.top))}px` : '';
  };
  // Other HUD parts stack below the tracker through --objectives-height; measure only when the layout changes.
  const measure = () => {
    const key = `${panel.hidden}|${collapsed}|${structure}|${transmission.hidden}|${$('transmission-text').textContent.length}|${innerWidth}x${innerHeight}`;
    if (key === measured) return;
    measured = key;
    if (!panel.hidden) fit();
    document.body.style.setProperty('--objectives-height', `${panel.hidden ? 0 : panel.getBoundingClientRect().height}px`);
  };
  addEventListener('resize', measure);
  const setCollapsed = value => { collapsed = value; panel.dataset.collapsed = String(value); toggle.setAttribute('aria-expanded', String(!value)); measure(); };
  // A pointer click hands the keyboard back to the battlefield so Space and WASD keep working.
  toggle.addEventListener('click', event => { setCollapsed(!collapsed); if (event.detail) document.getElementById('world')?.focus({ preventScroll: true }); });
  const hide = () => { panel.hidden = true; measure(); };
  function showNext() {
    showing = queue.shift() ?? null;
    if (showing) {
      $('transmission-speaker').textContent = showing.speaker;
      $('transmission-text').textContent = showing.text;
      showing.at = clockMs;
      transmit?.({ speaker: showing.speaker, text: showing.text });
    }
    transmission.hidden = !showing;
  }
  function advanceTransmissions(now) {
    clockMs += Math.min(250, Math.max(0, now - lastNow)); lastNow = now;
    const shown = showing ? clockMs - showing.at : 0;
    if (showing ? shown > transmissionMs(showing.text) || queue.length && shown > readingMs(showing.text) : queue.length) showNext();
  }

  // Rows are rebuilt only when their structure changes; ticking timers and counts update in place, so a
  // press on a locate button is never lost to a rebuild.
  function renderRows(items) {
    const shape = JSON.stringify(items.map(item => [item.label, item.state, item.kind, Boolean(item.progress), Boolean(item.zone)]));
    if (shape !== structure) {
      structure = shape;
      nodes = items.map(item => {
        const li = document.createElement('li'), node = { li, zone: item.zone };
        li.dataset.state = item.state; li.dataset.kind = item.kind;
        const mark = document.createElement('i'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = item.state === 'done' ? '✓' : item.state === 'failed' ? '✕' : item.kind === 'note' ? '·' : '';
        const label = document.createElement('span'); label.textContent = item.label;
        li.append(mark, label);
        if (item.progress) { node.progress = document.createElement('small'); li.append(node.progress); }
        if (item.zone && focus) {
          const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'objective-locate'; locate.textContent = '⌖';
          locate.title = `Show ${item.zone.label}`; locate.setAttribute('aria-label', `Show ${item.zone.label} on the battlefield`);
          locate.addEventListener('click', event => { focus(node.zone.x, node.zone.y); if (event.detail) document.getElementById('world')?.focus({ preventScroll: true }); });
          li.append(locate);
        }
        return node;
      });
      list.replaceChildren(...nodes.map(node => node.li));
    }
    items.forEach((item, i) => {
      const node = nodes[i];
      node.zone = item.zone;
      if (node.progress && node.progress.textContent !== item.progress) node.progress.textContent = item.progress;
      node.li.classList.toggle('fresh', Boolean(item.fresh));
      node.li.setAttribute('aria-label', `${item.kind === 'secondary' ? 'Secondary: ' : ''}${item.label}${item.progress ? `, ${item.progress}` : ''}${item.state === 'done' ? ', complete' : item.state === 'failed' ? ', failed' : ''}`);
    });
  }

  function update(s) {
    if (!s) { hide(); return; }
    if (shownFor !== s) { shownFor = s; structure = ''; done.clear(); queue = []; showing = null; transmission.hidden = true; collapsed = matchMedia(COMPACT).matches; }
    const now = performance.now(), table = objectiveRows(s);
    let items, title, count;
    if (table) {
      title = table.def.name;
      // Ticks flash briefly as they complete.
      items = table.rows.map(row => {
        if (row.state !== 'active' && !done.has(row.id)) done.set(row.id, now);
        return { label: row.label, state: row.state, kind: row.secondary ? 'secondary' : 'primary', progress: row.progress, zone: row.state === 'active' ? row.zone : undefined, fresh: now - (done.get(row.id) ?? -1e9) < 2500 };
      });
      if (table.classified) items.push({ label: `${table.classified} classified objective${table.classified > 1 ? 's' : ''}`, state: 'active', kind: 'note', progress: '' });
      const contest = contestLine(s, table.def);
      if (contest) items.push({ label: contest.label, state: 'active', kind: 'note', progress: contest.progress });
      if (table.def.score === 'survival') items.push({ label: 'Score', state: 'active', kind: 'note', progress: `${fmt(s.mission.score || 0)} · ${fmt(s.teams[0].kills || 0)} kills` });
      // Alternative routes to victory ("Or destroy every rival claim") are not counted as extra steps.
      const required = table.def.objectives.map((o, i) => ({ o, state: s.mission.objectives[i] })).filter(({ o }) => !o.secondary && !objectiveVoid(s.mission, o.id));
      const steps = required.filter(({ o }) => !o.sufficient), shortcut = required.some(({ o, state }) => o.sufficient && state.state === 'done');
      const finished = shortcut ? steps.length : steps.filter(({ state }) => state.state === 'done').length;
      count = `${finished} / ${steps.length}`;
    } else {
      const goals = commanderGoals(s);
      if (!goals) { hide(); return; }
      title = "Commander's goals";
      const open = goals.filter(goal => !goal.done).slice(0, 3), finished = goals.filter(goal => goal.done);
      for (const goal of finished) if (!done.has(goal.id)) done.set(goal.id, now);
      const recent = finished.filter(goal => now - done.get(goal.id) < 4000);
      items = [...recent, ...open].map(goal => ({ label: goal.label, state: goal.done ? 'done' : 'active', kind: 'secondary', progress: goal.done ? '' : `${fmt(goal.progress)} / ${fmt(goal.target)}`, fresh: goal.done }));
      count = `${finished.length} / ${goals.length}`;
    }
    if ($('objectives-title').textContent !== title) $('objectives-title').textContent = title;
    if ($('objectives-count').textContent !== count) $('objectives-count').textContent = count;
    renderRows(items);
    advanceTransmissions(now);
    panel.hidden = false;
    panel.dataset.mode = table ? 'operation' : 'goals';
    if (panel.dataset.collapsed !== String(collapsed)) setCollapsed(collapsed); else measure();
  }

  // Queues scripted dialogue as transmissions, shown in order; returns true when the event is handled here.
  // Lines that arrive together (two speakers in one exchange, or a burst at high game speed) each get their
  // turn on screen.
  function event(e) {
    if (e.kind !== 'dialogue') return false;
    queue.push({ speaker: e.speaker || 'Command', text: e.text });
    if (queue.length > TRANSMISSION_QUEUE) queue.shift();
    if (!showing) { lastNow = performance.now(); showNext(); measure(); }
    return true;
  }

  return { update, event };
}

// Fills the pause menu's objective box for the current operation.
export function menuObjective(s) {
  const box = $('objective'), heading = box.querySelector('span'), text = box.querySelector('p');
  let list = box.querySelector('ul');
  if (!list) { list = document.createElement('ul'); box.insertBefore(list, text); }
  list.replaceChildren();
  const table = objectiveRows(s);
  box.dataset.mode = table ? 'operation' : 'skirmish';
  const row = (label, state, detail = '') => {
    const li = document.createElement('li'); li.dataset.state = state;
    li.textContent = label; if (detail) { const small = document.createElement('small'); small.textContent = detail; li.append(small); }
    list.append(li);
  };
  if (!table) {
    heading.textContent = 'Objective';
    text.textContent = 'Destroy all enemy nexuses and construction vehicles.';
    const goals = commanderGoals(s);
    if (goals) for (const goal of goals.filter(goal => !goal.done).slice(0, 3)) row(goal.label, 'secondary', `${fmt(goal.progress)} / ${fmt(goal.target)}`);
    list.hidden = !list.children.length;
    return;
  }
  const { def } = table;
  heading.textContent = def.score === 'survival' ? `${def.name} · ${clock(missionTime(s))}` : `${def.name} · objectives`;
  const rules = (def.fail ?? [{ type: 'coreLost' }]).map(rule => failRule(rule) || (rule.type === 'timeLimit' ? `The operation window closes at ${clock(rule.seconds)}.` : rule.type === 'rivalHold' ? `${rule.label || 'The rival'} wins by holding the ${rule.zone} for ${clock(rule.seconds)}.` : `Losing ${(rule.label || 'the mission asset').replace(/^The /, 'the ')} ends the operation.`));
  text.textContent = def.score === 'survival' ? `Score ${fmt(s.mission.score || 0)} · ${rules.join(' ')}` : rules.join(' ');
  for (const item of table.rows) row(`${item.secondary ? 'Secondary · ' : ''}${item.label}`, item.state === 'active' ? item.secondary ? 'secondary' : 'active' : item.state, item.progress);
  if (table.classified) row(`${table.classified} classified objective${table.classified > 1 ? 's' : ''}`, 'note');
  list.hidden = false;
}
