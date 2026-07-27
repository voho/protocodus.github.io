/* Input.

   Five things the rider can be told, and the game never asks about keys:

     turn        -1 … 1, and it ramps rather than switching, so a tap is a
                 nudge and a hold is a full-lock carve
     tuck        fold down over the board
     brake       set the edge across the hill
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

const RAMP = 9;      // how fast `turn` reaches the key that is held
const RELEASE = 14;  // and how fast it comes back to centre

export function createInput(target, hooks = {}) {
  const down = new Set();
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
        if (!down.has(e.code)) state.anyPressed = true;
        down.add(e.code);
      } else {
        down.delete(e.code);
      }
    }
    if (isDown && hooks.key) hooks.key(e);
  }

  const keydown = (e) => onKey(e, true);
  const keyup = (e) => onKey(e, false);
  const blur = () => down.clear();

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  function update(dt) {
    const want = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    const rate = want === 0 ? RELEASE : RAMP;
    state.turn += (want - state.turn) * (1 - Math.exp(-rate * dt));
    if (Math.abs(state.turn) < 0.004) state.turn = 0;

    state.tuck = held('tuck');
    state.brake = held('brake');
    state.jump = held('jump');
    state.trickGrab = held('grab');
    state.trickFlip = held('flip');
  }

  /* Wires the on-screen pad. Each button is a pointer capture rather than a
     click, so a thumb can slide between them without losing the press. */
  function bindTouch(root) {
    state.touch = true;
    root.querySelectorAll('[data-key]').forEach((el) => {
      const name = el.dataset.key;
      const set = (v) => (e) => {
        e.preventDefault();
        touch[name] = v;
        if (v) state.anyPressed = true;
        el.classList.toggle('on', v);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    });
  }

  function dispose() {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
  }

  function clear() {
    down.clear();
    for (const k of Object.keys(touch)) touch[k] = false;
    state.turn = 0;
  }

  return { state, update, bindTouch, dispose, clear };
}
