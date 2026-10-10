/* Meteora — the key guide shown while loading and while paused.

   One list, rendered on both screens. `codes` are the KeyboardEvent codes
   the game binds, `caps` what is printed on the keycaps; keys-check.mjs
   keeps this list and input.js's bindings describing the same keyboard. */

export const KEY_GUIDE = [
  {
    title: 'Flight',
    items: [
      { caps: ['W', 'S'], codes: ['KeyW', 'KeyS'], label: 'Nose up / down' },
      { caps: ['A', 'D'], codes: ['KeyA', 'KeyD'], label: 'Nose left / right' },
      { caps: ['Q', 'E'], codes: ['KeyQ', 'KeyE'], label: 'Roll left / right' },
      { caps: ['P', 'L'], codes: ['KeyP', 'KeyL'], label: 'Speed up / slow down' },
      { caps: ['Shift'], codes: ['ShiftLeft', 'ShiftRight'], label: 'Afterburner' },
      { caps: ['X'], codes: ['KeyX'], label: 'Full stop' },
      { caps: ['←', '→', '↑', '↓'], codes: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], label: 'Strafe and lift' },
    ],
  },
  {
    title: 'Combat',
    items: [
      { caps: ['Space'], codes: ['Space'], label: 'Fire' },
      { caps: ['Alt'], codes: ['AltLeft', 'AltRight'], label: 'Cannons ⇄ missiles' },
      { caps: ['T'], codes: ['KeyT'], label: 'Cycle targets' },
    ],
  },
  {
    title: 'Ship',
    items: [
      { caps: ['Z'], codes: ['KeyZ'], label: 'Flight assist on / off' },
      { caps: ['V'], codes: ['KeyV'], label: 'Chase / nose camera' },
      { caps: ['Esc'], codes: ['Escape'], label: 'Pause and this guide' },
    ],
  },
];
