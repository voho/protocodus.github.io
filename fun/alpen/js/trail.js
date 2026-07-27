/* The mark the board cuts into the snow.

   A ribbon: two vertices a sample, a sample about thirty times a second,
   stitched into a strip that follows the rider down the hill and fades out
   behind them. It is the only thing on screen that records what the rider
   *did* rather than what they are doing, and on a mountain made of one
   colour it is most of what makes a carve legible as a carve — the arc is
   still there to look at a second after it was ridden, which is the second
   in which the player finds out whether the line was any good.

   Four decisions carry the ribbon itself.

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
   the same function — and the ribbon hugs the snow without cutting into it.

   ---

   What the ribbon *is* took a second pass, and that is the rest of the file.

   It used to be one flat blue-grey laid down at a constant alpha, which is a
   decal of a track rather than a track. A carve is a trench, and a trench is
   three surfaces: a floor of cut snow, an uphill wall the light reaches, and
   a downhill wall standing in its own shadow — with the snow the edge
   displaced piled proud along both lips, because it has to go somewhere.
   All of that is painted across the strip's own width in the fragment
   shader, out of `aSide`, which the geometry already carried and the old
   shader used only to feather the edges away.

   Painting the section rather than building it was the second attempt. The
   first was four vertices a sample — outer lip, floor, floor, outer lip — so
   the berm could stand a few centimetres proud and be a real shape. Two
   things killed it, and the second is the one that matters. The ribbon is an
   unlit custom shader, so raised geometry catches no light and the lip would
   have had to be painted anyway; and four centimetres of relief seen from a
   chase camera eight metres back is not a shape, it is a line. So the relief
   is painted, the strip stays two vertices wide, and the ring, the gaps and
   the moving origin above are untouched by any of it.

   The section earns its keep on legibility, not on realism. Snow here runs
   from a warm near-white where the low sun lands to glacier blue in the
   shade, and one flat tint can only ever read against one end of that:
   darker than lit snow is invisible on shade, lighter than shade is
   invisible in the sun. A trench carries both at once — the shadowed wall is
   the darkest thing in the mark and the sunlit lip the lightest — so
   whichever snow the line happens to be lying on, one of the two is doing
   the work and the arc stays readable.

   The *character* of the mark now comes off the board as well as its width.
   A railed edge cuts: its shoulders are sharp enough to measure, its lips
   are straight, and its floor is clean. A washed-out edge scrubs: it has no
   shoulder at all, its two edges wander independently, and its floor is
   mottled. The wander is drawn per vertex on the processor and interpolated
   — `aChew` — rather than hashed in the shader. A hash wants an along-track
   coordinate, and an along-track coordinate on a ribbon this long either
   overflows the precision it is interpolated at or has to wrap, and the wrap
   is a seam that crosses the whole mark once every few seconds.

   Freshness is the last of it. Displaced snow stands proud for a few seconds
   and then slumps, so the lip highlight is at full strength for the first
   sixth of a sample's life and gone well before the mark itself has faded,
   and the shadow the berm throws into the groove goes with it. It is the one
   cue in the picture that says which end of the line was ridden last. */

import { TRAIL, SKY, RENDER } from './config.js';
import { heightAt } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* The cross-section, and the only new set of numbers in the file.

   Everything here is measured in the strip's own half-width — `aSide` runs
   from −1 at one edge to +1 at the other — so the whole shape scales with
   the mark automatically and a full wash-out gets the same section as a
   pencil-line carve, three times as wide. The stops read outwards from the
   middle of the board: floor, wall, shoulder, the crest of the berm, and the
   foot where the displaced snow runs out.

   `berm` is why the strip is drawn wider than the mark. The cut is still the
   width TRAIL.width and TRAIL.slideWidth were tuned to; the extra half is
   the ground the displaced snow is piled on, which did not exist before and
   has to be somewhere for the lip to be painted on.

   The two `soft` values are the whole difference between a cut and a scuff.
   They are the half-width of every transition in the section, and at 0.045
   the shoulder of a railed turn is a hard line you could measure while at
   0.30 there is no shoulder left at all — the mark simply thins out. `haze`
   adds to both with distance, and is not taste: a transition narrower than
   the pixel it lands in crawls as the camera moves, and the far half of the
   ribbon is exactly where that shows. */
export const TRENCH = {
  berm: 1.5,          // strip half-width as a multiple of the mark's
  wallIn: 0.32,       // where the floor gives way to the wall
  shoulder: 0.66,     // where the wall gives way to the berm — the cut edge
  crest: 0.82,        // the berm's high line
  crestHalf: 0.07,    // and how far it reaches either side of it
  foot: 0.88,         // where the displaced snow runs out into open snow

  carveSoft: 0.045,   // transition half-width of a railed edge
  skidSoft: 0.30,     // and of one that has let go entirely
  softCap: 0.40,      // past which the section has dissolved and may as well stop
  /* Extra softening per metre of depth. Calibrated rather than chosen: a
     pixel at this field of view is about a thousandth and a half of a radian
     across, so at `d` metres it covers `d × 0.0015` metres of ground, and a
     carve's strip is about half a metre from the middle to its edge — so one
     pixel is `d × 0.003` of the section, and a transition wants to be a pixel
     and a half wide before it stops crawling as the camera moves. Inside ten
     metres the mark therefore keeps very nearly the edge it was cut with, and
     by seventy it has none left at all, which is also about where the fog
     starts taking the whole thing anyway. */
  haze: 0.005,

  chew: 0.17,         // how far a skidded edge wanders off its line
  mottle: 0.45,       // and how much its floor blotches

  settle: 0.16,       // share of a sample's life the berm stands proud for
  flatBite: 0.55,     // what a board gliding flat still leaves for walls

  /* How much cross-slope tilt counts as a fully banked trench.

     `lat.y` is the height difference across the board, and because the
     lateral axis has already been projected onto the slope it is a direct
     read of how far across the fall line the rider is travelling: nothing at
     all pointed straight down the hill, and the sine of the pitch — about
     0.29 on this mountain — traversing square across it. Saturating a little
     under that means any real traverse gets a fully lit and fully shadowed
     wall, and only a straight schuss gets two neutral ones, which is exactly
     right: a line down the fall line cuts no bank to catch anything. */
  tiltFull: 0.22,

  /* What each surface contributes, before TRAIL.opacity scales the lot.

     These are calibrated against what the mark used to be rather than
     against each other: the old flat strip was laid down at exactly
     TRAIL.opacity across its whole width, so a weight of one here is that
     strip, and everything reads as heavier or lighter than the trail the
     rest of the game was tuned around. The shadowed wall is deliberately the
     heaviest thing in the mark — a groove is read from its dark side — and
     `cap` is what stops the one place the crest and the wall overlap from
     stacking into a line darker than anything else on the mountain. */
  floorWeight: 0.95,
  wallWeight: 1.05,
  shadeWeight: 0.65,
  crestWeight: 1.10,
  cap: 1.5,

  /* How far towards the shadowed colour a wall starts before the bank has
     any say. Two thirds rather than a half, and the reason is the sunlit
     half of the hill: on snow already at #fbfdff a warm lip has almost
     nothing left to add and the only thing that can carry the mark is the
     dark, so the walls have to be genuinely darker than the floor between
     them or a carve on the lit side of a roller reads as a smudge. */
  wallBase: 0.62,
};

/* Four shades of snow, and not one of them is white.

   The hill is painted between #fbfdff where the low sun lands and #c2d3ea in
   the shade, and every one of these is a step off that pair rather than a
   colour of its own — all four arrive at a fraction of TRAIL.opacity, so what
   reaches the screen is always a shift in the ground and never a paint mark
   sitting on top of it.

   `cut` is snow that has been sliced open: denser, bluer and a little darker
   than the surface it came out of. `shade` is the downhill wall, the one
   surface in the mark that is genuinely in shadow, and it is pushed as far
   down as it can go while still reading as snow — further and the trench
   becomes a crack in the hill rather than a groove in it, which was the
   original single colour's whole problem in reverse.

   `lit` is the uphill wall. It is cool rather than warm on purpose: it is
   turned towards the sky as much as towards the sun, so what it catches is
   mostly the blue of the dome.

   Neither wall starts at `cut`. Both start most of the way over towards
   `shade` — TRENCH.wallBase — and only then swing back towards `lit` or on
   down to `shade` with the bank. That was the fix for a run straight down the
   fall line, which cuts no bank at all and so came out with two walls the
   same colour as the floor between them: a flat band again, which is exactly
   what all this was for. A wall is a steep face whichever way it points, and
   it is darker than the floor before the sun has any say in it.

   `crest` is the one warm thing on the mountain that is not the sun itself,
   and it has earned it — the berm is the only surface in the mark that
   stands up out of the snow, so it is the only one the low sun actually
   lands on. It is also the reason a fresh line reads at all against a slope
   already in blue shade. */
const INK = {
  cut: '#8fa8cc',
  shade: '#5f7bab',
  lit: '#cfe0f6',
  crest: '#ffeeda',
};

/* How much sideways wash counts as a full wash-out, in m/s. The edge lets go
   somewhere around a metre a second and a hard brake at speed asks for ten,
   so this is set where the board has stopped holding any kind of line and
   the mark has become a smear rather than a cut. */
const SLIDE_FULL = 5.5;

/* And how much of it a railed turn is allowed before the mark starts to look
   scrubbed. There is always some scrub: a snowboard is not a rail and even a
   fully committed carve washes a little as the tail comes round. Without a
   dead zone every carve in the game came out with a slightly chewed edge,
   which is precisely the read the chewed edge exists to deny it.

   Only the *character* gets the dead zone. The width still comes off the raw
   slide, because that number was tuned against the raw slide and a trail
   that suddenly stopped widening under a light scrub would be a different
   change wearing this one's clothes. */
const SLIDE_HOLD = 0.9;

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

// GLSL has no integer-to-float promotion worth relying on, and the section
// above is all compile-time constants — folded into the source rather than
// carried as uniforms, because none of them changes while the game is running
// and a uniform that never moves is a uniform someone has to remember to set
const n = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const VERT = `
  attribute float aSide;
  attribute float aChew;
  attribute vec3 aCut;      // wash, cross-slope tilt, edge load
  attribute vec2 aLife;     // weight, age
  varying float vSide;
  varying float vChew;
  varying float vWash;
  varying float vTilt;
  varying float vBite;
  varying float vAlpha;
  varying float vAge;
  varying float vDepth;
  void main() {
    vSide = aSide;
    vChew = aChew;
    vWash = aCut.x;
    vTilt = aCut.y;
    vBite = aCut.z;
    vAlpha = aLife.x;
    vAge = aLife.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/* The section, one fragment at a time.

   Everything is a mask across `a`, the distance out from the middle of the
   board in half-widths, and the masks are disjoint by construction — the
   wall is what is inside the shoulder and outside the floor, so the two
   never both claim a fragment and the weighted average below cannot
   double-count one. The three surfaces are then averaged for colour and
   summed for weight, which is the whole trick that lets a shadowed wall be
   both darker *and* more opaque than the floor beside it.

   `vChew` moves the shoulder, the crest and the foot together rather than
   independently, because a real skid does not chew the edge and leave the
   pile behind it straight — the whole outside of the mark wanders as one.
   It is scaled by the wash, so a carve's edges do not move at all.

   Fog is folded in by hand at the end, exactly as the particles do it,
   because a custom shader does not get three's for free — and the trail has
   to dissolve into the same curtain the hill does or the far end of it hangs
   in the haze like a wire. The uniforms are named to match `particles.js` so
   main can drive both from the weather in one loop.

   One housekeeping note, because it cost an afternoon: the comments below are
   written in plain ASCII. A minus sign or an em dash inside a GLSL comment is
   outside the language's source character set, and a strict front end will
   refuse the whole shader over a dash in a sentence it never reads. */
const FRAG = `
  precision mediump float;
  uniform vec3 uCut;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uCrest;
  uniform vec3 uFog;
  uniform float uNear;
  uniform float uFar;
  uniform float uOpacity;
  varying float vSide;
  varying float vChew;
  varying float vWash;
  varying float vTilt;
  varying float vBite;
  varying float vAlpha;
  varying float vAge;
  varying float vDepth;
  void main() {
    if (vAlpha <= 0.002) discard;

    float a = abs(vSide);
    float wash = clamp(vWash, 0.0, 1.0);
    float rail = 1.0 - wash;

    float soft = min(mix(${n(TRENCH.skidSoft)}, ${n(TRENCH.carveSoft)}, rail)
      + vDepth * ${n(TRENCH.haze)}, ${n(TRENCH.softCap)});

    float chew = wash * vChew * ${n(TRENCH.chew)};
    float shoulder = ${n(TRENCH.shoulder)} + chew;
    float crest = ${n(TRENCH.crest)} + chew;
    float foot = min(${n(TRENCH.foot)} + chew, 0.94);

    float floorM = 1.0 - smoothstep(${n(TRENCH.wallIn)} - soft, ${n(TRENCH.wallIn)} + soft, a);
    float cutM = 1.0 - smoothstep(shoulder - soft, shoulder + soft, a);
    float wallM = max(cutM - floorM, 0.0);
    // Half the softening, because the crest is a line and not a surface: let
    // it widen with the rest of the section and it stops being a lip and
    // becomes a halo either side of the mark, which the bloom then finds
    float crestM = 1.0 - smoothstep(0.0, 1.0,
      min(abs(a - crest) / (${n(TRENCH.crestHalf)} + soft * 0.5), 1.0));
    // The mark always reaches nothing by the edge of its own strip. Without
    // this the crest's outer flank is still carrying weight where the quad
    // stops, and a band cut off at a constant value is the hard edge the
    // whole section exists to avoid
    float rim = 1.0 - smoothstep(foot, 1.0, a);

    // Which wall the light is on. vTilt is the cross-slope bank of this
    // sample and vSide which edge of the mark we are standing on, so the
    // product is +1 up the hill, -1 down it, and nothing at all on a line
    // straight down the fall line, which cuts no bank to light
    float up = clamp(vSide * vTilt, -1.0, 1.0);
    float sunward = max(up, 0.0);
    float shadeward = max(-up, 0.0);
    vec3 base = mix(uCut, uShade, ${n(TRENCH.wallBase)});
    vec3 wall = base + (uLit - base) * sunward + (uShade - base) * shadeward;

    // A trench is only as deep as the edge that dug it, and a fresh berm
    // throws a shadow into its own groove that goes when the berm slumps
    float bite = mix(${n(TRENCH.flatBite)}, 1.0, clamp(vBite, 0.0, 1.0));
    float settle = smoothstep(0.0, ${n(TRENCH.settle)}, vAge);

    float wFloor = floorM * ${n(TRENCH.floorWeight)}
      * (1.0 + wash * vChew * ${n(TRENCH.mottle)});
    float wWall = wallM * bite * (${n(TRENCH.wallWeight)}
      + shadeward * ${n(TRENCH.shadeWeight)} * (1.0 - settle * 0.5));
    float wCrest = crestM * ${n(TRENCH.crestWeight)} * rail * bite * (1.0 - settle);

    float w = wFloor + wWall + wCrest;
    if (w <= 0.002) discard;
    vec3 col = (uCut * wFloor + wall * wWall + uCrest * wCrest) / w;

    float alpha = min(w, ${n(TRENCH.cap)}) * rim * vAlpha * uOpacity;
    if (alpha <= 0.002) discard;

    float f = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, uFog, f * 0.8), alpha * (1.0 - f));
  }
`;

export function createTrail(THREE) {
  const N = TRAIL.samples;
  const verts = N * 2;

  const position = new Float32Array(verts * 3);
  const side = new Float32Array(verts);
  const chew = new Float32Array(verts);
  const cut = new Float32Array(verts * 3);    // wash, tilt, bite
  const life = new Float32Array(verts * 2);   // weight, age
  const born = new Float64Array(N);
  const opens = new Uint8Array(N);            // this sample starts a stroke
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)((N - 1) * 6);

  // Which side of the board a vertex is on never changes, so it is written
  // once here and the fragment shader gets the whole section for nothing
  for (let i = 0; i < N; i++) {
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    born[i] = -1e9;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aChew', new THREE.BufferAttribute(chew, 1));
  geo.setAttribute('aCut', new THREE.BufferAttribute(cut, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 2));
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
      uCut: { value: new THREE.Color(INK.cut) },
      uLit: { value: new THREE.Color(INK.lit) },
      uShade: { value: new THREE.Color(INK.shade) },
      uCrest: { value: new THREE.Color(INK.crest) },
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
    // sliding backwards out of a fall reverses. The section is symmetric
    // about the strip and drawn from the same varyings either way, so this
    // costs nothing and removes the case entirely.
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
  let chewL = 0;        // the two edges' wander, each a walk of its own
  let chewR = 0;
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
     the board's own contact point; the two edges of the strip are carried
     out along the lateral axis, which is tangent to the slope and so takes
     them up or down the fall line with it, and then floated to whichever is
     higher of that plane and the bare hill underneath.

     `half` is the strip's half-width and not the mark's — the caller has
     already opened it out by TRENCH.berm to leave room for the displaced
     snow — which means the two height lookups moved outwards with it. That
     is the right way round: the berm is real ground and wants to sit on the
     hill it is piled on, not on the plane the board was standing on. */
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

  /* What kind of mark this is, as opposed to where it is. Both vertices of a
     sample get the same three numbers because all three describe the board,
     not the edge of the strip; the one thing that genuinely differs across
     the width — how far each edge has wandered — is `chew`, and that is
     written per vertex when the sample is taken. */
  function shape(slot, wash, tilt, bite) {
    const p = slot * 3;
    cut[p] = wash;
    cut[p + 1] = tilt;
    cut[p + 2] = bite;
    cut[p + 3] = wash;
    cut[p + 4] = tilt;
    cut[p + 5] = bite;
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
    /* The two edges wander as walks rather than as noise. Redrawn outright
       every sample the edge came out as a zigzag at the sample rate, which
       is a saw blade and not a scuff; halving the old value in keeps each
       edge somewhere near where it was a moment ago and lets it drift, which
       is what a board pushing a pile of snow sideways actually leaves. The
       two are independent so the mark is chewed rather than merely wide. */
    chewL = chewL * 0.5 + (Math.random() * 2 - 1) * 0.5;
    chewR = chewR * 0.5 + (Math.random() * 2 - 1) * 0.5;
    chew[head * 2] = chewL;
    chew[head * 2 + 1] = chewR;
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

  /* Weight and age, in one pass and one attribute. They are two different
     clocks on the same number: the weight is what is left of the mark, and
     holds before it goes, while the age runs evenly from the moment the
     sample was cut and is what the berm settles against. Keeping them in one
     vec2 is not thrift for its own sake — it is one buffer upload a frame
     instead of two, over the only attribute in the file that has to be
     rewritten for every live sample rather than just the newest. */
  function fade() {
    if (!count) return;
    for (let k = 0; k < count; k++) {
      const slot = (head - k + N) % N;
      const age = (now - born[slot]) / TRAIL.life;
      const left = 1 - age;
      const a = left <= 0 ? 0 : left >= HOLD ? 1 : left / HOLD;
      const p = slot * 4;
      life[p] = a;
      life[p + 1] = age;
      life[p + 2] = a;
      life[p + 3] = age;
    }
    geo.attributes.aLife.needsUpdate = true;
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

      /* And the character, which is a different reading of the same three
         numbers. A fall has no edge at all — nothing is being cut, a body is
         being dragged — so it is pinned to a full scuff with no load behind
         it, which is what leaves a broad mottled smear with no shoulder and
         no berm. `tilt` is the only one of the three that is about the hill
         rather than the rider: it is what tells the shader which of the two
         walls the sky is on. */
      const scuff = down
        ? 1
        : clamp((rider.slide - SLIDE_HOLD) / (SLIDE_FULL - SLIDE_HOLD), 0, 1);
      const tilt = clamp(lat.y / TRENCH.tiltFull, -1, 1);
      const bite = down ? 0 : clamp(rider.carveLoad, 0, 1);

      write(head, pos.x, pos.y, pos.z, half * TRENCH.berm);
      shape(head, scuff, tilt, bite);
      born[head] = now;
      prevLat.copy(lat);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aCut.needsUpdate = true;
      geo.attributes.aChew.needsUpdate = true;
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
    // Weight and age go together: a zero weight is discarded before the age
    // is ever looked at, so one fill is enough for both halves
    life.fill(0);
    geo.attributes.aLife.needsUpdate = true;
    geo.setDrawRange(0, 0);
  }

  // `points` is the same object as `mesh`. It is aliased so the weather can
  // drive the fog on the trail in the same loop it drives it on the two
  // particle clouds, rather than main.js carrying a special case for the one
  // custom shader in the game that happens not to be a point cloud.
  return { mesh, points: mesh, update, clear };
}
