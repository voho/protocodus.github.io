/* Meteora — keyboard and mouse to flight controls, with no DOM in sight.

   The mouse is a virtual joystick: movement accumulates a cursor inside a
   unit ring, and the cursor's offset from centre is the rate the pilot asks
   for in pitch and yaw. Holding the cursor off-centre keeps turning, the
   way a stick held over does, which is what makes fine aim possible at the
   same time as hard manoeuvres.

   Keys that are held (throttle, strafe, boost) live in `held`; keys that act
   once per press (flight assist, targeting, camera) go through `pressed`
   and are consumed when read. Browser key repeat never re-fires them.

   `dropAll` exists for the one failure every browser game meets: the window
   loses focus while a key is down, the keyup goes to another app, and the
   ship flies on with the throttle stuck. Blur, a hidden tab and a lost
   pointer lock all call it. */

const DEADZONE = 0.06;
const MOUSE_SCALE = 0.0025;

export function createControlState(settings) {
  return { held: new Set(), mouse: { left: false, right: false }, cursor: [0, 0], pressed: new Set(), settings };
}

const ONCE = new Set(['KeyZ', 'KeyT', 'KeyV', 'KeyM', 'Escape']);

export function keyDown(state, code, repeat = false) {
  if (ONCE.has(code)) { if (!repeat) state.pressed.add(code); return; }
  state.held.add(code);
}
export function keyUp(state, code) { state.held.delete(code); }

export function mouseDown(state, button) {
  if (button === 0) state.mouse.left = true;
  if (button === 2) { state.mouse.right = true; state.pressed.add('Missile'); }
}
export function mouseUp(state, button) {
  if (button === 0) state.mouse.left = false;
  if (button === 2) state.mouse.right = false;
}

export function mouseMove(state, dx, dy) {
  const s = (state.settings.sensitivity ?? 1) * MOUSE_SCALE;
  state.cursor[0] += dx * s;
  state.cursor[1] += dy * s;
  const r = Math.hypot(state.cursor[0], state.cursor[1]);
  if (r > 1) { state.cursor[0] /= r; state.cursor[1] /= r; }
}

// Cursor mode (no pointer lock): the stick is where the pointer is, in the
// same unit ring, measured from the middle of the screen.
export function setCursor(state, x, y) {
  const r = Math.hypot(x, y);
  state.cursor[0] = r > 1 ? x / r : x;
  state.cursor[1] = r > 1 ? y / r : y;
}

export function recentre(state) { state.cursor[0] = 0; state.cursor[1] = 0; }

export function dropAll(state) {
  state.held.clear();
  state.pressed.clear();
  state.mouse.left = false;
  state.mouse.right = false;
  recentre(state);
}

const axis = (state, plus, minus) =>
  (plus.some(k => state.held.has(k)) ? 1 : 0) - (minus.some(k => state.held.has(k)) ? 1 : 0);

export function readInput(state) {
  const h = state.held, take = code => state.pressed.delete(code);
  const r = Math.hypot(state.cursor[0], state.cursor[1]);
  const gain = r < DEADZONE ? 0 : (r - DEADZONE) / (1 - DEADZONE) / r;
  const invert = state.settings.invertPitch ? -1 : 1;
  return {
    pitch: -state.cursor[1] * gain * invert || 0,
    yaw: state.cursor[0] * gain || 0,
    roll: axis(state, ['KeyE'], ['KeyQ']),
    strafe: axis(state, ['KeyD'], ['KeyA']),
    lift: axis(state, ['KeyR', 'Space'], ['KeyF', 'KeyC']),
    throttleDelta: axis(state, ['KeyW'], ['KeyS']),
    throttleSet: null,
    throttleZero: h.has('KeyX'),
    boost: h.has('ShiftLeft') || h.has('ShiftRight'),
    toggleFA: take('KeyZ'),
    fire: state.mouse.left,
    missile: take('Missile'),
    cycleTarget: take('KeyT'),
    toggleCamera: take('KeyV'),
    mute: take('KeyM'),
    pause: take('Escape'),
  };
}
