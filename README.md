# protocodus.github.io

Protocodus company website — software for startups, built with care.

## Stack

Static site, no build step and no runtime dependencies:

- `index.html` — single-page site
- `assets/css/style.css` — design system (Space Grotesk + Space Mono, self-hosted in `assets/fonts/`)
- `assets/js/main.js` — vanilla JS: entrance sequence, scroll reveals, mobile menu, and the yellow rule that marks the section you are reading

## Design

Ink on paper, hairline rules, and a lot of air. Everything sits on one grid:
a margin rail for section labels, then a content column that splits in two —
headline against supporting line, capability against description. The rail
and the split hold from the hero's loop row all the way to the footer.

Colour is an accent, never a backdrop: yellow marks position (the current
section in the nav, the email link, the steps of the loop), mint marks
sequence and the accents in the dark section. One dark section carries the
contrast; the rest is paper.

Motion is one entrance and quiet scroll reveals. Nothing loops or moves on
its own. Without JavaScript the page renders complete; `prefers-reduced-motion`
turns the transitions off.

## Development

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
