import assert from 'node:assert/strict';
import { createSimulation, PHYSICS } from '../js/simulation.js';
import { generateTrack } from '../js/track.js';

const dt = 1 / 60;
const mod = p => ((p % 1) + 1) % 1;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const check = (name, fn) => Promise.resolve().then(fn).then(() => console.log(`PASS ${name}`));

function circleTrack(radius = 1000, width = 10000) {
  const length = 2 * Math.PI * radius;
  const sample = p => {
    p = mod(p);
    const a = p * 2 * Math.PI;
    return { x: radius * Math.sin(a), y: 0, z: radius * Math.cos(a), progress: p,
      tangent: { x: Math.cos(a), z: -Math.sin(a) } };
  };
  return {
    seed: 'test-circle', length, width, routes: [], boosts: [], decorations: [],
    sample, heightAt: () => 0,
    nearest: (x, z) => ({ ...sample(mod(Math.atan2(x, z) / (2 * Math.PI))),
      distance: Math.abs(Math.hypot(x, z) - radius), width, routeId: 'main' }),
  };
}
function isolate(sim) {
  for (const car of sim.cars.slice(1)) { car.body.setEnabled(false); car.finished = true; car.finishTime = 0; }
}
function place(car, x, z, yaw = 0, speed = 0, groundY = 0) {
  car.body.setTranslation({ x, y: groundY + PHYSICS.rideHeight, z }, true);
  car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  car.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
function advance(sim, seconds, input = {}) {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.step(dt, input);
}
function follow(sim, track, from, to, useRoutes = false) {
  const increment = 0.7 / track.length;
  for (let absolute = from + increment; absolute <= to + increment * 0.01; absolute += increment) {
    const p = mod(absolute);
    const route = useRoutes && track.routes.find(r => p >= r.start && p <= r.end);
    const s = track.sample(p, route ? route.id : 'main');
    place(sim.player, s.x, s.z, Math.atan2(s.tangent.x, s.tangent.z), 0, s.y);
    sim.step(dt, {});
  }
}

await check('acceleration, top speed, progressive braking, reverse, reset', async () => {
  const sim = await createSimulation(circleTrack());
  isolate(sim);
  advance(sim, 3, { throttle: 1 });
  assert.ok(sim.player.speed > 29, `speed after 3 seconds: ${sim.player.speed}`);
  advance(sim, 6, { throttle: 1 });
  assert.ok(sim.player.speed > 32 && sim.player.speed <= PHYSICS.topSpeed + 1);
  advance(sim, 2.5, { brake: 1 });
  assert.ok(sim.player.speed < 6, `braking speed: ${sim.player.speed}`);
  advance(sim, 2, { brake: 1 });
  assert.ok(sim.player.speed < -5 && sim.player.speed > -10, `reverse speed: ${sim.player.speed}`);
  sim.reset();
  assert.equal(sim.time, 0);
  assert.equal(sim.player.speed, 0);
  assert.equal(sim.player.lap, 1);
  assert.equal(sim.position, 6);
  assert.equal(sim.player.lapTimes.length, 0);
  sim.dispose();
});

await check('road elevation costs momentum uphill and adds it downhill', async () => {
  const speeds = [];
  for (const grade of [0.12, 0, -0.12]) {
    const track = circleTrack();
    track.heightAt = (x, z) => z * grade;
    const sim = await createSimulation(track);
    isolate(sim);
    place(sim.player, 0, 0, 0, 20);
    advance(sim, 2, {});
    speeds.push(sim.player.speed);
    assert.ok(Math.abs(sim.player.grade - grade) < 1e-8);
    sim.player.finished = true;
    place(sim.player, 0, 0);
    advance(sim, 2, {});
    assert.ok(Math.abs(sim.player.speed) < 0.01, 'finished cars should hold a parking brake on hills');
    sim.dispose();
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `uphill / flat / downhill: ${speeds}`);
  assert.ok(speeds[2] - speeds[0] > 3, `slope should materially affect coasting momentum: ${speeds}`);
});

await check('handbrake creates controllable lateral slip; grip recovers', async () => {
  const slips = [];
  for (const drift of [false, true]) {
    const sim = await createSimulation(circleTrack());
    isolate(sim);
    advance(sim, 3, { throttle: 1 });
    advance(sim, 0.8, { throttle: 1, steer: 0.65, drift });
    const c = sim.player;
    const slip = Math.abs(wrapAngle(Math.atan2(c.vx, c.vz) - c.yaw));
    slips.push(slip);
    if (drift) {
      assert.ok(c.drift);
      advance(sim, 2, { throttle: 1 });
      const recovered = Math.abs(wrapAngle(Math.atan2(c.vx, c.vz) - c.yaw));
      assert.ok(recovered < slip * 0.35, `slip did not recover: ${recovered} vs ${slip}`);
    }
    sim.dispose();
  }
  assert.ok(slips[1] > slips[0] * 1.5 && slips[1] > 0.35, `slip grip/drift ${slips}`);
});

await check('road materials change acceleration, top speed, and tire slip', async () => {
  const results = [];
  for (const surface of ['asphalt', 'gravel', 'dirt', 'sand']) {
    const track = circleTrack();
    track.surfaceAt = () => surface;
    const sim = await createSimulation(track);
    isolate(sim);
    advance(sim, 30, { throttle: 1 });
    const topSpeed = sim.player.speed;
    const traction = sim.player.traction;
    assert.equal(sim.player.surface, surface);
    place(sim.player, 0, 0, 0, 22);
    sim.player.body.setLinvel({ x: 10, y: 0, z: 22 }, true);
    advance(sim, 0.4, {});
    results.push({ surface, topSpeed, traction, slip: Math.abs(sim.player.vx) });
    sim.dispose();
  }
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].topSpeed < results[i - 1].topSpeed, `looser surfaces reduce speed: ${JSON.stringify(results)}`);
    assert.ok(results[i].traction < results[i - 1].traction);
    assert.ok(results[i].slip > results[i - 1].slip, `looser tires retain more lateral slip: ${JSON.stringify(results)}`);
  }
  assert.ok(Math.abs(results[0].topSpeed * 3.6 - 250) < 0.25, `asphalt actually reaches 250 km/h: ${results[0].topSpeed * 3.6}`);
  assert.ok(Math.abs(PHYSICS.topSpeed * 3.6 - 250) < 1e-9);
  assert.ok(results[0].topSpeed - results[3].topSpeed > 7, 'sand has a meaningful speed penalty');
  assert.ok(results[3].slip > results[0].slip * 1.8, 'sand visibly loosens the rear tires');
});

await check('alternate road and off-road terrain determine tire contact material', async () => {
  const track = generateTrack('RAZER', 'desert');
  const sim = await createSimulation(track);
  isolate(sim);
  const route = track.routes[0], sample = track.sample((route.start + route.end) / 2, route.id);
  place(sim.player, sample.x, sample.z, Math.atan2(sample.tangent.x, sample.tangent.z), 0, sample.y);
  sim.step(dt);
  assert.equal(sim.player.routeId, route.id);
  assert.equal(sim.player.surface, track.surfaceAt(sample.progress, route.id));
  const shoulder = track.sample(0.4);
  const x = shoulder.x + shoulder.tangent.z * 20, z = shoulder.z - shoulder.tangent.x * 20;
  place(sim.player, x, z, 0, 0, track.heightAt(x, z));
  sim.step(dt);
  assert.ok(sim.player.offRoad);
  assert.equal(sim.player.surface, track.terrainAt(x, z).surface);
  assert.ok(sim.player.traction < 0.7);
  sim.dispose();
});

await check('four independent tires resolve split surfaces and partial ground contact', async () => {
  const split = circleTrack();
  split.nearest = (x, z) => ({ x, y: 0, z, distance: 0, progress: x < 0 ? 0.25 : 0.75, width: split.width, routeId: 'main' });
  split.surfaceAt = p => p < 0.5 ? 'asphalt' : 'sand';
  const sim = await createSimulation(split);
  isolate(sim);
  place(sim.player, 0, 0, 0, 20);
  sim.player.body.setLinvel({ x: 10, y: 0, z: 20 }, true);
  sim.step(dt);
  assert.equal(sim.player.wheels.length, 4);
  const asphalt = sim.player.wheels.filter(w => w.surface === 'asphalt');
  const sand = sim.player.wheels.filter(w => w.surface === 'sand');
  assert.equal(asphalt.length, 2); assert.equal(sand.length, 2);
  assert.ok(sim.player.wheels.every(w => w.contact && w.load > 1000));
  assert.ok(Math.abs(asphalt[0].lateralForce) > Math.abs(sand[0].lateralForce) * 1.5, 'each tire resolves its own grip and lateral force');
  sim.dispose();
  for (const expected of [1, 2]) {
    const track = circleTrack();
    track.heightAt = (x, z) => x > 0.2 && (expected === 2 || z > 0.2) ? 0 : -6;
    const partial = await createSimulation(track);
    isolate(partial);
    place(partial.player, 0, 0);
    partial.step(dt);
    assert.equal(partial.player.groundedWheels, expected);
    assert.equal(partial.player.wheels.filter(w => w.contact).length, expected);
    assert.ok(partial.player.wheels.filter(w => !w.contact).every(w => w.load === 0 && w.longitudinalForce === 0 && w.lateralForce === 0));
    advance(partial, 0.12);
    assert.ok(partial.player.roll > 0.02, 'off-center wheel support physically rotates the rigid chassis');
    partial.dispose();
  }
});

await check('leaving more than 30 meters beyond a road edge recovers validated progress', async () => {
  const track = circleTrack(40, 12);
  const sim = await createSimulation(track);
  isolate(sim);
  const safeProgress = sim.player._safeProgress, nextGate = sim.player._nextGate;
  place(sim.player, 40 + track.width / 2 + 29, 0);
  sim.step(dt);
  assert.ok(!sim.events.some(event => event.type === 'recover'), '29 meters beyond the edge remains inside the limit');
  place(sim.player, 40 + track.width / 2 + 31, 0);
  sim.step(dt);
  assert.ok(sim.events.some(event => event.type === 'recover' && event.reason === 'offtrack' && event.carId === 0));
  assert.ok(Math.abs(sim.player.progress - safeProgress) < 1e-8, 'recovery returns to the last validated road point');
  assert.equal(sim.player._nextGate, nextGate);
  assert.equal(sim.player.lap, 1);
  sim.dispose();
});

await check('gravity, four-wheel suspension, and landing restore a dropped chassis', async () => {
  const sim = await createSimulation(circleTrack());
  isolate(sim);
  place(sim.player, 0, 0, 0, 0, 5);
  const startY = sim.player.body.translation().y;
  advance(sim, 0.25, { throttle: 1 });
  assert.ok(sim.player.airborne);
  assert.equal(sim.player.groundedWheels, 0);
  assert.ok(sim.player.vy < -2, 'gravity accelerates the chassis downward');
  assert.ok(sim.player.body.translation().y < startY - 0.25);
  assert.ok(Math.abs(sim.player.speed) < 0.01, 'airborne tires cannot propel the chassis');
  advance(sim, 2.5, {});
  assert.ok(!sim.player.airborne && sim.player.groundedWheels === 4);
  assert.ok(Math.abs(sim.player.body.translation().y - PHYSICS.rideHeight) < 0.04, 'springs settle at ride height');
  assert.ok(Math.abs(sim.player.vy) < 0.1);
  assert.ok(sim.player.suspension > 0, 'tires support chassis weight through spring compression');
  assert.ok(sim.events.some(event => event.type === 'land' && event.carId === 0 && event.verticalSpeed < -4));
  sim.dispose();
});

await check('a fast crest launches the car and preserves airborne forward momentum', async () => {
  const track = circleTrack();
  track.heightAt = (x, z) => 2.6 * Math.exp(-((z / 12) ** 2));
  const sim = await createSimulation(track);
  isolate(sim);
  place(sim.player, 0, -24, 0, 34, track.heightAt(0, -24));
  sim.player.boost = 5;
  let airborneTicks = 0, maximumClearance = 0;
  for (let i = 0; i < 180; i++) {
    sim.step(dt, { throttle: 1 });
    if (sim.player.airborne) {
      airborneTicks++;
      maximumClearance = Math.max(maximumClearance, sim.player.y - track.heightAt(sim.player.x, sim.player.z));
      assert.ok(sim.player.speed > 20, 'jump retains forward inertia');
    }
  }
  assert.ok(airborneTicks > 12, `crest must produce a sustained jump: ${airborneTicks}`);
  assert.ok(maximumClearance > 0.5, `jump needs physical ground clearance: ${maximumClearance}`);
  assert.ok(sim.events.some(event => event.type === 'land' && event.carId === 0));
  sim.dispose();
});

await check('river water creates drag and automatically recovers submerged drivers', async () => {
  for (const environment of ['desert', 'jungle', 'beach', 'mountains']) {
    const track = generateTrack('RAZER', environment);
    const sim = await createSimulation(track);
    isolate(sim);
    const river = track.river.points.find(p => track.nearest(p.x, p.z).distance < track.width / 2 + 27);
    place(sim.player, river.x, river.z, 0, 8, track.heightAt(river.x, river.z));
    advance(sim, 1, { throttle: 1 });
    assert.ok(sim.player.inWater, `${environment}: contact with water is reported`);
    assert.ok(Math.abs(sim.player.speed) < 2, `${environment}: water strongly resists driving`);
    advance(sim, 0.75, {});
    assert.ok(!sim.player.inWater, `${environment}: recovery returns the player to dry road`);
    assert.ok(track.nearest(sim.player.x, sim.player.z).distance < 1);
    assert.ok(sim.events.some(event => event.type === 'recover' && event.carId === 0 && event.reason === 'water'));
    assert.equal(sim.player.lap, 1, 'water recovery awards no race progress');
    sim.dispose();
  }
  const beach = generateTrack('OCEAN', 'beach');
  const sim = await createSimulation(beach);
  isolate(sim);
  const x = beach.bounds.maxX + 50, z = 0;
  place(sim.player, x, z, 0, 0, beach.heightAt(x, z));
  advance(sim, 1.7, {});
  assert.ok(sim.events.some(event => event.type === 'recover' && event.carId === 0 && ['water', 'offtrack'].includes(event.reason)), 'ocean also recovers a submerged player');
  sim.dispose();
});

await check('Rapier scenery collisions stop penetration and create impact events', async () => {
  const track = circleTrack();
  track.decorations = [{ type: 'rock', x: 0, y: 0, z: 12, radius: 3 }];
  const sim = await createSimulation(track);
  isolate(sim);
  place(sim.player, 0, 0, 0, 25);
  advance(sim, 1.1, {});
  assert.ok(sim.player.z < 8, `penetrated boulder: ${sim.player.z}`);
  assert.ok(sim.events.some(e => e.type === 'collision' && e.carId === 0));
  assert.ok(sim.player.speed < 8);
  assert.ok(Math.abs(sim.player.body.translation().y - PHYSICS.rideHeight) < 0.03, 'suspension retains ride height during a horizontal impact');
  sim.dispose();
});

await check('scenery contacts respect terrain elevation and airborne clearance', async () => {
  const raised = circleTrack();
  raised.heightAt = () => 12;
  raised.decorations = [{ type: 'rock', x: 0, y: 12, z: 12, radius: 3, scale: 1 }];
  const sim = await createSimulation(raised);
  isolate(sim);
  place(sim.player, 0, 0, 0, 25, 12);
  advance(sim, 0.8, {});
  assert.ok(sim.player.z < 8, 'a boulder collides at its actual hill elevation');
  assert.ok(sim.events.some(event => event.type === 'collision' && event.carId === 0));
  sim.dispose();
  const flat = circleTrack();
  flat.decorations = [{ type: 'rock', x: 0, y: 0, z: 12, radius: 3, scale: 1 }];
  const jumping = await createSimulation(flat);
  isolate(jumping);
  place(jumping.player, 0, 0, 0, 25, 8);
  advance(jumping, 0.9, {});
  assert.ok(jumping.player.z > 18, 'a high jump clears the same low obstacle');
  assert.ok(!jumping.events.some(event => event.type === 'collision' && event.carId === 0));
  jumping.dispose();
});

await check('Rapier rival contacts exchange momentum', async () => {
  const sim = await createSimulation(circleTrack());
  isolate(sim);
  const rival = sim.cars[1];
  rival.body.setEnabled(true);
  place(sim.player, 0, 0, 0, 25);
  place(rival, 0, 7, 0, 0);
  advance(sim, 0.25, {});
  assert.ok(rival.vz > 5, `rival did not receive momentum: ${rival.vz}`);
  assert.ok(sim.player.vz < 20, `player kept collision momentum: ${sim.player.vz}`);
  assert.ok(sim.events.some(e => e.type === 'collision' && e.otherId === 1));
  sim.dispose();
});

await check('higher-speed impacts transfer more momentum and use relative impact intensity', async () => {
  const results = [];
  for (const speed of [15, 55]) {
    const sim = await createSimulation(circleTrack());
    isolate(sim);
    const rival = sim.cars[1]; rival.body.setEnabled(true);
    place(sim.player, 0, 0, 0, speed); place(rival, 0, 7);
    advance(sim, 0.35);
    const hit = sim.events.find(event => event.type === 'collision' && event.carId === 0 && event.otherId === 1);
    assert.ok(hit);
    results.push({ speed: rival.vz, displacement: rival.z - 7, intensity: hit.intensity, closing: hit.relativeSpeed });
    sim.dispose();
  }
  assert.ok(results[1].speed > results[0].speed + 12, `a fast impact shoves the rival harder: ${JSON.stringify(results)}`);
  assert.ok(results[1].displacement > results[0].displacement * 2);
  assert.ok(results[1].intensity > results[0].intensity * 2 && results[1].closing > results[0].closing * 2);
  const together = await createSimulation(circleTrack());
  isolate(together);
  const rival = together.cars[1]; rival.body.setEnabled(true);
  place(together.player, 0, 0, 0, 30); place(rival, 0, 4.1, 0, 30);
  together.step(dt);
  assert.ok(!together.events.some(event => event.type === 'collision' && event.carId === 0), 'matching-speed contact does not invent a high-speed impact');
  together.dispose();
});

await check('five-second boost renews, cooldown is shared, and speed increases', async () => {
  const track = circleTrack();
  const sim = await createSimulation(track);
  isolate(sim);
  advance(sim, 5, { throttle: 1 });
  const ordinarySpeed = sim.player.speed;
  sim.pickups.push({ id: 0, x: sim.player.x, z: sim.player.z, active: true, cooldown: 0 });
  sim.step(dt, { throttle: 1 });
  assert.equal(sim.player.boost, 5);
  assert.equal(sim.pickups[0].active, false);
  assert.equal(sim.pickups[0].cooldown, 8);
  advance(sim, 3, { throttle: 1 });
  assert.ok(sim.player.speed > ordinarySpeed + 8);
  assert.ok(Math.abs(sim.player.boost - 2) < 1e-8);
  sim.pickups.push({ id: 1, x: sim.player.x, z: sim.player.z, active: true, cooldown: 0 });
  sim.step(dt, { throttle: 1 });
  assert.equal(sim.player.boost, 5, 'fresh pickup should renew, not stack boost duration');
  advance(sim, 5 + dt, { throttle: 1 });
  assert.equal(sim.player.boost, 0);
  assert.equal(sim.pickups[0].active, true);
  sim.dispose();

  const shared = await createSimulation(circleTrack());
  isolate(shared);
  const rival = shared.cars[1];
  rival.finished = false;
  place(rival, 100, 100);
  // Disabled physics body still retains its stationary location for an exact pickup assertion.
  shared.pickups.push({ id: 0, x: 100, z: 100, active: true, cooldown: 0 });
  shared.step(dt, {});
  assert.equal(rival.boost, 5, 'AI uses the same pickup rules');
  assert.equal(shared.player.boost, 0);
  place(shared.player, 100, 100);
  shared.step(dt, {});
  assert.equal(shared.player.boost, 0, 'consumed pickup must stay unavailable to another car');
  shared.dispose();
});

await check('start crossing is not a lap; three ordered laps finish with times', async () => {
  const track = circleTrack(40, 12);
  const sim = await createSimulation(track);
  isolate(sim);
  const start = sim.player.progress;
  follow(sim, track, start, 1.015);
  assert.equal(sim.player.lap, 1);
  assert.equal(sim.player.lapTimes.length, 0);
  assert.ok(sim.player._started);
  follow(sim, track, 1.015, 2.015);
  assert.equal(sim.player.lap, 2);
  assert.equal(sim.player.lapTimes.length, 1);
  follow(sim, track, 2.015, 4.015);
  assert.equal(sim.player.finished, true);
  assert.equal(sim.finished, true);
  assert.equal(sim.player.totalProgress, 3);
  assert.equal(sim.player.lapTimes.length, 3);
  assert.ok(sim.player.lapTimes.every(t => t > 0));
  assert.ok(Math.abs(sim.player.lapTimes.reduce((a, b) => a + b, 0) - sim.player.finishTime) < 1e-8);
  assert.equal(sim.events.filter(e => e.type === 'finish' && e.carId === 0).length, 1);
  sim.dispose();
});

await check('teleports / omitted checkpoints cannot score laps; recovery preserves validation', async () => {
  const track = circleTrack(60, 12);
  const sim = await createSimulation(track);
  isolate(sim);
  follow(sim, track, sim.player.progress, 1.035);
  for (let circuit = 0; circuit < 4; circuit++) {
    for (let gate = 1; gate <= 16; gate++) {
      const s = track.sample(gate / 16 + 0.005);
      place(sim.player, s.x, s.z);
      sim.step(dt, {});
    }
  }
  assert.equal(sim.player.lap, 1);
  assert.equal(sim.player.lapTimes.length, 0);
  assert.ok(sim.player.totalProgress < 0.063);
  const lastGate = (sim.player._nextGate - 1) / PHYSICS.checkpoints;
  assert.ok(sim.recover());
  assert.ok(sim.player.progress >= lastGate && sim.player.progress < lastGate + 0.035);
  assert.equal(sim.player.boost, 0);
  assert.equal(sim.recover(), false, 'recovery cooldown blocks repeated resets');
  assert.ok(sim.events.some(e => e.type === 'recover'));
  sim.dispose();
});

await check('mapped alternate routes count toward the same ordered lap', async () => {
  const track = generateTrack('RAZER', 'desert');
  const sim = await createSimulation(track);
  isolate(sim);
  follow(sim, track, sim.player.progress, 4.015, true);
  assert.ok(sim.player.finished, `alternate route lap stuck: ${sim.player.lap}, gate ${sim.player._nextGate}`);
  assert.equal(sim.player.lapTimes.length, 3);
  sim.dispose();
});

await check('all five AI drivers complete varied seeded circuits using shared physics', async () => {
  const seeds = ['RAZER', 'IGNITION', 'NIGHTSHIFT'];
  const environments = ['desert', 'jungle', 'beach', 'mountains'];
  let finishers = 0, alternativeTicks = 0;
  for (const seed of seeds) {
    for (const environment of environments) {
      const track = generateTrack(seed, environment);
      const sim = await createSimulation(track);
      const pickups = new Set();
      for (let i = 0; i < 60 * 210 && !sim.cars.slice(1).every(c => c.finished); i++) {
        sim.step(dt, {});
        for (const c of sim.cars.slice(1)) if (c.routeId !== 'main') alternativeTicks++;
        for (const event of sim.events) if (event.type === 'boost' && event.carId > 0) pickups.add(event.carId);
        sim.events.length = 0;
      }
      assert.ok(sim.cars.slice(1).every(c => c.finished), `${seed}/${environment}: ${JSON.stringify(sim.cars.slice(1).map(c => ({ id: c.id, lap: c.lap, gate: c._nextGate, p: c.progress })))}`);
      assert.ok(pickups.size >= 3, `too few AI collected boosts: ${seed}/${environment}`);
      assert.equal(new Set(sim.cars.map(c => c.rank)).size, 6);
      finishers += 5;
      sim.dispose();
    }
  }
  assert.ok(alternativeTicks > 1000, 'AI did not use alternate roads');
  console.log(`  ${finishers} AI finishes across 12 circuits; ${alternativeTicks} alternate-route ticks`);
});

console.log('Simulation checks complete.');
