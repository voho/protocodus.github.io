/* The read-out is a high-DPI bitmap surface of its own.

   The world is native-resolution now, but the HUD keeps the 5×7 hand-drawn
   alphabet and whole-number layout that give it a console voice. Its backing
   store follows the display rather than the adaptive 3D target, so text stays
   sharp even when a fragile GPU lowers world resolution. Colours are
   quantised to the same five-bit palette as the final grade.

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

/* Scale is chosen from display density and the layout's real footprint. */
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
  // The one fixed-width thing on screen, so it is the one thing that has to
  // be told the frame might be narrower than it is
  CHARGE_W = Math.min(120 * UI, W - PAD * 2);
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
     the empty band across the top between the score and the speed.

     Between them and *below* them, though, not across them. The band starts
     where the deeper of the two corner blocks ends, because a banner is
     centred and can be the full width of the frame — at which point "between
     the score and the speed" stops being a gap it can sit in and becomes two
     things it is drawn straight through. `topEnd` is the bottom of the
     conditions line, which is the lowest either corner reaches. */
  const topEnd = PAD + (37 + GLYPH_H) * UI;
  BANNER_Y = Math.max(PAD, Math.min(topEnd + 10 * UI, H - PAD - 30 * UI));
  LIVE_Y = Math.max(PAD, Math.min(BANNER_Y + 28 * UI, H - PAD - GLYPH_H * UI));
  AIR_Y = Math.max(PAD, Math.min(PAD + 60 * UI, H - PAD - GLYPH_H * 2 * UI));
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

/* The opening control legend, which used to be a <dl> in index.html and is
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
  ['ESC R N M F', 'PAUSE · RESET · NEW · AUDIO · FULL'],
];

const fmt = new Intl.NumberFormat('en-US');
const LEGEND_SECONDS = 9;

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
  let legendTime = 0;

  /* ------------------------------------------------------------------------
     Fitting the window

     Width and height are display pixels. `pixel` is retained as a density
     hint for embedded/letterboxed callers; the full-window game passes one.
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

  const text = (s, x, y, colour, size = 1) => drawText(ctx, s, x, y, colour, size * UI, INK);
  const from = (s, x, y, colour, size = 1) => text(clip(s, size, RIGHT - x), x, y, colour, size);

  function right(s, x, y, colour, size = 1) {
    const cut = clip(s, size, x - PAD);
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
    while (size > 1 && measure(s, size * UI) > W - PAD * 2) size -= 1;
    const cut = clip(s, size, W - PAD * 2);
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

  /* ------------------------------------------------------------------------
     The frame
     --------------------------------------------------------------------- */

  function draw(g) {
    ctx.clearRect(0, 0, W, H);
    const rider = g.rider;
    const line = GLYPH_H * UI;          // one stop of type, in buffer pixels

    // --- top left: what has been earned ---------------------------------
    from('SCORE', PAD, PAD, MINT);
    const scoreW = from(fmt.format(Math.round(shownScore)), PAD, PAD + 9 * UI, AMBER, 2);

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
      if (combo >= 5) from(label, x, PAD + 9 * UI, SNOW, 2);
      else from(label, x, PAD + 9 * UI + line, MINT);
    }

    const bestW = from('BEST', PAD, PAD + 28 * UI, DIM);
    from(fmt.format(Math.round(g.best)), PAD + bestW + 6 * UI, PAD + 28 * UI, QUIET);

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
       only makes the screen twitch.

       It yields to the banner, which shares the band with it. That is not
       only a collision being dodged: the banner is the verdict on the jump
       that just ended and the timer is the jump in progress, so the two of
       them on screen together is the HUD reporting on two different jumps at
       once. Landing, reading 1,800 points, and popping again inside the
       banner's two seconds is a good run, not a state worth illustrating. */
    if (bannerTimer <= 0 && !rider.grounded && rider.airTime > 0.25) {
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
      const full = charge > 0.995;
      ctx.fillStyle = full && Math.floor(clock * 10) % 2 === 0 ? SNOW : AMBER;
      const w = Math.round(CHARGE_W * charge);
      if (w > 0) ctx.fillRect(left, CHARGE_Y, w, CHARGE_H);
    }

    // --- the quiet corners ----------------------------------------------
    // "Sound on" is useful while learning the controls and then becomes
    // chrome. "Sound off" stays visible because silence needs an explanation.
    const showingHints = legendTime < LEGEND_SECONDS;
    const touch = document.body.classList.contains('touch');
    const soundW = !touch && (muted || showingHints)
      ? from(muted ? 'SOUND OFF' : 'SOUND ON', PAD, BOTTOM - line, muted ? DIM : QUIET)
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
    if (g.mode === 'playing') legendTime += dt;

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
    legendTime = 0;
  }

  return { update, banner, setMuted, resetScore, setSize, canvas };
}
