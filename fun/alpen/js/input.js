/* Input.

   Six commands the rider can be given, and the game never asks about keys:

     turn        -1 … 1, and it ramps rather than switching, so a tap is a
                 nudge and a hold is a full-lock carve
     tuck        powered tuck; accelerate up to the current flow speed cap
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

/* Where a stick starts being a steering input. Real thumbsticks rest off
   centre — a worn one sits at 0.15 all day — so the zone is generous, and
   what leaves it is rescaled to start from zero rather than stepping
   straight to the zone's edge. */
const GP_DEADZONE = 0.18;

export function createInput(target, hooks = {}) {
  const down = new Set();
  let jumpStepSeen = false;
  const touchButtons = [];
  let jumpTapPending = false;
  let jumpPulse = PULSE_NONE;
  // Gamepad edge state — see the pad block in `update`.
  let gamepadSuppressed = false;
  let gpJumpHeld = false;
  let gpJumpStepSeen = false;
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
          if (jumpKey) jumpStepSeen = false;
        }
        down.add(e.code);
      } else {
        if (jumpKey && !jumpStepSeen && down.has(e.code)) jumpTapPending = true;
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
  // A controller may already be connected when a resumed page creates input.
  let hasGamepads = (navigator.getGamepads?.() || []).some(Boolean);
  const connected = () => { hasGamepads = true; };
  const disconnected = () => {
    hasGamepads = (navigator.getGamepads?.() || []).some(Boolean);
  };
  window.addEventListener('gamepadconnected', connected);
  window.addEventListener('gamepaddisconnected', disconnected);

  function update(dt) {
    /* The pad, folded in beside the keys rather than over them.

       Reading it is necessarily a poll — the Gamepad API has no stick
       events — and the fold used to be a straight override: any non-zero
       stick beat the keyboard, so a controller with ordinary rest drift
       plugged in anywhere on the machine permanently killed A and D with
       nothing on screen to say why. Axes now pass a real dead zone and are
       rescaled from its edge, several pads OR together instead of the last
       in the array silencing the rest, and steering takes whichever of pad
       and keys is asking harder. */
    let gpTurn = 0, gpTuck = false, gpBrake = false, gpJump = false, gpGrab = false, gpFlip = false;
    if (hasGamepads) {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;
        const raw = gp.axes[0] || 0;   // left stick X
        const mag = Math.abs(raw);
        if (mag > GP_DEADZONE) {
          const linear = Math.min(1, (mag - GP_DEADZONE) / (1 - GP_DEADZONE));
          const scaled = Math.sign(raw) * linear * (0.7 + 0.3 * linear * linear);
          if (Math.abs(scaled) > Math.abs(gpTurn)) gpTurn = scaled;
        }
        // The d-pad is a pair, not two overrides: right used to silently win
        // over a held left, and either over a stick deflected the other way.
        const dpad = (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
        if (Math.abs(dpad) > Math.abs(gpTurn)) gpTurn = dpad;
        gpTuck = gpTuck || !!gp.buttons[7]?.pressed || !!gp.buttons[12]?.pressed;   // RT · d-up
        gpBrake = gpBrake || !!gp.buttons[6]?.pressed || !!gp.buttons[13]?.pressed; // LT · d-down
        gpJump = gpJump || !!gp.buttons[0]?.pressed;   // A
        gpGrab = gpGrab || !!gp.buttons[2]?.pressed;   // X
        gpFlip = gpFlip || !!gp.buttons[3]?.pressed;   // Y
      }

      /* `clear()` cannot reach inside a controller the way it empties the
         key set — the poll would simply re-assert every held button on the
         next frame, exactly the failure `clear` exists to prevent. So a
         cleared pad is ignored until every one of its controls has passed
         through neutral once. */
      if (gamepadSuppressed) {
        if (gpTurn === 0 && !gpTuck && !gpBrake && !gpJump && !gpGrab && !gpFlip) {
          gamepadSuppressed = false;
        } else {
          gpTurn = 0;
          gpTuck = gpBrake = gpJump = gpGrab = gpFlip = false;
        }
      }

      /* A pad tap has no key events to latch, so its edges are found here at
         poll time. A press may have straddled only frames that ran zero
         physics steps — the same lost-ollie failure the keyboard latch
         fixes — so a release whose press *no step consumed* replays it
         through the same pulse machine. Consumption is the test, not frame
         counting: `stepped()` reports the actual read, so a press the rider
         already charged from is never replayed as extra charge on top. */
      if (gpJump && !gpJumpHeld) {
        state.anyPressed = true;
        gpJumpStepSeen = false;
      }
      if (!gpJump && gpJumpHeld && !gpJumpStepSeen) jumpTapPending = true;
      gpJumpHeld = gpJump;
    }

    const keyTurn = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    const want = Math.abs(gpTurn) > Math.abs(keyTurn) ? gpTurn : keyTurn;
    // Changing edges should release the old edge as promptly as letting go.
    const rate = want === 0 || want * state.turn < 0 ? RELEASE : RAMP;
    state.turn += (want - state.turn) * (1 - Math.exp(-rate * dt));
    if (Math.abs(state.turn) < 0.004) state.turn = 0;

    state.tuck = held('tuck') || gpTuck;
    state.brake = held('brake') || gpBrake;
    /* A complete tap can happen between two animation frames. Latch that
       edge into one sampled press and one sampled release so the 120 Hz rider
       always gets an ollie, however the browser scheduled the key events —
       and hold each half until a step has been run on it. See `jumpPulse`. */
    if (jumpPulse !== PULSE_NONE) {
      state.jump = jumpPulse === PULSE_PRESS;
    } else if (jumpTapPending) {
      state.jump = true;
      jumpTapPending = false;
      jumpPulse = PULSE_PRESS;
    } else {
      state.jump = held('jump') || gpJump;
    }
    state.trickGrab = held('grab') || gpGrab;
    state.trickFlip = held('flip') || gpFlip;
  }

  /* Called once per physics step, by whoever owns the fixed-step loop. It is
     the only thing that lets a latched tap move on, so a frame that runs no
     steps at all cannot consume one. */
  function stepped() {
    if (held('jump') && state.jump) jumpStepSeen = true;
    if (gpJumpHeld && state.jump) gpJumpStepSeen = true;
    // Retire each pulse half on this clock, including several physics ticks
    // in one render frame. A tap gets the same charge at 30 Hz and 240 Hz.
    if (jumpPulse === PULSE_PRESS) {
      jumpPulse = PULSE_RELEASE;
      state.jump = false;
    } else if (jumpPulse === PULSE_RELEASE) {
      jumpPulse = PULSE_NONE;
      state.jump = held('jump') || gpJumpHeld;
    }
  }

  /* Wires the on-screen pad. Each button is a pointer capture rather than a
     click, so a thumb can slide between them without losing the press. */
  function bindTouch(root) {
    state.touch = true;
    root.querySelectorAll('[data-key]').forEach((el) => {
      const name = el.dataset.key;
      const pointers = new Set();
      touchButtons.push({ el, pointers });
      let keyboardPulse = 0;
      const set = (v, e) => {
        e.preventDefault();
        if (name === 'jump') {
          if (v && !touch[name]) jumpStepSeen = false;
          if (!v && touch[name] && !jumpStepSeen) jumpTapPending = true;
        }
        touch[name] = v;
        if (v) state.anyPressed = true;
        el.classList.toggle('on', v);
      };
      el.addEventListener('pointerdown', (e) => {
        pointers.add(e.pointerId);
        el.setPointerCapture?.(e.pointerId);
        set(true, e);
      });
      const releasePointer = (e) => {
        pointers.delete(e.pointerId);
        set(pointers.size > 0, e);
      };
      el.addEventListener('pointerup', (e) => {
        releasePointer(e);
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      });
      el.addEventListener('pointercancel', releasePointer);
      el.addEventListener('lostpointercapture', releasePointer);

      // Switch control, voice control and keyboard activation dispatch a
      // click without a pointer sequence. Give those activations a short,
      // fixed pulse so every native button remains a working game control.
      el.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        set(true, e);
        window.clearTimeout(keyboardPulse);
        keyboardPulse = window.setTimeout(() => {
          set(false, e);
        }, 160);
      });
    });
  }

  function dispose() {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
    window.removeEventListener('gamepadconnected', connected);
    window.removeEventListener('gamepaddisconnected', disconnected);
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
    jumpStepSeen = false;
    jumpTapPending = false;
    jumpPulse = PULSE_NONE;
  }

  /* And the hard version, for when the key states genuinely can no longer be
     trusted: losing focus is exactly the case where the keyup goes to somebody
     else and never arrives here. */
  function clear() {
    down.clear();
    for (const k of Object.keys(touch)) touch[k] = false;
    for (const { el, pointers } of touchButtons) {
      el.classList.remove('on');
      pointers.clear();
    }
    // The pad cannot be emptied, only distrusted — see the poll in `update`.
    gamepadSuppressed = true;
    gpJumpHeld = false;
    gpJumpStepSeen = false;
    calm();
  }

  /* Gamepad dual-rumble haptic feedback.
     Safely triggers vibration actuators on connected gamepads. */
  function rumble(weakMagnitude = 0.3, strongMagnitude = 0.3, durationMs = 150) {
    if (!hasGamepads || !navigator.getGamepads) return;
    try {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;
        if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
          gp.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: Math.max(10, Math.min(1000, durationMs)),
            weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
            strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
          }).catch(() => { /* gamepad disconnected or backgrounded */ });
        }
      }
    } catch { /* platform or security restriction */ }
  }

  return { state, update, stepped, bindTouch, dispose, clear, calm, rumble };
}
