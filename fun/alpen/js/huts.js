/* The hut with the light on, and the only reason on this mountain to stop.

   Everything else standing on the hill is something to miss or something to
   hit, and every one of them rewards the same thing: speed. A hut rewards
   the opposite. It pays for arriving slowly, which on a slope that is
   permanently, deliberately downhill is the hardest thing the game asks for
   — and that difficulty is the whole joke. Coming to a stop beside a hut is
   a trick in exactly the sense a 540 is a trick: a thing you have to mean.

   Four decisions carry the rest of this file.

   A hut is rare. The first version placed them the way `props.js` places
   everything, a chance per forty-metre band, and the run turned into a high
   street — a thing you pass every four seconds is scenery, and scenery is
   the one thing this must not be. It is now one chance per five hundred
   metres, taken about half the time, which is a hut every twenty to forty
   seconds of riding and often a good deal longer.

   A hut finds its own shelf. It cannot be placed at a fixed distance off the
   piste, because the ground outside the corridor is a quarterpipe whose
   width varies along the run, and a building pitched across a transition
   looks like a building falling over. So the site walks outward from the
   groomed edge, sampling the hill under its own footprint, and stops at the
   first place where the ground stops falling away sideways. On this mountain
   that is reliably somewhere on the upper half of the lip, because the lip
   is a smoothstep and a smoothstep arrives flat — so the huts end up where
   real ones are: up on the bank, a few metres above the piste, looking down
   at it. Where the bank is mellow they sit close; where it is a wall they
   are pushed out into the trees. Neither was designed. Both fall out of
   asking the hill rather than telling it.

   A hut faces the rider. Square on to the piste it presents a gable to
   somebody who only ever arrives from above, so the front is aimed twenty
   metres up the run instead: the windows, the door, the terrace and the light
   they throw are all pointed at the person they are for.

   And the light is two lamps no light loop ever sees: the windows are an
   unlit material whose opacity is the night, and what the room's lamp and
   the terrace lantern throw on the snow, the timber and the rider is worked
   out in their own shaders — see `HUT_LIGHT` in config.js and
   `FRAG_HUT_LIGHT` in shading.js. Real point lights would be two more per
   hut in a scene that lights a whole mountain with two, and three's are
   shadowless: they would have lit the snow straight through the walls. The
   light used to be a painted gradient on a quad laid flat in front of the
   terrace; on the convex lip a hut stands on, its rim hovered metres off the
   snow.

   The hut itself is one baked geometry through `compose`, so all of it —
   walls, roof, chimney, woodpile, bench, terrace — is one draw call, and the
   three or four standing at once are one InstancedMesh. The roof is the part
   worth pointing at: it is a three-sided cylinder lying on its side, which
   is a complete gable, two pitches and both ends closed, out of a single
   primitive. */

import { compose } from './geom.js';
import {
  heightAt, nearestCenter, corridorHalfAt, gradeAt, pisteCenter,
} from './terrain.js';
import { hash2, stream, getWorldSeed } from './noise.js';
import { getPointSizeCap } from './particles.js';
import { RENDER, SKY, HUT_LIGHT, HARD, JUMPABLE } from './config.js';
import { sharedTexture } from './textures.js';
import { FOG_CURVE_GLSL } from './shading.js';

/* ==========================================================================
   Every number the huts lean on
   ========================================================================== */

export const HUTS = {
  /* How often the mountain is allowed one.

     A chance every five hundred metres, taken a little over half the time,
     and refused again by the ground about a third of the time after that —
     which comes out at a hut every kilometre or so, or every twenty-five
     seconds at a hundred and thirty an hour. Both numbers are about rhythm
     rather than density: the gaps where the dice go the other way are what
     make finding one feel like finding something. */
  period: 520,
  chance: 0.58,
  /* Sites tried inside a block before the mountain is allowed to refuse.
     Every one of them is drawn from the block's own index, so a stretch of
     hill that grew a hut yesterday grows the same hut in the same place
     today, and a stretch with nowhere to put one never will. */
  tries: 6,
  spread: 300,        // metres of the block a site may be drawn from

  /* How much hill carries huts at once. `ahead` is comfortably past the
     thickest fog the weather can produce — a hut should come out of the
     curtain rather than appear in clear air — and the list is rebuilt every
     `step` metres, so the window is widened by that much again to keep the
     far edge from popping between rebuilds. */
  ahead: 560,
  behind: 120,
  step: 130,
  live: 3,

  /* Finding the shelf.

     The search starts just past the groomed edge and walks out in even
     strides, and takes the first offset whose ground is level enough under
     the building's own footprint. `maxDrop` is measured *against the grade*:
     the whole mountain is tilted by a fifth of its own length, so the useful
     question is not how much the ground falls across the footprint but how
     much more than the fall line it falls. A metre and a half over a
     five-metre building is a cross slope the plinth can absorb; past that
     the site is refused and the search moves on. */
  reach: [3, 25],     // metres past the corridor edge that are worth trying
  strides: 8,
  footprint: 2.8,     // half the building, in metres
  maxDrop: 1.5,
  /* And the steepest fall line worth building on at all. The grade runs from
     7° to 26°; this refuses the top third of that, which is both where a hut
     would look absurd and where nobody wants to stop anyway. */
  maxGrade: 0.42,
  facing: 20,         // metres up the run the front is aimed at

  /* The glow.

     `night` is the dial, `storm` is allowed a share of it because a blizzard
     at noon is dark enough to want the lights on, and the gamma is under one
     so the windows come up early in the evening rather than snapping on at
     the last moment. `floor` is what the glass shows at midday: not nothing,
     because a window with no light behind it at all reads as a painted-on
     rectangle, but close. */
  glow: { storm: 0.45, gamma: 0.75, floor: 0.16, warm: '#ffbe6e' },

  /* Chimney smoke.

     A slow plume that is buoyant for the first second and then belongs to
     the wind, which is what makes the weather visible from a standstill. The
     puffs grow as they cool and rise, which is the whole of why a column of
     them reads as smoke rather than as a queue of dots. `range` keeps the
     particles for huts near enough to be seen; anything further is spending
     them into fog. */
  smoke: {
    count: 180,
    rate: 9,          // puffs per second, per hut
    life: 5.4,
    rise: 2.1,        // m/s of buoyancy at the chimney
    drag: 0.9,        // how fast a puff gives itself up to the wind
    coupling: 0.85,   // and how much of the wind it takes when it does
    jitter: 0.16,
    size: 0.5,        // metres across, at the chimney
    growth: 3.2,      // and how many times that by the end of its life
    alpha: 0.6,
    spin: 0.8,        // rad/s either way at most, as a puff rolls over
    range: 300,
    stoke: 16,        // extra puffs when somebody comes in for a cocoa
  },

  /* The cocoa stop.

     Generous about what counts as stopped and strict about only paying once.
     Thirteen metres is most of the terrace and the snow in front of it; 3.6
     m/s is a slow skate, well above the rider's own minimum-speed push, so
     the hill can be doing its best to move you along and this still counts.
     The dwell is short but it is not zero — without it a bail that happened
     to slow through the radius bought a hot chocolate. */
  cocoa: { speed: 3.6, radius: 13, dwell: 0.3 },
};

/* Where the chimney comes out, in the hut's own coordinates. The geometry
   and the smoke both read it, because a plume that starts anywhere else is
   the kind of bug nobody spots for a week. */
const CHIMNEY = { x: 1.75, y: 6.6, z: 0.9 };
// The top of the terrace deck, and how far the stone base reaches below the
// floor, both from the planting height; see the terrace and the plinth in
// `hutGeometry`.
const TERRACE_DECK = 0.55;
const PLINTH_DEPTH = 4.595;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ==========================================================================
   The building
   ========================================================================== */

/* Local coordinates: y = 0 is the highest corner of the ground the hut is
   standing on — see the planting rule below, and the plinth that pays for it
   — +y is up, and the front, meaning the door, the windows, the terrace and
   the whole of the reason to stop, faces -z. */
function hutGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const post = new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
  const log = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  const icicle = new THREE.ConeGeometry(0.5, 1, 6);
  /* Three radial segments is a triangular prism with both ends capped, and a
     triangular prism lying on its side is a gable roof. Rotated -90° about x
     it has a flat face underneath, an apex on top and its length running
     front to back, so the triangle is what a rider coming down the hill
     sees. */
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3).toNonIndexed();
  // The rest of the hut can use smooth lighting for its round timber. Keep
  // the two roof pitches architectural by baking a separate normal per face.
  prism.computeVertexNormals();
  /* The snow banked against the walls, on the ledge the plinth leaves round
     them: a four-sided frustum with no caps, because its top edge is buried
     in the timber and its foot sits on the stone, so all that ever shows is
     the slope between. Turned in its own frame, before the scale, so the
     faces come out square to the walls, and faceted like the roof. This was
     a box, wider than the plinth under it, which drew a white shelf jutting
     out over the stonework on every side. */
  const bankCone = new THREE.CylinderGeometry(0.9, 1, 1, 4, 1, true);
  bankCone.rotateY(Math.PI / 4);
  const bank = bankCone.toNonIndexed();
  bankCone.dispose();
  bank.computeVertexNormals();

  const stone = '#4a4d55';
  // The cellar storey's rubble: paler and warmer than the chimney's slate,
  // or two to four metres of it under a chalet reads as a dark pedestal
  const masonry = '#6f6c67';
  const stoneDark = '#383b43';
  const timber = '#6d4a30';
  const beam = '#4a3221';
  const dark = '#2c1e14';
  const snow = '#f4f8ff';
  const drift = '#e7effb';
  const split = '#8a6440';
  const sign = '#ffab00';

  // The roof, worked out once: half-width across, length along the ridge,
  // the height of the walls it sits on, and the rise from eave to ridge.
  const RW = 3.3;
  const RL = 5.6;
  const EAVE = 3.05;
  const RISE = 2.9;
  // A unit prism is 0.866 wide, 1.5 tall from its flat face to its apex, and
  // centred on neither, so all three scales and the height are derived.
  const rx = RW / 0.866;
  const rz = RISE / 1.5;
  const ry = EAVE + rz * 0.5;

  const parts = [
    /* --- the ground it stands on -------------------------------------------

       Four metres of stone under a floor that is only two and a half metres
       of timber, nearly all of it underground. A five-metre building on a
       seventeen-degree slope has two and a half metres of fall beneath it and
       there is no site on this mountain that does not, so the hut is planted
       at its highest corner and this carries everything below: buried on the
       uphill side, and on the downhill side exactly the stone base every real
       one of these is built on. Levelling the building against the mean
       instead — which is what this did first — buried the uphill windows to
       the sill about a third of the time. */
    { geo: box, color: masonry, pos: [0, -2.02, 0], scale: [5.5, 5.15, 4.7] },
    /* …and on the downhill side it stands two to four metres clear of the
       snow, which is a storey: the cellar every real one has, with small
       windows in the masonry on the three sides that are not dug into the
       hill. Windows, not a door: the ground under them is anywhere from two
       to four and a half metres down, and a door has to meet it. Whichever
       of them a site buries is under the snow. */
    { geo: box, color: beam, pos: [1.1, -0.8, 2.37], scale: [0.64, 0.5, 0.05] },
    { geo: box, color: dark, pos: [1.1, -0.8, 2.385], scale: [0.48, 0.34, 0.04] },
    { geo: box, color: beam, pos: [-1.3, -0.8, 2.37], scale: [0.64, 0.5, 0.05] },
    { geo: box, color: dark, pos: [-1.3, -0.8, 2.385], scale: [0.48, 0.34, 0.04] },
    { geo: box, color: beam, pos: [2.77, -0.8, 0.6], scale: [0.05, 0.5, 0.64] },
    { geo: box, color: dark, pos: [2.785, -0.8, 0.6], scale: [0.04, 0.34, 0.48] },
    { geo: box, color: beam, pos: [-2.77, -0.8, -1.5], scale: [0.05, 0.5, 0.64] },
    { geo: box, color: dark, pos: [-2.785, -0.8, -1.5], scale: [0.04, 0.34, 0.48] },
    // Its foot just past the plinth's edge, its top inside the walls
    { geo: bank, color: drift, pos: [0, 0.765, 0], scale: [2.76 * Math.SQRT2, 0.47, 2.36 * Math.SQRT2] },

    // --- walls --------------------------------------------------------------
    { geo: box, color: timber, pos: [0, 1.8, 0], scale: [5.1, 2.5, 4.3] },
    // Three courses wrapped right round the building. Proud of the walls by
    // three centimetres, which is all it takes to break a flat plane into
    // stacked timber at any distance the hut is legible from at all.
    { geo: box, color: beam, pos: [0, 1.0, 0], scale: [5.16, 0.16, 4.36] },
    { geo: box, color: beam, pos: [0, 1.8, 0], scale: [5.16, 0.16, 4.36] },
    { geo: box, color: beam, pos: [0, 2.6, 0], scale: [5.16, 0.16, 4.36] },
    { geo: post, color: beam, pos: [-2.5, 1.85, -2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [2.5, 1.85, -2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [-2.5, 1.85, 2.1], scale: [0.3, 2.6, 0.3] },
    { geo: post, color: beam, pos: [2.5, 1.85, 2.1], scale: [0.3, 2.6, 0.3] },

    // --- roof ---------------------------------------------------------------
    { geo: prism, color: dark, pos: [0, ry, 0], rot: [-Math.PI / 2, 0, 0], scale: [rx, RL, rz] },
    // and the snow lying on it: slightly narrower, slightly shorter and
    // lifted, so a strip of dark timber shows at every eave and the ridge
    // stands proud in white
    {
      geo: prism, color: snow, pos: [0, ry + 0.16, 0],
      rot: [-Math.PI / 2, 0, 0], scale: [rx * 0.955, RL * 0.97, rz * 0.97],
    },

    // --- chimney ------------------------------------------------------------
    { geo: box, color: stone, pos: [CHIMNEY.x, 4.85, CHIMNEY.z], scale: [0.65, 2.9, 0.65] },
    { geo: box, color: stoneDark, pos: [CHIMNEY.x, 6.15, CHIMNEY.z], scale: [0.75, 0.2, 0.75] },
    { geo: box, color: snow, pos: [CHIMNEY.x, 6.4, CHIMNEY.z], scale: [0.82, 0.18, 0.82] },

    // --- the front ----------------------------------------------------------
    { geo: box, color: dark, pos: [-1.3, 1.62, -2.21], scale: [0.95, 2.05, 0.14] },
    { geo: box, color: beam, pos: [-1.3, 0.58, -2.45], scale: [1.3, 0.14, 0.5] },
    // The sign over the door is the same yellow as a kicker's lip, because it
    // is the same promise: this is a thing you are meant to ride at.
    { geo: box, color: sign, pos: [-1.3, 2.86, -2.24], scale: [1.5, 0.34, 0.1] },
    // Window frames. The glass itself is a separate geometry and a separate
    // material — see `paneGeometry` — because it is the one part of the hut
    // that must not be lit by the mountain's own light.
    { geo: box, color: beam, pos: [0.35, 1.75, -2.19], scale: [1.24, 1.06, 0.12] },
    { geo: box, color: beam, pos: [1.85, 1.75, -2.19], scale: [1.24, 1.06, 0.12] },
    { geo: box, color: beam, pos: [2.59, 1.75, 0.3], scale: [0.12, 1.06, 1.24] },

    // --- terrace ------------------------------------------------------------
    // On posts, because it hangs out over ground that is falling away towards
    // the piste, which is exactly why it is the side you sit on
    { geo: box, color: timber, pos: [0, 0.43, -3.3], scale: [5.3, 0.24, 2.2] },
    // and long ones, because the ground in front of a hut on a bank is three
    // metres lower than the ground behind it. A terrace on stilts over the
    // piste is not a compromise, it is what these places look like.
    { geo: post, color: beam, pos: [-2.3, -2.0, -4.15], scale: [0.26, 4.8, 0.26] },
    { geo: post, color: beam, pos: [2.3, -2.0, -4.15], scale: [0.26, 4.8, 0.26] },
    { geo: box, color: beam, pos: [0, 1.35, -4.35], scale: [5.3, 0.12, 0.14] },
    { geo: box, color: beam, pos: [-2.4, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: beam, pos: [0, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: beam, pos: [2.4, 0.93, -4.35], scale: [0.12, 0.85, 0.12] },
    { geo: box, color: timber, pos: [1.5, 1.0, -3.0], scale: [1.7, 0.14, 0.5] },
    { geo: box, color: timber, pos: [1.5, 1.26, -3.22], scale: [1.7, 0.42, 0.12] },
    { geo: box, color: beam, pos: [0.8, 0.78, -3.0], scale: [0.14, 0.45, 0.45] },
    { geo: box, color: beam, pos: [2.2, 0.78, -3.0], scale: [0.14, 0.45, 0.45] },

    // --- firewood -----------------------------------------------------------
    // The one part of the hut that says somebody is coming back to it
    { geo: box, color: masonry, pos: [-3.15, -1.95, 0.5], scale: [1.15, 4.5, 2.2] },
    { geo: log, color: split, pos: [-3.45, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.15, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: split, pos: [-2.85, 0.42, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.3, 0.7, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: split, pos: [-3.0, 0.7, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    { geo: log, color: '#7a5636', pos: [-3.15, 0.98, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.28, 1.9, 0.28] },
    // and the snow on it, a pillow along the top log rather than a board
    { geo: log, color: snow, pos: [-3.15, 1.04, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.8, 1.96, 0.34] },
  ];
  // Open shutters, divided glass and exposed rafters give the facade scale.
  for (const x of [0.35, 1.85]) {
    parts.push(
      { geo: box, color: beam, pos: [x, 1.75, -2.32], scale: [0.045, 0.88, 0.055] },
      { geo: box, color: beam, pos: [x, 1.75, -2.32], scale: [0.99, 0.045, 0.055] },
      { geo: box, color: snow, pos: [x, 1.18, -2.33], scale: [1.29, 0.11, 0.30] },
    );
    for (const s of [-1, 1]) {
      parts.push({ geo: box, color: '#365954', pos: [x + s * 0.73, 1.75, -2.25],
        rot: [0, s * 0.14, 0], scale: [0.32, 0.94, 0.07] });
    }
  }
  parts.push(
    { geo: box, color: beam, pos: [2.73, 1.75, 0.3], scale: [0.055, 0.88, 0.045] },
    { geo: box, color: beam, pos: [2.73, 1.75, 0.3], scale: [0.055, 0.045, 0.99] },
    { geo: box, color: '#bda877', pos: [-0.96, 1.56, -2.31], scale: [0.05, 0.16, 0.07] },
  );
  /* Icicles grow where meltwater leaves the roof, and that is the eaves —
     the two level edges the snow slides down to — not the sloping verge of
     the gable, where they used to hang in a row stepping up the rake like a
     fringe on a lampshade. Seven along each eave, off the rafter ends, with
     the lengths scattered so no two neighbours match. */
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const z = -RL * 0.44 + i * (RL * 0.88 / 6);
      const length = 0.16 + 0.26 * (0.5 + 0.5 * Math.sin(i * 4.7 + side * 1.3));
      parts.push({ geo: icicle, color: '#dcebf1',
        pos: [side * (RW - 0.07), EAVE - 0.02 - length * 0.5, z],
        rot: [0, 0, Math.PI], scale: [0.075, length, 0.075] });
    }
  }
  /* …and the snow on the roof ends in a rounded lip at each eave. The snow
     prism alone finishes in a knife edge along the eave, which no snow load
     has ever done: a metre of it on a roof creeps over the edge and rolls
     into a cornice. One cylinder along each eave, sunk into the slab and
     bulging past it, is that roll. */
  for (const side of [-1, 1]) {
    parts.push({ geo: log, color: snow,
      pos: [side * (RW * 0.955 - 0.03), EAVE + 0.16, 0],
      rot: [Math.PI / 2, 0, 0], scale: [0.34, RL * 0.965, 0.28] });
  }
  for (let i = 0; i < 5; i++) {
    const z = -2.2 + i * 1.1;
    for (const s of [-1, 1]) {
      parts.push({ geo: box, color: beam, pos: [s * 2.82, 3.07, z],
        scale: [1.0, 0.15, 0.17] });
    }
  }
  // Terrace slats and a pair of skis waiting by the door are baked into the
  // existing instanced shell, with no extra draw calls or runtime objects.
  for (let i = 0; i < 7; i++) {
    parts.push({ geo: box, color: beam, pos: [-2.0 + i * 0.65, 0.92, -4.35],
      scale: [0.065, 0.74, 0.07] });
  }
  for (const x of [-2.27, -2.02]) {
    parts.push({ geo: box, color: '#a84931', pos: [x, 1.42, -2.56],
      rot: [-0.13, 0, 0.16], scale: [0.13, 1.82, 0.06] });
  }
  const geometry = compose(THREE, parts);
  for (const g of [box, post, log, prism, icicle, bank]) g.dispose();
  return geometry;
}

/* The glass, alone.

   Separate from the hut for one reason: `MeshLambertMaterial` is lit by the
   mountain's light, and at night the mountain's light is a moon. A window is
   supposed to be the brightest thing on the hill at exactly the moment the
   hill is darkest, so the panes are an unlit material and the vertex colours
   here are only the difference between one room and another — a hut where
   every window is the same temperature is a hut nobody lives in. */
function paneGeometry(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Built from the light's own table, so the glass is where the light leaves
  const { front, side, glass, lantern } = HUT_LIGHT;
  const tints = ['#fff3da', '#ffdfab', '#ffe9bd'];
  return compose(THREE, [
    ...glass.front.map((p, i) => ({
      geo: box, color: tints[i],
      pos: [p.at[0], p.at[1], front - (p.proud || 0)], scale: [p.size[0], p.size[1], 0.1],
    })),
    ...glass.side.map((p) => ({
      geo: box, color: '#ffdba0',
      pos: [side, p.at[1], p.at[0]], scale: [0.1, p.size[1], p.size[0]],
    })),
    // and the lantern on the terrace rail, which is the bit you see first
    { geo: box, color: '#ffd28a', pos: lantern.at, scale: [0.22, 0.3, 0.22] },
  ]);
}

/* ==========================================================================
   Smoke

   The same shape of point cloud as everything in `particles.js`: a size and
   an alpha per particle, one small ShaderMaterial, and the fog folded in by
   hand because a custom shader does not inherit three's. The difference is
   the puff itself. A snowflake is a round point; a puff of woodsmoke is not
   round at all, and a column of soft discs read as a string of beads at any
   distance the hut is legible from. So each puff is one of four cloudy
   shapes, turned to its own angle and turning slowly as it rises.
   ========================================================================== */

/* The four shapes, in a 2 × 2 atlas: each a dozen small soft lobes
   scattered off the centre, the way a puff billows, with their sum taken
   through a saturating curve so the overlaps fill out instead of burning
   to a hot spot. Gone by the cell's inscribed circle, so a puff turned to
   any angle never reads its neighbour. A shape covers about 0.18 of its
   square where the old disc covered 0.39, which `smoke.alpha` makes up.
   Built once, as data, from a fixed stream. */
function puffAtlas(THREE) {
  const N = 64;
  const data = new Uint8Array(4 * N * N);
  const rnd = stream(9127);
  for (let k = 0; k < 4; k++) {
    const lobes = [];
    for (let j = 0; j < 12; j++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.28;
      lobes.push([Math.cos(a) * r, Math.sin(a) * r, 0.06 + rnd() * 0.07, 0.4 + rnd() * 0.6]);
    }
    const ox = (k % 2) * N;
    const oy = (k >> 1) * N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N - 0.5;
        const v = (y + 0.5) / N - 0.5;
        let d = 0;
        for (const [cx, cy, w, h] of lobes) {
          d += h * Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / (w * w));
        }
        const edge = Math.max(0, 1 - (u * u + v * v) / 0.25);
        data[(oy + y) * 2 * N + ox + x] = Math.round((1 - Math.exp(-2.5 * d)) * edge * edge * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, 2 * N, 2 * N, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const SMOKE_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aTurn;
  attribute float aShape;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vView;
  varying vec2 vTurn;
  varying vec2 vCell;
  uniform float uScale;
  uniform float uMaxSize;
  void main() {
    vAlpha = aAlpha;
    vTurn = vec2(cos(aTurn), sin(aTurn));
    vCell = vec2(mod(aShape, 2.0), floor(aShape * 0.5)) * 0.5;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    // Normalised here, in the vertex shader's highp, because the raw view
    // vector squares past what a true-mediump fragment unit can hold. A point
    // sprite's varyings are flat across the sprite anyway, so nothing is lost.
    vView = normalize(mv.xyz);
    // Our own ceiling rather than the hardware's: the GL point-size clamp
    // varies by driver and a puff drifting past the lens used to grow smoothly
    // and then snap flat against it. Capped by uniform, it just stops growing.
    gl_PointSize = min(uMaxSize, max(1.0, aSize * uScale / max(0.001, vDepth)));
    gl_Position = projectionMatrix * mv;
  }
`;

/* The colour picks up the weather's glow when the fragment is looking towards
   a low sun — woodsmoke is a fine aerosol and forward-scatters hard, so a
   plume between the rider and a sunset goes amber while the same plume seen
   down-sun stays ash. `uSunV` and `uGlow` are the shared shading's own uniform
   records, handed over by reference, and `uWarm` is the one number computed
   here: how low and how present the sun is this frame. A puff is roughly a
   ball, so its sprite also takes a ball's normal and a wrapped light from
   the same key the ground uses, faintly: a lit side and a shaded side, the
   thing that makes a plume look like it has a volume. */
const SMOKE_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uFog;
  uniform vec3 uGlow;
  uniform vec3 uSunV;
  uniform float uSunLevel;
  uniform float uWarm;
  uniform float uNear;
  uniform float uFar;
  uniform float uSnowFresh;
  uniform sampler2D uPuff;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vView;
  varying vec2 vTurn;
  varying vec2 vCell;
  ${FOG_CURVE_GLSL}
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25 || vAlpha <= 0.001) discard;
    vec2 t = vec2(vTurn.x * d.x - vTurn.y * d.y, vTurn.y * d.x + vTurn.x * d.y);
    float a = vAlpha * texture2D(uPuff, vCell + (t + 0.5) * 0.5).r;
    float fwd = max(0.0, dot(vView, uSunV));
    vec3 c = mix(uColor, uGlow, fwd * fwd * uWarm);
    vec2 dn = d * 2.0;
    vec3 ball = vec3(dn.x, -dn.y, sqrt(max(0.0, 1.0 - dot(dn, dn))));
    c *= 1.0 + dot(ball, uSunV) * 0.22 * min(uSunLevel, 1.3);
    float f = n64FogCurve(vDepth, uNear, uFar, n64ClearAir(uSnowFresh));
    gl_FragColor = vec4(mix(c, uFog, f * 0.85), a * (1.0 - f));
  }
`;

/* ==========================================================================
   Sites
   ========================================================================== */

/* How level the hill is under a building planted here, and how far the
   highest corner of it stands above the middle.

   The first is measured against the grade rather than against flat — the
   mountain is tilted everywhere, and a hut is not on a slope for being on a
   mountain — and it is what decides whether this is a site at all. The
   second is measured raw, because it is what the building is planted at:
   the ground under a hut here falls two and a half metres from corner to
   corner and it has to be the *top* corner, or the uphill wall is buried to
   the windowsill. Both come out of the same four samples. */
const probe = { drop: 0, rise: 0, base: 0 };

function shelf(x, z, grade) {
  const f = HUTS.footprint;
  const h0 = heightAt(x, z);
  let lo = 0;
  let hi = 0;
  let crest = 0;
  /* The four corners, walked so that BOTH samples at one z come before
     both at the other. `heightAt` rebuilds its row context whenever z
     changes, and the old order alternated z on every sample — four row
     builds for four corners, where two will do. The set of corners is
     identical and the loop only takes minima and maxima over it, so the
     result is unchanged to the bit. */
  for (let i = 0; i < 4; i++) {
    const dz = i < 2 ? -f : f;
    const dx = i % 2 === 0 ? -f : f;
    const d = heightAt(x + dx, z + dz) - h0;
    if (d > crest) crest = d;
    const r = d - grade * dz;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  probe.drop = hi - lo;
  probe.rise = crest;
  // The centre sample, kept so the caller planting the hut does not pay
  // for the same lookup — and the same row rebuild — a second time.
  probe.base = h0;
}

/* One block of hill, one hut or none. Everything here is a pure function of
   the block index, so the same stretch of mountain always grows the same
   hut in the same place — and a block the mountain refused stays refused. */
/* THE SITE SEARCH, ASKED ONCE PER BLOCK.

   `siteAt` is documented as a pure function of the block index, and it
   is — every draw in it comes off that index's own stream. But the window
   it is asked over slides only 130 m of a 520 m block per rebuild, so
   three quarters of the blocks searched had already been answered,
   identically, on the previous rebuild. Each miss costs up to six tries
   of an eight-stride walk, and every stride is a `shelf` of five terrain
   samples.

   Memoising is safe for the same reason the prop bands' snapshot cache is:
   the world seed is set once per page and a new mountain is a page reload,
   so a block's answer cannot change inside a session. The cache lives out
   here rather than on the instance because the props ask as well (see
   `onHutGround`), and so it is keyed on the seed, the way terrain.js keys
   its rows. A live hut is built from a COPY — `emit` and `dwell` are
   advanced every frame on it, and the cached record has to stay the
   pristine one a fresh search would have produced. */
const siteCache = new Map();
let siteSeed = NaN;

function siteAt(b) {
  const seed = getWorldSeed();
  if (seed !== siteSeed) {
    siteCache.clear();
    siteSeed = seed;
  }
  if (!siteCache.has(b)) siteCache.set(b, searchSite(b));
  return siteCache.get(b);
}

function searchSite(b) {
  if (b < 1) return null;    // the first half-kilometre is left to itself
  if (hash2(b, 4441, 71) > HUTS.chance) return null;

  const rnd = stream(b * 2654435761 + 7717);
  const top = -(b * HUTS.period) - (HUTS.period - HUTS.spread) * rnd();

  for (let k = 0; k < HUTS.tries; k++) {
    const z = top - rnd() * HUTS.spread;
    const grade = gradeAt(z);
    if (grade > HUTS.maxGrade) continue;

    const side = rnd() < 0.5 ? -1 : 1;
    /* Probed far out to one side, because after the fork there are two
       centre lines and `nearestCenter` has to be asked which one this hut
       is standing beside. Asking about the hut's own x would answer with
       whichever branch it drifted nearest to, which is how the first
       version put a hut in the middle of an island. */
    const branch = nearestCenter(pisteCenter(z) + side * 400, z);
    const edge = corridorHalfAt(z);

    // Walk outward until the ground stops falling away sideways
    const [near, far] = HUTS.reach;
    for (let i = 0; i < HUTS.strides; i++) {
      const off = edge + near + ((far - near) * i) / (HUTS.strides - 1);
      const x = branch + side * off;
      shelf(x, z, grade);
      if (probe.drop > HUTS.maxDrop) continue;

      // Aimed up the run rather than across it: a rider only ever arrives
      // from above, and the windows should be pointed at them
      const ax = nearestCenter(branch, z + HUTS.facing) - x;
      const az = HUTS.facing;
      const len = Math.hypot(ax, az) || 1;
      const yaw = Math.atan2(-ax / len, -az / len);

      // Planted at its highest corner, with a hand's breadth over for the
      // true corners the four axis-aligned samples cannot see
      let y = probe.base + probe.rise + 0.15;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      /* The terrace runs four metres on up the hill from the front wall,
         onto ground the shelf never sampled, and about a site in four had
         snow standing over the front of its deck, the rail and boards cut
         off by the slope. So the hut rises until the deck clears it by a
         hand, and a site where that would lift the stone base to within
         forty centimetres of the bottom of its lowest corner is refused:
         a building on a plinth that stops short of the snow is floating. */
      const at = (lx, lz) => heightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
      const front = Math.max(at(-2.65, -4.4), at(0, -4.4), at(2.65, -4.4));
      y = Math.max(y, front + 0.1 - TERRACE_DECK);
      const low = Math.min(at(-2.75, -2.35), at(2.75, -2.35), at(-2.75, 2.35), at(2.75, 2.35));
      if (y - PLINTH_DEPTH > low - 0.4) continue;
      return {
        key: b,
        x, y, z, yaw,
        // The chimney, carried through the same rotation the building took
        cx: x + CHIMNEY.x * cos + CHIMNEY.z * sin,
        cy: y + CHIMNEY.y,
        cz: z - CHIMNEY.x * sin + CHIMNEY.z * cos,
        off,
        emit: hash2(b, 13, 3),
        dwell: 0,
      };
    }
  }
  return null;
}

/* The ground a hut stands on, for anything else that would grow there: the
   building under its roof, the woodpile and the terrace, in the hut's own
   frame, and three metres round all of it, which keeps an ordinary spruce's
   crown off the eaves. Without it the props grew straight through about
   half the huts on a run: a spruce out of a roof, a boulder through a
   terrace, a sapling standing in the parlour. */
const GROUND = { x: -0.2, z: -0.8, hw: 3.5 + 3, hd: 3.6 + 3 };

export function onHutGround(x, z) {
  const b = Math.floor(-z / HUTS.period);
  for (let k = b - 1; k <= b + 1; k++) {
    const h = siteAt(k);
    // Its ground's far corner is under ten metres out
    if (!h || Math.abs(z - h.z) > 12) continue;
    const ux = x - h.x;
    const uz = z - h.z;
    const cos = Math.cos(h.yaw);
    const sin = Math.sin(h.yaw);
    if (Math.abs(ux * cos - uz * sin - GROUND.x) < GROUND.hw
      && Math.abs(ux * sin + uz * cos - GROUND.z) < GROUND.hd) return true;
  }
  return false;
}

/* ==========================================================================
   The huts
   ========================================================================== */

export function createHuts(THREE, shading) {
  const group = new THREE.Group();
  const S = HUTS.smoke;

  const neutralWoodTex = new THREE.DataTexture(
    new Uint8Array([200, 180, 160, 255]), 1, 1, THREE.RGBAFormat,
  );
  neutralWoodTex.needsUpdate = true;
  /* Both plates are photographs, so they are sRGB and say so. Read as
     linear — which was the default they were loaded under — a photograph
     comes out with a gamma curve baked into its contrast: mid-tones twice
     as bright as they are, grain and shadow crushed towards one flat grey.
     The gains in the shader below are what put the mean back where the
     old decode had it, so only the contrast changes.

     Both are also worn elsewhere — the planks by the props, the slate by
     the boulders and the gondola — so both come through the shared cache,
     which applies those settings and decodes each file once for the whole
     mountain (see textures.js). The uniforms still hold the neutral texel
     until the photograph has actually arrived. */
  const woodPlanksTex = { value: neutralWoodTex };
  sharedTexture(THREE,
    new URL('../assets/textures/huts/alpine-wood-planks.jpg', import.meta.url).href,
    (t) => { woodPlanksTex.value = t; });
  const stoneTex = { value: neutralWoodTex };
  sharedTexture(THREE,
    new URL('../assets/textures/rock/rock-slate.jpg', import.meta.url).href,
    (t) => { stoneTex.value = t; });

  const hutMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
  hutMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uWoodPlanksTex: woodPlanksTex,
      uStoneTex: stoneTex,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
      varying vec3 vHutLocalPos;
      varying vec3 vHutLocalNormal;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      vHutLocalPos = transformed;
      vHutLocalNormal = normalize(normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vHutLocalPos;
      varying vec3 vHutLocalNormal;
      uniform sampler2D uWoodPlanksTex;
      uniform sampler2D uStoneTex;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float hutLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      vec3 nAbs = abs(vHutLocalNormal);
      
      // 1. Pristine snow on roof, chimney cap, and woodpile: keep bright and clean
      if (hutLum > 0.70) {
        // Leave snow pure and sparkling with GGX sheen
      }
      /* 2. Masonry stone chimney and foundation plinth (grey hues)

         Grey is a RATIO, and this used to test it as a difference. The
         vertex colours arrive in linear light, where every dark colour is
         a few hundredths in every channel — so the dark beams (#4a3221 is
         0.068 / 0.032 / 0.015), the roof and door (#2c1e14) and the green
         shutters (#365954) all passed "channels within 0.08 of each other"
         and were papered in slate at a gain of nearly six, while the
         timber a shade lighter got its grain. Chroma measured against the
         brightest channel is what hue actually is: the two stone greys sit
         at 0.25 and 0.29, the darkest wood at 0.72, the shutters at 0.63.
         The floor keeps a colour so dark that its chroma is noise from
         being called stone by accident. */
      else if (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) > 0.03
        && (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))
          - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)))
          < 0.35 * max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))
        && diffuseColor.r < 0.55) {
        vec3 stoneColor = (
          texture2D(uStoneTex, vHutLocalPos.yz * 0.45).rgb * nAbs.x +
          texture2D(uStoneTex, vHutLocalPos.xz * 0.45).rgb * nAbs.y +
          texture2D(uStoneTex, vHutLocalPos.xy * 0.45).rgb * nAbs.z
        ) / max(0.001, nAbs.x + nAbs.y + nAbs.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stoneColor * 5.9, 0.75);
      }
      // 3. Wooden walls, logs, timber frame, and terrace
      else {
        // Horizontal wood grain along the walls
        vec2 woodUv = nAbs.x > 0.5 ? vHutLocalPos.zy * 0.40 : (nAbs.z > 0.5 ? vHutLocalPos.xy * 0.40 : vHutLocalPos.xz * 0.40);
        vec3 woodSample = texture2D(uWoodPlanksTex, woodUv).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * woodSample * 5.2, 0.70);
      }`);
  };

  // `sheen: 1` because the roof is carrying half a metre of the same snow the
  // ground is made of, and a roof that refuses the low sun the hill is
  // catching is what gives a model village away. The mask keeps the timber,
  // stone and beams matte — every one of them sits well under its lower stop.
  const shell = new THREE.InstancedMesh(
    hutGeometry(THREE),
    shading.apply(hutMat, { sheen: 1, hutLight: true }),
    HUTS.live,
  );

  // The panes take the snap and the fog and refuse the bands: an unlit
  // material has no diffuse term to step, and the whole reason the glass is
  // unlit is that a window is meant to be the brightest thing on the hill at
  // the moment the hill is darkest. They do want the fog, though — a lit
  // window a quarter of a mile off through falling snow is a smudge, and a
  // window that stays sharp out there is the thing that gives the distance
  // away.
  const paneMat = shading.apply(new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: HUTS.glow.floor,
  }), { bands: 0 });
  const panes = new THREE.InstancedMesh(paneGeometry(THREE), paneMat, HUTS.live);
  // The shell already casts the window openings' silhouette. Sending the
  // transparent, self-lit glass through a depth-only shadow material would
  // turn every pane back into an opaque square.
  panes.userData.noShadow = true;

  for (const mesh of [shell, panes]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    group.add(mesh);
  }

  // --- smoke ---------------------------------------------------------------
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(S.count * 3);
  const sSize = new Float32Array(S.count);
  const sAlpha = new Float32Array(S.count);
  const sVel = new Float32Array(S.count * 3);
  const sBase = new Float32Array(S.count);
  const sLife = new Float32Array(S.count);
  const sMax = new Float32Array(S.count);
  const sTurn = new Float32Array(S.count);
  const sSpin = new Float32Array(S.count);
  const sShape = new Float32Array(S.count);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1));
  smokeGeo.setAttribute('aTurn', new THREE.BufferAttribute(sTurn, 1));
  smokeGeo.setAttribute('aShape', new THREE.BufferAttribute(sShape, 1));
  smokeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const smokeMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#cfd2d6') },
      uFog: { value: new THREE.Color(SKY.haze) },
      // The shared shading's own records, not copies: the view-space sun and
      // the sky glow arrive here already moved by its one write per frame.
      uSunV: shading.uniforms.uSunView,
      uSunLevel: shading.uniforms.uSunLevel,
      uGlow: shading.uniforms.uSkyGlow,
      uWarm: { value: 0 },
      uPuff: { value: puffAtlas(THREE) },
      uNear: { value: RENDER.fogNear },
      uFar: { value: RENDER.fogFar },
      uSnowFresh: shading.uniforms.uSnowFresh,
      uScale: { value: 300 },
      uMaxSize: { value: 120 },
    },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  group.add(smoke);
  let head = 0;
  // How many puffs are currently alive. The ring buffer never shrinks, so
  // without this the step walked and re-uploaded 180 particles every frame of
  // every run for ever, including the runs that never came within three
  // hundred metres of a chimney.
  let live = 0;

  // --- scratch -------------------------------------------------------------
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const warm = new THREE.Color(HUTS.glow.warm);
  // The shared shading's own records; see FRAG_HUT_LIGHT
  const lampAt = shading.uniforms.uHutAt.value;
  const lampAxis = shading.uniforms.uHutAxis.value;
  const lampWarm = shading.uniforms.uHutWarm.value;
  const lampColour = new THREE.Color(HUT_LIGHT.colour);
  const tint = new THREE.Color();
  const smokeDay = new THREE.Color('#cfd2d6');
  const smokeNight = new THREE.Color('#f0e6d6');

  const huts = [];
  const claimed = new Set();
  let block = NaN;

  /* ==========================================================================
     Placement
     ========================================================================== */

  /* THE HUT AS THE RIDER MEETS IT. It had no collider at all: a rider who
     missed the stop went straight through the walls and out of the back.
     Three boxes in the hut's own frame (metres, x across, z towards the
     front, which is negative): the building on its plinth, the woodpile at
     one end and the terrace. Boxes, not the circles every prop is, because
     a hut can stand three metres off the groomed edge and circles large
     enough to fill its walls bulge a metre past them, an invisible wall
     right where a rider carves by. One contact for all three, so a hut is
     one hit however many of them a line crosses. The building stands to its
     chimney; the woodpile and the terrace rail can be cleared. The cocoa
     radius is far outside all of it, so the stop is untouched. */
  const HUT_BOXES = [
    { x: 0, z: 0, hw: 2.75, hd: 2.35, kind: HARD, top: 6.5 },
    { x: -3.15, z: 0.5, hw: 0.58, hd: 1.1, kind: JUMPABLE, top: 1.25 },
    { x: 0, z: -3.3, hw: 2.65, hd: 1.1, kind: JUMPABLE, top: 1.5 },
  ];
  const solids = [];

  function writeSolids() {
    solids.length = 0;
    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      const cos = Math.cos(h.yaw);
      const sin = Math.sin(h.yaw);
      const contact = { hit: false };
      for (const b of HUT_BOXES) {
        solids.push({
          type: 'hut', x: h.x + b.x * cos + b.z * sin, z: h.z - b.x * sin + b.z * cos,
          // `r` is the circle round the box, which is all the broad passes
          // read; the sweep itself reads the box
          r: Math.hypot(b.hw, b.hd), hw: b.hw, hd: b.hd, cos, sin,
          kind: b.kind, top: h.y + b.top, cameraPad: 0.55, volume: true, contact,
        });
      }
    }
  }

  function writeInstances() {
    writeSolids();
    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      e.set(0, h.yaw, 0);
      q.setFromEuler(e);
      v.set(h.x, h.y, h.z);
      s3.set(1, 1, 1);
      m.compose(v, q, s3);
      shell.setMatrixAt(i, m);
      panes.setMatrixAt(i, m);
    }
    // The lamps go where the buildings went, and an empty slot is dark
    for (let i = 0; i < lampAt.length; i++) {
      const h = huts[i];
      if (h) {
        lampAt[i].set(h.x, h.y, h.z, 1);
        lampAxis[i].set(Math.cos(h.yaw), Math.sin(h.yaw));
      } else {
        lampAt[i].w = 0;
      }
    }
    shell.count = huts.length;
    panes.count = huts.length;
    shell.instanceMatrix.needsUpdate = true;
    panes.instanceMatrix.needsUpdate = true;
  }

  function rebuild(riderZ) {
    huts.length = 0;
    const first = Math.floor(-(riderZ + HUTS.behind) / HUTS.period);
    const last = Math.floor(-(riderZ - HUTS.ahead - HUTS.step) / HUTS.period);
    // Bounded by the window it serves, with a block of slack either side so
    // riding back and forth over one boundary does not re-search.
    if (siteCache.size > 24) {
      for (const key of siteCache.keys()) {
        if (key < first - 1 || key > last + 1) siteCache.delete(key);
      }
    }
    for (let b = Math.max(1, first); b <= last && huts.length < HUTS.live; b++) {
      const site = siteAt(b);
      if (site) huts.push({ ...site });
    }
    writeInstances();
  }

  /* ==========================================================================
     Smoke
     ========================================================================== */

  function puff(h) {
    const i = head;
    head = (head + 1) % S.count;
    // Recycling a slot that is still burning does not change the census
    if (sLife[i] <= 0) live += 1;
    const j = i * 3;
    sPos[j] = h.cx + (Math.random() - 0.5) * S.jitter;
    sPos[j + 1] = h.cy + Math.random() * 0.1;
    sPos[j + 2] = h.cz + (Math.random() - 0.5) * S.jitter;
    sVel[j] = (Math.random() - 0.5) * 0.4;
    sVel[j + 1] = S.rise * (0.7 + Math.random() * 0.6);
    sVel[j + 2] = (Math.random() - 0.5) * 0.4;
    sMax[i] = S.life * (0.7 + Math.random() * 0.6);
    sLife[i] = sMax[i];
    sBase[i] = S.size * (0.7 + Math.random() * 0.7);
    sTurn[i] = Math.random() * Math.PI * 2;
    sSpin[i] = (Math.random() - 0.5) * S.spin;
    sShape[i] = Math.floor(Math.random() * 4);
  }

  function stepSmoke(dt, windX, windZ) {
    /* The whole system sleeps once the last puff has died. Emission happens
       before this in `update`, so a hut coming into range wakes it on the same
       frame its first puff exists — and the frame the last one dies is the
       frame that uploads its zeroed alpha, so nothing stale is left showing
       when this early-out starts firing. */
    if (live === 0) return;
    const k = 1 - Math.exp(-S.drag * dt);
    for (let i = 0; i < S.count; i++) {
      if (sLife[i] <= 0) {
        if (sAlpha[i] !== 0) sAlpha[i] = 0;
        continue;
      }
      const j = i * 3;
      sLife[i] -= dt;
      if (sLife[i] <= 0) {
        sAlpha[i] = 0;
        live -= 1;
        continue;
      }
      const u = clamp(1 - sLife[i] / sMax[i], 0, 1);
      // Buoyant while it is still hot, and the wind's after that
      sVel[j] += (windX * S.coupling - sVel[j]) * k;
      sVel[j + 1] += (S.rise * (1 - u) - sVel[j + 1]) * k;
      sVel[j + 2] += (windZ * S.coupling - sVel[j + 2]) * k;
      sPos[j] += sVel[j] * dt;
      sPos[j + 1] += sVel[j + 1] * dt;
      sPos[j + 2] += sVel[j + 2] * dt;
      // Puffs grow as they cool, which is the whole of why a column of them
      // reads as smoke rather than as a queue of dots
      sSize[i] = sBase[i] * (1 + u * S.growth);
      sTurn[i] += sSpin[i] * dt;
      const fade = (1 - u) * (1 - u);
      sAlpha[i] = S.alpha * Math.min(1, u * 6) * fade;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    smokeGeo.attributes.aSize.needsUpdate = true;
    smokeGeo.attributes.aAlpha.needsUpdate = true;
    smokeGeo.attributes.aTurn.needsUpdate = true;
    smokeGeo.attributes.aShape.needsUpdate = true;
  }

  /* ==========================================================================
     The frame
     ========================================================================== */

  /* `onCocoa(x, z)` fires exactly once per hut, the first time the rider is
     stopped beside it, and never again for that hut however many times the
     run passes back through — the claim is kept against the block index, not
     against the instance, so unloading the hut and rebuilding it does not
     hand out a second cocoa. */
  function update(dt, rider, weather, onCocoa) {
    // main.js holds the weather module under one name and its state under
    // another; either is accepted, because getting it wrong is a hut with no
    // light in it and nothing to say why
    const w = weather && weather.state ? weather.state : weather;

    const bi = Math.floor(rider.pos.z / HUTS.step);
    if (bi !== block) {
      block = bi;
      rebuild(rider.pos.z);
    }

    // --- how dark is it out -------------------------------------------------
    const dark = clamp(w.night + w.storm * HUTS.glow.storm, 0, 1);
    const lit = Math.pow(dark, HUTS.glow.gamma);

    // Glass takes the sky's colour by day — it is a mirror until there is
    // something behind it — and the fire's by night
    tint.copy(w.haze).lerp(warm, lit);
    paneMat.color.copy(tint);
    paneMat.opacity = HUTS.glow.floor + (1 - HUTS.glow.floor) * lit;
    // The lamps come on with the glass they shine through
    lampWarm.copy(lampColour).multiplyScalar(lit);

    smokeMat.uniforms.uColor.value.copy(smokeDay).lerp(smokeNight, lit);
    smokeMat.uniforms.uFog.value.copy(w.haze);
    smokeMat.uniforms.uNear.value = w.fogNear;
    smokeMat.uniforms.uFar.value = w.fogFar;
    /* Point size is in metres and has to become pixels, which needs the
       camera's field of view — and this module is handed the rider and the
       weather and nothing else. So it is computed from the nominal FOV and
       the live framebuffer. The error is real and bounded: at full speed the
       frame opens to 86° and the puffs are drawn about half again too large,
       which is the one moment in the run nobody is looking at a chimney. */
    smokeMat.uniforms.uScale.value = RENDER.buffer.height
      / (2 * Math.tan((RENDER.fov * Math.PI) / 360));
    // A third of the frame is as big as a puff is ever allowed to draw — see
    // the note beside gl_PointSize in the vertex shader. The share must
    // still lose to the driver's own point-size limit: on a tall buffer a
    // third of the frame can exceed it, and a point past the limit is not
    // scaled down but cropped to a square window out of the puff's middle.
    smokeMat.uniforms.uMaxSize.value = Math.min(
      RENDER.buffer.height * 0.34, getPointSizeCap(),
    );
    /* How much of the weather's glow the smoke may borrow. The first clamp is
       "the sun is low", gone by fifteen degrees up; the second is "the sun has
       not left", gone shortly under the horizon; and the night and storm terms
       are the same dimmers everything else on the hill is already under. At
       noon and at midnight this is zero and the mix in the shader is inert. */
    const sinE = Math.sin(w.elevation);
    smokeMat.uniforms.uWarm.value = 0.6
      * clamp(1 - sinE * 4, 0, 1)
      * clamp(sinE * 8 + 1, 0, 1)
      * (1 - lit) * (1 - w.storm * 0.8);

    // --- per hut ------------------------------------------------------------
    const stopped = rider.speed < HUTS.cocoa.speed
      && rider.grounded && rider.state !== 'fall' && rider.state !== 'rise';
    const r2 = HUTS.cocoa.radius * HUTS.cocoa.radius;

    for (let i = 0; i < huts.length; i++) {
      const h = huts[i];
      const dx = rider.pos.x - h.x;
      const dz = rider.pos.z - h.z;
      const d2 = dx * dx + dz * dz;

      // Smoke, for the huts near enough for it to be seen
      if (d2 < S.range * S.range) {
        h.emit += dt * S.rate;
        let n = 0;
        while (h.emit >= 1 && n < 4) {
          h.emit -= 1;
          puff(h);
          n += 1;
        }
        if (h.emit >= 1) h.emit = 0;
      }

      // The cocoa. Generous about stopping — the hill is doing its best to
      // stop you stopping — and paid exactly once.
      if (claimed.has(h.key)) continue;
      const near = d2 < r2;
      if (near && stopped) {
        h.dwell += dt;
        if (h.dwell >= HUTS.cocoa.dwell) {
          claimed.add(h.key);
          // Somebody has come in, so the fire gets stoked
          for (let p = 0; p < S.stoke; p++) puff(h);
          if (onCocoa) onCocoa(h.x, h.z);
        }
      } else if (near) {
        // Wobbling about outside the door still counts; leaving does not
        h.dwell = Math.max(0, h.dwell - dt * 2);
      } else {
        h.dwell = 0;
      }
    }

    stepSmoke(dt, w.windX, w.windZ);
  }

  function reset() {
    claimed.clear();
    block = NaN;
    live = 0;
    for (let i = 0; i < S.count; i++) {
      sLife[i] = 0;
      sAlpha[i] = 0;
    }
    smokeGeo.attributes.aAlpha.needsUpdate = true;
  }

  // The huts themselves are on the returned object, the way the animals are:
  // it is the whole debugger, and it is also the only way anything else could
  // ever be told where a building is standing.
  return { group, update, reset, huts, smoke, solids };
}
