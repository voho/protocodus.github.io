/* Alpen — every number the game leans on, in one place.

   Two rules kept this file honest. Distances are metres, times are seconds
   and forces are m/s², so a value can be sanity-checked against the real
   sport before it is tuned against the feel of the game. And gravity is
   the only place the arcade is admitted openly: at 22 m/s² a rider falls
   a little over twice as fast as physics allows, which is what lets a jump
   be tall enough to spin under and short enough to keep the run moving.
   Everything downstream — ramp heights, spin rates, the camera's rise — is
   tuned against that number, so it is the one to move last.

   The rider is simulated as a velocity vector on the slope, not as a speed
   along a heading, so momentum is real: gravity is resolved on the surface
   tangent, the edge holds sideways up to a grip limit and slides past it,
   and a turn taken too fast at the top of the hill costs the speed it was
   carrying. Nothing here clamps the rider's speed — drag does.

   That last claim used to be half true. Three numbers quietly propped the
   rider up — a floor speed that pushed, a tuck that pushed, and an edge
   that barely bled — so climbing never actually cost anything and the hill
   read as flat however it was shaped. All three are now conditional on the
   ground going the way the push claims it is. */

/* Safe construction sizes for render targets before the first resize. The
   live picture is native-resolution and immediately replaces these. */
export const BASE_WIDTH = 640;
export const BASE_HEIGHT = 360;

export const RENDER = {
  /* The window at its own resolution. The retro language now comes from
     geometry, colour quantisation and dither rather than a coarse framebuffer.
     Device pixels are capped at 2 and total pixels at 4K because denser panels
     ask for much more work without revealing more low-poly geometry. */
  maxPixelRatio: 2,
  maxPixels: 3840 * 2160,
  /* Resolution scale, tuned at runtime against the frame clock. The renderer
     starts optimistic and walks down; it never walks past `minScale`, and it
     only walks back up after the frame time has been comfortable for a
     while, so a single slow frame cannot start it oscillating. */
  minScale: 0.55,
  maxScale: 1.0,
  /* Live world-target size, written by `retro.setSize`. Point sprites size
     themselves in metres and need the actual target height. */
  buffer: { width: BASE_WIDTH, height: BASE_HEIGHT },

  fov: 65,
  fovAtSpeed: 54,     // speed closes peripheral vision into a focused tunnel
  near: 0.5,
  far: 3600,
  /* The draw distance is a curtain of haze, and everything is arranged
     around where it falls: the hill is generated well past it, the peaks
     are painted to melt into it at their base, and the plane that fills in
     behind the hill is exactly its colour, so the seam cannot be seen.

     Both numbers moved out with the resolution. At 288 lines a ridge at
     three hundred metres was four pixels tall and pushing the curtain back
     bought nothing but fill rate; at native resolution it is a ridge. */
  fogNear: 105,
  fogFar: 420,
};

/* The grade, applied in the same pass as the dither. Snow is the hardest
   thing to light well: it is one colour, it fills the screen, and left alone
   it reads as a blank page. So the shadows are pushed towards the sky's blue
   and the highlights towards the sun's amber, which is what the eye expects
   of snow at a low sun and what makes the hill legible at all. */
export const GRADE = {
  shadowTint: '#6f97d8',
  /* The highlight tint had to come most of the way back to white.

     At #fff0d2 it was pushing every lit surface a sixth of the way towards
     amber, and since the brightest thing in the frame is a snowfield filling
     most of it, what that actually graded was the whole picture: the snow
     came out cream, the haze came out cream, and the deep blue the sky had
     just been given was sitting above a beige mountain. Snow in sun is very
     slightly warm and overwhelmingly white; the blue in the shadows is what
     it is supposed to be read against, and that stop is doing the work. */
  highlightTint: '#fff8ec',
  // Both tints are normalised to luminance 1 before use, so strength moves
  // hue and never brightness. A grade that dims the picture is a bug.
  tintStrength: 0.42,
  /* Contrast and saturation, both pushed. Every photograph of this sport is
     a near-black sky over a surface at the very top of the scale with a
     single violently coloured human being in the middle of it, and none of
     that survives a picture graded to be tasteful. The sky stops carry most
     of it now; this is what stops the snow from meeting them halfway. */
  contrast: 1.16,
  saturation: 1.24,
  // Enough to close the corners, not enough to notice. Anything past about
  // 0.2 turns a wide screen into a porthole.
  vignette: 0.12,
  speedVignette: 0.46,
  aberration: 0.0075,
  /* Levels per channel in the final quantise. 32 is five bits — the depth an
     RGBA5551 framebuffer carried, and the reason those machines dithered at
     all. It went to 256 for a while, when the buffer was running at native
     resolution and the dither had nothing left to hide; at five bits it is
     load-bearing again, because a snowfield across 32 levels without one is
     a contour map and with one it is grain. */
  levels: 32,

  /* The modern half, all of it applied before the quantise so that it is
     squeezed into five bits along with everything else and can never look
     like a filter sitting on top of an old picture.

     `shoulder` is where the highlight roll-off starts, in linear light.
     Everything under it is untouched; above it the range is compressed
     asymptotically towards one. Snow under any real key light runs straight
     off the top of the scale, and a clipped channel has no shape left in it —
     which on a surface filling most of the frame means the hill stops having
     folds and becomes a sheet of paper. */
  shoulder: 0.72,
  /* Bloom, from a quarter-resolution bright pass. Small: this is a five-bit
     picture and a wide soft glow across it quantises into visible rings. */
  bloom: 0.25,
  bloomThreshold: 0.78,
  /* Crepuscular rays, marched from every pixel towards the sun's position on
     screen through that same bright buffer. `density` is how far along that
     line the sixteen steps reach and `decay` is how fast each one gives up —
     together they set whether this reads as light through a ridge or as a
     smear. It is the one effect here no machine of the era could have
     attempted, and the one that most makes a low sun look like weather. */
  rays: 0.55,
  rayDecay: 0.94,
  rayDensity: 0.62,

  /* Velocity blur. Six taps along the vector towards the centre of the
     frame, so the corners streak and the middle — where the rider is, and
     where the next thing to hit is — stays readable.

     `blurAmount` wants to be much smaller than it looks, because the taps
     are spaced along that vector and the last one at the frame's corner
     travels five times this. At 0.022 it reached five and a half per cent of
     the screen, which is not a suggestion of speed, it is a smear across
     everything including the rider. */
  blurFrom: 24,       // m/s before tunnel vision starts to become visible
  blurFull: 48,
  blurAmount: 0.012,
};

/* The only sky colour anything outside `weather.js` needs: the haze the
   world dissolves into, used as the starting value for the fog and for the
   particle shaders before the first weather tick lands. */
export const SKY = {
  haze: '#dfe7f2',
};

export const TERRAIN = {
  /* The hill's pitch, which is now a function of how far down it you are.

     A constant grade is a ramp, and a ramp has one idea in it. This is two
     sines over a base, so the run has chapters: a pitch that stands up and
     asks for a real carve, a runout that gives the speed back slowly, and
     the transitions between them where the ground quietly stops falling
     away and the rider has to work for the first time in a kilometre.

     It stays a closed form because `heightAt` has to. The height is the
     integral of this, done analytically in `terrain.js` — sampling a varying
     grade would mean marching from the top of the mountain every time the
     rider asked how high the ground was, five times per physics step. Both
     amplitudes are held well under the base so the sum never reaches zero:
     the hill is allowed to get lazy and is never allowed to point back up. */
  grade: {
    base: 0.30,       // 16.7° — the low end of a real red run
    waves: [
      { freq: 0.00085, amp: 0.050, phase: 0 },      // ~7.4 km, the big chapters
      { freq: 0.00310, amp: 0.030, phase: 2.1 },    // ~2.0 km, pitches inside them
    ],
  },
  /* Range: 0.30 ± 0.115, so 10.5° at its most generous and 22.5° at its
     steepest — and the shallow end of that is the number every other term on
     this mountain has to be budgeted against. See `SLOPE BUDGET` below.

     Both amplitudes came down by a third when that budget was worked out.
     They were ±0.177, which put the gentlest chapters at 6.9°, and 6.9° is
     shallower than the rolling ground's own faces — so those stretches
     genuinely pointed uphill in places and a rider who arrived slowly simply
     stopped on them, which is not a difficulty curve, it is a bug. */

  /* The piste is not a chute. Its centre line wanders on two long sines, so
     the run arrives somewhere rather than pointing at the same spot forever,
     and a bend gives the rider a reason to carve that the terrain alone
     never would. Both amplitudes are small against their wavelengths: the
     route drifts about seven metres sideways every hundred it descends. */
  wander: [
    { freq: 0.0040, amp: 16 },
    { freq: 0.0013, amp: 34 },
    { freq: 0.00047, amp: 52 },   // the long one: whole shoulders of mountain
  ],

  /* Where the run splits in two.

     Every `period` metres the mountain gets the chance to open a fork, and
     when it takes one the single centre line becomes two, drifting apart to
     `split` either side over the first third of the window, holding, and
     closing again. The corridor is measured to the *nearer* of the two, so
     what happens on the ground is exactly what happens on a real mountain:
     the piste widens, an island of trees rises out of the middle of it, the
     two lines run either side of the island, and they rejoin below.

     `split` has to beat the corridor's half-width for an island to exist at
     all — below that the two corridors simply overlap and the run is briefly
     twice as wide, which is a perfectly good thing for it to be and is what
     the opening and closing of every fork looks like from inside. */
  route: {
    period: 520,
    chance: 0.80,
    span: 300,        // metres the fork stays open
    split: 72,        // half-separation at full opening
    /* And the two branches do not have to be at the same height.

       A fork where both ways are level is a choice with no content — the
       lines are mirror images and it does not matter which you take. Give one
       of them ten metres of elevation over the other and it becomes a real
       decision: the high line is slower to reach and pays it back as speed
       down the far side, the low line is quicker now and arrives flat. The
       offset is blended by inverse-square proximity to each branch rather
       than switched at the midpoint, so the island between them sits at the
       mean and there is no seam anywhere on the hill. */
    drop: 11,
  },

  /* The groomed part, measured from whichever centre line is nearer. It
     breathes on a long sine: gullies where it draws in, bowls where it opens
     out, and the fork windows on top of that. This is the number the whole
     run is scaled against, and it is roughly three times what it was. */
  /* The groomed part, and the shallow bowl across it.

     A flat corridor between two walls is a corridor. A corridor with a metre
     and a half of dish in it is a fall line — it gathers a drifting rider
     back towards the middle without ever pushing them, and it is the reason
     the run reads as a route rather than a lane. It also costs nothing
     against the slope budget: the dish rises across the hill, not down it,
     and lateral gradients are free because no part of them lies on the
     direction the rider is descending. */
  corridor: { half: 40, vary: 16, freq: 0.00118, bowl: 1.5 },

  /* Outside the corridor: a transition, a lip, and then a wall that cannot
     be climbed.

     The old profile — w²·e^(1−w²) — peaked and then decayed, which meant a
     rider who committed enough speed could crest the ridge and ride off into
     open mountain. That is no longer allowed to happen, and it is not
     prevented with an invisible barrier: past the lip the ground simply
     keeps rising, asymptotically towards `height` metres above the piste. It
     takes 2·g·h of kinetic energy to climb that, which at 22 m/s² and 130
     metres is 75 m/s — half again the fastest the game can be ridden. The
     wall is not a rule, it is a mountain, and the rock the colouring pass
     puts on anything that steep is the sign that says so.

     Below the wall is the part you are meant to use. `lipHeight` over
     `lipWidth` is a quarterpipe: concave where it leaves the piste, and
     rolled flat at the top, so a rider who rides up it fast finds a genuine
     convex lip to launch from rather than a bank that just hands the speed
     back. Both numbers are modulated along the run, so some stretches are
     mellow banks and some are walls worth aiming at. */
  wall: {
    lipWidth: 22,
    lipHeight: 7.5,
    lipVary: 0.55,    // share of both that the section noise is allowed to move
    lipFreq: 0.0017,
    /* A valley rather than a canyon.

       At 130 metres over a 55-metre scale the containment read exactly like
       what it was — two white walls standing right beside the piste, which
       is the "narrow passage" complaint however wide the groomed part in
       between actually is. Sixty-two metres over seventy-eight is a third of
       the height spread over half again the distance, so the sides lie back
       into something that looks like a bowl.

       It contains just as absolutely, and the arithmetic is worth keeping
       here: at the game's terminal speed of 50 m/s a rider carries
       v²/2g = 57 metres of climb, which is less than the 62 the exponential
       saturates at — and `creep` then goes on rising for ever behind it, so
       there is no height at which the ground stops pointing home. */
    height: 62,
    scale: 78,
    /* And past the wall's own saturation, a slow permanent climb.

       Without it the profile flattens into a plateau a hundred and thirty
       metres above the piste, and a rider thrown up there by a cliff would
       simply land on it and stop, off the run and out of the game. A gentle
       17° that never ends means the ground outside the corridor is
       monotonically uphill everywhere, so gravity is always pointing home.
       That, and not a barrier, is what makes leaving the track impossible. */
    creep: 0.30,
  },

  /* Four octaves of value noise, two of them warped.

     Warping is what turned the moguls from a grid of identical pimples into
     something with shape: the coordinates the two middle octaves are sampled
     at are themselves pushed around by a long, slow noise, so a bulge is
     stretched here and pinched there and no two stretches of hill have the
     same lumps in them. It costs two noise lookups and it is the difference
     between a texture and a terrain.

     Each amplitude is held under the grade divided by that octave's own
     gradient, so no roller is ever steep enough to point the hill back
     uphill for long. `bulgeVary` then modulates the two warped octaves along
     the run, which gives the mountain smooth stretches and lumpy ones. */
  /* SLOPE BUDGET — the constraint the whole mountain is built against.

     Two requirements pull in opposite directions here, and getting the
     balance wrong is felt immediately in the hands rather than seen.

     What launches a rider is curvature, and curvature is amplitude times
     wavenumber *squared* — so airtime has to come from short wavelengths and
     never from tall hills. Make the rolls bigger and you get a mountain that
     heaves without ever throwing anybody.

     And the ceiling: a roll's uphill face must never out-climb the mountain
     it sits on. Every octave's steepest face is about 3·amp/wavelength for
     value noise, and the sum of those has to stay under the *shallowest*
     grade the run ever reaches — not the average, the shallowest — or the
     gentle chapters contain real uphill and a rider who arrives without much
     speed grinds to a stop in the middle of a descent.

     That budget is 0.22 — the grade's base of 0.30 minus its full swing of
     0.08 — and every rising thing on the mountain is spent out of it:

       ridges  λ 312 m  amp 3.5   →  0.034
       rolls   λ 111 m  amp 1.6   →  0.043
       moguls  λ  20 m  amp 0.22  →  0.033
       chatter λ 6.3 m  amp 0.04  →  0.019
       knolls  (see below)        →  0.089
                                     ─────
                                      0.218

     The octaves alone used to spend 0.317, which is nearly twice the whole
     budget and half again the shallowest grade the run reaches. Lateral
     terms would be free — they do not sit on the fall line — but these are
     isotropic noise, so they are not. */
  ridges: { freq: 0.0032, amp: 3.5, seed: 5 },
  rolls: { freq: 0.009, amp: 1.6, seed: 1 },
  moguls: { freq: 0.050, amp: 0.22, seed: 2 },
  chatter: { freq: 0.160, amp: 0.04, seed: 3 },
  warp: { freq: 0.0042, amp: 26, seed: 8 },
  /* How lumpy a broad patch is, from independent slow 2D fields for rolls and
     moguls. The floor came down a long way: at 0.35 the quietest ground still
     carried a third of the rolling, so nowhere on the mountain was actually
     smooth. At 0.12 there are genuinely glassy lines beside rough ones to
     survive, without full-width bands repeating across the piste. */
  bulgeVary: { freq: 0.00105, seed: 12, floor: 0.12 },

  /* Knolls: the mountain's own kickers.

     Built ramps are a games idea. A real hill launches you off things it
     grew, and it does it with an infinite variety of shapes, so most of the
     jumping on this mountain should come from the mountain. These are
     discrete rises — hashed per block, never on a grid — with their own
     radius, height and eccentricity, and crucially with a lee side that is
     steeper than the side you climb.

     That asymmetry is the whole feature. A symmetrical dome is a roller: you
     go up it, you come down it, and the ground never leaves you. Squash the
     downhill half by `lee` and the crest becomes a genuine convex rollover
     that falls away faster than gravity can follow — which is precisely what
     the rider's launch test is looking for. Nothing special-cases them. They
     are simply hills shaped like something worth hitting, and how far you go
     off one is entirely a question of how fast you arrived. */
  knolls: {
    period: 78,
    chance: 0.62,
    radius: [7, 21],
    /* Height is not a number, it is a ratio of the radius — and that one
       change is what makes a knoll launch rather than stall.

       Height was 1.6 to 5.2 metres regardless of how wide the knoll was, so
       a five-metre rise on a seven-metre radius had an uphill face at a
       slope of 1.1, which is four times the whole mountain's grade. Riding
       into one was riding into a wall: the climb scrub took the speed, the
       stall rule took the rider, and the thing built to throw them into the
       air put them on their back instead.

       Tied to the radius, the uphill face is the same modest angle whatever
       size the knoll is — the peak slope of a squared dome is 1.539·h/r, so
       this range spends 0.054 to 0.089 of the slope budget and never points
       genuinely uphill. And it costs nothing in air, because height was
       never what launched anybody: curvature is, curvature goes as h/r², and
       the compressed lee side multiplies it by 1/lee² — six-fold or more.
       Which is why the *small* knolls throw hardest, and why a rider doing
       25 m/s gets thrown off one that a rider doing 15 simply rolls over. */
    rise: [0.035, 0.058],
    lee: [0.34, 0.62],   // how much the downhill half is compressed
    eccentric: 0.55,     // how far the across-radius may differ from the along
    spread: 0.85,        // share of the corridor half-width they may sit within
  },

  /* Drops.

     Every `period` metres the hill gets a chance to fall away all at once:
     three to four metres of z over which it loses `drop` metres of height,
     which is steep enough that the rider's own launch test sees the ground
     leave and puts them in the air. They are never full width — the across
     window is a good deal narrower than the corridor and has generous
     shoulders — so there is always a way round one, and the ground below is
     ordinary hill, so there is always somewhere to land. */
  cliffs: {
    period: 260,
    chance: 0.55,
    drop: [3.5, 9.0],
    fall: 3.6,        // metres of z the drop happens over
    /* …and the distance over which the hill climbs back to where the grade
       says it should have been. A drop written as a step would offset every
       metre of mountain below it, and a hundred of them would put the run a
       kilometre under its own grade. Written as a dip that recovers, a cliff
       is a local event: a steep face, then a long mellow runout that is still
       descending because the base grade is steeper than the recovery. */
    runout: 70,
    halfWidth: 16,    // and how much of the run it spans
    shoulder: 9,      // metres the edge of it blends over
  },

  /* The mesh that carries all of it.

     A uniform grid cannot win here. Fine enough to carve moguls out of, it
     needs a quarter of a million vertices to reach the horizon; coarse
     enough to reach the horizon, and the ground under the board is a pair
     of triangles. So the first forty-two metres are a fixed metre-and-a-half
     lattice and only then do the rings widen, until the far edge is most of
     a kilometre out at fifty metres a cell.

     The spacing came down and the reach went up when the resolution did.
     Sixteen thousand vertices is nothing on a machine drawing millions of
     fragments a frame, and at native resolution the two-metre facets that
     used to be a quarter of a pixel across are the shape of the hill.

     The anchor still snaps to the finest spacing, so the cells nearest the
     rider land on the same lattice every time and the facets stay welded to
     the hill. The graded far ones morph continuously between sampling
     lattices, behind fog that hides the remaining LOD movement. */
  spacing: 1.5,
  uniformNear: 42,    // stable world lattice around the board
  back: 30,           // metres of hill kept behind the rider
  ahead: 900,         // and ahead, well past the curtain
  aheadGrowth: 1.062, // per row
  side: 700,          // half-width at the far edge
  sideGrowth: 1.075,  // per column
  /* Rebuilding a graded grid in one frame makes every distant facet choose a
     new normal and colour at once. Preserve the old world-space surface, then
     converge it on the new sampling lattice over a few frames. The terrain
     around the board is exact immediately; only the distant LOD morphs. */
  morphNear: 42,
  morphFar: 180,
  morphRate: 8,
  morphSettle: 1,
};

export const RIDER = {
  /* A deliberately brisk arcade gravity, but a real constant: it is resolved
     along the snow while grounded and applied straight down on every airborne
     step. Jump height and airtime therefore come from takeoff speed and ramp
     tangent rather than from an apex-specific hang-time assist. */
  gravity: 22,

  // Snow under a waxed base. The number is real; the grade does the rest.
  friction: 0.045,
  brakeFriction: 0.62,
  // Drag is what sets top speed, not a clamp: 6.3 m/s² of slope pull
  // balances at about 40 m/s, or 143 km/h.
  drag: 0.0034,
  // Where drag stiffens beyond v², which is the only ceiling in the game.
  // A big kicker landing converts a lot of height into speed and can
  // overshoot this for a second or two; past it the run is pulled back
  // rather than allowed to keep everything it just found.
  maxSpeed: 50,       // 180 km/h
  /* MOMENTUM STABILITY.

     Speed makes the board more committed, not more nervous. These are the
     endpoints of one eased 0..1 signal used only by the parts of the model
     that should settle with momentum: the board-length handling normal and
     the rider's tolerance for a short balance transient. It never raises the
     edge's lateral grip or weakens gravity, so a fast line stays wide and a
     fast jump stays ballistic. */
  stabilityFrom: 8,        // m/s — below this, the board remains nimble
  stabilityFull: 45,       // m/s — full high-speed composure
  contactHalfLength: 0.90, // metres sampled fore/aft at full stability
  handlingResponseMin: 0.035, // seconds of surface-normal inertia
  handlingResponseMax: 0.115,
  /* The floor, and what it is allowed to do.

     This used to be a flat 3.5 m/s² forward push whenever the rider dropped
     under 6 m/s, applied without ever asking which way the ground went — so
     a rider grinding to a halt against a bank was shoved *up* it, and the
     one moment in the game where momentum was supposed to matter was the one
     moment it was being handed back. Now it only fires when the rider has
     genuinely almost stopped and only when the hill under them descends, so
     it does what it was for — getting a stalled run going again — and
     nothing else. */
  minSpeed: 2.0,
  minPush: 3.0,
  /* Climbing.

     Gravity on the tangent already takes g·sin θ off a rider going uphill,
     which is the whole of the real physics and, on a hill this shallow, not
     very much: 5.6 m/s² on the average pitch. What it misses is that a board
     pointed up a slope is also being driven into it, and a loaded edge in
     soft snow scrubs. This is that — extra deceleration proportional to how
     hard the rider is climbing — and it is what makes riding a wall a
     decision with a price rather than a free way to change lanes. */
  climbScrub: 7.5,
  /* Where climbing stops being slow and starts being impossible.

     A snowboard is not a climbing tool. Run out of speed pointing up
     something steep and you do not gently stop — the board stalls, the edge
     that was holding you across the hill has nothing left to hold, and you
     go over. Below `stallSlope` the rider is allowed to grind to a halt and
     start again, which is what the floor push is for; above it they need
     `stallSpeed` at that reference slope and proportionally more the steeper
     it gets. Riding a quarterpipe wall is therefore a commitment: arrive
     with enough and you get thrown off the lip, arrive without it and the
     wall puts you down. */
  stallSlope: 0.32,
  stallSpeed: 7.5,
  /* …and the two numbers that stop that from being a trap.

     A kicker's face climbs at a slope of about 0.9 and a steep knoll is not
     far off it, so a requirement that scales without limit means the rider
     needs 76 km/h to ride up a two-metre jump without falling over — which
     turns every launcher on the mountain into a wipeout and, worse, looks
     exactly like the jump physics being broken. `stallCap` is the most speed
     the rule is ever allowed to ask for.

     And it has to persist. A ramp is under the board for a fifth of a second
     at riding speed, so anything judged instantaneously fires on features
     the rider is simply passing over. A third of a second of continuously
     being too slow for the ground you are pointed up is a stall; less than
     that is a kicker. */
  /* The speed under which a rider has nothing left to stall *with*, and is
     simply being walked back downhill by the floor push. Without this the
     rule loops: fall, get up crawling, stall again, forever. */
  stallMinSpeed: 3.5,
  stallCap: 9.0,
  stallTime: 0.32,
  // The tuck. Fold down over the board and the drag nearly halves, but the
  // edge goes soft and the board stops answering quickly — the trade is
  // speed for the ability to change your mind about where you are going.
  tuckDrag: 0.68,
  tuckTurn: 0.45,     // share of the turn rate left while folded down
  tuckGrip: 0.72,     // and of the grip
  tuckCompress: 0.34, // metres of squat, which the camera rides down with
  /* Fresh snow is slower and less supportive than the groomed surface. The
     weather feeds these endpoints continuously, so a front arriving is felt
     in the edge before it ever becomes a discrete "blizzard" label. */
  stormGrip: 0.80,       // share of clear-weather edge hold in a whiteout
  stormFriction: 1.45,   // share of base friction in deep fresh snow
  // Edge grip, in m/s² of sideways hold. Past it the board washes out and
  // the rider slides — which is where the spray, and the lost speed, are.
  // This one number is most of how the game feels: raise it and the board
  // is on rails, lower it and every turn is a drift.
  /* Edge grip, in m/s² of sideways hold, and it is the number that decides
     how sharply the board answers at all. The turn rate a carve produces is
     grip/v, so this is the whole of the game's steering authority: at 27
     against 39 m/s the heading came round at forty degrees a second, which is
     honest for 140 km/h on real snow and reads, from behind, as a rider who
     has leaned over and kept going straight. 34 buys back most of the
     response without putting the board on rails — the wash-out is still one
     firm input away, because what breaks traction is v² and that has not
     moved. */
  grip: 34,

  /* THE CARVE, as geometry rather than as a steering rate.

     A snowboard does not turn because it is pointed somewhere. It turns
     because it has a sidecut — the edges are arcs, not straight lines — and
     when the board is tilted up on one of them and pressed into the snow,
     that arc is what the board is forced to travel along. Everything about
     how the sport feels falls out of one equation:

         R = sidecut / sin(edge angle)

     Lay the board almost flat and the arc it describes is enormous, so it
     runs nearly straight. Roll it up onto its edge and the radius collapses
     towards the sidecut itself. The rider's only real input is how far over
     they put it.

     What makes that worth doing rather than steering directly is what comes
     out of it without being written. Holding a radius R at v metres a second
     needs v²/R of lateral grip, which goes as the *square* of the speed — so
     the same edge angle that carves a beautiful arc at 40 km/h asks four
     times as much of the snow at 80 and simply tears out. The rider is not
     told this; they discover that a fast line has to be a wide line, which
     is the single truest thing about the sport and previously had to be
     faked with a cap on the turn rate.

     It also gives the lean away for free. A rider holding a turn has to
     incline until the resultant of gravity and the corner runs down the line
     of their legs — atan(lateral / g) — so the body angle stops being a
     cosmetic constant and becomes a read-out of how hard the turn actually
     is. Nobody has to animate it and it can never disagree with the physics. */
  /* Steering at walking pace, which a sidecut cannot do.

     A carve's turn rate is v·sin(edge)/sidecut — proportional to speed — so
     as the rider slows the board stops being able to turn at all. That is
     correct for carving and on its own it is a trap, and it was a real one:
     hold a turn and the rider carves round onto a traverse, the turn rate
     decays with the speed, gravity has no component along a board pointed
     across the hill, and they coast to a dead stop pointing sideways with no
     way to bring the nose back down the fall line. Measured: 61 km/h to zero
     in six seconds on an ordinary 18° pitch, and then stuck there.

     What a rider actually does below about walking pace is stop carving and
     skid the board round — pivot it flat, with the tail washing out. So this
     is a second, speed-independent steering authority that fades *in* as the
     carve fades out. Above `pivotSpeed` it is gone entirely and the sidecut
     is the only thing turning the board, which is the model that matters. */
  pivotRate: 2.2,     // rad/s of skid-steer available at a standstill
  pivotSpeed: 9.0,    // m/s by which it has faded to nothing

  sidecut: 8.0,       // metres — a real all-mountain board is 7 to 9
  edgeMax: 1.15,      // radians ≈ 66°, about as far over as anyone gets
  // How fast the board is rolled onto its edge and off it. Quick, because the
  // sidecut now limits what the edge can *ask* for — so there is no longer any
  // need to protect the rider from their own input by making it sluggish.
  edgeRate: 11.0,
  /* Cutting a trench is not free. A carved edge is slicing through snow
     rather than gliding over it, and the deeper it is set the more of it is
     in the way — this is that, and it is why holding a hard carve all the way
     down a pitch costs speed a straight line would have kept. */
  edgeDrag: 3.2,
  /* How far past the edge angle the snow can actually support the rider is
     allowed to push. This is the narrow band the whole handling model lives
     in: at 1.0 the board is on rails and never slips, and much past 1.15
     every turn is a skid. A few per cent of overdrive is where the edge
     starts to wash and throw powder without letting go. */
  edgeReach: 1.10,
  /* And the furthest the board is ever allowed to point away from the
     direction it is genuinely travelling. Sixty degrees is about as far
     across the fall line as anyone can hold one and still be riding it; past
     that it is not a snowboard, it is a sledge. Braking gets more room to set
     the board across the hill, but never enough to pivot through the direction
     of travel and start running tail-first. */
  maxSkid: 1.05,      // radians ≈ 60°
  brakeSkid: 1.43,    // radians ≈ 82° — broad speed check, still one stance

  /* The generated mountain has a real course direction: towards -Z. Banks,
     bowls and wall rides may carry the rider almost across it, but ordinary
     steering must never complete a U-turn and send the run back up-course.
     These limits are deliberately close to ninety degrees so traverses remain
     wide and expressive while forward progress stays an invariant. */
  courseLimit: 1.48,        // radians ≈ 85°
  brakeCourseLimit: 1.535,  // radians ≈ 88°
  recoveryCourseLimit: 1.22,

  /* BALANCE.

     The lean is the balance angle the turn demands, and the body gets there
     late because a body has mass. The gap between the two — what the corner
     is asking for against what the rider is actually set up for — is balance,
     and it is the one quantity in the sport that the model had nothing to say
     about. Steady state has no gap at all: hold an edge and the body arrives
     and the two agree. It opens in transitions, which is exactly where a
     rider loses it in life:

       under-leaned  — the load arrives before the body does, and it is trying
                       to throw them over the outside edge. This is a carve
                       committed to too fast, and a landing into one.
       over-leaned   — the body is further in than the grip can justify, and
                       the edge slips away underneath them. This is asking for
                       a turn the snow was never going to give.

     What it costs is grip, proportionally and immediately, which closes the
     loop: losing balance loses edge, losing edge loses the turn, and the
     recovery is to stop asking. It deliberately does not own a hidden
     wipeout timer. On a board the player cannot independently position their
     body, ordinary A/D edge changes must not become unexplained falls; the
     lost grip, slide, spray and speed are the readable consequence. */
  balanceWindow: 0.70,  // radians of mismatch that costs all of it
  balanceGrip: 0.40,    // share of grip that balance is responsible for
  /* At full momentum the visible balance window is this many times wider.
     It prevents an ordinary high-speed edge transition from momentarily
     deleting most of the grip; it does not add steady-state cornering force. */
  speedBalanceWindow: 3.25,
  // A railed carve is nearly free — that is the entire reason the sport
  // prefers it to a skid — so this is small on purpose.
  carveDrag: 0.04,
  slideScrub: 0.9,    // per m/s of slide, per second, which is far more
  turn: 2.4,          // rad/s at a standstill, and the cap at any speed
  // How far past the grip limit the steering is allowed to ask. At 1.0 the
  // board is on rails and never slips; much past 1.3 and every turn is a
  // skid. This narrow band is where the whole handling model lives.
  overCarve: 1.18,
  brakePivot: 2.4,    // and how much of that the brake lifts, to skid on purpose
  // With no steering input the board drifts back in line with where the
  // rider is actually going. Without it a nudge leaves you very slightly
  // sideways forever, which reads as the controls being loose.
  selfCentre: 3.2,
  lean: 0.55,         // radians of visual roll at full carve
  leanRate: 7,        // how fast the body gets there — the weight has mass

  /* Suspension. The rider's legs are a spring, and this is the part that
     makes the hill something you feel rather than something you watch: it
     compresses under the normal force, so a landing, a roller and a hard
     carve each push the camera down and let it back up on their own
     schedule. Critically damped-ish, and deliberately a little slow. */
  springFreq: 3.1,    // Hz
  springDamp: 0.75,
  compressPerG: 0.16, // metres of travel per g of normal load
  compressMax: 0.62,
  // How hard the rider can land before the legs stop absorbing it. Generated
  // piste-to-piste hops reached just over 30 m/s into an unlucky face, which
  // should be a huge speed-scrubbing recovery rather than an unexplained fall.
  // Failed flips can still bail below this; truly larger impacts still crash.
  softImpact: 9,      // m/s into the slope
  hardImpact: 32,
  // Ollie: held to charge, released to pop.
  chargeTime: 0.45,
  popMin: 5.0,
  popMax: 11.0,
  /* Popping off the lip.

     A pop released in the last breath before the ground leaves is worth more
     than the same pop released halfway up the ramp, which is the one piece
     of timing the sport actually asks of you and the one thing the old jump
     had no opinion about. The window is generous — a sixth of a second — and
     it is checked against the launch rather than against the lip's geometry,
     so it pays out identically off a kicker, a cornice and the crest of a
     roller. */
  lipWindow: 0.16,
  lipBonus: 1.45,
  // Air control. A 540 wants to fit inside a big ramp's hang time, so the
  // spin rate is set from it.
  spinRate: 7.5,
  spinRamp: 3.2,      // rad/s² — the spin winds up rather than snapping on
  flipRate: 6.2,
  airSteer: 2.6,      // m/s² of drift, for picking a landing line
  /* Landing assist.

     Instead of a second key for air steering, the board finds its own way
     home: inside the last third of a second before touchdown, and only when
     the rider is not actively asking for more rotation, the yaw eases
     towards whichever clean stance is nearer. It cannot rescue a spin that
     was never going to make it — `assistRate` is slow enough that it closes
     perhaps twenty degrees — but it is the difference between a 540 that
     lands and a 540 that lands at 519 and gets called sketchy. */
  assistTime: 0.35,
  assistRate: 3.4,
  // Landing. Anything inside the window snaps straight; anything outside
  // is a bail. Switch is the same window rotated half a turn.
  landWindow: 0.92,   // radians ≈ 53°
  landPitchWindow: 0.85,
  // How far off the ground the rider's ballistic path has to be, ninety
  // milliseconds out, before the hill counts as having dropped away.
  launchGap: 0.12,
  /* Sample that look-ahead in distance as well as time. At 50 m/s four time
     samples were more than a metre apart and could leap over the support
     between two tiny terrain crests. A real board also bridges a short hollow,
     so an unmarked natural release needs a continuous clear run before it is
     allowed to become flight. Explicit kicker/cliff edges bypass that second
     condition and release directly from their trailing tangent. */
  launchSampleSpacing: 0.30,
  launchSupportLength: 0.68,
  launchSupportShare: 0.55,
  // Any meaningful penetration means the ramp still obstructs the ballistic
  // path. Half a millimetre ignores height-field rounding without allowing a
  // convex face to release the rider before its lip.
  launchObstruction: 0.0005,
  /* Scan far enough ahead to recognise an edge before an underpowered rider
     can exhaust their momentum or trip the steep-slope stall rule. The test
     compares the future snow with the trailing tangent, so an ordinary steep
     pitch is never mistaken for a lip. */
  lipCommitDistance: 2.0,
  /* Inside that final approach to a lip, preserve (but never increase) the
     speed carried into each step when it is below this value. This is the
     arcade commitment that prevents an underpowered rider being parked
     upright on a ramp edge; the eventual launch still uses that retained
     speed and the real tangent. */
  lipCommitSpeed: 4.0,
  /* The launch predictor can commit on the integration step that crosses the
     lip. Give that decision a tiny contact window so floating-point overlap
     cannot immediately "re-land" against the same ramp. */
  launchContactGrace: 0.03,
  // A hop small enough not to count: below this the landing is never
  // judged, so chattering over moguls can never end a combo.
  minJudgedAir: 0.34,
  radius: 0.55,
  height: 1.75,
  /* Falling over is the only failure state, and it is temporary — the run
     never ends, the rider just gets up.

     It used to be a timer. The rider dropped to 28% of their speed, slid for
     1.35 seconds whatever had happened to them, and stood up — so catching a
     trunk at 30 km/h and catching one at 170 looked and cost exactly the
     same, which is the one thing a crash must never do.

     Now a fall is a body. Whatever speed was going into the obstacle is
     turned partly into height and partly into a tumble, and from that moment
     the rider is ballistic: gravity, air drag, and a bounce every time the
     snow arrives, each one lower than the last. They are down until they
     have actually stopped, so a slow spill is over in a second and a bad one
     at speed throws them a long way down the hill before it lets go. */
  riseTime: 0.55,
  fallLaunch: 0.62,   // share of the speed the body keeps out of the impact
  fallLift: 0.40,     // and the share of it turned into height
  fallBounce: 0.34,   // restitution against the snow, per contact
  fallDrag: 0.16,     // air, per second, while tumbling
  fallFriction: 8.5,  // m/s² once it is sliding rather than flying
  fallRest: 3.2,      // m/s under which the rider is allowed to get up
  fallMin: 0.7,       // seconds they are down no matter how gentle it was
  fallMax: 5.0,       // and the longest any tumble is allowed to run

  /* Hitting things.

     A collision used to be judged on where on the trunk you caught it and
     nothing else, so a graze at walking pace and the same graze at 120 km/h
     were the same event. Now the severity is the speed actually being
     carried *into* the obstacle, which is the quantity that hurts, and the
     two thresholds below are where it stops being a wobble and where it
     stops being survivable. Direction still matters — it decides how much of
     the speed is aimed at the tree in the first place. */
  brushSpeed: 7,      // m/s into a solid below which it is barely a knock
  wipeoutSpeed: 15,   // and above which the rider is going down
};

export const SCORE = {
  perDegree: 1.0,
  perFlip: 500,
  grabPerSecond: 260,
  airPerSecond: 70,
  switchBonus: 1.5,
  /* Risk is worth something. Fast tricks climb to a 1.5× premium, while a
     pop released on the lip gets its own timing bonus. Neither creates
     points by itself; they only amplify something the player actually lands. */
  speedBonusFrom: 18,   // m/s
  speedBonusFull: 45,
  speedBonus: 0.5,
  lipBonus: 1.25,
  comboStep: 1,       // multiplier gained per clean landing
  comboMax: 12,
  // Below this a landing is just a landing: no banner, no combo, no points.
  minTrickScore: 60,
  nearMiss: 40,       // for threading a tree, a bear, or a bolting rabbit
  nearMissRange: 2.4,
  // Rails pay by the second, and pay again for getting off one cleanly
  grindPerSecond: 420,
  grindOut: 250,
  /* Stopping for a cocoa, which is worth about a landed 540.

     It has to be worth that much because of what it costs: coming to a
     genuine standstill on a pitch means scrubbing off everything you have
     and then climbing back into it from nothing, and the run is built to
     punish exactly that. Paying a combo step rather than resetting the
     multiplier is the same reasoning — stopping at a hut is a decision, not
     a crash. */
  cocoa: 1500,
};

export const PROPS = {
  band: 40,           // metres of hill filled at a time
  ahead: 11,          // bands kept in front of the rider
  behind: 2,
  // Density climbs with distance, which is most of the difficulty curve.
  // Speed takes care of the rest.
  treesPerBand: 22,
  shrubsPerBand: 11,
  innerTreesAt: 400,  // metres before trees start appearing on the piste
  innerTreesMax: 3,
  rocksPerBand: 3,
  /* Trees, grown rather than modelled.

     There used to be one tree — a cylinder, a cone and a smaller cone —
     scaled to three sizes and tinted four greens, and a forest of it reads
     as wallpaper because every silhouette is the same silhouette. These are
     grown instead: a trunk that recurses into branches, each one shorter,
     thinner and turned off its parent, with needles hung on whatever the
     recursion has left at the bottom. It is the oldest fractal in graphics
     and it is still the cheapest way to get a hundred trees that are all
     recognisably the same species and none of them the same tree.

     `variants` of them are grown once at load from fixed seeds and then
     instanced, so the forest costs one draw call per variant however many
     thousand are standing in it. The species table is what makes a treeline
     read as a treeline: spruces that hold a spire, firs that spread, pines
     that go bare and leggy at altitude, and the odd dead larch with no
     needles left on it at all. */
  trees: {
    variants: 12,
    depth: 4,           // levels of branching before the needles go on
    minLength: 0.35,    // metres — below this a branch is not worth a cylinder
    sides: 5,           // radial segments on a branch; they are seen from 20 m
  },
  gateChance: 0.35,
  /* Built kickers are now the exception rather than the furniture. There
     used to be one in nearly two bands out of three, which made the piste a
     corridor of identical yellow-lipped wedges; the mountain grows its own
     launchers by the dozen (see TERRAIN.knolls) and they are all different
     shapes, so this is down to roughly one stretch in eight. What is left of
     it reads as something somebody built, which is the only reason for a
     kicker to look like a kicker. */
  rampChance: 0.12,
  /* Kickers, specified by the angle they throw at rather than by their size.

     This is the correction of a genuine bug, and it is worth writing down
     because the shape of it is not obvious. A kicker's lift is height·t³
     over its length, so the slope at the lip is 3·height/length — but the
     hill underneath is *also* falling away at `grade`, and what the rider
     actually leaves the lip with is the difference. Built as a fixed length,
     a two-metre kicker had a lip slope of 0.27 against a hill that descends
     at 0.30 and, on the steeper chapters, at 0.49. The net was negative: the
     ramp was shallower than the mountain, so the lip pointed *down* and
     riding one launched the rider at the ground. It looked like a jump and
     behaved like a kerb.

     So the length is no longer a number, it is whatever makes the sum come
     out right: length = 3·height / (grade here + kick). Every kicker on the
     mountain then throws at the same angle above the slope it is built on,
     whatever size it is and however steep that stretch happens to be, and
     the launch speed is the rider's own — which is the whole point. Twice
     the speed up the same ramp is twice the vertical, four times the height
     and twice the hang time, for free, because that is what ballistics does
     once the angle is right. */
  ramp: {
    kick: 0.58,       // slope above the hill's own — about 30° off the snow
    power: 3,         // t³: flat where it is entered, steep where it is left
    halfWidth: 2.4,   // plus a little more for a bigger one
    widthPerHeight: 0.5,
    height: [1.4, 2.7],  // the range a found kicker out on the piste comes in
  },
  maxRamps: 7,
  clearLane: 8,       // no hard obstacle closer than this to a centre line
  // Shrubs do not put a rider down. They cost speed and throw powder, which
  // is punishment enough for a bush.
  shrubDrag: 0.42,

  /* Terrain park.

     Every so often a stretch of the run is built rather than found: two or
     three kickers of graded size in a line, a hip off to one side, and a
     rail to slide. It is announced by a gate pair at its head, because a
     park you discover by being launched off it is not a park, it is an
     ambush.

     The island in the middle of a fork is where these prefer to sit — it is
     the one piece of ground the run flows past on both sides, which makes it
     the natural place to put the thing you have to choose to ride. */
  park: {
    period: 780,      // metres between chances at one
    chance: 0.6,
    length: 150,      // how much hill a park occupies
    kickers: [1.5, 2.6, 3.6],   // heights, in the order they are met
    railChance: 0.75,
  },
  rail: {
    length: 14,
    height: 0.85,
    radius: 0.34,
    // How close the board has to be to the rail's line, and how close to its
    // height, before the rider is riding it rather than passing it
    catchWidth: 0.85,
    catchHeight: 0.55,
    friction: 0.012,  // a rail is not snow
  },
};

export const WILDLIFE = {
  // Rabbits are scenery that reacts. They sit, they twitch, and when the
  // rider gets close they bolt — which is the only reason to notice them,
  // and worth a few points for threading one.
  /* Six, down from sixteen. A rabbit is scenery that reacts, and the whole
     value of one is the moment it breaks cover — which is a moment only while
     it is rare. Sixteen of them on a hillside is not wildlife, it is a lawn
     with a pest problem, and the eye stops seeing them within a minute. */
  rabbits: 6,
  rabbitSpawnRange: [40, 190],
  rabbitFlee: 15,
  rabbitSpeed: 9.5,
  rabbitHop: 6.2,     // hops per second, and the height comes from it
  /* Bears do not move out of the way. They are rare, they are slow, and they
     are the one thing on the hill that will put a rider down at speed.

     There is now one, it does not appear in the first kilometre, and even
     once the run is long enough to have earned it the spawn is refused about
     two times in three. A bear should be a story you tell about a run, not a
     feature of every run. */
  bears: 1,
  bearFrom: 1200,     // metres before the first one appears
  bearChance: 0.35,   // and how often a spawn window is actually taken
  bearRespawn: [14, 40], // seconds of quiet between attempts
  bearSpawnRange: [140, 250],
  bearSpeed: 2.4,
  bearRadius: 1.5,
};

export const CAMERA = {
  // A lagging camera sits further back than its nominal distance by roughly
  // speed/lag — at 25 m/s and a lag of 6.5 that is another four metres, and
  // the rider ends up too small to read a landing off. These three numbers
  // are chosen together: close, and followed tightly enough to stay close.
  distance: 6.2,
  height: 2.9,
  airHeight: 4.0,
  lookAhead: 9.0,
  /* How tightly the camera follows, and it had to go up when the speeds did.

     A lagging camera settles roughly speed/lag further back than its nominal
     distance, which at the old top speed was a metre or two and is now, at
     44 m/s, nearly five — so the rider ended up thirteen metres away and too
     small to read a landing off, which is the exact failure the distance was
     chosen to avoid in the first place. Following harder costs a little of
     the weight the lag was there to give, and the shake and the spring put
     that back. */
  lag: 13.0,          // higher follows tighter
  airLag: 5.0,
  /* Share of the rider's carve the camera takes on. It came down when the
     lean stopped being cosmetic: `rider.roll` is now the true balance angle
     and reaches fifty degrees at the limit of grip, where the old constant
     topped out at thirty — so the same fraction was tilting the horizon half
     as far again as it was tuned to. Past about ten degrees this stops
     reading as lean and starts reading as a broken horizon. */
  roll: 0.12,
  shake: 0.55,
  // Speed already closes the frame; a tuck narrows it one final step.
  tuckFov: -4,
  tuckDrop: 0.75,     // and the camera drops in behind the rider's shoulder
  tuckPull: -1.1,
  // How far the camera sits behind where the rider is *going* rather than
  // where the board is pointing. A sliding rider should see their own edge.
  velocityBias: 0.72,
  // A landing punches the frame open and lets it back — the visual half of
  // the thump the legs are already taking
  landFov: 7,
  landFovDecay: 4.5,
};

export const SNOW = {
  count: 1400,
  box: 48,            // the cube of falling snow that travels with the camera
  fall: 3.4,
  size: 0.17,
  // Spray off the edge. This is the single biggest speed cue the game has —
  // more than the FOV, more than the camera shake — because it is the only
  // thing on screen whose amount is a direct read of how hard the board is
  // working.
  sprayCount: 900,
  /* Smaller than it was, because the pixel got bigger. A point sprite is
     sized in metres and converted to buffer pixels, and the buffer is now a
     quarter of the width it was — but every one of those pixels is then blown
     up by two or three, so a particle that measured a tasteful few pixels at
     native resolution arrives on screen as a soft white disc the size of the
     rider's head. At this scale powder wants to be small and numerous. */
  spraySize: 0.15,
  sprayLife: 1.05,
};

/* The line the board leaves behind it.

   A ribbon laid down at the contact point, two vertices a sample, following
   the ground and fading out behind. It is the one thing on screen that
   records what the rider *did* rather than what they are doing, and on a
   mountain made of one colour it is most of what makes a carve legible as a
   carve: the arc is still there to look at a second after it was ridden.

   Width comes off the edge load and the slide, so a railed turn draws a
   clean line and a washed-out one drags a wide grey smear. */
export const TRAIL = {
  samples: 420,       // ring of them; at 30 a second this is fourteen seconds
  rate: 34,           // samples per second
  minStep: 0.22,      // metres — no sample at all if the board has not moved
  width: 0.34,        // half-width of a clean carve
  slideWidth: 1.05,   // and of a full wash-out
  lift: 0.045,        // metres above the snow, to stay out of the z-fight
  life: 9.0,          // seconds before a sample has faded to nothing
  opacity: 0.30,
};

/* Streaks: short white lines that whip past the camera once the run is
   genuinely quick. They cost almost nothing, they only ever appear above a
   speed the rider had to earn, and they are what turns fast into *fast*. */
export const STREAKS = {
  count: 220,
  from: 26,           // m/s before any appear
  full: 44,           // and where the field is at its thickest
  length: 0.11,       // share of a streak's own velocity, per unit speed
  radius: 13,
  ahead: 22,
};
