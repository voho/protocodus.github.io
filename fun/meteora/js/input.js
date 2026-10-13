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
   screen resumes.

   A gamepad has no events worth waiting for, so `pollPad` reads it once a
   frame: in flight through `readPad` (Menu pauses), in the menus as a
   remote — the d-pad moves between the buttons (left and right move a
   slider or a choice), A presses, B and Menu do what Esc does. */

import { dropAll, isBound, keyDown, keyUp, mouseDown, mouseUp, moveCursor, readPad, setCursor } from './controls.js';

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
    // A bound key is kept from the browser while flying (Tab burns instead
    // of moving focus).
    if (isBound(state, e.code)) { e.preventDefault(); keyDown(state, e.code, e.repeat); }
  });
  // Releases always count, flying or not, so nothing stays held across a pause.
  win.addEventListener('keyup', e => {
    keyUp(state, e.code);
    if (isFlying() && isBound(state, e.code)) e.preventDefault?.();
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

  // The first pad with the standard mapping (or any, failing that).
  const firstPad = () => {
    const pads = [...(env.navigator?.getGamepads?.() ?? [])].filter(p => p?.connected);
    return pads.find(p => p.mapping === 'standard') ?? pads[0] ?? null;
  };
  let menuPrev = [];
  const focusables = () => [...doc.querySelectorAll('.screen.on button, .screen.on select, .screen.on input')]
    .filter(e => !e.disabled && !e.hidden && e.offsetParent !== null);
  const focusStep = dir => {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(doc.activeElement);
    list[i < 0 ? 0 : (i + dir + list.length) % list.length].focus();
  };
  const nudge = dir => {
    const el = doc.activeElement;
    if (el?.type === 'range') { dir > 0 ? el.stepUp() : el.stepDown(); el.dispatchEvent(new win.Event('input')); }
    else if (el?.tagName === 'SELECT') {
      el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
      el.dispatchEvent(new win.Event('change'));
    } else focusStep(dir);
  };
  const escape = () => win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));

  return {
    engage,
    locked,
    get mode() { return mode; },
    release() { if (locked()) doc.exitPointerLock(); },
    pollPad() {
      const pad = firstPad();
      if (!pad) return;
      const edge = i => !!pad.buttons[i]?.pressed && !menuPrev[i];
      if (isFlying()) {
        if (readPad(state, pad).pause) lose('pad');
      } else {
        if (edge(12)) focusStep(-1);
        if (edge(13)) focusStep(1);
        if (edge(14)) nudge(-1);
        if (edge(15)) nudge(1);
        if (edge(0)) doc.activeElement?.click?.();
        if (edge(1) || edge(9)) escape();
      }
      menuPrev = pad.buttons.map(b => !!b.pressed);
    },
  };
}
