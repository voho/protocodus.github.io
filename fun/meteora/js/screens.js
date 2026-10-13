/* Meteora — every screen outside the cockpit.

   The main menu, the difficulty choice, the prologue, the mission list,
   the briefing (with its tactical map), the hangar, pause, the debrief,
   the codex and settings. This module only builds and fills the DOM; what
   the buttons do is up to main.js, which hands in `handlers` keyed by each
   button's `data-action`.

   Settings persist in localStorage under `meteora.settings`. Every access
   is wrapped: private browsing or a full quota just means the defaults. */

import { KEY_GUIDE, PAD_GUIDE, capOf, capsFor } from './keys.js';
import { ACTIONS, DEFAULT_KEYS, keysOf } from './controls.js';
import { CLASSES, HULLS } from './catalog.js';
import { PRIMARIES, PLAYER_SECONDARIES, REACTORS, SECONDARIES, assess, bankCount, matchesRecommendation, normalizeLoadout, ratings } from './loadout.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from './difficulty.js';
import { MISSIONS, SPECIAL_OPS, TRAINING, COMMENDATIONS, RANKS, isAvailable, missionById, missionLabel, nextMission, rankOf } from './campaign.js';
import { PROLOGUE, CODEX, HINTS, CASE_FILE } from './story.js';

const KEY = 'meteora.settings';
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const DEFAULT_SETTINGS = Object.freeze({
  volume: 0.8, music: 0.6, invertPitch: false, vibration: !reducedMotion, sensitivity: 1.6, steering: 'direct',
  bloom: true, voices: 0.9, cutaways: true, fov: 70, quality: 'sharp',
});

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!(s.sensitivity >= 0.3 && s.sensitivity <= 4)) s.sensitivity = DEFAULT_SETTINGS.sensitivity;
    if (s.steering !== 'direct' && s.steering !== 'stick') s.steering = 'direct';
    if (!(s.fov >= 60 && s.fov <= 100)) s.fov = DEFAULT_SETTINGS.fov;
    if (!['sharp', 'balanced', 'fast'].includes(s.quality)) s.quality = 'sharp';
    // Only known actions, each bound to a key code.
    if (s.keys && typeof s.keys === 'object') {
      s.keys = Object.fromEntries(Object.entries(s.keys).filter(([a, code]) => a in DEFAULT_KEYS && typeof code === 'string' && code));
    } else delete s.keys;
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* defaults next time */ }
}

const el = (doc, tag, props = {}, ...children) => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'type') e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
};
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const SHOT_DOWN = 'Lantern One\'s beacon went silent before the job was done. A Tender found the wreck, the crews cut you out of it, and the Watch wrote the mission off. Commander Doukas wants you back in the cockpit before the Harrow come again.';
const medal = (kind, big = false) => kind ? `<i class="medal ${kind}${big ? ' big' : ''}" aria-label="${kind} medal"></i>` : '';

/* ---------- keys ---------- */

function renderKeys(container, keys) {
  const doc = container.ownerDocument;
  container.textContent = '';
  for (const group of [...KEY_GUIDE, PAD_GUIDE]) {
    const list = el(doc, 'ul');
    for (const item of group.items) {
      const caps = el(doc, 'span', { class: 'caps' }, capsFor(item, keys).map(cap => el(doc, 'kbd', { class: cap.length > 1 ? 'wide' : '', text: cap })));
      list.append(el(doc, 'li', {}, caps, el(doc, 'span', { text: item.label })));
    }
    container.append(el(doc, 'section', {}, el(doc, 'h3', { text: group.title }), list));
  }
}

/* ---------- the tactical map ---------- */

const ICON_COLOURS = {
  player: '#7fd8ff', nav: '#7fd8ff', friend: '#5dff8f', capital: '#5dff8f', station: '#f2d27a',
  enemy: '#ff4a3a', 'capital-enemy': '#ff4a3a', danger: '#ff7a5a', unknown: '#ffb347',
};
function drawMap(canvas, mission, focus, t) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const extent = mission.map.extent ?? 8000;
  const scale = Math.min(W, H) / extent * 1.15;
  const cx = W / 2 - focus[0] * scale, cy = H / 2 - focus[2] * scale;
  const X = p => cx + p[0] * scale, Y = p => cy + p[2] * scale;
  // Grid and belt grain.
  ctx.strokeStyle = 'rgba(127, 216, 255, 0.07)'; ctx.lineWidth = 1;
  const step = 1000 * scale;
  for (let x = ((cx % step) + step) % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = ((cy % step) + step) % step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  let seed = mission.number * 977 + 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(160, 170, 190, 0.18)';
  for (let k = 0; k < 900; k++) {
    const x = (rnd() - 0.5) * extent * 2, z = (rnd() - 0.5) * extent * 2;
    const clear = (mission.map.icons ?? []).some(i => (i.kind === 'capital' || i.kind === 'station' || i.kind === 'capital-enemy') && Math.hypot(i.pos[0] - x, i.pos[2] - z) < 700);
    if (clear) continue;
    ctx.fillRect(X([x, 0, z]), Y([x, 0, z]), 1.2, 1.2);
  }
  // Routes.
  for (const r of mission.map.routes ?? []) {
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 30;
    ctx.strokeStyle = r.kind === 'hostile' ? 'rgba(255, 74, 58, 0.7)' : r.kind === 'convoy' ? 'rgba(93, 255, 143, 0.65)' : 'rgba(127, 216, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.path.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Icons.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const i of mission.map.icons ?? []) {
    const x = X(i.pos), y = Y(i.pos), c = ICON_COLOURS[i.kind] ?? '#e9edf3';
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
    const pulse = 1 + 0.15 * Math.sin(t * 3 + x);
    switch (i.kind) {
      case 'player': ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 6, y + 6); ctx.lineTo(x - 6, y + 6); ctx.closePath(); ctx.fill(); break;
      case 'nav': ctx.beginPath(); ctx.moveTo(x, y - 8 * pulse); ctx.lineTo(x + 8 * pulse, y); ctx.lineTo(x, y + 8 * pulse); ctx.lineTo(x - 8 * pulse, y); ctx.closePath(); ctx.stroke(); break;
      case 'friend': ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); break;
      case 'capital': case 'capital-enemy': ctx.strokeRect(x - 16, y - 6, 32, 12); ctx.globalAlpha = 0.25; ctx.fillRect(x - 16, y - 6, 32, 12); ctx.globalAlpha = 1; break;
      case 'station': ctx.strokeRect(x - 9, y - 9, 18, 18); break;
      case 'enemy': ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x + 7, y - 6); ctx.lineTo(x - 7, y - 6); ctx.closePath(); ctx.fill(); break;
      case 'danger': ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 10 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); break;
      default: ctx.font = '700 16px "Space Grotesk", sans-serif'; ctx.fillText('?', x, y);
    }
    if (i.label && !(i.kind === 'unknown' && i.label === '?')) {
      ctx.font = '500 12px "Space Grotesk", sans-serif';
      ctx.fillStyle = 'rgba(233, 237, 243, 0.85)';
      ctx.fillText(i.label, x, y + 18);
    }
  }
  // Scale bar.
  ctx.fillStyle = 'rgba(160, 178, 205, 0.7)'; ctx.font = '500 11px "Space Grotesk", sans-serif'; ctx.textAlign = 'left';
  ctx.fillRect(14, H - 18, 1000 * scale, 2); ctx.fillText('1 km', 14, H - 28);
}

/* ---------- the module ---------- */

export function createScreens(root, settings, handlers) {
  const doc = root;
  const refreshKeys = () => { for (const container of root.querySelectorAll('[data-keys]')) renderKeys(container, keysOf(settings)); };
  refreshKeys();
  const screens = Object.fromEntries([...root.querySelectorAll('[data-screen]')].map(e => [e.dataset.screen, e]));
  const $ = sel => root.querySelector(sel);
  const fill = $('[data-loading-fill]'), bar = $('[data-loading-bar]'), label = $('[data-loading-label]');
  let current = 'start';
  const back = [];
  let mapState = null, prologueStep = 0, stage = 0, codexTab = 'story';

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    handlers.click?.();
    const action = b.dataset.action;
    if (action === 'back') { api.back(); return; }
    handlers[action]?.(b);
  });
  root.addEventListener('pointerover', e => { if (e.target.closest?.('button:not(:disabled)')) handlers.hover?.(); });

  /* ---------- settings ---------- */
  const settingsForms = [...root.querySelectorAll('[data-settings-form]')];
  const renderSettings = () => {
    for (const form of settingsForms) {
      form.textContent = '';
      const range = (key, text, min, max, step, show = v => `${Math.round(v * 100)}%`) => {
        const out = el(doc, 'output', { text: show(settings[key]) });
        const input = el(doc, 'input', { type: 'range' });
        Object.assign(input, { min, max, step, value: settings[key] });
        input.addEventListener('input', () => {
          settings[key] = Number(input.value); out.textContent = show(settings[key]);
          saveSettings(settings); handlers.settingsChanged?.(settings);
        });
        return el(doc, 'label', {}, el(doc, 'span', { class: 'row' }, el(doc, 'span', { text }), out), input);
      };
      form.append(
        range('volume', 'Sound volume', 0, 1, 0.05),
        range('music', 'Music volume', 0, 1, 0.05),
        range('voices', 'Radio voices', 0, 1, 0.05, v => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')),
        range('sensitivity', 'Mouse sensitivity', 0.5, 3, 0.1, v => `${v.toFixed(1)}×`),
        range('fov', 'Field of view', 60, 100, 1, v => `${Math.round(v)}°`),
      );
      const steer = el(doc, 'select');
      for (const [value, text] of [['direct', 'Direct — the ship follows the mouse'], ['stick', 'Stick — the cursor stays where you leave it']]) {
        steer.append(el(doc, 'option', { value, text, selected: settings.steering === value }));
      }
      steer.addEventListener('change', () => { settings.steering = steer.value; saveSettings(settings); handlers.settingsChanged?.(settings); });
      form.append(el(doc, 'label', {}, el(doc, 'span', { text: 'Mouse steering' }), steer));
      const quality = el(doc, 'select');
      for (const [value, text] of [['sharp', 'Sharpest — up to 1.5× pixels, lowered when frames run late'], ['balanced', 'Balanced — up to the screen\'s own pixels'], ['fast', 'Fast — three quarters of them']]) {
        quality.append(el(doc, 'option', { value, text, selected: (settings.quality ?? 'sharp') === value }));
      }
      quality.addEventListener('change', () => { settings.quality = quality.value; saveSettings(settings); handlers.settingsChanged?.(settings); });
      form.append(el(doc, 'label', {}, el(doc, 'span', { text: 'Render quality' }), quality));
      const inv = el(doc, 'input', { type: 'checkbox', checked: !!settings.invertPitch });
      inv.addEventListener('change', () => { settings.invertPitch = inv.checked; saveSettings(settings); handlers.settingsChanged?.(settings); });
      form.append(el(doc, 'label', { class: 'check' }, inv, el(doc, 'span', { text: 'Invert mouse up / down' })));
      const glowBox = el(doc, 'input', { type: 'checkbox', checked: settings.bloom !== false });
      glowBox.addEventListener('change', () => { settings.bloom = glowBox.checked; saveSettings(settings); handlers.settingsChanged?.(settings); });
      form.append(el(doc, 'label', { class: 'check' }, glowBox, el(doc, 'span', { text: 'Bloom — light bleeds around flames, bolts and fire' })));
      // Keys: click one, then press the key it should be. A key already in
      // use swaps over; Esc leaves it as it was. Only changes are saved.
      const win = doc.defaultView ?? globalThis;
      const bound = keysOf(settings);
      const keyRows = el(doc, 'div', { class: 'keymap' });
      const listen = (action, button) => {
        button.textContent = 'Press a key…';
        button.classList.add('listening');
        const onKey = e => {
          e.preventDefault(); e.stopImmediatePropagation();
          win.removeEventListener('keydown', onKey, true);
          if (e.code && e.code !== 'Escape') {
            const now = keysOf(settings);
            const next = { ...(settings.keys ?? {}) };
            const other = Object.keys(now).find(a => a !== action && now[a] === e.code);
            if (other) next[other] = now[action];
            next[action] = e.code;
            for (const a of Object.keys(next)) if (next[a] === DEFAULT_KEYS[a]) delete next[a];
            settings.keys = next;
            saveSettings(settings);
            handlers.settingsChanged?.(settings);
            refreshKeys();
          }
          renderSettings();
        };
        win.addEventListener('keydown', onKey, true);
      };
      for (const [action, text] of ACTIONS) {
        const button = el(doc, 'button', { type: 'button', class: 'keycap', text: capOf(bound[action]), 'aria-label': `${text}: ${capOf(bound[action])}` });
        button.addEventListener('click', () => listen(action, button));
        keyRows.append(el(doc, 'div', { class: 'keyrow' }, el(doc, 'span', { text }), button));
      }
      const resetKeys = el(doc, 'button', { type: 'button', class: 'ghost small', text: 'Default keys' });
      resetKeys.addEventListener('click', () => { delete settings.keys; saveSettings(settings); handlers.settingsChanged?.(settings); refreshKeys(); renderSettings(); });
      form.append(el(doc, 'fieldset', { class: 'keys-set' }, el(doc, 'legend', { text: 'Keys — click one, then press a key' }), keyRows, resetKeys));
      const cutBox = el(doc, 'input', { type: 'checkbox', checked: settings.cutaways !== false });
      cutBox.addEventListener('change', () => { settings.cutaways = cutBox.checked; saveSettings(settings); handlers.settingsChanged?.(settings); });
      form.append(el(doc, 'label', { class: 'check' }, cutBox, el(doc, 'span', { text: 'Cutaways — the camera cuts to the big moments' })));
    }
  };
  renderSettings();

  const api = {
    get current() { return current; },
    show(name, { remember = true } = {}) {
      if (remember && current && current !== name && name) back.push(current);
      if (back.length > 12) back.shift();
      current = name;
      for (const [key, e] of Object.entries(screens)) e.classList.toggle('on', key === name);
      const target = name && (screens[name]?.querySelector('.launch:not(:disabled), .menu-item:not([hidden]), .card, .mission:not(:disabled)'));
      if (target) target.focus({ preventScroll: true });
      if (name !== 'briefing') mapState = null;
    },
    back() {
      const prev = back.pop();
      if (prev && prev !== 'loading' && prev !== 'debrief') { api.show(prev, { remember: false }); handlers.screenBack?.(prev); }
      else { api.show('start', { remember: false }); handlers.screenBack?.('start'); }
    },
    resetHistory() { back.length = 0; },
    progress(fraction, text) {
      const pct = Math.round(fraction * 100);
      fill.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      if (text) label.textContent = text;
    },
    ready() {
      $('[data-loading]').classList.add('done');
      $('[data-main-menu]').hidden = false;
    },
    error(message) {
      const box = $('[data-error]');
      box.hidden = false;
      box.querySelector('[data-error-text]').textContent = message;
    },
    /* ---------- the main menu ---------- */
    menu(progress) {
      const next = nextMission(progress);
      const started = progress.won.length > 0 || progress.seenPrologue;
      const cont = $('[data-continue]');
      cont.hidden = !started;
      $('[data-continue-label]').textContent = progress.won.length >= MISSIONS.length ? '· all missions flown' : `· ${next.number}. ${next.title}`;
      const r = rankOf(progress.total);
      const rank = $('[data-rank]');
      rank.hidden = !started;
      rank.innerHTML = `<strong>${r.name.toUpperCase()}</strong><span>${progress.total.toLocaleString('en')} points${r.next ? ` · ${r.next} at ${RANKS[r.index + 1].score.toLocaleString('en')}` : ''}</span><div class="meter"><i style="width:${Math.round(r.progress * 100)}%"></i></div>`;
    },
    difficulties(selected, onPick, progress = null) {
      // Starting over is not undoable: say so when there is something to lose.
      const warn = $('[data-reset-warning]');
      const won = progress?.won?.length ?? 0;
      warn.hidden = !won;
      if (won) warn.textContent = `Starting a new campaign resets your ${won} won mission${won > 1 ? 's' : ''}, medals, scores and rank. Commendations and Survival bests are kept.`;
      const box = $('[data-difficulties]');
      box.textContent = '';
      for (const key of DIFFICULTY_ORDER) {
        const d = DIFFICULTIES[key];
        const card = el(doc, 'button', { type: 'button', class: `card${key === selected ? ' selected' : ''}` },
          el(doc, 'strong', { text: d.name }), el(doc, 'span', { text: d.blurb }),
          el(doc, 'span', { text: `${d.repairDrones} Tender${d.repairDrones > 1 ? 's' : ''} per mission` }));
        card.addEventListener('click', () => {
          // Progress to lose: the first click arms the card, the second starts over.
          if (won && !card.classList.contains('armed')) {
            for (const c of box.querySelectorAll('.card.armed')) { c.classList.remove('armed'); c.querySelector('.confirm')?.remove(); }
            card.classList.add('armed');
            card.append(el(doc, 'span', { class: 'confirm', text: 'Click again to start over' }));
            return;
          }
          onPick(key);
        });
        box.append(card);
      }
    },
    prologue(step) {
      prologueStep = Math.max(0, Math.min(PROLOGUE.length - 1, step));
      const page = PROLOGUE[prologueStep];
      $('[data-prologue-step]').textContent = `${prologueStep + 1} / ${PROLOGUE.length}`;
      $('[data-prologue-title]').textContent = page.title;
      const t = $('[data-prologue-text]');
      t.textContent = page.text;
      t.classList.remove('fresh'); void t.offsetWidth; t.classList.add('fresh');
      return prologueStep;
    },
    missions(progress, onPick) {
      const box = $('[data-mission-list]');
      box.textContent = '';
      const next = nextMission(progress);
      const drill = el(doc, 'button', { type: 'button', class: 'mission training' });
      drill.innerHTML = `<span class="num">TRAINING</span><strong>${TRAINING.title}</strong><span>${TRAINING.location}</span>`;
      drill.addEventListener('click', () => onPick(TRAINING));
      box.append(drill);
      for (const m of MISSIONS) {
        const best = progress.best[m.id];
        const open = isAvailable(progress, m);
        const b = el(doc, 'button', { type: 'button', class: `mission${m === next && !best ? ' next' : ''}`, disabled: !open });
        b.innerHTML = `<span class="num">MISSION ${m.number}</span><strong>${open ? m.title : 'Classified'}</strong><span>${open ? m.location : '—'}</span>${best ? `<span class="score">Best ${best.score.toLocaleString('en')} · ${fmtTime(best.time)} · ${DIFFICULTIES[best.difficulty]?.name ?? ''}</span>${medal(best.medal)}` : ''}`;
        if (open) b.addEventListener('click', () => onPick(m));
        box.append(b);
        // A special operation, where it falls in the story.
        for (const op of SPECIAL_OPS.filter(o => o.after === m.id)) {
          const opBest = progress.best[op.id], opOpen = isAvailable(progress, op);
          const s = el(doc, 'button', { type: 'button', class: 'mission special', disabled: !opOpen });
          s.innerHTML = `<span class="num">SPECIAL OPERATION</span><strong>${opOpen ? op.title : 'Classified'}</strong><span>${opOpen ? op.location : `Opens after Mission ${m.number}`}</span>${opBest ? `<span class="score">Best ${opBest.score.toLocaleString('en')} · ${fmtTime(opBest.time)} · ${DIFFICULTIES[opBest.difficulty]?.name ?? ''}</span>${medal(opBest.medal)}` : ''}`;
          if (opOpen) s.addEventListener('click', () => onPick(op));
          box.append(s);
        }
      }
    },
    /* ---------- the briefing ---------- */
    /* `recap`: the narrator's "previously" ahead of the Commander's stages. */
    briefing(mission, progress, difficultyKey, onDifficulty, recap = null) {
      $('[data-brief-eyebrow]').textContent = `${missionLabel(mission)} · ${mission.location}`;
      $('[data-brief-title]').textContent = mission.title;
      $('[data-brief-dateline]').textContent = mission.dateline ?? '';
      const obj = $('[data-brief-objectives]');
      obj.textContent = '';
      for (const o of mission.objectivesPreview) obj.append(el(doc, 'li', { class: o.bonus ? 'bonus' : '', text: o.text }));
      const r = mission.recommend;
      const secs = (r.secondaries ?? []).map(k => SECONDARIES[k]?.short).join(' + ');
      $('[data-brief-recommend]').innerHTML = `<b>${CLASSES[r.hull].name}</b> · ${PRIMARIES[r.primary].short} · ${secs} · ${REACTORS[r.reactor].name} reactor. ${r.why}`;
      const sel = $('[data-brief-difficulty]');
      sel.textContent = '';
      for (const key of DIFFICULTY_ORDER) sel.append(el(doc, 'option', { value: key, text: DIFFICULTIES[key].name, selected: key === difficultyKey }));
      sel.onchange = () => onDifficulty(sel.value);
      const best = progress.best[mission.id];
      $('[data-brief-best]').innerHTML = best ? `${medal(best.medal)} Best ${best.score.toLocaleString('en')} on ${DIFFICULTIES[best.difficulty]?.name ?? ''}` : '';
      stage = 0;
      const stages = mission.briefing.stages;
      mapState = {
        mission, focus: [...stages[0].focus], t: 0,
        stages: recap ? [{ who: 'narrator', text: recap, focus: stages[0].focus }, ...stages] : stages,
      };
      api.briefingStage(0);
    },
    // The stage on screen: who speaks it and what they say.
    briefingLine(i) { return mapState?.stages[i] ?? null; },
    briefingStage(delta) {
      if (!mapState) return;
      const stages = mapState.stages;
      stage = Math.max(0, Math.min(stages.length - 1, stage + delta));
      const s = stages[stage];
      $('[data-brief-who]').textContent = s.who === 'narrator' ? 'Previously' : 'Cmdr. Doukas · Perpetua';
      const t = $('[data-brief-stage]');
      t.textContent = s.text;
      t.classList.remove('fresh'); void t.offsetWidth; t.classList.add('fresh', 'story-text');
      $('[data-brief-step]').textContent = `${stage + 1} / ${stages.length}`;
      mapState.target = s.focus;
      return stage;
    },
    animate(dt) {
      if (current !== 'briefing' || !mapState) return;
      mapState.t += dt;
      const target = mapState.target ?? mapState.focus;
      for (let k = 0; k < 3; k++) mapState.focus[k] += (target[k] - mapState.focus[k]) * Math.min(1, dt * 3);
      drawMap($('[data-brief-map]'), mapState.mission, mapState.focus, mapState.t);
    },
    /* ---------- the hangar ---------- */
    hangar({ loadout, unlocked, mission, onChange, eyebrow, difficulty = null }) {
      const L = normalizeLoadout(loadout, unlocked);
      const rec = mission?.recommend ?? null;
      const match = matchesRecommendation(rec, L);
      $('[data-hangar-eyebrow]').textContent = eyebrow ?? (mission ? `Hangar · ${missionLabel(mission)}: ${mission.title}` : 'Hangar');
      const choice = (title, sub, selected, enabled, recommended, onClick, why = 'Not yet in service') => {
        const b = el(doc, 'button', { type: 'button', class: `choice${selected ? ' selected' : ''}`, disabled: !enabled, 'aria-pressed': String(selected) },
          el(doc, 'strong', { text: title }), el(doc, 'small', { text: enabled ? sub : why }));
        if (recommended) b.append(el(doc, 'span', { class: 'rec', text: 'REC' }));
        b.addEventListener('click', onClick);
        return b;
      };
      const hulls = $('[data-hangar-hulls]');
      hulls.textContent = '';
      for (const h of HULLS) {
        const c = CLASSES[h];
        hulls.append(choice(c.name, c.type, L.hull === h, unlocked.hulls.includes(h), rec?.hull === h, () => onChange({ ...L, hull: h })));
      }
      const prim = $('[data-hangar-primaries]');
      prim.textContent = '';
      for (const [k, p] of Object.entries(PRIMARIES)) {
        prim.append(choice(p.short, `${p.damage} × ${p.rate}/s`, L.primary === k, unlocked.primaries.includes(k), rec?.primary === k, () => onChange({ ...L, primary: k })));
      }
      const banks = $('[data-hangar-banks]');
      banks.textContent = '';
      CLASSES[L.hull].banks.forEach((bank, i) => {
        banks.append(el(doc, 'h3', { class: 'section', text: `Bank ${i + 1}${bank.heavy ? ' · heavy' : ''} · ${bank.capacity} units` }));
        const row = el(doc, 'div', { class: 'choices' });
        for (const k of PLAYER_SECONDARIES) {
          const n = bankCount(bank, k);
          const s = SECONDARIES[k];
          const inService = unlocked.secondaries.includes(k);
          row.append(choice(s.short, `× ${n}`, L.secondaries[i] === k, inService && n > 0, rec?.secondaries?.[i] === k, () => {
            const secondaries = [...L.secondaries]; secondaries[i] = k; onChange({ ...L, secondaries });
          }, inService ? 'Heavy bank only' : 'Not yet in service'));
        }
        banks.append(row);
      });
      const reac = $('[data-hangar-reactors]');
      reac.textContent = '';
      for (const [k, r] of Object.entries(REACTORS)) {
        reac.append(choice(r.name, r.type, L.reactor === k, unlocked.reactors.includes(k), rec?.reactor === k, () => onChange({ ...L, reactor: k })));
      }
      const c = CLASSES[L.hull];
      $('[data-hangar-name]').textContent = `${c.name} · ${c.type}`;
      $('[data-hangar-blurb]').textContent = `${c.blurb} ${PRIMARIES[L.primary].blurb} ${REACTORS[L.reactor].blurb}`;
      const R = ratings(L);
      const stats = $('[data-hangar-stats]');
      stats.textContent = '';
      for (const [k, name] of [['speed', 'Speed'], ['agility', 'Agility'], ['shields', 'Shields'], ['hull', 'Hull'], ['guns', 'Guns'], ['armourBite', 'Armour bite'], ['ordnance', 'Ordnance'], ['stealth', 'Stealth']]) {
        stats.append(el(doc, 'div', { class: 'stat' }, el(doc, 'span', { text: name }), el(doc, 'div', { class: 'meter', html: `<i style="width:${Math.round(Math.max(0.04, Math.min(1, R[k])) * 100)}%"></i>` })));
      }
      const advice = $('[data-hangar-advice]');
      advice.textContent = '';
      const notes = mission ? assess(mission.needs, L, DIFFICULTIES[difficulty] ?? null) : [];
      const all = match.hull && match.primary && match.reactor && match.secondaries.every(Boolean);
      if (mission && all) advice.append(el(doc, 'p', { class: 'ok', text: 'This is the recommended loadout.' }));
      for (const n of notes) advice.append(el(doc, 'p', { class: n.level === 'tip' ? 'tip' : '', text: n.text }));
      if (mission && !all && !notes.length) advice.append(el(doc, 'p', { class: 'tip', text: `Recommended: ${rec.why}` }));
      return L;
    },
    /* ---------- pause ---------- */
    pause(world) {
      const rt = world.mission;
      $('[data-pause-eyebrow]').textContent = rt?.def.number ? `Mission ${rt.def.number} · ${rt.def.title}` : 'Survival';
      const list = $('[data-pause-objectives]');
      list.textContent = '';
      for (const o of rt?.objectives ?? []) {
        if (o.state === 'hidden') continue;
        list.append(el(doc, 'li', { class: [o.kind === 'bonus' ? 'bonus' : '', o.state].join(' '), text: o.text + (o.count && o.state === 'active' ? ` (${o.count.n}/${o.count.of})` : '') }));
      }
    },
    /* ---------- the debrief ---------- */
    debrief(res, mission, change, progress, { hasNext, survival = null, beyond = false }) {
      const box = screens.debrief.querySelector('.debrief');
      // After the last jump the belt is four light-years behind: no belt
      // behind the debrief either.
      screens.debrief.classList.toggle('beyond', beyond);
      box.classList.toggle('won', res.won || !!survival); box.classList.toggle('lost', !res.won && !survival);
      $('[data-debrief-eyebrow]').textContent = mission ? `${missionLabel(mission)} · ${mission.location}` : 'Survival';
      $('[data-debrief-title]').textContent = survival ? `Shot down in wave ${survival.wave}` : res.won ? 'Mission complete' : 'Mission failed';
      $('[data-debrief-medal]').innerHTML = survival
        ? `<div><strong>${survival.score.toLocaleString('en')} points</strong><br><span>${survival.newBest ? 'A new best for the ' : 'Best for the '}${survival.hull}: ${survival.best.toLocaleString('en')}</span></div>`
        : res.won ? `${medal(res.medal, true)}<div><strong>${res.medal.toUpperCase()}</strong><br><span>${res.bonusDone} of ${res.bonusTotal} bonus objectives</span></div>` : `<div><strong>${res.reason ?? 'The mission failed.'}</strong></div>`;
      // Shot down is its own story: the mission's 'lost' text tells what the
      // Harrow did when the objectives failed, not what happened to you.
      const story = !mission ? 'The waves never stop. How long can you last?'
        : res.won ? mission.debrief.won
          : res.died ? (mission.debrief.died ?? SHOT_DOWN) : mission.debrief.lost;
      $('[data-debrief-text]').textContent = story;
      // What this mission added to the case file — and a clue left behind.
      const ev = $('[data-debrief-evidence]');
      ev.textContent = '';
      for (const c of change?.evidence ?? []) {
        ev.append(el(doc, 'div', { class: 'clue' }, el(doc, 'b', { text: `New evidence · ${c.title}` }), el(doc, 'p', { text: c.text })));
      }
      for (const c of change?.missed ?? []) {
        ev.append(el(doc, 'div', { class: 'clue missed' }, el(doc, 'b', { text: 'A clue was left behind' }),
          el(doc, 'p', { text: c.objective ? `Fly it again and complete “${c.objective}” to find it.` : 'Fly it again to find it.' })));
      }
      ev.hidden = !ev.childElementCount;
      screens.debrief.querySelector('.debrief-grid > div').hidden = !!survival;
      const obj = $('[data-debrief-objectives]');
      obj.textContent = '';
      for (const o of res.objectives) obj.append(el(doc, 'li', { class: [o.kind === 'bonus' ? 'bonus' : '', o.state].join(' '), text: o.text }));
      const kills = Object.entries(res.stats.kills).map(([k, n]) => `${n} ${CLASSES[k]?.name ?? k}`).join(', ') || 'none';
      const rec = $('[data-debrief-record]');
      rec.innerHTML = '';
      const row = (k, v, cls = '') => rec.append(el(doc, 'dt', { text: k }), el(doc, 'dd', { class: cls, text: v }));
      row('Time', fmtTime(res.time));
      row('Kills', kills);
      row('Accuracy', res.stats.shots ? `${Math.round(res.stats.accuracy * 100)}% of ${res.stats.shots} shots` : '—');
      row('Best streak', String(res.stats.bestStreak));
      row('Torpedoes shot down', String(res.stats.torpedoesDowned));
      row('Hull damage taken', String(Math.round(res.stats.hullTaken)));
      row('Combat', res.combatScore.toLocaleString('en'));
      if (res.won) { row('Objectives', res.objectiveScore.toLocaleString('en')); row('Time bonus', res.timeBonus.toLocaleString('en')); }
      row('Score', res.score.toLocaleString('en'), 'total');
      const awards = $('[data-debrief-awards]');
      awards.textContent = '';
      if (change?.newBest && res.won) awards.append(el(doc, 'div', { class: 'award', html: '<b>New best score</b><span>for this mission</span>' }));
      for (const u of change?.unlocks ?? []) {
        const name = u.kind === 'Hull' ? CLASSES[u.key].name : u.kind === 'Gun' ? PRIMARIES[u.key].name : u.kind === 'Ordnance' ? SECONDARIES[u.key].name : `${REACTORS[u.key].name} reactor`;
        awards.append(el(doc, 'div', { class: 'award', html: `<b>New in service: ${name}</b><span>${u.kind}</span>` }));
      }
      for (const c of change?.commendations ?? []) awards.append(el(doc, 'div', { class: 'award', html: `<b>Commendation: ${c.name}</b><span>${c.text}</span>` }));
      if (change?.rankUp) awards.append(el(doc, 'div', { class: 'award', html: `<b>Promoted: ${change.rankUp}</b><span>by order of Commander Doukas</span>` }));
      const r = rankOf(progress.total);
      $('[data-debrief-rank]').innerHTML = `<strong>${r.name}</strong><span>${progress.total.toLocaleString('en')} points in the service record${r.next ? ` · ${r.next} at ${RANKS[r.index + 1].score.toLocaleString('en')}` : ''}</span><div class="meter"><i style="width:${Math.round(r.progress * 100)}%"></i></div>`;
      // After a loss the main button already retries; a second "Replay" would
      // do the same thing.
      const replay = $('[data-screen="debrief"] [data-action="replay"]');
      if (replay) replay.hidden = !res.won && !survival;
      const next = $('[data-debrief-next]');
      next.innerHTML = survival ? 'Fly again <span aria-hidden="true">↻</span>'
        : res.won && mission?.training ? (progress.won.includes(MISSIONS[0].id) ? 'Back to the menu <span aria-hidden="true">→</span>' : 'Mission 1 <span aria-hidden="true">→</span>')
        : res.won && mission?.special ? (progress.won.length < MISSIONS.length ? 'Back to the campaign <span aria-hidden="true">→</span>' : 'Back to the menu <span aria-hidden="true">→</span>')
        : res.won ? (hasNext ? 'Next mission <span aria-hidden="true">→</span>' : 'Service record <span aria-hidden="true">→</span>') : 'Retry <span aria-hidden="true">↻</span>';
      return story;
    },
    /* ---------- the codex ---------- */
    codex(progress, tab = codexTab) {
      codexTab = tab;
      const tabs = $('[data-codex-tabs]');
      tabs.textContent = '';
      for (const [key, name] of [['story', 'Story'], ['case', 'Case file'], ['craft', 'Craft'], ['weapons', 'Weapons'], ['record', 'Service record'], ['controls', 'Controls']]) {
        const b = el(doc, 'button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(key === tab), text: name });
        b.addEventListener('click', () => api.codex(progress, key));
        tabs.append(b);
      }
      const body = $('[data-codex-body]');
      body.textContent = '';
      if (tab === 'story') {
        for (const p of [...PROLOGUE, ...CODEX]) body.append(el(doc, 'article', {}, el(doc, 'h4', { text: p.title }), el(doc, 'p', { text: p.text })));
        body.append(el(doc, 'article', {}, el(doc, 'h4', { text: 'Flight school' }), el(doc, 'p', { text: HINTS.join(' ') })));
      } else if (tab === 'case') {
        // The Harrow, as the Watch has come to know them: found evidence in
        // full, the rest as the mission that holds it.
        const found = new Set(progress.caseFile ?? []);
        const file = el(doc, 'div', { class: 'evidence case-file' });
        file.append(el(doc, 'p', { class: 'muted', text: `${found.size} of ${CASE_FILE.length} pieces of evidence. Some are only found by those who look for them.` }));
        for (const c of CASE_FILE) {
          const m = missionById(c.mission);
          const known = found.has(c.id), open = isAvailable(progress, m);
          const flown = progress.won.includes(c.mission) || (progress.done ?? []).includes(c.mission);
          file.append(el(doc, 'div', { class: `clue${known ? '' : ' locked'}${known && progress.lastPlayed === c.mission ? ' new' : ''}` },
            el(doc, 'b', { text: known ? c.title : `${missionLabel(m)} · ${open ? m.title : 'Classified'}` }),
            el(doc, 'p', { text: known ? c.text : c.requires && flown ? 'A clue was left behind here.' : m.special && !flown ? 'Found only on a special operation.' : 'Not yet known.' })));
        }
        body.append(file);
      } else if (tab === 'craft') {
        const t = el(doc, 'table');
        t.innerHTML = '<tr><th>Craft</th><th>Role</th><th>Speed</th><th>Shield</th><th>Hull</th><th>Armour</th></tr>';
        for (const [k, c] of Object.entries(CLASSES)) {
          if (['wreck', 'recorder', 'boulder', 'hauler', 'target'].includes(k)) continue;
          t.insertAdjacentHTML('beforeend', `<tr><td>${c.name}</td><td>${c.type}</td><td>${c.flight.fa.forwardSpeed ? `${c.flight.fa.forwardSpeed} m/s` : '—'}</td><td>${c.shield}</td><td>${c.hull}</td><td>${Math.round((c.armor ?? 0) * 100)}%</td></tr>`);
        }
        body.append(t);
      } else if (tab === 'weapons') {
        for (const p of Object.values(PRIMARIES)) body.append(el(doc, 'article', {}, el(doc, 'h4', { text: p.name }), el(doc, 'p', { text: `${p.blurb} ${p.damage} damage, ${p.rate} shots a second, ${p.speed} m/s.` })));
        for (const k of PLAYER_SECONDARIES) { const s = SECONDARIES[k]; body.append(el(doc, 'article', {}, el(doc, 'h4', { text: s.name }), el(doc, 'p', { text: `${s.blurb} ${s.damage}${s.salvo ? ` × ${s.salvo}` : ''} damage; lock ${s.lockTime} s.` }))); }
        for (const r of Object.values(REACTORS)) body.append(el(doc, 'article', {}, el(doc, 'h4', { text: `${r.name} reactor · ${r.type}` }), el(doc, 'p', { text: r.blurb })));
      } else if (tab === 'record') {
        const r = rankOf(progress.total);
        body.append(el(doc, 'article', {}, el(doc, 'h4', { text: `${r.name} · ${progress.total.toLocaleString('en')} points` }), el(doc, 'p', { text: `${progress.won.length} of ${MISSIONS.length} missions won.` })));
        const t = el(doc, 'table');
        t.innerHTML = '<tr><th>Mission</th><th>Medal</th><th>Best</th><th>Time</th></tr>';
        for (const m of [...MISSIONS, ...SPECIAL_OPS]) {
          const b = progress.best[m.id];
          t.insertAdjacentHTML('beforeend', `<tr><td>${m.special ? 'Special op' : `${m.number}.`} ${isAvailable(progress, m) ? m.title : 'Classified'}</td><td>${b ? medal(b.medal) : '—'}</td><td>${b ? b.score.toLocaleString('en') : '—'}</td><td>${b ? fmtTime(b.time) : '—'}</td></tr>`);
        }
        body.append(t);
        body.append(el(doc, 'h3', { class: 'section', text: 'Commendations' }));
        for (const c of COMMENDATIONS) {
          const got = !!progress.commendations[c.id];
          body.append(el(doc, 'div', { class: `commendation${got ? '' : ' locked'}` }, el(doc, 'b', { text: c.name }), el(doc, 'span', { text: c.text })));
        }
        if (Object.keys(progress.survival ?? {}).length) {
          body.append(el(doc, 'h3', { class: 'section', text: 'Survival' }));
          for (const [h, s] of Object.entries(progress.survival)) body.append(el(doc, 'p', { text: `${CLASSES[h]?.name ?? h}: best ${Number(s).toLocaleString('en')}` }));
        }
      } else {
        const k = el(doc, 'div', { class: 'keys' });
        renderKeys(k, keysOf(settings));
        body.append(k);
      }
    },
    fold(title, eyebrow, fraction, text, tip) {
      $('[data-fold-eyebrow]').textContent = eyebrow;
      $('[data-fold-title]').textContent = title;
      $('[data-fold-fill]').style.width = `${Math.round(fraction * 100)}%`;
      $('[data-fold-label]').textContent = text ?? '';
      if (tip != null) $('[data-fold-tip]').textContent = tip;
    },
    renderSettings,
  };
  return api;
}

export { drawMap };
