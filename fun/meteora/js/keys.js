/* Meteora — the controls guide shown while loading and while paused.

   One list, rendered on both screens. `codes` are the KeyboardEvent codes
   the game binds and `caps` what is printed on the keycaps; mouse rows say
   which part of the mouse they mean. keys-check.mjs keeps this list and
   input.js's bindings describing the same controls. */

export const KEY_GUIDE = [
  {
    title: 'Mouse',
    items: [
      { caps: ['Mouse'], codes: [], mouse: 'aim', label: 'Aim: the ship turns toward the crosshair' },
      { caps: ['Left click'], codes: [], mouse: 'left', label: 'Cannons' },
      { caps: ['Right click'], codes: [], mouse: 'right', label: 'Missile (locks on a held target)' },
    ],
  },
  {
    title: 'Flight',
    items: [
      { caps: ['W', 'S'], codes: ['KeyW', 'KeyS'], label: 'Speed up / slow down' },
      { caps: ['Q', 'E'], codes: ['KeyQ', 'KeyE'], label: 'Roll left / right' },
      { caps: ['Tab'], codes: ['Tab'], label: 'Afterburner (hold)' },
    ],
  },
  {
    title: 'Targets',
    items: [
      { caps: ['T'], codes: ['KeyT'], label: 'Cycle targets' },
      { caps: ['Z'], codes: ['KeyZ'], label: 'Match the target\'s speed (W or S lets go)' },
      { caps: ['Esc'], codes: ['Escape'], label: 'Pause and this guide' },
    ],
  },
];
