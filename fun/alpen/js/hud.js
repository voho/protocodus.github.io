/* The read-out is a high-DPI bitmap surface of its own.

   The world is native-resolution now, but the HUD keeps the 5×7 hand-drawn
   alphabet and whole-number layout that give it a console voice. Its backing
   store follows the display rather than the adaptive 3D target, so text stays
   sharp even when a fragile GPU lowers world resolution. Its compact bitmap
   lettering remains a deliberate interface identity, independent of the
   now full-precision 3D render.

   Layout is measured from edges and the centre in integer device pixels. UI
   scale changes only in whole steps, and the opening legend is drawn only
   when its measured footprint really fits.

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
import { gradeAt } from './terrain.js';
import { SCORE } from './config.js';

/* The combo's ceiling, read from the rules rather than typed here. The whole
   discipline of this file is that it states what the game already decided; a
   hard-coded 12 beside a `comboMax` of 12 is two facts where there is one. */
const SCORE_CAP = SCORE.comboMax;

/* Safe construction size until main.js supplies the display backing store. */
export const HUD_WIDTH = 640;
export const HUD_HEIGHT = 360;

/* Live high-DPI HUD dimensions. */
let W = HUD_WIDTH;
let H = HUD_HEIGHT;

/* Ten pixels of air on every edge. A 1997 console assumed a CRT would eat
   the outside few per cent of the picture, and while nothing here is going
   to a CRT, the habit is the reason HUDs of the period sit inset rather than
   flush — and it still looks right. */
const MARGIN = 10;

const BANNER_HOLD = 1.9;    // seconds a trick name stays up
const BEST_FLASH = 2.4;     // and how long the moment you pass it is marked
const COMBO_FLASH = 0.24;

/* Scale is chosen from display density and the layout's real footprint. */
const FOOT_W = 330;
const FOOT_H = 170;

/* How many device pixels of frame height one stop of type is worth.

   This used to be `round(2 · devicePixelRatio)`, which is the wrong question
   asked of the wrong number. Pixel ratio says how dense the panel is, not how
   big the picture is — so a 4K monitor reporting a ratio of one got the same
   two-pixel type as a 720p laptop reporting the same, and the read-out was a
   postage stamp in the corner of a two-thousand-line frame. What decides how
   big a glyph should be is how many pixels there are to spend on it.

   One stop per four hundred lines puts the score at the same *angular* size on
   every display, which is what "legible" actually means. It is still stepped
   in whole numbers, because a 5×7 bitmap font scaled by 2.5 is a blurry one. */
const LINES_PER_STOP = 400;
const UI_MAX = 6;

/* Anything that flashes is a thing this reader has asked not to be shown.

   `retro.js` already makes this exact query for the speed treatment. The HUD
   had not, which left the one part of the interface that genuinely strobes —
   a full charge bar blinking at 5 Hz for as long as the key is held, which is
   above the threshold WCAG 2.3.1 sets — as the only thing on screen ignoring
   the preference. Every flash below has a still equivalent rather than simply
   being removed: a state that was being signalled by blinking is still a state
   and still has to be legible, so it is signalled by colour instead. */
const CALM = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let UI = 1;
/* One pad per edge rather than one for all four, because `viewport-fit=cover`
   means the frame now extends under the notch and the rounded corners on a
   phone, and the score was landing behind the camera housing. Everything else
   here is measured from these four. */
let PAD_L = MARGIN;
let PAD_R = MARGIN;
let PAD_T = MARGIN;
let PAD_B = MARGIN;
let PAD = MARGIN;           // the smallest of them, for anything symmetrical
let RIGHT = W - MARGIN;
let BOTTOM = H - MARGIN;
let CENTRE = W >> 1;
let AIR_Y = MARGIN + 60;
let CHARGE_W = 120;
let CHARGE_H = 5;
let CHARGE_Y = H - 60;
let BANNER_Y = CHARGE_Y - 36;
let LIVE_Y = BANNER_Y - 16;
let inset = { top: 0, right: 0, bottom: 0, left: 0 };

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

  const wants = Math.max(1, Math.min(UI_MAX, Math.round(H / LINES_PER_STOP)));
  const fits = Math.max(1, Math.floor(Math.min(W / FOOT_W, H / FOOT_H)));
  UI = Math.min(wants, fits);

  const base = MARGIN * UI;
  PAD_L = base + inset.left;
  PAD_R = base + inset.right;
  PAD_T = base + inset.top;
  PAD_B = base + inset.bottom;
  PAD = base;
  RIGHT = W - PAD_R;
  BOTTOM = H - PAD_B;
  CENTRE = W >> 1;
  // The one fixed-width thing on screen, so it is the one thing that has to
  // be told the frame might be narrower than it is
  CHARGE_W = Math.min(120 * UI, W - PAD_L - PAD_R);
  CHARGE_H = 5 * UI;
  CHARGE_Y = Math.max(PAD_T + 52 * UI, H - 60 * UI - inset.bottom);

  /* The trick banner lives at the top of the frame, not the bottom.

     It used to stack up from the charge bar, on the reasoning that everything
     to do with the trick in progress belongs to the rider and the rider sits
     low in the frame. That is true of the charge bar, which is a read-out of
     the legs and wants to be near them — and exactly wrong for the banner,
     because the rider sits low in the frame *and the banner was landing on
     top of him*. A trick name is the one piece of the HUD that appears at the
     precise moment the player most needs to see the rider: mid-air, deciding
     whether the landing is coming. So it goes where nothing else is, which is
     the empty band across the top between the score and the speed.

     Between them and *below* them, though, not across them. The band starts
     where the deeper of the two corner blocks ends, because a banner is
     centred and can be the full width of the frame — at which point "between
     the score and the speed" stops being a gap it can sit in and becomes two
     things it is drawn straight through. `topEnd` is the bottom of the
     conditions line, which is the lowest either corner reaches. */
  const topEnd = PAD_T + (37 + GLYPH_H) * UI;
  BANNER_Y = Math.max(PAD_T, Math.min(topEnd + 10 * UI, H - PAD_B - 30 * UI));
  LIVE_Y = Math.max(PAD_T, Math.min(BANNER_Y + 28 * UI, H - PAD_B - GLYPH_H * UI));
  AIR_Y = Math.max(PAD_T, Math.min(PAD_T + 60 * UI, H - PAD_B - GLYPH_H * 2 * UI));
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
const ICE = q5('#00d4ff');        // Alpine glacier ice blue
const GOLD = q5('#ffab00');       // Alpine sun gold
const MINT = ICE;
const AMBER = GOLD;
const SNOW = q5('#e6eefa');       // read-outs — blue-biased, never #ffffff
const QUIET = q5('#9db2cc');      // secondary read-outs
const DIM = q5('#63788f');        // labels that are only there to be found
const INK = q5('#060c16');        // the outline
const KEY = q5('#00a8cc');        // ice, one stop down
const LEG = q5('#7d90a8');        // legend text

/* Banner tones. `near` reuses mint because a near miss is the game telling
   you that you did something on purpose, which is what mint means here. */
const TONES = {
  warn: q5('#ffd98a'),
  bad: q5('#ff8a6a'),
  near: MINT,
};

/* The opening control legend, which used to be a <dl> in index.html and is
   drawn in the same bitmap font as everything else now — because a legend in
   a real typeface next to a read-out in a bitmap one is precisely the seam
   this whole rewrite exists to remove.

   The wording is tighter than the curtain's. The curtain has a paragraph's
   worth of room and explains; this is a reminder you glance at mid-run, and
   at six pixels per character a sentence is a wall. */
const LEGEND = [
  ['A D', 'CARVE · SPIN'],
  ['W', 'BOOST'],
  ['S', 'BRAKE'],
  ['SPACE', 'CHARGE · POP'],
  /* Q and E each do two things now, and which one is decided by W or S. This
     is the line that has to carry that without becoming a sentence: the four
     keys are already above, so the reminder is what they *combine* into, and
     the plus sign is doing the work a paragraph does on the title card. */
  ['Q', 'GRAB · PRESS'],
  ['E', 'BACKFLIP'],
  ['+ W S', 'NOSE · METHOD · FRONTFLIP'],
  ['ESC R N M F', 'PAUSE · RESET · NEW · AUDIO · FULL'],
];

const fmt = new Intl.NumberFormat('en-US');
// The curtain already taught the controls; this is one glance after drop-in,
// not a panel that should cover the first whole pitch of the run.
const LEGEND_SECONDS = 4;

export function createHud(root) {
  /* index.html declares the canvas next to #stage so the two-buffer idea is
     visible in the markup, but one is made here if it is not — this module
     owns its own surface either way. */
  const canvas = root.querySelector('canvas') || root.appendChild(document.createElement('canvas'));
  canvas.className = 'readout';
  canvas.setAttribute('aria-hidden', 'true');

  let ctx = null;
  const readout = root.querySelector('[data-readout]');
  const callout = root.querySelector('[data-callout]');

  let shownScore = 0;
  let bannerName = '';
  let bannerPoints = '';
  let bannerTone = SNOW;
  let bannerTimer = 0;
  let muted = false;
  let clock = 0;
  let sayIn = 0;
  let legend = null;
  let legendTime = 0;
  let last = null;          // the most recent game state, so a resize can redraw
  let bestFlash = 0;        // …and the moment the run passed the record
  let bestPassed = false;
  let comboFlash = 0;
  let shownCombo = 1;
  let sig = '';             // what the last drawn frame said — see `signature`

  /* ------------------------------------------------------------------------
     Fitting the window

     Width and height are display pixels. `pixel` is retained as a density
     hint for embedded/letterboxed callers; the full-window game passes one.
     --------------------------------------------------------------------- */
  function setSize(width, height, pixel = 0, offsetX = 0, offsetY = 0, insets = null) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (insets) inset = insets;

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
    sig = '';   // the surface changed shape, so whatever was drawn is gone

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

    /* Writing `canvas.width` above clears the surface, and the only thing that
       ever puts anything back on it is `update`, which the loop does not call
       while the game is paused. So rotating a phone with the pause curtain up,
       or simply letting the URL bar slide away, left a blank rectangle where
       the score had been until the player pressed Escape. `main.js` already
       does the equivalent for the world — it clears `pausedRendered` so the
       next frame redraws once — and this is the read-out's half of it. */
    if (last) draw(last);
  }

  setSize(HUD_WIDTH, HUD_HEIGHT);

  /* ------------------------------------------------------------------------
     Drawing primitives — everything lands on whole buffer pixels
     --------------------------------------------------------------------- */

  /* Sizes are given in stops — 1 and 2 — and multiplied into buffer pixels
     here, in one place, so nothing below has to remember to do it.

     All three placements clip to the margins on the way through, which is why
     nothing in `draw` has a width check in it. That was not the first
     arrangement: the checks were written at the call sites, and every call
     site that got one proved there was another that had not. A frame narrower
     than the layout wants is not an edge case to be handled per line, it is a
     property of the frame, and the frame is what these three know about. */
  function clip(s, size, room) {
    const n = Math.floor((room + size * UI) / (ADVANCE * size * UI));
    if (n < 1) return '';
    return s.length > n ? s.slice(0, n) : s;
  }

  /* Two passes per string: the glyphs, then the same glyphs again one device
     pixel to the right, additive and faint. On a CRT a lit phosphor bled into
     its neighbour, which is why period text seems to sit *in* the glass
     rather than on it — and the retro grade already leans that way, so type
     with mathematically clean edges reads as pasted on top of the picture
     rather than part of it. One pixel of the display, not of the font: at 2×
     and above the bleed is deliberately sub-glyph-pixel, a softening rather
     than a smear. The glow pass has no halo — the outline is near-black and
     additive black is nothing — and it is skipped for a string that clipped
     to nothing, so the composite state is only touched when ink went down. */
  const GLOW = 0.13;
  const text = (s, x, y, colour, size = 1) => {
    const w = drawText(ctx, s, x, y, colour, size * UI, INK);
    if (w) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GLOW;
      drawText(ctx, s, x + 1, y, colour, size * UI, null);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    return w;
  };
  const from = (s, x, y, colour, size = 1) => text(clip(s, size, RIGHT - x), x, y, colour, size);

  function right(s, x, y, colour, size = 1) {
    const cut = clip(s, size, x - PAD_L);
    return text(cut, x - measure(cut, size * UI), y, colour, size);
  }

  /* A centred line that is allowed to be any length, which all three of the
     ones in the middle of the screen are: a trick name is assembled from
     however many things the rider actually did, and the longest one the
     grammar can build is sixty-two characters. The size steps down a whole
     stop at a time until it fits, and only once it is at the smallest stop
     does anything get cut.

     Cutting is exact rather than approximate because the font is monospace,
     which is the first time that property has bought anything: how many
     characters fit in a width is a division, not a search. And a hard cut is
     the right failure. Every alternative — wrapping, scrolling, scaling by a
     fraction — is either two lines where the layout has room for one, or a
     blurred one. */
  function centreLine(s, y, colour, maxSize) {
    let size = maxSize;
    const room = W - PAD_L - PAD_R;
    while (size > 1 && measure(s, size * UI) > room) size -= 1;
    const cut = clip(s, size, room);
    text(cut, CENTRE - ((measure(cut, size * UI) - 1) >> 1), y, colour, size);
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

  function drawBitmapMenu(g, isPaused) {
    ctx.clearRect(0, 0, W, H);

    /* Dark backdrop overlay — dark enough to carry the type, light enough
       that the mountain stays visible through it. At the old 0.90 the
       attract run behind the title was effectively blacked out, which
       defeats the entire point of an attract mode: the demo rider exists to
       be seen carving behind the invitation. Every glyph carries its own
       ink outline, so legibility does not lean on the wash. */
    ctx.fillStyle = 'rgba(9, 15, 26, 0.62)';
    ctx.fillRect(0, 0, W, H);

    // Outer pixel frame
    ctx.strokeStyle = ICE;
    ctx.lineWidth = Math.max(1, 2 * UI);
    const margin = 8 * UI;
    ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);

    const blink = Math.floor(clock * 3) % 2 === 0;

    if (isPaused) {
      // PAUSED MENU
      const topY = margin + 14 * UI;
      centreLine('PAUSED', topY, GOLD, 3);

      // Stats box
      const boxY = topY + 38 * UI;
      centreLine('CURRENT RUN', boxY, ICE, 1);
      const scoreStr = `SCORE    ${fmt.format(Math.round(shownScore))}`;
      const bestStr =  `BEST     ${fmt.format(Math.round(g.bestAtStart || 0))}`;
      const distStr =  `DISTANCE ${(g.rider ? g.rider.distance / 1000 : 0).toFixed(2)} KM`;

      centreLine(scoreStr, boxY + 14 * UI, SNOW, 1);
      centreLine(bestStr, boxY + 26 * UI, GOLD, 1);
      centreLine(distStr, boxY + 38 * UI, QUIET, 1);

      // Controls recap
      const ctrlY = boxY + 58 * UI;
      centreLine('CONTROLS', ctrlY, ICE, 1);
      centreLine('[A][D] CARVE & SPIN  ·  [W] BOOST  ·  [S] BRAKE', ctrlY + 14 * UI, LEG, 1);
      centreLine('[SPACE] POP JUMP     ·  [Q][E] TRICKS & FLIPS', ctrlY + 26 * UI, LEG, 1);
      centreLine('[R] RESTART  ·  [N] NEW MOUNTAIN  ·  [M] MUTE', ctrlY + 38 * UI, LEG, 1);

      // Prompt
      const touch = document.body.classList.contains('touch');
      const promptText = touch ? 'TAP ANYWHERE TO RESUME' : 'PRESS ANY KEY TO RESUME';
      if (blink || CALM) {
        centreLine(`[ ${promptText} ]`, H - margin - 20 * UI, GOLD, 2);
      }
    } else {
      // START SCREEN TITLE CARD MENU
      const topY = margin + 10 * UI;

      centreLine('ALPEN · ENDLESS SNOWBOARDING', topY, ICE, 1);

      const titleY = topY + 12 * UI;
      const titleSize = centreLine('ALPEN', titleY, SNOW, 4);

      const seedY = titleY + GLYPH_H * titleSize * UI + 4 * UI;
      const seedCode = g.seed || 'ALPEN';
      centreLine(`MOUNTAIN SEED · ${seedCode}`, seedY, QUIET, 1);

      const descY = seedY + 14 * UI;
      centreLine('AN ENDLESS MOUNTAIN, A BOARD, AND WHATEVER YOU CAN LAND.', descY, LEG, 1);

      const cardsY = descY + 16 * UI;
      const controls = [
        ['[ A ][ D ]', 'CARVE ON SNOW · SPIN IN AIR'],
        ['[ W ]', 'POWERED TUCK (BOOST)'],
        ['[ S ]', 'SPEED CHECK (BRAKE)'],
        ['[ SPACE ]', 'HOLD TO LOAD LEGS, RELEASE TO POP'],
        ['[ Q ][ E ]', 'GRAB / TAIL PRESS · BACKFLIP'],
        ['[ ESC / R ]', 'PAUSE · RESTART MOUNTAIN'],
      ];

      controls.forEach(([keys, desc], i) => {
        const y = cardsY + i * 11 * UI;
        const kw = measure(keys, UI);
        const dw = measure(desc, UI);
        const totalW = kw + 8 * UI + dw;
        const startX = CENTRE - (totalW >> 1);
        text(keys, startX, y, ICE, 1);
        text(desc, startX + kw + 8 * UI, y, LEG, 1);
      });

      // Loading Bar or Prompt
      if (g.loadingProgress !== null && g.loadingProgress !== undefined && g.loadingProgress < 1) {
        const loadY = cardsY + controls.length * 11 * UI + 6 * UI;
        const barW = Math.min(200 * UI, W - 40 * UI);
        const barH = 5 * UI;
        const barX = CENTRE - (barW >> 1);
        ctx.fillStyle = INK;
        ctx.fillRect(barX - UI, loadY - UI, barW + 2 * UI, barH + 2 * UI);
        ctx.strokeStyle = ICE;
        ctx.lineWidth = UI;
        ctx.strokeRect(barX - UI, loadY - UI, barW + 2 * UI, barH + 2 * UI);

        const fillW = Math.round(barW * (g.loadingProgress || 0));
        if (fillW > 0) {
          ctx.fillStyle = ICE;
          ctx.fillRect(barX, loadY, fillW, barH);
        }
        const pct = Math.round((g.loadingProgress || 0) * 100);
        const lbl = g.loadingLabel ? `${g.loadingLabel} · ${pct}%` : `LOADING · ${pct}%`;
        centreLine(lbl, loadY + barH + 4 * UI, QUIET, 1);
      } else {
        const touch = document.body.classList.contains('touch');
        const promptText = touch ? 'TAP ANYWHERE TO DROP IN' : 'PRESS ANY KEY TO DROP IN';
        if (blink || CALM) {
          centreLine(`[ ${promptText} ]`, H - margin - 20 * UI, GOLD, 2);
        }
      }
    }
  }

  /* ------------------------------------------------------------------------
     The frame
     --------------------------------------------------------------------- */

  let cachedCurtain = null;
  function getCurtain() {
    if (!cachedCurtain) cachedCurtain = document.querySelector('.curtain');
    return cachedCurtain;
  }

  function draw(g) {
    const curtain = getCurtain();
    const isAttract = g.mode === 'attract' || (curtain && curtain.classList.contains('on') && curtain.dataset.screen === 'start');
    const isPaused = g.mode === 'paused' || (curtain && curtain.classList.contains('on') && curtain.dataset.screen === 'paused');

    if (isAttract || isPaused) {
      drawBitmapMenu(g, isPaused);
      return;
    }

    ctx.clearRect(0, 0, W, H);
    const rider = g.rider;
    const line = GLYPH_H * UI;          // one stop of type, in buffer pixels

    // --- top left: what has been earned ---------------------------------
    from('SCORE', PAD_L, PAD_T, MINT);
    const scoreW = from(fmt.format(Math.round(shownScore)), PAD_L, PAD_T + 9 * UI, AMBER, 2);

    /* The combo used to grow by twelve per cent at five and up. There is no
       such thing as twelve per cent here, so it doubles instead: below five
       it is a small mint aside sitting on the score's baseline, at five it
       becomes a second number the size of the score and turns white. An
       integer grid does not do emphasis by degrees, and it turns out not to
       need to — the jump reads harder than the tween ever did.

       Two things were still missing from it, and both are about the player
       being able to *notice*. It moved silently — the only signal that a clean
       landing had paid a multiplier was an audio blip — so it now blinks for a
       quarter of a second on the frame it changes, using the same three-frame
       primitive the banner arrives with. And it had no visible ceiling, so
       past five it carries its own: there is no decay in this game and a bar
       counting down would be the read-out inventing a rule the physics does
       not have, but a cap is a fact and `/12` states it. */
    const combo = Math.round(g.combo);
    if (combo > 1) {
      const hot = comboFlash > 0 && !CALM
        && Math.floor((COMBO_FLASH - comboFlash) / 0.06) % 2 === 0;
      const label = `×${combo}`;
      const x = PAD_L + scoreW + 8 * UI;
      if (combo >= 5) {
        const w = from(label, x, PAD_T + 9 * UI, hot ? AMBER : SNOW, 2);
        from(`/${SCORE_CAP}`, x + w + 4 * UI, PAD_T + 9 * UI + line, DIM);
      } else {
        from(label, x, PAD_T + 9 * UI + line, hot ? SNOW : MINT);
      }
    }

    /* BEST, frozen at what it was when the run started.

       It used to be `game.best`, which `award` overwrites the instant the
       score passes it — so on any run that is going well the line was a second
       copy of the score, counting up beside it, saying nothing. And the one
       moment that actually matters on an endless run, the moment you go past
       your own record, produced no feedback at all.

       Held at the value it had on the drop-in, it is a target for as long as
       it is one and then it is history. Passing it flashes the line rather
       than throwing a banner: a banner is for something you did, and this is
       something that happened. Afterwards it retires into DIM. */
    const bestW = from('BEST', PAD_L, PAD_T + 28 * UI, DIM);
    const passed = g.bestAtStart > 0 && g.score >= g.bestAtStart;
    const beat = bestFlash > 0
      && (CALM || Math.floor((BEST_FLASH - bestFlash) / 0.18) % 2 === 0);
    from(fmt.format(Math.round(g.bestAtStart || 0)),
      PAD_L + bestW + 6 * UI, PAD_T + 28 * UI,
      beat ? MINT : (passed ? DIM : QUIET));
    if (beat) from('BEATEN', PAD_L + bestW + 6 * UI
      + measure(fmt.format(Math.round(g.bestAtStart || 0)), UI) + 6 * UI,
    PAD_T + 28 * UI, MINT);

    // --- top right: what the hill is doing ------------------------------
    right('SPEED', RIGHT, PAD_T, MINT);
    right('KM/H', RIGHT, PAD_T + 16 * UI, DIM);
    right(String(Math.round(rider.speed * 3.6)),
      RIGHT - measure('KM/H', UI) - 5 * UI, PAD_T + 9 * UI, SNOW, 2);
    /* Three numbers about the run rather than one, and the two new ones are
       the two a rider would actually quote.

       Vertical drop is the honest measure of a descent — a kilometre of this
       mountain is about two hundred and eighty metres of it — and the read-out
       had the less interesting axis. The gradient is the one piece of terrain
       information the picture cannot give you at speed: the run swings between
       ten and twenty-two degrees over its chapters, and which of those the
       next three hundred metres is decides everything about what to do with
       the speed you are carrying. Both come from things that already existed
       — `rider.drop` and the grade's own closed form — and neither needs a
       glyph the table does not have. */
    right(`${(rider.distance / 1000).toFixed(2)} KM · ${Math.round(rider.drop)} M`
      + ` · ${Math.round(Math.atan(gradeAt(rider.pos.z)) * 180 / Math.PI)}°`,
    RIGHT, PAD_T + 28 * UI, QUIET);
    right(`${g.weather.phase} · ${g.weather.conditions}`, RIGHT, PAD_T + 37 * UI, MINT);

    /* The gate ladder, while it is alive.

       Consecutive gates are the one thing in the scoring that is a *state* —
       each one taken without missing is worth more than the last, and a miss
       puts you back to the bottom — and it was reported only as a banner that
       had gone by the time the next gate arrived. So a player threading a line
       of them could not tell what their run was worth without doing the
       arithmetic. Amber, because by the palette's own rule that is the colour
       of something being earned, and gone entirely the moment the run breaks. */
    if (g.gateRun > 0) {
      right(`GATES ×${g.gateRun}`, RIGHT, PAD_T + 46 * UI, AMBER);
    }

    /* Air time is the only number that has to be live, because it is the one
       the player is making a decision against. Below a quarter of a second
       it is a bump rather than a jump, and putting a timer on screen for it
       only makes the screen twitch.

       It used to yield to the banner, on the reasoning that the banner is the
       verdict on the jump that just ended and the timer is the jump in
       progress, so the two together is the HUD reporting on two different
       jumps at once. The principle is right and the wrong half was being given
       up. Land a trick and pop again inside the banner's two seconds — which
       is a good run, and the same comment said so — and the *live* number went
       missing for most of the new flight, which is exactly when it is being
       read. So leaving the ground now retires the previous verdict instead
       (`clearBanner`, called from the launch event), and the two can no longer
       collide because the first one is gone before the second exists. */
    if (!rider.grounded && rider.airTime > 0.25) {
      right(`${rider.airTime.toFixed(1)}S`, RIGHT, AIR_Y, MINT, 2);
    }

    // The live trick reads while it is still happening, which is what makes
    // holding a spin one instant longer a decision
    if (!rider.grounded && g.liveTrick) centreLine(g.liveTrick, LIVE_Y, SNOW, 1);

    // --- course direction guide when off-piste or in heavy blizzard ---------
    // A subtle console compass arrow showing the way back to the groomed run
    // when drifting into deep powder or during low-visibility whiteouts.
    const offset = g.pisteOffset || 0;
    const isBlizzard = g.weather && g.weather.storm > 0.45;
    if (g.mode === 'playing' && (Math.abs(offset) > 0.9 || (isBlizzard && Math.abs(offset) > 0.4))) {
      const guideText = offset > 0 ? '◄ PISTE' : 'PISTE ►';
      const guideColor = Math.abs(offset) > 1.3 ? AMBER : MINT;
      centreLine(guideText, BOTTOM - 48 * UI, guideColor, 1);
    }

    // --- the banner -----------------------------------------------------
    if (bannerTimer > 0) {
      const age = BANNER_HOLD - bannerTimer;
      /* It arrives by moving three pixels and blinking, not by fading in. A
         fade is a modern transition and there is no room for one here: at
         this resolution its intermediate frames are just a dimmer colour,
         which reads as the HUD being broken. A blink is what a console did,
         and it is louder in three frames than a fade is in twenty. */
      const drop = CALM ? 0 : (age < 0.05 ? 3 : age < 0.10 ? 1 : 0) * UI;
      const flash = !CALM && age < 0.18 && Math.floor(age / 0.06) % 2 === 0;

      /* A full trick name — SWITCH + FRONTSIDE 1080 + 3× BACKFLIP + TWEAKED
         GRAB (SKETCHY) — is sixty-two characters, which is 742 pixels at the
         larger stop on a 640 pixel picture, so `centreLine` drops it to the
         smaller one. It happens rarely enough to read as a very long trick
         rather than as a bug. */
      const size = centreLine(bannerName, BANNER_Y + drop, flash ? SNOW : bannerTone, 2);
      if (bannerPoints) {
        centreLine(bannerPoints, BANNER_Y + 4 * UI + line * size + drop, AMBER, 1);
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
      /* Full means pop now, so at full the bar stops being a bar. It used to
         blink at 5 Hz for as long as the key was held, which is over the
         threshold WCAG 2.3.1 sets and is the only genuine strobe in the game;
         a reader who has asked for reduced motion gets the same information as
         a state instead — the bar turns and keeps a mint keyline — because the
         thing being signalled is a state and not an event. */
      const full = charge > 0.995;
      if (full && CALM) {
        ctx.fillStyle = MINT;
        ctx.fillRect(left - UI, CHARGE_Y - UI, CHARGE_W + 2 * UI, CHARGE_H + 2 * UI);
      }
      ctx.fillStyle = full && (CALM || Math.floor(clock * 10) % 2 === 0) ? SNOW : AMBER;
      const w = Math.round(CHARGE_W * charge);
      if (w > 0) ctx.fillRect(left, CHARGE_Y, w, CHARGE_H);
    }

    // --- the flow meter -------------------------------------------------
    if (g.flow > 0.01) {
      const flowY = BOTTOM - 36 * UI;
      from('FLOW', PAD_L, flowY, MINT, 1);
      const flowW = 80 * UI;
      const flowH = 4 * UI;
      const flowX = PAD_L + measure('FLOW ', UI);
      ctx.fillStyle = INK;
      ctx.fillRect(flowX - UI, flowY - UI, flowW + 2 * UI, flowH + 2 * UI);
      ctx.fillStyle = g.flow > 0.99 && (CALM || Math.floor(clock * 10) % 2 === 0) ? SNOW : MINT;
      const fw = Math.round(flowW * g.flow);
      if (fw > 0) ctx.fillRect(flowX, flowY, fw, flowH);
    }

    // --- the quiet corners ----------------------------------------------
    // "Sound on" is useful while learning the controls and then becomes
    // chrome. "Sound off" stays visible because silence needs an explanation.
    const showingHints = legendTime < LEGEND_SECONDS;
    const touch = document.body.classList.contains('touch');
    const soundW = !touch && (muted || showingHints)
      ? from(muted ? 'SOUND OFF' : 'SOUND ON', PAD_L, BOTTOM - line, muted ? DIM : QUIET)
      : 0;

    /* On a phone the pad *is* the controls and there is no keyboard to
       explain. On anything else the legend goes bottom right — unless the
       buffer is too narrow to hold it clear of both its neighbours, which is
       what became of `@media (max-width: 620px)`.

       Two clearances, not one. The sound state is the obvious one and it was
       the only one at first, which was wrong: the charge bar is centred and
       fixed, so on a narrow buffer at double size the legend cleared the
       sound state comfortably and then had the bar drawn straight through it.
       The bar's clearance is tested whether or not the bar is currently
       showing, because a legend that vanished every time the legs loaded
       would be far worse than one that is simply not there. */
    if (showingHints && !touch) {
      if (!legend) legend = bakeLegend();
      const at = RIGHT - legend.w;
      if (at > PAD_L + soundW + 16 * UI && at > CENTRE + (CHARGE_W >> 1) + 8 * UI) {
        ctx.drawImage(legend.surface, at - UI, BOTTOM - legend.h - UI);
      }
    }
  }

  /* The canvas says nothing to a screen reader, so this does. Once a second,
     because the value of it is that the numbers are reachable, not that they
     are narrated — the live region is deliberately off.

     The combo is on it now because it multiplies every award in the game and
     was the one quantity a player could not reach at all, and the drop is on
     it for the same reason it is on the visible read-out. */
  function speak(g, dt) {
    if (!readout) return;
    sayIn -= dt;
    if (sayIn > 0) return;
    sayIn = 1;
    const combo = Math.round(g.combo);
    readout.textContent = `Score ${Math.round(g.score)}, best ${Math.round(g.best)}, `
      + (combo > 1 ? `combo times ${combo}, ` : '')
      + `${Math.round(g.rider.speed * 3.6)} kilometres per hour, `
      + `${(g.rider.distance / 1000).toFixed(2)} kilometres and `
      + `${Math.round(g.rider.drop)} metres down.`;
  }

  /* Everything `draw` will actually put on screen, flattened to a string.

     The frame is redrawn only when this changes, because most frames it does
     not: the score is shown rounded, the speed is shown rounded, the distance
     line moves in ten-metre steps, and a clear + full repaint of a display-
     resolution canvas to reproduce identical pixels is the single largest
     avoidable cost in the HUD. The discipline is that every quantity `draw`
     reads appears here *as displayed* — rounded where it rounds, thresholded
     where it thresholds — and every animation is quantised to the step at
     which its pixels actually change: a blink is its bucket index, the
     banner's entrance is its three-frame drop amount, the charge blink is the
     half-decisecond of the clock. A value that animates but is missing from
     this string would simply freeze, which is why the list errs on the side
     of including facts that rarely move (the weather line, the touch class)
     rather than reasoning about when they might.

     One string allocation per frame, traded for hundreds of draw calls on
     the frames it skips. */
  function signature(g) {
    const curtain = getCurtain();
    const isAttract = g.mode === 'attract' || (curtain && curtain.classList.contains('on') && curtain.dataset.screen === 'start');
    const isPaused = g.mode === 'paused' || (curtain && curtain.classList.contains('on') && curtain.dataset.screen === 'paused');
    const blink = Math.floor(clock * 3) % 2;
    const rider = g.rider;
    const age = BANNER_HOLD - bannerTimer;
    const charge = rider && rider.charging ? Math.min(1, Math.max(0, rider.charge)) : 0;
    const full = charge > 0.995;
    return `${W} ${H} ${g.mode || ''} ${isAttract} ${isPaused} ${g.loadingProgress || 0} ${g.loadingLabel || ''} ${blink}`
      + ` ${Math.round(shownScore)}`
      + ` ${Math.round(g.combo)}`
      + ` ${comboFlash > 0 && !CALM ? Math.floor((COMBO_FLASH - comboFlash) / 0.06) % 2 : -1}`
      + ` ${Math.round(g.bestAtStart || 0)}`
      + ` ${g.bestAtStart > 0 && g.score >= g.bestAtStart ? 1 : 0}`
      + ` ${bestFlash > 0 ? (CALM ? 1 : Math.floor((BEST_FLASH - bestFlash) / 0.18) % 2) : -1}`
      + ` ${rider ? Math.round(rider.speed * 3.6) : 0}`
      + ` ${rider ? (rider.distance / 1000).toFixed(2) : 0} ${rider ? Math.round(rider.drop) : 0}`
      + ` ${rider ? Math.round(Math.atan(gradeAt(rider.pos.z)) * 180 / Math.PI) : 0}`
      + ` ${g.weather ? `${g.weather.phase}·${g.weather.conditions}` : ''}`
      + ` ${g.gateRun > 0 ? g.gateRun : 0}`
      + ` ${rider && !rider.grounded && rider.airTime > 0.25 ? rider.airTime.toFixed(1) : ''}`
      + ` ${rider && !rider.grounded && g.liveTrick ? g.liveTrick : ''}`
      + ` ${bannerTimer > 0
        ? `${bannerName}|${bannerPoints}|${bannerTone}`
          + `|${CALM ? 0 : age < 0.05 ? 3 : age < 0.10 ? 1 : 0}`
          + `|${!CALM && age < 0.18 ? Math.floor(age / 0.06) % 2 : -1}`
        : ''}`
      + ` ${rider && rider.charging ? Math.round(CHARGE_W * charge) : -1}`
      + ` ${full ? 1 : 0} ${full && !CALM ? Math.floor(clock * 10) % 2 : -1}`
      + ` ${g.flow > 0 ? Math.round(g.flow * 100) : 0}`
      + ` ${g.flow > 0.99 && !CALM ? Math.floor(clock * 10) % 2 : -1}`
      + ` ${Math.round((g.pisteOffset || 0) * 10)}`
      + ` ${muted ? 1 : 0} ${legendTime < LEGEND_SECONDS ? 1 : 0}`
      + ` ${document.body.classList.contains('touch') ? 1 : 0}`;
  }

  function update(g, dt) {
    clock += dt;
    last = g;
    if (g.mode === 'playing') legendTime += dt;

    // The score counts up to the truth rather than jumping to it. A number
    // that rolls reads as a reward; a number that changes reads as a field.
    shownScore += (g.score - shownScore) * Math.min(1, dt * 7);
    if (Math.abs(g.score - shownScore) < 1) shownScore = g.score;

    if (bannerTimer > 0) bannerTimer -= dt;
    if (bestFlash > 0) bestFlash -= dt;
    if (comboFlash > 0) comboFlash -= dt;

    // The edge, found here rather than in `award` — the scoring path runs
    // inside the physics step and has no business carrying a display concern.
    const combo = Math.round(g.combo);
    if (combo > shownCombo) comboFlash = COMBO_FLASH;
    shownCombo = combo;
    if (!bestPassed && g.mode === 'playing'
      && g.bestAtStart > 0 && g.score >= g.bestAtStart) {
      bestPassed = true;
      bestFlash = BEST_FLASH;
      if (callout) callout.textContent = 'New best.';
    }

    // Redrawn only when the picture would differ — see `signature`. The
    // spoken read-out runs regardless, because its cadence is its own.
    const s = signature(g);
    if (s !== sig) {
      sig = s;
      draw(g);
    }
    speak(g, dt);
  }

  /* One banner, held long enough to read at speed and no longer.

     It also goes to a screen reader, which the canvas cannot. That paragraph
     is `polite` and event-driven rather than the once-a-second one, so it says
     the things that happen — a landed 900, a wipeout — without the objection
     that sank a live region for the score. */
  function banner(name, points, tone = '') {
    bannerName = name;
    bannerPoints = points ? `+${fmt.format(Math.round(points))}` : '';
    bannerTone = TONES[tone] || SNOW;
    bannerTimer = BANNER_HOLD;
    if (callout) callout.textContent = points ? `${name}, plus ${Math.round(points)}` : name;
  }

  /* Leaving the ground retires the last jump's verdict — see the note beside
     the air clock. */
  function clearBanner() {
    bannerTimer = 0;
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
    legendTime = 0;
    bestFlash = 0;
    bestPassed = false;
    comboFlash = 0;
    shownCombo = 1;
    if (callout) callout.textContent = '';
  }

  return { update, banner, clearBanner, setMuted, resetScore, setSize, canvas };
}
