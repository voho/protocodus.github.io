/* Protocodus — just enough JavaScript.
   Entrance sequence, scroll reveals, the mobile menu, the mint dash in the
   spine that marks the section you are reading, and Conway's Life running
   quietly behind the hero. Nothing else. */

(() => {
  'use strict';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===========================================================================
  // Entrance
  // ===========================================================================
  requestAnimationFrame(() => root.classList.add('ready'));

  // ===========================================================================
  // Footer year
  // ===========================================================================
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ===========================================================================
  // Mobile menu
  // ===========================================================================
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('spine-menu');

  if (toggle && menu) {
    const setMenu = (open) => {
      menu.classList.toggle('open', open);
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
  const links = [...document.querySelectorAll('.index-link')];
  const targets = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if (targets.length && 'IntersectionObserver' in window) {
    const onScreen = new Set();

    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      });

      // The topmost section crossing the middle of the viewport wins.
      const active = targets.find((section) => onScreen.has(section));
      links.forEach((link, i) => {
        const current = targets[i] === active;
        link.classList.toggle('current', current);
        // The dash is only half the message — say it out loud too
        if (current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });

    targets.forEach((section) => spy.observe(section));
  }

  // ===========================================================================
  // Conway's Life behind the hero
  //
  // Wrapped on a torus so the field never runs out of room, and slow enough
  // to read as weather rather than animation. A finite board always settles
  // into still lifes and blinkers, so a glider is dropped in periodically —
  // it travels forever and breaks up whatever it collides with, which is what
  // keeps the thing genuinely infinite instead of merely long.
  // ===========================================================================
  const CELL = 26;        // lattice spacing, px
  const DOT = 3.4;        // drawn size of a live cell
  const GEN_MS = 1500;    // one generation
  const DENSITY = 0.16;   // share of cells alive at seed
  const ALIVE_A = 0.13;   // alpha of a settled cell
  const BORN_A = 0.85;    // extra brightness while a cell is being born
  const GLIDER_EVERY = 9; // generations
  const MINT = [0, 255, 195];
  const YELLOW = [255, 196, 0];

  // The five cells of a glider, in each of its four orientations
  const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

  class Life {
    constructor(host) {
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'life';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.ctx = this.canvas.getContext('2d');
      host.prepend(this.canvas);

      this.visible = false;
      this.onWake = null;
      this.gen = 0;
      this.last = 0;
      this.recent = [];

      new ResizeObserver(() => this.resize()).observe(host);
      new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible && this.onWake) this.onWake();
      }).observe(host);

      this.resize();
    }

    resize() {
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      if (!w || !h) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // A canvas without an explicit CSS size renders at its backing-store
      // size, which doubles it on any dpr > 1 screen.
      this.w = w;
      this.h = h;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil(w / CELL) + 1;
      const rows = Math.ceil(h / CELL) + 1;
      if (cols === this.cols && rows === this.rows) return;

      this.cols = cols;
      this.rows = rows;
      this.cur = new Uint8Array(cols * rows);
      this.born = new Uint8Array(cols * rows);
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
      const born = new Uint8Array(cur.length);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const n = this.neighbours(x, y);
          next[i] = cur[i] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
          born[i] = next[i] && !cur[i] ? 1 : 0;
        }
      }

      this.prev = cur;
      this.cur = next;
      this.born = born;
      this.gen += 1;

      if (this.gen % GLIDER_EVERY === 0 || this.settled()) this.addGlider();
    }

    // Still lifes repeat immediately, blinkers every other generation; a short
    // window of recent states catches both without tracking the whole history.
    settled() {
      let hash = 2166136261;
      for (let i = 0; i < this.cur.length; i++) {
        hash = ((hash ^ this.cur[i]) * 16777619) >>> 0;
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

    draw(now) {
      const { ctx, w, h, cols, rows, cur, prev, born } = this;
      ctx.clearRect(0, 0, w, h);

      const t = Math.min((now - this.last) / GEN_MS, 1);
      const ease = t * t * (3 - 2 * t);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const from = prev[i];
          const to = cur[i];
          if (!from && !to) continue;

          const life = from + (to - from) * ease;
          if (life < 0.02) continue;

          // A newborn cell arrives gold and cools to mint as it settles
          const spark = born[i] ? 1 - ease : 0;
          const alpha = life * ALIVE_A * (1 + spark * BORN_A);
          const r = Math.round(MINT[0] + (YELLOW[0] - MINT[0]) * spark);
          const g = Math.round(MINT[1] + (YELLOW[1] - MINT[1]) * spark);
          const b = Math.round(MINT[2] + (YELLOW[2] - MINT[2]) * spark);

          ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          ctx.fillRect(x * CELL - DOT / 2, y * CELL - DOT / 2, DOT, DOT);
        }
      }
    }
  }

  const hero = document.querySelector('.hero');

  if (hero && !reduced && 'ResizeObserver' in window) {
    const field = new Life(hero);
    let running = false;

    const frame = (now) => {
      if (!field.visible || document.hidden) {
        running = false;
        return;
      }
      if (!field.last) field.last = now;
      if (now - field.last >= GEN_MS) {
        field.step();
        field.last = now;
      }
      field.draw(now);
      requestAnimationFrame(frame);
    };

    // Runs only while the hero is on screen and the tab is in front
    const wake = () => {
      if (running || document.hidden) return;
      running = true;
      requestAnimationFrame(frame);
    };

    field.onWake = wake;
    document.addEventListener('visibilitychange', wake);
    wake();
  }
})();
