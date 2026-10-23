/* The chrome round a puzzle: difficulty, the seed in the address, timer,
   hints, sound, help and the solved card. Both games use the same markup
   (see their index.html) and hand the shell what to do on a new board. */
import { randomSeed } from './rng.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function createShell({ storageKey, sound, onNew, onReset, onHint, onUndo }) {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const radios = $$('input[name="difficulty"]');
  const timerOut = $('[data-timer]');
  const seedOut = $('[data-seed]');
  const toast = $('[data-toast]');
  const help = $('[data-dialog="help"]');
  const win = $('[data-dialog="win"]');
  const soundButton = $('[data-action="sound"]');
  const hintButton = $('[data-action="hint"]');

  const read = (name) => { try { return localStorage.getItem(`${storageKey}-${name}`); } catch { return null; } };
  const store = (name, value) => { try { localStorage.setItem(`${storageKey}-${name}`, value); } catch { /* private mode */ } };

  let difficulty = 'medium';
  let seed = null;
  let startedAt = null;
  let elapsed = 0;
  let hints = 0;
  let toastTimer = 0;

  const format = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const now = () => elapsed + (startedAt === null ? 0 : performance.now() - startedAt);
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
    startedAt = null;
    elapsed = 0;
    hints = 0;
    timerOut.textContent = '0:00';
    hintButton.querySelector('[data-hints]')?.replaceChildren();
    if (win.open) win.close();
    onNew(difficulty, seed);
  }

  function showToast(text, ms = 2200) {
    toast.textContent = text;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  }

  const shell = {
    get difficulty() { return difficulty; },
    get seed() { return seed; },
    get hints() { return hints; },
    load,
    fresh: (nextDifficulty = difficulty) => load(nextDifficulty, randomSeed()),
    /* The clock starts on the first move, not on the first look. */
    begin() { if (startedAt === null) startedAt = performance.now(); },
    /* Stops the clock and returns the time taken. */
    finish() {
      if (startedAt !== null) { elapsed += performance.now() - startedAt; startedAt = null; }
      timerOut.textContent = format(elapsed);
      return elapsed;
    },
    restart() { startedAt = null; elapsed = 0; timerOut.textContent = '0:00'; },
    countHint() {
      hints++;
      const badge = hintButton.querySelector('[data-hints]');
      if (badge) badge.textContent = String(hints);
    },
    toast: showToast,
    /* The solved card: the time, the best time of the difficulty, and what next. */
    showWin({ ms, assisted }) {
      const bestKey = `best-${difficulty}`;
      const previous = Number(read(bestKey)) || 0;
      const record = !assisted && (!previous || ms < previous);
      if (record) store(bestKey, String(Math.round(ms)));
      win.querySelector('[data-win-time]').textContent = format(ms);
      const note = win.querySelector('[data-win-note]');
      if (assisted) note.textContent = `${difficulty[0].toUpperCase()}${difficulty.slice(1)}, with ${hints} hint${hints === 1 ? '' : 's'}. Best unaided: ${previous ? format(previous) : '—'}.`;
      else if (record) note.textContent = `${difficulty[0].toUpperCase()}${difficulty.slice(1)} · a new best time${previous ? `, down from ${format(previous)}` : ''}.`;
      else note.textContent = `${difficulty[0].toUpperCase()}${difficulty.slice(1)} · best ${format(previous)}.`;
      const harder = win.querySelector('[data-action="harder"]');
      harder.hidden = difficulty === 'hard';
      if (!win.open) win.showModal();
    },
  };

  radios.forEach((radio) => radio.addEventListener('change', () => { if (radio.checked && radio.value !== difficulty) shell.fresh(radio.value); }));
  $('[data-action="new"]').addEventListener('click', () => shell.fresh());
  $('[data-action="reset"]').addEventListener('click', () => onReset());
  hintButton.addEventListener('click', () => onHint());
  $('[data-action="undo"]')?.addEventListener('click', () => onUndo?.());
  $('[data-action="help"]').addEventListener('click', () => help.showModal());
  win.querySelector('[data-action="next"]').addEventListener('click', () => shell.fresh());
  win.querySelector('[data-action="harder"]').addEventListener('click', () => shell.fresh(DIFFICULTIES[Math.min(2, DIFFICULTIES.indexOf(difficulty) + 1)]));
  win.querySelector('[data-action="stay"]').addEventListener('click', () => win.close());

  const reflectSound = () => {
    soundButton.setAttribute('aria-pressed', String(sound.enabled));
    soundButton.setAttribute('aria-label', sound.enabled ? 'Sound on' : 'Sound off');
    soundButton.classList.toggle('off', !sound.enabled);
  };
  soundButton.addEventListener('click', () => { sound.toggle(); reflectSound(); });
  reflectSound();

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (help.open || win.open) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = event.key.toLowerCase();
    if (key === 'n') shell.fresh();
    else if (key === 'r') onReset();
    else if (key === 'h') onHint();
    else if ((key === 'u' || key === 'z') && onUndo) onUndo();
    else if (key === 'm') { sound.toggle(); reflectSound(); }
    else if (event.key === '?') help.showModal();
    else return;
    event.preventDefault();
  });
  window.addEventListener('hashchange', () => {
    const wanted = fromHash();
    if (wanted && (wanted.seed !== seed || wanted.difficulty !== difficulty)) load(wanted.difficulty, wanted.seed);
  });

  // The first visit opens the rules; after that they are a key away.
  if (!read('seen')) { store('seen', '1'); help.showModal(); }

  const wanted = fromHash();
  const stored = read('difficulty');
  load(wanted?.difficulty || (DIFFICULTIES.includes(stored) ? stored : 'medium'), wanted?.seed || randomSeed());
  return shell;
}
