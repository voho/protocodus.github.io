/* Protocodus — just enough JavaScript.
   Entrance sequence, scroll reveals, the mobile menu, the mint dash in the
   spine that marks the section you are reading, and Conway's Life running
   quietly behind the hero. Nothing else. */

(() => {
  'use strict';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Arms the entrance transitions; see the .ready rules in the stylesheet
  requestAnimationFrame(() => root.classList.add('ready'));

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ===========================================================================
  // Mobile menu
  // ===========================================================================
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('spine-menu');

  if (toggle && menu) {
    // `hidden` is the only state — the stylesheet reads it directly
    const setMenu = (open) => {
      menu.hidden = !open;
      document.body.style.overflow = open ? 'hidden' : '';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };

    toggle.addEventListener('click', () => setMenu(menu.hidden));
    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenu(false));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  // ===========================================================================
  // Scroll reveals
  // ===========================================================================
  const revealed = document.querySelectorAll('.reveal');

  if (reduced || !('IntersectionObserver' in window)) {
    revealed.forEach((el) => el.classList.add('visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    revealed.forEach((el) => observer.observe(el));
  }

  // ===========================================================================
  // Spine index — mark the section you are reading
  // ===========================================================================
  const sections = [...document.querySelectorAll('.index-link')]
    .map((link) => ({ link, section: document.querySelector(link.getAttribute('href')), on: false }))
    .filter((entry) => entry.section);

  if (sections.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const match = sections.find((s) => s.section === entry.target);
        if (match) match.on = entry.isIntersecting;
      });

      // The topmost section crossing the middle of the viewport wins
      const active = sections.find((s) => s.on);
      sections.forEach(({ link }) => {
        const current = link === active?.link;
        link.classList.toggle('current', current);
        // The dash is only half the message — say it out loud too
        if (current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });

    sections.forEach(({ section }) => spy.observe(section));
  }

  // ===========================================================================
  // Conway's Life behind the hero, in four species
  //
  // Wrapped on a torus so the field never runs out of room, and slow enough to
  // read as weather rather than animation. A finite board always settles into
  // still lifes and blinkers, so a glider is dropped in periodically — it
  // travels forever and breaks up whatever it collides with, which is what
  // keeps the field genuinely infinite instead of merely long-running.
  //
  // The rule is QuadLife: births and deaths follow Conway exactly, so the
  // dynamics are the ones that are known to stay interesting, but every live
  // cell also carries a species. A cell born to parents of two or fewer
  // species joins the majority; a cell born where three *different* species
  // meet becomes the fourth. So the glyphs are not decoration — they are
  // inheritance, and you can watch one lineage overrun another.
  //
  // Newborns of any species show the mark for one generation before settling
  // into their own, which is the only place gold appears out here.
  // ===========================================================================
  const CELL = 26;         // lattice spacing, px
  const GLYPH_PX = 15;     // type size of a live cell
  const GEN_MS = 200;      // one generation — five a second
  const DENSITY = 0.16;    // share of cells alive at seed
  // A glyph's strokes carry roughly half the ink of the solid dot they
  // replaced, and spread it thinner, so this is well above the old 0.13
  const ALIVE_A = 0.34;
  const BORN_A = 0.85;     // extra brightness while a cell is being born
  const GLIDER_EVERY = 30; // generations — about one every six seconds
  const DPR_CAP = 2;       // glyphs, unlike squares, do repay the extra pixels

  // Every cell crossfades across its whole generation, so the field is never
  // still — no held frame, no step you can catch it taking
  const GLOW_PX = 7;       // halo baked into each sprite
  const GLOW_PASSES = 2;   // stamped twice, for a denser bloom
  const DRIFT_PX = 9;      // ambient wander of the whole lattice
  const PARALLAX_PX = 14;  // how far the field leans towards the pointer
  const EASE_TO_POINTER = 0.045;

  // Species 1-4, plus the mark every newborn wears for its first generation
  const GLYPHS = ['{', '}', '+', '*'];
  const NEWBORN_GLYPH = '✦';

  // One glider; addGlider() reflects it into the other three orientations
  const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

  // Cell states, as bucketed by draw()
  const SURVIVOR = 0;
  const DYING = 1;
  const NEWBORN = 2;

  const readToken = (name) => {
    const hex = getComputedStyle(root).getPropertyValue(name).trim();
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  };

  class Life {
    constructor(host) {
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'life';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.ctx = this.canvas.getContext('2d');
      host.prepend(this.canvas);

      // The palette lives in :root; reading it keeps one source of truth
      this.mint = readToken('--mint');
      this.yellow = readToken('--yellow');

      this.sprites = [];
      this.gen = 0;
      this.last = 0;
      this.recent = [];
      this.visible = false;
      this.running = false;

      // -1..1 from the centre of the viewport; leanX/Y chase it, one frame at
      // a time, so the field arrives late and settles rather than tracking
      this.pointerX = 0;
      this.pointerY = 0;
      this.leanX = 0;
      this.leanY = 0;

      this.frame = this.frame.bind(this);
      this.wake = this.wake.bind(this);

      if (window.matchMedia('(pointer: fine)').matches) {
        // Recording only — the value is read once per frame in draw()
        window.addEventListener('pointermove', (e) => {
          this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
          this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        }, { passive: true });
      }

      new ResizeObserver(() => this.resize()).observe(host);
      new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.wake();
      }).observe(host);
      document.addEventListener('visibilitychange', this.wake);

      this.resize();
      this.wake();

      // Sprites raster the glyphs, so they have to wait for the real face
      if (document.fonts) {
        document.fonts.ready.then(() => {
          this.spriteDpr = null;
          this.resize();
          this.wake();
        });
      }
    }

    resize() {
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      if (!w || !h) return;

      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      this.buildSprites(dpr);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);

      // Assigning canvas.width clears the bitmap and resets the context even
      // when the value is unchanged, so only touch it when it really moved
      if (bw !== this.canvas.width || bh !== this.canvas.height) {
        this.canvas.width = bw;
        this.canvas.height = bh;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.w = w;
      this.h = h;

      // Two spare rows and columns each way, so the drift and the parallax
      // never pull the lattice off its own edge
      const cols = Math.ceil(w / CELL) + 4;
      const rows = Math.ceil(h / CELL) + 4;
      if (cols === this.cols && rows === this.rows) return;

      this.cols = cols;
      this.rows = rows;
      this.cur = new Uint8Array(cols * rows);
      // 0 is dead; 1-4 name the species a live cell belongs to
      this.kind = new Uint8Array(cols * rows);
      for (let i = 0; i < this.cur.length; i++) {
        if (Math.random() >= DENSITY) continue;
        this.cur[i] = 1;
        this.kind[i] = 1 + Math.floor(Math.random() * GLYPHS.length);
      }
      this.prev = this.cur.slice();
      this.prevKind = this.kind.slice();
      this.recent = [];
    }

    // Each glyph is rasterised once per colour and stamped from then on —
    // an image blit per cell rather than shaping text a few hundred times a
    // frame. Rebuilt only when the device pixel ratio changes.
    buildSprites(dpr) {
      if (this.spriteDpr === dpr) return;
      this.spriteDpr = dpr;

      // Room for the glyph plus its halo on every side
      const box = Math.ceil(GLYPH_PX + GLOW_PX * 4);
      const font = getComputedStyle(root).getPropertyValue('--display');

      const draw = (glyph, rgb, scale = 1) => {
        const c = document.createElement('canvas');
        c.width = c.height = Math.ceil(box * dpr);
        const g = c.getContext('2d');
        g.scale(dpr, dpr);
        g.font = `${GLYPH_PX * scale}px ${font}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = `rgb(${rgb.join()})`;

        // The blur is rasterised into the sprite, so a cell still costs one
        // drawImage at runtime rather than a second blurred pass
        g.shadowColor = `rgb(${rgb.join()})`;
        g.shadowBlur = GLOW_PX;
        for (let i = 0; i < GLOW_PASSES; i++) g.fillText(glyph, box / 2, box / 2);

        g.shadowBlur = 0;
        g.fillText(glyph, box / 2, box / 2);
        return c;
      };

      this.box = box;
      this.sprites = GLYPHS.map((glyph) => draw(glyph, this.mint));
      this.newbornSprite = draw(NEWBORN_GLYPH, this.yellow, 1.15);
    }

    // Counts live neighbours, and fills `tally` with how many of each species
    // they were — the caller reuses one array so this allocates nothing.
    neighbours(x, y, tally) {
      const { cols, rows, cur, kind } = this;
      let n = 0;
      tally[1] = tally[2] = tally[3] = tally[4] = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = ((y + dy + rows) % rows) * cols + (x + dx + cols) % cols;
          if (!cur[j]) continue;
          n += 1;
          tally[kind[j]] += 1;
        }
      }
      return n;
    }

    // QuadLife's inheritance: a newborn joins whichever of its three parents
    // is in the majority, and where all three differ it becomes the fourth
    // species — the only way a species that has died out can come back.
    inherit(tally) {
      let majority = 0;
      let missing = 0;
      let distinct = 0;

      for (let s = 1; s <= GLYPHS.length; s++) {
        if (tally[s] === 0) missing = s;
        else distinct += 1;
        if (tally[s] >= 2) majority = s;
      }
      if (majority) return majority;
      return distinct === 3 ? missing : 1;
    }

    step() {
      const { cols, rows, cur, kind } = this;
      const next = new Uint8Array(cur.length);
      const nextKind = new Uint8Array(cur.length);
      const tally = [0, 0, 0, 0, 0];

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const n = this.neighbours(x, y, tally);

          if (cur[i]) {
            // Survivors keep their species; Conway decides whether they live
            const lives = n === 2 || n === 3;
            next[i] = lives ? 1 : 0;
            nextKind[i] = lives ? kind[i] : 0;
          } else if (n === 3) {
            next[i] = 1;
            nextKind[i] = this.inherit(tally);
          }
        }
      }

      this.prev = cur;
      this.prevKind = kind;
      this.cur = next;
      this.kind = nextKind;
      this.gen += 1;

      const stalled = this.record();
      if (stalled || this.gen % GLIDER_EVERY === 0) this.addGlider();
    }

    // Still lifes repeat immediately, blinkers every other generation; a short
    // window of recent states catches both without keeping the whole history.
    // Recorded every generation so the window never gains a hole.
    record() {
      let hash = 2166136261;
      for (let i = 0; i < this.cur.length; i++) {
        hash = Math.imul(hash ^ this.cur[i], 16777619) >>> 0;
      }
      const seen = this.recent.includes(hash);
      this.recent.push(hash);
      if (this.recent.length > 4) this.recent.shift();
      return seen;
    }

    addGlider() {
      const { cols, rows, cur, kind } = this;
      const ox = Math.floor(Math.random() * cols);
      const oy = Math.floor(Math.random() * rows);
      const flipX = Math.random() < 0.5;
      const flipY = Math.random() < 0.5;
      const species = 1 + Math.floor(Math.random() * GLYPHS.length);

      GLIDER.forEach(([gx, gy]) => {
        const x = (ox + (flipX ? 2 - gx : gx)) % cols;
        const y = (oy + (flipY ? 2 - gy : gy)) % rows;
        cur[y * cols + x] = 1;
        kind[y * cols + x] = species;
      });
    }

    // Every cell in a frame is a survivor, a death or a birth, and each of
    // those has one alpha — so the board paints in three passes and the only
    // per-cell work is stamping a pre-rendered glyph.
    paint(state) {
      const { ctx, cols, rows, cur, prev, kind, prevKind, sprites, box } = this;
      const half = box / 2;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const from = prev[i];
          const to = cur[i];
          const match = state === SURVIVOR ? from && to
            : state === DYING ? from && !to
              : !from && to;
          if (!match) continue;

          // A dying cell wears the species it had, not the one it lost
          const species = state === DYING ? prevKind[i] : kind[i];
          const sprite = state === NEWBORN ? this.newbornSprite : sprites[species - 1];
          if (!sprite) continue;
          ctx.drawImage(sprite, x * CELL - half - CELL * 2, y * CELL - half - CELL * 2, box, box);
        }
      }
    }

    draw(now) {
      const { ctx, w, h } = this;

      // The crossfade spans the whole generation, so a cell is always either
      // arriving or leaving and the field never holds a frame
      const t = Math.min((now - this.last) / GEN_MS, 1);
      const ease = t * t * (3 - 2 * t);

      // Two slow sines the eye cannot lock onto, plus a lean towards the
      // pointer that lags behind it — together they read as depth, not motion
      const s = now / 1000;
      this.leanX += (this.pointerX - this.leanX) * EASE_TO_POINTER;
      this.leanY += (this.pointerY - this.leanY) * EASE_TO_POINTER;
      const dx = Math.sin(s * 0.11) * DRIFT_PX + this.leanX * PARALLAX_PX;
      const dy = Math.cos(s * 0.083) * DRIFT_PX + this.leanY * PARALLAX_PX;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(dx, dy);

      ctx.globalAlpha = ALIVE_A;
      this.paint(SURVIVOR);

      ctx.globalAlpha = (1 - ease) * ALIVE_A;
      this.paint(DYING);

      // The newborn mark fades in brighter than the rest, then hands over to
      // the cell's own species on the next generation
      const spark = 1 - ease;
      ctx.globalAlpha = ease * ALIVE_A * (1 + spark * BORN_A);
      this.paint(NEWBORN);

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    frame(now) {
      if (!this.visible || document.hidden) {
        this.running = false;
        return;
      }
      if (!this.last) this.last = now;
      if (now - this.last >= GEN_MS) {
        this.step();
        this.last = now;
      }
      this.draw(now);
      requestAnimationFrame(this.frame);
    }

    // Runs only while the hero is on screen and the tab is in front
    wake() {
      if (this.running || !this.visible || document.hidden) return;
      this.running = true;
      requestAnimationFrame(this.frame);
    }
  }

  const hero = document.querySelector('.hero');

  if (hero && !reduced && 'ResizeObserver' in window) {
    // A background decoration has no business on the path to first paint —
    // it allocates a canvas and forces layout to measure the hero
    const begin = () => new Life(hero);
    if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 2000 });
    else setTimeout(begin, 200);
  }
})();
