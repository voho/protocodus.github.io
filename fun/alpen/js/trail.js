/* The mark the board cuts into the snow.

   A ribbon: two vertices a sample, a sample about thirty times a second,
   stitched into a strip that follows the rider down the hill and fades out
   behind them. It is the only thing on screen that records what the rider
   *did* rather than what they are doing, and on a mountain made of one
   colour it is most of what makes a carve legible as a carve — the arc is
   still there to look at a second after it was ridden, which is the second
   in which the player finds out whether the line was any good.

   Four decisions carry the file.

   The geometry is allocated once and never again. A ring of TRAIL.samples
   samples, two vertices each, and an index buffer that is restitched — not
   rebuilt, not reallocated — whenever the ribbon's topology actually changes,
   which is when a sample is committed, when the oldest one expires, and when
   a stroke breaks. Everything else in the run is endless, so this is the one
   place where a fixed budget has to be enough, and fourteen seconds of
   ribbon is what four hundred and twenty samples buys at speed.

   The index is where the gaps live. Two segments must never be drawn: the
   one that wraps from the newest sample round to the oldest, which would
   drag a ribbon straight back up the mountain, and the one that spans a
   jump. Emitting nothing while airborne is not enough on its own — the
   sample before the lip and the sample after the landing are still adjacent
   in the ring, and joined they draw a perfectly straight line through the
   air where the trick was. So a sample that opens a stroke is flagged, and a
   flagged sample is never stitched back to whatever came before it.

   The newest sample is alive. It is not laid down and left; it is dragged
   along with the board every frame until the next one falls due, and only
   then does it freeze. Committing on the sample clock alone leaves the
   ribbon ending up to a board's length behind the board at a hundred and
   fifty kilometres an hour, and that gap opens and closes at the sample
   rate, which reads as the trail flickering off the tail of the board.

   And the ribbon sits on the ground by taking its plane from the surface the
   rider is standing on, then rising wherever the bare hill is higher than
   that plane. Neither half works alone: placed purely on `heightAt` the
   ribbon is buried inside every kicker it crosses, because a kicker is not
   in `heightAt` at all; placed purely on the rider's tangent plane it dives
   into the side of any mogul taken at an angle. Taking the higher of the two
   at each of the two vertices costs two height lookups a sample — sixty a
   second, against the better part of a thousand the rider already spends on
   the same function — and the ribbon hugs the snow without cutting into it. */

import { TRAIL, SKY, RENDER } from './config.js';
import { heightAt } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* A cool shadow-blue, and emphatically not black. The hill is painted
   between #fbfdff lit and #c2d3ea dim, so the mark is that dim end pushed a
   little further down and no further: snow that has been cut is still snow,
   and a dark line on a white field reads as a crack rather than a groove.
   The whole thing is laid down at TRAIL.opacity, so what actually reaches
   the screen is a shade of the ground, not a colour of its own. */
const COLOUR = '#95acce';

/* How much sideways wash counts as a full wash-out, in m/s. The edge lets go
   somewhere around a metre a second and a hard brake at speed asks for ten,
   so this is set where the board has stopped holding any kind of line and
   the mark has become a smear rather than a cut. */
const SLIDE_FULL = 5.5;

/* The share of a sample's life it keeps its full weight for. A mark that
   starts fading the instant it is cut reads as smoke coming off the board;
   a groove in snow is a groove until something fills it in, so the alpha
   holds and then goes in the last few seconds. */
const HOLD = 0.55;

/* Metres the ribbon's origin is allowed to drift before everything is
   rebased onto a new one.

   The run reaches z = −20000 and, on a grade of about a third, y = −6000
   with it. Handed to the GPU raw, a coordinate that size lands on a float32
   lattice about two millimetres wide, which is a twentieth of the height the
   whole ribbon is floating at — so the trail would start to sparkle against
   the hill exactly where the run gets interesting. The mesh therefore sits
   at an anchor and stores its vertices relative to it, the same trick the
   terrain uses for the same reason, and rebasing is a single pass of adds
   over a buffer of eight hundred and forty vertices every hundred and
   twenty-eight metres. The stride is a power of two so the delta between two
   anchors is exact in both float64 and float32 and the rebase cannot itself
   introduce the drift it exists to prevent. */
const ANCHOR_STRIDE = 128;

const VERT = `
  attribute float aAlpha;
  attribute float aSide;
  varying float vAlpha;
  varying float vSide;
  varying float vDepth;
  void main() {
    vAlpha = aAlpha;
    vSide = aSide;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/* Fog folded in by hand, exactly as the particles do it, because a custom
   shader does not get three's for free — and the trail has to dissolve into
   the same curtain the hill does or the far end of it hangs in the haze like
   a wire. The uniforms are named to match `particles.js` so main can drive
   both from the weather in one loop. */
const FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSide;
  varying float vDepth;
  void main() {
    if (vAlpha <= 0.002) discard;
    // Soft along its own width. A hard-edged band two metres across does not
    // read as snow pushed aside, it reads as tape, and the soft edge is also
    // what hides the fact that the ribbon is four hundred flat quads.
    float edge = 1.0 - smoothstep(0.5, 1.0, abs(vSide));
    float a = vAlpha * uOpacity * edge;
    if (a <= 0.002) discard;
    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColor, uFog, f * 0.8), a * (1.0 - f));
  }
`;

export function createTrail(THREE) {
  const N = TRAIL.samples;
  const verts = N * 2;

  const position = new Float32Array(verts * 3);
  const alpha = new Float32Array(verts);
  const side = new Float32Array(verts);
  const born = new Float64Array(N);
  const opens = new Uint8Array(N);      // this sample starts a stroke
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)((N - 1) * 6);

  // Which side of the board a vertex is on never changes, so it is written
  // once here and the fragment shader gets its soft edge for nothing
  for (let i = 0; i < N; i++) {
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    born[i] = -1e9;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  /* Three things keep it off the hill's own surface, and it needs all three.
     TRAIL.lift is metres, and answers the mesh: the terrain is drawn as flat
     facets a metre and a half apart, so the ground the eye sees can sit a
     couple of centimetres above the ground `heightAt` reports. polygonOffset
     is depth units, and answers the depth buffer, which cannot separate two
     surfaces this close at four hundred metres however carefully they were
     placed. And depthWrite is off so that the ribbon, which is transparent
     and overlaps itself on every hard turn, cannot occlude its own tail. */
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(COLOUR) },
      uFog: { value: new THREE.Color(SKY.haze) },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uOpacity: { value: TRAIL.opacity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    // The strip's winding follows the direction of travel, which a rider
    // sliding backwards out of a fall reverses. Both faces are the same
    // flat colour, so this costs nothing and removes the case entirely.
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  // Ahead of the spray and the snowfall. The trail is the one transparent
  // thing in the game that is lying on the ground rather than floating over
  // it, and sorting it by the distance to its own centre — which is an
  // anchor a hundred metres away — gets that wrong about half the time.
  mesh.renderOrder = -1;

  const lat = new THREE.Vector3(1, 0, 0);
  const prevLat = new THREE.Vector3(1, 0, 0);
  const fwd = new THREE.Vector3();

  let now = 0;
  let head = -1;        // the live sample: rewritten every frame until it freezes
  let count = 0;
  let open = false;     // a stroke is being laid down right now
  let dirty = false;    // the topology changed, so the index needs restitching
  let wobble = 1;       // per-sample randomness, drawn once when a sample is taken
  let lastT = 0;
  let lastX = 0;
  let lastZ = 0;
  let anchorX = 0;
  let anchorY = 0;
  let anchorZ = 0;

  /* --- the moving origin ------------------------------------------------ */

  function rebase(x, y, z) {
    const ax = Math.round(x / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    const ay = Math.round(y / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    const az = Math.round(z / ANCHOR_STRIDE) * ANCHOR_STRIDE;
    if (ax === anchorX && ay === anchorY && az === anchorZ) return;
    const dx = anchorX - ax;
    const dy = anchorY - ay;
    const dz = anchorZ - az;
    // The samples already on the buffer are shifted rather than recomputed:
    // where they were is the whole point of them, and nothing outside this
    // function ever needs to know which origin they are measured from
    for (let p = 0; p < position.length; p += 3) {
      position[p] += dx;
      position[p + 1] += dy;
      position[p + 2] += dz;
    }
    anchorX = ax;
    anchorY = ay;
    anchorZ = az;
    mesh.position.set(ax, ay, az);
    geo.attributes.position.needsUpdate = true;
  }

  /* --- the ring --------------------------------------------------------- */

  /* Both vertices of one sample, in the anchor's frame. `y` is the height of
     the board's own contact point; the two edges of the ribbon are carried
     out along the lateral axis, which is tangent to the slope and so takes
     them up or down the fall line with it, and then floated to whichever is
     higher of that plane and the bare hill underneath. */
  function write(slot, x, y, z, half) {
    const ox = lat.x * half;
    const oy = lat.y * half;
    const oz = lat.z * half;
    const lx = x - ox;
    const lz = z - oz;
    const rx = x + ox;
    const rz = z + oz;
    const ly = Math.max(y - oy, heightAt(lx, lz)) + TRAIL.lift;
    const ry = Math.max(y + oy, heightAt(rx, rz)) + TRAIL.lift;
    const p = slot * 6;
    position[p] = lx - anchorX;
    position[p + 1] = ly - anchorY;
    position[p + 2] = lz - anchorZ;
    position[p + 3] = rx - anchorX;
    position[p + 4] = ry - anchorY;
    position[p + 5] = rz - anchorZ;
  }

  function take(x, z, starting) {
    head = head < 0 ? 0 : (head + 1) % N;
    if (count < N) count += 1;
    opens[head] = starting ? 1 : 0;
    born[head] = now;
    // Drawn once per sample rather than once per frame: the live sample is
    // rewritten every frame, and a width rerolled every frame is a ribbon
    // that boils rather than a body dragging through snow
    wobble = 0.9 + Math.random() * 0.4;
    lastT = now;
    lastX = x;
    lastZ = z;
    dirty = true;
  }

  /* Everything past its life is dropped from the tail. Faded samples draw
     nothing — the shader discards them — but they are still four hundred
     quads being rasterised to prove it, and a rider who stops for a minute
     should not be paying for a ribbon that is no longer there. */
  function prune() {
    while (count > 0) {
      const tail = (head - count + 1 + N) % N;
      if (now - born[tail] < TRAIL.life) break;
      count -= 1;
      dirty = true;
    }
  }

  /* The index, written oldest to newest, skipping every segment that should
     not exist. What comes out is a packed run of quads, so the draw range is
     simply how many were written and the ring's wrap never appears. */
  function stitch() {
    let t = 0;
    for (let k = 1; k < count; k++) {
      const cur = (head - count + 1 + k + N) % N;
      if (opens[cur]) continue;
      const prev = (cur + N - 1) % N;
      const a = prev * 2;
      const b = cur * 2;
      index[t++] = a; index[t++] = a + 1; index[t++] = b;
      index[t++] = a + 1; index[t++] = b + 1; index[t++] = b;
    }
    geo.index.needsUpdate = true;
    geo.setDrawRange(0, t);
  }

  function fade() {
    if (!count) return;
    for (let k = 0; k < count; k++) {
      const slot = (head - k + N) % N;
      const left = 1 - (now - born[slot]) / TRAIL.life;
      const a = left <= 0 ? 0 : left >= HOLD ? 1 : left / HOLD;
      alpha[slot * 2] = a;
      alpha[slot * 2 + 1] = a;
    }
    geo.attributes.aAlpha.needsUpdate = true;
  }

  /* --- per frame -------------------------------------------------------- */

  function update(rider, dt) {
    now += dt;

    /* Nothing is laid down in the air. A rider crossing a jump has to leave
       a gap and land into a fresh stroke, because a line that runs straight
       through the trick says they never left the ground. A fall is the
       opposite case and is emitted deliberately: a body sliding down a hill
       leaves a great deal more mark than a board does. */
    if (!rider.grounded) {
      open = false;
    } else {
      const pos = rider.pos;
      const down = rider.state === 'fall' || rider.state === 'rise';
      rebase(pos.x, pos.y, pos.z);

      /* The lateral axis. Normally the board's own `right`, which the ground
         step has already projected onto the slope. During a fall it cannot
         be: `right` is only written while the rider is riding, so it is a
         stale memory of whichever way the board was pointing at the moment
         they went down, and the smear would be laid across a direction the
         rider stopped travelling in a second ago. So the fall takes its axis
         from where the body is actually going instead. */
      if (down) {
        fwd.copy(rider.vel).addScaledVector(rider.normal, -rider.vel.dot(rider.normal));
        if (fwd.lengthSq() > 0.25) lat.copy(fwd).normalize().cross(rider.normal).normalize();
        else lat.copy(rider.right);
      } else {
        lat.copy(rider.right);
      }
      if (lat.lengthSq() < 0.5) lat.set(1, 0, 0);
      // A landing switch snaps the yaw through half a turn and a fall can
      // reverse the direction of travel outright, either of which flips the
      // axis and ties the ribbon into a bowtie at that one segment. The axis
      // never turns more than a couple of degrees between two frames on its
      // own, so anything pointing backwards against the last one is a flip
      // rather than a turn, and is simply flipped back.
      if (open && lat.dot(prevLat) < 0) lat.negate();

      const dx = pos.x - lastX;
      const dz = pos.z - lastZ;
      if (!open) {
        open = true;
        take(pos.x, pos.z, true);
      } else if (now - lastT >= 1 / TRAIL.rate
        && dx * dx + dz * dz >= TRAIL.minStep * TRAIL.minStep) {
        // The live sample freezes where it was last written and a new one
        // opens at the board. Gating on distance as well as on time is what
        // stops a rider sitting still from quietly eating the whole ring.
        take(pos.x, pos.z, false);
      }

      /* Width is the whole reason for drawing this at all. A railed carve
         is a pencil line — the board is up on an edge and the snow is cut
         rather than pushed — and a broken edge drags everything it has
         across the fall line. So the slide does almost all of the work and
         the edge load only widens the clean line slightly, which is the
         difference between a board gliding flat and one standing on its
         edge hard enough to be leaving a trench.

         A fall is allowed a little past the far end of that range and is
         jittered around it, because a body is wider than a board and does
         not hold a line long enough for two consecutive marks to match. */
      const wash = clamp(rider.slide / SLIDE_FULL, 0, 1);
      const half = down
        ? TRAIL.slideWidth * wobble
        : TRAIL.width + (TRAIL.slideWidth - TRAIL.width)
          * clamp(wash + rider.carveLoad * 0.12, 0, 1);

      write(head, pos.x, pos.y, pos.z, half);
      born[head] = now;
      prevLat.copy(lat);
      geo.attributes.position.needsUpdate = true;
    }

    prune();
    if (dirty) {
      stitch();
      dirty = false;
    }
    fade();
  }

  /* A restart moves the rider somewhere else entirely, and a ribbon that
     survived it would draw one segment from the old run to the new one. */
  function clear() {
    head = -1;
    count = 0;
    open = false;
    dirty = false;
    for (let i = 0; i < N; i++) born[i] = -1e9;
    alpha.fill(0);
    geo.attributes.aAlpha.needsUpdate = true;
    geo.setDrawRange(0, 0);
  }

  // `points` is the same object as `mesh`. It is aliased so the weather can
  // drive the fog on the trail in the same loop it drives it on the two
  // particle clouds, rather than main.js carrying a special case for the one
  // custom shader in the game that happens not to be a point cloud.
  return { mesh, points: mesh, update, clear };
}
