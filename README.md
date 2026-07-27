# protocodus.github.io

Protocodus company website — software for startups, built with care.

## Stack

Static site, no build step and nothing fetched at runtime:

- `index.html` — single-page site
- `assets/css/style.css` — design system (Space Grotesk, self-hosted in `assets/fonts/`)
- `assets/js/main.js` — vanilla JS: entrance sequence, scroll reveals, the mobile menu, the mint dash in the spine that marks the section you are reading, and Conway's Life behind the hero
- `fun/` — the games (see below)
- `assets/vendor/three/` — three.js r185, vendored rather than pulled from a CDN, so the site still has no third-party requests

Everything degrades: without JavaScript the page renders complete, and
`prefers-reduced-motion` drops the animation down to nothing. The games are
the exception and say so — a 3D game without JavaScript is a paragraph
explaining that it needs JavaScript.

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

There is also a carve trail, a terrain park with rails to slide, refreshment
huts that glow at night and pay out for stopping in for a cocoa, a rescue
helicopter that spotlights the next animal when it is dark, and — rarely — a
bear.

Controls are A/D to carve and to spin, W to tuck, S to brake, space held to
load the legs and released to pop at the lip, Q to grab and E to flip. They
are listed permanently on screen. `window.__alpen` is a debug hatch: every
tunable is a plain object on it, and `__alpen.debug()` prints the run.

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
