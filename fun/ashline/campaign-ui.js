// Operation Ashline on the briefing screen and around a match: campaign and skirmish tabs, the operation list
// with locks, medals and best times, operation briefings, launch settings, the pre-start pause, the end-menu
// debrief with Next / Retry / Remix, local progress and career records, and the Field archive.
// The briefing stays static DOM: nothing here creates game state, requests art or schedules frames.
// Storage is optional; every read and write tolerates a blocked or full localStorage.
import { UNITS, BUILDINGS, RESEARCH, BUILDING_UPGRADES, MAP_PROFILES } from './sim.js';
import { MISSIONS, CAMPAIGN, SKIRMISH_MODES, ARCHIVE } from './campaign.js';
import { matchReport, survivingVeterans, addToCareer, readCareer, rivalName, rivalLabel, MEDALS } from './debrief.js';
import { createObjectivesHud, menuObjective, clock } from './objectives-hud.js';

export const PROGRESS_KEY = 'ashline.campaign.v1', CAREER_KEY = 'ashline.career.v1';
const LEVELS = ['easy', 'normal', 'hard'], LEVEL_NAMES = { easy: 'Cadet', normal: 'Commander', hard: 'Veteran' };
const MEDAL_NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const CATEGORY_TABLES = { buildings: BUILDINGS, units: UNITS, research: RESEARCH, upgrades: BUILDING_UPGRADES };
const fmt = value => Math.floor(value).toLocaleString('en-US');
const count = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const $ = id => document.getElementById(id);

// ---- Stored progress -------------------------------------------------------------------------------------

export function emptyProgress() { return { version: 1, missions: {}, veterans: [], lastLight: { best: 0 }, tab: 'skirmish', selected: CAMPAIGN[0], difficulty: 'normal' }; }
// Accepts whatever storage returned and keeps only well-formed, bounded records.
export function readProgress(value) {
  const progress = emptyProgress();
  if (!value || typeof value !== 'object') return progress;
  for (const id of CAMPAIGN) {
    const record = value.missions?.[id];
    if (!record || typeof record !== 'object') continue;
    const clean = { plays: 0, wins: 0, medal: null, best: null, grade: null };
    for (const key of ['plays', 'wins']) if (Number.isInteger(record[key]) && record[key] >= 0) clean[key] = Math.min(record[key], 1e6);
    if (MEDALS.includes(record.medal)) clean.medal = record.medal;
    if (Number.isFinite(record.best) && record.best > 0) clean.best = record.best;
    if (typeof record.grade === 'string' && /^[SABCD]$/.test(record.grade)) clean.grade = record.grade;
    progress.missions[id] = clean;
  }
  if (Array.isArray(value.veterans)) progress.veterans = value.veterans.filter(v => v && Object.hasOwn(UNITS, v.role) && UNITS[v.role].role === v.role && UNITS[v.role].damage > 0 && Number.isInteger(v.kills) && v.kills >= 0 && v.kills <= 1000).slice(0, 12).map(({ role, kills }) => ({ role, kills }));
  if (Number.isFinite(value.lastLight?.best) && value.lastLight.best >= 0) progress.lastLight.best = value.lastLight.best;
  if (['campaign', 'skirmish'].includes(value.tab)) progress.tab = value.tab;
  if (CAMPAIGN.includes(value.selected)) progress.selected = value.selected;
  if (LEVELS.includes(value.difficulty)) progress.difficulty = value.difficulty;
  // A selection that is not open (edited storage) falls back to the latest open operation.
  if (!isUnlocked(progress, progress.selected)) progress.selected = [...CAMPAIGN].reverse().find(id => isUnlocked(progress, id));
  return progress;
}
function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

export const isUnlocked = (progress, id) => { const index = CAMPAIGN.indexOf(id); return index === 0 || index > 0 && (progress.missions[CAMPAIGN[index - 1]]?.wins || 0) > 0; };
const better = (a, b) => MEDALS.indexOf(a) > MEDALS.indexOf(b) ? a : b;
// Folds a finished operation into campaign progress: medals and best times only improve, Dead Signal
// survivors become the veterans Severance deploys, and Last Light keeps its best score.
export function recordResult(progress, s, report) {
  const next = readProgress(progress), id = s.mission?.id;
  if (id === 'last-light') { next.lastLight.best = Math.max(next.lastLight.best, report.survival || 0); return next; }
  if (!CAMPAIGN.includes(id)) return next;
  const record = next.missions[id] ?? { plays: 0, wins: 0, medal: null, best: null, grade: null };
  record.plays++;
  if (report.status === 'victory') {
    record.wins++;
    record.medal = better(report.medal, record.medal);
    record.best = record.best === null ? report.time : Math.min(record.best, report.time);
    if (!record.grade || 'SABCD'.indexOf(report.grade) < 'SABCD'.indexOf(record.grade)) record.grade = report.grade;
    if (id === 'dead-signal') next.veterans = survivingVeterans(s);
  }
  next.missions[id] = record;
  return next;
}

export function steppedDifficulty(level, step = 0) { return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(level) + step))] ?? 'normal'; }
// Launch settings for a campaign operation. A remix keeps the operation and plays it on a fresh sector.
export function launchSettings(id, { difficulty = 'normal', seed } = {}, progress = emptyProgress()) {
  const def = MISSIONS[id];
  return {
    mission: id, seed: seed || def.seed, difficulty: steppedDifficulty(difficulty, def.aiStep || 0), chosen: difficulty, prestart: true, line: def.briefing,
    options: { mission: id, ...(id === 'severance' && progress.veterans.length ? { veterans: progress.veterans.map(v => ({ ...v })) } : {}) },
  };
}

// Names newly cleared by an operation compared with every earlier one. A nexus is never constructed
// directly (construction vehicles deploy it), so it is not listed.
export function newlyCleared(id) {
  const index = CAMPAIGN.indexOf(id), allowed = def => category => def.allow?.[category] ?? Object.keys(CATEGORY_TABLES[category]).filter(key => CATEGORY_TABLES[category][key].race !== 'aiUnity' && key !== 'core');
  const names = [];
  for (const category of Object.keys(CATEGORY_TABLES)) {
    const before = new Set(CAMPAIGN.slice(0, Math.max(0, index)).flatMap(earlier => allowed(MISSIONS[earlier])(category)));
    for (const key of allowed(MISSIONS[id])(category)) if (!before.has(key)) names.push(CATEGORY_TABLES[category][key].name);
  }
  return names;
}

// ---- Field archive -----------------------------------------------------------------------------------------

const unitLine = d => `◈ ${fmt(d.cost)} · ${fmt(d.hp)} HP${d.damage ? ` · ${d.damage} damage · range ${d.range}` : ''} · speed ${d.speed}`;
const buildingLine = d => `◈ ${fmt(d.cost)} · ${fmt(d.hp)} HP${d.damage ? ` · ${d.damage} damage · range ${d.range}` : ''}${d.power ? ` · ${d.power > 0 ? '+' : '−'}${Math.abs(d.power)} power` : ''}`;
export function archiveEntries(section) {
  if (['world', 'factions', 'people'].includes(section)) return ARCHIVE[section].map(entry => ({ ...entry }));
  const race = section === 'unity' ? 'aiUnity' : 'organics';
  const units = Object.entries(UNITS).filter(([, d]) => d.race === race).map(([type, d]) => ({ title: d.name, kind: 'Unit', meta: unitLine(d), text: d.description, flavor: ARCHIVE.flavor[type] }));
  const buildings = Object.entries(BUILDINGS).filter(([, d]) => d.race === race || d.race === 'both').map(([type, d]) => ({ title: d.name, kind: 'Structure', meta: buildingLine(d), text: d.description, flavor: ARCHIVE.flavor[type] }));
  return [...units, ...buildings];
}
const ARCHIVE_SECTIONS = [['world', 'Tephra'], ['factions', 'Claimants'], ['people', 'People'], ['organics', 'Organics'], ['unity', 'AI Unity']];
function installArchive() {
  const dialog = $('archive'), tabs = $('archive-tabs'), body = $('archive-body');
  const show = section => {
    for (const button of tabs.children) { const on = button.dataset.section === section; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; }
    body.setAttribute('aria-labelledby', `archive-tab-${section}`);
    body.replaceChildren(...archiveEntries(section).map(entry => {
      const item = document.createElement('article'); item.className = 'archive-entry';
      const title = document.createElement('h3'); title.textContent = entry.title;
      if (entry.kind) { const kind = document.createElement('small'); kind.textContent = entry.kind; title.append(kind); }
      item.append(title);
      if (entry.meta) { const meta = document.createElement('p'); meta.className = 'archive-meta'; meta.textContent = entry.meta; item.append(meta); }
      const text = document.createElement('p'); text.textContent = entry.text; item.append(text);
      if (entry.flavor) { const flavor = document.createElement('p'); flavor.className = 'archive-flavor'; flavor.textContent = entry.flavor; item.append(flavor); }
      return item;
    }));
    body.scrollTop = 0;
  };
  tabs.replaceChildren(...ARCHIVE_SECTIONS.map(([section, label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'tab'; button.id = `archive-tab-${section}`;
    button.dataset.section = section; button.textContent = label; button.setAttribute('aria-controls', 'archive-body');
    button.addEventListener('click', () => show(section));
    return button;
  }));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = [...tabs.children], index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next.focus(); next.click(); event.preventDefault();
  });
  show('world');
  const open = () => { if (!dialog.open) dialog.showModal(); tabs.querySelector('[aria-selected=true]')?.focus(); };
  $('archive-open').addEventListener('click', open);
  $('menu-archive').addEventListener('click', open);
  $('archive-close').addEventListener('click', () => dialog.close());
  // Resuming from the pause menu (P) must not leave the archive over a running battlefield.
  $('menu').addEventListener('close', () => dialog.close());
}

// ---- Briefing ----------------------------------------------------------------------------------------------

function setText(id, text) { $(id).textContent = text; }
function medalBadge(medal, empty = '') {
  const badge = document.createElement('span'); badge.className = 'medal'; badge.dataset.medal = medal || 'none';
  badge.textContent = medal ? MEDAL_NAMES[medal] : empty; return badge;
}

export function createCampaign({ launch, focus, transmit }) {
  let progress = readProgress(load(PROGRESS_KEY)), career = readCareer(load(CAREER_KEY)), pending = null, current = null, previousBest = 0;
  const recorded = new WeakSet(), hud = createObjectivesHud({ focus, transmit });
  const save = () => store(PROGRESS_KEY, progress);

  function setTab(tab, focus = false) {
    progress.tab = tab; save();
    for (const [name, panel] of [['campaign', 'campaign-panel'], ['skirmish', 'skirmish-panel']]) {
      const button = $(`${name}-tab`), on = name === tab;
      button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; $(panel).hidden = !on;
      if (on && focus) button.focus();
    }
  }
  for (const name of ['campaign', 'skirmish']) $(`${name}-tab`).addEventListener('click', () => setTab(name));
  $('campaign-tab').parentElement.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    setTab(progress.tab === 'campaign' ? 'skirmish' : 'campaign', true); event.preventDefault();
  });
  $('campaign-invite').addEventListener('click', () => setTab('campaign', true));

  function renderList() {
    const done = CAMPAIGN.filter(id => progress.missions[id]?.wins).length;
    setText('campaign-progress', `${done} / ${CAMPAIGN.length}`);
    $('campaign-list').replaceChildren(...CAMPAIGN.map((id, index) => {
      const def = MISSIONS[id], record = progress.missions[id], open = isUnlocked(progress, id);
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'campaign-entry'; button.dataset.mission = id;
      button.setAttribute('aria-pressed', String(progress.selected === id)); button.disabled = !open;
      const number = document.createElement('span'); number.className = 'entry-index'; number.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span'); name.className = 'entry-name'; name.textContent = def.name;
      const place = document.createElement('small'); place.textContent = open ? def.location : 'Locked'; name.append(place);
      const time = document.createElement('span'); time.className = 'entry-time'; time.textContent = record?.best ? clock(record.best) : '';
      button.append(number, name, time, medalBadge(record?.medal));
      button.setAttribute('aria-label', `Operation ${index + 1}: ${def.name}${open ? '' : ', locked'}${record?.medal ? `, ${MEDAL_NAMES[record.medal]} medal` : ''}${record?.best ? `, best ${clock(record.best)}` : ''}`);
      button.addEventListener('click', () => {
        progress.selected = id; save(); renderList(); renderDetail();
        $('campaign-list').querySelector(`[data-mission="${id}"]`).focus({ preventScroll: true });
        $('campaign-detail').scrollIntoView({ block: 'nearest' });
      });
      item.append(button); return item;
    }));
  }

  function renderDetail() {
    const id = isUnlocked(progress, progress.selected) ? progress.selected : CAMPAIGN[0], def = MISSIONS[id], record = progress.missions[id];
    const index = CAMPAIGN.indexOf(id), rival = rivalLabel(def.races);
    setText('campaign-eyebrow', `Operation ${String(index + 1).padStart(2, '0')} · ${def.location}`);
    setText('campaign-name', def.name);
    setText('campaign-summary', def.summary);
    $('campaign-story').replaceChildren(...def.story.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    // Protecting veterans applies only when the roster brings some (mission.js voids it otherwise).
    const applies = o => !(o.type === 'protectTagged' && o.tag === 'veteran' && !progress.veterans.length);
    const listed = def.objectives.filter(applies), visible = listed.filter(o => !o.hidden), hidden = listed.length - visible.length;
    $('campaign-objectives').replaceChildren(...visible.map(o => {
      const li = document.createElement('li'); li.dataset.kind = o.secondary ? 'secondary' : 'primary';
      li.textContent = `${o.secondary ? 'Secondary · ' : ''}${o.label}`; return li;
    }), ...(hidden ? [Object.assign(document.createElement('li'), { textContent: `${hidden} more objective${hidden > 1 ? 's' : ''} revealed in the field`, className: 'note' })] : []));
    const cleared = newlyCleared(id);
    setText('campaign-unlocks', def.allow && !Object.values(def.allow).some(list => list.length) ? 'No construction or recruitment: the strike team is all you have.' : cleared.length ? cleared.join(' · ') : 'No new equipment for this operation.');
    setText('campaign-sector', `${def.width} × ${def.height} · ${MAP_PROFILES[def.profile].name}`);
    setText('campaign-opposition', `${rival}${def.aiTeams?.includes(1) ? def.aiStep ? ' commander · one level above your setting' : ' commander' : ' garrison · no commander'}`);
    setText('campaign-par', clock(def.par));
    setText('campaign-best', record?.best ? `${clock(record.best)}${record.grade ? ` · grade ${record.grade}` : ''}` : '—');
    $('campaign-medal').replaceChildren(medalBadge(record?.medal, 'None yet'));
    $('campaign-veterans').hidden = id !== 'severance';
    setText('campaign-veterans', progress.veterans.length ? `${progress.veterans.length} Dead Signal veteran${progress.veterans.length > 1 ? 's' : ''} join this operation with their ranks.` : 'No Dead Signal veterans on the roster. Ranked survivors of Dead Signal join this operation.');
    $('campaign-start').dataset.mission = id;
  }

  function renderCareer() {
    const line = career.operations ? `Career · ${count(career.operations, 'operation')} · ${count(career.victories, 'victory', 'victories')} · ${count(career.kills, 'kill')}${career.bestGrade ? ` · best grade ${career.bestGrade}` : ''}` : '';
    $('career-line').textContent = line; $('career-line').hidden = !line;
  }
  function renderModes() {
    const select = $('skirmish-mode');
    if (!select.options.length || select.options.length !== SKIRMISH_MODES.length) select.replaceChildren(...SKIRMISH_MODES.map(mode => new Option(mode.name, mode.id)));
    const mode = SKIRMISH_MODES.find(entry => entry.id === select.value) ?? SKIRMISH_MODES[0];
    $('mode-description').textContent = `${mode.description}${mode.id === 'lastLight' && progress.lastLight.best ? ` Best score ${fmt(progress.lastLight.best)}.` : ''}`;
  }
  $('skirmish-mode').addEventListener('change', renderModes);

  function startOperation(remix) {
    const id = $('campaign-start').dataset.mission;
    if (!isUnlocked(progress, id)) return;
    play(id, { difficulty: $('campaign-difficulty').value, seed: remix ? remixSeed() : undefined });
  }
  $('campaign-difficulty').value = progress.difficulty;
  $('campaign-difficulty').addEventListener('change', () => { progress.difficulty = $('campaign-difficulty').value; save(); });
  $('campaign-start').addEventListener('click', () => startOperation(false));
  $('campaign-remix').addEventListener('click', () => startOperation(true));

  function play(id, settings) {
    pending = launchSettings(id, settings, progress);
    progress.selected = id; progress.tab = 'campaign'; save();
    launch();
    // The loader takes the launch synchronously; one that was refused (already loading) must not linger.
    pending = null;
  }

  // ---- Match hooks -------------------------------------------------------------------------------------

  // Hands the pending campaign launch to the loader once; skirmish deployments receive null. Also sets the
  // loading screen's briefing line.
  function takeLaunch(restore = false) {
    const operation = restore ? null : pending;
    pending = null;
    current = operation;
    const mode = SKIRMISH_MODES.find(entry => entry.id === $('skirmish-mode').value);
    const line = restore ? '' : operation?.line ?? (mode?.mission ? MISSIONS[mode.mission].briefing : '');
    $('loading-briefing').textContent = line; $('loading-briefing').hidden = !line;
    return operation;
  }
  // The scripted skirmish mode chosen in setup, if any.
  const skirmishMission = () => SKIRMISH_MODES.find(entry => entry.id === $('skirmish-mode').value)?.mission;
  // A restored skirmish shows the mode it was deployed with; operations and plain skirmishes show the first.
  function selectMode(mission) {
    $('skirmish-mode').value = SKIRMISH_MODES.find(entry => entry.mission && entry.mission === mission)?.id ?? SKIRMISH_MODES[0].id;
    renderModes();
  }

  function finish(s) {
    if (recorded.has(s)) return;
    recorded.add(s);
    const report = matchReport(s);
    career = addToCareer(career, report, `${s.seed}|${s.mission?.id ?? 'skirmish'}|${s.status}|${s.time.toFixed(2)}|${s.nextId}`);
    store(CAREER_KEY, career);
    if (s.mission) {
      previousBest = progress.lastLight.best;
      progress = recordResult(progress, s, report);
      // A victory points the briefing at the operation it unlocked.
      const next = CAMPAIGN[CAMPAIGN.indexOf(s.mission.id) + 1];
      if (report.status === 'victory' && next && CAMPAIGN.includes(s.mission.id)) progress.selected = next;
      save();
    }
    renderList(); renderDetail(); renderCareer(); renderModes();
  }

  function debrief(s) {
    const report = matchReport(s), box = $('match-summary'), def = s.mission ? MISSIONS[s.mission.id] : null;
    const head = document.createElement('div'); head.className = 'debrief-head';
    const grade = document.createElement('span'); grade.className = 'grade'; grade.dataset.grade = report.grade; grade.textContent = report.grade;
    const score = document.createElement('div');
    const points = document.createElement('b'); points.textContent = report.survival !== undefined ? `Survival score ${fmt(report.survival)}` : `Score ${fmt(report.score)}`;
    const detail = document.createElement('small');
    detail.textContent = report.survival !== undefined ? `${clock(report.time)} survived · ${fmt(report.kills)} kills · ${report.survival > previousBest ? 'new best' : `best ${fmt(progress.lastLight.best)}`}` : `Rating ${report.rating} / 100 · ${clock(report.time)} in field`;
    score.append(points, detail);
    head.append(grade, score);
    if (def && CAMPAIGN.includes(def.id)) head.append(medalBadge(report.medal));
    const rows = report.you ? [
      ['Units trained', report.you.trained, report.rival?.trained], ['Units lost', report.you.lost, report.rival?.lost],
      ['Structures built', report.you.built, report.rival?.built], ['Structures lost', report.you.structuresLost, report.rival?.structuresLost],
      ['Credits mined', report.you.mined, report.rival?.mined], ['Credits spent', report.you.spent, report.rival?.spent],
      ['Research completed', report.you.researched, report.rival?.researched], ['Peak army', report.you.peakArmy, report.rival?.peakArmy],
      ['Units destroyed', report.you.unitKills, report.rival?.unitKills], ['Structures destroyed', report.you.structureKills, report.rival?.structureKills],
    ] : [];
    const parts = [head];
    if (rows.length) {
      const table = document.createElement('table'); table.className = 'debrief-table';
      const caption = document.createElement('caption'); caption.textContent = 'Operation record'; table.append(caption);
      const header = table.createTHead().insertRow();
      for (const text of ['', 'You', report.rival ? rivalName(s) : '']) { const th = document.createElement('th'); th.textContent = text; th.scope = 'col'; header.append(th); }
      const body = table.createTBody();
      for (const [label, you, rival] of rows) {
        const row = body.insertRow(), th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
        row.insertCell().textContent = fmt(you); row.insertCell().textContent = rival === undefined ? '' : fmt(rival);
      }
      parts.push(table);
    } else {
      const note = document.createElement('p'); note.className = 'debrief-note'; note.textContent = `${clock(report.time)} in field · ${fmt(report.kills)} enemies destroyed · this operation predates field records.`;
      parts.push(note);
    }
    if (def && CAMPAIGN.includes(def.id)) {
      const criteria = document.createElement('ul'); criteria.className = 'debrief-medals';
      const secondary = report.secondary;
      for (const [medal, met, text] of [
        ['bronze', report.status === 'victory', 'Complete every primary objective'],
        ['silver', report.status === 'victory' && secondary.done === secondary.total, `Complete every secondary objective (${secondary.done} / ${secondary.total})`],
        ['gold', report.medal === 'gold', `Silver within par ${clock(def.par)}`],
      ]) { const li = document.createElement('li'); li.dataset.met = String(met); li.dataset.medal = medal; li.textContent = `${MEDAL_NAMES[medal]} · ${text}`; criteria.append(li); }
      parts.push(criteria);
    } else if (report.goals) {
      const goals = document.createElement('p'); goals.className = 'debrief-note'; goals.textContent = `Commander's goals ${report.goals.done} / ${report.goals.total}`; parts.push(goals);
    }
    const careerLine = document.createElement('p'); careerLine.className = 'debrief-career';
    careerLine.textContent = `Career · ${count(career.operations, 'operation')} · ${count(career.victories, 'victory', 'victories')} · ${count(career.kills, 'kill')} · best score ${fmt(career.bestScore)}${career.bestGrade ? ` · best grade ${career.bestGrade}` : ''}`;
    parts.push(careerLine);
    box.replaceChildren(...parts);
    box.setAttribute('aria-label', `Debrief: grade ${report.grade}, ${points.textContent}`);
  }

  // Called whenever the pause or end menu opens: titles, objectives, debrief and operation buttons.
  function menu(s, finished) {
    const def = s?.mission ? MISSIONS[s.mission.id] : null, campaignOp = def && CAMPAIGN.includes(def.id);
    const eyebrow = document.querySelector('#menu .eyebrow'), resume = $('resume');
    eyebrow.textContent = 'Command';
    resume.firstChild.textContent = 'Resume operation ';
    $('new-game').textContent = campaignOp ? 'Operations' : 'New skirmish';
    for (const id of ['next-operation', 'retry-operation', 'remix-operation']) $(id).hidden = true;
    const replay = (id, seed) => () => play(id, { difficulty: current?.chosen ?? $('campaign-difficulty').value, seed });
    menuObjective(s);
    $('objective').hidden = finished;
    if (def) {
      const index = CAMPAIGN.indexOf(def.id);
      eyebrow.textContent = campaignOp ? `Operation ${String(index + 1).padStart(2, '0')} · ${def.location}` : 'Skirmish';
      if (!finished) $('menu-title').textContent = def.name;
      if (!finished && s.time === 0) {
        $('menu-description').textContent = def.summary ?? def.briefing;
        resume.firstChild.textContent = 'Begin operation ';
      }
    }
    if (!finished) {
      // A running operation can be restarted on its own sector, so no position is ever a dead end.
      if (campaignOp && s.time > 0) { $('retry-operation').hidden = false; $('retry-operation').onclick = replay(def.id, s.seed); }
      return;
    }
    finish(s);
    debrief(s);
    if (!def) return;
    const victory = s.status === 'victory', last = [...s.events].reverse().find(e => e.kind === s.status);
    $('menu-title').textContent = def.score === 'survival' ? 'The light is out.' : victory ? 'Operation complete.' : 'Operation failed.';
    $('menu-description').textContent = last?.text ?? '';
    if (!campaignOp) return;
    const next = CAMPAIGN[CAMPAIGN.indexOf(def.id) + 1];
    $('next-operation').hidden = !(victory && next && isUnlocked(progress, next));
    $('retry-operation').hidden = false; $('remix-operation').hidden = false;
    $('next-operation').onclick = replay(next);
    $('retry-operation').onclick = replay(def.id, s.seed);
    $('remix-operation').onclick = () => replay(def.id, remixSeed())();
  }

  installArchive();
  renderModes(); renderList(); renderDetail(); renderCareer();
  setTab(progress.tab);
  return {
    takeLaunch, skirmishMission, selectMode, menu,
    hud: s => hud.update(s),
    event: e => hud.event(e),
    get progress() { return readProgress(progress); },
    get career() { return { ...career }; },
  };
}

// Remix seeds come from the browser's random source; the simulation itself stays seeded and deterministic.
function remixSeed() { return `REMIX-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`; }
