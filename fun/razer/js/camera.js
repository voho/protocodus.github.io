// A trailing camera with a short heading history. Steering reaches the camera
// after the car, then converges without snapping at the -PI / PI boundary.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const blend = (dt, seconds) => 1 - Math.exp(-dt / seconds);

export function createChaseCamera(track) {
  const state = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, yaw: 0 };
  let ready = false, clock = 0, history = [], previous = null, unwrappedYaw = 0, distance = 23, height = 14;
  const ground = (x, z) => track.heightAt(x, z);

  function desired(car, wide) {
    const speed = Math.abs(car.speed || 0);
    const back = distance + Math.min(3.5, speed * .075);
    const directionX = Math.sin(state.yaw), directionZ = Math.cos(state.yaw);
    const x = car.x - directionX * back, z = car.z - directionZ * back;
    let y = Math.max(car.y + height + Math.min(1.8, speed * .03), ground(x, z) + 4.8);
    // Follow the body heading, with a little corner anticipation in the gaze.
    const gazeYaw = state.yaw + angle(car.yaw - state.yaw) * .22;
    const look = (wide ? 9 : 7) + Math.min(4, speed * .09);
    const targetX = car.x + Math.sin(gazeYaw) * look;
    const targetZ = car.z + Math.cos(gazeYaw) * look;
    const targetY = car.y + 1.3 + clamp(ground(targetX, targetZ) - car.y, -4, 5) * .28;
    // A crest or bank behind the car must not hide it. Lift the sight line where
    // it intersects the terrain, rather than moving the camera through a hill.
    for (const t of [.18, .38, .58, .78]) {
      const terrain = ground(x + (car.x - x) * t, z + (car.z - z) * t) + 1.25;
      y = Math.max(y, (terrain - (car.y + 1) * t) / (1 - t));
    }
    return { x, y, z, targetX, targetY, targetZ };
  }

  function reset(car, wide = false) {
    clock = 0; unwrappedYaw = car.yaw; state.yaw = car.yaw;
    history = [{ time: -.5, yaw: car.yaw }, { time: 0, yaw: car.yaw }];
    distance = wide ? 34 : 23; height = wide ? 23 : 14;
    previous = { x: car.x, z: car.z, yaw: car.yaw };
    const d = desired(car, wide);
    Object.assign(state.position, { x: d.x, y: d.y, z: d.z });
    Object.assign(state.target, { x: d.targetX, y: d.targetY, z: d.targetZ });
    ready = true;
    return state;
  }

  function step(dt, car, wide = false) {
    if (!ready || Math.hypot(car.x - previous.x, car.z - previous.z) > 38) return reset(car, wide);
    dt = clamp(dt || 0, 0, .1);
    if (dt === 0) return state;
    clock += dt;
    unwrappedYaw += angle(car.yaw - previous.yaw);
    history.push({ time: clock, yaw: unwrappedYaw });
    const delayTime = clock - .12;
    while (history.length > 2 && history[1].time <= delayTime) history.shift();
    const a = history[0], b = history[1];
    const fraction = clamp((delayTime - a.time) / Math.max(.0001, b.time - a.time), 0, 1);
    const delayedYaw = a.yaw + (b.yaw - a.yaw) * fraction;
    state.yaw += angle(delayedYaw - state.yaw) * blend(dt, .22);
    // A very fast spin still leaves the view in the rear hemisphere.
    state.yaw = car.yaw - clamp(angle(car.yaw - state.yaw), -1.05, 1.05);
    distance += ((wide ? 34 : 23) - distance) * blend(dt, .42);
    height += ((wide ? 23 : 14) - height) * blend(dt, .42);
    const d = desired(car, wide), p = state.position, target = state.target;
    const positional = blend(dt, .095);
    p.x += (d.x - p.x) * positional; p.z += (d.z - p.z) * positional;
    p.y += (d.y - p.y) * blend(dt, .16);
    p.y = Math.max(p.y, ground(p.x, p.z) + 4.2);
    target.x += (d.targetX - target.x) * blend(dt, .07);
    target.y += (d.targetY - target.y) * blend(dt, .2);
    target.z += (d.targetZ - target.z) * blend(dt, .07);
    previous = { x: car.x, z: car.z, yaw: car.yaw };
    return state;
  }
  return { reset, step };
}
