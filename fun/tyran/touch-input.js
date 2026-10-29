// Pointer ownership keeps independent touch gestures from cancelling one another.
// The adapter accepts touch/pen only; desktop input remains in game.js.
export function createTouchControls({ stick, buttons = {}, isPlaying, onGesture = () => {}, consume = event => event.preventDefault() }) {
  const owners = new Map();
  const touch = { x: 0, y: 0, fire: false, secondary: false, bomb: false, pointer: null, assist: false };
  let originX = 0, originY = 0, radius = 30;
  const channels = ['fire', 'secondary', 'bomb'];
  const accepts = event => (event.pointerType === 'touch' || event.pointerType === 'pen') && isPlaying();
  const capture = (target, pointer) => {
    try { target.setPointerCapture(pointer); return true; } catch { return false; }
  };
  const releaseCapture = (target, pointer) => {
    if (pointer == null) return;
    try { if (target?.hasPointerCapture(pointer)) target.releasePointerCapture(pointer); } catch { /* Already detached or released. */ }
  };
  function sync() {
    touch.fire = owners.has('fire') || (touch.assist && touch.pointer != null);
    touch.secondary = owners.has('secondary');
    touch.bomb = owners.has('bomb');
    for (const channel of channels) {
      if (buttons[channel]) buttons[channel].dataset.held = String(touch[channel]);
    }
    if (stick) {
      stick.dataset.held = String(touch.pointer != null);
      stick.style.setProperty('--stick-x', `${touch.x * 20}px`);
      stick.style.setProperty('--stick-y', `${touch.y * 20}px`);
    }
  }
  touch.setAssist = enabled => { touch.assist = !!enabled; sync(); };
  touch.reset = () => {
    const captures = [...owners].map(([channel, pointer]) => [buttons[channel], pointer]);
    captures.push([stick, touch.pointer]);
    // Clear ownership first: releasing capture can synchronously dispatch loss.
    owners.clear(); touch.pointer = null; touch.x = touch.y = 0; sync();
    for (const [target, pointer] of captures) releaseCapture(target, pointer);
  };
  if (stick) {
    stick.addEventListener('pointerdown', event => {
      if (!accepts(event) || touch.pointer != null || !capture(stick, event.pointerId)) return;
      touch.pointer = event.pointerId; originX = event.clientX; originY = event.clientY;
      const bounds = stick.getBoundingClientRect();
      radius = Math.max(24, Math.min(42, Math.min(bounds.width, bounds.height) / 2 - 12));
      touch.x = touch.y = 0; sync(); onGesture(); consume(event);
    });
    stick.addEventListener('pointermove', event => {
      if (!isPlaying() || event.pointerId !== touch.pointer) return;
      const x = (event.clientX - originX) / radius, y = (event.clientY - originY) / radius;
      const length = Math.hypot(x, y);
      // A circular dead zone removes resting-thumb drift without favoring diagonals.
      const strength = Math.max(0, Math.min(1, (length - .1) / .9));
      touch.x = length ? x / length * strength : 0;
      touch.y = length ? y / length * strength : 0;
      sync(); consume(event);
    });
    const release = event => {
      if (event.pointerId !== touch.pointer) return;
      const pointer = touch.pointer;
      touch.pointer = null; touch.x = touch.y = 0; sync();
      releaseCapture(stick, pointer); consume(event);
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, release);
  }
  for (const channel of channels) {
    const button = buttons[channel];
    if (!button) continue;
    button.addEventListener('pointerdown', event => {
      if (!accepts(event) || owners.has(channel) || !capture(button, event.pointerId)) return;
      owners.set(channel, event.pointerId); sync(); onGesture(); consume(event);
    });
    const release = event => {
      if (!owners.has(channel) || owners.get(channel) !== event.pointerId) return;
      owners.delete(channel); sync(); releaseCapture(button, event.pointerId); consume(event);
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
  }
  sync();
  return touch;
}
