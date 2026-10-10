/* Meteora — the keyboard to flight controls, with no DOM in sight.

   Keyboard only:
     W / S        nose up / down          Space   fire the selected weapon
     A / D        nose left / right       Alt     cannons ⇄ missiles
     Q / E        roll left / right       Shift   afterburner
     P / L        throttle up / down      X       throttle to zero
     ← → ↑ ↓      strafe and lift         Z       flight assist on / off
     T target · V camera · M mute · Esc pause (the last handled in input.js)

   A key is all or nothing, which is no good for aiming, so the steering
   keys ramp: a tap asks for about a third of the turn rate and a key held
   for half a second asks for all of it. Small corrections and hard turns
   both come from the same four keys.

   Keys that act once per press (flight assist, weapon switch, targeting,
   camera, a missile) go through `pressed` and are consumed when read;
   browser key repeat never re-fires them. `dropAll` exists for the one
   failure every browser game meets: the window loses focus while a key is
   down, the keyup goes elsewhere, and the ship flies on with the key stuck. */

const TAP = 0.32, RAMP = 1.4;   // command = TAP + RAMP·held seconds, up to 1
const ONCE = new Set(['KeyZ', 'KeyT', 'KeyV', 'KeyM', 'AltLeft', 'AltRight']);

export function createControlState(settings) {
  return {
    settings, held: new Set(), pressed: new Set(),
    weapon: 'cannon', heldFor: { pitch: 0, yaw: 0, roll: 0 },
  };
}

export function keyDown(state, code, repeat = false) {
  if (ONCE.has(code)) { if (!repeat) state.pressed.add(code); return; }
  if (code === 'Space' && !repeat && !state.held.has('Space')) state.pressed.add('Trigger');
  state.held.add(code);
}
const AXIS_OF = { KeyW: 'pitch', KeyS: 'pitch', KeyA: 'yaw', KeyD: 'yaw', KeyQ: 'roll', KeyE: 'roll' };
export function keyUp(state, code) {
  state.held.delete(code);
  // A release ends the ramp even if no frame read the key in between, so a
  // quick double-tap is two gentle nudges, not one long turn.
  if (AXIS_OF[code]) state.heldFor[AXIS_OF[code]] = 0;
}

export function dropAll(state) {
  state.held.clear();
  state.pressed.clear();
  state.heldFor.pitch = 0; state.heldFor.yaw = 0; state.heldFor.roll = 0;
}

const axis = (state, plus, minus) =>
  (plus.some(k => state.held.has(k)) ? 1 : 0) - (minus.some(k => state.held.has(k)) ? 1 : 0);

function ramped(state, name, direction, dt) {
  if (direction === 0) { state.heldFor[name] = 0; return 0; }
  const command = direction * Math.min(1, TAP + RAMP * state.heldFor[name]);
  state.heldFor[name] += dt;
  return command;
}

export function readInput(state, dt) {
  const h = state.held, take = code => state.pressed.delete(code);
  const switched = take('AltLeft') | take('AltRight');
  if (switched) state.weapon = state.weapon === 'cannon' ? 'missile' : 'cannon';
  const trigger = take('Trigger');
  const invert = state.settings.invertPitch ? -1 : 1;
  return {
    pitch: ramped(state, 'pitch', axis(state, ['KeyW'], ['KeyS']) * invert, dt),
    yaw: ramped(state, 'yaw', axis(state, ['KeyD'], ['KeyA']), dt),
    roll: ramped(state, 'roll', axis(state, ['KeyE'], ['KeyQ']), dt),
    strafe: axis(state, ['ArrowRight'], ['ArrowLeft']),
    lift: axis(state, ['ArrowUp'], ['ArrowDown']),
    throttleDelta: axis(state, ['KeyP'], ['KeyL']),
    throttleSet: null,
    throttleZero: h.has('KeyX'),
    boost: h.has('ShiftLeft') || h.has('ShiftRight'),
    toggleFA: take('KeyZ'),
    weapon: state.weapon,
    switchedWeapon: !!switched,
    fire: state.weapon === 'cannon' && h.has('Space'),
    missile: state.weapon === 'missile' && trigger,
    cycleTarget: take('KeyT'),
    toggleCamera: take('KeyV'),
    mute: take('KeyM'),
  };
}
