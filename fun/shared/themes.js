/* A puzzle link also identifies its scenery. Keep colours bright enough for
   dark ink on placed patches, and clues readable on the empty table. */
import { hashSeed } from './rng.js';

export const WORLDS = [
  { id: 'aurora', name: 'Aurora', accent: '#8ce8ce', secondary: '#aa96ff', top: '#152d3d', bottom: '#040b13', tileA: '#163744', tileB: '#342652', plinth: '#0c1b2b', wall: '#ffdb83', clue: '#effff9', motif: 0,
    palette: ['#83e3c7', '#b6a0fa', '#90c7ff', '#ffe399', '#f8abc5', '#a6e9ea', '#c5df9c', '#ffbd99'] },
  { id: 'coral', name: 'Coral reef', accent: '#ffb19c', secondary: '#6be1de', top: '#20333d', bottom: '#100d20', tileA: '#294350', tileB: '#533043', plinth: '#1f1b31', wall: '#8ef1e6', clue: '#fff0e4', motif: 1,
    palette: ['#ffa58f', '#78ddd3', '#ffc878', '#b6b6fc', '#f5a6c8', '#a5df9b', '#a3d8ef', '#f4dc98'] },
  { id: 'sakura', name: 'Sakura dusk', accent: '#fbb5d5', secondary: '#d8b5ff', top: '#3b243e', bottom: '#120b1b', tileA: '#4b2c49', tileB: '#2e355c', plinth: '#281b34', wall: '#ffdc9d', clue: '#fff1f8', motif: 2,
    palette: ['#f8b0cf', '#c2aff5', '#9ddce2', '#f4d493', '#c6dfa5', '#ecb2f1', '#ffbea6', '#b8cfff'] },
  { id: 'dunes', name: 'Amber dunes', accent: '#f5d28d', secondary: '#f5a18b', top: '#3b2c31', bottom: '#15101b', tileA: '#494039', tileB: '#4d2d42', plinth: '#271d29', wall: '#b3e9e3', clue: '#fff3d5', motif: 3,
    palette: ['#f5d18c', '#f4af91', '#b5d7ae', '#96d8d6', '#d4b3f0', '#f0b8ce', '#b7cafa', '#e5dda8'] },
  { id: 'lagoon', name: 'Moonlit lagoon', accent: '#9ed7ff', secondary: '#90eed9', top: '#152e49', bottom: '#050d21', tileA: '#1b4055', tileB: '#34335d', plinth: '#101e35', wall: '#ffc6b7', clue: '#e4f6ff', motif: 4,
    palette: ['#9dcfff', '#8ee0d4', '#c3b9ff', '#f1c58f', '#f0b5dc', '#b6e7a9', '#b2e9f0', '#ecccae'] },
  { id: 'grove', name: 'Firefly grove', accent: '#c0e99d', secondary: '#7fdbcf', top: '#21392e', bottom: '#091410', tileA: '#2b473d', tileB: '#303d50', plinth: '#14271f', wall: '#f8c4a6', clue: '#f2ffe4', motif: 5,
    palette: ['#b9e493', '#86dcca', '#f1d18d', '#b0bdf4', '#f0b1b5', '#a6dbef', '#e2c3ef', '#dbdfa3'] },
];

export function themeFor(seed, game = 'zipper') {
  return WORLDS[hashSeed(`${game}:${seed}`) % WORLDS.length];
}

/* Local calendar dates make the daily board change at the player's midnight. */
export function dailySeed(date = new Date()) {
  return `day${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
