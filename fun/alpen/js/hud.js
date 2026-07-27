/* The read-out, as a second framebuffer.

   This used to be DOM over the canvas, and the reasoning was sound at the
   time: the world was 288 lines and the text was not, so the text stayed
   crisp. Then the world went back to a buffer with a big, fixed pixel, and
   that argument inverted. A HUD drawn by the browser is drawn at the panel's
   resolution — its pixels a fraction the size of the snow's, its curves
   anti-aliased, its type a real typeface with real hinting. Next to a
   mountain made of hard square pixels that does not read as crisp. It reads
   as a different piece of software sitting on top of a game.

   So the HUD is a canvas of its own now, holding exactly the renderer's
   buffer and stretched across exactly the same box, which makes a HUD pixel
   and a snow pixel the same square by construction rather than by
   arithmetic. That is the entire design decision, and everything else here
   follows from it — including the fact that there is no typeface, because
   there cannot be one: see font.js.

   Nothing in the layout is a proportion of anything. No breakpoints, no
   clamp(), no vw units: the read-out is measured in buffer pixels and a wider
   window buys more mountain rather than smaller type. The one thing that does
   respond to the window is `UI` below, and it responds in whole steps, which
   is the only kind of response an integer grid has. The old stylesheet had
   four media queries trying to keep the read-out off a small screen and all
   four are gone; the judgement they were actually making — is there room for
   the control legend — is a subtraction in `draw` now, measuring the thing it
   cares about instead of guessing at it from the width of the window.

   Colours are quantised to five bits per channel on the way in, the same
   R5G5B5 the world's dither is aiming at, so the HUD is not sitting in a
   wider gamut than the picture it is drawn on. It costs one function and it
   is the difference between a HUD that belongs to the frame and one that is
   merely over it.

   What has not changed is the discipline: the HUD only ever states what the
   physics already did. Speed is the length of the velocity vector, the charge
   bar is the leg spring, the trick line is the rotation actually accumulated.
   Nothing in here is decided here.

   One thing did survive the move out of the DOM. The old file's third reason
   for being DOM was that a screen reader got a running score for free, and a
   canvas gives nothing away. There is a visually hidden paragraph, refreshed
   once a second, that keeps the score, the best and the speed reachable. It
   is not announced — that would be unbearable at one update a second — it is
   simply there to be read. */

import { drawText, measure, ADVANCE, GLYPH_H, LINE } from './font.js';

/* The nominal picture: the shape this layout was drawn against, and what the
   buffer is until main.js says otherwise. Deliberately not read from
   config.js — the HUD's contract is with the renderer's actual buffer, which
   arrives through `setSize`, and a second opinion sourced from somewhere
   else is precisely how the two end up disagreeing. */
export const HUD_WIDTH = 640;
export const HUD_HEIGHT = 360;

/* …and the size this buffer is actually running at, which is not always that.

   The world buffer is a 640×360 *picture*, not a 640×360 rectangle: what is
   fixed is the size of a pixel, and the buffer then grows to whatever that
   pixel size divides the window into, so an ultrawide monitor gets more
   mountain rather than black bars. The read-out has to be the same buffer or
   the two do not line up — so the layout is anchored to these, which main.js
   keeps in step with the renderer, and every measurement below is taken from
   an edge or the centre rather than from an absolute coordinate. */
let W = HUD_WIDTH;
let H = HUD_HEIGHT;

/* Ten pixels of air on every edge. A 1997 console assumed a CRT would eat
   the outside few per cent of the picture, and while nothing here is going
   to a CRT, the habit is the reason HUDs of the period sit inset rather than
   flush — and it still looks right. */
const MARGIN = 10;

const BANNER_HOLD = 1.9;    // seconds a trick name stays up

/* How big a buffer pixel actually is on screen is not the HUD's decision and
   not a constant. The renderer picks the largest whole number of device
   pixels that lets the base picture fit and then makes the buffer whatever
   that divides the window into — so a desktop gets six device pixels per
   buffer pixel and a phone held upright, where not even one and a half will
   fit, gets one. At one, a five pixel capital is five device pixels tall,
   which on a 2× panel is two and a half CSS pixels. That is not small type.
   It is not type.

   So the whole read-out is drawn at a whole-number scale of its own. Every
   position, gap, bar and glyph below is multiplied by it, and it is picked
   from two numbers that pull against each other: what legibility wants, and
   what actually fits.

   This was written, deleted and written again. It was deleted because at the
   time the renderer floored its buffer at the base picture, which made a
   doubled read-out provably impossible — a scale that is always one is not a
   scale. The floor is gone now (it was distorting the aspect ratio on a
   narrow window, which is a worse bug than a fine HUD), buffers can be any
   shape at all, and the case it was deleted for is the common one on a
   phone. The lesson recorded rather than the code: this is downstream of a
   renderer decision, so it is worth re-reading `retro.setSize` before
   trusting anything here about what buffers can exist.

   FOOT is what the layout genuinely occupies at 1×, which is much less than
   the base picture — the two top blocks side by side, and the bottom stack
   under them. Bounding the scale by the base picture instead was the first
   attempt and it never let the scale off 1, because a buffer big enough for
   640×360 twice over only happens on a window where the pixel was never 1. */
const FOOT_W = 330;
const FOOT_H = 170;

let UI = 1;
let PAD = MARGIN;
let RIGHT = W - MARGIN;
let BOTTOM = H - MARGIN;
let CENTRE = W >> 1;
let AIR_Y = MARGIN + 60;
let CHARGE_W = 120;
let CHARGE_H = 5;
let CHARGE_Y = H - 60;
let BANNER_Y = CHARGE_Y - 36;
let LIVE_Y = BANNER_Y - 16;

/* Two clusters, and which edge each is nailed to is the whole of how this
   survives a buffer that changes shape. The read-outs hang from the top
   corners, because they are a status bar. Everything to do with the trick in
   progress — the live name, the banner it becomes, the charge under it —
   stacks up from the bottom, because it belongs to the rider and the rider
   sits low in the frame. Extra height therefore opens up the empty middle,
   which is where the mountain is.

   The lower clamps are for a buffer so short that the two clusters would
   meet. They overlap rather than disappear, which is ugly and correct: on a
   letterbox slot of a window the read-out is still the read-out, and a
   negative coordinate is a bug however invisible. */
function geometry(w, h, pixel) {
  W = w;
  H = h;

  const dpr = window.devicePixelRatio || 1;
  const wants = Math.max(1, Math.round((2 * dpr) / Math.max(1, pixel || 2)));
  const fits = Math.max(1, Math.floor(Math.min(W / FOOT_W, H / FOOT_H)));
  UI = Math.min(wants, fits);

  PAD = MARGIN * UI;
  RIGHT = W - PAD;
  BOTTOM = H - PAD;
  CENTRE = W >> 1;
  AIR_Y = PAD + 60 * UI;
  CHARGE_W = 120 * UI;
  CHARGE_H = 5 * UI;
  CHARGE_Y = Math.max(PAD + 52 * UI, H - 60 * UI);
  /* The trick banner lives at the top of the frame, not the bottom.

     It used to stack up from the charge bar, on the reasoning that everything
     to do with the trick in progress belongs to the rider and the rider sits
     low in the frame. That is true of the charge bar, which is a read-out of
     the legs and wants to be near them — and exactly wrong for the banner,
     because the rider sits low in the frame *and the banner was landing on
     top of him*. A trick name is the one piece of the HUD that appears at the
     precise moment the player most needs to see the rider: mid-air, deciding
     whether the landing is coming. So it goes where nothing else is, which is
     the empty band across the top between the score and the speed. */
  BANNER_Y = PAD + 30 * UI;
  LIVE_Y = PAD + 54 * UI;
}

/* Snapping a colour to the 32 levels per channel an R5G5B5 framebuffer had.
   Written as a function over the intended hex rather than as pre-snapped hex
   so the palette below still says what it means. */
function q5(hex) {
  const n = parseInt(hex.slice(1), 16);
  const level = (v) => Math.round(Math.round((v / 255) * 31) * (255 / 31));
  return `rgb(${level((n >> 16) & 255)},${level((n >> 8) & 255)},${level(n & 255)})`;
}

/* The palette, and its one rule: structure and anything you can act on is
   mint, anything being earned is amber, and read-outs are a near-white that
   is never actually white — the same discipline the snow itself is under.
   INK is the outline every glyph carries, and it is what makes the whole
   thing legible over a white glacier at noon and a blue-black sky at
   midnight with no panel behind it. */
const MINT = q5('#00ffc3');
const AMBER = q5('#ffc400');
const SNOW = q5('#e6eefa');       // read-outs — blue-biased, never #ffffff
const QUIET = q5('#9db2cc');      // secondary read-outs
const DIM = q5('#63788f');        // labels that are only there to be found
const INK = q5('#060c16');        // the outline
const KEY = q5('#00b891');        // the legend's mint, one stop down
const LEG = q5('#7d90a8');        // and the legend's text

/* Banner tones. `near` reuses mint because a near miss is the game telling
   you that you did something on purpose, which is what mint means here. */
const TONES = {
  warn: q5('#ffd98a'),
  bad: q5('#ff8a6a'),
  near: MINT,
};

/* The permanent control legend, which used to be a <dl> in index.html and is
   drawn in the same bitmap font as everything else now — because a legend in
   a real typeface next to a read-out in a bitmap one is precisely the seam
   this whole rewrite exists to remove.

   The wording is tighter than the curtain's. The curtain has a paragraph's
   worth of room and explains; this is a reminder you glance at mid-run, and
   at six pixels per character a sentence is a wall. */
const LEGEND = [
  ['A D', 'CARVE · SPIN'],
  ['W', 'TUCK'],
  ['S', 'BRAKE'],
  ['SPACE', 'CHARGE · POP'],
  ['Q', 'GRAB'],
  ['E', 'FLIP'],
  ['ESC R M', 'PAUSE · RESTART · SOUND'],
];

const fmt = new Intl.NumberFormat('en-US');

export function createHud(root) {
  /* index.html declares the canvas next to #stage so the two-buffer idea is
     visible in the markup, but one is made here if it is not — this module
     owns its own surface either way. */
  const canvas = root.querySelector('canvas') || root.appendChild(document.createElement('canvas'));
  canvas.className = 'readout';
  canvas.setAttribute('aria-hidden', 'true');

  let ctx = null;
  const readout = root.querySelector('[data-readout]');

  let shownScore = 0;
  let bannerName = '';
  let bannerPoints = '';
  let bannerTone = SNOW;
  let bannerTimer = 0;
  let muted = false;
  let clock = 0;
  let sayIn = 0;
  let legend = null;

  /* ------------------------------------------------------------------------
     Fitting the window

     Everything the renderer measures is in device pixels, so everything here
     is too: `width` and `height` are the buffer, `pixel` is how many device
     pixels one buffer pixel occupies, and `offsetX`/`offsetY` are where the
     top-left of the picture lands — all four straight off `retro.setSize`.

     Only the first two are compulsory, and the backing store has to be that
     buffer exactly, because that is the whole premise: one buffer pixel here
     is one buffer pixel there.

     Where the element sits is deliberately *not* calculated when the picture
     fills the window, which is both offsets at zero and the case that
     actually runs. `.readout` fills its parent the same way `#stage` does,
     the two boxes are therefore identical, and the browser gives both the
     same nearest-neighbour blow-up. Working it out instead would be worse
     rather than equivalent: the buffer is `ceil(device / pixel)`, so it is up
     to one buffer pixel wider than the window it covers, and placing this
     canvas at exactly `pixel` device pixels each would leave it a fraction
     larger than the world canvas beside it. A seam of one pixel down the
     right-hand edge is precisely the failure this whole arrangement exists
     to avoid, and the way to not have it is to not do the sum.

     An offset means the picture is letterboxed, and then there is no shared
     box to inherit and it does have to be placed. That path converts to CSS
     pixels on the way out, because CSS is the one thing in the pipeline that
     does not think in device pixels.
     --------------------------------------------------------------------- */
  function setSize(width, height, pixel = 0, offsetX = 0, offsetY = 0) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    const wasUI = UI;
    if (w !== canvas.width || h !== canvas.height || !ctx) {
      canvas.width = w;
      canvas.height = h;
      // Writing the backing store size resets every piece of context state
      // there is, so the context is re-fetched and re-configured rather than
      // trusted to have survived
      ctx = canvas.getContext('2d', { alpha: true });
      ctx.imageSmoothingEnabled = false;
    }
    geometry(w, h, pixel);
    if (UI !== wasUI) legend = null;

    if (pixel > 0 && (offsetX || offsetY)) {
      const css = pixel / (window.devicePixelRatio || 1);
      canvas.style.left = `${offsetX / (window.devicePixelRatio || 1)}px`;
      canvas.style.top = `${offsetY / (window.devicePixelRatio || 1)}px`;
      canvas.style.width = `${w * css}px`;
      canvas.style.height = `${h * css}px`;
    } else if (canvas.style.width) {
      canvas.style.left = '';
      canvas.style.top = '';
      canvas.style.width = '';
      canvas.style.height = '';
    }
  }

  setSize(HUD_WIDTH, HUD_HEIGHT);

  /* ------------------------------------------------------------------------
     Drawing primitives — everything lands on whole buffer pixels
     --------------------------------------------------------------------- */

  /* Sizes are given in stops — 1 and 2 — and multiplied into buffer pixels
     here, in one place, so nothing below has to remember to do it. */
  const text = (s, x, y, colour, size = 1) => drawText(ctx, s, x, y, colour, size * UI, INK);
  const right = (s, x, y, colour, size = 1) => text(s, x - measure(s, size * UI), y, colour, size);
  const centre = (s, x, y, colour, size = 1) =>
    text(s, x - ((measure(s, size * UI) - 1) >> 1), y, colour, size);

  /* A centred line that is allowed to be any length, which the two in the
     middle of the screen are: a trick name is assembled from however many
     things the rider actually did, and the longest one the grammar can build
     is sixty-two characters. So the size steps down a whole stop at a time
     until it fits, and if even the smallest stop will not fit, the string is
     cut.

     Cutting is exact rather than approximate because the font is monospace,
     which is the first time that has bought anything: how many characters fit
     in a width is a division, not a search. And a hard cut is the right
     failure. Every alternative — wrapping, scrolling, scaling by a fraction —
     is either two lines where the layout has room for one, or a blurred one. */
  function centreLine(s, y, colour, maxSize) {
    const room = W - PAD * 2;
    let size = maxSize;
    while (size > 1 && measure(s, size * UI) > room) size -= 1;
    const fits = Math.floor((room + size * UI) / (ADVANCE * size * UI));
    centre(s.length > fits ? s.slice(0, Math.max(1, fits)) : s, CENTRE, y, colour, size);
    return size;   // so whatever goes under it knows how tall it turned out
  }

  /* The legend never changes, so it is drawn once into its own surface and
     blitted. It is over half the glyphs on screen and about two thirds of the
     fillRects the HUD would otherwise issue every frame, for a block of text
     that has said the same thing since the page loaded. A resize does not
     invalidate it unless the scale changed: moving it is a different corner,
     not a different picture. */
  function bakeLegend() {
    let keyW = 0;
    let descW = 0;
    for (const [k, d] of LEGEND) {
      keyW = Math.max(keyW, measure(k, UI));
      descW = Math.max(descW, measure(d, UI));
    }
    const gap = 7 * UI;
    const w = keyW + gap + descW;
    const h = (LEGEND.length - 1) * LINE * UI + GLYPH_H * UI;

    // A pixel of margin all round, because every glyph carries an outline
    // that sits outside its own cell
    const surface = document.createElement('canvas');
    surface.width = w + 2 * UI;
    surface.height = h + 2 * UI;
    const g = surface.getContext('2d');
    LEGEND.forEach(([k, d], i) => {
      const y = UI + i * LINE * UI;
      drawText(g, k, UI + keyW - measure(k, UI), y, KEY, UI, INK);
      drawText(g, d, UI + keyW + gap, y, LEG, UI, INK);
    });

    return { surface, w, h };
  }

  /* ------------------------------------------------------------------------
     The frame
     --------------------------------------------------------------------- */

  function draw(g) {
    ctx.clearRect(0, 0, W, H);
    const rider = g.rider;
    const line = GLYPH_H * UI;          // one stop of type, in buffer pixels

    // --- top left: what has been earned ---------------------------------
    text('SCORE', PAD, PAD, MINT);
    const scoreW = text(fmt.format(Math.round(shownScore)), PAD, PAD + 9 * UI, AMBER, 2);

    /* The combo used to grow by twelve per cent at five and up. There is no
       such thing as twelve per cent here, so it doubles instead: below five
       it is a small mint aside sitting on the score's baseline, at five it
       becomes a second number the size of the score and turns white. An
       integer grid does not do emphasis by degrees, and it turns out not to
       need to — the jump reads harder than the tween ever did. */
    const combo = Math.round(g.combo);
    if (combo > 1) {
      const label = `×${combo}`;
      const x = PAD + scoreW + 8 * UI;
      if (combo >= 5) text(label, x, PAD + 9 * UI, SNOW, 2);
      else text(label, x, PAD + 9 * UI + line, MINT);
    }

    const bestW = text('BEST', PAD, PAD + 28 * UI, DIM);
    text(fmt.format(Math.round(g.best)), PAD + bestW + 6 * UI, PAD + 28 * UI, QUIET);

    // --- top right: what the hill is doing ------------------------------
    right('SPEED', RIGHT, PAD, MINT);
    right('KM/H', RIGHT, PAD + 16 * UI, DIM);
    right(String(Math.round(rider.speed * 3.6)),
      RIGHT - measure('KM/H', UI) - 5 * UI, PAD + 9 * UI, SNOW, 2);
    right(`${(rider.distance / 1000).toFixed(2)} KM`, RIGHT, PAD + 28 * UI, QUIET);
    right(`${g.weather.phase} · ${g.weather.conditions}`, RIGHT, PAD + 37 * UI, MINT);

    /* Air time is the only number that has to be live, because it is the one
       the player is making a decision against. Below a quarter of a second
       it is a bump rather than a jump, and putting a timer on screen for it
       only makes the screen twitch. */
    if (!rider.grounded && rider.airTime > 0.25) {
      right(`${rider.airTime.toFixed(1)}S`, RIGHT, AIR_Y, MINT, 2);
    }

    // The live trick reads while it is still happening, which is what makes
    // holding a spin one instant longer a decision
    if (!rider.grounded && g.liveTrick) centreLine(g.liveTrick, LIVE_Y, SNOW, 1);

    // --- the banner -----------------------------------------------------
    if (bannerTimer > 0) {
      const age = BANNER_HOLD - bannerTimer;
      /* It arrives by moving three pixels and blinking, not by fading in. A
         fade is a modern transition and there is no room for one here: at
         this resolution its intermediate frames are just a dimmer colour,
         which reads as the HUD being broken. A blink is what a console did,
         and it is louder in three frames than a fade is in twenty. */
      const drop = (age < 0.05 ? 3 : age < 0.10 ? 1 : 0) * UI;
      const flash = age < 0.18 && Math.floor(age / 0.06) % 2 === 0;

      /* A full trick name — SWITCH + FRONTSIDE 1080 + 3× BACKFLIP + TWEAKED
         GRAB (SKETCHY) — is sixty-two characters, which is 742 pixels at the
         larger stop on a 640 pixel picture, so `centreLine` drops it to the
         smaller one. It happens rarely enough to read as a very long trick
         rather than as a bug. */
      const size = centreLine(bannerName, BANNER_Y + drop, flash ? SNOW : bannerTone, 2);
      if (bannerPoints) {
        centre(bannerPoints, CENTRE, BANNER_Y + 4 * UI + line * size + drop, AMBER);
      }
    }

    // --- the charge bar, which is the leg spring drawn ------------------
    if (rider.charging) {
      const charge = Math.min(1, Math.max(0, rider.charge));
      const left = CENTRE - (CHARGE_W >> 1);
      ctx.fillStyle = INK;
      ctx.fillRect(left - UI, CHARGE_Y - UI, CHARGE_W + 2 * UI, CHARGE_H + 2 * UI);
      // Full means pop now, so at full the bar stops being a bar and starts
      // flashing. It is the one moment the HUD is allowed to shout.
      const full = charge > 0.995;
      ctx.fillStyle = full && Math.floor(clock * 10) % 2 === 0 ? SNOW : AMBER;
      const w = Math.round(CHARGE_W * charge);
      if (w > 0) ctx.fillRect(left, CHARGE_Y, w, CHARGE_H);
    }

    // --- the quiet corners ----------------------------------------------
    const soundW = text(muted ? 'SOUND OFF' : 'SOUND ON', PAD, BOTTOM - line,
      muted ? DIM : QUIET);

    /* On a phone the pad *is* the controls and there is no keyboard to
       explain. On anything else the legend goes bottom right — unless the
       buffer is too narrow to hold it clear of both its neighbours, which is
       what became of `@media (max-width: 620px)`.

       Two clearances, not one. The sound state is the obvious one and it was
       the only one at first, which was wrong: the charge bar is centred and
       fixed, so on a short buffer at double size the legend cleared the
       sound state comfortably and then had the bar drawn straight through
       it. The bar is tested for whether it is on screen or not, because a
       legend that disappeared every time the legs loaded would be far worse
       than one that is simply not there. */
    if (!document.body.classList.contains('touch')) {
      if (!legend) legend = bakeLegend();
      const at = RIGHT - legend.w;
      if (at > PAD + soundW + 16 * UI && at > CENTRE + (CHARGE_W >> 1) + 8 * UI) {
        ctx.drawImage(legend.surface, at - UI, BOTTOM - legend.h - UI);
      }
    }
  }

  /* The canvas says nothing to a screen reader, so this does. Once a second,
     because the value of it is that the numbers are reachable, not that they
     are narrated — the live region is deliberately off. */
  function speak(g, dt) {
    if (!readout) return;
    sayIn -= dt;
    if (sayIn > 0) return;
    sayIn = 1;
    readout.textContent = `Score ${Math.round(g.score)}, best ${Math.round(g.best)}, `
      + `${Math.round(g.rider.speed * 3.6)} kilometres per hour, `
      + `${(g.rider.distance / 1000).toFixed(2)} kilometres down.`;
  }

  function update(g, dt) {
    clock += dt;

    // The score counts up to the truth rather than jumping to it. A number
    // that rolls reads as a reward; a number that changes reads as a field.
    shownScore += (g.score - shownScore) * Math.min(1, dt * 7);
    if (Math.abs(g.score - shownScore) < 1) shownScore = g.score;

    if (bannerTimer > 0) bannerTimer -= dt;

    draw(g);
    speak(g, dt);
  }

  /* One banner, held long enough to read at speed and no longer. */
  function banner(name, points, tone = '') {
    bannerName = name;
    bannerPoints = points ? `+${fmt.format(Math.round(points))}` : '';
    bannerTone = TONES[tone] || SNOW;
    bannerTimer = BANNER_HOLD;
  }

  function setMuted(value) {
    muted = !!value;
  }

  /* A restart clears the banner as well as the counter. It did not use to,
     and pressing R immediately after a wipeout left WIPEOUT sitting over the
     top of a brand new run for the better part of two seconds. */
  function resetScore() {
    shownScore = 0;
    bannerTimer = 0;
  }

  return { update, banner, setMuted, resetScore, setSize, canvas };
}
