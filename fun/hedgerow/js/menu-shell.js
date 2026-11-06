/* DOM-only menu presentation. Simulation, pause and pointer-lock remain in main.js. */
import { archivalImageForMission } from './archive.js';
import { pickMission } from './missions.js';

const screens = [...document.querySelectorAll('[data-screen]')];
const rememberedFocus = new WeakMap();
let activeScreen = null;
let initialScreen = true;

function visible(el) {
  return !el.disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
}
function focusables(screen) {
  return [...screen.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(visible);
}
function rangeText(key, value) {
  if (key === 'fov') return `${Math.round(value)}°`;
  if (key === 'volume' || key === 'effectsVolume' || key === 'ambienceVolume') return `${Math.round(value * 100)}%`;
  return `${Number(value).toFixed(2)}×`;
}
function syncSettingValues() {
  for (const out of document.querySelectorAll('[data-setting-value]')) {
    const key = out.dataset.settingValue;
    const control = document.querySelector(`[data-setting="${key}"]`);
    if (!control) continue;
    const text = rangeText(key, Number(control.value));
    out.textContent = text;
    control.setAttribute('aria-valuetext', text);
  }
  const difficulty = document.querySelector('[data-setting="difficulty"]');
  const note = document.querySelector('[data-difficulty-note]');
  if (note && difficulty) {
    note.textContent = {
      recruit: 'More time to react. Enemy fire is less accurate and less punishing.',
      regular: 'The standard experience. Stay in cover and choose your approach.',
      veteran: 'Accurate enemy fire and less room for mistakes. Use every advantage.',
    }[difficulty.value] || '';
  }
}
function syncScreens() {
  const next = screens.find(screen => screen.classList.contains('on')) || null;
  if (next === activeScreen) return;
  if (activeScreen?.contains(document.activeElement)) rememberedFocus.set(activeScreen, document.activeElement);
  activeScreen = next;
  for (const screen of screens) {
    const shown = screen === next;
    screen.inert = !shown;
    screen.setAttribute('aria-hidden', String(!shown));
  }
  if (!next) return;
  syncSettingValues();
  // On first load, let the player choose when to enter keyboard navigation.
  if (initialScreen) { initialScreen = false; return; }
  // Wait for show() and syncSettingsForm() to finish together; never focus a hidden dialog.
  requestAnimationFrame(() => {
    if (next !== activeScreen || !next.classList.contains('on')) return;
    const remembered = rememberedFocus.get(next);
    const target = remembered && visible(remembered) ? remembered : focusables(next)[0];
    if (target) target.focus({ preventScroll: true });
    else {
      const heading = next.querySelector('h1, h2');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  });
}

const observer = new MutationObserver(syncScreens);
for (const screen of screens) observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
syncScreens();

document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !activeScreen) return;
  const items = focusables(activeScreen);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
});
document.addEventListener('input', event => {
  if (event.target.matches('[data-setting]')) syncSettingValues();
});

// An authentic archive image accompanies the fictional operation, with its own caption and source.
let savedMission = null;
try { savedMission = localStorage.getItem('hedgerow.mission'); } catch { /* Private browsing. */ }
const missionId = pickMission(new URLSearchParams(location.search).get('mission'), savedMission).id;
const archive = archivalImageForMission(missionId);
const figure = document.querySelector('[data-archive]');
if (archive && figure) {
  const img = figure.querySelector('[data-archive-image]');
  img.src = archive.src;
  img.alt = archive.caption;
  img.width = archive.width;
  img.height = archive.height;
  figure.querySelector('[data-archive-caption]').textContent = archive.caption;
  figure.querySelector('[data-archive-date]').textContent = archive.date;
  const credit = figure.querySelector('[data-archive-credit]');
  credit.textContent = `${archive.credit} · ${archive.rights}`;
  credit.href = archive.source;
  credit.setAttribute('aria-label', `${archive.credit}. ${archive.rights}. View the historical source in a new tab.`);
  figure.hidden = false;
  img.addEventListener('error', () => { figure.hidden = true; }, { once: true });
}
