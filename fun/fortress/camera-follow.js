// The projected play area excludes the HUD. Ease toward the action, then enforce
// the visibility bounds so a second launch or a ricochet never leaves the frame.
export function createShotCamera() {
  let pose,
    lastImpact = [];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function update(base, screen, sim, events, dt, reduced) {
    const { width, height, top, bottom, fitScale } = screen;
    const now = sim.time;
    while (lastImpact.length && now - lastImpact[0].time >= 1.05) lastImpact.shift();
    for (const e of events) {
      if (e.type !== 'impact' && e.type !== 'explosion') continue;
      lastImpact.push({ x: e.x, y: e.y, time: now });
    }
    let left = Infinity,
      right = -Infinity,
      high = Infinity,
      low = -Infinity;
    function include(x, y, radius) {
      left = Math.min(left, x - radius);
      right = Math.max(right, x + radius);
      high = Math.min(high, y - radius);
      low = Math.max(low, y + radius);
    }
    let shots = 0;
    for (const e of sim.projectiles) {
      if (e.body.isSleeping) continue;
      if (e.contacts.size && e.body.speed < 0.8 && e.lastImpact >= 0 && now - e.lastImpact > 0.14) continue;
      include(e.x, e.y, e.radius + 4);
      // A little lead keeps the camera moving ahead of a fast stone.
      include(e.x + e.body.velocity.x * 4, e.y + e.body.velocity.y * 4, e.radius);
      shots++;
    }
    for (const p of lastImpact) include(p.x, p.y, 30);
    const follow = shots || lastImpact.length;
    const baseScale = width / base.width;
    const homeX = base.x + base.width / 2;
    const homeY = base.y + base.height / 2;
    if (!pose && !follow) return base;
    if (!pose) pose = { x: homeX, y: homeY, scale: baseScale };

    const pad = width * 0.055;
    const availableW = width - pad * 2;
    const availableH = bottom - top;
    const screenMidY = (top + bottom) / 2;
    const hardScale = follow
      ? Math.min(availableW / Math.max(1, right - left), availableH / Math.max(1, low - high))
      : Infinity;
    let targetScale = baseScale,
      targetX = homeX,
      targetY = homeY;
    if (follow) {
      if (reduced) {
        targetScale = Math.min(baseScale, hardScale);
      } else {
        const framing = shots ? 1.55 : 1.95;
        targetX = (left + right) / 2;
        // Leave room below a high arc for the towers it is approaching.
        const sceneBottom = shots ? Math.max(low, sim.terrainHeight(targetX) - 40) : low;
        const contextScale = availableH / Math.max(1, sceneBottom - high + 24);
        targetScale = Math.min(Math.max(baseScale, fitScale * framing), hardScale * 0.83, contextScale);
        targetY = (high + sceneBottom) / 2 + (height / 2 - screenMidY) / targetScale;
      }
    }
    const blend = 1 - Math.exp(-dt * (follow ? 4.4 : 3.5));
    pose.scale = Math.min(hardScale, pose.scale * Math.pow(targetScale / pose.scale, blend));
    pose.x += (targetX - pose.x) * blend;
    pose.y += (targetY - pose.y) * blend;
    const w = width / pose.scale,
      h = height / pose.scale;
    if (follow) {
      pose.x = clamp(pose.x, right - (width / 2 - pad) / pose.scale, left + (width / 2 - pad) / pose.scale);
      pose.y = clamp(pose.y, low - (bottom - height / 2) / pose.scale, high + (height / 2 - top) / pose.scale);
    } else if (Math.abs(pose.x - homeX) + Math.abs(pose.y - homeY) + Math.abs(w - base.width) < 0.4) {
      pose = undefined;
      return base;
    }
    return { x: pose.x - w / 2, y: pose.y - h / 2, width: w, height: h };
  }
  return {
    update,
    reset() {
      pose = undefined;
      lastImpact = [];
    },
  };
}
