document.addEventListener('DOMContentLoaded', () => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =========================================================================
  // Footer year
  // =========================================================================
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // =========================================================================
  // Mobile menu
  // =========================================================================
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    const setMenu = (open) => {
      navMenu.classList.toggle('active', open);
      navToggle.classList.toggle('active', open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };

    navToggle.addEventListener('click', () => {
      setMenu(!navMenu.classList.contains('active'));
    });

    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenu(false));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navMenu.classList.contains('active')) {
        setMenu(false);
        navToggle.focus();
      }
    });
  }

  // =========================================================================
  // Navbar — underline the section you are currently reading
  // =========================================================================
  const navLinks = [...document.querySelectorAll('.nav-link')];
  const navTargets = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if (navTargets.length && 'IntersectionObserver' in window) {
    const onScreen = new Set();

    const sectionSpy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      });

      // The topmost section crossing the middle of the viewport wins.
      const active = navTargets.find((section) => onScreen.has(section));
      navLinks.forEach((link, i) => {
        const current = navTargets[i] === active;
        link.classList.toggle('current', current);
        // The underline is only half the message — say it out loud too
        if (current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-50% 0px -45% 0px' });

    navTargets.forEach((section) => sectionSpy.observe(section));
  }

  // =========================================================================
  // Scroll reveal
  // =========================================================================
  const revealEls = document.querySelectorAll('.reveal');

  if (prefersReducedMotion) {
    revealEls.forEach((el) => el.classList.add('visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach((el) => revealObserver.observe(el));
  }

  // =========================================================================
  // Hero eyebrow — typewriter
  // =========================================================================
  const typeTarget = document.querySelector('.type-target');
  if (typeTarget && !prefersReducedMotion) {
    const fullText = typeTarget.textContent;
    typeTarget.textContent = '';
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      typeTarget.textContent = fullText.slice(0, i);
      if (i >= fullText.length) {
        clearInterval(timer);
      }
    }, 32);
  }

  // =========================================================================
  // Hero sparks — mouse parallax
  // =========================================================================
  const hero = document.querySelector('.hero');
  const sparks = document.querySelectorAll('.hero-spark');
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (hero && sparks.length && finePointer && !prefersReducedMotion) {
    let pointerX = 0;
    let pointerY = 0;
    let queued = false;

    // One write per frame instead of one per mousemove event
    const drift = () => {
      queued = false;
      const dx = (pointerX - window.innerWidth / 2) / (window.innerWidth / 2);
      const dy = (pointerY - window.innerHeight / 2) / (window.innerHeight / 2);
      sparks.forEach((spark) => {
        const depth = parseFloat(spark.dataset.depth || '1');
        spark.style.transform = `translate(${dx * 12 * depth}px, ${dy * 12 * depth}px)`;
      });
    };

    hero.addEventListener('mousemove', (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(drift);
    });
  }

  // =========================================================================
  // Living dot grid — canvas background for [data-dotgrid] sections.
  // Same pattern as the CSS fallback, plus an ambient shimmer, a magnetic
  // halo around the pointer, and a ripple wave on click.
  // =========================================================================
  const DOT_SPACING = 30;
  const DOT_RADIUS = 1.5;
  const DOT_ALPHA = 0.11;
  const POINTER_RADIUS = 150;
  const RIPPLE_SPEED = 380; // px/s
  const RIPPLE_WIDTH = 55;
  const RIPPLE_LIFE = 1.8; // s
  const INK = [26, 26, 26];
  const AQUA = [0, 184, 148];

  class DotGrid {
    constructor(section) {
      this.section = section;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'dotgrid-canvas';
      this.ctx = this.canvas.getContext('2d');
      section.prepend(this.canvas);
      section.classList.add('dotgrid-active');

      this.pointer = { x: -1e4, y: -1e4 };
      this.ripples = [];
      this.visible = false;
      this.onWake = null;

      new ResizeObserver(() => this.resize()).observe(section);
      new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible && this.onWake) this.onWake();
      }).observe(section);

      section.addEventListener('pointermove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = e.clientX - rect.left;
        this.pointer.y = e.clientY - rect.top;
      });
      const clearPointer = () => {
        this.pointer.x = -1e4;
        this.pointer.y = -1e4;
      };
      section.addEventListener('pointerleave', clearPointer);
      section.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'mouse') clearPointer();
      });
      section.addEventListener('pointerdown', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.ripples.push({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          start: performance.now()
        });
      });

      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = this.section.clientWidth;
      this.h = this.section.clientHeight;
      // Canvas is a replaced element: without an explicit CSS size it renders
      // at its intrinsic (backing-store) size instead of stretching to fill
      // the section, which on any dpr > 1 screen doubles it and throws off
      // every coordinate drawn relative to the pointer.
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw(now) {
      const { ctx, w, h, pointer } = this;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);

      const maxDist = Math.hypot(w, h) + RIPPLE_WIDTH * 3;
      this.ripples = this.ripples.filter((rp) => {
        const age = (now - rp.start) / 1000;
        return age < RIPPLE_LIFE && age * RIPPLE_SPEED < maxDist;
      });

      const cols = Math.ceil(w / DOT_SPACING);
      const rows = Math.ceil(h / DOT_SPACING);

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const baseX = (i + 0.5) * DOT_SPACING;
          const baseY = (j + 0.5) * DOT_SPACING;

          // Ambient shimmer: two slow crossing waves + per-dot phase jitter
          const phase = ((i * 7 + j * 13) % 10) * 0.06;
          const wave = Math.sin(baseX * 0.022 + t * 0.7 + phase) *
            Math.sin(baseY * 0.02 - t * 0.55);

          let x = baseX;
          let y = baseY;
          let radius = DOT_RADIUS + wave * 0.22;
          let alpha = DOT_ALPHA + wave * 0.03;
          let tint = 0;

          // Magnetic pointer halo: swell, tint, gentle push away
          const pdx = baseX - pointer.x;
          const pdy = baseY - pointer.y;
          if (Math.abs(pdx) < POINTER_RADIUS && Math.abs(pdy) < POINTER_RADIUS) {
            const dist = Math.sqrt(pdx * pdx + pdy * pdy);
            if (dist < POINTER_RADIUS) {
              const s = 1 - dist / POINTER_RADIUS;
              const ease = s * s * (3 - 2 * s);
              radius += ease * 1.15;
              alpha += ease * 0.34;
              tint = Math.min(1, ease * 1.2);
              const push = (ease * 7) / (dist || 1);
              x += pdx * push;
              y += pdy * push;
            }
          }

          // Expanding ripple rings from clicks
          for (const rp of this.ripples) {
            const age = (now - rp.start) / 1000;
            const rdx = baseX - rp.x;
            const rdy = baseY - rp.y;
            const dist = Math.sqrt(rdx * rdx + rdy * rdy);
            const fromRing = dist - age * RIPPLE_SPEED;
            const fade = 1 - age / RIPPLE_LIFE;
            const g = Math.exp(-(fromRing * fromRing) / (2 * RIPPLE_WIDTH * RIPPLE_WIDTH)) * fade;
            if (g > 0.01) {
              radius += g * 1.4;
              alpha += g * 0.3;
              const push = (g * 5) / (dist || 1);
              x += rdx * push;
              y += rdy * push;
            }
          }

          const r = (INK[0] + (AQUA[0] - INK[0]) * tint) | 0;
          const gr = (INK[1] + (AQUA[1] - INK[1]) * tint) | 0;
          const b = (INK[2] + (AQUA[2] - INK[2]) * tint) | 0;
          ctx.fillStyle = `rgba(${r},${gr},${b},${Math.min(alpha, 0.55)})`;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(radius, 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  if (!prefersReducedMotion && 'ResizeObserver' in window) {
    const grids = [...document.querySelectorAll('[data-dotgrid]')].map(
      (section) => new DotGrid(section)
    );

    if (grids.length) {
      // The loop only runs while a grid is actually on screen and the tab is
      // in front — no frames burned on a page nobody is looking at.
      let running = false;

      const loop = (now) => {
        let awake = false;
        grids.forEach((grid) => {
          if (grid.visible) {
            grid.draw(now);
            awake = true;
          }
        });
        running = awake && !document.hidden;
        if (running) requestAnimationFrame(loop);
      };

      const wake = () => {
        if (running || document.hidden) return;
        running = true;
        requestAnimationFrame(loop);
      };

      grids.forEach((grid) => { grid.onWake = wake; });
      document.addEventListener('visibilitychange', wake);
      wake();
    }
  }

  // =========================================================================
  // Hero — spark burst on click
  // =========================================================================
  const SPARK_PATH = 'M12 0L15 9L24 12L15 15L12 24L9 15L0 12L9 9Z';

  if (hero && !prefersReducedMotion) {
    hero.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;

      const rect = hero.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const count = 6;

      for (let i = 0; i < count; i++) {
        const el = document.createElement('span');
        el.className = 'burst-spark';
        el.style.left = `${x - 8}px`;
        el.style.top = `${y - 8}px`;
        const color = i % 2 === 0 ? '#FFC400' : '#00FFC3';
        el.innerHTML =
          `<svg viewBox="0 0 24 24"><path d="${SPARK_PATH}" fill="${color}" ` +
          `stroke="#1A1A1A" stroke-width="1.5"/></svg>`;
        hero.appendChild(el);

        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 44 + Math.random() * 46;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;

        el.animate([
          { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
          { transform: `translate(${tx}px, ${ty}px) scale(0) rotate(160deg)`, opacity: 0 }
        ], {
          duration: 620,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }).onfinish = () => el.remove();
      }
    });
  }
});
