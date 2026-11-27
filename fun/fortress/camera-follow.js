// Leave the player’s chosen framing alone until a flight needs more room.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bounds = () => ({ left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
function include(box, left, right, top, bottom) {
  box.left = Math.min(box.left, left);
  box.right = Math.max(box.right, right);
  box.top = Math.min(box.top, top);
  box.bottom = Math.max(box.bottom, bottom);
}
function circle(box, x, y, r) {
  include(box, x - r, x + r, y - r, y + r);
}
function fitBounds(box, width, height) {
  return Math.min(width / Math.max(1, box.right - box.left), height / Math.max(1, box.bottom - box.top));
}

// Exact critically damped spring, with a capped driving distance for long pans.
function glide(axis, target, frequency, speed, dt) {
  const limit = (2 * speed) / frequency;
  const distance = clamp(axis.value - target, -limit, limit);
  const impulse = axis.velocity + frequency * distance;
  const decay = Math.exp(-frequency * dt);
  axis.value += (distance + impulse * dt) * decay - distance;
  axis.velocity = (axis.velocity - frequency * impulse * dt) * decay;
}

function constrain(axis, low, high) {
  const value = clamp(axis.value, low, high);
  if ((axis.value - value) * axis.velocity > 0) axis.velocity = 0;
  axis.value = value;
}

export function createShotCamera() {
  const flights = new WeakMap();
  const impacts = [];
  let pose, goal;
  let lastFlight = false;
  function update(base, screen, sim, events, dt, reduced) {
    const { width, height, top, bottom } = screen;
    const now = sim.time;
    while (impacts.length && now - impacts[0].time > 2.5) impacts.shift();
    for (const e of events) {
      if (e.type === 'impact' || e.type === 'explosion' || e.type === 'fireburst' || e.type === 'implosion')
        impacts.push({ x: e.x, y: e.y, time: now });
    }
    if (!sim.projectiles.size && !impacts.length && !pose) return base;
    const active = bounds();
    const corridor = bounds();
    let flying = false;
    for (const shot of sim.projectiles) {
      if (shot.body.isSleeping || (shot.contacts.size && shot.body.speed < 0.8 && now - shot.lastImpact > 0.14))
        continue;
      circle(active, shot.x, shot.y, shot.radius + 3);
      if (shot.lastImpact >= 0 || !shot.flightPath?.length || reduced) continue;
      flying = true;
      let path = flights.get(shot);
      if (!path) {
        path = bounds();
        for (const p of shot.flightPath) circle(path, p.x, p.y, shot.radius + 3);
        flights.set(shot, path);
      }
      include(corridor, path.left, path.right, path.top, path.bottom);
    }
    for (const p of impacts) circle(active, p.x, p.y, 8);
    const tracking = active.left <= active.right;
    const homeScale = width / base.width;
    const homeX = base.x + base.width / 2, homeY = base.y + base.height / 2;
    const margin = width * 0.018;
    const halfWidth = width / 2 - margin;
    const above = height / 2 - top, below = bottom - height / 2;
    if (reduced || !tracking || !goal) goal = { x: homeX, y: homeY, scale: homeScale };
    else if (!flying && lastFlight && pose) {
      // An early hit invalidates the predicted arc. Bleed off current velocity here.
      goal = { x: pose.x.value, y: pose.y.value, scale: Math.exp(pose.zoom.value) };
    }
    lastFlight = flying;
    if (tracking) {
      include(corridor, active.left, active.right, active.top, active.bottom);
      goal.scale = Math.min(goal.scale, fitBounds(corridor, 2 * halfWidth, bottom - top));
      goal.x = clamp(goal.x, corridor.right - halfWidth / goal.scale, corridor.left + halfWidth / goal.scale);
      goal.y = clamp(goal.y, corridor.bottom - below / goal.scale, corridor.top + above / goal.scale);
    }
    if (!pose) {
      if (Math.abs(goal.x - homeX) + Math.abs(goal.y - homeY) < 0.001 && goal.scale >= homeScale - 1e-8) {
        goal = undefined;
        return base;
      }
      pose = {
        x: { value: homeX, velocity: 0 },
        y: { value: homeY, velocity: 0 },
        zoom: { value: Math.log(homeScale), velocity: 0 },
      };
    }
    const frequency = tracking ? 2.6 : 1.85;
    glide(pose.zoom, Math.log(goal.scale), frequency, flying ? 0.5 : 0.16, dt);
    if (tracking) constrain(pose.zoom, -Infinity, Math.log(fitBounds(active, 2 * halfWidth, bottom - top)));
    const scale = Math.exp(pose.zoom.value), w = width / scale, h = height / scale;
    glide(pose.x, goal.x, frequency, 0.15 * w, dt);
    glide(pose.y, goal.y, frequency, 0.15 * h, dt);
    if (tracking) {
      constrain(pose.x, active.right - halfWidth / scale, active.left + halfWidth / scale);
      constrain(pose.y, active.bottom - below / scale, active.top + above / scale);
    } else if (Math.abs(pose.x.value - homeX) + Math.abs(pose.y.value - homeY) + Math.abs(w - base.width) < 0.65) {
      pose = goal = undefined;
      return base;
    }
    return { x: pose.x.value - w / 2, y: pose.y.value - h / 2, width: w, height: h };
  }
  return {
    update,
    reset() {
      pose = goal = undefined;
      impacts.length = 0;
      lastFlight = false;
    },
  };
}
