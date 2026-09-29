// Motion only answers (DESIGN.md 10): a live reduced-motion check, the camera's glide timing and the small effects every
// surface shares. Under reduced motion glides cut, scrolls jump, tints and fades are skipped and a delta shows without fading.
// Nothing here runs at import, so Node tests load it without a DOM.
const QUERY = '(prefers-reduced-motion: reduce)', TINT_MS = 600, DELTA_MS = 1200, FADE_MS = 120;
export const reducedMotion = () => Boolean(globalThis.matchMedia?.(QUERY).matches);
/** Smooth for moves inside a panel, instant under reduced motion. */
export function scrollIntoViewSafe(el, opts = {}) { el?.scrollIntoView?.({ ...opts, behavior: reducedMotion() ? 'auto' : 'smooth' }); }
/** A camera glide: 280 ms plus 60 ms a screen, at most 480 ms; 0 (a cut) under reduced motion. */
export const cameraDuration = screens => reducedMotion() ? 0 : Math.min(480, Math.max(280, 280 + 60 * (Number(screens) || 0)));

// A value the player changed: a well tint behind the figure for 600 ms.
const tints = new WeakMap();
export function tint(el) {
  if (!el || reducedMotion()) return;
  clearTimeout(tints.get(el)); el.classList.remove('is-tinted'); void el.offsetWidth; el.classList.add('is-tinted');
  tints.set(el, setTimeout(() => el.classList.remove('is-tinted'), TINT_MS));
}

// Money the player spent or received: '−$18,000' beside the anchor for 1.2 s, in the error or ok colour by its sign.
// It floats in a fixed layer, so nothing around the anchor moves.
export function delta(anchor, text) {
  if (!anchor?.isConnected) return null;
  const box = anchor.getBoundingClientRect(), el = document.createElement('span'), sign = String(text).trim()[0];
  el.className = 'delta' + (sign === '−' || sign === '-' ? ' delta--error' : sign === '+' ? ' delta--ok' : '');
  el.setAttribute('aria-hidden', 'true'); el.textContent = text;
  el.style.left = `${Math.round(box.right + 8)}px`; el.style.top = `${Math.round(box.top + box.height / 2)}px`;
  document.body.append(el); setTimeout(() => el.remove(), DELTA_MS);
  return el;
}

// An inspector changing entity: the old height holds as min-height while the new content fades in over 120 ms, and lets go
// once the next frame has measured it, so nothing below jumps.
export function crossfade(container, render) {
  if (!container) return;
  const still = reducedMotion(), height = container.offsetHeight;
  if (still || !height) { render(container); return; }
  container.style.minHeight = `${height}px`;
  render(container);
  container.classList.remove('is-crossfading'); void container.offsetWidth; container.classList.add('is-crossfading');
  requestAnimationFrame(() => { void container.scrollHeight; requestAnimationFrame(() => { container.style.minHeight = ''; }); });
  setTimeout(() => container.classList.remove('is-crossfading'), FADE_MS);
}
