import Matter from './vendor/matter.min.js';

const { Body, Sleeping } = Matter;
const strength = { glass: .58, wood: 1, stone: 1.15, steel: 1.55 };
const postsAndBeams = new Set(['beam', 'girder', 'pane', 'column', 'masonry', 'buttress', 'tie-beam']);
const maxSkew = Math.sin(24 * Math.PI / 180);

function frame(e) {
  const angle = e.body.angle + (e.height > e.width ? Math.PI / 2 : 0);
  return { e, x: e.body.position.x, y: e.body.position.y, u: Math.cos(angle), v: Math.sin(angle),
    length: Math.max(e.width, e.height) / 2, radius: Math.min(e.width, e.height) / 2 };
}

// Find an end seated on the other member's long face. A little skew reduces
// both the width in contact and the strength of the joint.
function bearing(rail, post, skew) {
  const dx = post.x - rail.x, dy = post.y - rail.y;
  const normal = -dx * rail.v + dy * rail.u;
  const cross = rail.u * post.v - rail.v * post.u;
  const end = -Math.sign(normal * cross) * post.length;
  const cap = normal + end * cross;
  if (Math.abs(normal) < rail.radius) return;
  const center = dx * rail.u + dy * rail.v + end * skew;
  const half = Math.abs(cross) * post.radius;
  const left = Math.max(-rail.length, center - half), right = Math.min(rail.length, center + half);
  if (right - left < 3) return;
  const across = Math.sign(normal) * rail.radius;
  const gapAt = (along) => Math.sign(normal) * (cap + (center - along) * skew / cross - across);
  const gapLeft = gapAt(left), gapRight = gapAt(right);
  const gap = Math.min(gapLeft, gapRight);
  if (gap < -2 || gap > 1.6) return;
  // Pin the seated part of a beveled end rather than its overhanging tip.
  const fraction = Math.min(1, (1.8 - gap) / Math.max(1e-8, Math.abs(gapRight - gapLeft)));
  const along = gapLeft < gapRight ? left + (right - left) * fraction / 2 : right - (right - left) * fraction / 2;
  return { x: rail.x + along * rail.u - across * rail.v,
    y: rail.y + along * rail.v + across * rail.u, width: right - left };
}

function anchor(body, point) {
  const dx = point.x - body.position.x, dy = point.y - body.position.y;
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return { x: dx * c + dy * s, y: dy * c - dx * s };
}

export function buildJoints(pieces) {
  const frames = pieces.filter((e) => e.kind === 'block' && postsAndBeams.has(e.detail)).map(frame)
    .sort((a, b) => a.e.body.bounds.min.x - b.e.body.bounds.min.x);
  const joints = new Set();
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i], bounds = a.e.body.bounds;
    for (let j = i + 1; j < frames.length; j++) {
      const b = frames[j], other = b.e.body.bounds;
      if (other.min.x > bounds.max.x + 2) break;
      if (other.min.y > bounds.max.y + 2 || other.max.y < bounds.min.y - 2) continue;
      const skew = a.u * b.u + a.v * b.v;
      if (Math.abs(skew) >= maxSkew) continue;
      const seat = bearing(a, b, skew) || bearing(b, a, skew);
      if (!seat) continue;
      const joint = { a: a.e, b: b.e, pinA: anchor(a.e.body, seat), pinB: anchor(b.e.body, seat),
        angle: b.e.body.angle - a.e.body.angle,
        capacity: (1 - .75 * Math.abs(skew) / maxSkew) * Math.min(1.2, seat.width / 14) *
          Math.sqrt(strength[a.e.material] * strength[b.e.material]) };
      joints.add(joint);
      (a.e.joints ??= new Set()).add(joint);
      (b.e.joints ??= new Set()).add(joint);
    }
  }
  return joints;
}

export function releaseJoint(joints, joint) {
  joints.delete(joint);
  for (const e of [joint.a, joint.b]) {
    e.joints.delete(joint);
    if (e.body.isSleeping) Sleeping.set(e.body, false);
  }
}

// Local spring impulses are applied in equal and opposite pairs at the seat.
// A detached section can translate and spin as one piece. Matter velocities
// are normalized to a 60 Hz tick; this runs once per 120 Hz physics step.
export function updateJoints(joints) {
  for (const joint of joints) {
    const { a, b, pinA, pinB } = joint;
    const bodyA = a.body, bodyB = b.body;
    if (bodyA.isSleeping && bodyB.isSleeping) continue;
    const cosA = Math.cos(bodyA.angle), sinA = Math.sin(bodyA.angle);
    const cosB = Math.cos(bodyB.angle), sinB = Math.sin(bodyB.angle);
    const offsetAX = cosA * pinA.x - sinA * pinA.y, offsetAY = sinA * pinA.x + cosA * pinA.y;
    const offsetBX = cosB * pinB.x - sinB * pinB.y, offsetBY = sinB * pinB.x + cosB * pinB.y;
    const dx = bodyB.position.x - bodyA.position.x + offsetBX - offsetAX;
    const dy = bodyB.position.y - bodyA.position.y + offsetBY - offsetAY;
    const twist = bodyB.angle - bodyA.angle - joint.angle;
    const health = 1 - Math.max(.70 * a.damage, .70 * b.damage, .90 * a.burn, .90 * b.burn);
    const limit = joint.capacity * health;
    if (dx * dx + dy * dy > (5 * limit) ** 2 || Math.abs(twist) > .30 * limit) {
      releaseJoint(joints, joint);
      continue;
    }
    if (dx * dx + dy * dy < .01 && Math.abs(twist) < .006 && (bodyA.isSleeping || bodyB.isSleeping)) continue;
    if (bodyA.isSleeping) Sleeping.set(bodyA, false);
    if (bodyB.isSleeping) Sleeping.set(bodyB, false);
    const velocityA = Body.getVelocity(bodyA), velocityB = Body.getVelocity(bodyB);
    const spinA = Body.getAngularVelocity(bodyA), spinB = Body.getAngularVelocity(bodyB);
    const inverseMass = bodyA.inverseMass + bodyB.inverseMass;
    const spring = Math.min(1, limit);
    const impulseX = spring * (.14 * dx + .20 * (velocityB.x - spinB * offsetBY - velocityA.x + spinA * offsetAY)) /
      (inverseMass + offsetAY * offsetAY * bodyA.inverseInertia + offsetBY * offsetBY * bodyB.inverseInertia);
    const impulseY = spring * (.14 * dy + .20 * (velocityB.y + spinB * offsetBX - velocityA.y - spinA * offsetAX)) /
      (inverseMass + offsetAX * offsetAX * bodyA.inverseInertia + offsetBX * offsetBX * bodyB.inverseInertia);
    const torque = spring * (.18 * twist + .22 * (spinB - spinA)) / (bodyA.inverseInertia + bodyB.inverseInertia);
    Body.setVelocity(bodyA, { x: velocityA.x + impulseX * bodyA.inverseMass, y: velocityA.y + impulseY * bodyA.inverseMass });
    Body.setVelocity(bodyB, { x: velocityB.x - impulseX * bodyB.inverseMass, y: velocityB.y - impulseY * bodyB.inverseMass });
    Body.setAngularVelocity(bodyA, spinA + (torque + offsetAX * impulseY - offsetAY * impulseX) * bodyA.inverseInertia);
    Body.setAngularVelocity(bodyB, spinB - (torque + offsetBX * impulseY - offsetBY * impulseX) * bodyB.inverseInertia);
  }
}
