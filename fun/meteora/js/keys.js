/* Meteora — the controls guide shown while loading and while paused.

   One list, rendered on both screens. `codes` are the KeyboardEvent codes
   the game binds and `caps` what is printed on the keycaps; mouse rows say
   which part of the mouse they mean. keys-check.mjs keeps this list and
   input.js's bindings describing the same controls. */

export const KEY_GUIDE = [
  {
    title: 'Aim and fire',
    items: [
      { caps: ['Mouse'], codes: [], mouse: 'aim', label: 'Aim: the ship turns toward the crosshair' },
      { caps: ['Left click'], codes: [], mouse: 'left', label: 'Cannons' },
      { caps: ['Space'], codes: ['Space'], label: 'Cannons (keyboard)' },
      { caps: ['Right click'], codes: [], mouse: 'right', label: 'Missile' },
      { caps: ['T'], codes: ['KeyT'], label: 'Cycle targets' },
    ],
  },
  {
    title: 'Flight',
    items: [
      { caps: ['W', 'S'], codes: ['KeyW', 'KeyS'], label: 'Speed up / slow down' },
      { caps: ['A', 'D'], codes: ['KeyA', 'KeyD'], label: 'Slide left / right' },
      { caps: ['Q', 'E'], codes: ['KeyQ', 'KeyE'], label: 'Roll left / right' },
      { caps: ['R', 'F'], codes: ['KeyR', 'KeyF'], label: 'Thrust up / down' },
      { caps: ['Shift'], codes: ['ShiftLeft', 'ShiftRight'], label: 'Afterburner' },
      { caps: ['X'], codes: ['KeyX'], label: 'Full stop' },
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
