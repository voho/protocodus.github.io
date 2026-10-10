/* Meteora — start, pause and destroyed screens, loading and settings.

   Settings persist in localStorage under `meteora.settings`. Every access
   is wrapped: private browsing or a full quota just means the defaults. */

const KEY = 'meteora.settings';
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const DEFAULT_SETTINGS = Object.freeze({
  volume: 0.8, invertPitch: false, vibration: !reducedMotion, muted: false,
});

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* defaults next time */ }
}

export function createScreens(root, settings, handlers) {
  const screens = Object.fromEntries([...root.querySelectorAll('[data-screen]')].map(el => [el.dataset.screen, el]));
  const fill = root.querySelector('[data-loading-fill]');
  const bar = root.querySelector('[data-loading-bar]');
  const label = root.querySelector('[data-loading-label]');
  const launch = root.querySelector('[data-action="launch"]');
  let current = 'start';

  for (const button of root.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => handlers[button.dataset.action]?.());
  }
  for (const input of root.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = !!settings[key];
    else input.value = settings[key];
    input.addEventListener('input', () => {
      settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      saveSettings(settings);
      handlers.settings?.(settings);
    });
  }

  return {
    get current() { return current; },
    show(name) {
      current = name;
      for (const [key, el] of Object.entries(screens)) el.classList.toggle('on', key === name);
      const target = name && screens[name]?.querySelector('.launch:not(:disabled)');
      if (target) target.focus({ preventScroll: true });
    },
    progress(fraction, text) {
      const pct = Math.round(fraction * 100);
      fill.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      if (text) label.textContent = text;
    },
    ready() {
      root.querySelector('[data-loading]').classList.add('done');
      launch.disabled = false;
      launch.focus({ preventScroll: true });
    },
    error(message) {
      const box = root.querySelector('[data-error]');
      box.hidden = false;
      box.querySelector('[data-error-text]').textContent = message;
      launch.hidden = true;
    },
    stats(values) {
      for (const [key, value] of Object.entries(values)) {
        for (const el of root.querySelectorAll(`[data-stat="${key}"]`)) el.textContent = value.toLocaleString('en');
      }
    },
  };
}
