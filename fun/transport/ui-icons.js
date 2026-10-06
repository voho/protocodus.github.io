// One pictogram language (DESIGN.md 5). A DOM-free string builder: a 24-unit grid with a 2-unit inset, round caps and
// joins, rect corners of 2. Network glyphs keep to 0/45/90 degree strokes and circles; land glyphs follow the map's
// 2:1 isometric diagonal. Paint lives in CSS (svg.i): only pause and play are solid, and dots are small fills.
export const GLYPHS = Object.freeze({
  // Navigation
  build: '<path d="M3 15.5 12 11l9 4.5-9 4.5Z"/><path d="M12 3v6M9 6h6"/>',
  routes: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="6" r="3"/><path d="M8 18h3l8-8V9"/>',
  gallery: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  town: '<path d="M3 20v-8l4.5-4.5L12 12v8Z"/><path d="M12 20h8.5v-6.5l-3.75-3.75L12 14.5"/><path d="M6.25 20v-3.5h2.5V20"/>',
  industry: '<path d="M3 20v-9l4.5 4.5V11l4.5 4.5V11l4.5 4.5V4H20v16Z"/>',
  news: '<path d="M4.5 5.5h11v13a2 2 0 0 0 2 2h-11a2 2 0 0 1-2-2Z"/><path d="M15.5 9.5h4v9a2 2 0 0 1-4 0"/><path d="M7.5 9h5M7.5 12.5h5M7.5 16h3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  guide: '<path d="M3 5h5.5a3.5 3.5 0 0 1 3.5 3.5V20a2 2 0 0 0-2-2H3Z"/><path d="M21 5h-5.5A3.5 3.5 0 0 0 12 8.5V20a2 2 0 0 1 2-2h7Z"/>',
  chains: '<rect x="2.5" y="3.5" width="6" height="6" rx="2"/><rect x="2.5" y="14.5" width="6" height="6" rx="2"/><rect x="15.5" y="9" width="6" height="6" rx="2"/><path d="M8.5 6.5H12v11H8.5M12 12h3.5"/>',
  overview: '<path d="m3 6.5 6-3 6 3 6-3v14l-6 3-6-3-6 3Z"/><path d="M9 3.5v14M15 6.5v14"/>',
  layers: '<path d="m12 4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/>',
  company: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M8.5 3v18M11.5 8h4.5M11.5 12h4.5M11.5 16h4.5"/>',
  achievements: '<path d="M7 4h10l-4 4h-2Z"/><circle cx="12" cy="14.5" r="6.5"/><circle cx="12" cy="14.5" r="3"/>',
  saved: '<path d="M4 6a2 2 0 0 1 2-2h10l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 4v4.5h7V4M7.5 20v-6h9v6"/>',
  world: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  sound: '<path d="M3.5 9.5h4l4-4v13l-4-4h-4Z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"/>',
  soundOff: '<path d="M3.5 9.5h4l4-4v13l-4-4h-4Z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="6.5" cy="10" r="1" class="dot"/><circle cx="10.25" cy="10" r="1" class="dot"/><circle cx="13.75" cy="10" r="1" class="dot"/><circle cx="17.5" cy="10" r="1" class="dot"/><path d="M8 14.25h8"/>',
  // Actions
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1" class="dot"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevronUp: '<path d="m6 14.5 6-6 6 6"/>',
  more: '<circle cx="6" cy="12" r="1.25" class="dot"/><circle cx="12" cy="12" r="1.25" class="dot"/><circle cx="18" cy="12" r="1.25" class="dot"/>',
  edit: '<path d="m4 20 1-5L15 5l4 4-10 10Z"/><path d="m13 7 4 4"/>',
  retire: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5"/><path d="M6 6.5V18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6.5M10 10.5v6M14 10.5v6"/>',
  undo: '<path d="M8.5 5 4 9.5 8.5 14"/><path d="M4 9.5h10.5a5 5 0 0 1 0 10H10"/>',
  swap: '<path d="M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.5" class="solid"/><rect x="13.5" y="5" width="4" height="14" rx="1.5" class="solid"/>',
  play: '<path d="M8 5.8v12.4a1 1 0 0 0 1.5.8l9.6-6.2a1 1 0 0 0 0-1.6L9.5 5a1 1 0 0 0-1.5.8Z" class="solid"/>',
  // States
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5.5-5.5"/>',
  warn: '<path d="M12 3.5 21 19.5H3Z"/><path d="M12 9.5V14"/><circle cx="12" cy="16.75" r="1" class="dot"/>',
  error: '<path d="M8.25 3h7.5L21 8.25v7.5L15.75 21h-7.5L3 15.75v-7.5Z"/><path d="M12 7.5V13"/><circle cx="12" cy="16" r="1" class="dot"/>',
  broken: '<path d="M2.5 12H7M17 12h4.5"/><path d="m6.5 15.5 7-7M10.5 15.5l7-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r="1" class="dot"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1" class="dot"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3.5"/>',
  trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trendDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  // Modes and things
  bus: '<rect x="4" y="3" width="16" height="14.5" rx="2"/><path d="M4 11h16M7 17.5V20M17 17.5V20"/><circle cx="7.75" cy="14.25" r="1" class="dot"/><circle cx="16.25" cy="14.25" r="1" class="dot"/>',
  truck: '<path d="M13.5 16V6.5h-9a2 2 0 0 0-2 2V16"/><path d="M13.5 9.5H17l4 4V16"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/><path d="M8.5 17.5H15"/>',
  train: '<rect x="5.5" y="3" width="13" height="14" rx="2"/><path d="M5.5 10h13M9 17l-3 3M15 17l3 3"/><circle cx="9" cy="13.5" r="1" class="dot"/><circle cx="15" cy="13.5" r="1" class="dot"/>',
  ship: '<path d="M2.5 14h19l-5 5h-9Z"/><path d="M6.5 14v-4h10v4M10 10V6h3v4"/>',
  plane: '<path d="M10.5 18.5V5a1.5 1.5 0 0 1 3 0v13.5"/><path d="m10.5 9.5-8 4.5v2l8-2.5M13.5 9.5l8 4.5v2l-8-2.5M10.5 18.5 8 20.5M13.5 18.5l2.5 2"/>',
  stop: '<circle cx="12" cy="8.5" r="5.5"/><path d="M6.5 8.5h11M12 14v7"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4h13l-4 4 4 4h-13"/>',
  stock: '<rect x="3" y="12.5" width="8" height="8" rx="2"/><rect x="13" y="12.5" width="8" height="8" rx="2"/><rect x="8" y="3.5" width="8" height="8" rx="2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.25a2.5 2.5 0 0 0-2.25-1.5h-.75a2.1 2.1 0 0 0 0 4.2h1a2.1 2.1 0 0 1 0 4.2h-.75a2.5 2.5 0 0 1-2.25-1.5M12 6v1.75M12 16.15V18"/>',
  house: '<path d="M4 20v-9l8-8 8 8v9Z"/><path d="M10 20v-5h4v5"/>',
  shop: '<path d="M4.5 11v9h15v-9"/><path d="M3 4h18v4.5a2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0Z"/><path d="M10 20v-5h4v5"/>',
  workshop: '<path d="M3 20v-9l5-5h8l5 5v9Z"/><path d="M7.5 20v-6.5h9V20M7.5 16.75h9"/>',
  tree: '<path d="M12 2.5 6.5 8H9l-5.5 5.5h17L15 8h2.5Z"/><path d="M12 13.5V21"/>',
  leaf: '<path d="M19.5 4.5C9 4 4.5 9 5 15.5c7 .5 14.5-2 14.5-11Z"/><path d="m4.5 20 9-9"/>',
  label: '<path d="M3 5v6.5l9.5 9.5 8.5-8.5L11.5 3H5a2 2 0 0 0-2 2Z"/><circle cx="7.5" cy="7.5" r="1.25" class="dot"/>',
  // Tools (land family)
  // A wide carriageway and a narrow sleeper ladder stay distinct at 16 px.
  road: '<path d="m2 14 12-6M10 18l12-6"/><path d="m7 15.5 3-1.5M14 12l3-1.5"/>',
  rail: '<path d="m3 15.5 14-7M7 17.5l14-7"/><path d="m3 14.5 6 3M7 12.5l6 3M11 10.5l6 3M15 8.5l6 3"/>',
  bridge: '<path d="M2.5 8.5h19"/><path d="M5 8.5V20M19 8.5V20"/><path d="M5 17a7 7 0 0 1 14 0"/>',
  tunnel: '<path d="M2.5 20.5h19"/><path d="M3 20.5V11l5-5h8l5 5v9.5"/><path d="M8 20.5V15a4 4 0 0 1 8 0v5.5"/>',
  bulldoze: '<rect x="3" y="15.5" width="12" height="5" rx="2"/><path d="M5 15.5V7h7v8.5M12 11h3v4.5"/><path d="M15 18h4M19 10v10.5h2.5"/>',
  raise: '<path d="m2 20 10-5 10 5"/><path d="M12 12V3M8 7l4-4 4 4"/>',
  lower: '<path d="m2 20 10-5 10 5"/><path d="M12 3v9M8 8l4 4 4-4"/>',
  level: '<path d="m2 16.5 10-5 10 5-10 5Z"/><path d="M7 3v6M4.5 6.5 7 9l2.5-2.5M17 9V3M14.5 5.5 17 3l2.5 2.5"/>',
  zones: '<path d="m2 13 10-5 10 5-10 5Z"/><path d="m8 13 4-2 4 2-4 2Z"/>',
  grid: '<path d="m2 12 10-5 10 5-10 5Z"/><path d="m7 9.5 10 5M7 14.5l10-5"/>',
  pointer: '<path d="M6 3v15l4-4 2.5 5.5 2-1-2.5-5H16.5Z"/>',
  // Weather
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.25 5.25l1.5 1.5M17.25 17.25l1.5 1.5M5.25 18.75l1.5-1.5M17.25 6.75l1.5-1.5"/>',
  cloud: '<path d="M7 18h10.5a3.5 3.5 0 0 0 .25-7 5.75 5.75 0 0 0-11-1A4 4 0 0 0 7 18Z"/>',
  rain: '<path d="M7 14.5h10.5a3.25 3.25 0 0 0 .25-6.5 5.5 5.5 0 0 0-10.5-1A3.75 3.75 0 0 0 7 14.5Z"/><path d="m8.5 17.5-1.5 1.5M12.5 17.5 11 19M16.5 17.5 15 19"/>',
  snow: '<path d="M7 14.5h10.5a3.25 3.25 0 0 0 .25-6.5 5.5 5.5 0 0 0-10.5-1A3.75 3.75 0 0 0 7 14.5Z"/><circle cx="8" cy="18.5" r="1" class="dot"/><circle cx="12" cy="20" r="1" class="dot"/><circle cx="16" cy="18.5" r="1" class="dot"/>',
  fog: '<path d="M7 12.5h10.5a3 3 0 0 0 .25-6 5 5 0 0 0-9.75-1A3.5 3.5 0 0 0 7 12.5Z"/><path d="M4 16h16M6.5 19.5h11"/>',
  // Biomes
  taiga: '<path d="M8 3 3.5 9.5h2L2.5 14h11l-3-4.5h2Z"/><path d="M8 14v5M15.5 7.5l-3.25 4.75"/><path d="M15.5 7.5 21 15.5h-6M16.5 15.5V19M2.5 19.5h19"/>',
  tundra: '<path d="M2.5 19.5 9.5 7l4.5 8 2-3 5.5 7.5Z"/><path d="m7 11.5 1.25 1.25 1.25-1.25 1.25 1.25L12 11.5"/>',
  desert: '<path d="M13 18V5M13 13H9.5V9.5M13 10.5h3.5V7"/><path d="M2.5 20.5c5-4.5 14-4.5 19 0"/>',
});

// Retired names from the five glyph sets this module replaces; ui-consistency-sweep deletes the table.
export const ALIASES = Object.freeze({
  route: 'routes', factory: 'industry', city: 'town', help: 'guide', save: 'saved', globe: 'world', focus: 'locate',
  mouse: 'pointer', inspect: 'pointer', compass: 'overview', volume: 'sound', muted: 'soundOff', warning: 'warn',
  pencil: 'edit', arrow: 'chevronRight', arrowup: 'trendUp', port: 'stop', medal: 'achievements',
});

const reported = new Set();
const escape = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strict = () => Boolean(globalThis.TRANSPORT_DEV) || ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
export const has = name => Object.hasOwn(GLYPHS, name);
export const names = () => Object.keys(GLYPHS);

export function icon(name, { size = 20, label = '', cls = '' } = {}) {
  const glyph = GLYPHS[has(name) ? name : ALIASES[name]];
  if (!glyph) {
    if (strict()) throw new Error(`Unknown icon: ${name}`);
    if (!reported.has(name)) { reported.add(name); console.error(`Unknown icon: ${name}`); }
    return '';
  }
  const semantics = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return `<svg class="${`i i${size} ${cls}`.trim()}" viewBox="0 0 24 24" width="${size}" height="${size}" ${semantics}>${glyph}</svg>`;
}

// Road vehicles follow the cargo: buses carry passengers and mail, trucks carry freight.
export const modeGlyph = (mode, cargo) => mode === 'rail' ? 'train' : mode === 'water' ? 'ship' : mode === 'air' ? 'plane' : cargo && cargo !== 'passengers' && cargo !== 'mail' ? 'truck' : 'bus';
