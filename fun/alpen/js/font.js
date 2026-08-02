/* The typeface, drawn by hand, because there was no other kind.

   The HUD is a second framebuffer at the same 640×360 as the world, so a
   letter is made of exactly the same square pixels as the snow behind it.
   That single constraint rules out every real typeface: a font renderer
   would give back grey edges, and one grey pixel next to a hard-edged
   mountain is the whole illusion gone. A console of that era did not have a
   font renderer; it had a page of glyphs someone drew on graph paper and
   blitted. So does this.

   THE ENCODING

   Each glyph is five columns, each column seven bits, each bit one pixel.
   Bit 0 is the TOP row and bit 6 the bottom, so a column reads downwards as
   you count upwards through the number — which is the convention every
   parallel LCD controller of the period used, and the reason these numbers
   look familiar to anyone who has driven an HD44780.

   Worked example. 'A' is

       . # # # .      column 0 = rows 1-6 lit = 0b1111110 = 0x7e
       # . . . #      column 1 = rows 0 and 3 = 0b0001001 = 0x09
       # . . . #      column 2 = same          = 0x09
       # # # # #      column 3 = same          = 0x09
       # . . . #      column 4 = rows 1-6      = 0x7e
       # . . . #
       # . . . #      →  [0x7e, 0x09, 0x09, 0x09, 0x7e]

   The numbers are generated rather than typed — the glyphs were drawn as
   seven rows of five characters and compiled down — which is why there is no
   ASCII art left in this file. Keeping the art here was tried first and
   abandoned: five hundred lines of dots that have to be re-parsed on every
   page load, to describe something the reader can decode from the paragraph
   above in about ten seconds.

   MONOSPACE, DELIBERATELY

   Every glyph advances six pixels — five of ink and one of air — including
   the full stop and the comma. Proportional spacing at this size buys almost
   nothing and costs the one thing the HUD actually needs, which is that a
   score of 1,000,000 does not shuffle sideways as it counts up. This is
   tabular figures, achieved by not having any other kind.

   THE HALO

   Text has to sit on white snow at noon and on a dark blue sky at midnight,
   and there is no plate behind it. The answer at this resolution is a one
   pixel dark outline, and the obvious way to get one — draw the string eight
   times in dark at the eight neighbouring offsets, then once in colour —
   costs nine passes over every character on screen.

   Instead each glyph's outline is derived once and cached: the 5×7 bitmap is
   dilated by one pixel in all eight directions into a 7×9 bitmap, which is
   four lines of bit arithmetic because the encoding is already columns of
   bits. Smearing a column vertically is `c | c << 1 | c >> 1`; smearing
   horizontally is OR-ing each column with its two neighbours. The outline
   then costs one pass instead of eight, and it is a true outline rather than
   the drop shadow that was the first, cheaper answer — a drop shadow reads
   fine over snow and vanishes entirely over a night sky, which is exactly
   half the job.

   Because the advance is six and the ink is five, a glyph's outline occupies
   the one column of air on either side and never touches its neighbour's
   ink. That is why the outline can be drawn as one pass for the whole string
   and the ink as a second: nothing in the second pass can be undone by the
   first.

   At sizes above 1× the outline scales with the glyph, so 2× type gets a two
   pixel keyline. That is intentional. The outline is one pixel *of the
   font's own grid*, not one pixel of the framebuffer, and a 2× number with a
   1× keyline reads as a big number someone forgot to finish. */

export const GLYPH_W = 5;    // pixels of ink across
export const GLYPH_H = 7;    // and down
export const ADVANCE = 6;    // ink plus the one column of air that carries the outline
export const LINE = 9;       // recommended line pitch: seven of glyph, two of air

/* A-Z, 0-9, and the punctuation the read-out actually speaks: the comma in
   a score, the full stop in a distance, the solidus in KM/H, the middle dot
   that separates the two halves of the conditions line, the multiplication
   sign in a combo, the plus in an award, and the brackets in (SKETCHY).
   There is no lower case — `drawText` upper-cases everything on the way in,
   which is not a limitation so much as the house style stated in code. */
const GLYPHS = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  'A': [0x7e, 0x09, 0x09, 0x09, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x41, 0x3e],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x3a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x41, 0x41, 0x7f, 0x41, 0x41],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x04, 0x02, 0x7f],
  'N': [0x7f, 0x02, 0x04, 0x08, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x7f, 0x20, 0x10, 0x20, 0x7f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x03, 0x04, 0x78, 0x04, 0x03],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],   // with the diagonal, so it is not an O
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],  // full stop
  ',': [0x40, 0x30, 0x30, 0x00, 0x00],  // comma — the tail is the row below
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],  // colon
  '·': [0x00, 0x18, 0x18, 0x00, 0x00],  // middle dot
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],  // plus
  '×': [0x00, 0x14, 0x08, 0x14, 0x00],  // multiplication — smaller than X, on purpose
  '—': [0x08, 0x08, 0x08, 0x08, 0x08],  // em dash
  '-': [0x00, 0x08, 0x08, 0x08, 0x00],  // hyphen
  '°': [0x00, 0x07, 0x05, 0x07, 0x00],  // degree
  '/': [0x60, 0x10, 0x08, 0x04, 0x03],  // solidus
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],  // per cent
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
};

/* Anything not in the table draws as a hollow box, which is the honest
   answer: a missing glyph should look missing rather than look like a
   space, because a space is a thing the layout might legitimately want. */
const TOFU = [0x7f, 0x41, 0x41, 0x41, 0x7f];

/* The dilation described in the header. The glyph's rows 0-6 land on the
   halo's rows 1-7, which is what the `<< 1` is; rows 0 and 8 of the halo can
   only ever be lit by the vertical smear, which is exactly right. */
const halos = new Map();

function haloFor(ch) {
  let h = halos.get(ch);
  if (h) return h;
  const g = GLYPHS[ch] || TOFU;
  const smeared = [0, 0, 0, 0, 0];
  for (let i = 0; i < GLYPH_W; i++) {
    const c = g[i] << 1;
    smeared[i] = c | (c << 1) | (c >> 1);
  }
  h = new Array(GLYPH_W + 2);
  for (let i = 0; i < h.length; i++) {
    // Halo column i sits over glyph column i-1, so it wants that column and
    // the two either side of it — i-2, i-1 and i in glyph coordinates.
    h[i] = (i >= 2 ? smeared[i - 2] : 0)
      | (i >= 1 && i - 1 < GLYPH_W ? smeared[i - 1] : 0)
      | (i < GLYPH_W ? smeared[i] : 0);
  }
  halos.set(ch, h);
  return h;
}

/* One column of a glyph, emitted as vertical runs rather than per pixel. A
   capital letter is five columns of one or two runs each, so a glyph costs
   about eight fillRects instead of thirty-five — and every one of them lands
   on integer coordinates with no transform on the context, which is the only
   way to be certain nothing gets resampled. */
function column(ctx, bits, rows, x, y, size) {
  if (!bits) return;
  let r = 0;
  while (r < rows) {
    if (!(bits & (1 << r))) {
      r += 1;
      continue;
    }
    let end = r + 1;
    while (end < rows && (bits & (1 << end))) end += 1;
    ctx.fillRect(x, y + r * size, size, (end - r) * size);
    r = end;
  }
}

/* Width of a string once drawn, in buffer pixels. The trailing column of air
   is not counted, so right-aligning against this puts ink where you asked
   for it rather than a pixel short. */
export function measure(str, size = 1) {
  const n = String(str).length;
  return n ? n * ADVANCE * size - size : 0;
}

/* The glyph, baked. Runs of fillRects are the right way to draw a glyph
   once; they are the wrong way to draw the same glyph sixty times a second.
   A score line at the larger stop is a couple of hundred rectangles a frame
   for pixels that have not changed since the last time they were filled. So
   a glyph is rendered exactly once per (character, size, colour, halo) into
   a sprite of its own — halo pass first, ink pass over it, the same two
   passes in the same order as before, so the pixels are the ones the direct
   path produced — and every appearance after that is one drawImage.

   The sprite carries the one-pixel apron the halo needs, which is why it is
   two font pixels wider and taller than the ink and why it is blitted one
   `size` up and left of where the ink was asked for. Compositing per glyph
   instead of per pass is safe for the same reason the two passes were: a
   halo can overlap its neighbour's halo (same opaque colour, no seam) but
   never its neighbour's ink, so glyph-at-a-time and pass-at-a-time agree to
   the pixel.

   The cache is bounded and simply emptied when it fills. The working set is
   tiny — a few dozen glyphs, a handful of discrete UI sizes, a fixed palette
   — so the bound exists for the pathological caller, not the expected one,
   and rebaking after a flush costs one frame of the old path. */
const sprites = new Map();
const SPRITE_LIMIT = 384;

function spriteFor(ch, size, colour, halo) {
  const key = `${ch} ${size} ${colour} ${halo || ''}`;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size >= SPRITE_LIMIT) sprites.clear();

  s = document.createElement('canvas');
  s.width = (GLYPH_W + 2) * size;
  s.height = (GLYPH_H + 2) * size;
  const g = s.getContext('2d');

  if (halo) {
    g.fillStyle = halo;
    const h = haloFor(ch);
    for (let c = 0; c < h.length; c++) column(g, h[c], GLYPH_H + 2, c * size, 0, size);
  }
  g.fillStyle = colour;
  const glyph = GLYPHS[ch] || TOFU;
  for (let c = 0; c < GLYPH_W; c++) column(g, glyph[c], GLYPH_H, (c + 1) * size, size, size);

  sprites.set(key, s);
  return s;
}

/* Draws `str` with its top-left ink pixel at (x, y). `size` must be a whole
   number — 1 or 2 is what the HUD uses — and there is deliberately no
   fractional path, because a half-scaled bitmap font is just a blurry one.
   `halo` is the outline colour, or null for none.

   Each glyph is a cached sprite blitted at integer coordinates and native
   scale, so nothing gets resampled — the same guarantee the fillRect path
   gave, at a fraction of the calls. The space glyph is skipped outright:
   its sprite would be entirely transparent, and a drawImage of nothing is
   still a drawImage. */
export function drawText(ctx, str, x, y, colour, size = 1, halo = null) {
  const text = String(str).toUpperCase();
  const step = ADVANCE * size;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') continue;
    ctx.drawImage(spriteFor(text[i], size, colour, halo), x + i * step - size, y - size);
  }

  return measure(text, size);
}
