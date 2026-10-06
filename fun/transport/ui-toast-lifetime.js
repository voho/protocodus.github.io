/** Count a toast's visible reading time, excluding each active interaction. */
export function createToastLifetime(duration, onExpire, {
  now = () => performance.now(), schedule = (run, delay) => setTimeout(run, delay),
  cancel = timer => clearTimeout(timer), onTimer = () => {},
} = {}) {
  let remaining = Math.max(0, Number(duration) || 0), startedAt = 0, timer = null, disposed = false;
  const pauses = new Set();
  function clear() {
    if (timer !== null) cancel(timer);
    timer = null; onTimer(null);
  }
  function start() {
    if (disposed || pauses.size || timer !== null) return;
    startedAt = now();
    timer = schedule(() => { timer = null; onTimer(null); disposed = true; onExpire(); }, remaining);
    onTimer(timer);
  }
  function pause(reason) {
    if (disposed || pauses.has(reason)) return;
    pauses.add(reason);
    if (timer !== null) { remaining = Math.max(0, remaining - (now() - startedAt)); clear(); }
  }
  function resume(reason) { if (!disposed) { pauses.delete(reason); start(); } }
  function dispose() { disposed = true; clear(); pauses.clear(); }
  start();
  return { pause, resume, dispose };
}
