// The design tokens of DESIGN.md 4 for canvas drawing and JS, the same values as tokens.css (tests/design-tokens.test.mjs
// keeps the two in step). DOM-free: renderer.js and model.js may import it.
export const COLORS = Object.freeze({
  paper: '#F7F6EF', well: '#EEEFE5', rule: '#DDE0D3', edge: '#7F8A80', ink: '#1E3228', ink2: '#56665B', ink3: '#8B958B',
  onInk: '#F7F6EF', onInk2: '#B9C4B5', signal: '#E17B4A', signalInk: '#A94B1A', focus: '#B5501F', scrim: 'rgb(15 27 21 / .35)',
});

// A state is a glyph and a word in its colour: on paper, and on ink surfaces.
export const STATES = Object.freeze({
  ok: Object.freeze({ color: '#2F7A4B', onInk: '#8FD1A6' }),
  warn: Object.freeze({ color: '#8A5A00', onInk: '#F2C14E' }),
  error: Object.freeze({ color: '#B03A2A', onInk: '#F4A08C' }),
  paused: Object.freeze({ color: COLORS.ink2, onInk: COLORS.onInk2 }),
  info: Object.freeze({ color: COLORS.ink, onInk: COLORS.onInk }),
});

// Nine route line colours, deep and light in turn; `on` colours the numerals and the map edge.
export const LINE_COLORS = Object.freeze([
  ['Cobalt', '#2D5DA8', '#FFFFFF'], ['Marigold', '#EFC16F', COLORS.ink], ['Crimson', '#B8323F', '#FFFFFF'],
  ['Cornflower', '#88AEE4', COLORS.ink], ['Plum', '#833D86', '#FFFFFF'], ['Heather', '#D893B1', COLORS.ink],
  ['Umber', '#8A5A1C', '#FFFFFF'], ['Iris', '#A99BE0', COLORS.ink], ['Graphite', '#4C5761', '#FFFFFF'],
].map(([name, fill, on]) => Object.freeze({ name, fill, on })));

export const TIERS = Object.freeze({ bronze: '#B7794A', silver: '#A3ACAF', gold: '#D6A93C', platinum: '#C9D3D6' });

// One family; sizes and line heights in px; 700 only for bullet numerals and the wordmark.
export const FONT = Object.freeze({
  family: 'Space,system-ui,sans-serif',
  size: Object.freeze({ caption: 12, small: 13, body: 14, lead: 16, title: 18, display: 22, hero: 32 }),
  line: Object.freeze({ caption: 16, small: 18, body: 20, lead: 22, title: 24, display: 28, hero: 36 }),
  weight: Object.freeze({ regular: 400, medium: 500, semibold: 600, bold: 700 }),
  tracking: Object.freeze({ tight: '-0.01em', hero: '-0.02em' }),
});

// UI drawn on the map (DESIGN.md 4.4 and 9). Alphas apply to the colour they sit beside.
export const MAP = Object.freeze({
  nameplate: Object.freeze({ fill: COLORS.paper, fillAlpha: .94, edge: COLORS.ink, edgeAlpha: .14, radius: 4, name: Object.freeze({ size: 13, weight: 600 }), regionName: Object.freeze({ size: 12, weight: 600 }), population: Object.freeze({ size: 12, weight: 500, color: COLORS.ink2 }) }),
  roundel: Object.freeze({ fill: COLORS.paper, ring: COLORS.ink, ringWidth: 2.5, size: 10, unusedRing: COLORS.edge }),
  locator: Object.freeze({ color: COLORS.signal, width: 2.5, casing: COLORS.paper, casingWidth: 5, fadeMs: 120 }),
  selection: Object.freeze({ color: COLORS.signal, width: 2.5, casing: COLORS.paper, casingWidth: 5, tag: COLORS.ink, tagText: COLORS.onInk }),
  cursor: Object.freeze({ color: COLORS.signal, casing: COLORS.paper, dash: Object.freeze([6, 4]) }),
  hover: Object.freeze({ color: COLORS.paper, alpha: .85, width: 1.5 }),
  reach: Object.freeze({ color: COLORS.paper, casing: COLORS.ink, casingAlpha: .35, dash: Object.freeze([6, 5]) }),
  cut: Object.freeze({ color: STATES.error.color }),
  bullet: Object.freeze({ numeral: Object.freeze({ size: 12, weight: 700 }), size: 20, small: 16, lightEdge: COLORS.ink, lightEdgeAlpha: .35 }),
  line: Object.freeze({ core: Object.freeze({ region: 3, town: 3.5, detail: 4.5 }), emphasis: 1.5, dim: .35, halo: 3, haloAlpha: .9, casing: 2.5, casingAlpha: .55, pausedAlpha: .45, chevronGap: 44 }),
});

// A token colour with an alpha, for canvas fill and stroke styles.
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
