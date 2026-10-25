/* Shared controls, daily boards, feedback and a clock that counts play time. */
import { randomSeed } from './rng.js';
import { dailySeed } from './themes.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function createShell({ storageKey, sound, onNew, onReset, onHint, onUndo }) {
  const $ = (selector) => document.querySelector(selector);
  const radios = [...document.querySelectorAll('input[name="difficulty"]')];
  const timerOut = $('[data-timer]');
  const seedOut = $('[data-seed]');
  const toast = $('[data-toast]');
  const help = $('[data-dialog="help"]');
  const win = $('[data-dialog="win"]');
  const soundButton = $('[data-action="sound"]');
  const hintButton = $('[data-action="hint"]');
  const undoButton = $('[data-action="undo"]');
  const feedback = $('[data-feedback]');
  const defaultFeedback = feedback?.textContent || '';
  const dailyButton = $('[data-action="daily"]');
  const canvas = $('#stage');
  const read = (name) => { try { return localStorage.getItem(`${storageKey}-${name}`); } catch { return null; } };
  const store = (name, value) => { try { localStorage.setItem(`${storageKey}-${name}`, value); } catch { /* private mode */ } };

  let difficulty = 'medium', seed = null, startedAt = null, elapsed = 0;
  let ticking = false, hints = 0, toastTimer = 0;
  const format = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const now = () => elapsed + (startedAt === null ? 0 : performance.now() - startedAt);
  const pauseClock = () => {
    if (startedAt !== null) { elapsed += performance.now() - startedAt; startedAt = null; }
  };
  const resumeClock = () => {
    if (ticking && startedAt === null && !document.hidden && !help.open && !win.open) startedAt = performance.now();
  };
  setInterval(() => { if (startedAt !== null) timerOut.textContent = format(now()); }, 250);
  const fromHash = () => {
    const match = /^#(easy|medium|hard)-([a-z0-9]{3,16})$/i.exec(location.hash);
    return match ? { difficulty: match[1].toLowerCase(), seed: match[2].toLowerCase() } : null;
  };

  function load(nextDifficulty, nextSeed) {
    difficulty = DIFFICULTIES.includes(nextDifficulty) ? nextDifficulty : 'medium';
    seed = nextSeed;
    store('difficulty', difficulty);
    history.replaceState(null, '', `#${difficulty}-${seed}`);
    radios.forEach((radio) => { radio.checked = radio.value === difficulty; });
    seedOut.textContent = seed;
    startedAt = null; elapsed = 0; ticking = false; hints = 0;
    timerOut.textContent = '0:00';
    hintButton.disabled = false;
    hintButton.querySelector('[data-hints]')?.replaceChildren();
    if (undoButton) undoButton.disabled = true;
    if (win.open) win.close();
    toast.classList.remove('on');
    if (feedback) feedback.textContent = defaultFeedback;
    const sizes = storageKey === 'patcher' ? [5, 7, 9] : [5, 6, 7];
    const size = sizes[DIFFICULTIES.indexOf(difficulty)];
    if ($('[data-board-size]')) $('[data-board-size]').textContent = `${size} × ${size}`;
    dailyButton?.setAttribute('aria-pressed', String(seed === dailySeed()));
    onNew(difficulty, seed);
  }

  function showToast(text, ms = 2600) {
    toast.textContent = text;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  }
  const shell = {
    get difficulty() { return difficulty; }, get seed() { return seed; }, get hints() { return hints; },
    load,
    fresh: (nextDifficulty = difficulty) => load(nextDifficulty, randomSeed()),
    begin() { ticking = true; resumeClock(); },
    finish() {
      pauseClock(); ticking = false;
      timerOut.textContent = format(elapsed);
      hintButton.disabled = true;
      if (undoButton) undoButton.disabled = true;
      return elapsed;
    },
    restart() { startedAt = null; elapsed = 0; ticking = false; timerOut.textContent = '0:00'; hintButton.disabled = false; },
    setProgress(done, total, detail = '') {
      const progress = $('[data-progress]');
      if (progress) { progress.max = total; progress.value = done; progress.setAttribute('aria-valuetext', `${done} of ${total}. ${detail}`); }
      if ($('[data-progress-count]')) $('[data-progress-count]').textContent = `${done} / ${total}`;
      if ($('[data-progress-detail]')) $('[data-progress-detail]').textContent = detail;
    },
    setFeedback(text) { if (feedback) feedback.textContent = text; },
    clearFeedback() { if (feedback) feedback.textContent = defaultFeedback; },
    setUndoAvailable(available) { if (undoButton) undoButton.disabled = !available; },
    countHint() { hints++; const badge = hintButton.querySelector('[data-hints]'); if (badge) badge.textContent = String(hints); },
    toast: showToast,
    showWin({ ms, assisted }) {
      const bestKey = `best-${difficulty}`;
      const previous = Number(read(bestKey)) || 0;
      const record = !assisted && (!previous || ms < previous);
      if (record) store(bestKey, String(Math.round(ms)));
      win.querySelector('[data-win-time]').textContent = format(ms);
      const level = `${difficulty[0].toUpperCase()}${difficulty.slice(1)}`;
      const note = win.querySelector('[data-win-note]');
      if (assisted) note.textContent = `${level} · ${hints} hint${hints === 1 ? '' : 's'}. Best without hints: ${previous ? format(previous) : '—'}.`;
      else if (record) note.textContent = `${level} · a new best time${previous ? `, down from ${format(previous)}` : ''}!`;
      else note.textContent = `${level} · best ${format(previous)}.`;
      if (seed === dailySeed()) note.textContent = `Daily puzzle complete! ${note.textContent}`;
      win.querySelector('[data-action="harder"]').hidden = difficulty === 'hard';
      if (!win.open) win.showModal();
    },
  };

  const focusBoard = () => { if (!help.open && !win.open) canvas.focus({ preventScroll: true }); };
  radios.forEach((radio) => radio.addEventListener('change', () => { if (radio.checked && radio.value !== difficulty) shell.fresh(radio.value); }));
  $('[data-action="new"]').addEventListener('click', () => { shell.fresh(); focusBoard(); });
  dailyButton?.addEventListener('click', () => { load(difficulty, dailySeed()); focusBoard(); showToast('Today’s puzzle. A fresh challenge every day.'); });
  $('[data-action="reset"]').addEventListener('click', () => { onReset(); focusBoard(); });
  hintButton.addEventListener('click', () => { onHint(); focusBoard(); });
  undoButton?.addEventListener('click', () => { onUndo?.(); focusBoard(); });
  const openHelp = () => { pauseClock(); help.showModal(); };
  $('[data-action="help"]').addEventListener('click', openHelp);
  help.addEventListener('close', () => { resumeClock(); focusBoard(); });
  win.addEventListener('close', focusBoard);
  win.querySelector('[data-action="next"]').addEventListener('click', () => { shell.fresh(); focusBoard(); });
  win.querySelector('[data-action="harder"]').addEventListener('click', () => { shell.fresh(DIFFICULTIES[Math.min(2, DIFFICULTIES.indexOf(difficulty) + 1)]); focusBoard(); });
  win.querySelector('[data-action="stay"]').addEventListener('click', () => win.close());
  $('[data-action="share"]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); showToast('Puzzle link copied.'); }
    catch { showToast('Copy the address to share this puzzle.'); }
  });
  const reflectSound = () => {
    soundButton.setAttribute('aria-pressed', String(sound.enabled));
    soundButton.setAttribute('aria-label', sound.enabled ? 'Sound on' : 'Sound off');
    soundButton.classList.toggle('off', !sound.enabled);
  };
  soundButton.addEventListener('click', () => { sound.toggle(); reflectSound(); });
  reflectSound();
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || help.open || win.open || $('dialog[open]')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'n') shell.fresh();
    else if (key === 'r') onReset();
    else if (key === 'h') onHint();
    else if ((key === 'u' || key === 'z') && onUndo) onUndo();
    else if (key === 'm') { sound.toggle(); reflectSound(); }
    else if (event.key === '?') { openHelp(); event.preventDefault(); return; }
    else return;
    focusBoard(); event.preventDefault();
  });
  window.addEventListener('hashchange', () => {
    const wanted = fromHash();
    if (wanted && (wanted.seed !== seed || wanted.difficulty !== difficulty)) load(wanted.difficulty, wanted.seed);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseClock(); else resumeClock(); });
  if (!read('seen')) { store('seen', '1'); help.showModal(); }
  const wanted = fromHash();
  const stored = read('difficulty');
  load(wanted?.difficulty || (DIFFICULTIES.includes(stored) ? stored : 'medium'), wanted?.seed || randomSeed());
  return shell;
}
