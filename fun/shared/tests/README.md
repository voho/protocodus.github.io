# Puzzle checks

Run these from the repository root:

```sh
node fun/zipper/tests/puzzle-check.mjs
node fun/patcher/tests/puzzle-check.mjs
node fun/patcher/tests/board-render-check.mjs
node fun/patcher/tests/clue-layout-check.mjs
node fun/zipper/tests/board-render-check.mjs
node fun/zipper/tests/input-batching-check.mjs
node fun/shared/tests/hint-interaction-check.mjs
node fun/shared/tests/pointer-interaction-check.mjs
node fun/shared/tests/theme-check.mjs
node fun/shared/tests/shell-check.mjs
node fun/shared/tests/stage-check.mjs
```

The checks cover seeded solvability and uniqueness, difficulty grading, fixed
rendering buffers and cleanup, non-mutating hints, fast pointer samples, touch
ownership, reversible rectangles, corner taps, cancellation, replay timing,
scenery contrast and daily seeds, and the active-play clock. Stage checks use
a fake clock and real Three.js camera math to verify the fixed slight tilt,
framing and picking, sleeping idle scheduler, prompt input wakeups, static
shadow invalidation and background/reduced-motion suspension. These scheduling
checks do not claim hardware-specific frame rates or CPU percentages. Clue
layout checks cover horizontal spacing for tall clues, vertical spacing for
wide/square clues and safe margins against normal,
wide, tall and legacy font metrics, plus actual icon ink contrast across
all six theme palettes. `/fun/shared/tests/clue-sampler.html` previews the
clues on small phone keys, desktop keys and enlarged patches.

## Browser checks

The browser suite uses an existing Playwright installation. This static site has
no npm dependency requirement. If needed, install the test tooling outside the
repository:

```sh
npm install --prefix /tmp/puzzle-browser-check playwright
node /tmp/puzzle-browser-check/node_modules/playwright/cli.js install chromium firefox webkit
```

Start the site in another terminal from the repository root:

```sh
python3 -m http.server 8000
```

Then run:

```sh
PLAYWRIGHT_MODULE=/tmp/puzzle-browser-check/node_modules/playwright node fun/shared/tests/browser-check.mjs
```

If Playwright is already resolvable by Node, omit `PLAYWRIGHT_MODULE`. Optional
environment variables:

- `BASE_URL`: server URL; defaults to `http://127.0.0.1:8000`.
- `BROWSERS`: comma-separated engines; defaults to `chromium,firefox,webkit`.
- `QA_SCREENSHOT_DIR`: save a screenshot of every hard board after its checks.

The suite checks both games in desktop (1280×800), phone (390×844), tablet
(820×1180), and landscape phone (844×390) viewports. Desktop and phone cases solve
and reset an easy puzzle through keyboard/mouse or touchscreen inputs. Patcher's
mouse case deliberately overshoots then shrinks each rectangle. All cases check
help dismissal, loaded scenery, coverage, visible controls, hard-board framing,
and browser errors.

Phone and tablet contexts enable touch and verify the coarse-pointer rendering
branch. Chromium and WebKit also enable mobile viewport behavior. Firefox does
not support Playwright's `isMobile` flag, so its mobile cases use touch, device
pixel ratio, and viewport emulation with desktop Firefox viewport behavior.
These checks run actual browser engines, but do not substitute for physical
device testing, GPU performance measurements, or Safari/Chrome browser UI tests.
