/* The night patrol.

   At night the mountain stops telling you anything. The key light is a moon,
   the snow goes the same colour as the fog, and a bear standing in the middle
   of the piste at eighty metres is a slightly darker patch of nothing until
   it is close enough to matter. Everything else in the game solves that by
   being lit; this solves it by being *pointed at*.

   So the whole module exists to justify one thing: a searchlight resting on
   the ground where the next animal is. The aircraft around it is the excuse.
   That ordering decided the rest of the file — the beam is a pointer first
   and lighting second, which is why it is an additive shell rather than a
   lamp. It was a real THREE.SpotLight for about an hour: it cost more than
   the hill, it lit the Lambert snowfield into a soft grey circle
   nobody could see from six metres behind a rider at 130 km/h, and it did
   not draw the one part that matters, which is the cone of air between the
   machine and the snow. A picture of a light beats a light here, and costs
   two draw calls.

   The cone is driven a sixth of its length *into* the hill and the depth
   buffer cuts it off. That is the whole trick to making it land: a cone that
   stopped at the ground either floated above the moguls on one side or ended
   in mid-air wherever the aircraft was off to the side of its own beam, and
   both read as a decal. Buried, the beam terminates exactly on whatever
   shape the snow happens to be, for free.

   It is an event, not scenery. A sortie needs three things at once — a
   stretch of hill whose hash says yes, a sky dark enough, and weather calm
   enough to fly in — so it is roughly one night in two, and never twice in
   the same fourteen hundred metres. The schedule is keyed on distance down
   the mountain rather than on a timer, for the same reason everything else
   here is: the same stretch of hill always makes the same decision.

   It prefers a bear. It hunted the nearest animal of any kind at first and
   spent every sortie hovering over a rabbit forty metres ahead, which is a
   waste of the only warning system the game has. Bears win outright now, and
   a machine already on station over a rabbit will drop it and swing the beam
   across the snow to a bear the moment one is in range — which turns out to
   be the best thing in the feature.

   And it orbits rather than hovers. Held dead still over the target it read
   as a prop hanging on a wire; a slow circle means it has to bank to stay
   there, and a banking silhouette with a spinning rotor is an aircraft. The
   rotor is the one part kept out of the baked geometry so that it can turn,
   and the anticollision beacon the one part kept out of the material so that
   it can flash; everything else is a single geometry and a single draw call,
   the way the bear is. */

import { compose } from './geom.js';
import { hash2 } from './noise.js';
import { heightAt, nearestCenter, corridorHalfAt } from './terrain.js';

export const HELI = {
  /* The schedule.

     Every `period` metres of descent the mountain gets one chance at a
     sortie, and takes it about a third of the time. On top of that the sky
     has to be dark and the air has to be flyable, both of which are read
     from the weather rather than agreed with it — a blizzard grounds the
     machine mid-sortie and it goes home.

     The day/night clock now runs five times faster, so the distance period is
     compressed by the same factor. That preserves the original number of
     launch opportunities per night instead of making the patrol disappear. */
  period: 280,
  chance: 0.32,
  nightFrom: 0.62,    // weather.night below this and it stays in the hangar
  nightHold: 0.34,    // and below this it breaks off — dawn is not its shift
  stormMax: 0.40,     // it will not launch into this much weather
  stormHold: 0.58,    // and will not stay out in this much

  /* Finding something worth pointing at.

     Only animals ahead of the rider count, because the entire value of the
     light is warning. A bear is looked for over a much longer reach than a
     rabbit and wins whenever it is found — the rabbit is a garnish, the bear
     is the reason the aircraft is up.

     `searchNear` is a hundred and twenty metres because that is three and a
     half seconds at riding speed, and anything closer is not a warning, it
     is a caption on something you have already hit. Rabbits are spawned
     thirty to a hundred and fifty metres out, so two or three of them are
     usually inside the band; bears are spawned at a hundred and forty to two
     hundred and fifty, which is the whole of it.

     `passBy` is small on purpose. Wildlife recycles a rabbit the moment it
     is twenty-six metres behind the rider, teleporting the same object back
     up the mountain; a sortie that outlived that would be left holding a
     light on an animal that had jumped two hundred metres forward. Ten
     metres behind is comfortably inside that, and it is also about where a
     rider stops caring. */
  searchNear: 120,    // metres ahead — closer than this it is not a warning
  hareSearch: 200,
  bearSearch: 320,
  passBy: 10,
  maxStation: 24,     // seconds of loiter before it gives up on a stalled run

  /* Station keeping. Sixty-four metres above the snow with a hard floor of
     thirty-four: the treeline is under eight and the tallest thing a rider
     can reach is a kicker lip, so there is no arrangement of hill, jump and
     bad luck that puts the two in the same place. */
  hover: 64,
  floor: 34,
  orbit: 28,          // a clearly readable circuit across the piste
  orbitAlong: 0.60,   // tighter down the fall line: a 56 × 34 m ellipse
  orbitRate: 0.38,    // rad/s — about sixteen seconds around
  orbitLift: 4.0,     // metres of slow rise and fall around that circuit
  stationRange: 40,

  /* Flight. An arrive-behaviour: it wants a velocity proportional to how
     far off station it is, capped, and it is allowed to change that velocity
     at `accel` and no faster. Two clamps and a lag, and it moves like
     something with mass rather than something being tweened. */
  cruise: 38,         // m/s
  accel: 9.5,         // m/s²
  arrive: 0.55,       // m/s of wanted speed per metre of error
  response: 1.7,      // how hard it chases the velocity it wants
  slew: 1.9,          // rad/s the nose can swing to follow the flight path

  /* Attitude. `bank` is very nearly the real coordinated-turn number, 1/g,
     so the roll it flies is the roll the turn actually asks for; the cap is
     what keeps the arrival from looking like an airshow. Nose-down in cruise
     and further down under acceleration, because that is how a helicopter
     goes anywhere — a machine that stays level while it accelerates reads as
     a sprite being slid across the sky. */
  bank: 0.10,
  bankMax: 0.60,
  cruisePitch: 0.0042,
  pitchGain: 0.030,
  pitchMax: 0.30,
  /* Rotor speed, chosen for the strobe rather than for realism. The real
   thing turns at about 41 rad/s, which with four blades and a 90° symmetry
     lands within a whisker of a whole blade-pass per frame at 60 Hz and
     stands still or turns backwards. Twenty-six is nowhere near any of the
     harmonics and still reads as fast. */
  rotor: 26,
  beacon: 1.15,       // seconds between anticollision flashes

  /* Arrival and departure.

     There is no approach leg, and there was one for most of a day. It cannot
     work: the rider covers a hundred and fifty metres in four seconds, so a
     machine that starts far enough out for the approach to read as an
     approach gets on station shortly after the rider has ridden past the
     animal it was coming to light. So the sortie begins with the aircraft
     already almost where it needs to be — `entry` metres to one side and
     `entryUp` above — and it settles onto the station over a couple of
     seconds with the lamp fading up as it goes. What the rider sees appear
     out of the fog is a light being switched on, which is what a searchlight
     coming on at four hundred metres looks like anyway.

     The departure is where the machine gets to be an aircraft: across the
     run, climbing, and away down the valley at half again its cruise. */
  entry: 78,          // metres to one side of the station it starts
  entryUp: 26,
  departSpeed: 48,
  gone: 330,          // metres from the rider before it is put away
  maxAway: 10,        // seconds, as a backstop

  /* The light.

     `radius` is the lit ellipse on the snow; `overshoot` is how far past it
     the cone is driven so the ground can cut the beam. The lamp fades rather
     than snaps, and it fades faster off than on, so the break-off reads as a
     decision and the arrival does not read as a switch. */
  radius: 11,
  overshoot: 1.16,
  beam: '#dfeeff',
  beamStrength: 0.46,
  poolStrength: 0.85,
  lampFade: 1.4,      // seconds to full brightness, and rather quicker off
  track: 0.55,        // seconds of lag as the beam follows a bolting rabbit
  drapeBlend: 0.24,   // complete terrain fans cross-fade; they never publish
  scoreRadius: 0.72,  // inner share of the visible pool that scores
  scoreLamp: 0.30,    // it must be visibly established first
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};

/* ==========================================================================
   The two shaders

   Both fold the fog in by hand, exactly as the particles do, because a
   ShaderMaterial gets nothing from three's fog for free — and a searchlight
   that stays at full strength through a curtain the hill has already
   dissolved into is the one thing that would give the whole trick away.
   ========================================================================== */

const BEAM_VERT = `
  varying float vT;
  varying float vDepth;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // The cone is built with its apex at the lamp and its base at y = -1,
    // so this is simply how far down the beam the fragment is
    vT = -position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  uniform float uTime;
  varying float vT;
  varying float vDepth;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (uStrength <= 0.002) discard;
    // A shell standing in for a volume: how much lit air is behind a
    // fragment is near enough how square-on its wall is to the eye, and
    // both walls of the cone are drawn, so the middle gets both.
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float body = 0.28 + 0.72 * facing;
    // The lamp end is the bright end; the far end hands over to the pool
    float fall = 1.0 - vT;
    float a = uStrength * body * (0.22 + 0.78 * fall * fall);
    // Snow crossing the beam. One sine, and it is the difference between a
    // beam and a piece of coloured glass.
    a *= 0.92 + 0.08 * sin(vT * 26.0 - uTime * 5.0);
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.8), a * (1.0 - f));
  }
`;

const POOL_VERT = `
  attribute float aR;
  attribute float aYNext;
  uniform float uDrapeBlend;
  varying float vR;
  varying float vDepth;
  void main() {
    vR = aR;
    vec3 p = position;
    p.y = mix(position.y, aYNext, uDrapeBlend);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const POOL_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  varying float vR;
  varying float vDepth;
  void main() {
    if (uStrength <= 0.002) discard;
    // A hot middle and a defined edge. Without the edge the pool is a smudge
    // and stops reading as somewhere a light is pointing.
    float core = 1.0 - smoothstep(0.0, 0.86, vR);
    float rim = smoothstep(0.60, 0.88, vR) * (1.0 - smoothstep(0.88, 1.0, vR));
    float a = uStrength * (core * 0.85 + rim * 0.55);
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.8), a * (1.0 - f));
  }
`;

/* ==========================================================================
   The machine

   Piste patrol: rescue red, white cross, skids, a drum lamp slung under the
   nose. The cross is on the *belly* rather than on the flanks, which is the
   one piece of livery anyone will ever see — the rider is sixty metres
   underneath it looking up.
   ========================================================================== */

function hullGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 28, 18);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 2);
  const shell = '#cf3f2e';
  const trim = '#f2f5fa';
  const glass = '#141b28';
  const metal = '#333a46';
  const lens = '#ffe9b0';

  // Nose towards -Z, origin at the cabin's centre, y = 0 on the waterline.
  // About eleven metres long, which is a real light single.
  return compose(THREE, [
    // cabin, glass, and the fishbowl nose
    { geo: ball, color: shell, pos: [0, 0, -0.7], scale: [2.2, 2.1, 3.6] },
    { geo: ball, color: glass, pos: [0, -0.16, -1.95], scale: [1.9, 1.5, 1.7] },
    // Door glass, sat a little proud of the pod rather than flush with it —
    // a flat panel let into a faceted sphere is buried at its middle and
    // sticking out at its ends, and proud at least reads as a window frame
    { geo: box, color: glass, pos: [-1.04, 0.14, -0.95], scale: [0.14, 0.6, 1.4] },
    { geo: box, color: glass, pos: [1.04, 0.14, -0.95], scale: [0.14, 0.6, 1.4] },
    // the cross, on the underside, where it is the only livery that matters
    { geo: box, color: trim, pos: [0, -1.02, -0.8], scale: [1.0, 0.1, 0.3] },
    { geo: box, color: trim, pos: [0, -1.02, -0.8], scale: [0.3, 0.1, 1.0] },
    // tail boom, band, fin and stabiliser
    { geo: cyl, color: shell, pos: [0, 0.3, 2.9], rot: [Math.PI / 2, 0, 0], scale: [0.52, 4.2, 0.52] },
    { geo: cyl, color: trim, pos: [0, 0.3, 4.2], rot: [Math.PI / 2, 0, 0], scale: [0.56, 0.5, 0.56] },
    { geo: box, color: shell, pos: [0, 1.05, 4.95], rot: [0.2, 0, 0], scale: [0.12, 1.5, 1.0] },
    { geo: box, color: shell, pos: [0, 0.42, 4.3], scale: [2.2, 0.09, 0.62] },
    // tail rotor, as a disc: at this size a turning one would be a lie
    { geo: cyl, color: metal, pos: [0.34, 1.0, 5.05], rot: [0, 0, Math.PI / 2], scale: [1.1, 0.1, 1.1] },
    // mast
    { geo: cyl, color: metal, pos: [0, 1.28, -0.35], scale: [0.3, 0.6, 0.3] },
    // skids and their struts
    { geo: cyl, color: metal, pos: [-0.95, -1.75, -0.6], rot: [Math.PI / 2, 0, 0], scale: [0.14, 3.4, 0.14] },
    { geo: cyl, color: metal, pos: [0.95, -1.75, -0.6], rot: [Math.PI / 2, 0, 0], scale: [0.14, 3.4, 0.14] },
    { geo: box, color: metal, pos: [-0.78, -1.35, -1.5], rot: [0, 0, -0.32], scale: [0.1, 1.0, 0.14] },
    { geo: box, color: metal, pos: [0.78, -1.35, -1.5], rot: [0, 0, 0.32], scale: [0.1, 1.0, 0.14] },
    { geo: box, color: metal, pos: [-0.78, -1.35, 0.3], rot: [0, 0, -0.32], scale: [0.1, 1.0, 0.14] },
    { geo: box, color: metal, pos: [0.78, -1.35, 0.3], rot: [0, 0, 0.32], scale: [0.1, 1.0, 0.14] },
    // the lamp itself, slung under the nose. `LAMP` below has to agree with
    // where this sits, because the beam is drawn from it.
    { geo: cyl, color: metal, pos: [0, -1.22, -1.7], scale: [0.42, 0.45, 0.42] },
    { geo: ball, color: lens, pos: [0, -1.44, -1.7], scale: [0.36, 0.32, 0.36] },
    // navigation lights: red to port, green to starboard, white astern
    { geo: ball, color: '#e0342c', pos: [-1.08, 0.05, -0.6], scale: [0.2, 0.2, 0.2] },
    { geo: ball, color: '#2fd07a', pos: [1.08, 0.05, -0.6], scale: [0.2, 0.2, 0.2] },
    { geo: ball, color: '#ffffff', pos: [0, 1.72, 5.05], scale: [0.16, 0.16, 0.16] },
  ]);
}

function rotorGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 2);
  const blade = '#272c36';
  // Two crossing blades rather than four separate ones, sat at slightly
  // different heights so the overlap in the middle cannot z-fight, with the
  // hub covering the join. White tips, because a rotor reads as a rotor from
  // its tip path and from nothing else.
  return compose(THREE, [
    { geo: cyl, color: '#3d4450', pos: [0, 0.1, 0], scale: [0.62, 0.36, 0.62] },
    { geo: box, color: blade, pos: [0, 0.06, 0], scale: [0.34, 0.06, 11.4] },
    { geo: box, color: blade, pos: [0, 0.13, 0], rot: [0, Math.PI / 2, 0], scale: [0.34, 0.06, 11.4] },
    { geo: box, color: '#f2f5fa', pos: [0, 0.06, -5.5], scale: [0.35, 0.07, 0.5] },
    { geo: box, color: '#f2f5fa', pos: [0, 0.06, 5.5], scale: [0.35, 0.07, 0.5] },
    { geo: box, color: '#f2f5fa', pos: [-5.5, 0.13, 0], scale: [0.5, 0.07, 0.35] },
    { geo: box, color: '#f2f5fa', pos: [5.5, 0.13, 0], scale: [0.5, 0.07, 0.35] },
  ]);
}

/* The pool on the snow: a radial fan whose vertices are re-heighted from the
   hill so the light drapes over the moguls instead of hovering flat above
   them — but only while the lamp is actually lit and the aim point has
   actually moved; see `shine`. Twenty-four segments because the rim's edge is
   drawn radially in the fragment shader, so the segment count only decides
   how round the silhouette is, and a 24-gon eleven metres wide is round from
   anywhere the pool can be seen at night. */
const POOL_SEG = 24;
const POOL_RING = 6;

function poolGeometry(THREE) {
  const count = 1 + POOL_SEG * POOL_RING;
  const position = new Float32Array(count * 3);
  const yNext = new Float32Array(count);
  const radial = new Float32Array(count);
  const idx = [];

  for (let r = 1; r <= POOL_RING; r++) {
    const rad = (r / POOL_RING) * HELI.radius;
    for (let s = 0; s < POOL_SEG; s++) {
      const i = 1 + (r - 1) * POOL_SEG + s;
      const a = (s / POOL_SEG) * Math.PI * 2;
      position[i * 3] = Math.cos(a) * rad;
      position[i * 3 + 2] = Math.sin(a) * rad;
      radial[i] = r / POOL_RING;
    }
  }
  for (let s = 0; s < POOL_SEG; s++) {
    const n = (s + 1) % POOL_SEG;
    idx.push(0, 1 + s, 1 + n);
    for (let r = 1; r < POOL_RING; r++) {
      const a = 1 + (r - 1) * POOL_SEG + s;
      const b = 1 + (r - 1) * POOL_SEG + n;
      idx.push(a, a + POOL_SEG, b, b, a + POOL_SEG, b + POOL_SEG);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aYNext', new THREE.BufferAttribute(yNext, 1));
  geo.setAttribute('aR', new THREE.BufferAttribute(radial, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HELI.radius * 2);
  return { geo, position, yNext, count };
}

/* ==========================================================================
   The module
   ========================================================================== */

export function createHelicopter(THREE, shading) {
  const group = new THREE.Group();
  group.visible = false;

  // The machine spends most of its life at the fog's own distance, which is
  // exactly where the shared shading earns its keep: it dissolves into
  // whatever the sky is doing behind it rather than into a flat grey, so a
  // helicopter crossing in front of a sunset comes back out of it warm.
  const craftMaterial = shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }),
  );

  // Everything that banks together lives under one node; the rotor is its
  // own child so it can turn inside a machine that is leaning over.
  const craft = new THREE.Object3D();
  craft.rotation.order = 'YXZ';
  const hull = new THREE.Mesh(hullGeometry(THREE), craftMaterial);
  const rotor = new THREE.Mesh(rotorGeometry(THREE), craftMaterial);
  rotor.position.set(0, 1.55, -0.35);
  // The one flashing thing, and the only reason a machine that is still a
  // silhouette in the fog reads as a machine at all
  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3, 0),
    new THREE.MeshBasicMaterial({
      color: '#ff4a33', transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }),
  );
  beacon.position.set(0, -1.2, 0.7);
  craft.add(hull, rotor, beacon);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(HELI.beam) },
      uFog: { value: new THREE.Color('#1b2c4c') },
      uNear: { value: 85 },
      uFar: { value: 300 },
      uStrength: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  // Apex at the origin, base at y = -1 and radius 1, open-ended so the cap
  // never shows up as a disc hanging in the air
  const coneGeo = new THREE.ConeGeometry(1, 1, 36, 2, true);
  coneGeo.translate(0, -0.5, 0);
  const beam = new THREE.Mesh(coneGeo, beamMat);
  beam.frustumCulled = false;

  const pool = (() => {
    const built = poolGeometry(THREE);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(HELI.beam) },
        uFog: { value: new THREE.Color('#1b2c4c') },
        uNear: { value: 85 },
        uFar: { value: 300 },
        uStrength: { value: 0 },
        uDrapeBlend: { value: 1 },
      },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(built.geo, mat);
    mesh.frustumCulled = false;
    return {
      mesh, mat, position: built.position, yNext: built.yNext,
      count: built.count, geo: built.geo,
    };
  })();

  group.add(craft, beam, pool.mesh);

  // The two hand-fogged materials, held once rather than rebuilt as a fresh
  // array every frame in `update`
  const foggedMats = [beamMat, pool.mat];

  // --- state ---------------------------------------------------------------
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const aim = new THREE.Vector3();      // where the beam is resting, lagged
  const exit = new THREE.Vector3();
  const lamp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const LAMP = new THREE.Vector3(0, -1.44, -1.7);

  let phase = 'hangar';   // hangar | inbound | station | away
  let target = null;
  let flown = -1;         // the schedule window a sortie has already used
  let clock = 0;          // seconds, for the rotor, the beacon and the beam
  let orbit = 0;          // angle around the target
  let loiter = 0;
  let yaw = 0;
  let roll = 0;
  let pitch = 0;
  let lastYaw = 0;
  let turnRate = 0;
  let lastSpeed = 0;
  let lamps = 0;          // 0..1, the searchlight's own fade
  let lightClaimed = false; // one score opportunity per sortie
  let scoreSampleValid = false;
  let scoreDx = 0;
  let scoreDz = 0;
  // Where the pool was last draped over the hill, so a beam resting on a
  // stationary bear does not re-sample two hundred heights a frame for nothing
  let poolAimX = 0;
  let poolAimZ = 0;
  let poolPlaced = false;
  let poolDrapeBlend = 1;
  const poolDrapeScratch = new Float32Array(pool.count);
  let poolLiveX = 0;
  let poolLiveZ = 0;
  let poolAimVX = 0;
  let poolAimVZ = 0;
  let poolLiveValid = false;

  const hold = { x: 0, y: 0, z: 0 };   // the station point, rebuilt each frame

  /* ------------------------------------------------------------------ */

  /* Nearest live animal ahead of the rider. `hares` is sixteen, so this
     is sixteen comparisons and it only runs while the machine is deciding something. */
  function findTarget(rider, targets) {
    const rz = rider.pos.z;
    let best = null;
    let bestGap = Infinity;

    const hares = targets.hares;
    for (let i = 0; i < hares.length; i++) {
      const h = hares[i];
      if (!h.alive) continue;
      const gap = rz - h.z;
      if (gap < HELI.searchNear || gap > HELI.hareSearch) continue;
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    return best;
  }

  function launch(found, slot) {
    target = found;
    flown = slot;
    phase = 'inbound';
    loiter = 0;
    // Which way round the circle it comes at the target from is the last
    // free choice in the sortie, and it is the hill's too — nothing in this
    // file is allowed to be seeded from a clock
    orbit = hash2(slot, 5, 23) * Math.PI * 2;

    // It starts just off station, on whichever side of the piste it has more
    // room — which the hill decides, not a coin — and slides across onto the
    // target. Far enough out to be visibly flying, near enough to be there
    // before the rider is.
    const z = target.z - HELI.entry * 0.35;
    const centre = nearestCenter(target.x, target.z);
    const side = target.x >= centre ? 1 : -1;
    const x = target.x + side * HELI.entry;
    pos.set(x, heightAt(x, z) + HELI.hover + HELI.entryUp, z);

    // The beam starts out on the corridor edge and sweeps onto the animal as
    // the lamp comes up, so the first thing the light does is find something
    const edge = centre + side * corridorHalfAt(target.z);
    aim.set(edge, heightAt(edge, target.z), target.z);
    // Already flying when it appears — a helicopter accelerating from rest
    // in mid-air is the tell that it was put there
    vel.set(target.x - x, 0, target.z - z).normalize().multiplyScalar(HELI.cruise * 0.5);
    yaw = Math.atan2(-vel.x, -vel.z);
    lastYaw = yaw;
    turnRate = 0;
    lastSpeed = vel.length();
    roll = 0;
    pitch = 0;
    lamps = 0;
    lightClaimed = false;
    scoreSampleValid = false;
    poolPlaced = false;
    poolLiveValid = false;
    group.visible = true;
  }

  function breakOff() {
    if (phase === 'away' || phase === 'hangar') return;
    phase = 'away';
    target = null;
    loiter = 0;
    scoreSampleValid = false;
    // Across the run, climbing, and on down the valley: it clears the piste
    // first, which is what the machine would do and also the fastest way out
    // of a picture that is only three hundred metres deep
    const centre = nearestCenter(pos.x, pos.z);
    const out = pos.x >= centre ? 1 : -1;
    exit.set(out * 0.9, 0.12, -0.85).normalize().multiplyScalar(700).add(pos);
  }

  function hangar() {
    phase = 'hangar';
    target = null;
    lamps = 0;
    scoreSampleValid = false;
    group.visible = false;
  }

  /* Arrive-behaviour: want a velocity towards the point, capped by how far
     away it is and by how fast the machine flies, and get there at `accel`
     and no faster. */
  function fly(dt, tx, ty, tz, maxSpeed) {
    const ex = tx - pos.x;
    const ey = ty - pos.y;
    const ez = tz - pos.z;
    const dist = Math.hypot(ex, ey, ez);
    const want = Math.min(maxSpeed, dist * HELI.arrive);
    const k = dist > 1e-3 ? want / dist : 0;
    const dvx = ex * k - vel.x;
    const dvy = ey * k - vel.y;
    const dvz = ez * k - vel.z;
    const mag = Math.hypot(dvx, dvy, dvz);
    const a = mag > 1e-4 ? Math.min(HELI.accel, mag * HELI.response) / mag : 0;
    vel.x += dvx * a * dt;
    vel.y += dvy * a * dt;
    vel.z += dvz * a * dt;
    pos.addScaledVector(vel, dt);
    // The hard floor. Nothing on the mountain reaches this, and the rider
    // least of all.
    const floor = heightAt(pos.x, pos.z) + HELI.floor;
    if (pos.y < floor) {
      pos.y = floor;
      if (vel.y < 0) vel.y = 0;
    }
    return dist;
  }

  /* Attitude, all of it derived from what the machine just did rather than
     scripted: the nose follows the flight path, the roll follows the turn,
     and the pitch follows the acceleration. */
  function attitude(dt) {
    const flatSpeed = Math.hypot(vel.x, vel.z);
    if (flatSpeed > 1.5) {
      const wantYaw = Math.atan2(-vel.x, -vel.z);
      yaw += wrapPi(wantYaw - yaw) * (1 - Math.exp(-HELI.slew * dt));
    }
    const rate = wrapPi(yaw - lastYaw) / Math.max(dt, 1e-4);
    lastYaw = yaw;
    turnRate += (rate - turnRate) * (1 - Math.exp(-6 * dt));

    // Increasing yaw swings the nose to port, and a machine turning to port
    // drops its port side — so the sign here is positive, and it is the only
    // part of this file that is easier to derive than to look at.
    const wantRoll = clamp(turnRate * flatSpeed * HELI.bank, -HELI.bankMax, HELI.bankMax);
    roll += (wantRoll - roll) * (1 - Math.exp(-3.2 * dt));

    const along = (flatSpeed - lastSpeed) / Math.max(dt, 1e-4);
    lastSpeed = flatSpeed;
    const wantPitch = clamp(
      -(flatSpeed * HELI.cruisePitch + along * HELI.pitchGain), -HELI.pitchMax, HELI.pitchMax,
    );
    pitch += (wantPitch - pitch) * (1 - Math.exp(-2.6 * dt));

    craft.position.copy(pos);
    craft.rotation.set(pitch, yaw, roll);
    rotor.rotation.y = clock * HELI.rotor;
    // A short bright flash and a long dark gap, which is what an
    // anticollision beacon is and what a sine is not
    const beat = clock % HELI.beacon;
    beacon.material.opacity = Math.max(0, 1 - beat / 0.14) * 0.9;
  }

  /* The beam: from the lamp under the nose to wherever it is resting, driven
     a sixth of its own length into the hill so the depth buffer decides
     where it stops. */
  function shine(dt) {
    lamp.copy(LAMP).applyQuaternion(craft.quaternion).add(pos);
    dir.copy(aim).sub(lamp);
    const len = dir.length();
    if (len > 1e-3) {
      dir.multiplyScalar(1 / len);
      q.setFromUnitVectors(DOWN, dir);
      beam.position.copy(lamp);
      beam.quaternion.copy(q);
      beam.scale.set(
        HELI.radius * HELI.overshoot, len * HELI.overshoot, HELI.radius * HELI.overshoot,
      );
    }

    // The mesh centre follows the beam every frame. The expensive height fan
    // is prepared separately once the aim has moved a third of a metre, then
    // blended on the GPU from the already-visible fan to that complete target.
    // That leaves no half-built terrain and no positional step to publish.
    pool.mesh.position.copy(aim);
    if (poolLiveValid) {
      const invDt = 1 / Math.max(dt, 1e-4);
      const follow = 1 - Math.exp(-8 * Math.min(dt, 0.05));
      poolAimVX += ((aim.x - poolLiveX) * invDt - poolAimVX) * follow;
      poolAimVZ += ((aim.z - poolLiveZ) * invDt - poolAimVZ) * follow;
    } else {
      poolAimVX = 0;
      poolAimVZ = 0;
      poolLiveValid = true;
    }
    poolLiveX = aim.x;
    poolLiveZ = aim.z;
    if (poolPlaced && poolDrapeBlend < 1) {
      poolDrapeBlend = Math.min(1, poolDrapeBlend + dt / HELI.drapeBlend);
      pool.mat.uniforms.uDrapeBlend.value = smooth01(poolDrapeBlend);
    }
    const mx = aim.x - poolAimX;
    const mz = aim.z - poolAimZ;
    /* Do not replace a back buffer while it is becoming visible. Instead the
       completed target is sampled ahead along the already-smoothed aim
       velocity, so it meets the moving pool at the end of the transition. */
    const canPrepare = !poolPlaced || poolDrapeBlend >= 1;
    if (canPrepare && (!poolPlaced || mx * mx + mz * mz > 0.09)) {
      const lead = poolPlaced ? HELI.drapeBlend * 0.82 : 0;
      const sampleX = aim.x + poolAimVX * lead;
      const sampleZ = aim.z + poolAimVZ * lead;
      const ay = heightAt(sampleX, sampleZ);
      const p = pool.position;
      for (let i = 0; i < pool.count; i++) {
        const j = i * 3;
        poolDrapeScratch[i] = heightAt(sampleX + p[j], sampleZ + p[j + 2]) - ay + 0.08;
      }

      if (!poolPlaced) {
        for (let i = 0; i < pool.count; i++) {
          pool.position[i * 3 + 1] = poolDrapeScratch[i];
          pool.yNext[i] = poolDrapeScratch[i];
        }
        poolDrapeBlend = 1;
      } else {
        // If a faster target asks for another fan mid-transition, first bake
        // the exact interpolated picture into the front buffer. The next
        // transition therefore starts at the pixel the previous one reached.
        const blend = smooth01(poolDrapeBlend);
        for (let i = 0; i < pool.count; i++) {
          const j = i * 3 + 1;
          pool.position[j] += (pool.yNext[i] - pool.position[j]) * blend;
          pool.yNext[i] = poolDrapeScratch[i];
        }
        poolDrapeBlend = 0;
      }
      pool.geo.attributes.position.needsUpdate = true;
      pool.geo.attributes.aYNext.needsUpdate = true;
      pool.mat.uniforms.uDrapeBlend.value = smooth01(poolDrapeBlend);
      poolAimX = sampleX;
      poolAimZ = sampleZ;
      poolPlaced = true;
    }

    beamMat.uniforms.uStrength.value = HELI.beamStrength * lamps;
    beamMat.uniforms.uTime.value = clock;
    pool.mat.uniforms.uStrength.value = HELI.poolStrength * lamps;
    // The parent group owns visibility. These meshes stay present with a
    // continuous zero-strength state so neither threshold can switch a light.
    beam.visible = true;
    pool.mesh.visible = true;
  }

  /* ------------------------------------------------------------------ */

  function update(dt, rider, targets, weather) {
    clock += dt;

    if (phase === 'hangar') {
      // Three gates, all of which have to be open at once: the right stretch
      // of hill, a dark enough sky, and air worth flying in.
      const slot = Math.floor(Math.max(0, rider.distance) / HELI.period);
      if (slot === flown) return;
      if (weather.night < HELI.nightFrom || weather.storm > HELI.stormMax) return;
      if (hash2(slot, 0, 61) >= HELI.chance) return;
      const found = findTarget(rider, targets, false);
      if (!found) return;
      launch(found, slot);
    }

    // The fog is folded in by hand in both shaders, so both need telling —
    // but only while there is a sortie to tell. This sits after the hangar
    // gates so a grounded machine costs nothing, and after `launch` so the
    // first visible frame already agrees with the weather. main.js can also
    // drive these from its particle loop — `fogged` below is exactly the
    // shape that loop wants — but doing it here means the wiring is one line
    // and cannot be forgotten.
    for (let i = 0; i < foggedMats.length; i++) {
      const m = foggedMats[i];
      m.uniforms.uFog.value.copy(weather.haze);
      m.uniforms.uNear.value = weather.fogNear;
      m.uniforms.uFar.value = weather.fogFar;
    }

    if (phase === 'away') {
      loiter += dt;
      fly(dt, exit.x, exit.y, exit.z, HELI.departSpeed);
      lamps = Math.max(0, lamps - dt / (HELI.lampFade * 0.45));
      attitude(dt);
      shine(dt);
      if (loiter > HELI.maxAway
        || Math.hypot(pos.x - rider.pos.x, pos.z - rider.pos.z) > HELI.gone) hangar();
      return;
    }

    // --- there is a target, and the machine is working ---------------------
    // Anything that ends the job ends it here: the rider is past it, the
    // animal is gone, the sky is coming up, or the weather has closed in.
    if (!target || !target.alive
      || target.z - rider.pos.z > HELI.passBy
      || weather.night < HELI.nightHold
      || weather.storm > HELI.stormHold
      || loiter > HELI.maxStation) {
      breakOff();
      return;
    }



    orbit += HELI.orbitRate * dt;
    hold.x = target.x + Math.cos(orbit) * HELI.orbit;
    hold.z = target.z + Math.sin(orbit) * HELI.orbit * HELI.orbitAlong;
    hold.y = heightAt(hold.x, hold.z) + HELI.hover
      + Math.sin(orbit * 1.65) * HELI.orbitLift;

    const off = fly(dt, hold.x, hold.y, hold.z, HELI.cruise);
    if (phase === 'inbound' && off < HELI.stationRange) phase = 'station';
    if (phase === 'station') loiter += dt;

    // The lamp comes up the moment it is on the job, and the aim lags the
    // animal, so a bolting rabbit is chased rather than tracked perfectly
    lamps = Math.min(1, lamps + dt / HELI.lampFade);
    const k = 1 - Math.exp(-dt / HELI.track);
    aim.x += (target.x - aim.x) * k;
    aim.z += (target.z - aim.z) * k;
    aim.y = heightAt(aim.x, aim.z);

    attitude(dt);
    shine(dt);
  }

  function reset() {
    hangar();
    flown = -1;
    loiter = 0;
    vel.set(0, 0, 0);
    lamps = 0;
    lightClaimed = false;
    scoreSampleValid = false;
    beamMat.uniforms.uStrength.value = 0;
    pool.mat.uniforms.uStrength.value = 0;
  }

  /* A deterministic tuning hatch for browser QA. It still uses the real
     target selection and launch path; it only bypasses the rare schedule and
     weather gates so movement, light placement and scoring can be inspected. */
  function debugLaunch(rider, targets) {
    if (phase !== 'hangar') return false;
    const found = findTarget(rider, targets, false);
    if (!found) return false;
    launch(found, Math.floor(Math.max(0, rider.distance) / HELI.period));
    return true;
  }

  /* Entering the visibly lit snow is a one-shot skill target. Keep the test
     on the same lagged `aim` point that draws the pool, so the collision and
     picture cannot disagree while the beam swings after a moving animal. */
  function claimLight(rider) {
    const active = !lightClaimed && lamps >= HELI.scoreLamp
      && (phase === 'inbound' || phase === 'station')
      && rider.grounded && rider.state !== 'fall' && rider.state !== 'rise';
    if (!active) {
      scoreSampleValid = false;
      return false;
    }

    const dx = rider.pos.x - aim.x;
    const dz = rider.pos.z - aim.z;
    const radius = HELI.radius * HELI.scoreRadius;
    let distance2 = dx * dx + dz * dz;
    /* Sweep the rider relative to the moving pool. Ordinary frame steps are
       much smaller than the light, but W can reach 250 m/s; the
       segment test keeps an extreme-speed crossing scoreable as well. */
    if (scoreSampleValid) {
      const vx = dx - scoreDx;
      const vz = dz - scoreDz;
      const vv = vx * vx + vz * vz;
      if (vv > 1e-8) {
        const t = clamp(-(scoreDx * vx + scoreDz * vz) / vv, 0, 1);
        const sx = scoreDx + vx * t;
        const sz = scoreDz + vz * t;
        distance2 = Math.min(distance2, sx * sx + sz * sz);
      }
    }
    scoreDx = dx;
    scoreDz = dz;
    scoreSampleValid = true;
    if (distance2 > radius * radius) return false;
    lightClaimed = true;
    scoreSampleValid = false;
    return true;
  }

  /* `fogged` is the two meshes carrying uFog/uNear/uFar, in the shape
     main.js's particle loop already takes, for anyone who would rather see
     every fog write in one place in the frame. `phase` is for the debug
     hatch — the schedule is deliberately rare, and a feature you cannot
     see without waiting four minutes is a feature you cannot tune. */
  return {
    group,
    update,
    reset,
    claimLight,
    debugLaunch,
    fogged: [beam, pool.mesh],
    get phase() { return phase; },
    debug: () => ({
      phase,
      lamps,
      claimed: lightClaimed,
      position: pos.toArray(),
      light: aim.toArray(),
      radius: HELI.radius,
    }),
  };
}
