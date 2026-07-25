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
  // Conway's Life behind the hero
  //
  // Wrapped on a torus so the field never runs out of room, and slow enough to
  // read as weather rather than animation. A finite board always settles into
  // still lifes and blinkers, so a glider is dropped in periodically — it
  // travels forever and breaks up whatever it collides with, which is what
  // keeps the field genuinely infinite instead of merely long-running.
  // ===========================================================================
  const CELL = 26;         // lattice spacing, px
  const DOT = 3.4;         // drawn size of a live cell
  const GEN_MS = 1500;     // one generation
  const FADE_MS = 600;     // crossfade; the rest of the generation is held still
  const DENSITY = 0.16;    // share of cells alive at seed
  const ALIVE_A = 0.13;    // alpha of a settled cell
  const BORN_A = 0.85;     // extra brightness while a cell is being born
  const GLIDER_EVERY = 9;  // generations
  const DPR_CAP = 1.5;     // 3.4px dots at 13% alpha do not repay a full 2x

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
      this.mintCss = `rgb(${this.mint.join()})`;

      this.gen = 0;
      this.last = 0;
      this.recent = [];
      this.visible = false;
      this.running = false;
      this.held = false;

      this.frame = this.frame.bind(this);
      this.wake = this.wake.bind(this);

      new ResizeObserver(() => this.resize()).observe(host);
      new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.wake();
      }).observe(host);
      document.addEventListener('visibilitychange', this.wake);

      this.resize();
      this.wake();
    }

    resize() {
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      if (!w || !h) return;

      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);

      // Assigning canvas.width clears the bitmap and resets the context even
      // when the value is unchanged, so only touch it when it really moved
      if (bw !== this.canvas.width || bh !== this.canvas.height) {
        this.canvas.width = bw;
        this.canvas.height = bh;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.held = false;
      }
      this.w = w;
      this.h = h;

      const cols = Math.ceil(w / CELL) + 1;
      const rows = Math.ceil(h / CELL) + 1;
      if (cols === this.cols && rows === this.rows) return;

      this.cols = cols;
      this.rows = rows;
      this.cur = new Uint8Array(cols * rows);
      for (let i = 0; i < this.cur.length; i++) {
        this.cur[i] = Math.random() < DENSITY ? 1 : 0;
      }
      this.prev = this.cur.slice();
      this.recent = [];
    }

    neighbours(x, y) {
      const { cols, rows, cur } = this;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = (x + dx + cols) % cols;
          const ny = (y + dy + rows) % rows;
          n += cur[ny * cols + nx];
        }
      }
      return n;
    }

    step() {
      const { cols, rows, cur } = this;
      const next = new Uint8Array(cur.length);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const n = this.neighbours(x, y);
          next[i] = cur[i] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
        }
      }

      this.prev = cur;
      this.cur = next;
      this.gen += 1;
      this.held = false;

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
      const { cols, rows, cur } = this;
      const ox = Math.floor(Math.random() * cols);
      const oy = Math.floor(Math.random() * rows);
      const flipX = Math.random() < 0.5;
      const flipY = Math.random() < 0.5;

      GLIDER.forEach(([gx, gy]) => {
        const x = (ox + (flipX ? 2 - gx : gx)) % cols;
        const y = (oy + (flipY ? 2 - gy : gy)) % rows;
        cur[y * cols + x] = 1;
      });
    }

    // Every cell in a frame is a survivor, a death or a birth, which is only
    // three colours — so paint the board in three passes rather than changing
    // fillStyle a few hundred times.
    paint(kind) {
      const { ctx, cols, rows, cur, prev } = this;
      const offset = DOT / 2;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const from = prev[i];
          const to = cur[i];
          const match = kind === SURVIVOR ? from && to
            : kind === DYING ? from && !to
              : !from && to;
          if (!match) continue;
          ctx.fillRect(x * CELL - offset, y * CELL - offset, DOT, DOT);
        }
      }
    }

    draw(now) {
      const { ctx, w, h } = this;
      const t = Math.min((now - this.last) / FADE_MS, 1);

      // Once the crossfade lands the board is identical until the next
      // generation, so there is nothing to repaint for the rest of it
      if (t === 1 && this.held) return;
      this.held = t === 1;

      const ease = t * t * (3 - 2 * t);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.mintCss;

      ctx.globalAlpha = ALIVE_A;
      this.paint(SURVIVOR);

      ctx.globalAlpha = (1 - ease) * ALIVE_A;
      this.paint(DYING);

      // A newborn cell arrives gold and cools to mint as it settles
      const spark = 1 - ease;
      const r = Math.round(this.mint[0] + (this.yellow[0] - this.mint[0]) * spark);
      const g = Math.round(this.mint[1] + (this.yellow[1] - this.mint[1]) * spark);
      const b = Math.round(this.mint[2] + (this.yellow[2] - this.mint[2]) * spark);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.globalAlpha = ease * ALIVE_A * (1 + spark * BORN_A);
      this.paint(NEWBORN);

      ctx.globalAlpha = 1;
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
