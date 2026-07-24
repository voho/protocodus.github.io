# protocodus.github.io

Protocodus company website — software for startups, built with care.

## Stack

Static site, no build step and no runtime dependencies:

- `index.html` — single-page site
- `assets/css/style.css` — design system (Space Grotesk + Space Mono, self-hosted in `assets/fonts/`)
- `assets/js/main.js` — vanilla JS: mobile menu, scroll reveals, current-section marker in the navbar, hero typewriter, spark parallax, click bursts, and a canvas "living dot grid" background (ambient shimmer, pointer halo, click ripples; falls back to a static CSS pattern without JS or with reduced motion)

Everything degrades: without JavaScript the page renders complete, and
`prefers-reduced-motion` drops the animation down to nothing.

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
