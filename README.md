# protocodus.github.io

Protocodus company website — software for startups, built with care.

## Stack

Static site, no build step and no runtime dependencies:

- `index.html` — single-page site
- `assets/css/style.css` — design system (Space Grotesk, self-hosted in `assets/fonts/`)
- `assets/js/main.js` — vanilla JS: entrance sequence, scroll reveals, the mobile menu, the mint dash in the spine that marks the section you are reading, and Conway's Life behind the hero

Everything degrades: without JavaScript the page renders complete, and
`prefers-reduced-motion` drops the animation down to nothing.

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

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
