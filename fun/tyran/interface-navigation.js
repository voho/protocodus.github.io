// Measure only on keyboard input, never in the flight loop. DOM order is the
// fallback for stacked layouts and for cards removed after a purchase.
const CONTROL = 'button, a[href], input, select, textarea, [tabindex="0"]';
export const directionForKey = code => ({
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
})[code];

export function interfaceControls(container) {
  return [...container.querySelectorAll(CONTROL)].filter(el => {
    if (el.disabled || el.closest('[hidden], [inert]') || !el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  });
}

export function focusInterfaceControl(control) {
  if (!control) return;
  control.focus({ preventScroll: true });
  control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

export function moveInterfaceFocus(container, direction) {
  const controls = interfaceControls(container);
  if (!controls.length) return;
  const current = controls.find(el => el === document.activeElement || el.contains(document.activeElement));
  if (!current) { focusInterfaceControl(controls[0]); return; }
  const rect = current.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const candidates = controls.filter(el => el !== current).map(el => {
    const box = el.getBoundingClientRect();
    const dx = box.left + box.width / 2 - x, dy = box.top + box.height / 2 - y;
    const sameRow = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > Math.min(rect.height, box.height) / 2;
    return { el, dx, dy, sameRow };
  }).filter(item => horizontal
    ? item.sameRow && item.dx * sign > 1
    : !item.sameRow && item.dy * sign > 1);
  candidates.sort((a, b) => horizontal
    ? Math.abs(a.dx) - Math.abs(b.dx)
    : Math.abs(a.dy) - Math.abs(b.dy) || Math.abs(a.dx) - Math.abs(b.dx));
  if (candidates.length) {
    // Cards in a row can differ slightly in height. Treat near-equal vertical
    // distances as one row, then keep the user's column where possible.
    const nearest = horizontal ? candidates[0] : candidates
      .filter(item => Math.abs(item.dy) <= Math.abs(candidates[0].dy) + 12)
      .sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx))[0];
    focusInterfaceControl(nearest.el);
  } else {
    const index = controls.indexOf(current);
    focusInterfaceControl(controls[(index + sign + controls.length) % controls.length]);
  }
}
