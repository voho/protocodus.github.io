/* The rider's night light.

   The mountain already owns the clock. This module only translates its
   continuous `weather.night` signal into something attached to the animated
   head: a small helmet lamp, a fog-aware cone of scattered light, and a
   terrain-draped pool where the beam reaches the snow.

   This deliberately is not a THREE.SpotLight. The terrain's snow response is
   authored around one directional sun/moon source, while a moving spotlight
   would add another full light variant to every Lambert material and still
   would not light the custom snow-particle shaders. The additive shell is the
   same proven trick as the patrol helicopter: it draws the air the light is
   travelling through, lets the depth buffer cut it against terrain and trees,
   and spends one small shader plus one small snow fan.

   Helmet-forward is local +X in riderModel. The emitter inherits the animated
   head, while the soft beam itself is solved from real travel projected onto
   the snow. The lamp therefore stays on the forehead but always illuminates
   the downhill line being ridden, including through a carve or switch run. */

export const HEADLAMP = {
  nightFrom: 0.28,      // begins to glow in blue hour
  nightFull: 0.76,      // fully established by nightfall
  fadeIn: 4.0,          // response per second; a fade, never a switch
  fadeOut: 2.8,
  reach: 42,            // metres searched for the first snow intersection
  /* The march grows geometrically rather than pacing off the whole reach in
     fixed strides: the ground the beam hits is usually near, so the search
     spends its small steps where the answer probably is and covers the far
     half of the reach in a few long ones. Ten samples worst case against
     the thirty-four the fixed step cost, and the crossing is still refined
     by interpolation afterwards, so the pool does not get coarser. */
  marchStep: 0.8,       // the first stride, in metres
  marchGrow: 1.35,      // and how much longer each following stride is
  overshoot: 1.0,       // fade reaches zero exactly at the terrain hit
  drop: 0.105,          // radians below the animated line of sight
  angle: 0.40,          // broad 23-degree half-angle; soft situational light
  beam: '#b7d7f2',
  beamStrength: 0.008,
  poolStrength: 0.032,
  hitFadeIn: 10.0,      // terrain contact establishes without a binary edge
  hitFadeOut: 5.0,
  hitTrack: 12.0,       // visible contact follows a changing ray with weight
  drapeBlend: 0.18,     // complete prepared fans blend in on the GPU
};

const TAU = Math.PI * 2;
/* The drape's density. It was 48 x 8, which is 384 height-field samples and
   a full vertex upload every lit frame — for a soft additive gaussian whose
   whole job is to have no features. 24 x 5 is 120 samples, and on a footprint
   a few metres wide that is still a vertex every fraction of a metre, well
   under anything the blur in the fragment shader could resolve. */
const POOL_SEG = 24;
const POOL_RING = 5;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const approach = (v, target, rate, dt) => (
  v + (target - v) * (1 - Math.exp(-rate * Math.min(dt, 0.05)))
);

/* A cone surface standing in for illuminated air. Fog is folded in manually:
   ShaderMaterial receives none of Three's scene fog unless it is authored. */
const BEAM_VERT = `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    if (uStrength <= 0.001) discard;
    float along = vUv.x;
    float across = abs(vUv.y * 2.0 - 1.0);
    // A camera-facing slice through a volume: there is no lit polygon edge,
    // only a soft radial density that falls to zero before the quad ends.
    float radial = exp(-2.6 * across * across)
      * (1.0 - smoothstep(0.72, 1.0, across));
    float enter = smoothstep(0.0, 0.10, along);
    float leave = 1.0 - smoothstep(0.58, 0.94, along);
    float a = uStrength * radial * enter * leave
      * (0.28 + 0.72 * (1.0 - along));
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.82), a * (1.0 - f));
  }
`;

const POOL_VERT = `
  attribute vec2 aUv;
  attribute vec3 aPositionNext;
  uniform float uDrapeBlend;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = aUv;
    vec3 p = mix(position, aPositionNext, uDrapeBlend);
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
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    if (uStrength <= 0.001) discard;
    float r = length(vUv);
    float a = uStrength * exp(-0.8 * r * r)
      * (1.0 - smoothstep(0.40, 1.0, r));
    float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.82), a * (1.0 - f));
  }
`;

function haloTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const glow = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.16, 'rgba(220,242,255,0.95)');
  glow.addColorStop(0.48, 'rgba(145,205,255,0.28)');
  glow.addColorStop(1, 'rgba(80,150,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function poolGeometry(THREE) {
  const count = 1 + POOL_SEG * POOL_RING;
  const position = new Float32Array(count * 3);
  const positionNext = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = [];

  for (let r = 1; r <= POOL_RING; r++) {
    for (let s = 0; s < POOL_SEG; s++) {
      const i = 1 + (r - 1) * POOL_SEG + s;
      const a = (s / POOL_SEG) * TAU;
      uv[i * 2] = Math.cos(a) * (r / POOL_RING);
      uv[i * 2 + 1] = Math.sin(a) * (r / POOL_RING);
    }
  }
  for (let s = 0; s < POOL_SEG; s++) {
    const next = (s + 1) % POOL_SEG;
    index.push(0, 1 + next, 1 + s);
    for (let r = 1; r < POOL_RING; r++) {
      const a = 1 + (r - 1) * POOL_SEG + s;
      const b = 1 + (r - 1) * POOL_SEG + next;
      index.push(a, b, a + POOL_SEG, b, b + POOL_SEG, a + POOL_SEG);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aPositionNext', new THREE.BufferAttribute(positionNext, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
  return { geometry, position, positionNext, count };
}

export function createHeadlamp(THREE, shading, head) {
  const rig = new THREE.Group();
  rig.name = 'rider-headlamp';
  head.add(rig);

  /* A real helmet mount, not a floating emissive dot: elastic band, aluminium
     barrel, glass lens and a tiny additive bloom visible from the chase view. */
  const strapMat = shading.apply(new THREE.MeshLambertMaterial({ color: '#111722' }));
  const housingMat = shading.apply(new THREE.MeshLambertMaterial({ color: '#343d49' }));
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.120, 0.008, 8, 36), strapMat);
  strap.position.y = 0.205;
  strap.rotation.x = Math.PI / 2;
  strap.name = 'rider-headlamp-strap';
  rig.add(strap);

  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.043, 0.060, 24, 2),
    housingMat,
  );
  housing.position.set(0.132, 0.205, 0);
  housing.rotation.z = -Math.PI / 2;
  housing.name = 'rider-headlamp-housing';
  rig.add(housing);

  const offColor = new THREE.Color('#18304a');
  const onColor = new THREE.Color('#e8f8ff');
  const lensMat = new THREE.MeshBasicMaterial({ color: offColor, toneMapped: false });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 28), lensMat);
  lens.position.set(0.164, 0.205, 0);
  lens.rotation.y = Math.PI / 2;
  lens.name = 'rider-headlamp-lens';
  lens.userData.noShadow = true;
  rig.add(lens);

  const haloMat = new THREE.SpriteMaterial({
    map: haloTexture(THREE), color: HEADLAMP.beam,
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(0.174, 0.205, 0);
  halo.scale.set(0.20, 0.20, 1);
  halo.name = 'rider-headlamp-glow';
  halo.visible = false;
  rig.add(halo);

  /* The emitter stays on the animated forehead. Its beam direction is solved
     from travel each frame below, so a carve or switch line follows where the
     board is actually moving rather than where its nose happens to point. */
  const aim = new THREE.Group();
  aim.position.set(0.170, 0.205, 0);
  aim.name = 'rider-headlamp-aim';
  rig.add(aim);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(HEADLAMP.beam) },
      uFog: { value: new THREE.Color('#1a2a48') },
      uNear: { value: 85 },
      uFar: { value: 300 },
      uStrength: { value: 0 },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  /* Four dynamic vertices make a soft slice through the beam volume. The
     slice rotates about the ray to face the camera each frame; its fragment
     density goes to zero before every edge, so it cannot expose a giant cone
     silhouette when the chase camera sits close behind the lamp. */
  const beamPosition = new Float32Array(12);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPosition, 3));
  beamGeo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 1, 0, 1, 1,
  ], 2));
  beamGeo.setIndex([0, 2, 1, 1, 2, 3]);
  beamGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HEADLAMP.reach * 1.5);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'rider-headlamp-beam';
  beam.userData.noShadow = true;
  beam.frustumCulled = false;
  beam.visible = false;

  const built = poolGeometry(THREE);
  const poolMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(HEADLAMP.beam) },
      uFog: { value: new THREE.Color('#1a2a48') },
      uNear: { value: 85 },
      uFar: { value: 300 },
      uStrength: { value: 0 },
      uDrapeBlend: { value: 1 },
    },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pool = new THREE.Mesh(built.geometry, poolMat);
  pool.name = 'rider-headlamp-pool';
  pool.userData.noShadow = true;
  pool.frustumCulled = false;
  pool.visible = false;

  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const point = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const off = new THREE.Vector3();
  const horizontal = new THREE.Vector3();
  const side = new THREE.Vector3();
  const view = new THREE.Vector3();
  const beamSide = new THREE.Vector3();
  const beamStart = new THREE.Vector3();
  const beamEnd = new THREE.Vector3();
  let level = 0;
  let hitDistance = 0;
  let hasHit = false;
  let displayedDistance = HEADLAMP.reach;
  let hitVisibility = 0;
  let displayedHitReady = false;
  const displayedHit = new THREE.Vector3();
  /* Re-sampling the height field under the pool is the expensive half of this
     module. A complete target fan is prepared only after meaningful movement,
     rotation or scale, then a shader blends to it. The render path therefore
     sees two coherent drapes and never a geometry upload masquerading as a
     light moving in the background. */
  const lastDrape = new THREE.Vector3();
  const lastDrapeDirection = new THREE.Vector3(1, 0, 0);
  const drapeSample = new THREE.Vector3();
  let draped = false;
  let lastDrapeFootprint = 0;
  let drapeBlend = 1;
  const drapeScratch = new Float32Array(built.position.length);

  function update(weather, dt, rider, camera) {
    const darkness = smooth01(
      (weather.night - HEADLAMP.nightFrom)
      / (HEADLAMP.nightFull - HEADLAMP.nightFrom),
    );
    level = approach(level, darkness,
      darkness > level ? HEADLAMP.fadeIn : HEADLAMP.fadeOut, dt);

    lensMat.color.copy(offColor).lerp(onColor, level);
    haloMat.opacity = level * 0.92;
    halo.visible = level > 0.008;
    beamMat.uniforms.uFog.value.copy(weather.haze);
    beamMat.uniforms.uNear.value = weather.fogNear;
    beamMat.uniforms.uFar.value = weather.fogFar;
    poolMat.uniforms.uFog.value.copy(weather.haze);
    poolMat.uniforms.uNear.value = weather.fogNear;
    poolMat.uniforms.uFar.value = weather.fogFar;

    if (level <= 0.008) {
      beamMat.uniforms.uStrength.value = 0;
      poolMat.uniforms.uStrength.value = 0;
      beam.visible = false;
      pool.visible = false;
      hasHit = false;
      hitDistance = 0;
      displayedDistance = HEADLAMP.reach;
      hitVisibility = 0;
      displayedHitReady = false;
      draped = false;
      drapeBlend = 1;
      return;
    }

    /* Position comes from the animated forehead; direction comes from actual
       travel. Projecting the horizontal velocity back onto the snow tangent
       retains the downhill pitch, and the small inward cant guarantees a hit
       ahead even on a flat patch. This is deliberately independent of board
       nose, stance and camera, so switch and a broad carve remain honest. */
    aim.getWorldPosition(origin);
    direction.set(rider.vel.x, 0, rider.vel.z);
    if (direction.lengthSq() < 0.0625) direction.copy(rider.heading);
    direction.addScaledVector(rider.normal, -direction.dot(rider.normal));
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize().addScaledVector(rider.normal, -Math.tan(HEADLAMP.drop)).normalize();

    /* The march, seeded by its own last answer. The ground barely moves
       between two frames, so while last frame found a hit the strides are
       held to about a third of that distance until the ray has walked past
       it — the samples cluster exactly where the crossing is about to be —
       and only then are the strides allowed to run out geometrically. A
       bracketed crossing takes one midpoint sample before the linear
       refinement, which halves the interval the interpolation runs in and
       stops the pool creeping when the bracketing strides were long. */
    const seedDist = hasHit ? hitDistance : 0;
    let previousT = 0.25;
    point.copy(origin).addScaledVector(direction, previousT);
    let previousGap = point.y - rider.world.height(point.x, point.z);
    hasHit = false;
    hitDistance = HEADLAMP.reach;
    let stride = HEADLAMP.marchStep;
    let t = previousT + stride;
    for (;;) {
      if (t > HEADLAMP.reach) t = HEADLAMP.reach;
      point.copy(origin).addScaledVector(direction, t);
      let gap = point.y - rider.world.height(point.x, point.z);
      if (gap <= 0 && previousGap > 0) {
        const tm = (previousT + t) * 0.5;
        point.copy(origin).addScaledVector(direction, tm);
        const gm = point.y - rider.world.height(point.x, point.z);
        if (gm <= 0) {
          t = tm;
          gap = gm;
        } else {
          previousT = tm;
          previousGap = gm;
        }
        const span = previousGap - gap;
        hitDistance = previousT + (t - previousT) * (previousGap / Math.max(1e-4, span));
        hit.copy(origin).addScaledVector(direction, hitDistance);
        hit.y = rider.world.height(hit.x, hit.z);
        hasHit = true;
        break;
      }
      if (t >= HEADLAMP.reach) break;
      previousT = t;
      previousGap = gap;
      stride *= HEADLAMP.marchGrow;
      if (seedDist > 0 && t < seedDist) {
        stride = Math.min(stride, Math.max(HEADLAMP.marchStep, seedDist * 0.3));
      }
      t += stride;
    }

    // A ray/terrain intersection can legitimately disappear for one frame at
    // a ridge or while the animated normal changes. Its picture cannot. Beam
    // length, contact position and returned-light weight all carry continuous
    // display state, while `hasHit` remains the honest instantaneous result.
    displayedDistance = approach(
      displayedDistance, hasHit ? hitDistance : HEADLAMP.reach,
      hasHit ? HEADLAMP.hitTrack : HEADLAMP.hitFadeOut, dt,
    );
    if (hasHit) {
      if (!displayedHitReady || hitVisibility < 0.001) {
        displayedHit.copy(hit);
      } else {
        const follow = 1 - Math.exp(-HEADLAMP.hitTrack * Math.min(dt, 0.05));
        displayedHit.x += (hit.x - displayedHit.x) * follow;
        displayedHit.z += (hit.z - displayedHit.z) * follow;
        displayedHit.y = rider.world.height(displayedHit.x, displayedHit.z);
      }
      displayedHitReady = true;
    }
    hitVisibility = approach(
      hitVisibility, hasHit ? 1 : 0,
      hasHit ? HEADLAMP.hitFadeIn : HEADLAMP.hitFadeOut, dt,
    );

    const drawnLength = displayedDistance * HEADLAMP.overshoot;
    const radius = Math.max(0.18, Math.tan(HEADLAMP.angle) * drawnLength);
    view.copy(camera.position).sub(origin);
    beamSide.crossVectors(direction, view);
    if (beamSide.lengthSq() < 1e-6) beamSide.crossVectors(direction, rider.normal);
    if (beamSide.lengthSq() < 1e-6) beamSide.set(0, 0, 1);
    beamSide.normalize();
    beamStart.copy(direction).multiplyScalar(0.06);
    beamEnd.copy(direction).multiplyScalar(drawnLength);
    const pBeam = beamPosition;
    const startWidth = 0.018;
    pBeam[0] = beamStart.x - beamSide.x * startWidth;
    pBeam[1] = beamStart.y - beamSide.y * startWidth;
    pBeam[2] = beamStart.z - beamSide.z * startWidth;
    pBeam[3] = beamStart.x + beamSide.x * startWidth;
    pBeam[4] = beamStart.y + beamSide.y * startWidth;
    pBeam[5] = beamStart.z + beamSide.z * startWidth;
    pBeam[6] = beamEnd.x - beamSide.x * radius;
    pBeam[7] = beamEnd.y - beamSide.y * radius;
    pBeam[8] = beamEnd.z - beamSide.z * radius;
    pBeam[9] = beamEnd.x + beamSide.x * radius;
    pBeam[10] = beamEnd.y + beamSide.y * radius;
    pBeam[11] = beamEnd.z + beamSide.z * radius;
    beamGeo.attributes.position.needsUpdate = true;
    beam.position.copy(origin);
    // More suspended snow makes the shaft more visible, without making the
    // footprint brighter than the snow around it can plausibly return.
    beamMat.uniforms.uStrength.value = level * HEADLAMP.beamStrength
      * (0.72 + weather.storm * 0.75);
    beam.visible = true;

    if (!displayedHitReady) {
      poolMat.uniforms.uStrength.value = 0;
      pool.visible = false;
      return;
    }

    /* The visible centre tracks continuously. Fan resampling is guarded, but
       no guarded result is ever assigned directly: it is built in scratch,
       installed as the next complete vertex state, then eased by the shader. */
    pool.position.copy(displayedHit);
    if (draped && drapeBlend < 1) {
      drapeBlend = Math.min(1, drapeBlend + dt / HEADLAMP.drapeBlend);
      poolMat.uniforms.uDrapeBlend.value = smooth01(drapeBlend);
    }
    const footprint = Math.max(1.25, Math.tan(HEADLAMP.angle) * displayedDistance);
    horizontal.set(direction.x, 0, direction.z);
    if (horizontal.lengthSq() < 1e-5) horizontal.set(rider.heading.x, 0, rider.heading.z);
    horizontal.normalize();
    const moved = lastDrape.distanceToSquared(displayedHit) > 0.04;
    const turned = lastDrapeDirection.dot(horizontal) < 0.998;
    const resized = Math.abs(lastDrapeFootprint - footprint) > 0.12;
    /* Let the prepared target finish before its buffer is reused. At riding
       speed the pool will have moved during that short blend, so sample one
       transition ahead along the known rider velocity: the target is already
       waiting where the light is due to arrive. */
    const canPrepare = !draped || drapeBlend >= 1;
    if (hasHit && canPrepare && (!draped || moved || turned || resized)) {
      drapeSample.copy(displayedHit);
      if (draped) {
        const lead = HEADLAMP.drapeBlend * 0.82;
        drapeSample.x += rider.vel.x * lead;
        drapeSample.z += rider.vel.z * lead;
        drapeSample.y = rider.world.height(drapeSample.x, drapeSample.z);
      }
      const baseY = drapeSample.y;
      side.set(-horizontal.z, 0, horizontal.x);
      drapeScratch[0] = 0;
      drapeScratch[1] = 0.065;
      drapeScratch[2] = 0;
      for (let ring = 1; ring <= POOL_RING; ring++) {
        const r = ring / POOL_RING;
        for (let s = 0; s < POOL_SEG; s++) {
          const i = 1 + (ring - 1) * POOL_SEG + s;
          const j = i * 3;
          const a = (s / POOL_SEG) * TAU;
          const along = Math.cos(a) * footprint * 1.05 * r;
          const across = Math.sin(a) * footprint * 2.25 * r;
          off.copy(horizontal).multiplyScalar(along).addScaledVector(side, across);
          drapeScratch[j] = off.x;
          drapeScratch[j + 2] = off.z;
          drapeScratch[j + 1] = rider.world.height(
            drapeSample.x + off.x, drapeSample.z + off.z,
          ) - baseY + 0.055;
        }
      }

      if (!draped) {
        built.position.set(drapeScratch);
        built.positionNext.set(drapeScratch);
        drapeBlend = 1;
      } else {
        // The previous target is complete here, so it becomes the next front
        // in one upload while the shader is still displaying exactly it.
        const blend = smooth01(drapeBlend);
        for (let i = 0; i < built.position.length; i++) {
          built.position[i] += (built.positionNext[i] - built.position[i]) * blend;
        }
        built.positionNext.set(drapeScratch);
        drapeBlend = 0;
      }
      built.geometry.attributes.position.needsUpdate = true;
      built.geometry.attributes.aPositionNext.needsUpdate = true;
      poolMat.uniforms.uDrapeBlend.value = smooth01(drapeBlend);
      lastDrape.copy(drapeSample);
      lastDrapeDirection.copy(horizontal);
      lastDrapeFootprint = footprint;
      draped = true;
    }
    poolMat.uniforms.uStrength.value = level * HEADLAMP.poolStrength
      * (1 - weather.storm * 0.24) * hitVisibility;
    pool.visible = draped;
  }

  return {
    rig,
    beam,
    pool,
    update,
    get level() { return level; },
    // The live beam state, for anything that wants to answer the lamp —
    // the wildlife's eye-shine reads all three. These are the working
    // vectors themselves, handed out to be copied from, never written to.
    get origin() { return origin; },
    get direction() { return direction; },
    debug: () => ({
      level,
      hit: hasHit,
      distance: hitDistance,
      hitVisibility,
      displayedDistance,
      origin: origin.toArray(),
      direction: direction.toArray(),
    }),
  };
}
