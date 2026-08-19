# protocodus.github.io

Protocodus company website — software for startups, built with care.

The site is two pages sharing one document. The **voyage** is the front
door: an immersive 3D flight around the company's orbital HQ, with the
sections of the site as waypoints. The **classic page** is the same
document without the canvas — and it is not a degraded voyage, it is the
original site, kept whole as the fallback and reachable any time via TEXT
mode.

## Stack

Static site, no build step and nothing fetched at runtime:

- `index.html` — single-page site; the voyage chrome (canvas, boot
  terminal, HUD) is inert markup until the page proves it can carry it
- `assets/css/style.css` — design system (Space Grotesk + IBM Plex Mono,
  self-hosted in `assets/fonts/`); everything the voyage adds hangs off
  `html.voyage` in one appended layer, so the classic rules above it are
  untouched
- `assets/js/main.js` — the page script: the gate that decides which page a
  visitor gets, plus entrance sequence, scroll reveals, the mobile menu,
  the spine dash, HUD wiring and warp navigation
- `assets/js/boot.js` — the boot terminal (glyph rain, typed wake-up log, a
  progress bar that only moves when something real finished)
- `assets/js/life.js` — Conway's Life behind the classic hero, unchanged,
  now a module the voyage never loads
- `assets/js/voyage/` — the 3D layer (see below)
- `fun/` — the games (see below)
- `assets/vendor/three/` — three.js r185, vendored rather than pulled from
  a CDN, so the site still has no third-party requests

Everything degrades, deliberately and in layers. The voyage requires
JavaScript, WebGL, motion being welcome and no standing request for text
mode — fail any test and the classic page renders exactly as it always
did, Conway's Life and all. No JavaScript at all still renders the complete
document. If the flight software dies mid-load, or a machine turns out
unable to hold a usable frame rate even at reduced resolution, the page
drops itself back to classic for the rest of the session and says so in
the boot log. The games are the exception and say so — a 3D game without
JavaScript is a paragraph explaining that it needs JavaScript.

## The voyage

One WebGL canvas behind the whole document: a massive orbital station — a
spindle on the vertical, two counter-rotating habitat tori with their own
revolving windows, three docking cradles, a forge arm where a hull sits
half-built in a lit scaffold (solid at the bow, wireframe at the stern —
shipping one release at a time, drawn literally), and a signal spire with
a slow dish. A ringed planet owns a corner of the sky, its cities faded in
across the terminator by the same sun that lights the hull. Ships jump in
at a hyperspace gate, cruise curved lanes to the cradles — holding pattern
round the station when the cradles are full — berth, leave, and jump out
again; two liners cross the deep background and never dock. Below it all
waits the abyss: a pocket of true dark where bioluminescent medusae pulse
on their own slow clocks amid marine snow, which is where the games live.

Scrolling flies the camera between waypoints threaded on a Catmull-Rom —
each section's real scroll position is its waypoint, so a layout change
moves the flight plan without anyone touching a number. On top of the
spline ride an idle orbital drift (the station wheels slowly past even
when nobody scrolls), a lean toward the pointer, and drag-to-look that
eases back home. Clicking a nav link is a warp jump: streaks, a field-of-
view kick, dimmed stars, one long eased scroll. The HUD frames it in IBM
Plex Mono — zone name, stardate, velocity, heading, a rail down the spine
with the ship marker riding scroll progress — and holds the two controls
that matter: SND (a synthesised drone, opt-in, no samples) and TEXT (the
way out, remembered).

It boots like a ship: a wall of falling glyphs, a typed wake-up log with
one nod per franchise the site owes a debt to, a progress bar whose stages
are real (the import graph landing, the world built, the first frame
rendered), and ENGAGE — which lifts the curtain on a capital ship passing
overhead, close enough to read its belly windows, before it stretches and
jumps. Every texture is painted into a canvas at load time; there is no
model file and no fetched asset anywhere in it.

The scene budget is honest about phones: half the crowds and a capped
pixel ratio on coarse pointers, an adaptive governor that trades buffer
resolution for frame time on any machine slower than its class, additive
sprites instead of postprocessing for every glow, and points — one draw
call a cloud — for every window on the station. The tab pausing, the
curtain, and `prefers-reduced-motion` never reaching the voyage at all are
the same rule at three scales: nothing runs that is not being watched.

## Design

Ink is the ground for the whole page, and the palette's two colours carry
separate jobs. **Mint marks structure and anything you can act on** — the
`//` tags, the section index, a card's edge on hover, the arrows in the
process line. **Yellow marks emphasis and craft** — the primary button, the
facts, the beats of the loop. They never land on the same element. Paper
appears exactly once, at the end, where the page makes its one ask.

Depth comes from three tints of the ground (`#131313` well, `#212121` panel,
`#282828` lift) rather than borders and shadows. The logo runs at page scale:
mint brackets close around the hero statement, and the spark ends the
sentence. Navigation is a fixed spine down the left edge, which frees the
full width for content.

Type has no middle ground on purpose, and only one family: Space Grotesk at
display sizes with tight tracking, and the same face at 0.72–0.8rem in a
heavier weight with wide tracking for every label, number and control.

The footer sets the company record on the same three columns the brand row
uses, and the column count is pinned rather than fitted — six entries then
always land as a full rectangle, 3×2 or 2×3 or 1×6, and no row ever ends in
a hole. Left to `auto-fit` the same grid would happily put five across and
strand the sixth underneath.

Motion is one entrance, quiet scroll reveals, and Conway's Life running
behind the hero at one generation every six tenths of a second.

The rule is QuadLife. Births and deaths follow Conway exactly, so the
dynamics are the ones known to stay interesting, but every live cell also
carries a species, drawn as one of the four cursors every terminal has ever
offered: the block, the hollow block a window wears when it loses focus, the
underline, and the bar. A cell born to parents of two or fewer species joins
the majority; a cell born where three *different* species meet becomes the
fourth, which is the only way a species that has died out can return. So the
cursors are inheritance rather than decoration, and territories visibly
overrun one another. Every newborn is a block cursor at its brightest for one
generation, before settling into the shape it inherited.

They are drawn as shapes rather than glyphs, so the field owes nothing to a
webfont and nothing to a fallback.

The four species are also four distances. Going down the list they get
sharper, lighter, larger and more responsive to the pointer, so the field
reads as four planes rather than four symbols on one: a blurred block sits
far back and barely moves, a crisp bar sits in front and swings past it. Each
shade is derived from `--mint`, brightest of all for a newborn, so the field
never reaches for a second hue.

The bloom is rasterised into each sprite at build time, which is what makes
per-species depth of field free — a cell is still one image blit no matter
how wide its halo.

The lattice also breathes: its pitch opens and closes by 8.9% about the centre
of the hero over eighteen seconds. The board is sized for the tightest it ever
gets, so neither the breath nor the drift nor the parallax can uncover an
edge.

Over the whole thing sit scanlines — one dark line every 5px at 13%, static
and never rolling, since a drifting scanline is the part of the CRT look that
gives people headaches. They render above the field and below every word on
the page, so nothing legible is touched.

Under the statement sits a pool of shadow, a soft radial darkening of the
ground exactly where the largest type is: the title gains contrast and the
field loses none of its reach. It hangs off the statement rather than off the
hero, because the title's centre falls two fifths of the way down the hero at
desktop and under a quarter of the way at phone widths, so any figure measured
from the hero would be right at one size and wrong at the other.

Every constant in the field is a Fibonacci number, or one over a power of ten:
21px between cells, 610ms to a generation, 17711ms to a breath, and an 8×13
cursor that is a golden rectangle by accident of the same rule. The sequence
has no bearing on Conway's — it makes no claim to. It is that a screen full of
tuning constants wants some reason to hold the values it holds, and one
arbitrary rule applied honestly is easier to trust, and to revisit, than a
dozen numbers each nudged separately until they looked about right.

Conway is deterministic, which is the one thing a background cannot be: watch
it long enough and it visibly repeats. Two small probabilities prevent that —
an empty cell occasionally ignites on its own, and a newborn occasionally
ignores what it inherited. Both are slight enough that the rule still reads
as Life.

The board wraps on a torus and takes a glider every thirty-fourth generation —
and whenever a hash of it repeats one of the last four, which catches both
still lifes and blinkers — so it never stalls. Sampled twice a second for
twenty seconds, its population ranged 17k-55k lit pixels and never repeated a
figure, across about 3% of the canvas.

Every cell crossfades across its whole generation, so the field is never
holding a frame, and the lattice wanders on two slow sines while leaning a
little towards the pointer, arriving late and settling rather than tracking.
Each cursor is rasterised once with its bloom already in it, so a cell costs
one image blit: no shape building, no fill-style changes, and no second
blurred pass. It parks itself when the hero scrolls away or the tab loses focus, and
never starts under `prefers-reduced-motion`.

## Fun

`/fun/` collects the things built between projects. Each game is a directory
of its own with its own stylesheet and its own entry point, sharing only the
typeface, the palette and the vendored copy of three.js. Nothing is
cross-imported, so a game can be deleted by deleting its folder.

The section on the home page and the page at `/fun/` list the same games from
the same markup — the section is the front door and `/fun/` is there because
people will type it.

### Alpen

An endless snowboard run down a procedurally generated mountain: late-nineties
console art direction executed with precision that hardware never had.

**The mountain is a function.** `heightAt(x, z)` is a grade that varies along
the run, four octaves of value noise — two of them domain-warped — a corridor
whose centre line wanders and periodically forks in two around an island, and
a wall outside it. There is no terrain data anywhere: the rider stands on that
function, kickers are added to it, trees are planted on it, and the mesh is
only ever a picture of it. Props are generated forty metres of hill at a time,
seeded from the band's own index, so the same stretch always grows the same
forest and nothing has to be remembered behind the rider.

Everything that rises is spent out of one budget. A roll's uphill face must
never out-climb the mountain it sits on, or the gentle chapters contain real
uphill and a rider who arrives slowly stops in the middle of a descent — so
every octave's steepest face, summed, stays under the *shallowest* grade the
run ever reaches. What launches a rider is curvature rather than height, and
curvature goes as amplitude times wavenumber squared, so the air comes from
short wavelengths: hashed knolls whose height is a ratio of their radius and
whose downhill half is compressed, whose lee side therefore falls away faster
than gravity can follow it. Nothing special-cases them; they are simply hills
shaped like something worth hitting.

**You cannot leave the piste.** Outside the groomed part the ground rises into
a quarterpipe with a real lip to launch off and then into a wall that keeps
climbing for ever. Crossing it would take more kinetic energy than the game
can produce. There is no barrier and no invisible wall — the ground outside
the run is monotonically uphill, so gravity is always pointing home.

The flanks are fluted. Everything else out there varies *along* the run — the
breadth of the wall, two long shoulders, a buttress — which is why they read
as two poured ramps from inside the piste: a term that changes over hundreds
of metres of descent does not change at all in the frame. What actually covers
a steep snow flank runs the other way, straight down the fall line, cut by
every sluff and point release that has come off it since November. The
channels are as deep as the square of how steep the wall is, so they are
nothing at the lip, nothing on the plateau and deepest across the face between
— which is both what a slide does and what keeps the containment intact,
because the ratio between a channel's steepest wall and the mountain's is a
constant rather than an amplitude somebody has to re-check.

The square is the part that took a second attempt, and it is worth writing
down because the first attempt looked complete. Scaling by the steepness bounds
the *carrier's* slope and says nothing about the amplitude's own arrival: a
ramp that brings the channels in over ten metres contributes about their depth
over that ten metres — a constant — against a wall gradient that goes to zero
linearly at the lip. So there is always a band just past the lip where the
arrival out-climbs the mountain, and there was one: a stretch of flank seven
metres out measured +0.11 without the channels and −0.02 with them, a pocket in
ground whose entire job is to be uphill. Squared, the amplitude is quadratic in
the distance past the lip and its derivative is linear, the same order as the
wall's, so one constant covers the arrival and the carrier together. Swept at
25 cm across both flanks over thirty kilometres of run — 28 million samples —
the worst outward slope and the deepest pocket are now the ones that were
already there.

The snowpack then paints them for free: crests scour to rock, hollows fill with
drift, and a flank comes out striped the way a real one is.

**The rider is a velocity vector on a surface**, not a speed along a track,
and most of how the game feels falls out of that. Gravity is resolved on the
slope tangent, so riding up a bank costs speed and gives it back on the way
down without a line of code saying so.

The board turns because it has a **sidecut**: tilted onto one edge, the arc
that edge describes is the path it is obliged to follow, `R = sidecut /
sin(edge)`. Holding that radius needs `v²/R` of grip, so the same edge angle
that draws a clean arc at 40 km/h asks four times as much of the snow at 80 —
and the rider discovers on their own that a fast line has to be a wide line,
instead of being told so by a cap on the turn rate. The rider's lean is the
balance angle that falls out of it, and the gap between the lean a turn
demands and the lean the body has managed *is* balance: it costs grip in
proportion, and enough of it for long enough puts them down. Below walking
pace the sidecut has no authority at all, so the board is skidded round
instead — which is what anybody does, and without it a held carve ends
sideways and motionless with no way back to the fall line.

The legs are a damped spring, so a landing drops the camera and lets it back
up, and pumping a roller works without pumping having been written.

**Nothing triggers a jump.** Every step projects the ballistic path ninety
milliseconds forward and asks where the ground will be there; if the hill has
dropped out from under it, the rider is in the air with whatever vertical
speed the ground was handing them. A kicker's lip, the crest of a roller, the
top of a wall and the edge of a cliff all launch by the same rule, and all
launch harder the faster you were going — the vertical they hand over is
whatever the ramp built up, which is proportional to the speed that arrived.
The horizon is the whole trick, and it has to be the *minimum* over the path
rather than one sample at its end: ninety milliseconds at 45 m/s is further
than a small kicker is long, so a single sample was already past the lip the
moment the rider touched the ramp and threw them from the bottom of it having
climbed none of it. Sampled properly, while any part of the ramp still stands
above the ballistic arc the hill has not dropped away, and the launch happens
at the lip and nowhere else.

Kicker length is solved from the local grade rather than fixed, so every ramp
on the mountain throws at the same angle above whatever it is built on. Built
kickers are rare; most of the air comes from the ground.

Falling over is the only failure and it is temporary. The run does not end. A
fall is a ballistic body rather than a timer — the speed that went into the
tree comes back out as height and tumble, and the rider is airborne until the
snow has finished with them, so a spill at walking pace is over in a second
and catching a trunk at 150 km/h throws you a long way down the hill.

**The look** keeps the era's colour and geometry and drops its resolution
limit. Five bits a channel through a 4×4 Bayer matrix is what an RGBA5551
framebuffer held and how those machines hid it — without the dither a
snowfield at five bits is a contour map, and with it, it is grain — over
quantised five-band diffuse, flat facets and vertex snapping that fades out
with distance so the horizon does not shimmer. On top go the things the
hardware could not: bloom, crepuscular rays marched towards the sun's screen
position, a highlight shoulder so lit snow rolls off instead of clipping flat,
velocity blur, and fog that resolves toward whatever the sky shows in *that*
direction so a ridge to the west dissolves into the sunset. All of it happens
before the quantise, so it is dithered down to five bits with everything else
and never looks like a filter over an old picture.

Snow is the hardest thing in graphics to light — one colour, filling the frame
— so it is never white: glacier blue in shade, warm only where the low sun
lands, with the corduroy painted per pixel from world coordinates and faded by
how much ground a pixel covers, because a rib every metre and a half seen at a
grazing angle beats against the pixel grid and throws moiré across the hill.
The rider is high-vis orange, because it is the one colour snow never is.

Every one of those fades is individually correct and together they used to
leave four hundred metres of mountain with nothing on it at all: the corduroy
goes at 38 m, the snow plates' relief at 90, their tone at 180, and the
geometry's own wind octaves whenever the graded grid's cells outgrow them. Past
that the ground was a sheet of paper, which on a surface filling two thirds of
the frame is the loudest thing in the picture. So the same wind relief carries
on analytically at the one scale still worth resolving out there — drift lines
about eight metres apart, stretched a hundred down the prevailing wind, on the
same axes the geometry uses so the near ground and the far ground are one
surface described twice rather than two meeting at a ring. Sines rather than a
plate, because a sine has an exact derivative and this is spent entirely as a
normal; ridge lines bent by their own long axis so they braid instead of
combing; and one slow field deciding where the wind has actually worked. On the
piste it is a different surface for the same reason it is a different surface
up close: what a groomed slope shows at two hundred metres is not corduroy, it
is the seams between the machine's own passes, five metres apart and bending
with the route.

The rider is cloth. The rig was lofted well enough that its silhouette and its
shadow were right, and it still read as one continuous piece of moulded
plastic, because it was one continuous piece of smooth geometry with one flat
colour on it. A shell jacket is a stack of down-filled tubes stitched across
the body every nine centimetres, so the baffles run along each garment's own
local axis — the torso stands up its Y and every limb hangs down its Y from
its joint, so one expression puts bands across the chest and rings around the
sleeves, and they stay welded to the garment through every pose. Woven fabric
also scatters a light into a wide soft band at grazing incidence, which is why
a shoulder goes pale in a photograph while the chest stays saturated, and no
amount of the lacquer highlight the board wears produces it. The trousers get
the sheen and not the baffles, because snowboard trousers are a smooth shell —
and because a strong ripple against a sixteen-sided tapered tube is a moiré
waiting to happen, so the honest fix and the correct one were the same fix.

The read-out is a second canvas holding the same buffer as the world, so a HUD
pixel and a snow pixel are the same square by construction. That is why there
is no typeface: every glyph is a hand-drawn 5×7 bitmap with a one-pixel
outline, in `js/font.js`.

**Time of day and weather are three continuous dials.** The first runs a full
day in fifteen minutes through seven interpolated moments; the second drifts
on slow noise from clear air to a whiteout, pulling every colour towards the
haze and the fog in from four hundred metres to seventy; the third is an
aurora, and on most nights it is not there at all. Dials rather than a list of
skies is what makes a blizzard at dusk look like dusk.

Physics runs on a fixed 120 Hz step and everything else per frame, so a jump
is the same size on every machine.

**A grab is one reach and there are three of them**, chosen by where the weight
already is rather than by two more keys. W folds the body forward and the hand
reaches past the binding for the nose; S sits it back, the knees come up behind
and the trailing hand takes the heel edge in a method; neither, and the hand
drops onto the toe edge between the feet, which is an indy and is what a hand
does when you do not tell it anything. Each pays for how far out of shape you
had to get to hold it. The same two modifiers turn E's backflip into a
frontflip, because they mean forward and back everywhere else in the game.

And a spin taken past the vertical is named as one trick rather than two. A
rider who flips inside a spin has not done a rotation and then another one —
they have done a single rotation about a tilted axis, which is much harder to
see out of and which the sport has its own words for. A backward flip in a
backside spin is a cork and in a frontside spin is a rodeo; a forward flip
either way is a misty; two flips make it a double. Written as "BACKSIDE 720 +
BACKFLIP" the read-out was describing the keys that were pressed.

**On the snow, Q presses.** Everything the game scores used to happen in the
air, and a third of the run is deliberately a plain — a long open pitch with
nothing in the way, so that the next rough chapter means something. Standing on
one end of the board is what anybody does with that, and it is a real mechanic
rather than a pose, because lifting one end genuinely changes three things this
model already has. Half the effective edge is in the air, so the grip collapses
and a press held through a hard carve washes out on its own. With nothing
buried at the back there is nothing to resist a rotation, so the rule that a
board may never point more than sixty degrees off its own travel — which is
exactly the rule a butter is defined by breaking — opens with the pressure, and
when the board passes ninety the leading end has genuinely changed and the
rider comes out switch. And it ploughs, because a butter is a slow trick
everywhere it has ever been done.

There is also a carve trail, a terrain park with rails to slide, refreshment
huts that glow at night and pay out for stopping in for a cocoa, a rescue
helicopter that spotlights the next animal when it is dark, and — rarely — a
bear.

Controls are A/D to carve and to spin, W to tuck, S to brake, space held to
load the legs and released to pop at the lip, Q to grab or to press and E to
flip, with W and S choosing which. They are listed permanently on screen.
`window.__alpen` is a debug hatch: every tunable is a plain object on it, and
`__alpen.debug()` prints the run.

**The title card waits for the mountain.** The opening horizon cache is a
quarter of a million probes marched on the main thread and the world's shaders
are the sort of thing a driver can take most of a second over, and all of it
used to run as one synchronous block — measured at two and a half seconds on a
slow machine, during which the browser cannot paint, cannot respond, and cannot
show a loading bar that would have been the whole point of having one. None of
that work got faster; it happens in three pieces with a paint between them, so
the read-out can name the piece that is running. The four stages are real
things finishing rather than a bar animating on a timer, and the invitation to
drop in arrives when the mountain is actually on the screen. The first stage is
tracked by the page's one inline script, because a module cannot report its own
arrival — only its successor can, and on a cold cache the arrival is the
longest stage of the four.

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
