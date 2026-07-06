# protocodus.github.io

Protocodus company website — software for startups, built with care.

## Stack

Static site, no build step and no runtime dependencies:

- `index.html` — single-page site
- `assets/css/style.css` — design system (Space Grotesk + Space Mono, self-hosted in `assets/fonts/`)
- `assets/js/main.js` — vanilla JS: mobile menu, scroll reveals, hero typewriter, spark parallax and click bursts

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
