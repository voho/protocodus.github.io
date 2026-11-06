/* Player mechanical cues follow simulation progress. Pending cues are small
   descriptors, not already-started Web Audio sources; a slow render frame
   therefore cannot make a bolt/reload finish audibly before its animation. */
export function createSimulationActions({ ctx, output, maxActions = 4, maxCues = 32 }) {
  const actions = new Set();
  let dispatched = 0, evicted = 0, rejected = 0;

  function releaseIfFinished(action) {
    if (action.pending.length || action.sources.size) return;
    action.out.disconnect(); actions.delete(action);
  }

  function cancel(action) {
    action.pending.length = 0; action.cancelled = true;
    const time = ctx.currentTime;
    action.out.gain.cancelAndHoldAtTime(time);
    action.out.gain.setTargetAtTime(0, time, .004);
    for (const source of action.sources) { try { source.stop(time + .02); } catch { /* already ended */ } }
    actions.delete(action);
    releaseIfFinished(action);
  }

  function create() {
    if (actions.size >= maxActions) { cancel(actions.values().next().value); evicted++; }
    const out = ctx.createGain(); out.connect(output);
    const action = { out, elapsed: 0, pending: [], sources: new Set(), cancelled: false,
      at(offset, make) {
        if (action.cancelled || !Number.isFinite(offset) || offset < 0 || typeof make !== 'function' || action.pending.length >= maxCues) { rejected++; return action; }
        action.pending.push({ offset, make });
        action.pending.sort((a, b) => a.offset - b.offset);
        return action;
      },
    };
    actions.add(action);
    queueMicrotask(() => releaseIfFinished(action));
    return action;
  }

  function advance(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || ctx.state !== 'running') return;
    for (const action of actions) {
      action.elapsed += dt;
      while (action.pending.length && action.pending[0].offset <= action.elapsed + 1e-9) {
        const cue = action.pending.shift();
        // The pose already crossed the cue this frame. Start at the next
        // audio quantum, rather than queue the remainder of an old real timer.
        const source = cue.make(action.out, ctx.currentTime + .001);
        if (!source) continue;
        dispatched++; action.sources.add(source);
        source.addEventListener('ended', () => { action.sources.delete(source); releaseIfFinished(action); }, { once: true });
      }
      releaseIfFinished(action);
    }
  }

  return {
    create, advance,
    cancel() { for (const action of [...actions]) cancel(action); },
    get status() { return { active: actions.size, sources: [...actions].reduce((n, action) => n + action.sources.size, 0),
      pending: [...actions].reduce((n, action) => n + action.pending.length, 0), dispatched, evicted, rejected, maxActions, maxCues }; },
  };
}
