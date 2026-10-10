/* Meteora — mouse and keyboard to flight controls, with no DOM in sight.

   The mouse aims: an aim cursor lives on the screen (in normalised screen
   coordinates, x right and y down, each −1…1), and the ship flies toward
   wherever it points — the farther from the centre, the harder it turns.
   The keyboard flies everything else:

     W / S   speed up / slow down       Shift   afterburner
     A / D   slide left / right         X       full stop
     Q / E   roll left / right          Z       flight assist on / off
     R / F   thrust up / down           T       cycle targets
     left mouse or Space  cannons       V       chase / nose camera
     right mouse          missile       Esc     pause (handled in input.js)

   Roll is the one keyboard rotation left, and it ramps: a tap asks for about
   a third of the roll rate and a key held half a second asks for all of it.

   Edge-triggered actions (flight assist, targeting, camera, a missile) go
   through `pressed` and are consumed when read; key repeat never re-fires
   them. `dropAll` exists for the one failure every browser game meets: the
   window loses focus while a key is down, the keyup goes elsewhere, and the
   ship flies on with the key stuck. It also centres the aim, so a paused
   ship does not resume in a hard turn. */

const TAP = 0.32, RAMP = 1.4;   // roll command = TAP + RAMP·held seconds, up to 1
const ONCE = new Set(['KeyZ', 'KeyT', 'KeyV']);
const clamp1 = x => Math.max(-1, Math.min(1, x));

export function createControlState(settings) {
  return {
    settings, held: new Set(), pressed: new Set(),
    mouse: { left: false, right: false }, cursor: [0, 0], rollHeld: 0,
  };
}

export function keyDown(state, code, repeat = false) {
  if (ONCE.has(code)) { if (!repeat) state.pressed.add(code); return; }
  state.held.add(code);
}
export function keyUp(state, code) {
  state.held.delete(code);
  if (code === 'KeyQ' || code === 'KeyE') state.rollHeld = 0;
}

export function mouseDown(state, button) {
  if (button === 0) state.mouse.left = true;
  if (button === 2) { if (!state.mouse.right) state.pressed.add('Missile'); state.mouse.right = true; }
}
export function mouseUp(state, button) {
  if (button === 0) state.mouse.left = false;
  if (button === 2) state.mouse.right = false;
}

// Absolute (the pointer's place on screen) and relative (pointer lock).
export function setCursor(state, x, y) { state.cursor[0] = clamp1(x); state.cursor[1] = clamp1(y); }
export function moveCursor(state, dx, dy) { setCursor(state, state.cursor[0] + dx, state.cursor[1] + dy); }

export function dropAll(state) {
  state.held.clear();
  state.pressed.clear();
  state.mouse.left = false;
  state.mouse.right = false;
  state.cursor[0] = 0; state.cursor[1] = 0;
  state.rollHeld = 0;
}

const axis = (state, plus, minus) =>
  (plus.some(k => state.held.has(k)) ? 1 : 0) - (minus.some(k => state.held.has(k)) ? 1 : 0);

export function readInput(state, dt) {
  const h = state.held, take = code => state.pressed.delete(code);
  const direction = axis(state, ['KeyE'], ['KeyQ']);
  let roll = 0;
  if (direction === 0) state.rollHeld = 0;
  else { roll = direction * Math.min(1, TAP + RAMP * state.rollHeld); state.rollHeld += dt; }
  const invert = state.settings.invertPitch ? -1 : 1;
  return {
    cursor: [state.cursor[0], state.cursor[1] * invert],
    pitch: 0, yaw: 0, roll,
    strafe: axis(state, ['KeyD'], ['KeyA']),
    lift: axis(state, ['KeyR'], ['KeyF']),
    throttleDelta: axis(state, ['KeyW'], ['KeyS']),
    throttleSet: null,
    throttleZero: h.has('KeyX'),
    boost: h.has('ShiftLeft') || h.has('ShiftRight'),
    toggleFA: take('KeyZ'),
    fire: state.mouse.left || h.has('Space'),
    missile: take('Missile'),
    cycleTarget: take('KeyT'),
    toggleCamera: take('KeyV'),
  };
}
