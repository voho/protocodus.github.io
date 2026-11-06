/* DOM-only menu behavior. The game remains responsible for pausing and
   pointer lock; this module keeps keyboard focus inside the visible dialog. */
import { archivalImageForMission } from './archive.js';
import { pickMission } from './missions.js';

const screens = [...document.querySelectorAll('[data-screen]')];
const focusByScreen = new WeakMap();
let active = null, initialized = false;

const focusable = (screen) => [...screen.querySelectorAll(
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);

function updateSettingValues() {
  const format = {
    sensitivity: (v) => `${Number(v).toFixed(2)}×`,
    volume: (v) => `${Math.round(Number(v) * 100)}%`,
    effectsVolume: (v) => `${Math.round(Number(v) * 100)}%`,
    ambienceVolume: (v) => `${Math.round(Number(v) * 100)}%`,
    fov: (v) => `${Math.round(Number(v))}°`,
  };
  for (const [key, display] of Object.entries(format)) {
    const input = document.querySelector(`[data-setting="${key}"]`);
    const output = document.querySelector(`[data-setting-value="${key}"]`);
    if (input && output) {
      output.value = display(input.value);
      input.setAttribute('aria-valuetext', output.value);
    }
  }
  const difficulty = document.querySelector('[data-setting="difficulty"]');
  const note = document.querySelector('[data-difficulty-note]');
  if (note && difficulty) note.textContent = {
    recruit: 'More time to react. Enemy fire is less accurate and less punishing.',
    regular: 'The standard experience. Stay in cover and choose your approach.',
    veteran: 'Accurate enemy fire and less room for mistakes. Use every advantage.',
  }[difficulty.value] || '';
}

function syncDialog() {
  const next = screens.find((el) => el.classList.contains('on')) || null;
  for (const screen of screens) {
    screen.inert = screen !== next;
    screen.setAttribute('aria-hidden', screen === next ? 'false' : 'true');
  }
  if (next === active) return;
  if (active?.contains(document.activeElement)) focusByScreen.set(active, document.activeElement);
  active = next;
  if (!active) return;
  updateSettingValues();
  const previous = focusByScreen.get(active);
  const target = previous && focusable(active).includes(previous) ? previous : focusable(active)[0];
  active.tabIndex = -1;
  // The first paint belongs to the artwork and title, without a focus ring
  // around a loading disclosure. Keyboard navigation still starts in the dialog.
  (initialized ? target || active : active).focus({ preventScroll: true });
  initialized = true;
}

const observer = new MutationObserver(syncDialog);
for (const screen of screens) observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-setting]')) updateSettingValues();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !active) return;
  const items = focusable(active);
  if (!items.length) { event.preventDefault(); active.focus(); return; }
  const first = items[0], last = items.at(-1), focused = document.activeElement;
  if (event.shiftKey && (focused === first || !items.includes(focused))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (focused === last || !items.includes(focused))) {
    event.preventDefault(); first.focus();
  }
});
syncDialog();


// Historical references are independent of the fictional mission illustration.
// Keep their pixels unloaded until the player opens the optional disclosure.
const archiveDetails = document.querySelector('[data-archive]');
if (archiveDetails) {
  let savedMission = null;
  try { savedMission = localStorage.getItem('hedgerow.mission'); } catch { /* Private browsing. */ }
  const id = pickMission(new URLSearchParams(location.search).get('mission'), savedMission).id;
  const archive = id === 'prague' ? null : archivalImageForMission(id);
  if (archive) {
    const img = archiveDetails.querySelector('[data-archive-image]');
    img.alt = archive.caption; img.width = archive.width; img.height = archive.height;
    archiveDetails.querySelector('[data-archive-caption]').textContent = archive.caption;
    const credit = archiveDetails.querySelector('[data-archive-credit]');
    credit.textContent = `${archive.credit} · ${archive.rights}`;
    credit.href = archive.source;
    credit.setAttribute('aria-label', `${archive.credit}. ${archive.rights}. View the historical source in a new tab.`);
    archiveDetails.hidden = false;
    archiveDetails.addEventListener('toggle', () => {
      if (archiveDetails.open && !img.hasAttribute('src')) img.src = archive.src;
    });
    img.addEventListener('error', () => { archiveDetails.hidden = true; }, { once: true });
  }
}
