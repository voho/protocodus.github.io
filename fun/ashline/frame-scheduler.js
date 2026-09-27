// Keep deterministic 50 ms simulation ticks, but yield between expensive ticks
// so a large army cannot turn one animation frame into a long catch-up loop.
export function advanceSimulationFrame(pending, elapsed, speed, step, now = () => performance.now()) {
  const tick = .05, budget = 8;
  // Match the existing 200 ms wall-time clamp and bound overdue work as well.
  // Under sustained overload the game slows instead of accumulating an endless debt.
  pending = Math.min(.2 * speed, pending + Math.min(.2, Math.max(0, elapsed)) * speed);
  const deadline = now() + budget;
  while (pending + 1e-10 >= tick) {
    pending = Math.max(0, pending - tick);
    if (step(tick) === false) return 0;
    if (now() >= deadline) break;
  }
  return pending;
}
