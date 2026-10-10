/* Meteora — the DOM side of the controls.

   Wires keyboard, mouse and pointer lock into the pure state in
   controls.js. The mouse aims, and it does so in one of two modes:

     locked  pointer lock is held: raw mouse movement moves the aim cursor,
             which can never leave the screen or the window
     cursor  no lock (refused, unsupported or not granted yet): the
             pointer's place on screen is the aim cursor

   Nothing waits on pointer lock or trusts what the request returns: Chrome
   hands back a promise that settles once locked, Safari returns nothing and
   locks a moment later, and a refused lock only fires `pointerlockerror`.
   Reading the request's result once paused the game in Safari before the
   lock even arrived, and the late lock then swallowed the clicks meant for
   the pause screen. So `pointerlockchange` alone decides the mode, and the
   game flies either way.

   Only real interruptions pause: a held lock being lost (which is how Esc
   arrives while locked), Esc without a lock, the window losing focus and
   the tab being hidden. Each drops every held input. Esc on the pause
   screen resumes. */

import { dropAll, keyDown, keyUp, mouseDown, mouseUp, moveCursor, setCursor } from './controls.js';

export const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyX', 'KeyZ',
  'KeyT', 'KeyV', 'Space', 'ShiftLeft', 'ShiftRight',
]);

export function createInput(canvas, state, { isFlying, onPause, onResume }, env = globalThis) {
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

  doc.addEventListener('mousemove', e => {
    if (!isFlying()) return;
    const rect = canvas.getBoundingClientRect();
    const hw = rect.width / 2 || 1, hh = rect.height / 2 || 1;
    // Locked or not, the drawn aim cursor tracks the mouse pixel for pixel.
    if (locked()) moveCursor(state, e.movementX / hw, e.movementY / hh);
    else setCursor(state, (e.clientX - rect.left - hw) / hw, (e.clientY - rect.top - hh) / hh);
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
