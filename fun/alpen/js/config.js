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
   carrying. Ordinary riding finds a terminal speed through drag; flow opens
   the powered tuck's ceiling from 50 m/s to a maximum of 250 m/s.

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
  /* The window at its own resolution. Device pixels are capped at 2 and total
     pixels at 4K because denser panels ask for much more fragment, post and
     MSAA work without materially improving a fast-moving picture. */
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
  /* Speed opens the lens just enough for foreground parallax to carry it.

     The old 43-degree end point produced the opposite cue: a long telephoto
     view that flattened the piste and made side walls fill the frame. The
     post stack already supplies a restrained peripheral tunnel, while the
     board, spray and passing trees are the physical cues. A seven-degree
     opening keeps the rider readable and lets the mountain rush past. */
  fovAtSpeed: 72,
  near: 0.5,
  far: 3600,
  /* The draw distance is a curtain of haze, and everything is arranged
     around where it falls: the hill is generated well past it, the peaks
     are painted to melt into it at their base, and the plane that fills in
     behind the hill is exactly its colour, so the seam cannot be seen.

     Both numbers moved out with the resolution. At 288 lines a ridge at
     three hundred metres was four pixels tall and pushing the curtain back
     bought nothing but fill rate; at native resolution it is a ridge. */
  fogNear: 120,
  fogFar: 560,
};

/* The final atmospheric grade. Snow is the hardest thing to light well: it is
   one colour, fills the screen, and left alone reads as a blank page. Shadows
   are pushed towards the sky's blue and highlights towards the sun's amber,
   which is what the eye expects of snow at a low sun and what makes the hill
   legible at all. */
export const GRADE = {
  shadowTint: '#98abc6',
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
  tintStrength: 0.20,
  /* Contrast and saturation, both pushed. Every photograph of this sport is
     a near-black sky over a surface at the very top of the scale with a
     single violently coloured human being in the middle of it, and none of
     that survives a picture graded to be tasteful. The sky stops carry most
     of it now; this is what stops the snow from meeting them halfway. */
  contrast: 1.08,
  saturation: 1.06,
  vignette: 0.12,
  speedVignette: 0.225,
  aberration: 0.00225,

  shoulder: 0.64,
  bloom: 0.16,
  bloomWide: 0.09,
  bloomThreshold: 0.83,
  aoStrength: 0.0,
  aoRadius: 1.0,
  aoBias: 0.18,
  aoFade: [105, 175],
  rays: 0.58,
  rayDecay: 0.95,
  rayDensity: 0.72,

  /* Velocity blur. Six taps along the vector towards the centre of the
     frame, so the corners streak and the middle — where the rider is, and
     where the next thing to hit is — stays readable.

     `blurAmount` wants to be much smaller than it looks, because the taps
     are spaced along that vector and the last one at the frame's corner
     travels five times this. At 0.022 it reached five and a half per cent of
     the screen, which is not a suggestion of speed, it is a smear across
     everything including the rider. */
  /* The speed treatment, at twice the strength it was.

     Blur, the colour separation at the edges and the vignette closing in are
     the three things that say "this is fast" without moving the speedometer,
     and they were all tuned when the picture was a 640×360 buffer where a
     couple of pixels of smear was a lot. At native resolution the same
     numbers are barely perceptible. Doubling them puts the effect back where
     it reads — and it all still starts from nothing below `blurFrom`, so a
     slow run is as clean as it ever was. */
  blurFrom: 24,       // m/s before tunnel vision starts to become visible
  /* The treatment stays useful across the full 50–250 m/s flow range.

     This used to be `blurFull: 48` — a linear ramp clamped at forty-eight
     metres a second, which was a defensible ceiling back when drag set a
     terminal speed near there. Powered flow now reaches far beyond that mark,
     so the three effects sat pinned at maximum for minutes together. Pinned,
     they are not a speed cue at all: a treatment that says the same thing at a
     hundred and seventy and at three hundred and ten is a filter over the
     game rather than a read-out of it, and it is on hardest exactly when the
     rider most needs to see where they are going.

     So the ramp is asymptotic instead. `blurSpan` is how much speed past
     `blurFrom` it takes to reach halfway, and the curve then keeps climbing
     without arriving — the effect keeps moving with the run, and
     it never reaches the strength the old ramp reached at a hundred and
     seventy. It is airborne-agnostic by construction: the input is the whole
     velocity, so a jump keeps whatever the takeoff earned and loses it again
     with the landing. */
  blurSpan: 10,
  blurAmount: 0.012,
};

/* The only sky colour anything outside `weather.js` needs: the haze the
   world dissolves into, used as the starting value for the fog and for the
   particle shaders before the first weather tick lands. */
export const SKY = {
  haze: '#dfe7f2',
};

/* Valley mist: a height term inside the shared fog.

   The radial fog treats a hollow and a crest at the same distance
   identically, which throws away the one depth cue this terrain is made of.
   The mist floor rides a fixed drop below the camera, so as the run descends
   the hollows beneath the rider keep filling with haze while every knoll and
   ridge crest punches out of it. `scale` is the density falloff per metre of
   height above the floor; `max` is how much of the sky the mist may put in
   front of the ground at its thickest, before the weather's own mist dial
   scales the whole thing. */
export const MIST = {
  drop: 7,           // metres below the camera where the mist bank sits
  scale: 0.10,       // per-metre density falloff above the floor
  max: 0.38,         // ceiling on the blend, at full weather mist
  floorRate: 2.2,    // per second — how fast the bank follows the descent
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
    /* 19.6°. Raised from 16.7° by exactly the amplitude of the pitch wave
       added below, which is the whole trick: adding A to the base and A to
       the amplitude leaves the SHALLOW end of the run exactly where the
       slope budget put it and moves only the steep end, from 23° to 28°.
       The mountain now has pitches you have to check speed on and shelves
       you can breathe on, and nothing that was budgeted against the mellow
       end has to be re-derived. */
    base: 0.355,
    waves: [
      { freq: 0.00085, amp: 0.050, phase: 0 },      // ~7.4 km, the big chapters
      { freq: 0.00310, amp: 0.035, phase: 2.1 },    // ~2.0 km, pitches inside them
      /* ~700 m: the scale a single run actually feels. A steep pitch the
         rider has to check speed on, a mellow shelf to catch a breath and
         pump for the next one — the difference between a treadmill and a
         mountain. Kept small enough that the combined trough stays near 10°,
         which the slope budget below still survives. */
      { freq: 0.00900, amp: 0.040, phase: 4.4 },
      /* ~1.2 km: the headwall scale. Deliberately not a harmonic of any of
         the three above, so the four never line up into one repeating
         profile — what the rider gets is a pitch sequence that does not
         come round again. */
      { freq: 0.00520, amp: 0.055, phase: 1.3 },
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
     never would.

     THE LATERAL RATE IS Σ(amp·freq), and it is a budget for the same reason
     the fall-line one is — it was simply never written down, so nothing kept
     it honest. The line under this table used to claim the route drifts about
     seven metres sideways for every hundred it descends; the three sines
     actually summed to thirteen, because a claim about "both amplitudes"
     being small against "their wavelengths" is a statement about each of them
     separately and the rider only ever meets the sum. At thirteen per cent
     the corridor slides sideways at four metres a second under a rider doing
     thirty, which is most of a piste width every ten seconds and is felt as
     the run walking out from under you.

     The shortest wave is where nearly all of it was: at a wavelength of 1570
     metres it carried half the total rate on a fifth of the amplitude. Pulled
     back to eleven it costs the route almost none of its shape, and the two
     long ones — which are the ones that make the run arrive somewhere — are
     untouched. */
  wander: [
    { freq: 0.0040, amp: 11 },
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

     A flat corridor between two walls is a corridor. A corridor with a dish
     in it is a fall line — it gathers a drifting rider back towards the
     middle without ever pushing them, and it is the reason the run reads as a
     route rather than a lane. It costs nothing against the fall-line slope
     budget: the dish rises across the hill, not down it, and lateral
     gradients are free because no part of them lies on the direction the
     rider is descending.

     THEY ARE FREE AGAINST THE SPEED AND THEY ARE NOT FREE AGAINST THE
     STEERING — a passive rider settles wherever the dish's lateral gradient
     balances whatever else has one, and `heightIn`'s groomed/ribbon mask
     (see below) only fades the off-piste octaves down near the centre; by
     the nominal edge they are already back to something like half strength,
     which a shallow dish cannot out-climb. Checked hands-off rather than
     assumed: at 1.2, with `guide.gather` also fading out over the corridor's
     outer third — right where a drifting rider needs it most — a passive
     rider was outside the corridor within nine seconds and sixty-odd metres
     into the rock band by sixteen, and still climbing. At 3.0, with that
     fade narrowed to the last two metres, the same rider stays inside the
     corridor for a full thirty seconds, drifting single digits to low teens
     of metres and settling back towards the line rather than away from it —
     including through a fork closing underneath it, the one geometry this
     was not built to promise anything about at all.

     Twenty-six metres of half-width is a real groomed run — around fifty
     metres of corduroy, wide enough to carve line after line — with the
     powder, the moguls and the treeline starting where it ends rather than
     a rock wall. Fourteen read as a bobsled canyon: the containment wall
     began thirty metres from the centre line and towered over every frame. */
  corridor: {
    half: 26, vary: 8, freq: 0.00118, bowl: 3.0,
    /* And the whole of it stands a little proud of the mountain.

       A piste is the one surface here that is *maintained*, and until now the
       only thing that said so was its texture: the corduroy stopped, the
       moguls started, and at any distance where a rider actually needs to know
       where the run goes, both had already dissolved into the same white. A
       platform gives the edge a shading break and a silhouette instead — the
       ground tilts across the transition, so the piste keeps an edge in flat
       light and in a storm, when the pattern that used to carry it has gone.

       What lands on the screen is not this number, because the shoulder is
       climbing away underneath it: measured across the cross-section, 0.9 here
       leaves the piste's outer lip about half a metre over the verge just past
       it, which is a groomer's cut against untracked snow and reads as one.

       It is a constant across the corridor and comes back down over
       `crownFade` metres of the powder shoulder beyond it — every metre of the
       rise spent outside the groomed snow, none of it inside. That is the
       whole safety argument, and the first version got it wrong by riding on
       the texture mask instead: that one starts fading four metres *inside*
       the edge, because a piste edge roughens rather than snapping to moguls
       on a painted line. It is the right shape for a texture and the wrong one
       for the ground — it tilted the outer four metres of the corridor
       outwards and cancelled a third of the bowl's restoring slope precisely
       where a drifting rider needs it. Measured against the field without any
       crown at all: the corridor now rises by exactly 0.900 m everywhere
       inside it, mean and maximum the same number, so not one millimetre of
       lateral gradient is added where the rider rides and the gathering dish
       is untouched. Nobody is fenced in by this and nobody is flung by it; a
       rider leaving the piste rides a shallow ramp down and one coming back
       rides it up.

       It also earns its shading for free. `cavityShade` and `crestLift` are
       driven by the real curvature of the drawn surface, and a 0.9 m rise
       shaped over fourteen metres is well past both of their upper knees — so
       the convex lip of the platform lights and the concave join beneath it
       shades, which is the pair of lines that makes an edge an edge. */
    crown: 0.9,
    // …and the metres of powder shoulder it takes to come back down. Long
    // enough that the ramp off the piste is a ramp, short enough that the
    // shading break at the top of it is a line and not a wash.
    crownFade: 12,
  },

  /* Between the groomed edge and the containment wall the mountain crosses
     two more kinds of ground, in the order a real valley side offers them:
     first ungroomed snow — the powder field where the bump octaves live —
     then a rocky band where the cover thins over talus and boulders. The
     widths breathe slowly along the run so the zoning never reads as three
     painted stripes, and the wall's lip begins only past both, so the run
     is contained by the same profile as before, just further from the
     corduroy. `rise` is a gentle climb spread across both bands: enough
     that gravity always points back at the piste, never enough to fence it. */
  zones: {
    powder: [26, 40],       // metres of ungroomed snow past the groomed edge
    rock: [42, 64],         // metres of bouldery ground past the powder
    freq: 0.0011,           // how slowly the two widths breathe down the run
    rise: 6,                // metres climbed across the whole shoulder
    rockBump: [1.15, 0.45], // boulder-field octaves: ~12 m swells, ~5 m lumps
  },

  /* The guide: the ribbon of machine corduroy that snakes from gate to
     gate. A groomer drives a line, not a field — so the glass-smooth
     surface is this ribbon, `tol` metres to either side of the racing line
     through the gates, and the rest of the corridor is regular skied-in
     snow: honest grip, a little texture, no reward for leaving the line
     beyond the shorter way to the next gate. `rough` is how much of the
     full off-piste bump spectrum that regular snow carries, and `margin`
     keeps the line — and therefore every gate — inside the corridor with
     the whole ribbon width to spare. */
  guide: {
    every: 150,   // one gate per this many metres of hill, jittered in-slot
    tol: 8,       // groomed half-width around the racing line
    rough: 0.30,  // bump share on the regular snow between ribbon and edge
    margin: 14,   // line offset ceiling: corridor half minus this
    gather: 0.55, // metres of dish centred on the line: gravity points at it
  },

  /* How hard a lit gate burns into the snow, and how far ahead the light
     carries. The shader is in `terrain.js` and the reasoning with it; these
     two are here because they are the only part of it worth a player's
     opinion. The reach is deliberately shorter than the fog: a gate should
     resolve out of the storm rather than be visible through it. */
  gateGlow: 0.85,
  gateGlowReach: 230,
  /* …and what the next one is worth over the three behind it. The course was
     legible as a course and mute as an instruction: four identical pools of
     light down the hill say where the run goes and not which of them has to be
     threaded in the next second and a half. Past about 1.0 the mix inside the
     mouth saturates, so this is the number at which the leading gate stops
     being one of a row and becomes a mark on the snow — which is exactly what
     it should be, because it is the only one the rider can still do anything
     about. The masts above it are promoted by the same rule; see `BEACON` in
     `props.js`. */
  gateLead: 1.7,

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
    /* Towering, rugged alpine mountain containment flanks */
    height: 110,
    scale: 88,
    creep: 0.42,
    creepEase: 18,
    /* Large-scale flank geology. */
    structure: {
      broadFreq: 0.0024,
      detailFreq: 0.0041,
      scaleVary: 0.28,
      broadSeed: 113,
      detailSeed: 127,
      lowerHeight: [10, 26],
      lowerStart: [14, 26],
      lowerWidth: 18,
      upperHeight: [22, 48],
      upperStart: [52, 72],
      upperWidth: 32,
      /* Sharper buttresses cut from detail field */
      ribHeight: 34,
      ribStart: [8, 20],
      ribWidth: 36,
    },

    /* RUNNELS — the channels snow cuts in a flank on its way down it.

       Everything above varies the wall *along* the run, and that is why the
       flanks still read as two poured ramps from inside the piste: seen from
       a rider looking down the hill, a term that only changes over hundreds
       of metres of z is a term that does not change at all. What a real
       steep snow flank is covered in runs the other way — the vertical
       fluting every sluff, every point release and every wet slide leaves
       behind, a hundred parallel channels pointing straight down the fall
       line, and the single most recognisable thing about alpine terrain
       above a piste.

       So this is a carrier across the wall with a phase that wanders slowly
       down it: channels that run downhill, meander a little, and are spaced
       differently on the two sides because they read the same side-specific
       geology the shoulders do.

       IT DOES NOT COST THE SLOPE BUDGET, because it does not lie on the fall
       line — the whole variation is across the hill, which is free for the
       same reason the corridor's dish is. What it does have to respect is the
       *containment* invariant: the ground outside the lip is monotonically
       uphill, so gravity always points home, and a channel deep enough to
       reverse that would be a pocket a rider could sit in.

       That is arranged by construction rather than by measurement. The wall's
       own outward slope is `height/scale · s(u)` for `s(u) = 2u·e^(−u²)`, and
       `depth` is scaled by the *square* of that same shape — so the ratio
       between the channel's steepest wall and the mountain's is a constant,
       set here, and cannot be broken by a stretch of hill where the flank
       happens to lie back. `scale/localScale` keeps it constant against the
       breadth variation too: a broader flank is a shallower one, and its
       channels shallow with it. The number that matters is that ratio, and at
       these amplitudes it is three quarters at the steepest point of the face
       and less everywhere else — so the flank still climbs everywhere, and the
       remaining margin is spent on the two shoulders and the buttress.

       The square is the part that took a second attempt. A linear scaling
       bounds the *carrier's* slope correctly and says nothing about the
       amplitude's own arrival, which contributes about `depth` over the length
       it arrives in — a constant, against a wall gradient that goes to zero
       linearly at the lip. There is therefore always a band just past the lip
       where a linear arrival out-climbs the mountain, and there was: an
       ordinary stretch of flank seven metres out measured +0.11 without the
       channels and −0.02 with them, which is a pocket in ground whose entire
       job is to be uphill. Squared, the amplitude is quadratic in the distance
       past the lip and its derivative is linear — the same order as the wall's
       — so the constant ratio covers the arrival as well as the carrier, and
       the channels simply concentrate on the steepest third of the face, which
       is where a slide cuts them anyway. */
    runnels: {
      wave: 24,          // metres across the flank between channels
      waveVary: 0.30,    // share of it the side's own broad field moves
      depth: 2.6,        // metres from rib to channel floor at full steepness
      fineWave: 8.5,     // and a second, shallower corrugation over the top
      fineDepth: 0.18,
      meander: 5.5,      // metres a channel wanders across the flank…
      meanderFreq: 0.0026, // …over roughly four hundred metres of descent
      seed: 149,
      /* And the cell size at which the mesh stops being able to carry them.
         A twenty-six metre channel wants four samples across it; past six
         metres a cell the term is being sampled below what it describes, and
         what would reach the screen is not fluting, it is aliasing. */
      lod: [5.5, 11.0],
    },
    /* THE BULK, which is the steepness answering the question "and what is
       this face made of".

       The runnels above are a slide's work: parallel channels down the fall
       line, and they gave the flanks a grain. What they could not give them
       is MASS. A fluted ramp is still a ramp, and a real face above a piste
       is not a ramp with grooves in it — it is buttresses and gullies at a
       scale of tens of metres, with a broken surface over the top of that,
       and the steeper the ground the more of both it has. Snow slides off
       steep rock and stops on shallow rock, so a shallow flank is smooth
       because it is buried and a steep one is rough because it is not.

       So both terms below ride the same `steep²` the runnels do, which is
       what makes the roughness proportional to the steepness rather than
       merely present. And they ride it for the same second reason: a term
       whose amplitude is quadratic in the flank's own gradient has a
       derivative of the same order as the wall's, so the ratio between what
       this cuts and what the mountain climbs is a constant. The flanks stay
       monotonically uphill, which is the one property the containment is not
       allowed to lose. Both are pure cuts — the noise is mapped to 0…1 and
       subtracted — so neither can build a bump with a downhill side on it.

       `wave` is deliberately much longer than the runnels': at seventy
       metres these are the gullies the runnels run down, not a second set of
       runnels. `grain` is the opposite end, a couple of metres of broken
       surface that only survives near the camera. */
    bulk: {
      depth: 5.2,          // metres from buttress to gully at full steepness
      wave: 70,            // metres across the flank between gullies
      waveZ: 130,          // …and how far they stretch down it
      grain: 0.85,         // the broken surface over the top
      grainWave: 6.5,
      seed: 181,
      /* Same reasoning as the runnels' own LOD, one octave coarser: a
         seventy-metre gully survives a much larger cell than a twenty-four
         metre channel does, so the bulk is still there on ground where the
         fluting has already faded out. */
      lod: [9.0, 22.0],
    },
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
       wind slab (two elongated scales) →  0.020
       knolls  (see below)        →  0.089
                                     ─────
                                      0.220

     The octaves alone used to spend 0.317, which is nearly twice the whole
     budget and half again the shallowest grade the run reaches. Lateral
     terms would be free — they do not sit on the fall line — but these are
     isotropic noise, so they are not. */
  /* THE SECOND BUDGET, which these two octaves spend unwatched.

     Everything above is about the gradient these terms lay along the fall
     line, because that is what costs a rider speed. It is not the only
     gradient they have. The same noise leans just as hard *across* the run,
     and what that steers is the rider — a hands-off rider goes down the local
     fall line, and the local fall line is the sum of every lateral gradient
     on the hill. Ridges and rolls between them come to 0.077 of it.

     Stretching them across the run the way `chatter` below is stretched is
     the obvious answer and it is not this one. Tried at 0.45 it moved the
     hands-off excursion by about a fifth — and it put the rider *through* the
     mountain six times in six minutes of soak, because a rolling crest
     stretched twice as far across the hill keeps rising under a ballistic
     path for twice as long, and `airStep` has no landing test for a rider
     travelling upward into ground that is rising faster than they are. That
     hole is real and predates this, and papering an octave over it is how it
     would have been found by a player instead. The corridor's dish carries
     the fix on its own for now — see `bowl`. */
  ridges: { freq: 0.0032, amp: 3.5, seed: 5 },
  rolls: { freq: 0.009, amp: 1.6, seed: 1 },
  /* The mogul octave carries its own LOD, for the same reason the chatter
     does and one more besides. Its wavelength is twenty metres and its
     amplitude twenty-two centimetres, so a cell wider than about four metres
     is already sampling it below Nyquist — what reaches the screen out there
     is not moguls, it is noise standing in for them. Fading it out over
     4–9 metre cells is invisible (a fifth of a metre at two hundred) and it
     removes one of the eight noise lookups this function pays per vertex
     across most of the graded field, which is where most of the vertices
     are. `lod` is the cell size the term leaves over, as everywhere else. */
  moguls: { freq: 0.050, amp: 0.22, seed: 2, lod: [4.0, 9.0] },
  /* Wind-carved snow relief, stretched roughly three-to-one along the piste.

     Isotropic fine noise spends its full gradient against the hill and can
     turn a shallow run locally uphill. Alpine wind features are not isotropic:
     slab edges, drift tails and soft sastrugi run in long streamers. Sampling
     a continuous field much faster across the route than down it gives the
     near snow another geometric scale without drawing repeated rows into the
     distance or spending more than a centimetre per metre of the fall-line
     slope budget. At up to forty centimetres combined these are shapes in the snow,
     not a normal-map grain, and therefore stay coherent under MSAA and frame
     rescaling instead of becoming moire. */
  chatter: {
    /* Soft wind pillows: asymmetric shaping raises irregular shoulders while
       retaining a continuous, conservative fall-line slope. */
    coarse: {
      acrossFreq: 0.130, alongFreq: 0.010,
      amp: 0.200, bulge: 0.100, seed: 29,
    },
    fine: { acrossFreq: 0.300, alongFreq: 0.035, amp: 0.100, seed: 47 },
    patchFreq: 0.008,
    /* Spectral LOD: each band leaves before its sampling cells can alias. */
    lod: {
      coarse: [1.25, 2.25],
      fine: [0.90, 1.55],
    },
  },
  warp: { freq: 0.0042, amp: 26, seed: 8 },

  /* CHAPTERS — what this stretch of mountain is made of.

     This is the replacement for the built kickers, and it is a bigger idea
     than they were.

     The octaves above are constants, and that was the flaw the ramps were
     papering over: every metre of this mountain had the same statistics as
     every other metre. The grade already gave the run chapters — pitches that
     stand up, runouts that hand the speed back — and the snowpack already gave
     it bands of material, but the *roughness* never varied at all. Eight
     hundred metres of hill was uniformly, averagely lumpy, so no stretch of it
     was worth remembering and none of it was worth a different line. Dropping
     a wedge on it every few hundred metres was a way of admitting that.

     So the amplitudes are now a mixture of three characters, and the mixture
     drifts along the run.

       PLAIN   — a long open pitch. The big ridge swells stay, everything under
                 them goes quiet, and the knolls nearly vanish. This is the
                 stretch where a tuck is worth taking and a carve draws a
                 clean two-hundred-metre arc, because there is nothing in the
                 way of either. Its whole job is to make the next chapter mean
                 something: roughness you are never given a break from stops
                 registering as roughness.

       BUMPS   — short and sharp. Moguls at two and a third and chatter at a
                 half again, with the long stuff pulled right down. Curvature
                 goes as amplitude over wavelength *squared*, so this is by far
                 the most airborne ground on the mountain even though it is the
                 flattest-looking: at 35 m/s a mogul face here pulls nearly
                 three g and the launch predictor lets go of the rider several
                 times a second. It is the chapter that replaced the kickers,
                 and it throws harder than they did.

       SWELLS  — big and smooth. Ridges and rolls up, everything fine damped
                 away. A hundred-metre wavelength at two metres of amplitude is
                 not a bump, it is a horizon that rises and falls: the ground
                 loads the board through the troughs, goes light over the tops,
                 and rewards a rider who pumps it rather than one who pops.
                 This is the chapter `RIDER.bendMax` and the pump were written
                 for.

     Two slow noises pick the mixture, and they are chosen so that every
     combination is reachable. `busy` is how much is going on at all, and
     `fine` is how short the wavelength of it is — so calm ground is a plain
     whatever `fine` says, and busy ground is bumps or swells depending. Three
     weights that always sum to one:

         plain = 1 − busy      bumps = busy · fine      swells = busy · (1 − fine)

     THE SLOPE BUDGET STILL HOLDS, and it holds for a reason worth writing
     down rather than by having been checked once. The budget is a sum of terms
     each linear in its own amplitude, and the amplitudes here are a convex
     combination of the three profiles — so the cost of any mixture is the same
     convex combination of the three profiles' costs. Keep each profile inside
     the budget and every blend between them is inside it automatically. The
     three come to 0.086, 0.218 and 0.216 against a ceiling of 0.218, so the
     roughest ground the mountain can produce is exactly as steep as the
     roughest ground it could produce before — and the calmest is now genuinely
     calm, which it never was.

     Boundaries run straight across the hill and that is deliberate. The
     snowpack's bands are sheared because they are bands of *colour* and a
     colour boundary has an edge to notice; an amplitude that ramps over two
     hundred metres of descent has no edge at all. It costs two noise lookups
     per row rather than two per vertex, which is the entire reason it is
     affordable inside the physics step. */
  /* THE MASSIF CYCLE — the mountain's kilometre-scale table of contents.

     Everything below `character` varies the ground at hundreds of metres,
     which reads as texture; nothing varied it at thousands, which is why
     five kilometres in, the run had settled into one statistical mountain
     for ever (see the note above `snowLine`). Chapters fix that at the
     scale a real descent changes: every `period` metres the run crosses
     into the next cirque of the range — a glacier shelf, a walled couloir,
     a forested vale, open powder bowls, a wind-scoured crest — each a
     profile over the SAME generators (corridor width, wall height, band
     widths, the five octave channels, snow cover, iciness, tree cover),
     lerped across `edge` metres of transition so nothing steps. Profiles
     live beside the generators in terrain.js; these are the dials. */
  chapters: {
    period: 1700,
    edge: 220,
    seed: 6011,
  },
  character: {
    busyFreq: 0.0022,   // ≈455 m of hill per chapter of "how much is going on"
    fineFreq: 0.0031,   // ≈323 m of "and how short its wavelength is"
    seed: 91,
    // The band of the raw noise over which a chapter fully arrives. Narrow, so
    // the run spends its time *in* chapters rather than between them.
    band: [0.34, 0.66],
    //         ridges  rolls  moguls  chatter  knolls
    plain:  [1.00, 0.35, 0.15, 0.50, 0.22],
    bumps:  [0.35, 0.30, 2.30, 1.50, 1.00],
    swells: [1.50, 2.00, 0.25, 0.40, 0.70],
  },
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
     needs a quarter of a million vertices to reach the horizon; coarse enough
     to reach the horizon, and the ground under the board is a pair of
     triangles. The first seventy-two metres are now a fixed three-quarter-metre lattice
     and only then do the rings widen. That resolves the board, banks and
     moguls at gameplay scale while the graded outer field reaches the horizon.

     This is no longer budgeted as a low-poly surface. Roughly one hundred and
     nine thousand vertices and two hundred and sixteen thousand triangles are
     sensible for a native-resolution WebGL scene, and the denser outer rings
     keep the last visible terrain cells from turning the piste into broad
     triangular planes before the fog has actually hidden them.

     The anchor still snaps to the finest spacing, so the cells nearest the
     rider land on the same lattice every time and the facets stay welded to
     the hill. The graded far ones morph continuously between sampling
     lattices, behind fog that hides the remaining LOD movement. */
  spacing: 0.75,
  uniformNear: 72,    // stable 75-centimetre lattice around the board
  ahead: 900,         // and ahead, well past the curtain
  aheadGrowth: 1.045, // per row
  side: 700,          // half-width at the far edge
  sideGrowth: 1.052,  // per column
  /* And behind, which used to be thirty metres of uniform cells and is now a
     graded fan like the other three.

     Thirty metres was chosen when the camera could not look at them. It can:
     the chase camera follows the *velocity*, and the run is full of moments
     where the velocity is not pointing down the hill — a traverse held to the
     85° course limit, a wall ride, a brake set hard across the fall line, the
     long tumble after a tree. In every one of those the frame swings round and
     the mountain stops thirty metres behind the board, with the trees that
     were planted on it still standing in mid-air, because the forest keeps two
     forty-metre bands back and the ground kept less than one.

     So the tail is generated to exactly where it stops being visible, which is
     a number the game already has: `RENDER.fogFar`. At five hundred and sixty
     metres the haze is total, and the mesh's own edge is dissolved in the same
     curtain that hides the far edge of the fan in front. There is nothing to
     see past it in any weather — a storm only ever pulls the curtain closer.

     It grows faster than the forward fan does, and that is the whole reason
     this is affordable. Detail behind the rider is detail nobody is riding
     into: it is not going to be landed on, carved across or launched off, and
     the only thing asked of it is that it be *there*. At 1.11 per row the tail
     reaches the curtain in thirty-five graded rows past the near field against
     the eighty-two the front spends getting to nine hundred. The back remains
     intentionally coarser than the route ahead, but no longer breaks into
     fifty-metre panels while it is still visible. */
  behind: 560,
  behindGrowth: 1.11,
  /* Rebuilding a graded grid in one frame makes every distant facet choose a
     new normal and colour at once. Preserve the old world-space surface, then
     converge it on the new sampling lattice over a few frames. The terrain
     around the board is exact immediately; only the distant LOD morphs.

     `morphRate` has to be read against how often the anchor moves, and for a
     long time it was not. At 8 per second the glide has a time constant of a
     hundred and twenty-five milliseconds; the anchor used to move every three
     metres, which at riding speed is every seventy-five. The far field
     therefore never converged — it spent the entire run in motion, chasing a
     target that was replaced before it arrived, and on a flat-shaded mesh that
     is a skyline whose serrations visibly crawl.

     The anchor now moves every six metres (see `stride` in terrain.js) and
     this is fast enough to settle inside that window: a forty-millisecond
     constant is four frames, so the far field arrives, sits still, and is then
     disturbed once rather than continuously. It is not so fast that it becomes
     the pop it exists to prevent — four frames of glide is still a glide, and
     everything doing it is past a hundred and eighty metres and half dissolved
     in haze by the time it moves at all. */
  morphNear: 72,
  morphFar: 240,
  morphRate: 26,
  /* HOW LONG THE GLIDE IS ALLOWED TO RUN, and it was costing more than
     everything else in the frame put together.

     `morphRate: 26` is a time constant of 38 ms, so the glide is converged
     to within a third of a per cent after about six of them. This was one
     full second — so for eight hundred milliseconds of every anchor the
     loop went on lerping eighty-one thousand vertices by sixteen floats
     each, a million and a third of lerps a frame, towards values they had
     already reached; and because the update range it publishes always spans
     the whole lattice, it also re-uploaded six and a third megabytes of
     attribute buffer every one of those frames.

     Worse, it never got to finish. The anchor re-arms every eight fine
     cells — six metres — which at riding speed is about four times a
     second, so a one-second settle meant `morphing` was true in 99% of all
     frames and the mountain was permanently paying its worst case. At 0.22 s
     the glide still runs nearly six time constants, which is visually
     complete, and then stops. Profiled at 3.98 ms/frame of pure self time
     before this, the largest single cost in the game. */
  morphSettle: 0.22,

  /* THE MOUNTAIN'S SHADOW ON ITSELF, worked out rather than drawn.

     The hill used to cast into the sun's depth map like everything else, and
     it was by a long way the most expensive thing in there: a near-field
     index over the live mesh, a hundred and thirteen thousand triangles,
     rasterised into a 2048² map every single frame — to produce a shadow
     that is a pure function of two things that barely move, the height field
     and the sun. Nothing about it needed to be dynamic. A tree lashing in the
     wind needs a depth pass; a mountain does not.

     So it is computed instead, on the same amortised build that already
     produces the heights, and shipped as one small texture that every lit
     surface in the game samples per fragment. For each sample the terrain is
     walked back along the sun's own bearing and asked whether anything on the
     way up rises above the line to the light — the classic horizon test, and
     it gives exactly what the depth map gave: the lee of every knoll, the
     foot of every drop, and the long bar the containment wall lays across the
     piste at a low sun.

     `size` is the one number that makes it affordable. The field is smooth —
     a shadow edge on snow has a real penumbra, and this one is softened
     deliberately — so a hundred and four samples across is enough to carry
     it, and at three metres a sample that is still four times finer than the
     features doing the casting. Eleven thousand probes per bearing, not a
     hundred and thirteen thousand triangles a frame.

     `half` is the half-width of that window in metres and is chosen to match
     what the depth map could reach in the first place: past it the ground is
     lit, exactly as it was before, and the shader fades the last fifth of the
     way out so the boundary is a gradient rather than a line. `reach` is how
     far back along the sun a ray looks, `steps` how many samples that march
     takes, `soften` the metres of penumbra, `raise` the height the second
     copy of the field is measured at. `directions` is the number of horizon
     bearings precalculated over the sun's complete daily path. Thirty-two
     puts adjacent rays about one three-metre texel apart at maximum reach;
     fewer bearings visibly miss narrow blockers. `tileSamples` and `tileGrid`
     make the world-fixed torus: five 96 m tiles span 480 m, leaving a complete
     156 m live shadow window while the next off-screen tile is prepared.
     `angularSoftness` is the widened angular radius of the sun. Keeping that
     constant is both more physical and more stable than interpolating the
     distance of two unrelated blockers between adjacent bearings. */
  shade: {
    reach: 160,
    steps: 14,
    /* The lattice, in metres either side of the anchor and in samples across
       it. `half`/`size` come to exactly three metres a sample, and the mesh
       re-anchors every six — so the lattice advances by a whole number of
       samples and every sample lands on the same world position it did last
       time. */
    half: 216,
    size: 144,
    soften: 1.5,
    /* The height a *second* copy of the field is measured at.

       The march answers a question about the ground, and most of what reads
       it is standing on the ground — but not all of it, and not all of any of
       it: a twenty-metre spruce crown and a rider at the top of a jump can
       both be above the knoll that is shadowing the snow under them, which
       the depth map this replaced got right for free by testing each
       receiver's actual position in space.

       Storing the horizon in metres would answer it exactly and would ruin
       the thing that makes this field cheap: a metric rise steps almost
       vertically at a shadow's edge, so a lattice sampled every three metres
       and filtered between samples would hand back a hard edge instead of the
       soft one the sun actually casts. Two already-softened layers filter
       properly, because both of them are smooth. So the field is measured
       twice — once on the snow, once fourteen metres over it — and a receiver
       reads its own height between them. */
    raise: 14,
    directions: 32,
    azimuth: [0.25, 2.05],
    tileSamples: 32,
    /* 5, and briefly 7 "to push the shadow edge further into fog" — which it
       cannot do: the visible shadow reach is `shade.half` faded in the
       shader, and the torus page only has to exceed twice that, which five
       tiles already does with headroom. What the 7 actually bought was a
       doubled atlas (3.3 → 6.5 MB re-uploaded on every batch install) and a
       near-doubled synchronous horizon march on boot.

       The page-diameter arithmetic above holds only from the centre tile's
       CENTRE; from its edges the residency guarantee is two whole tiles —
       192 m — which is why the fade radius in shading.js is derived as
       `2·tileSpan − 6` rather than trusting `half`. */
    tileGrid: 5,
    /* One extra tile of residency ahead (downhill, −z). Without it the row
       entering the wanted window appears exactly at the 192 m guarantee with
       zero worker lead time, so at speed its install landed inside the
       visible fade — a 96 m square of slope changing its shadow in front of
       the rider. With it, an incoming row is queued 288 m out and has ~100 m
       of travel to build before it can matter, while the row it evicts in
       the 6-deep torus is 288 m behind. */
    tileGridAhead: 1,
    directionGrid: [8, 4],
    angularSoftness: 0.018,
  },
};

export const RIDER = {
  /* A deliberately brisk arcade gravity, but a real constant: it is resolved
     along the snow while grounded and applied straight down on every airborne
     step. Jump height and airtime therefore come from takeoff speed and ramp
     tangent rather than from an apex-specific hang-time assist. */
  gravity: 22,

  // Snow under a waxed base. The number is real; the grade does the rest.
  /* WHAT THE SURFACE IS WORTH, as a top speed rather than only as drag.

     The piste is a machine-made ribbon of hard, fast snow and the mountain
     either side of it is not, and the model barely said so: open powder
     dragged 1.15x a groomed run, which at speed is a rounding error, and
     the speed ceiling ignored the surface completely. So the fastest line
     down the hill was wherever the fall line happened to point, and the
     corduroy the whole course is built around was worth nothing to ride.

     These are multipliers on the flow-unlocked ceiling: the groomed ribbon
     runs a little over it, settled powder is held well under, and the talus
     and scoured rock under it is slower still. Ice keeps piste speed - it
     is the fastest surface on the hill, and it is where the grip is not.
     Combined with the drag figures below, the piste is now the fast line
     and leaving it costs real speed rather than a little texture. */
  pisteSpeed: 1.12,
  powderSpeed: 0.60,
  iceSpeed: 1.10,
  rockSpeed: 0.50,
  friction: 0.045,
  brakeFriction: 0.62,
  /* A one-button heel-side speed check.

     S is not reverse and it is not an invisible friction switch. The rider
     progressively pivots the board across the direction of travel, sets an
     edge and lets the base sideslip while that edge scrubs speed. A/D held as
     braking begins chooses the side; otherwise the current carve continues,
     falling back to the rider's natural heel side from a straight line. */
  brakeAngle: 1.34,       // radians ≈ 77° across travel at full pressure
  brakeEdge: 0.72,        // share of the currently holdable edge angle
  brakeEngage: 9.0,       // pressure build-up per second
  brakeRelease: 12.0,     // releasing the edge is a little quicker
  brakeSlideDamping: 0.45, // controlled sideslip; kinetic friction does the stop
  brakeCompress: 0.24,    // low, weighted stance while checking speed
  // Drag is what sets ordinary top speed, not a clamp: 6.3 m/s² of slope
  // pull balances at about 40 m/s, or 143 km/h.
  drag: 0.0034,
  /* Flow owns the speed ceiling. With no flow the old 50 m/s limit remains;
     a full meter opens it to five times that value. */
  baseMaxSpeed: 50,   // m/s — 180 km/h
  /* The ceiling flow unlocks. It was 250 m/s — nine hundred kilometres an
     hour, which is not a snowboard and not steerable; the number existed
     because flow was the only thing it fed and nothing else bounded it.
     Flow is the score multiplier now (see `stepFlow` in main.js) and speed
     is something you SPEND it on, so the ceiling only has to be worth
     spending on: ninety-six metres a second is three hundred and forty-six
     kilometres an hour at a full meter, which is still faster than anything
     else on the hill and still a line you can hold. */
  maxSpeed: 96,
  // Where drag stiffens beyond v² when the powered tuck is not held.
  // A big kicker landing converts a lot of height into speed and can
  // overshoot this for a second or two; past it the run is pulled back
  // rather than allowed to keep everything it just found.
  dragKnee: 50,       // m/s — 180 km/h
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
  /* One-foot skating when the board has almost stopped.

     The old recovery was an invisible constant force below 2 m/s. It kept a
     run from getting stranded, but the board simply gathered speed while the
     rider stood still. Recovery is now a real sequence: hysteresis starts a
     skating cycle at walking pace, each planted rear-foot stroke contributes
     one measured impulse, and the foot finishes its current cycle before it
     returns to the binding. On a flat surface the impulses still beat base
     friction, while a descending pitch contributes its own gravity as usual. */
  pushStart: 3.0,       // m/s — begin skating below 10.8 km/h
  pushStop: 6.5,        // m/s — finish the stroke above 23.4 km/h
  pushCadence: 1.55,    // complete rear-foot cycles per second
  pushImpulse: 1.55,    // m/s added at the planted part of each stroke
  pushPlant: 0.54,      // 0..1 phase at which the foot drives through snow
  /* Climbing.

     Gravity on the tangent already takes g·sin θ off a rider going uphill,
     which is the whole of the real physics and, on a hill this shallow, not
     very much: 5.6 m/s² on the average pitch. What it misses is that a board
     pointed up a slope is also being driven into it, and a loaded edge in
     soft snow scrubs. This is that — extra deceleration proportional to how
     hard the rider is climbing — and it is what makes riding a wall a
     decision with a price rather than a free way to change lanes. */
  climbScrub: 7.5,

  /* THE BOUNDARY MOUNTAINS, and the one thing the terrain alone could not
     promise about them.

     `TERRAIN.wall` contains by shape: past the quarterpipe lip the ground
     rises asymptotically towards sixty-two metres and then creeps upwards for
     ever, so gravity outside the corridor always points home. The arithmetic
     for that was written against a terminal speed of fifty metres a second,
     which buys v²/2g = fifty-seven metres of climb against the sixty-two the
     exponential saturates at. Comfortable.

     Full flow now raises that ceiling fivefold. The kinetic energy available
     to a determined rider still beats any finite wall shaped for 50 m/s. At
     eighty metres a second the same sum buys a hundred and forty-five metres,
     and the containment is a suggestion.

     What is missing is not more mountain. It is that the ground out there
     stops being a piste. Everything inside the lip is machine-groomed; past
     it is unpisted, wind-loaded, bottomless alpine snow, and the honest
     difference between the two is not a few per cent of friction — a board
     driven into deep snow at speed sinks, ploughs and stops climbing almost
     at once. That is what these three numbers are, and they are why there is
     still no invisible wall, no bounce and no teleport: the rider may ride
     out there, may launch off the lip, may land out there and slide back
     down. What they cannot do is *climb*, because there is nothing solid
     enough under the board to climb on.

     `span` is the depth over which the surface goes from groomed to
     bottomless, `drag` the deceleration at the far end of it, and `grab` the
     rate at which the uphill component of a rider's velocity is taken away
     once they are in it — the last of which is the actual invariant, since it
     is applied after the powered tuck's floor and therefore cannot be
     outrun by any speed however it was obtained.

     ALL THREE WENT UP, and the measurement that moved them is worth keeping.
     A rider tucking and steering deliberately at the left bank reached 52.5
     metres above the piste — most of a 62-metre wall, which is to say they
     were climbing the mountain rather than riding the bank of the run. The
     same trial now tops out at 23.5 m, and the three hands-off trials that
     bracket it moved by tenths, which is the shape the change had to have:
     the quarterpipe a rider *uses* is the first ten metres past the lip and
     nothing above that was ever meant to be reachable. Deeper snow sooner,
     and it refuses harder once you are in it. */
  wallSpan: 12,
  /* What the deep snow costs a rider trying to gain height in it, on top of
     `climbScrub`. It is charged against the climb rather than flat against
     the speed, and that is not a detail: a flat term large enough to stop a
     fast rider is also larger than the 6.5 m/s² the creep slope has to offer
     going the other way, which would strand anybody thrown out there by a
     cliff instead of walking them home. Deep snow is slow to climb through
     and merely slow to descend through. */
  wallDrag: 30,
  /* And the edge. This is the one that decides the *shape* of the failure
     rather than its cost: unpisted wind-loaded snow will not hold a carved
     edge across the fall line at all, so a board out there washes out and
     goes wherever gravity sends it, which on the containment wall is home.
     Without it a rider can hold a level traverse along the bank for ever —
     not climbing, and not needing to, because the run itself descends nearly
     a third of a metre for every metre of z and simply leaves them up there.
     That was the actual escape, and it is a grip problem rather than a climb
     one. This is the share of the edge the deepest snow takes away. */
  wallWash: 0.88,
  /* The refusal itself: the rate at which the component of travel pointing up
     the fall line is taken back out. It saturates with depth — see the note
     in `rider.js` — so past `wallSpan` metres the answer is simply no. */
  wallGrab: 11.0,
  /* And the sluff, which is the term that finally closed the last way out.

     Refusing the climb is not enough on a run that descends nearly a third of
     a metre for every metre of z: a rider who merely holds their altitude out
     on the bank is left further and further above the piste without ever
     having gained a centimetre, and the wander then carries the run out from
     under them as well. Sixty metres up the containment wall, having done
     nothing but hold a line.

     What is missing from that picture is the snow. Metre-deep unconsolidated
     powder on a forty-degree bank does not sit still under a board — it
     fractures and runs, and it takes the board down with it. That is a
     sluff, it is the single most characteristic thing steep off-piste snow
     does, and it points down the fall line, which on the containment wall is
     the way home. So it contains without ever pushing anybody anywhere they
     were not already being pulled, and it can never strand a rider, because
     the direction it acts in is the one they want to go. */
  wallSluff: 10.5,
  /* And the pivot, which is the one that does the containing. A board buried
     across the fall line has a metre of edge on the uphill side and nothing
     under the downhill one, so it swings to point down the hill — see the
     long note in `rider.js`. As an exponential rate: a third of a second to
     come round at full depth, and nothing at all inside the lip. */
  wallPivot: 3.0,

  /* Where climbing stops being slow and starts being impossible.

     A snowboard is not a climbing tool. Run out of speed pointing up
     something steep and you do not gently stop — the board stalls, the edge
     that was holding you across the hill has nothing left to hold, and you
     go over. Below `stallSlope` the rider is allowed to grind to a halt and
     skate away again; above it they need
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
     simply being walked back downhill by the recovery skate. Without this the
     rule loops: fall, get up crawling, stall again, forever. */
  stallMinSpeed: 3.5,
  /* And the speed under which a stopped rider's board is allowed to ease
     round to the fall line on its own. Well under walking pace: any higher
     and the board swings downhill while real momentum is still carrying the
     rider the way they were going, which is the "he drives backwards" that
     started this. */
  fallLineSpeed: 1.6,
  stallCap: 9.0,
  stallTime: 0.32,
  // The powered tuck. Holding it guarantees this much additional speed each
  // second and bypasses aerodynamic drag until the flow-owned cap. The edge
  // still goes soft and the board stops answering quickly.
  tuckAcceleration: 7.5, // m/s², accumulated for as long as W is held
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
  /* An edge only bites because the board is moving.

     Grip had no speed term at all, which meant a stationary board had the
     same 34 m/s² of lateral hold as one at full song — and that is enough to
     stand a rider sideways on a forty-four degree wall indefinitely. It is
     exactly how a run got marooned: come to a crawl somewhere steep, the edge
     holds across the fall line, the old floor force trickles you along its
     threshold, and you creep across the mountain at seven km/h for ever with
     gravity unable to get a word in. Observed on a
     wall at 43.8°, velocity pinned at 2.0 m/s, indefinitely.

     A real edge at walking pace does not hold; the board washes out sideways
     and you slide down the fall line, which is the recovery. So the hold
     ramps in with speed and keeps a floor, because a board with literally no
     grip cannot be steered at all and standing still would become a slow
     slide to the bottom of the mountain. */
  gripSpeed: 7.0,     // m/s at which the edge is fully engaged
  gripLow: 0.22,      // and the share of it a nearly-stopped board keeps
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
  brakePivot: 2.8,    // rad/s available to kick the board across into a stop
  // With no steering input the board drifts back in line with where the
  // rider is actually going. Without it a nudge leaves you very slightly
  // sideways forever, which reads as the controls being loose.
  selfCentre: 3.2,
  lean: 0.55,         // radians of visual roll at full carve
  leanRate: 7,        // how fast the body gets there — the weight has mass

  /* THE BEND — what the *shape* of the ground does to the board.

     This is the term the model was missing, and its absence is why a mountain
     with four octaves of noise on it rode like a plane that happened to be
     tilted. The load through the legs was gravity plus the corner and nothing
     else, so a compression at the bottom of a roller and the crest of the same
     roller put exactly the same weight through the board — which is to say the
     hill had shape you could see and no shape you could feel.

     What a surface actually does to something following it is v²·κ, where κ is
     the curvature of the path in the vertical plane. Through a hollow the snow
     has to push harder than gravity to bend the rider's line upwards, and the
     rider is heavy; over a crest it pushes less, and past the point where
     v²·κ exceeds g the ground stops being able to push at all — which is the
     launch predictor's job and the reason nothing here needs to know about
     jumping. It is the same equation from both ends.

     Note what it is *not* computed from. The obvious cheap answer is the rate
     of change of `climbRate`, and it is wrong: a rider accelerating down a
     perfectly straight pitch has a climb rate growing more negative every
     step, which that reading calls a crest and which is nothing of the kind.
     The gradient along travel is a property of the ground and the heading
     alone, so differentiating it *per metre travelled* rather than per second
     gives the geometry with the speed taken out — and the speed then comes
     back in as v², squared, where it belongs. It costs no extra samples of the
     height field: both normals it needs are already computed every step.

     Three things read it, and between them they are most of what "reactive"
     means. The legs take it, so the camera dips through a compression and goes
     light over a rollover. The edge takes it, because grip is proportional to
     the force pressing the board into the snow — which means a carve laid into
     a trough holds when the same carve on a crest lets go, and choosing where
     in the terrain to turn becomes the skill it is in the sport. And a leg
     extension released while it is high is a pump. */
  bendSmooth: 22,     // per second — the board bridges, the legs absorb
  bendMax: 1.8,       // g of extra load the ground is allowed to add
  bendMin: -0.9,      // …and how light it may make the rider before the
                      // launch predictor takes over and lets go entirely
  /* Grip is proportional to normal force, so strictly this wants to be one.
     It is not one because the honest figure makes a mogul field oscillate
     between a rider on rails and a rider with nothing, forty times a run, and
     the difference between 1.0 and 0.6 is the difference between terrain that
     matters and terrain that is in charge. */
  loadGrip: 0.6,
  loadGripMin: 0.5,
  loadGripMax: 1.6,

  /* PUMPING, which is the one thing every rider on a hill does constantly and
     no snowboarding game ever gives you a way to do.

     It is already half-written: `chargeTime` loads the legs and releasing them
     unloads. What that release does depends entirely on what the ground is
     doing underneath it at that moment, and until now the answer was always
     "jump". Released on a lip it still is, and it still gets `lipBonus`.
     Released in a compression — where the terrain is pressing the board into
     the snow and there is something to push *against* — the same extension
     drives the rider forward instead, because that is the direction the legs
     have to work in when the ground is not about to let go.

     One key, two outcomes, chosen by where you are on the terrain rather than
     by a second button. `pumpFrom` is the load below which there is nothing to
     push against and the release is simply a small hop. */
  pumpFrom: 0.25,     // g of bend before a release starts paying speed
  pumpSpeed: 4.2,     // m/s from a full charge released at full load

  /* Suspension. The rider's legs are a spring, and this is the part that
     makes the hill something you feel rather than something you watch: it
     compresses under the normal force, so a landing, a roller and a hard
     carve each push the camera down and let it back up on their own
     schedule. Critically damped-ish, and deliberately a little slow.

     The normal force it is pulled towards is gravity, the corner and — since
     `bendMax` above — the ground's own curvature, which is what finally makes
     the four octaves of noise on this mountain something the legs report on
     rather than something the eye has to take on trust. */
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
  /* The storm leaning on an airborne rider. Multiplied by the weather's own
     surface wind (roughly ±1.5 m/s calm, ±17 m/s in a blizzard), so a calm
     day is imperceptible and a whiteout genuinely pushes a long air off its
     line — the one place the wind can grab a board with no edge in the
     snow. Grounded riding stays wind-free: grip owns the ground. */
  windAir: 0.055,
  /* Two rates that keep yaw corrections from teleporting the board.

     `skidRecover` bounds how fast the skid and course clamps may pull
     excess heading back once their limit is exceeded. During ordinary
     riding the excess grows by less than this in a step, so the clamps
     bind exactly as before; the difference is the discrete events — a
     butter released, a brake let go — where the allowed skid shrinks by
     sixty degrees in one input frame and the board used to snap to match.

     `glideRate` drains the presentation-only remainder of a landing snap:
     the physics still squares the board on touchdown (judging and the
     next carve need it), but the few degrees the assist did not close
     glide out of the *rendered* pose over about a tenth of a second
     instead of jumping. */
  skidRecover: 9.5,   // rad/s
  glideRate: 11,      // per second, exponential
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

  /* THE GRAB, which was one reach and is now three, chosen by what the rest
     of the body is already doing rather than by two more keys.

     A grab is the only trick in the game that pays for how long you hold it,
     and for a long time it was also the only trick with exactly one shape —
     so a rider who had learned it had learned all of it, and holding Q was a
     tap you made once per jump and then forgot. What the sport actually has
     is a dozen of them, and which one you get is decided by where your weight
     is when your hand goes down.

     So that is the input. W folds the body forward and the leading hand
     reaches past the binding for the nose; S sits the weight back, the knees
     come up behind and the trailing hand takes the heel edge in a method;
     neither, and the trailing hand drops straight onto the toe edge between
     the feet, which is an indy and is what a hand does when you do not tell
     it anything. No key was added, the two modifiers already mean forward and
     back everywhere else in the game, and the pose the rig draws is the pose
     the physics of the reach implies.

     `reach` is how far past the nominal grab point the hand has to travel and
     therefore how far the body has to fold; the score follows it, because
     what makes one grab worth more than another is exactly how far out of
     shape you have to get to hold it. */
  grabs: [
    // indy — trailing hand, toe edge, between the bindings
    { name: 'INDY', reach: 1.0 },
    // nose — leading hand, past the front binding, body folded over it
    { name: 'NOSE GRAB', reach: 1.35 },
    // method — trailing hand, heel edge, board pulled up behind the back
    { name: 'METHOD', reach: 1.6 },
  ],
  // Seconds of hold past which a grab stops being a touch and starts being a
  // tweak, and the second stop where it is being held for its own sake.
  grabHold: [0.18, 0.55],

  /* THE PRESS, and why the same key does it.

     Everything this game scores happens in the air, and most of a run is not
     in the air. On a plain chapter — which the terrain deliberately spends a
     third of its length being, so that the next rough one means something —
     there was nothing to do but hold a line and wait for the ground to change
     its mind. That is the gap this fills, and it fills it with the one thing
     every snowboarder does on flat ground: they stand on one end of the board
     and spin on it.

     A press is a real mechanic and not a pose, because lifting one end of the
     board out of the snow genuinely changes three things at once, and all
     three of them are already quantities this model has:

       THE EDGE MOSTLY GOES. Half the effective edge is in the air, so the
       grip the sidecut can ask for collapses — which is why a press held
       through a hard carve washes out on its own and no rule had to be
       written saying you cannot do both.

       THE BOARD PIVOTS FREELY. With the tail unweighted there is nothing
       buried to resist a rotation, so the skid clamp — the rule that a board
       may never point more than sixty degrees off its own travel — is exactly
       the rule a butter is defined by breaking. It opens with the press, and
       when the board passes ninety degrees the leading end has genuinely
       changed and the rider comes out switch.

       AND IT COSTS SPEED. A board standing on its nose is ploughing with its
       nose, and a butter is a slow trick everywhere it has ever been done.

     `spinPay` is per full rotation carried through a press. It is deliberately
     modest against a jumped 360 — this is a trick you can do anywhere, at any
     speed, without leaving the snow, so it has to be worth doing and must
     never be worth more than committing to a lip. */
  pressRate: 6.5,       // per second the board comes up onto one end
  pressRelease: 9.0,    // and settles back down a little quicker
  pressGrip: 0.62,      // share of the edge a full press takes away
  pressPivot: 3.4,      // rad/s of free rotation it hands back, at any speed
  pressDrag: 2.6,       // m/s² of plough for standing on one end of the board
  pressSkid: 3.05,      // radians the skid clamp opens to — nearly a half turn
  pressMinSpin: 2.62,   // radians (150°) under which a butter is just a press
  pressMinTime: 0.3,    // seconds under which it is just a wobble
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
  // The 250 m/s ceiling still needs a bounded predictor budget. Normal play
  // is far below this count; only extreme powered speeds widen the sweep.
  launchSampleMax: 192,
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
  /* HOW FAR INSIDE THE MOUNTAIN A RIDER MAY BE BEFORE IT COUNTS AS SNOW,
     whatever direction they are travelling.

     The touchdown test asks for a contact that is both *approaching* and
     *descending*, and the second half of that has a hole in it. A rider
     flying up a containment wall is approaching its surface — the wall's
     normal leans in towards them — but they are not descending, so the test
     refuses the contact and the ballistic position is left where it was.
     That is fine for one step. It is not fine for eighty, and if the ground
     is rising faster than the rider is, eighty is what it takes: the soak
     found riders three and a half metres inside the hill and still sinking.

     `descending` is not wrong, it is just doing two jobs. It is there to
     protect a pop — a rider who ollies off an uphill transition is rising
     into ground that is still rising, and re-landing them immediately would
     take the trick away. So it stays, and this is the backstop underneath
     it: a pop clears the snow within a few centimetres or it was never a
     pop, and nothing legitimate is ever half a metre under it. */
  buryDepth: 0.5,
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
  /* Taking a spin off its axis, which is the difference between a rotation
     and a trick worth a name. A flip laid into a spin is much harder to see
     out of and much harder to land than either of them alone, and until this
     existed the game paid for it as though the two had happened one after the
     other. Multiplied, not added, so it scales with whatever was already
     being attempted. */
  corkBonus: 0.45,
  /* Buttering, per full rotation carried through a press. Deliberately small
     against a jumped 360: this is a trick you can do on flat ground at any
     speed without leaving the snow, so it must be worth doing and must never
     be worth more than committing to a lip. */
  butterPerTurn: 240,
  /* Risk is worth something. Fast tricks climb to a 1.5× premium, while a
     pop released on the lip gets its own timing bonus. Neither creates
     points by itself; they only amplify something the player actually lands. */
  speedBonusFrom: 18,   // m/s
  speedBonusFull: 45,
  speedBonus: 0.5,
  lipBonus: 1.25,
  comboStep: 1,       // multiplier gained per clean landing
  comboMax: 12,
  /* FLOW, which is now the multiplier itself rather than a speed governor
     with a number beside it. See `stepFlow` in main.js.

     `flowPerPoint` is the exchange rate from a trick's payout into meter,
     applied to the SQUARE ROOT of the payout so that a trick worth ten
     times another does not fill the bar ten times faster — one enormous
     air would end the progression and everything after it would be
     decoration. A 60-point minimum trick is worth half a per cent, a
     landed 900 with a grab about a sixth of the bar, and a 4,000-point
     switch cork better than a quarter of it. `flowGate` and `flowButter`
     are the flat awards for the two things that are not scored by size.
     `flowBail` is what a wipeout costs — not everything, because losing a
     full meter to one caught edge is the kind of punishment that stops
     people trying tricks at all, which is the opposite of the point. */
  flowPerPoint: 0.0042,
  flowGate: 0.035,
  flowButter: 0.05,
  flowSketchy: 0.35,   // share of a clean landing's flow a sketchy one earns
  flowBail: 0.55,      // share of the meter a wipeout takes
  /* And what it costs to spend. W converts flow into speed: while the tuck
     is held the meter drains at this rate, and the powered floor it buys
     scales with what is left. Banking flow for the multiplier and burning
     it for a fast line are now the same currency, which is the whole of
     the decision this rework exists to create. */
  flowTuckDrain: 0.085,
  // Below this a landing is just a landing: no banner, no combo, no points.
  minTrickScore: 60,
  nearMiss: 40,

  /* Threading a slalom gate, and the ladder that consecutive ones build.

     Each gate taken without missing one is worth more than the last, and a
     miss puts you back to the bottom. That is the difference between a row of
     scoring gates and a course: a single gate is worth about a third of a
     modest trick, and a run of six is worth committing a whole line to. The
     ladder is capped so a very long straight of them cannot outrun the rest
     of the scoring. */
  gate: 120,
  gateRunMax: 8,
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
  /* …and behind, which is the forest's half of the same fix the terrain's
     `behind` is. Two bands was eighty metres, against thirty metres of ground
     — so the two disagreed, and the fifty metres where they disagreed was a
     row of conifers standing on nothing at all. That was the visible bug.

     The ground now runs to the fog, and this does not, because a tree costs a
     great deal more than a vertex of snow: these are grown meshes carried on
     instanced pools, and every instance in a pool is submitted whether or not
     anything is looking at it. Six bands is two hundred and forty metres,
     which is where the haze has taken half the contrast out of a trunk — far
     enough that the treeline ends in fog rather than in a line, and near
     enough that the pools stay the size they were. */
  behind: 6,
  // Density climbs with distance, which is most of the difficulty curve.
  // Speed takes care of the rest.
  /* Attempts per band, not trees. The stand field and the treeline in
     `props.js` between them refuse about a third of these, so the average
     band carries roughly two thirds of this number — bunched into stands
     with real clearings between them rather than spread evenly over every
     hillside on the mountain.

     Raised by half once the draw-call budget could pay for it: the stands
     were reading as a scatter of individual trees rather than as woods, and
     the fix for that is not a wider treeline but more trunks inside the
     same one. It buys depth rather than frontage — see the band depth
     field in `props.js`, widened in the same step so the extra trees stack
     behind the front rank instead of thickening it into a hedge. */
  /* Trees are strictly confined to the low valley verges near the piste,
     leaving the high mountain flanks and slopes completely free of trees. */
  treesPerBand: 42,
  /* Where the forest is allowed to begin, measured out from the groomed edge.
     THE PISTE IS EMPTY. */
  verge: 2.2,
  /* Slalom gates, and how wide the pair stands. */
  gateHalf: 4.6,
  trees: {
    variants: 24,
    depth: 4,           // levels of branching before the needles go on
    minLength: 0.35,    // metres — below this a branch is not worth a cylinder
    sides: 5,           // radial segments on a branch; they are seen from 20 m
  },
  /* Mountain environment: rich alpine vegetation on verges and mountain flanks */
  biomes: {
    plantCandidates: 36,
    shrubCandidates: 48,
    sideRockCandidates: 4,
    stoneSize: [0.4, 2.8],
    cragFrom: 200,
    cragChance: 0.20,
    cragOut: [40, 140],
    cragSize: [3.5, 7.5],
    hazardFrom: 200,
    hazardChance: 0.25,
    hazardPadding: 8,
    hazardEdge: 3.2,
    hazardOut: 15,
  },
  // Low vegetation bends and scrubs speed instead of causing a wipeout.
  shrubDrag: 0.42,

  /* THERE IS NOTHING BUILT ON THIS MOUNTAIN. This is where it all was.

     The kickers went first, and their going is documented at length in
     `props.js`. A built ramp is a games idea: it is the same wedge every
     time, it announces itself in amber, and it turns *where do I get air* —
     the only interesting question a hillside asks — into a question with a
     printed answer. `TERRAIN.character` replaced them: the hill rides in
     chapters, and a chapter of short bumps throws a rider further, more often
     and in more different ways than a row of identical wedges ever did.

     THE PARK AND ITS RAILS HAVE NOW GONE THE SAME WAY, and the argument is
     the same argument finished properly. What survived the kickers was a
     hundred and fifty metres of hill with three steel bars on it, announced
     by a gate pair — and that is still a venue somebody dressed. It carried a
     whole mechanism with it: a line the rider was locked onto, a state the
     physics had to hold them in, a friction constant, a catch test, a scoring
     event, and a stretch of mountain that had to be *told* it was special.
     Every one of those is a rule the mountain did not need.

     What is left is a mountain. Air comes from curvature, which is everywhere
     and never the same twice; the only thing on the piste with a name is a
     slalom gate, and the only thing it asks is whether you went through it.
     Nothing here builds snow or steel any more. */
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

  /* Deer and wolves, which are the third kind of animal on this hill and
     want saying out loud because the first two set a pattern they break.

     A rabbit is scenery that reacts to you. A bear is a hazard. Both are
     *about* the rider — they exist inside the fifteen or twenty metres where
     the rider can affect them, and if you never went near one it would have
     been wasted. These are the opposite: they live out past the trees, they
     are never collided with, they are never scored, and the rider cannot
     reach them without leaving the run. What they are for is the thing a
     mountain has that a racetrack does not, which is somewhere else — a
     hillside with something living on it that is not interested in you.

     That is why the offsets are so large. Sixty to a hundred and thirty
     metres puts a herd out beyond the treeline and up the containment wall,
     which is exactly where it is visible over the forest and exactly where
     nobody is riding. Bringing them closer was tried first and it is wrong
     twice over: they read as obstacles the player is trying to avoid, and
     they stop being somewhere else.

     Deer are the common one and stand in groups, because a single deer is a
     lost deer. Wolves are rare, travel in file, and are further out again —
     a pack crossing a distant shoulder is worth ten times a wolf you can see
     the eyes of, and it is the only thing on this mountain that is meant to
     be watched rather than looked at. */
  deer: 5,                  // pool size, and the largest a herd can be
  deerHerd: [2, 5],
  deerFrom: 260,            // metres before the first herd
  deerChance: 0.62,
  deerRespawn: [9, 24],
  deerSpawnRange: [130, 280],
  deerOffset: [58, 132],    // beyond the corridor edge, either side
  deerSpread: 13,           // how loosely a herd stands together
  deerSpeed: 5.2,           // trotting off, once it has noticed the rider
  deerNotice: 62,

  wolves: 4,
  wolfPack: [2, 4],
  wolfFrom: 900,
  wolfChance: 0.30,
  wolfRespawn: [34, 80],
  wolfSpawnRange: [170, 320],
  wolfOffset: [86, 200],
  wolfFile: 3.4,            // metres between one wolf and the next in the line
  wolfSpeed: 3.6,
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
  /* Fixed lag creates a large positional error near the 250 m/s speed limit:
     a first-order chase trails by roughly speed / lag. Preserve the weighted
     normal-speed camera, then tighten only as needed to keep the rider within
     a small, readable envelope at extreme speed. Air is allowed more float,
     but never the hundreds of metres a fixed five-hertz response would lose. */
  maxFollowError: 4.0,
  maxAirFollowError: 7.0,
  /* Share of the rider's carve the camera takes on. It came down when the
     lean stopped being cosmetic: `rider.roll` is now the true balance angle
     and reaches fifty degrees at the limit of grip, where the old constant
     topped out at thirty — so the same fraction was tilting the horizon half
     as far again as it was tuned to. Past about ten degrees this stops
     reading as lean and starts reading as a broken horizon. */
  roll: 0.12,
  shake: 0.55,
  // A tuck keeps some shoulder-camera focus without undoing the wider speed lens.
  tuckFov: -2,
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
  /* The pool the edge plume, the rooster tail and every impact burst share.
     It went up by four hundred when the tail arrived and not by more: a
     curtain of snow is made of a few hundred particles that are *large, soft
     and long-lived*, not of thousands of dots, and the ring is deliberately
     tight enough that a landing burst still recycles the oldest of them
     rather than being refused. */
  sprayCount: 1300,
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

   A twenty-five-lane section laid down at the contact point, following the ground
   and fading out behind. It is the one thing on screen that records what the
   rider *did* rather than what they are doing, and on a mountain made of one
   colour it is most of what makes a carve legible as a carve: the arc is
   still there to look at a second after it was ridden.

   Width comes from the board's projected swept footprint, so a railed turn
   stays board-width while a transverse speed check churns a broad berm. */
export const TRAIL = {
  samples: 540,       // 151 m of mark at the spatial interval below
  spacing: 0.28,      // metres between sections, independent of frame rate
  maxCatchup: 16,     // bounded high-speed sections added in one render frame
  width: 0.155,       // exact half-width of the 31 cm board; berm sits outside
  slideWidth: 1.0,    // swept board and berm during a full braking sideslip
  lift: 0.020,        // clearance budget; the packed basin spends most of it
  life: 16.0,         // old snow persists; only the fixed ring limits history
  opacity: 0.82,
};

/* Streaks: short white lines that whip past the camera once the run is
   genuinely quick. They cost almost nothing, they only ever appear above a
   speed the rider had to earn, and they are what turns fast into *fast*. */
export const STREAKS = {
  count: 220,
  from: 26,           // m/s before any appear
  full: 44,           // and where the field is at its thickest
  length: 0.11,       // share of a streak's own velocity, per unit speed
  maxLength: 22,      // metres — infinite W speed must not become white bars
  radius: 13,
  ahead: 22,
};
