/* Input.

   Six commands the rider can be given, and the game never asks about keys:

     turn        -1 … 1, and it ramps rather than switching, so a tap is a
                 nudge and a hold is a full-lock carve
     tuck        powered tuck; continuously accelerate with no speed cap
     brake       heel-side speed check; pivot across travel and sideslip
     jump        held to charge, released to pop
     trickGrab   Q — reach down and hold the board
     trickFlip   E — rotate

   The ramp on `turn` is the only clever part, and it is worth it: a digital
   key held against an analogue steering model feels like a switch unless
   something in between gives it a rise time. */

const BINDINGS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  tuck: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  grab: ['KeyQ'],
  flip: ['KeyE'],
};

/* How fast `turn` reaches the key that is held, and how fast it comes back.

   These are the rise time of the steering, and the rise time is most of what
   "sensitive" means to a player. At 9 the axis went from nothing to full lock
   in about a fifth of a second, which on a model where the board's edge angle
   *is* the input meant a tap put the board most of the way over — and since
   the grip a given edge angle asks for goes as the square of the speed, a tap
   at speed was an instant demand for grip that did not exist. Rolling a board
   onto its edge is a deliberate movement of the whole body and it takes about
   twice this long in life. Slower in than out, because letting an edge go is
   the one thing a rider does quickly. */
const RAMP = 7.5;
const RELEASE = 12;

/* The latched tap is measured in physics steps, not in rendered frames.

   `jumpPulse` is 0 when there is none, 1 while the sampled press is being
   shown, and 2 while the sampled release is. It only advances once a physics
   step has actually looked at it, which `stepped()` reports — and that is the
   whole of the fix for an ollie that silently never happened.

   The rider reads `state` from inside the fixed 120 Hz loop, and a display
   faster than 120 Hz runs frames that step the physics zero times. A pulse
   retired on frame boundaries therefore had a chance of living and dying
   entirely inside one of those frames, having been seen by nothing. Measured
   against the real loop with ten tapped ollies: one lost at 144 Hz, three at
   165 Hz, and at 240 Hz the tap never worked at all. */
const PULSE_NONE = 0;
const PULSE_PRESS = 1;
const PULSE_RELEASE = 2;

export function createInput(target, hooks = {}) {
  const down = new Set();
  let jumpPressedSinceUpdate = false;
  let jumpTapPending = false;
  let jumpPulse = PULSE_NONE;
  let jumpPulseSeen = false;
  const state = {
    turn: 0, tuck: false, brake: false, jump: false,
    trickGrab: false, trickFlip: false,
    anyPressed: false, touch: false,
  };

  // Touch overrides live alongside the keys rather than replacing them, so
  // a laptop with a touchscreen can use either without a mode switch
  const touch = { left: false, right: false, tuck: false, brake: false, jump: false, grab: false, flip: false };

  const held = (name) => BINDINGS[name].some((c) => down.has(c)) || touch[name];

  const CODES = new Set(Object.values(BINDINGS).flat());

  function onKey(e, isDown) {
    const bound = CODES.has(e.code);
    const jumpKey = BINDINGS.jump.includes(e.code);
    // Space and the arrows scroll the page otherwise, which on a game that
    // fills the viewport is a bug rather than a preference. Repeats included:
    // the key is still down, so the page would still scroll.
    if (bound) e.preventDefault();

    // Auto-repeat is the browser saying the key is still held, which we
    // already know. Forwarding it turned "hold M" into a mute toggle running
    // at the repeat rate, and "hold Escape" into pause flapping whose final
    // state depended on exactly when you let go.
    if (isDown && e.repeat) return;

    if (bound) {
      if (isDown) {
        if (!down.has(e.code)) {
          state.anyPressed = true;
          if (jumpKey) jumpPressedSinceUpdate = true;
        }
        down.add(e.code);
      } else {
        if (jumpKey && jumpPressedSinceUpdate && down.has(e.code)) jumpTapPending = true;
        down.delete(e.code);
      }
    }
    if (isDown && hooks.key) hooks.key(e);
  }

  const keydown = (e) => onKey(e, true);
  const keyup = (e) => onKey(e, false);
  const blur = () => clear();

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  let hasGamepads = false;
  window.addEventListener('gamepadconnected', () => hasGamepads = true);
  window.addEventListener('gamepaddisconnected', () => {
    hasGamepads = (navigator.getGamepads ? navigator.getGamepads() : []).filter(g => g).length > 0;
  });

  function update(dt) {
    let gpTurn = 0, gpTuck = false, gpBrake = false, gpJump = false, gpGrab = false, gpFlip = false;
    if (hasGamepads) {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
      if (!gp) continue;
      
      if (Math.abs(gp.axes[0]) > 0.1) gpTurn = gp.axes[0]; // Left stick X
      if (gp.buttons[7] && gp.buttons[7].pressed) gpTuck = true; // RT
      if (gp.buttons[6] && gp.buttons[6].pressed) gpBrake = true; // LT
      if (gp.buttons[0] && gp.buttons[0].pressed) gpJump = true; // A button
      if (gp.buttons[2] && gp.buttons[2].pressed) gpGrab = true; // X button
      if (gp.buttons[3] && gp.buttons[3].pressed) gpFlip = true; // Y button
      if (gp.buttons[14] && gp.buttons[14].pressed) gpTurn = -1; // D-pad Left
      if (gp.buttons[15] && gp.buttons[15].pressed) gpTurn = 1; // D-pad Right
      if (gp.buttons[12] && gp.buttons[12].pressed) gpTuck = true; // D-pad Up
      if (gp.buttons[13] && gp.buttons[13].pressed) gpBrake = true; // D-pad Down
      }
    }

    const want = gpTurn !== 0 ? gpTurn : ((held('right') ? 1 : 0) - (held('left') ? 1 : 0));
    const rate = want === 0 ? RELEASE : RAMP;
    state.turn += (want - state.turn) * (1 - Math.exp(-rate * dt));
    if (Math.abs(state.turn) < 0.004) state.turn = 0;

    state.tuck = held('tuck') || gpTuck;
    state.brake = held('brake') || gpBrake;
    /* A complete tap can happen between two animation frames. Latch that
       edge into one sampled press and one sampled release so the 120 Hz rider
       always gets an ollie, however the browser scheduled the key events —
       and hold each half until a step has been run on it. See `jumpPulse`. */
    if (jumpPulse === PULSE_PRESS) {
      if (jumpPulseSeen) {
        jumpPulse = PULSE_RELEASE;
        jumpPulseSeen = false;
        state.jump = false;
      } else {
        state.jump = true;
      }
    } else if (jumpPulse === PULSE_RELEASE) {
      if (jumpPulseSeen) {
        jumpPulse = PULSE_NONE;
        jumpPulseSeen = false;
        state.jump = held('jump') || gpJump;
      } else {
        state.jump = false;
      }
    } else if (jumpTapPending) {
      state.jump = true;
      jumpTapPending = false;
      jumpPulse = PULSE_PRESS;
      jumpPulseSeen = false;
    } else {
      state.jump = held('jump') || gpJump;
    }
    jumpPressedSinceUpdate = false;
    state.trickGrab = held('grab') || gpGrab;
    state.trickFlip = held('flip') || gpFlip;
  }

  /* Called once per physics step, by whoever owns the fixed-step loop. It is
     the only thing that lets a latched tap move on, so a frame that runs no
     steps at all cannot consume one. */
  function stepped() {
    if (jumpPulse !== PULSE_NONE) jumpPulseSeen = true;
  }

  /* Wires the on-screen pad. Each button is a pointer capture rather than a
     click, so a thumb can slide between them without losing the press. */
  function bindTouch(root) {
    state.touch = true;
    root.querySelectorAll('[data-key]').forEach((el) => {
      const name = el.dataset.key;
      let keyboardPulse = 0;
      const set = (v, e) => {
        e.preventDefault();
        touch[name] = v;
        if (v) state.anyPressed = true;
        el.classList.toggle('on', v);
      };
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture?.(e.pointerId);
        set(true, e);
      });
      el.addEventListener('pointerup', (e) => {
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        set(false, e);
      });
      el.addEventListener('pointercancel', (e) => set(false, e));
      el.addEventListener('lostpointercapture', (e) => set(false, e));

      // Switch control, voice control and keyboard activation dispatch a
      // click without a pointer sequence. Give those activations a short,
      // fixed pulse so every native button remains a working game control.
      el.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        set(true, e);
        window.clearTimeout(keyboardPulse);
        keyboardPulse = window.setTimeout(() => {
          touch[name] = false;
          el.classList.remove('on');
        }, 160);
      });
    });
  }

  function dispose() {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
  }

  /* Everything the game inferred, dropped — but not what the hands are
     actually doing.

     This is what a pause wants, and the distinction is the whole point of
     having two of these. A pause does not take the player's hands off the
     keyboard: they are still holding W, the window still has focus, and the
     keyup will still be delivered whenever they let go, so `down` remains a
     true statement about the keyboard for the entire pause. Emptying it
     anyway left the game unable to ever learn that W was down — a key that is
     already held is never announced again, and auto-repeat is deliberately
     dropped a few lines above — so resuming gave the player a dead key until
     they released and pressed it a second time. */
  function calm() {
    state.turn = 0;
    state.jump = false;
    jumpPressedSinceUpdate = false;
    jumpTapPending = false;
    jumpPulse = PULSE_NONE;
    jumpPulseSeen = false;
  }

  /* And the hard version, for when the key states genuinely can no longer be
     trusted: losing focus is exactly the case where the keyup goes to somebody
     else and never arrives here. */
  function clear() {
    down.clear();
    for (const k of Object.keys(touch)) touch[k] = false;
    calm();
  }

  return { state, update, stepped, bindTouch, dispose, clear, calm };
}
