/* Hedgerow — keyboard and mouse. Pointer lock while playing; mouse deltas
   accumulate between frames; edge-triggered presses are kept until read. */

export function createInput(canvas) {
  const down = new Set();
  const pressed = new Set();
  const released = new Set();
  let dx = 0, dy = 0, wheel = 0;
  let mouseL = false, mouseR = false, mouseLPressed = false;
  let locked = false;
  let enabled = false;
  const listeners = { lock: [], unlock: [] };

  const keyName = (e) => {
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') return 'Control';
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
    return e.code;
  };

  window.addEventListener('keydown', (e) => {
    if (!enabled) return;
    const k = keyName(e);
    if (!down.has(k)) pressed.add(k);
    down.add(k);
    if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Control'].includes(k) || k.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = keyName(e);
    down.delete(k);
    released.add(k);
  });
  window.addEventListener('blur', () => { down.clear(); mouseL = mouseR = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!enabled) return;
    if (!locked) { requestLock(); return; }
    if (e.button === 0) { mouseL = true; mouseLPressed = true; }
    if (e.button === 2) mouseR = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseL = false;
    if (e.button === 2) mouseR = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    // guard against the occasional huge first delta after locking
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    dx += e.movementX; dy += e.movementY;
  });
  window.addEventListener('wheel', (e) => { if (locked) wheel += Math.sign(e.deltaY); }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    const now = document.pointerLockElement === canvas;
    if (now === locked) return;
    locked = now;
    if (!locked) { mouseL = mouseR = false; down.clear(); }
    for (const f of listeners[locked ? 'lock' : 'unlock']) f();
  });

  function requestLock() {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch { canvas.requestPointerLock(); }
  }

  return {
    get locked() { return locked; },
    get mouseL() { return mouseL; },
    get mouseR() { return mouseR; },
    enable(on) { enabled = on; if (!on) { down.clear(); mouseL = mouseR = false; } },
    requestLock,
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    on(ev, f) { listeners[ev].push(f); },
    held: (k) => down.has(k),
    pressed: (k) => pressed.has(k),
    released: (k) => released.has(k),
    fired() { const v = mouseLPressed; return v; },
    consumeMouse() { const r = [dx, dy]; dx = 0; dy = 0; return r; },
    consumeWheel() { const w = wheel; wheel = 0; return w; },
    endFrame() { pressed.clear(); released.clear(); mouseLPressed = false; },
    // for scripted tests (?debug): buttons without a real mouse
    test: { click() { mouseLPressed = true; }, hold(v) { mouseL = v; }, aim(v) { mouseR = v; } },
  };
}
