export function createInput(onAction) {
  const keys = new Set();
  const touches = new Map();
  const actions = { Escape: 'pause', KeyP: 'pause', KeyR: 'recover', KeyM: 'sound', KeyC: 'camera', Enter: 'start' };
  const drivingKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  let previousButtons = [];
  const editing = target => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]');
  function clear() {
    keys.clear(); touches.clear();
    document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
  }
  window.addEventListener('keydown', event => {
    if (editing(event.target)) return;
    if (drivingKeys.has(event.code)) {
      if (document.body.dataset.mode === 'race' || document.body.dataset.mode === 'countdown') event.preventDefault();
      keys.add(event.code);
    }
    if (actions[event.code] && !event.repeat) {
      // Preserve native activation for focused UI controls.
      if (event.code === 'Enter' && event.target.closest?.('button, summary, a')) return;
      event.preventDefault(); onAction(actions[event.code]);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      touches.set(event.pointerId, button.dataset.action); button.classList.add('pressed');
    });
    const release = event => { touches.delete(event.pointerId); button.classList.remove('pressed'); };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  }
  return {
    clear,
    read() {
      const held = action => [...touches.values()].includes(action);
      let throttle = +(keys.has('KeyW') || keys.has('ArrowUp') || held('throttle'));
      let brake = +(keys.has('KeyS') || keys.has('ArrowDown') || held('brake'));
      // Cars face local +Z: positive yaw turns left from the chase camera.
      let steer = +(keys.has('KeyA') || keys.has('ArrowLeft') || held('left')) - +(keys.has('KeyD') || keys.has('ArrowRight') || held('right'));
      let drift = keys.has('Space') || held('drift');
      const gamepad = navigator.getGamepads?.()?.find(pad => pad?.connected);
      if (gamepad) {
        const axis = gamepad.axes[0] || 0;
        steer = Math.abs(axis) > .14 ? -axis : steer;
        throttle = Math.max(throttle, gamepad.buttons[7]?.value || 0, gamepad.buttons[0]?.value || 0);
        brake = Math.max(brake, gamepad.buttons[6]?.value || 0, gamepad.buttons[1]?.value || 0);
        drift ||= !!gamepad.buttons[2]?.pressed;
        for (const [index, action] of [[9, 'gamepadMenu'], [3, 'recover']]) {
          if (gamepad.buttons[index]?.pressed && !previousButtons[index]) onAction(action);
        }
        previousButtons = gamepad.buttons.map(button => button.pressed);
      }
      return { throttle, brake, steer, drift };
    }
  };
}
