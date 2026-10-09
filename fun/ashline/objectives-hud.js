// Objective tracker, scripted transmissions and the pause-menu objective. Operation progress comes from the
// saved mission state; skirmishes show optional commander's goals derived from the player's own statistics.
// Everything shown here is the player's own state or a mission's deliberately published facts.
import { MISSIONS } from './campaign.js';
import { commanderGoals, missionTime } from './debrief.js';

const $ = id => document.getElementById(id);
const fmt = value => Math.floor(value).toLocaleString('en-US');
export const clock = seconds => { const t = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const FAIL_TEXT = {
  coreLost: 'Losing every nexus and construction vehicle ends the operation.',
  allUnitsLost: 'Losing every field unit ends the operation.',
};
// How long a transmission stays on screen, in real milliseconds, scaled by its length.
const transmissionMs = text => Math.min(14000, 6000 + text.length * 45);

// Progress text for one objective; empty when a tick says everything.
export function objectiveProgress(s, o, state) {
  const m = s.mission, count = o.count ?? 1;
  switch (o.type) {
    case 'destroyTagged': { const total = m.counters[`tagged:${o.tag}`] || 0; return total > 1 ? `${Math.min(total, state.progress)} / ${total}` : ''; }
    case 'survive': return state.state === 'active' ? `${clock(o.seconds - state.progress)} left` : '';
    case 'endure': return clock(state.progress);
    case 'holdZone': return `${clock(state.progress)} / ${clock(o.seconds)}`;
    case 'reachZone': case 'build': case 'train': return count > 1 || o.type !== 'reachZone' ? `${Math.min(count, state.progress)} / ${count}` : '';
    case 'deliver': return `${fmt(Math.min(o.amount, state.progress))} / ${fmt(o.amount)}`;
    case 'kills': return `${fmt(Math.min(o.count, state.progress))} / ${fmt(o.count)}`;
    case 'protectTagged': { const total = m.counters[`tagged:${o.tag}`] || 0; return o.all && total > 1 ? `${state.progress} / ${total} standing` : ''; }
    case 'limitLosses': { const limit = (o.units ?? 0) + (o.structures ?? 0); return `${state.progress} / ${limit} lost`; }
    default: return '';
  }
}

// Revealed objectives in display order (primaries first) with progress, plus how many remain classified.
export function objectiveRows(s) {
  const def = s.mission && MISSIONS[s.mission.id];
  if (!def) return null;
  const rows = def.objectives.map((o, i) => ({ o, state: s.mission.objectives[i] }));
  const shown = rows.filter(({ state }) => state.revealed).sort((a, b) => Number(Boolean(a.o.secondary)) - Number(Boolean(b.o.secondary)));
  return {
    def,
    rows: shown.map(({ o, state }) => ({ id: o.id, label: o.label, secondary: Boolean(o.secondary), state: state.state, progress: objectiveProgress(s, o, state) })),
    classified: rows.length - shown.length,
  };
}

// A rival's hold on a contested zone is public: the zone is lit for both claimants.
function contestLine(s, def) {
  const rule = (def.fail || []).find(r => r.type === 'rivalHold');
  if (!rule) return '';
  return `${rule.label || 'Rival'} hold ${clock(s.mission.counters[`rivalHold:${rule.zone}`] || 0)} / ${clock(rule.seconds)}`;
}

export function createObjectivesHud() {
  let shownFor = null, signature = '', transmissionUntil = 0, collapsed = matchMedia('(max-width: 680px)').matches;
  const done = new Map();
  const panel = $('objectives'), list = $('objectives-list'), toggle = $('objectives-toggle');
  const setCollapsed = value => {
    collapsed = value; panel.dataset.collapsed = String(value); toggle.setAttribute('aria-expanded', String(!value));
    document.body.style.setProperty('--objectives-height', `${panel.hidden ? 0 : panel.getBoundingClientRect().height}px`);
  };
  toggle.addEventListener('click', () => setCollapsed(!collapsed));

  function renderRows(items) {
    const key = JSON.stringify(items);
    if (key === signature) return;
    signature = key;
    list.replaceChildren(...items.map(item => {
      const li = document.createElement('li');
      li.dataset.state = item.state; li.dataset.kind = item.kind;
      if (item.fresh) li.classList.add('fresh');
      const mark = document.createElement('i'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = item.state === 'done' ? '✓' : item.state === 'failed' ? '✕' : item.kind === 'note' ? '·' : '';
      const label = document.createElement('span'); label.textContent = item.label;
      li.append(mark, label);
      if (item.progress) { const progress = document.createElement('small'); progress.textContent = item.progress; li.append(progress); }
      li.setAttribute('aria-label', `${item.kind === 'secondary' ? 'Secondary: ' : ''}${item.label}${item.progress ? `, ${item.progress}` : ''}${item.state === 'done' ? ', complete' : item.state === 'failed' ? ', failed' : ''}`);
      return li;
    }));
  }

  function update(s) {
    if (!s) { panel.hidden = true; return; }
    if (shownFor !== s) { shownFor = s; signature = ''; done.clear(); transmissionUntil = 0; $('transmission').hidden = true; setCollapsed(matchMedia('(max-width: 680px)').matches); }
    const now = performance.now(), table = objectiveRows(s);
    let items, title, count;
    if (table) {
      title = table.def.name;
      // Ticks flash briefly as they complete.
      items = table.rows.map(row => {
        if (row.state !== 'active' && !done.has(row.id)) done.set(row.id, now);
        return { label: row.label, state: row.state, kind: row.secondary ? 'secondary' : 'primary', progress: row.progress, fresh: now - (done.get(row.id) ?? -1e9) < 2500 };
      });
      if (table.classified) items.push({ label: `${table.classified} classified objective${table.classified > 1 ? 's' : ''}`, state: 'active', kind: 'note', progress: '' });
      const contest = contestLine(s, table.def);
      if (contest) items.push({ label: contest, state: 'active', kind: 'note', progress: '' });
      if (table.def.score === 'survival') items.push({ label: `Score ${fmt(s.mission.score || 0)}`, state: 'active', kind: 'note', progress: `${fmt(s.teams[0].kills || 0)} kills` });
      const primaries = table.rows.filter(row => !row.secondary);
      count = `${primaries.filter(row => row.state === 'done').length} / ${primaries.length + (table.def.objectives.filter((o, i) => !o.secondary && !s.mission.objectives[i].revealed).length)}`;
    } else {
      const goals = commanderGoals(s);
      if (!goals) { panel.hidden = true; return; }
      title = "Commander's goals";
      const open = goals.filter(goal => !goal.done).slice(0, 3), finished = goals.filter(goal => goal.done);
      for (const goal of finished) if (!done.has(goal.id)) done.set(goal.id, now);
      const recent = finished.filter(goal => now - done.get(goal.id) < 4000);
      items = [...recent, ...open].map(goal => ({ label: goal.label, state: goal.done ? 'done' : 'active', kind: 'secondary', progress: goal.done ? '' : `${fmt(goal.progress)} / ${fmt(goal.target)}`, fresh: goal.done }));
      count = `${finished.length} / ${goals.length}`;
    }
    $('objectives-title').textContent = title;
    $('objectives-count').textContent = count;
    renderRows(items);
    if (transmissionUntil && now > transmissionUntil) { transmissionUntil = 0; $('transmission').hidden = true; }
    const wasHidden = panel.hidden;
    panel.hidden = false;
    panel.dataset.mode = table ? 'operation' : 'goals';
    if (wasHidden || panel.dataset.collapsed !== String(collapsed)) setCollapsed(collapsed);
    else document.body.style.setProperty('--objectives-height', `${panel.getBoundingClientRect().height}px`);
  }

  // Shows scripted dialogue as a transmission; returns true when the event is handled here.
  function event(e) {
    if (e.kind !== 'dialogue') return false;
    $('transmission-speaker').textContent = e.speaker || 'Command';
    $('transmission-text').textContent = e.text;
    $('transmission').hidden = false;
    transmissionUntil = performance.now() + transmissionMs(e.text);
    return true;
  }

  return { update, event };
}

// Fills the pause menu's objective box for the current operation.
export function menuObjective(s) {
  const box = $('objective'), heading = box.querySelector('span'), text = box.querySelector('p');
  let list = box.querySelector('ul');
  if (!list) { list = document.createElement('ul'); box.append(list); }
  list.replaceChildren();
  const table = objectiveRows(s);
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
  const rules = (def.fail ?? [{ type: 'coreLost' }]).map(rule => FAIL_TEXT[rule.type] || (rule.type === 'timeLimit' ? `The operation window closes at ${clock(rule.seconds)}.` : rule.type === 'rivalHold' ? `${rule.label || 'The rival'} wins by holding the ${rule.zone} for ${clock(rule.seconds)}.` : `Losing ${(rule.label || 'the mission asset').replace(/^The /, 'the ')} ends the operation.`));
  text.textContent = def.score === 'survival' ? `Score ${fmt(s.mission.score || 0)} · ${rules.join(' ')}` : rules.join(' ');
  for (const item of table.rows) row(`${item.secondary ? 'Secondary · ' : ''}${item.label}`, item.state === 'active' ? item.secondary ? 'secondary' : 'active' : item.state, item.progress);
  if (table.classified) row(`${table.classified} classified objective${table.classified > 1 ? 's' : ''}`, 'note');
  list.hidden = false;
}
