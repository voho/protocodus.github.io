/* Meteora — the controls guide shown on the menu, the pause screen, the
   codex and the settings.

   One list, rendered everywhere. Keyboard rows name the actions they
   describe; the caps printed for them come from the player's current keys
   (`capsFor`), so a rebound key shows as it is. Mouse rows say which part
   of the mouse they mean. keys-check.mjs keeps this list and the actions
   in controls.js describing the same controls. */

import { DEFAULT_KEYS } from './controls.js';

const NAMED = {
  Tab: 'Tab', Space: 'Space', Enter: 'Enter', Backspace: '⌫', CapsLock: 'Caps', Escape: 'Esc',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Cmd', MetaRight: 'R Cmd',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
/* A key code as printed on its cap. */
export function capOf(code) {
  if (!code) return '—';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return NAMED[code] ?? code;
}

export const KEY_GUIDE = [
  {
    title: 'Mouse',
    items: [
      { caps: ['Mouse'], mouse: 'aim', label: 'Steer and aim' },
      { caps: ['Left click'], mouse: 'left', label: 'Guns' },
      { caps: ['Right click'], mouse: 'right', label: 'Secondary (lock first)' },
    ],
  },
  {
    title: 'Flight',
    items: [
      { actions: ['faster', 'slower'], label: 'Speed up / slow down' },
      { actions: ['strafeLeft', 'strafeRight'], label: 'Strafe left / right' },
      { actions: ['rollLeft', 'rollRight'], label: 'Roll left / right' },
      { actions: ['boost'], label: 'Afterburner (hold)' },
      { actions: ['toggleSpeedLock'], label: 'Match the target\'s speed' },
      { actions: ['toggleCamera'], label: 'Chase / cockpit view' },
    ],
  },
  {
    title: 'Targets',
    items: [
      { actions: ['cycleTarget'], label: 'Next hostile' },
      { actions: ['cycleFriendly'], label: 'Next friendly' },
      { actions: ['targetTorpedo'], label: 'Nearest incoming torpedo' },
      { actions: ['cycleSub'], label: 'Next subsystem' },
      { actions: ['cycleNav'], label: 'Next nav point' },
    ],
  },
  {
    title: 'Ship and wing',
    items: [
      { actions: ['cycleBank'], label: 'Switch secondary bank' },
      { actions: ['equalize'], label: 'Level the shields' },
      { actions: ['repair'], label: 'Call a Tender (below half hull)' },
      { actions: ['wingAttack', 'wingCover', 'wingForm'], label: 'Wing: attack / cover / form up' },
      { caps: ['Esc'], label: 'Pause' },
    ],
  },
];
/* The caps a guide row shows with the player's keys. */
export const capsFor = (item, keys = DEFAULT_KEYS) => item.caps ?? item.actions.map(a => capOf(keys[a]));

/* A gamepad with the standard (Xbox) layout; see readPad in controls.js. */
export const PAD_GUIDE = {
  title: 'Gamepad',
  items: [
    { caps: ['L stick'], label: 'Steer and aim' },
    { caps: ['R stick'], label: 'Roll and speed' },
    { caps: ['RT', 'LT'], label: 'Guns / secondary' },
    { caps: ['A'], label: 'Afterburner (hold)' },
    { caps: ['B'], label: 'Match speed' },
    { caps: ['X', 'Y'], label: 'Next hostile / torpedo' },
    { caps: ['LB', 'RB'], label: 'Switch bank / next subsystem' },
    { caps: ['L3', 'R3'], label: 'Level shields / Tender' },
    { caps: ['D-pad'], label: 'Wing orders; ← next nav' },
    { caps: ['View', 'Menu'], label: 'View; pause' },
  ],
};
