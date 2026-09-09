import assert from 'node:assert/strict';
import { createSimulation, PHYSICS } from '../js/simulation.js';

const dt = 1 / 60;
const degrees = radians => radians * 180 / Math.PI;
const wrapped = radians => Math.atan2(Math.sin(radians), Math.cos(radians));
const failures = [];
const verify = (condition, message) => { if (!condition) failures.push(message); };
const round = value => Math.round(value * 1000) / 1000;
const report = (name, values) => { if (process.argv.includes('--report')) console.log(`${name}:`, JSON.stringify(values)); };

function testGround(surface = 'asphalt', heightAt = () => 0) {
  return {
    seed: 'handling-test-ground', width: 20000, length: 100000,
    routes: [], boosts: [], decorations: [], surfaceAt: () => surface,
    terrainAt: () => ({ surface: 'grass', forest: 0, moisture: 0 }), heightAt,
    sample: progress => ({ x: 0, y: heightAt(0, 0), z: 0, progress, tangent: { x: 0, z: 1 } }),
    nearest: (x, z) => ({ x, y: heightAt(x, z), z, distance: 0, progress: ((z / 100000) % 1 + 1) % 1,
      width: 20000, routeId: 'main', tangent: { x: 0, z: 1 } }),
  };
}

async function scenario({ surface = 'asphalt', kmh, steer, duration, release = 1, drift = false, heightAt = () => 0 }) {
  const track = testGround(surface, heightAt), sim = await createSimulation(track);
  for (const car of sim.cars.slice(1)) { car.body.setEnabled(false); car.finished = true; car.finishTime = 0; }
  const car = sim.player;
  car.body.setTranslation({ x: 0, y: heightAt(0, 0) + PHYSICS.rideHeight, z: 0 }, true);
  // Begin tangent to the test road, so suspension checks measure continuous
  // travel instead of an artificial landing onto a slope at the first step.
  const initialGrade = (heightAt(0, 0.1) - heightAt(0, -0.1)) / 0.2;
  const initialPitch = Math.atan(initialGrade);
  car.body.setRotation({ x: -Math.sin(initialPitch / 2), y: 0, z: 0, w: Math.cos(initialPitch / 2) }, true);
  car.body.setLinvel({ x: 0, y: initialGrade * kmh / 3.6, z: kmh / 3.6 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  let peakSlip = 0, peakLateral = 0, peakYawRate = 0, peakRoll = 0, peakPitch = 0;
  let lostContact = 0, minimumContacts = 4, peakRideError = 0, peakLoadRatio = 0;
  let turnHeading = 0, turnSpeed = 0, turnSlip = 0, releaseHeading = 0;
  const holdSteps = Math.round(duration / dt), totalSteps = holdSteps + Math.round(release / dt);
  for (let i = 0; i < totalSteps; i++) {
    sim.step(dt, { steer: i < holdSteps ? steer : 0, drift: i < holdSteps && drift });
    const slip = Math.abs(wrapped(Math.atan2(car.vx, car.vz) - car.yaw));
    const lateral = Math.abs(car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw));
    peakRoll = Math.max(peakRoll, Math.abs(car.roll)); peakPitch = Math.max(peakPitch, Math.abs(car.pitch));
    minimumContacts = Math.min(minimumContacts, car.groundedWheels);
    if (car.groundedWheels < 4) lostContact++;
    peakRideError = Math.max(peakRideError, Math.abs(car.y - heightAt(car.x, car.z)));
    peakLoadRatio = Math.max(peakLoadRatio, ...car.wheels.map(w => w.load / (PHYSICS.mass * PHYSICS.gravity / 4)));
    if (i < holdSteps) {
      peakSlip = Math.max(peakSlip, slip); peakLateral = Math.max(peakLateral, lateral);
      peakYawRate = Math.max(peakYawRate, Math.abs(car.body.angvel().y));
      turnHeading = car.yaw; turnSpeed = car.speed * 3.6; turnSlip = slip;
    }
    if (i === holdSteps) releaseHeading = car.yaw;
  }
  const finalSlip = Math.abs(wrapped(Math.atan2(car.vx, car.vz) - car.yaw));
  const result = { surface, kmh, steer, drift, peakSlipDeg: round(degrees(peakSlip)), lateralMps: round(peakLateral),
    yawRate: round(peakYawRate), lateralTravel: round(car.x), turnDeg: round(degrees(turnHeading)), turnKmh: round(turnSpeed), turnSlipDeg: round(degrees(turnSlip)),
    releaseSlipDeg: round(degrees(finalSlip)), releaseYawRate: round(Math.abs(car.body.angvel().y)),
    releaseTurnDeg: round(degrees(wrapped(car.yaw - releaseHeading))), rollDeg: round(degrees(peakRoll)), pitchDeg: round(degrees(peakPitch)),
    minimumContacts, lostContactFraction: round(lostContact / totalSteps), rideError: round(peakRideError), loadRatio: round(peakLoadRatio) };
  sim.dispose();
  return result;
}

const moderate = [];
for (const surface of ['asphalt', 'sand']) for (const kmh of [30, 60, 100]) {
  const r = await scenario({ surface, kmh, steer: 0.35, duration: 1.5 });
  moderate.push(r);
  const label = `${surface}/${kmh}kmh moderate steering`;
  verify(r.peakSlipDeg < (surface === 'asphalt' ? 12 : 18), `${label}: normal steering should track the car heading (${r.peakSlipDeg}° slip)`);
  verify(r.turnDeg > 5 && r.turnDeg < 100, `${label}: steering should turn promptly without spinning (${r.turnDeg}°)`);
  verify(r.releaseSlipDeg < 4, `${label}: grip should settle after release (${r.releaseSlipDeg}° residual slip)`);
  verify(r.releaseYawRate < 0.1, `${label}: steering release should stop sustained yaw (${r.releaseYawRate}rad/s)`);
  verify(r.turnKmh > kmh * 0.6, `${label}: ordinary turning should preserve useful forward speed (${r.turnKmh}km/h)`);
  verify(r.minimumContacts >= 3 && r.lostContactFraction < 0.03, `${label}: normal cornering should retain tire contact`);
  verify(r.rollDeg < 15 && r.pitchDeg < 12, `${label}: chassis should stay composed (${r.rollDeg}° roll, ${r.pitchDeg}° pitch)`);
}
report('Moderate steering', moderate);

const taps = [];
for (const surface of ['asphalt', 'sand']) for (const kmh of [60, 100, 180]) {
  const r = await scenario({ surface, kmh, steer: 1, duration: 0.45, release: 0.9 });
  taps.push(r);
  const label = `${surface}/${kmh}kmh keyboard turn`;
  verify(r.peakSlipDeg < (surface === 'asphalt' ? 16 : 22), `${label}: a short steering keypress should not initiate a slide (${r.peakSlipDeg}° slip)`);
  verify(r.turnDeg > 1.5 && r.turnDeg < 65 && r.lateralTravel > 1, `${label}: a short turn should make a useful lane correction without spinning (${r.turnDeg}°, ${r.lateralTravel}m sideways travel)`);
  verify(r.releaseSlipDeg < 5 && r.releaseYawRate < 0.12, `${label}: releasing the key should recover direction`);
  verify(r.minimumContacts >= 3 && r.rollDeg < 18, `${label}: a short turn should not lift the chassis`);
}
report('Keyboard taps', taps);

const sustained = [];
for (const surface of ['asphalt', 'sand']) {
  const r = await scenario({ surface, kmh: 100, steer: 1, duration: 1.2, release: 1.2 });
  sustained.push(r);
  verify(r.peakSlipDeg < (surface === 'asphalt' ? 18 : 25), `${surface}/100kmh sustained keyboard steering should tighten the path without automatic drifting (${r.peakSlipDeg}° slip)`);
  verify(r.turnDeg > 15 && r.turnDeg < 100, `${surface}/100kmh sustained steering should turn without rotating through the intended path (${r.turnDeg}°)`);
  verify(r.turnKmh > 50, `${surface}/100kmh sustained steering should retain forward progress (${r.turnKmh}km/h)`);
  verify(r.releaseSlipDeg < 6, `${surface}/100kmh sustained steering should recover when released (${r.releaseSlipDeg}°)`);
}
report('Sustained keyboard steering', sustained);

const normal = await scenario({ kmh: 90, steer: 0.45, duration: 1.2, release: 1.5 });
const drift = await scenario({ kmh: 90, steer: 0.45, duration: 1.2, release: 1.5, drift: true });
verify(normal.peakSlipDeg < 14, `handbrake comparison: ordinary steering should retain grip (${normal.peakSlipDeg}°)`);
verify(drift.peakSlipDeg > normal.peakSlipDeg * 1.5 && drift.peakSlipDeg > 15, 'deliberate handbrake should produce substantially more slip than ordinary steering');
verify(drift.releaseSlipDeg < 7 && drift.releaseYawRate < 0.15, 'releasing the handbrake should recover stable tire grip');
report('Drift comparison', { normal, drift });

// A glancing, low-relative-speed bumper contact should give a small nudge,
// while the driver retains enough tire grip to steer clear and settle afterward.
const bumperTrack = testGround();
bumperTrack.sample = progress => ({ x: 0, y: 0, z: (progress > 0.5 ? progress - 1 : progress) * bumperTrack.length,
  progress, tangent: { x: 0, z: 1 } });
const bumpSim = await createSimulation(bumperTrack);
for (const car of bumpSim.cars.slice(1)) { car.body.setEnabled(false); car.finished = true; car.finishTime = 0; }
const bumper = bumpSim.cars[1]; bumper.body.setEnabled(true); bumper.finished = false;
for (const [car, x, z, speed] of [[bumpSim.player, 0, 0, 20], [bumper, -1.8, 4.25, 16]]) {
  car.body.setTranslation({ x, y: PHYSICS.rideHeight, z }, true);
  car.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  car.body.setLinvel({ x: 0, y: 0, z: speed }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
bumpSim.step(dt);
const lightHit = bumpSim.events.find(event => event.type === 'collision' && event.carId === 0 && event.otherId === 1);
verify(Boolean(lightHit) && lightHit.relativeSpeed > 2.5 && lightHit.relativeSpeed < 8,
  `bumper-contact fixture must create a real, light Rapier collision (${lightHit?.relativeSpeed ?? 'none'}m/s)`);
let bumpPeakSlip = 0, bumpMinimumGrip = 1, bumpContacts = 4;
for (let i = 0; i < 90; i++) {
  bumpSim.step(dt, { steer: i < 27 ? 0.45 : 0 });
  const car = bumpSim.player;
  bumpPeakSlip = Math.max(bumpPeakSlip, Math.abs(wrapped(Math.atan2(car.vx, car.vz) - car.yaw)));
  bumpMinimumGrip = Math.min(bumpMinimumGrip, ...car.wheels.filter(w => w.contact).map(w => w.traction));
  bumpContacts = Math.min(bumpContacts, car.groundedWheels);
}
const bumpResidualSlip = Math.abs(wrapped(Math.atan2(bumpSim.player.vx, bumpSim.player.vz) - bumpSim.player.yaw));
verify(bumpMinimumGrip > 0.8, `a light bumper nudge should retain most asphalt tire grip (${round(bumpMinimumGrip)})`);
verify(degrees(bumpPeakSlip) < 10, `light contact followed by ordinary steering should not trigger a spin (${round(degrees(bumpPeakSlip))}°)`);
verify(degrees(bumpResidualSlip) < 3 && Math.abs(bumpSim.player.body.angvel().y) < 0.1,
  'the car should settle after steering clear of a light bumper contact');
verify(bumpContacts >= 3, 'a light bumper nudge should keep the chassis planted');
report('Light bumper recovery', { relativeSpeed: round(lightHit?.relativeSpeed ?? 0), intensity: round(lightHit?.intensity ?? 0),
  minimumGrip: round(bumpMinimumGrip), peakSlipDeg: round(degrees(bumpPeakSlip)), residualSlipDeg: round(degrees(bumpResidualSlip)) });
bumpSim.dispose();

const rolling = await scenario({ kmh: 100, steer: 0, duration: 4, release: 0,
  heightAt: (x, z) => 0.3 * Math.sin(z * Math.PI * 2 / 50) });
verify(rolling.minimumContacts >= 3 && rolling.lostContactFraction < 0.08, `gentle rolling road should not create unexplained contact loss (${rolling.lostContactFraction})`);
verify(rolling.rideError < 0.3, `suspension should follow gentle road relief (${rolling.rideError}m ride-height error)`);
verify(rolling.rollDeg < 2 && rolling.pitchDeg < 10, 'symmetric road undulation should not induce roll or violent pitch');
verify(rolling.loadRatio < 2.5, `gentle hills should not create impact-like wheel loads (${rolling.loadRatio}× static load)`);
report('Rolling-road suspension', rolling);

for (const failure of failures) console.error(`FAIL ${failure}`);
if (!process.argv.includes('--report')) assert.equal(failures.length, 0, `${failures.length} handling regressions`);
console.log(`Handling checks: ${failures.length} failures across moderate turns, keyboard taps, drift, and suspension.`);
