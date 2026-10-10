/* Meteora — the DOM side of the controls.

   Wires keyboard, mouse and pointer lock into the pure state in
   controls.js. Steering is best with pointer lock (raw mouse movement, the
   cursor never hits a screen edge), but nothing waits for it or trusts what
   the request returns: Chrome hands back a promise that settles once
   locked, Safari returns nothing and locks a moment later, and a refused
   lock only fires `pointerlockerror`. Reading the request's result once
   paused the game in Safari before the lock even arrived, and the lock then
   swallowed the clicks meant for the pause screen.

   So the game flies as soon as it is launched, and `pointerlockchange`
   alone says which mode it is in:

     locked  relative mouse movement drives the virtual stick
     cursor  no lock (refused, unsupported, or not yet granted): the
             pointer's position on screen is the stick

   Only real interruptions pause: a held lock being lost (which is how Esc
   arrives while locked), Esc without a lock, the window losing focus and
   the tab being hidden. Each drops every held input on the way. */

import { dropAll, keyDown, keyUp, mouseDown, mouseMove, mouseUp, setCursor } from './controls.js';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyX', 'KeyZ',
  'KeyT', 'KeyV', 'KeyM', 'Space', 'ShiftLeft', 'ShiftRight',
]);
// Fraction of the shorter screen side that is full stick in cursor mode.
const CURSOR_REACH = 0.4;

export function createInput(canvas, state, { isFlying, onPause }, env = globalThis) {
  const { window: win, document: doc } = env;
  const locked = () => doc.pointerLockElement === canvas;
  let mode = 'cursor';

  const engage = () => {
    if (!canvas.requestPointerLock || locked()) return;
    const plain = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* cursor mode */ } };
    try {
      const pending = canvas.requestPointerLock({ unadjustedMovement: true });
      // Raw movement is not offered everywhere; ask again without it.
      pending?.catch?.(error => { if (error?.name === 'NotSupportedError') plain(); });
    } catch { plain(); }
  };
  const lose = reason => { dropAll(state); onPause(reason); };

  doc.addEventListener('pointerlockchange', () => {
    if (locked()) { mode = 'locked'; return; }
    if (mode === 'locked') { mode = 'cursor'; lose('lock'); }
  });
  doc.addEventListener('pointerlockerror', () => { mode = 'cursor'; });

  win.addEventListener('keydown', e => {
    if (!isFlying()) return;
    if (e.code === 'Escape' && !locked()) { lose('escape'); return; }
    if (GAME_KEYS.has(e.code)) { e.preventDefault?.(); keyDown(state, e.code, e.repeat); }
  });
  win.addEventListener('keyup', e => keyUp(state, e.code));

  doc.addEventListener('mousemove', e => {
    if (locked()) { mouseMove(state, e.movementX, e.movementY); return; }
    if (!isFlying()) return;
    const rect = canvas.getBoundingClientRect();
    const reach = Math.min(rect.width, rect.height) * CURSOR_REACH;
    setCursor(state, (e.clientX - rect.left - rect.width / 2) / reach, (e.clientY - rect.top - rect.height / 2) / reach);
  });
  canvas.addEventListener('mousedown', e => {
    if (!isFlying()) return;
    if (!locked()) engage();
    mouseDown(state, e.button);
  });
  win.addEventListener('mouseup', e => mouseUp(state, e.button));
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  win.addEventListener('blur', () => lose('blur'));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) lose('hidden'); });

  return {
    engage,
    locked,
    get mode() { return mode; },
    release() { if (locked()) doc.exitPointerLock(); },
  };
}
