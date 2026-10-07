// Redrawn on a roomy 24px grid. World and transport symbols use the same 2:1
// ground axes; commands stay planar for small desktop controls. CSS owns paint.
const path = d => `<path d="${d}"/>`;
const circle = (x,y,r,dot=false) => `<circle cx="${x}" cy="${y}" r="${r}"${dot?' class="dot"':''}/>`;
const rect = (x,y,w,h,r=1.5,solid=false) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"${solid?' class="solid"':''}/>`;
export const GLYPHS = Object.freeze({
  build:path('M3 15 12 10.5 21 15 12 19.5ZM12 3.5v5M9.5 6h5'),
  routes:circle(5,17,2.5)+circle(19,7,2.5)+path('M7.5 17H12V7h4.5'),
  gallery:rect(3.5,3.5,17,17)+path('M3.5 12h17M12 3.5v17'),
  town:path('M3 18V10l5-3 5 3v8l-5 3ZM8 13l5-3M8 13v8M13 18l7-3V6l-7-3-5 2.5M16 8v3'),
  industry:path('M3 18V9l6 3V8l6 3V4h4v11l2 1v3l-9 3ZM3 18l9-4 9 5M8 15v2M15 14v2'),
  news:rect(4,4,16,16)+rect(7,7,5,5,1)+path('M15 7h2M15 10h2M7 15h10M7 17.5h6'),
  menu:path('M4 6h16M4 12h16M4 18h16'),
  guide:path('M12 6.5C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1.5ZM12 6.5V20'),
  chains:rect(3,4,6,6)+rect(15,14,6,6)+path('M9 7h9v7M6 10v7h9'),
  overview:path('M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15')+circle(12,11,1,true),
  layers:path('M3 7.5 12 3l9 4.5-9 4.5ZM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5'),
  company:rect(4,8,16,12)+path('M8 8V4h8v4M4 13h16M10 13v3h4v-3'),
  achievements:path('M6 4h12v7a6 6 0 0 1-12 0ZM6 6H3v3a4 4 0 0 0 4 4M18 6h3v3a4 4 0 0 1-4 4M12 17v4M8 21h8'),
  saved:path('M4 3h13l4 4v14H4ZM8 3v6h8V3M8 21v-7h9v7M13 5v2'),
  world:circle(12,12,9)+path('M3 12h18M5 6.5h14M5 17.5h14M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z'),
  sound:path('M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14'),
  soundOff:path('M3 9h4l5-4v14l-5-4H3ZM16 9l5 6M21 9l-5 6'),
  search:circle(10,10,6.5)+path('M15 15l6 6'),
  keyboard:rect(3,6,18,13)+path('M7 10h1M11.5 10h1M16 10h1M7 14h1M11.5 14H17'),
  close:path('M5.5 5.5l13 13M18.5 5.5l-13 13'),
  plus:path('M12 4v16M4 12h16'), minus:path('M4 12h16'),
  locate:circle(12,12,5)+circle(12,12,1,true)+path('M12 3v3M12 18v3M3 12h3M18 12h3'),
  chevronRight:path('M8.5 5.5 15 12l-6.5 6.5'),chevronLeft:path('M15.5 5.5 9 12l6.5 6.5'),
  chevronDown:path('M5.5 8.5 12 15l6.5-6.5'),chevronUp:path('M5.5 15.5 12 9l6.5 6.5'),
  more:circle(5,12,1,true)+circle(12,12,1,true)+circle(19,12,1,true),
  edit:path('M4 20l1-6L16 3l5 5-11 11ZM13 6l5 5M5 14l5 5'),
  retire:path('M3.5 7h17M8 7V3.5h8V7M6 7l1 14h10l1-14M10 10v7M14 10v7'),
  undo:path('M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12'),
  swap:path('M3 7h18M17 3l4 4-4 4M21 17H3M7 13l-4 4 4 4'),
  check:path('M4 12l5.5 5.5L20 7'),
  pause:rect(5,4,5,16,1,true)+rect(14,4,5,16,1,true),
  play:'<path d="M6 4 21 12 6 20Z" class="solid"/>',
  ok:circle(12,12,9)+path('M7 12l3.5 3.5L17 9'),
  warn:path('M12 3 22 20H2ZM12 9v5')+circle(12,17,1,true),
  error:path('M8 3h8l5 5v8l-5 5H8l-5-5V8ZM8 8l8 8M16 8l-8 8'),
  broken:path('M3 8h5v8H3M21 8h-5v8h5M10 6l-2 6h8l-2 6'),
  info:circle(12,12,9)+circle(12,7.5,1,true)+path('M10 11h2v6M10 17h4'),
  lock:rect(5,10,14,11)+path('M8 10V7a4 4 0 0 1 8 0v3M12 14v3'),
  clock:circle(12,12,9)+path('M12 6v7l5 2'),
  trendUp:path('M3 18l6-6 4 3 8-10M15 5h6v6'),
  trendDown:path('M3 6l6 6 4-3 8 10M15 19h6v-6'),
  bus:path('M3 13V7l12-3 6 3v10l-6 3-12-3ZM3 7l6 3 12-3M9 10v10M4.5 12l2 1M12 11l6-1.5M12 14l6-1.5')+circle(6,18,1,true)+circle(18,18,1,true),
  truck:path('M3 12V6l10-3 5 2v6l3 3v5l-7 2-11-4ZM3 6l5 3 10-4M8 9v9M14 11v10M14 11l4-1M16 12l3 2-3 1')+circle(6,18,1,true)+circle(18,20,1,true),
  train:path('M4 5l8-2 8 2v12l-8 3-8-3ZM4 5l8 3 8-3M12 8v12M6 9l3 1M15 10l3-1M6 21l2-2M18 21l-2-2')+circle(8,14,1,true)+circle(16,14,1,true),
  ship:path('M2 15l13-6 7 4-7 7-8 1ZM7 13V8l9-4 4 2v7M7 8l4 2 9-4M11 10v3M2 15l8 3 12-5'),
  plane:path('M3 16l7-5 1-7 3-1 1 6 6 3v3l-7-2-1 5 3 2-1 1-4-1-4 2-2-1 4-4v-3l-6 4Z'),
  stop:circle(12,8,5)+path('M12 13v8M8 21h8M9 8h6'),
  flag:path('M5 21V3M5 4h15l-5 5 5 5H5'),
  stock:path('M3 12l9-4 9 4v7l-9 3-9-3ZM3 12l9 4 9-4M12 16v6M7 10V5l8-3 5 2v7'),
  coin:circle(12,12,9)+circle(12,12,6)+path('M13 7l-3 5h4l-3 5'),
  house:path('M3 11l9-8 9 8-9 4ZM5 12v7l7 3 7-3v-7M12 15v7M7 14v3M15 17l2-1v4'),
  shop:path('M3 7l12-4 6 3v6l-6 4-12-4ZM3 7l6 3 12-4M9 10v5M5 13v6l10 3 5-3v-6M15 16v6'),
  workshop:path('M3 12l10-8 8 4v11l-9 3-9-4ZM3 12l9 4 9-8M12 16v6M5 13v4l4 2v-4M15 14l4-2v6'),
  tree:path('M12 3 5 10h3l-5 6h18l-5-6h3ZM12 16v6'),
  leaf:path('M4 16C3 7 12 3 21 3c0 9-6 17-14 15ZM3 21 15 9'),
  label:path('M3 4h9l9 9-8 8-10-10Z')+circle(7,8,1,true),
  road:path('M2 14 15 7M9 19l13-7M7 14l3-1.5M14 10.5l3-1.5'),
  rail:path('M2 15 17 7.5M7 17.5 22 10M4 13l5 2.5M8 11l5 2.5M12 9l5 2.5M16 7l5 2.5'),
  bridge:path('M2 12l14-7 6 3-14 7ZM5 13v7M17 7v7M11 13v7M20 9v7M5 20l6-3'),
  tunnel:path('M3 20V10l4-6 6-2 7 5v11l-7 4ZM13 22V12l-6-3M13 12l7-5M5 20v-6a3 3 0 0 1 6 0v7'),
  bulldoze:path('M3 16l10-4 7 3v5l-10 2-7-3ZM6 15V7l7-3 4 2v8M6 7l5 2 6-3M11 9v5M21 10v12'),
  raise:path('M2 19l10-5 10 5-10 3ZM12 12V2M8 6l4-4 4 4'),
  lower:path('M2 19l10-5 10 5-10 3ZM12 2v10M8 8l4 4 4-4'),
  level:path('M2 17l10-5 10 5-10 5ZM4 8h16M8 4v4M16 4v4'),
  zones:path('M2 12l10-5 10 5-10 5ZM6 14v4l6 3 6-3v-4M12 17v4'),
  grid:path('M2 12l10-5 10 5-10 5ZM7 9.5l10 5M7 14.5l10-5'),
  pointer:path('M5 3l14 10-7 1 3 6-3 1-3-6-4 5Z'),
  sun:circle(12,12,4.5)+path('M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'),
  cloud:path('M6 19a4 4 0 0 1-1-8 6 6 0 0 1 11-3 5.5 5.5 0 0 1 1 11Z'),
  rain:path('M6 14a3 3 0 0 1-1-6 5 5 0 0 1 10-2 4.5 4.5 0 0 1 2 8ZM7 17l-2 4M13 17l-2 4M19 17l-2 4'),
  snow:path('M6 14a3 3 0 0 1-1-6 5 5 0 0 1 10-2 4.5 4.5 0 0 1 2 8Z')+circle(6,19,1,true)+circle(12,21,1,true)+circle(18,19,1,true),
  fog:path('M6 12a3 3 0 0 1-1-6 5 5 0 0 1 10-2 4.5 4.5 0 0 1 2 8ZM3 16h18M6 20h12'),
  taiga:path('M8 3l-5 8h3l-4 6h12l-4-6h3ZM8 17v4M17 6l-4 6h2l-2 5h8l-3-5h2ZM17 17v4'),
  tundra:path('M2 20 10 4l5 10 3-5 4 11ZM7 10l3 2 3-2M15 17l3 1 2-1'),
  desert:path('M12 21V4a2 2 0 0 1 4 0v17M12 14H7V8M16 10h4V6M3 22h19'),
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
