/* Worlds for the puzzle tables, shared by Zipper and Patcher: each one a
   palette, a sky, a light and a weather. The pick is kept in the browser
   and both puzzles follow it.

   `tiles` shade the board from one corner to the other between two hues;
   `lit` is how a Zipper tile lights up under the line. `ambient` is the
   weather: clouds of drifting dots (`rise` per second, `sway` sideways,
   `twinkle` as a blink rate) or showers of sparks now and then. */
export const THEMES = {
  jungle: {
    label: 'Jungle',
    accent: '#c9f04d', secondary: '#ffb347', ink: '#f4ffd6',
    backdrop: { top: '#0f2a17', bottom: '#030704', glow: '#7ad86a', glowStrength: 0.12, blobA: '#2f9e5a', blobB: '#d4b43a', blobStrength: 0.08 },
    light: { key: '#fff3cf', sky: '#a8d8a0', ground: '#06100a' },
    plinth: '#0b150c',
    tiles: { hue: [0.32, 0.43], sat: 0.45, light: 0.16, lit: { sat: 0.8, light: 0.5 } },
    wall: '#ffcf4a',
    palette: ['#8fe36b', '#ffd23f', '#ff8c42', '#5fd3bf', '#f06292', '#c6e85d', '#ffb6a3', '#7fc8ff', '#ffa726', '#b39ddb', '#aaf0d1', '#ffe082'],
    bokeh: ['#9bf27a', '#ffd36b', '#ffffff', '#4fd1a0'],
    // Fireflies: slow, wandering, blinking.
    ambient: [{ count: 60, colours: ['#e4ff7a', '#fff3a0', '#b6ff5c'], size: 0.22, floor: 0.3, ceiling: 3.5, rise: 0.04, sway: 0.35, twinkle: 2.4 }],
  },
  ocean: {
    label: 'Ocean',
    accent: '#5fd8ff', secondary: '#ff8a80', ink: '#e6f7ff',
    backdrop: { top: '#0b2a3f', bottom: '#02070c', glow: '#4fd1ff', glowStrength: 0.13, blobA: '#2fd9c0', blobB: '#3f6bff', blobStrength: 0.08 },
    light: { key: '#eaf6ff', sky: '#9fc3d8', ground: '#0a0d12' },
    plinth: '#071424',
    tiles: { hue: [0.52, 0.66], sat: 0.6, light: 0.2, lit: { sat: 0.95, light: 0.52 } },
    wall: '#ffd166',
    palette: ['#5fd8ff', '#ff8a80', '#ffe08a', '#7ee8c7', '#9fb8ff', '#ffb870', '#6be0e0', '#f7a1d6', '#b5f0a0', '#8fd3ff', '#ffd59e', '#c9a8ff'],
    bokeh: ['#5fd8ff', '#3f6bff', '#ffffff', '#7ee8c7'],
    // Bubbles rising towards the surface.
    ambient: [{ count: 80, colours: ['#bfefff', '#ffffff'], size: 0.16, floor: -3, ceiling: 4, rise: 0.35, sway: 0.3, twinkle: 0.4 }],
  },
  arctic: {
    label: 'Arctic',
    accent: '#bfe9ff', secondary: '#c9b8ff', ink: '#f2fbff',
    backdrop: { top: '#1a2f4a', bottom: '#05080f', glow: '#bfe9ff', glowStrength: 0.1, blobA: '#7fe0c0', blobB: '#b08cff', blobStrength: 0.09 },
    light: { key: '#f4fbff', sky: '#dfeeff', ground: '#0c1220' },
    plinth: '#101a2a',
    tiles: { hue: [0.55, 0.63], sat: 0.35, light: 0.22, lit: { sat: 0.6, light: 0.72 } },
    wall: '#ffffff',
    palette: ['#bfe9ff', '#ffffff', '#c9b8ff', '#9ed0ff', '#ffd6e0', '#a8efe3', '#e2e6ff', '#ffefb8', '#8ec8ff', '#eadcff', '#b3f3ff', '#d4f7c7'],
    bokeh: ['#bfe9ff', '#c9b8ff', '#ffffff', '#7fe0c0'],
    // Snow, falling slowly and swaying.
    ambient: [{ count: 180, colours: ['#ffffff', '#dff3ff'], size: 0.14, extent: 9, floor: -4, ceiling: 5, rise: -0.3, sway: 0.45, twinkle: 0.6 }],
  },
  industrial: {
    label: 'Industrial',
    accent: '#ffb000', secondary: '#8fb3c9', ink: '#fff1d6',
    backdrop: { top: '#23262b', bottom: '#07080a', glow: '#ff9d3c', glowStrength: 0.07, blobA: '#5c6b7a', blobB: '#b35a1f', blobStrength: 0.06 },
    light: { key: '#ffe6c8', sky: '#aab4bf', ground: '#0b0c0e' },
    plinth: '#15171a',
    tiles: { hue: [0.58, 0.62], sat: 0.12, light: 0.17, lit: { hue: [0.08, 0.12], sat: 0.9, light: 0.5 } },
    wall: '#ff9d3c',
    palette: ['#ffb000', '#8fb3c9', '#e07a5f', '#c0c4c8', '#ffd166', '#7fb6a4', '#ff7a1a', '#a5a8ff', '#d9a066', '#9fd3e8', '#ffe8a3', '#b87333'],
    bokeh: ['#ff9d3c', '#8fb3c9', '#ffffff', '#ffd166'],
    // Showers of sparks from round the table, and grey motes in the air.
    ambient: [
      { kind: 'sparks', colours: ['#ffd27a', '#ff9d3c', '#ffffff'], every: [0.7, 2] },
      { count: 50, colours: ['#aab4bf'], size: 0.12, floor: 0, ceiling: 4, rise: 0.06, sway: 0.12, twinkle: 0.3 },
    ],
  },
  volcano: {
    label: 'Volcano',
    accent: '#ff6b35', secondary: '#ffd166', ink: '#ffe9d6',
    backdrop: { top: '#3a0f0a', bottom: '#060202', glow: '#ff5a1f', glowStrength: 0.16, blobA: '#ff3d1f', blobB: '#ffb347', blobStrength: 0.09, breathe: 0.6 },
    light: { key: '#ffd3b0', sky: '#ff9a6a', ground: '#1a0604' },
    plinth: '#1a0806',
    tiles: { hue: [0.98, 1.06], sat: 0.5, light: 0.15, lit: { sat: 1, light: 0.55 } },
    wall: '#ff3d1f',
    palette: ['#ff6b35', '#ffd166', '#ff8c6b', '#b0bec5', '#f25c54', '#ffe29a', '#ff9f1c', '#9aa5ff', '#ff7f50', '#ffcc80', '#e8a090', '#ffd9a0'],
    bokeh: ['#ff6b35', '#ffd166', '#ff3d1f', '#ffffff'],
    // Embers rising, flickering.
    ambient: [{ count: 110, colours: ['#ff7a2a', '#ffb347', '#ff3d1f'], size: 0.18, floor: -1, ceiling: 5, rise: 0.35, sway: 0.3, twinkle: 3 }],
  },
  moon: {
    label: 'Moon',
    accent: '#dfe6ff', secondary: '#ffe9a8', ink: '#f4f6ff',
    backdrop: { top: '#0d1120', bottom: '#020308', glow: '#aab8ff', glowStrength: 0.07, blobA: '#4a5a9a', blobB: '#2d2f5a', blobStrength: 0.05 },
    light: { key: '#e6ecff', sky: '#aab4d8', ground: '#06070c' },
    plinth: '#0f1116',
    tiles: { hue: [0.6, 0.66], sat: 0.1, light: 0.2, lit: { sat: 0.3, light: 0.7 } },
    wall: '#e8f0ff',
    palette: ['#d9dde3', '#aab4c3', '#f0e6c8', '#c9c2ff', '#bfe3ff', '#e8d5ff', '#fff5d6', '#9fb3ff', '#cfd8dc', '#ffe9a8', '#b8c4d8', '#e0f7fa'],
    bokeh: ['#dfe6ff', '#ffe9a8', '#9fb3ff', '#ffffff'],
    // A still starfield far below the table, twinkling.
    ambient: [{ count: 240, colours: ['#ffffff', '#cfd8ff', '#fff0c8'], size: 0.1, extent: 16, floor: -10, ceiling: -5, rise: 0, sway: 0.015, twinkle: 1.2 }],
  },
};

const STORAGE_KEY = 'puzzle-theme';

/* The theme button and card in the page chrome: a tap on the button opens
   the card, a tap on a world picks it, T cycles them. `onChange` runs on
   a pick, with the theme; the first theme is read, not announced. */
export function createThemeSwitch({ fallback, onChange }) {
  const names = Object.keys(THEMES);
  const read = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
  const store = (value) => { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ } };
  let name = names.includes(read()) ? read() : fallback;

  const button = document.querySelector('[data-action="theme"]');
  const dialog = document.querySelector('[data-dialog="theme"]');
  const list = dialog.querySelector('[data-themes]');
  for (const key of names) {
    const theme = THEMES[key];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theme';
    item.dataset.theme = key;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--a', theme.backdrop.top);
    swatch.style.setProperty('--b', theme.accent);
    swatch.style.setProperty('--c', theme.secondary);
    item.append(swatch, document.createTextNode(theme.label));
    item.addEventListener('click', () => { apply(key); dialog.close(); });
    list.append(item);
  }

  function dress(theme) {
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.body.style.background = theme.backdrop.bottom;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.backdrop.bottom);
    for (const item of list.children) item.setAttribute('aria-pressed', String(item.dataset.theme === name));
    button.setAttribute('aria-label', `Theme: ${theme.label}`);
  }
  function apply(key) {
    if (!THEMES[key] || key === name) return;
    name = key;
    store(key);
    dress(THEMES[key]);
    onChange?.(THEMES[key]);
  }

  button.addEventListener('click', () => dialog.showModal());
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key.toLowerCase() !== 't') return;
    apply(names[(names.indexOf(name) + 1) % names.length]);
    event.preventDefault();
  });
  dress(THEMES[name]);

  return {
    get current() { return THEMES[name]; },
    get name() { return name; },
    apply,
  };
}
