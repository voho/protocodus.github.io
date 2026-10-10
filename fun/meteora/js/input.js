/* Meteora — the DOM side of the controls.

   Keyboard only, so there is no pointer lock to ask for and nothing that
   can swallow a click: the menus keep the mouse, the ship gets the keys.
   While flying, the game's keys are kept from the browser (Space would
   scroll, Alt would open the menu bar on some systems, the arrows would
   scroll). Esc, the window losing focus and the tab being hidden all pause,
   and each drops every held key on the way. */

import { dropAll, keyDown, keyUp } from './controls.js';

export const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyP', 'KeyL', 'KeyX', 'KeyZ',
  'KeyT', 'KeyV', 'Space', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput(state, { isFlying, onPause, onResume }, env = globalThis) {
  const { window: win, document: doc } = env;
  const lose = reason => { dropAll(state); onPause(reason); };

  win.addEventListener('keydown', e => {
    // Esc toggles: it pauses while flying and resumes from the pause screen.
    // The check happens before the pause, so one press never does both.
    if (!isFlying()) {
      if (e.code === 'Escape' && !e.repeat) onResume?.('escape');
      return;
    }
    if (e.code === 'Escape') { lose('escape'); return; }
    if (GAME_KEYS.has(e.code)) { e.preventDefault(); keyDown(state, e.code, e.repeat); }
  });
  // Releases always count, flying or not, so nothing stays held across a pause.
  win.addEventListener('keyup', e => {
    keyUp(state, e.code);
    if (isFlying() && GAME_KEYS.has(e.code)) e.preventDefault?.();
  });
  win.addEventListener('blur', () => lose('blur'));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) lose('hidden'); });
}
