import RAPIER from '../assets/vendor/rapier/rapier.mjs';

// Rapier integrates chassis momentum in all three axes and resolves car/scenery
// contacts. Four terrain probes supply independent spring/damper suspension forces;
// a steering assist keeps the four-wheel rally handling recoverable after impacts.
export const PHYSICS = Object.freeze({
  timestep: 1 / 60, laps: 3, checkpoints: 16,
  boostDuration: 5, pickupCooldown: 8, pickupRadius: 3.7,
  mass: 850, topSpeed: 250 / 3.6, boostSpeed: 310 / 3.6,
  gravity: 9.81, rideHeight: 1.05, springRate: 26000, suspensionDamping: 1850, suspensionTravel: 0.38,
});
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mod = (x, n = 1) => ((x % n) + n) % n;
const angle = x => mod(x + Math.PI, TAU) - Math.PI;
const quaternion = yaw => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const SURFACES = Object.freeze({
  asphalt: { grip: 1, drive: 1, rolling: 0.11, speed: 1 },
  gravel: { grip: 0.78, drive: 0.92, rolling: 0.16, speed: 0.95 },
  dirt: { grip: 0.70, drive: 0.87, rolling: 0.20, speed: 0.90 },
  sand: { grip: 0.55, drive: 0.78, rolling: 0.36, speed: 0.80 },
  grass: { grip: 0.58, drive: 0.72, rolling: 0.95, speed: 0.68 },
  rock: { grip: 0.56, drive: 0.65, rolling: 0.98, speed: 0.62 },
  water: { grip: 0.15, drive: 0.16, rolling: 3.2, speed: 0.15 },
});
const surfaceProfile = surface => SURFACES[surface] ?? SURFACES.asphalt;
const COLORS = ['#f44729', '#36bde8', '#ffcf4d', '#b286ff', '#eaeae5', '#62ca83'];
const NAMES = ['YOU', 'COBALT', 'VIPER', 'NOVA', 'GHOST', 'FERN'];
let initialization;

export async function createSimulation(track) {
  initialization ||= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = PHYSICS.timestep;
  world.numSolverIterations = 6;
  const queue = new RAPIER.EventQueue(true);
  const colliderCars = new Map();
  let disposed = false;
  const sim = {
    world, cars: [], player: null, time: 0, finished: false, position: 1,
    laps: PHYSICS.laps, events: [], pickups: track.boosts.map((p, id) => ({ ...p, id, active: true, cooldown: 0 })),
    step, reset, recover, dispose,
  };

  // Scenery colliders share the terrain elevation, so a jumping car can clear a
  // low rock while still hitting trees and buildings at the correct height.
  for (const prop of track.decorations) {
    if (!(prop.radius > 0)) continue;
    const scale = prop.scale ?? 1;
    const height = ({ tree: track.environment === 'mountains' ? 8.2 : 6.5, palm: 6.7, cactus: 4.8, building: 6.2, rock: 3 }[prop.type] ?? 3) * scale;
    const radius = prop.type === 'tree' || prop.type === 'palm' ? Math.min(prop.radius, 0.34 * scale) : prop.radius;
    const collider = prop.type === 'building'
      ? RAPIER.ColliderDesc.cuboid(prop.radius * 0.78, height / 2, prop.radius * 0.78)
      : RAPIER.ColliderDesc.cylinder(height / 2, radius);
    collider.setTranslation(prop.x, (prop.y ?? track.heightAt(prop.x, prop.z)) + height / 2, prop.z).setFriction(0.25).setRestitution(0.12);
    if (prop.rotation) collider.setRotation(quaternion(prop.rotation));
    world.createCollider(collider);
  }
  for (let id = 0; id < 6; id++) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .enabledTranslations(true, true, true).enabledRotations(true, true, true)
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(1.8));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.04, 0.6, 2.12)
      .setMassProperties(PHYSICS.mass, { x: 0, y: -0.55, z: 0 },
        { x: 1375, y: 1580, z: 650 }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(0.22).setRestitution(0.23)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const car = {
      id, name: NAMES[id], color: COLORS[id], body,
      x: 0, y: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0,
      steer: 0, drift: false, boost: 0, lap: 1, progress: 0, totalProgress: 0,
      finished: false, finishTime: null, lapTimes: [], rpm: 0, offRoad: false, grade: 0,
      surface: 'asphalt', traction: 1, inWater: false, _waterTime: 0,
      airborne: false, groundedWheels: 4, pitch: 0, roll: 0, suspension: 0, vy: 0,
      rank: id + 1, routeId: 'main', aiRoute: 'main', _pace: 0.945 + id * 0.009,
    };
    colliderCars.set(collider.handle, car);
    sim.cars.push(car);
  }
  sim.player = sim.cars[0];
  reset();
  return sim;

  function reset() {
    if (disposed) return;
    sim.time = 0;
    sim.finished = false;
    sim.events.length = 0;
    for (const p of sim.pickups) { p.cooldown = 0; p.active = true; }
    for (const car of sim.cars) {
      // Player starts in row three. Every car is behind the timing line.
      const order = car.id === 0 ? 5 : car.id - 1;
      const meters = 8 + Math.floor(order / 2) * 6.5 + (order % 2) * 1.2;
      const progress = mod(-meters / track.length);
      const s = track.sample(progress);
      const lane = order % 2 ? 2.55 : -2.55;
      const x = s.x + s.tangent.z * lane;
      const z = s.z - s.tangent.x * lane;
      car.body.setEnabled(true);
      car.body.setTranslation({ x, y: s.y + PHYSICS.rideHeight, z }, true);
      car.body.setRotation(quaternion(Math.atan2(s.tangent.x, s.tangent.z)), true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      car.body.resetForces(true);
      car.body.resetTorques(true);
      Object.assign(car, {
        x, y: s.y, z, yaw: Math.atan2(s.tangent.x, s.tangent.z), speed: 0, vx: 0, vz: 0,
        steer: 0, drift: false, boost: 0, lap: 1, progress, totalProgress: -meters / track.length,
        finished: false, finishTime: null, lapTimes: [], rpm: 0, offRoad: false, grade: 0,
        airborne: false, groundedWheels: 4, pitch: 0, roll: 0, suspension: 0, vy: 0, _wheelGround: null, _airTime: 0, wheels: [], _impactTime: 0, _impactStrength: 0, _tippedTime: 0,
        surface: track.surfaceAt?.(progress) ?? 'asphalt', traction: surfaceProfile(track.surfaceAt?.(progress)).grip, inWater: false, _waterTime: 0,
        routeId: 'main', aiRoute: 'main', checkpointMissed: false, _started: false, _nextGate: 0, _distanceSinceGate: 0,
        _lapStart: 0, _safeProgress: progress, _safeRoute: 'main', _stuck: 0, _gateAge: 0,
        _lastProgress: progress, _lastX: x, _lastZ: z, _lastRoad: true, _lastRoute: 'main',
        _collisionCooldown: 0, _recoverCooldown: 0, _aiLane: (car.id % 2 ? -1 : 1) * 1.65,
        _previousSpeed: 0, _lastInput: { throttle: 0, brake: 0, steer: 0, drift: false },
      });
    }
    updateRanks();
  }

  function aiInput(car) {
    const p = car.progress;
    const speed = Math.max(0, car.speed);
    const look = 7 + speed * 0.42;
    if (car.aiRoute !== 'main') {
      const r = track.routes.find(r => r.id === car.aiRoute);
      if (!r || p > r.end + 0.012 || p < r.start - 0.08) car.aiRoute = 'main';
    }
    if (car.aiRoute === 'main') {
      for (let i = 0; i < track.routes.length; i++) {
        const r = track.routes[i];
        if (p < r.start && r.start - p < (look + 12) / track.length &&
          (car.id + car.lap + i) % 3 !== 0) {
          car.aiRoute = r.id;
          break;
        }
      }
    }
    const route = track.routes.find(r => r.id === car.aiRoute);
    const at = progress => {
      const wrapped = mod(progress);
      return track.sample(wrapped, route && wrapped >= route.start && wrapped <= route.end ? route.id : 'main');
    };
    const profileAt = progress => {
      const wrapped = mod(progress);
      const routeId = route && wrapped >= route.start && wrapped <= route.end ? route.id : 'main';
      return surfaceProfile(track.surfaceAt?.(wrapped, routeId));
    };
    const target = at(p + look / track.length);
    // Sample individual upcoming bends: averaging an S-curve hides its sharpest turn.
    let bendSpeed = Infinity;
    let prior = at(p);
    for (let distance = 5; distance <= 20 + speed * 0.8; distance += 5) {
      const next = at(p + distance / track.length);
      const curve = Math.abs(angle(Math.atan2(next.tangent.x, next.tangent.z) -
        Math.atan2(prior.tangent.x, prior.tangent.z))) / 5;
      const upcoming = profileAt(p + distance / track.length);
      const curveLimit = 12 * upcoming.grip / Math.max(0.002, curve);
      const surfaceLimit = ((car.boost > 0 ? PHYSICS.boostSpeed * 0.9 : PHYSICS.topSpeed * 0.9) * upcoming.speed) ** 2;
      // Braking begins on approach to a loose surface, before its reduced tire
      // grip limits the cornering force available at the next bend.
      bendSpeed = Math.min(bendSpeed, Math.sqrt(Math.min(curveLimit, surfaceLimit) +
        2 * 14 * upcoming.grip * Math.max(0, distance - 10)));
      prior = next;
    }
    let lane = car._aiLane;
    // Make space for a rival ahead, instead of driving through their rear bumper.
    for (const other of sim.cars) {
      if (other === car || other.finished) continue;
      const dx = other.x - car.x, dz = other.z - car.z;
      const ahead = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
      const side = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
      if (ahead > 0 && ahead < 14 && Math.abs(side) < 3.8) lane += side > 0 ? -1.5 : 1.5;
    }
    lane = clamp(lane, -3.1, 3.1);
    const tx = target.x + target.tangent.z * lane;
    const tz = target.z - target.tangent.x * lane;
    const desiredYaw = Math.atan2(tx - car.x, tz - car.z);
    const error = angle(desiredYaw - car.yaw);
    const desiredRate = 2 * Math.sin(error) * Math.max(7, speed) / Math.max(5, Math.hypot(tx - car.x, tz - car.z));
    const yawCapacity = steeringRate(speed, false, profileAt(p).grip);
    const steer = clamp(desiredRate / Math.max(0.45, yawCapacity), -1, 1);
    let targetSpeed = Math.min((car.boost > 0 ? PHYSICS.boostSpeed * 0.9 : PHYSICS.topSpeed * 0.9) * profileAt(p).speed, bendSpeed) * car._pace;
    targetSpeed *= clamp(1 - Math.abs(error) * 0.42, 0.26, 1);
    if (car.offRoad) targetSpeed = Math.min(targetSpeed, 19);
    return {
      throttle: clamp((targetSpeed - speed) * 0.45 + 0.22, 0, 1),
      brake: clamp((speed - targetSpeed - 1.5) * 0.2, 0, 0.8),
      steer,
      drift: false,
    };
  }

  function steeringAngle(speed, drift, grip = 1) {
    const velocity = Math.abs(speed);
    // The rack and yaw assist share the same tire budget. A fixed yaw-rate
    // target at high speed previously demanded several times the available
    // cornering force, rotating the body away from its actual travel direction.
    const cornerAcceleration = 18 * grip * (drift ? 1.2 : 1);
    return Math.min(.58 / (1 + velocity * .03),
      Math.atan(2.76 * cornerAcceleration / Math.max(9, velocity * velocity)));
  }

  function steeringRate(speed, drift, grip = 1) {
    return speed / 2.76 * Math.tan(steeringAngle(speed, drift, grip));
  }

  function bodyAxes(q) {
    return {
      forward: { x: 2 * (q.x * q.z + q.w * q.y), y: 2 * (q.y * q.z - q.w * q.x), z: 1 - 2 * (q.x * q.x + q.y * q.y) },
      right: { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) },
      up: { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) },
    };
  }

  function drive(car, input, dt) {
    const throttle = clamp(Number(input.throttle) || 0, 0, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const steer = clamp(Number(input.steer) || 0, -1, 1);
    const isDrift = Boolean(input.drift) && Math.abs(car.speed) > 8;
    car._lastInput = { throttle, brake, steer, drift: isDrift };
    car.steer += (steer - car.steer) * (1 - Math.exp(-dt * 10));
    car.drift = isDrift;
    const position = car.body.translation(), velocity = car.body.linvel(), angular = car.body.angvel();
    const axes = bodyAxes(car.body.rotation()), centerOfMass = car.body.worldCom();
    car.x = position.x; car.z = position.z;
    car.yaw = Math.atan2(axes.forward.x, axes.forward.z);
    car.pitch = Math.atan2(axes.forward.y, Math.hypot(axes.forward.x, axes.forward.z));
    car.roll = Math.atan2(axes.right.y, axes.up.y);
    const forward = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    const right = { x: forward.z, z: -forward.x };
    const speed = velocity.x * forward.x + velocity.z * forward.z;
    const road = track.nearest(car.x, car.z);
    updateSurface(car, road);
    const maxSpeed = (car.boost > 0 ? PHYSICS.boostSpeed : PHYSICS.topSpeed) * surfaceProfile(car.surface).speed;
    const engine = car.boost > 0 ? 22 : 15.5;
    const aeroCoefficient = car.boost > 0 ? 0.00085 : 0.0012;
    // A small bumper rub must not remove the same grip as a high-speed crash.
    const impactGrip = 1 - clamp(car._impactTime / 0.55, 0, 1) * .5 * (car._impactStrength || 0);
    const steeringGrip = surfaceProfile(car.surface).grip * impactGrip * (car.offRoad ? .84 : 1);
    car.body.resetForces(true); car.body.resetTorques(true);
    const sag = PHYSICS.mass * PHYSICS.gravity / (4 * PHYSICS.springRate);
    const restLength = PHYSICS.rideHeight + sag;
    const offsets = [[-0.88, 1.38], [0.88, 1.38], [-0.88, -1.38], [0.88, -1.38]];
    const ground = [], wheels = [];
    let contacts = 0, compression = 0, traction = 0;
    const teleported = !car._wheelGround || Math.hypot(car.x - (car._suspensionX ?? car.x), car.z - (car._suspensionZ ?? car.z)) > 5;
    for (let i = 0; i < offsets.length; i++) {
      const [side, axle] = offsets[i];
      const mount = { x: position.x + axes.right.x * side + axes.forward.x * axle,
        y: position.y + axes.right.y * side + axes.forward.y * axle,
        z: position.z + axes.right.z * side + axes.forward.z * axle };
      const groundY = track.heightAt(mount.x, mount.z);
      ground.push(groundY);
      const contactPoint = { x: mount.x, y: groundY + 0.2, z: mount.z };
      const r = { x: contactPoint.x - centerOfMass.x, y: contactPoint.y - centerOfMass.y, z: contactPoint.z - centerOfMass.z };
      const pointVelocity = { x: velocity.x + angular.y * r.z - angular.z * r.y,
        y: velocity.y + angular.z * r.x - angular.x * r.z,
        z: velocity.z + angular.x * r.y - angular.y * r.x };
      const length = mount.y - groundY, squeeze = restLength - length;
      const contact = length <= restLength + 0.025;
      const groundVelocity = teleported ? 0 : clamp((groundY - car._wheelGround[i]) / dt, -12, 12);
      const load = squeeze > 0 ? clamp(squeeze * PHYSICS.springRate -
        (pointVelocity.y - groundVelocity) * PHYSICS.suspensionDamping, 0, PHYSICS.mass * PHYSICS.gravity * 2.5) : 0;
      const wheelRoad = track.nearest(mount.x, mount.z);
      const offRoad = wheelRoad.distance > wheelRoad.width / 2 + 0.8;
      const surface = offRoad ? track.terrainAt?.(mount.x, mount.z)?.surface ?? 'grass'
        : track.surfaceAt?.(wheelRoad.progress, wheelRoad.routeId) ?? 'asphalt';
      const profile = surfaceProfile(car.inWater ? 'water' : surface);
      const tireGrip = profile.grip * (offRoad && !car.inWater ? 0.84 : 1) * impactGrip;
      const wheelSteer = i < 2 ? car.steer * steeringAngle(speed, isDrift, steeringGrip) : 0;
      const heading = car.yaw + wheelSteer, tireForward = { x: Math.sin(heading), z: Math.cos(heading) };
      const tireRight = { x: tireForward.z, z: -tireForward.x };
      const along = pointVelocity.x * tireForward.x + pointVelocity.z * tireForward.z;
      const slip = pointVelocity.x * tireRight.x + pointVelocity.z * tireRight.z;
      const rollingCoefficient = offRoad && !car.inWater ? Math.max(0.68, profile.rolling)
        : profile.rolling * (car.inWater ? 1 : 0.3);
      const tireMax = (car.boost > 0 ? PHYSICS.boostSpeed : PHYSICS.topSpeed) * profile.speed;
      const driveScale = profile.drive * (offRoad && !car.inWater ? 0.82 : 1);
      const cruiseResistance = Math.min(engine * driveScale, rollingCoefficient * tireMax + aeroCoefficient * tireMax * tireMax);
      const envelope = clamp((tireMax - along) / 8, 0, 1);
      const engineForce = cruiseResistance + (engine * driveScale - cruiseResistance) * envelope;
      let driveAccel = throttle * engineForce;
      if (brake > 0) driveAccel -= brake * Math.sqrt(tireGrip) * (along > 1 ? 27 : along > -9 ? 8 : 0);
      if (along < -0.5 && throttle > 0) driveAccel += throttle * 13 * driveScale;
      driveAccel -= rollingCoefficient * along;
      if (isDrift) driveAccel -= Math.max(0, along) * 0.1;
      if (car.finished && Math.abs(along) < 1) driveAccel = -along * 8;
      const loadRatio = clamp(load / (PHYSICS.mass * PHYSICS.gravity / 4), 0, 1.8);
      // Rear handbrake release permits controlled oversteer; every tire still
      // computes its own slip, normal load, surface, and force at its contact point.
      const loosen = isDrift && i >= 2;
      const lateralCap = (loosen ? 7 : 22) * tireGrip * loadRatio;
      const lateralAccel = clamp(-slip * (loosen ? 1.5 : i < 2 ? 10.5 : 12) * tireGrip, -lateralCap, lateralCap);
      const longitudinal = contact ? driveAccel * PHYSICS.mass / 4 * loadRatio : 0;
      const lateralForce = contact ? lateralAccel * PHYSICS.mass / 4 : 0;
      car.body.addForceAtPoint({ x: tireForward.x * longitudinal + tireRight.x * lateralForce,
        y: load, z: tireForward.z * longitudinal + tireRight.z * lateralForce }, contactPoint, true);
      if (contact) { contacts++; traction += tireGrip; }
      const squeezed = clamp(squeeze / PHYSICS.suspensionTravel, 0, 1);
      compression += squeezed;
      wheels.push({ id: ['front-left', 'front-right', 'rear-left', 'rear-right'][i], x: mount.x, y: groundY,
        z: mount.z, contact, load, compression: squeezed, surface, traction: tireGrip, steer: wheelSteer, slip,
        longitudinalForce: longitudinal, lateralForce });
    }
    const wasAirborne = car.airborne;
    car.airborne = contacts === 0; car.groundedWheels = contacts; car.wheels = wheels;
    car.suspension = compression / 4;
    if (contacts) car.traction = traction / contacts;
    if (wasAirborne && !car.airborne && car._airTime > 0.08 && velocity.y < -0.8) {
      sim.events.push({ type: 'land', carId: car.id, intensity: clamp(-velocity.y / 10, 0.08, 1), verticalSpeed: velocity.y });
    }
    car._airTime = car.airborne ? car._airTime + dt : 0;
    car._wheelGround = ground; car._suspensionX = car.x; car._suspensionZ = car.z;
    car._groundHeight = ground.reduce((sum, y) => sum + y, 0) / 4;
    car.grade = clamp((ground[0] + ground[1] - ground[2] - ground[3]) /
      (2 * Math.max(0.5, Math.hypot(axes.forward.x, axes.forward.z) * 2.76)), -0.3, 0.3);
    const contactRatio = contacts / 4;
    const slope = car.finished && Math.abs(speed) < 1 ? 0 : PHYSICS.gravity * car.grade / Math.sqrt(1 + car.grade * car.grade) * contactRatio;
    const aero = aeroCoefficient * speed * Math.abs(speed);
    car.body.addForce({ x: -PHYSICS.mass * forward.x * (aero + slope), y: 0,
      z: -PHYSICS.mass * forward.z * (aero + slope) }, true);
    if (car.inWater) car.body.addForce({ x: -velocity.x * PHYSICS.mass * 3.2, y: 0, z: -velocity.z * PHYSICS.mass * 3.2 }, true);
    // Tire forces create yaw physically. A limited servo helps the driver hold a
    // requested turn, while grip recovery leaves collision momentum undisturbed.
    const desiredYaw = speed / 2.76 * Math.tan(car.steer * steeringAngle(speed, isDrift, steeringGrip));
    const yawAssist = clamp((desiredYaw - angular.y) * 4200, -4500, 4500) * impactGrip * contactRatio;
    const tippingPitch = Math.max(0, Math.abs(car.pitch) - 0.55) * Math.sign(car.pitch);
    const tippingRoll = Math.max(0, Math.abs(car.roll) - 0.5) * Math.sign(car.roll);
    const pitchRate = angular.x * axes.right.x + angular.y * axes.right.y + angular.z * axes.right.z;
    const rollRate = angular.x * axes.forward.x + angular.y * axes.forward.y + angular.z * axes.forward.z;
    const pitchTorque = tippingPitch * 18000 - pitchRate * (car.airborne ? 450 : 1700);
    const rollTorque = -tippingRoll * 18000 - rollRate * (car.airborne ? 400 : 1500);
    car.body.addTorque({ x: axes.right.x * pitchTorque + axes.forward.x * rollTorque,
      y: yawAssist + axes.right.y * pitchTorque + axes.forward.y * rollTorque,
      z: axes.right.z * pitchTorque + axes.forward.z * rollTorque }, true);
    car.rpm += (clamp(Math.abs(speed) / maxSpeed * 0.72 + throttle * 0.25, 0.05, 1) - car.rpm) * Math.min(1, dt * 7);
    car._previousSpeed = Math.hypot(velocity.x, velocity.z);
    car._preVelocity = { ...velocity };
  }

  function updateSurface(car, road) {
    car.offRoad = road.distance > road.width * 0.5 + 0.8;
    const terrain = car.offRoad ? track.terrainAt?.(car.x, car.z) : null;
    car.surface = car.offRoad ? terrain?.surface ?? 'grass' : track.surfaceAt?.(road.progress, road.routeId) ?? 'asphalt';
    const river = car.offRoad ? track.riverAt?.(car.x, car.z) : null;
    const groundY = car.offRoad ? track.heightAt(car.x, car.z) : road.y;
    const waterLevel = river && river.distance < river.width / 2 && groundY < river.y ? river.y
      : track.environment === 'beach' && groundY < -0.46 ? -0.46 : null;
    car.inWater = car.offRoad && waterLevel !== null && car.body.translation().y - PHYSICS.rideHeight < waterLevel + 0.4;
    const profile = surfaceProfile(car.inWater ? 'water' : car.surface);
    car.traction = profile.grip * (car.offRoad && !car.inWater ? 0.84 : 1);
    return profile;
  }

  function step(dt, input = {}) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    // The application owns accumulation. Refuse giant frame steps after tab resume.
    dt = Math.min(dt, PHYSICS.timestep);
    world.timestep = dt;
    sim.time += dt;
    for (const pickup of sim.pickups) {
      pickup.cooldown = Math.max(0, pickup.cooldown - dt);
      pickup.active = pickup.cooldown <= 0;
    }
    for (const car of sim.cars) {
      car.boost = Math.max(0, car.boost - dt);
      car._collisionCooldown = Math.max(0, car._collisionCooldown - dt);
      car._impactTime = Math.max(0, car._impactTime - dt);
      car._recoverCooldown = Math.max(0, car._recoverCooldown - dt);
      const controls = car.finished ? { brake: car.speed > 0.2 ? 0.8 : 0, throttle: car.speed < -0.2 ? 0.8 : 0, steer: 0 }
        : car.id === 0 ? input : aiInput(car);
      drive(car, controls, dt);
    }
    world.step(queue);
    queue.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      for (const [own, other] of [[a, b], [b, a]]) {
        const car = colliderCars.get(own);
        if (!car || car._collisionCooldown > 0) continue;
        const otherCar = colliderCars.get(other);
        const otherPosition = otherCar ?? world.getCollider(other)?.translation();
        if (!otherPosition) continue;
        const dx = otherPosition.x - car.x, dz = otherPosition.z - car.z, separation = Math.hypot(dx, dz) || 1;
        const ownVelocity = car._preVelocity ?? { x: 0, z: 0 };
        const otherVelocity = otherCar?._preVelocity ?? { x: 0, z: 0 };
        const closingSpeed = Math.max(0, ((ownVelocity.x - otherVelocity.x) * dx + (ownVelocity.z - otherVelocity.z) * dz) / separation);
        if (closingSpeed < 2.5) continue;
        const intensity = clamp(closingSpeed / 50, 0.08, 1);
        car._collisionCooldown = 0.35; car._impactTime = 0.35 + intensity * 0.2; car._impactStrength = intensity;
        sim.events.push({ type: 'collision', carId: car.id, otherId: otherCar?.id ?? null,
          intensity, relativeSpeed: closingSpeed, x: car.x, z: car.z });
      }
    });
    for (const car of sim.cars) {
      const pos = car.body.translation(), vel = car.body.linvel(), q = car.body.rotation();
      car.x = pos.x; car.z = pos.z;
      car.vx = vel.x; car.vz = vel.z; car.vy = vel.y;
      // A compressed bump stop is the final terrain contact constraint. It only
      // resolves deep penetration; ordinary climbs, crests and landings use forces.
      const floorY = (car._groundHeight ?? track.heightAt(car.x, car.z)) + PHYSICS.rideHeight - PHYSICS.suspensionTravel;
      if (pos.y < floorY) {
        car.body.setTranslation({ x: pos.x, y: floorY, z: pos.z }, true);
        car.body.setLinvel({ x: vel.x, y: Math.max(0, vel.y) * 0.15, z: vel.z }, true);
        pos.y = floorY; car.vy = Math.max(0, vel.y) * 0.15;
      }
      const axes = bodyAxes(q);
      car.yaw = Math.atan2(axes.forward.x, axes.forward.z);
      car.pitch = Math.atan2(axes.forward.y, Math.hypot(axes.forward.x, axes.forward.z));
      car.roll = Math.atan2(axes.right.y, axes.up.y);
      car.speed = vel.x * Math.sin(car.yaw) + vel.z * Math.cos(car.yaw);
      const speedLimit = (car.boost > 0 ? PHYSICS.boostSpeed : PHYSICS.topSpeed) * surfaceProfile(car.surface).speed;
      if (!car.offRoad && !car.airborne && car.speed > speedLimit) {
        const excess = car.speed - speedLimit;
        vel.x -= Math.sin(car.yaw) * excess; vel.z -= Math.cos(car.yaw) * excess;
        car.body.setLinvel({ x: vel.x, y: car.vy, z: vel.z }, true);
        car.vx = vel.x; car.vz = vel.z; car.speed = speedLimit;
      }
      const road = track.nearest(car.x, car.z);
      updateSurface(car, road);
      car.y = pos.y - PHYSICS.rideHeight;
      car.progress = road.progress;
      car.routeId = road.routeId;
      if (!car.finished) updateRaceProgress(car, road);
      if (road.distance > road.width / 2 + 30 && !car.finished) recover(car.id, 'offtrack');
      car._tippedTime = Math.abs(car.roll) > 1.15 || Math.abs(car.pitch) > 1.2 ? car._tippedTime + dt : 0;
      if (car._tippedTime > 1.5 && !car.finished) recover(car.id, 'rollover');
      car._waterTime = car.inWater ? car._waterTime + dt : 0;
      if (car._waterTime >= 1.5 && !car.finished) recover(car.id, 'water');
      if (car.id > 0 && !car.finished) {
        car._stuck = Math.abs(car.speed) < 2.5 || road.distance > road.width + 4 ? car._stuck + dt : 0;
        car._gateAge += dt;
        if (car._stuck > 3.5 || car._gateAge > Math.max(9, track.length / PHYSICS.checkpoints / 7)) recover(car.id, 'stuck');
      }
    }
    for (const pickup of sim.pickups) {
      if (!pickup.active) continue;
      let closest = null, nearestDistance = PHYSICS.pickupRadius;
      for (const car of sim.cars) {
        if (car.finished) continue;
        const d = Math.hypot(car.x - pickup.x, car.z - pickup.z);
        if (d < nearestDistance) { closest = car; nearestDistance = d; }
      }
      if (closest) {
        closest.boost = PHYSICS.boostDuration;
        pickup.active = false;
        pickup.cooldown = PHYSICS.pickupCooldown;
        sim.events.push({ type: 'boost', carId: closest.id, pickupId: pickup.id, duration: PHYSICS.boostDuration });
      }
    }
    updateRanks();
  }

  function updateRaceProgress(car, road) {
    const p = road.progress;
    let delta = p - car._lastProgress;
    if (delta < -0.5) delta += 1;
    if (delta > 0.5) delta -= 1;
    const moved = Math.hypot(car.x - car._lastX, car.z - car._lastZ);
    const onRoad = road.distance <= road.width * 0.5 + 1.7;
    // Ordered gates + continuous physical travel prevent teleports and grass cuts.
    // Overlapping branch merges can switch the nearest route, shifting mapped
    // progress slightly even though the car moves continuously through the junction.
    const mergeAllowance = road.routeId !== car._lastRoute ? track.width : 0;
    const plausible = moved < 4 && Math.abs(delta) * track.length <= moved * 2.3 + 0.3 + mergeAllowance;
    const valid = onRoad && car._lastRoad && plausible && delta >= 0;
    if (valid && delta > 0) car._distanceSinceGate += moved;
    const gate = mod(car._nextGate / PHYSICS.checkpoints);
    const toGate = mod(gate - car._lastProgress);
    const enoughRoadTravel = !car._started || car._distanceSinceGate >= track.length / PHYSICS.checkpoints * 0.78;
    if (valid && delta > 0 && toGate <= delta + 1e-7 && enoughRoadTravel) {
      car._gateAge = 0;
      car._distanceSinceGate = 0;
      car.checkpointMissed = false;
      if (!car._started) {
        car._started = true;
        car._nextGate = 1;
      } else if (car._nextGate === PHYSICS.checkpoints) {
        const lapTime = sim.time - car._lapStart;
        car.lapTimes.push(lapTime);
        car._lapStart = sim.time;
        sim.events.push({ type: 'lap', carId: car.id, lap: car.lap, lapTime });
        if (car.lap === PHYSICS.laps) {
          car.finished = true;
          car.finishTime = sim.time;
          car.totalProgress = PHYSICS.laps;
          sim.events.push({ type: 'finish', carId: car.id, time: sim.time, lapTimes: [...car.lapTimes] });
          if (car.id === 0) sim.finished = true;
        } else {
          car.lap++;
          car._nextGate = 1;
        }
      } else {
        car._nextGate++;
      }
    }
    if (!car.finished) {
      if (!car._started) {
        // A car must cross the actual start, even after wandering around the world.
        car.totalProgress = -Math.min(0.1, mod(1 - p));
        if (valid && p > 0.9) { car._safeProgress = p; car._safeRoute = road.routeId; }
      } else {
        const lastGate = (car._nextGate - 1) / PHYSICS.checkpoints;
        const withinSegment = mod(p - lastGate);
        if (withinSegment > 1 / PHYSICS.checkpoints && withinSegment < 0.5) car.checkpointMissed = true;
        const fraction = withinSegment <= 1 / PHYSICS.checkpoints ? withinSegment : 0;
        car.totalProgress = car.lap - 1 + lastGate + fraction;
        if (valid && withinSegment <= 1 / PHYSICS.checkpoints) {
          car._safeProgress = p;
          car._safeRoute = road.routeId;
        }
      }
    }
    car._lastProgress = p;
    car._lastX = car.x; car._lastZ = car.z; car._lastRoad = onRoad; car._lastRoute = road.routeId;
  }

  function updateRanks() {
    const order = [...sim.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.totalProgress - a.totalProgress || a.id - b.id;
    });
    order.forEach((car, i) => { car.rank = i + 1; });
    sim.position = sim.player.rank;
  }

  function recover(carId = 0, reason = 'manual') {
    if (disposed) return false;
    const car = sim.cars[carId];
    if (!car || car.finished || car._recoverCooldown > 0) return false;
    // If a bend was cut, replay the unvalidated segment rather than crediting it.
    if (car.checkpointMissed && car._started) {
      car._safeProgress = mod((car._nextGate - 1) / PHYSICS.checkpoints + 1 / track.length);
      car._safeRoute = 'main';
      car._distanceSinceGate = 1;
    }
    const s = track.sample(car._safeProgress, car._safeRoute);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    // Opposite recovery lanes avoid two rivals repeatedly respawning inside each
    // other at the same missed gate and shoving one another off the road again.
    const lane = carId > 0 ? (carId % 2 ? -2.4 : 2.4) : 0;
    const x = s.x + s.tangent.z * lane, z = s.z - s.tangent.x * lane;
    // Recover on the last validated road position, never ahead of a missed gate.
    car.body.setTranslation({ x, y: s.y + PHYSICS.rideHeight, z }, true);
    car.body.setRotation(quaternion(yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.body.resetForces(true);
    Object.assign(car, { x, y: s.y, z, yaw, speed: 0, vx: 0, vz: 0,
      airborne: false, groundedWheels: 4, pitch: 0, roll: 0, suspension: 0, vy: 0, _wheelGround: null, _airTime: 0, wheels: [], _impactTime: 0, _impactStrength: 0, _tippedTime: 0,
      boost: 0, steer: 0, drift: false, offRoad: false, inWater: false, _waterTime: 0,
      surface: track.surfaceAt?.(s.progress, car._safeRoute) ?? 'asphalt',
      traction: surfaceProfile(track.surfaceAt?.(s.progress, car._safeRoute)).grip, checkpointMissed: false, progress: s.progress, routeId: car._safeRoute,
      aiRoute: car._safeRoute, _lastProgress: s.progress, _lastX: x, _lastZ: z,
      _lastRoad: true, _lastRoute: car._safeRoute, _stuck: 0, _gateAge: 0, _recoverCooldown: 1.5,
    });
    sim.events.push({ type: 'recover', carId, reason });
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    queue.free();
    world.free();
    sim.events.length = 0;
  }
}
