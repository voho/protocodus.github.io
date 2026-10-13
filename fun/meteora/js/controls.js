/* Meteora — mouse and keyboard to flight controls, with no DOM in sight.

   The mouse aims and fires: an aim cursor lives on the screen (in
   normalised screen coordinates, x right and y down, each −1…1), and the
   ship flies toward wherever it points — the farther from the centre, the
   harder it turns. Left click fires the guns, right click the active
   secondary bank. How the cursor moves depends on two settings:

     sensitivity  how far a mouse movement moves the cursor (0.5–3)
     steering     'direct': the cursor eases back to the centre when the
                  mouse rests, so the ship follows the mouse like a camera
                  and stops turning when you stop; 'stick': it stays where
                  you leave it, a virtual joystick

   The keyboard:

     W / S   speed up / slow down        A / D   strafe left / right
     Q / E   roll left / right           Tab     afterburner (hold)
     T       next hostile                Y       next friendly or objective
     B       nearest torpedo             N       next nav point
     V       next subsystem              Z       match the target's speed
     G       switch secondary bank       X       level the shields
     R       call a Tender               1 2 3   wing: attack / cover / form up
     C       chase or cockpit view       Esc     pause (handled in input.js)

   Roll ramps: a tap asks for about a third of the roll rate and a key held
   half a second asks for all of it.

   A gamepad (the browser's standard mapping, an Xbox layout) is read once a
   frame by `readPad`: the left stick aims (it puts the cursor where it
   points, and back in the middle when let go), the right stick rolls and
   sets the throttle, the triggers fire the guns and the secondary, A burns
   the afterburner, B matches speed, X and Y pick the next hostile and the
   nearest torpedo, the bumpers switch bank and subsystem, the stick clicks
   level the shields and call a Tender, the d-pad gives the wing its orders
   and picks the next nav point, View switches the camera and Menu pauses.
   Mouse and keyboard keep working beside it.

   Every key is bound to an action (`DEFAULT_KEYS`, overridden by the
   player's own in settings.keys; `rebind` takes a change in); held and
   pressed keys are kept as actions, so the rest of the game never sees a
   key code. Edge-triggered actions go through `pressed` and are consumed
   when read; key repeat never re-fires them. `dropAll` exists for the one failure
   every browser game meets: the window loses focus while a key is down,
   the keyup goes elsewhere, and the ship flies on with the key stuck. It
   also centres the aim, so a paused ship does not resume in a hard turn. */

const TAP = 0.32, RAMP = 1.4;   // roll command = TAP + RAMP·held seconds, up to 1

/* What the keyboard does, in the order the settings list it. */
export const ACTIONS = [
  ['faster', 'Speed up'], ['slower', 'Slow down'], ['strafeLeft', 'Strafe left'], ['strafeRight', 'Strafe right'],
  ['rollLeft', 'Roll left'], ['rollRight', 'Roll right'], ['boost', 'Afterburner'],
  ['toggleSpeedLock', 'Match speed'], ['toggleCamera', 'Camera view'],
  ['cycleTarget', 'Next hostile'], ['cycleFriendly', 'Next friendly'], ['targetTorpedo', 'Nearest torpedo'],
  ['cycleSub', 'Next subsystem'], ['cycleNav', 'Next nav point'], ['cycleBank', 'Switch bank'],
  ['equalize', 'Level shields'], ['repair', 'Call a Tender'],
  ['wingAttack', 'Wing: attack'], ['wingCover', 'Wing: cover'], ['wingForm', 'Wing: form up'],
];
export const DEFAULT_KEYS = Object.freeze({
  faster: 'KeyW', slower: 'KeyS', strafeLeft: 'KeyA', strafeRight: 'KeyD', rollLeft: 'KeyQ', rollRight: 'KeyE', boost: 'Tab',
  toggleSpeedLock: 'KeyZ', toggleCamera: 'KeyC', cycleTarget: 'KeyT', cycleFriendly: 'KeyY', targetTorpedo: 'KeyB',
  cycleSub: 'KeyV', cycleNav: 'KeyN', cycleBank: 'KeyG', equalize: 'KeyX', repair: 'KeyR',
  wingAttack: 'Digit1', wingCover: 'Digit2', wingForm: 'Digit3',
});
// Held for as long as the key is down; the rest act once per press.
const HELD = new Set(['faster', 'slower', 'strafeLeft', 'strafeRight', 'rollLeft', 'rollRight', 'boost']);
export const ONCE = ACTIONS.map(([a]) => a).filter(a => !HELD.has(a));
/* The player's keys: the defaults with their own choices on top. */
export const keysOf = settings => ({ ...DEFAULT_KEYS, ...(settings?.keys ?? {}) });
const CENTRE_RATE = 2.6;   // direct steering: the cursor's return to centre, 1/s
const clamp1 = x => Math.max(-1, Math.min(1, x));

// Gamepad buttons (standard mapping) that act like a key press.
export const PAD_ONCE = {
  1: 'toggleSpeedLock', 2: 'cycleTarget', 3: 'targetTorpedo', 4: 'cycleBank', 5: 'cycleSub', 8: 'toggleCamera',
  10: 'equalize', 11: 'repair', 12: 'wingAttack', 15: 'wingCover', 13: 'wingForm', 14: 'cycleNav',
};
export const PAD = { BOOST: 0, LT: 6, RT: 7, MENU: 9 };
const DEAD = 0.15;
// Outside the dead zone, a gentle curve: fine aim near the middle, all of
// it at the rim.
const stick = v => { const a = Math.abs(v); if (a < DEAD) return 0; const k = (a - DEAD) / (1 - DEAD); return Math.sign(v) * (0.35 * k + 0.65 * k * k); };

export function createControlState(settings) {
  const state = {
    // anyPress: some key, button or click went down since the last frame.
    settings, held: new Set(), pressed: new Set(), byCode: new Map(), anyPress: false,
    mouse: { left: false, right: false }, cursor: [0, 0], rollHeld: 0, moved: 0,
    pad: { roll: 0, throttle: 0, fire: false, aiming: false, prev: [] },
  };
  rebind(state);
  return state;
}

/* Read the bindings again (after the player changed them). */
export function rebind(state) {
  state.byCode.clear();
  for (const [action, code] of Object.entries(keysOf(state.settings))) if (code) state.byCode.set(code, action);
  state.held.clear();
}
export const isBound = (state, code) => state.byCode.has(code);

/* One frame of a gamepad: `pad` as navigator.getGamepads() gives it (axes,
   buttons with .pressed and .value). Returns { pause } on Menu's press. */
export function readPad(state, pad) {
  const P = state.pad;
  const down = i => !!pad.buttons[i]?.pressed;
  const value = i => pad.buttons[i]?.value ?? (down(i) ? 1 : 0);
  const edge = i => down(i) && !P.prev[i];
  const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
  const ax = stick(lx), ay = stick(ly);
  if (ax || ay) { place(state, ax, ay, true); P.aiming = true; }
  else if (P.aiming) { place(state, 0, 0, true); P.aiming = false; }
  P.roll = stick(rx);
  P.throttle = -stick(ry);
  P.fire = value(PAD.RT) > 0.3;
  if (value(PAD.LT) > 0.3 && !P.prev[PAD.LT]) state.pressed.add('missile');
  if (down(PAD.BOOST)) state.held.add('boost'); else if (P.prev[PAD.BOOST]) state.held.delete('boost');
  for (const [i, action] of Object.entries(PAD_ONCE)) if (edge(Number(i))) state.pressed.add(action);
  const pause = edge(PAD.MENU);
  if (pad.buttons.some((b, i) => edge(i))) state.anyPress = true;
  P.prev = pad.buttons.map((b, i) => (i === PAD.LT || i === PAD.RT ? (b.value ?? 0) > 0.3 : !!b.pressed));
  return { pause };
}

export function keyDown(state, code, repeat = false) {
  const action = state.byCode.get(code);
  if (!action) return;
  if (HELD.has(action)) state.held.add(action);
  else if (!repeat) state.pressed.add(action);
}
export function keyUp(state, code) {
  const action = state.byCode.get(code);
  if (!action) return;
  state.held.delete(action);
  if (action === 'rollLeft' || action === 'rollRight') state.rollHeld = 0;
}

export function mouseDown(state, button) {
  state.anyPress = true;
  if (button === 0) state.mouse.left = true;
  if (button === 2) { if (!state.mouse.right) state.pressed.add('missile'); state.mouse.right = true; }
  if (button === 1) state.pressed.add('cycleBank');
}
export function mouseUp(state, button) {
  if (button === 0) state.mouse.left = false;
  if (button === 2) state.mouse.right = false;
}

// Absolute (the pointer's place on screen) and relative (pointer lock).
// Direct steering's drift home only makes sense for relative movement: an
// absolute cursor sits where the pointer is, and the pointer does not move
// back by itself.
const place = (state, x, y, absolute) => {
  state.cursor[0] = clamp1(x); state.cursor[1] = clamp1(y); state.moved = 0; state.absolute = absolute;
};
export function setCursor(state, x, y) { place(state, x, y, true); }
export function moveCursor(state, dx, dy) {
  const k = state.settings.sensitivity ?? 1.6;
  place(state, state.cursor[0] + dx * k, state.cursor[1] + dy * k, false);
}

export function dropAll(state) {
  state.held.clear();
  state.pressed.clear();
  state.mouse.left = false;
  state.mouse.right = false;
  state.cursor[0] = 0; state.cursor[1] = 0;
  state.rollHeld = 0;
  Object.assign(state.pad, { roll: 0, throttle: 0, fire: false, aiming: false });
}

const axis = (state, plus, minus) => (state.held.has(plus) ? 1 : 0) - (state.held.has(minus) ? 1 : 0);

export function readInput(state, dt) {
  const take = action => state.pressed.delete(action);
  const direction = axis(state, 'rollRight', 'rollLeft');
  let roll = 0;
  if (direction === 0) state.rollHeld = 0;
  else { roll = direction * Math.min(1, TAP + RAMP * state.rollHeld); state.rollHeld += dt; }
  if (state.pad.roll) roll = state.pad.roll;
  // Direct steering: the cursor drifts home once the mouse has rested a moment.
  state.moved += dt;
  if ((state.settings.steering ?? 'direct') === 'direct' && !state.absolute && state.moved > 0.06) {
    const k = Math.exp(-CENTRE_RATE * dt);
    state.cursor[0] *= k; state.cursor[1] *= k;
  }
  const invert = state.settings.invertPitch ? -1 : 1;
  const out = {
    cursor: [state.cursor[0], state.cursor[1] * invert],
    pitch: 0, yaw: 0, roll, lift: 0,
    strafe: axis(state, 'strafeRight', 'strafeLeft'),
    throttleDelta: clamp1(axis(state, 'faster', 'slower') + state.pad.throttle),
    throttleSet: null, throttleZero: false, toggleFA: false,
    boost: state.held.has('boost'),
    fire: state.mouse.left || state.pad.fire,
    missile: take('missile'),
  };
  for (const action of ONCE) out[action] = take(action);
  return out;
}
