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

Motion is one entrance, quiet scroll reveals, and Conway's Life running
behind the hero at one generation every 1.5s. The board wraps on a torus
and takes a glider every ninth generation — and whenever it settles into
still lifes or blinkers — so it never stalls. Cells arrive gold and cool to
mint. It parks itself when the hero scrolls away or the tab loses focus,
and never starts under `prefers-reduced-motion`.

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
