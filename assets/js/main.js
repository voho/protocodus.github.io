/* Protocodus — the page script.

   Two pages share this file. The classic page is the one this site has
   always been: entrance sequence, scroll reveals, the mobile menu, the mint
   dash in the spine, and Conway's Life behind the hero. The voyage is the
   3D orbital experience layered over the same document.

   The gate below decides which one a visitor gets, and it is deliberately
   strict: the voyage requires JavaScript (you are here), WebGL, motion being
   welcome, and no standing request for text mode. Fail any test and the
   classic page renders exactly as before — the fallback is not a degraded
   voyage, it is the original site. */

(() => {
  'use strict';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Storage can throw — on the property access itself in a sandboxed frame,
  // or on the call in a private window. A preference that cannot be read is
  // a preference that was never set.
  const store = (name) => ({
    get(k) { try { return window[name].getItem(k); } catch { return null; } },
    set(k, v) { try { window[name].setItem(k, v); } catch { /* so be it */ } },
  });
  const local = store('localStorage');
  const session = store('sessionStorage');

  // Arms the entrance transitions; see the .ready rules in the stylesheet
  requestAnimationFrame(() => root.classList.add('ready'));

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ===========================================================================
  // The gate
  // ===========================================================================
  const canWebGL = () => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  };

  const voyageWanted =
    !reduced &&
    local.get('pcs-mode') !== 'text' &&
    session.get('pcs-no3d') !== '1' &&
    canWebGL();

  let voyage = null;        // the live 3D controller, once created
  let lifeStarted = false;

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
  // HUD — the instrument frame around the voyage. All of it is written from
  // here; the 3D side only reports numbers.
  // ===========================================================================
  const hud = {
    zone: document.querySelector('[data-hud-zone]'),
    stardate: document.querySelector('[data-hud-stardate]'),
    vel: document.querySelector('[data-hud-vel]'),
    hdg: document.querySelector('[data-hud-hdg]'),
    rng: document.querySelector('[data-hud-rng]'),
    hint: document.querySelector('[data-hud-hint]'),
    sound: document.querySelector('[data-hud-sound]'),
    text: document.querySelector('[data-hud-text]'),
    railShip: document.querySelector('[data-rail-ship]'),
  };

  const ZONE_LABELS = {
    approach: 'APPROACH VECTOR',
    forge: 'WP-01 · THE FORGE',
    lanes: 'WP-02 · APPROACH LANES',
    ring: 'WP-03 · HABITAT RING',
    abyss: 'WP-04 · THE ABYSS',
    spire: 'WP-05 · SIGNAL SPIRE',
    registry: 'DOCKED · SHIP’S REGISTRY',
  };

  let telemetry = null;     // latest frame report from the voyage
  let hudTimer = 0;

  const setStardate = () => {
    if (!hud.stardate) return;
    // Ten stardates to the day, epoch 2000 — the classic back-of-napkin rule
    const sd = (Date.now() - Date.UTC(2000, 0, 1)) / 8640000;
    hud.stardate.textContent = `STARDATE ${sd.toFixed(1)}`;
  };

  const startHud = () => {
    setStardate();
    setInterval(setStardate, 30000);

    // The DOM is repainted at a human rate, not the render rate
    hudTimer = setInterval(() => {
      if (!telemetry) return;
      if (hud.vel) {
        hud.vel.textContent = telemetry.warp
          ? `WARP ${(telemetry.vel).toFixed(1)}`
          : `VEL ${telemetry.vel.toFixed(2)}c`;
      }
      if (hud.hdg) hud.hdg.textContent = `HDG ${String(telemetry.hdg).padStart(3, '0')}`;
      if (hud.rng) hud.rng.textContent = telemetry.warp ? 'RNG ———' : `RNG ${Math.round(telemetry.rng)}m`;
      if (hud.railShip) hud.railShip.style.setProperty('--progress', telemetry.progress.toFixed(4));
    }, 150);

    // The scroll hint has one job; after the first real scroll it retires
    const dismissHint = () => {
      if (hud.hint) hud.hint.classList.add('done');
      removeEventListener('scroll', dismissHint);
    };
    addEventListener('scroll', dismissHint, { passive: true });

    // Zone label follows whatever crosses the middle of the viewport
    const zones = [...document.querySelectorAll('[data-zone]')];
    if ('IntersectionObserver' in window) {
      const zoneSpy = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const label = ZONE_LABELS[entry.target.dataset.zone];
          if (label && hud.zone) hud.zone.textContent = label;
        }
      }, { rootMargin: '-40% 0px -40% 0px' });
      zones.forEach((z) => zoneSpy.observe(z));
    }

    if (hud.sound) {
      hud.sound.addEventListener('click', () => {
        if (!voyage) return;
        const on = voyage.sound.toggle();
        hud.sound.textContent = on ? 'SND ON' : 'SND OFF';
        hud.sound.setAttribute('aria-pressed', String(on));
      });
    }
    if (hud.text) hud.text.addEventListener('click', () => textMode(true));
  };

  // ===========================================================================
  // Warp navigation — in the voyage, an anchor click is a jump: streaks up,
  // one long eased scroll, streaks down. Native behavior everywhere else.
  // ===========================================================================
  let warping = false;

  const scrollTargetFor = (hash) => {
    if (hash === '#top') return 0;
    const el = document.querySelector(hash);
    if (!el) return null;
    const max = document.documentElement.scrollHeight - innerHeight;
    // A section's waypoint is its centre — the same rule the flight plan
    // uses. Measured through the viewport rather than offsetTop, which
    // counts from the nearest positioned ancestor, not from the page.
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(max, scrollY + rect.top + rect.height / 2 - innerHeight / 2));
  };

  const warpTo = (hash) => {
    const target = scrollTargetFor(hash);
    if (target === null || warping) return false;
    const from = scrollY;
    if (Math.abs(target - from) < innerHeight * 0.75) return false;   // too close to bother

    warping = true;
    const ms = 1000;
    voyage.warpBurst(ms);
    root.classList.add('warping');
    root.style.scrollBehavior = 'auto';
    const t0 = performance.now();
    const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const step = (now) => {
      const u = Math.min((now - t0) / ms, 1);
      scrollTo(0, from + (target - from) * ease(u));
      if (u < 1) {
        requestAnimationFrame(step);
      } else {
        warping = false;
        root.classList.remove('warping');
        root.style.scrollBehavior = '';
        history.replaceState(null, '', hash);
      }
    };
    requestAnimationFrame(step);
    return true;
  };

  const armWarpNav = () => {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || !voyage || a.classList.contains('skip-link')) return;
      if (warpTo(a.getAttribute('href'))) e.preventDefault();
    });
  };

  // ===========================================================================
  // Scanner ping — a click on empty space answers with a ripple and a blip.
  // Pure theatre, and cheap enough to keep.
  // ===========================================================================
  const armPing = () => {
    addEventListener('click', (e) => {
      if (!voyage) return;
      if (e.target.closest('a, button, input, textarea, select, .boot, .menu')) return;
      const ping = document.createElement('i');
      ping.className = 'ping';
      ping.style.left = `${e.clientX}px`;
      ping.style.top = `${e.clientY}px`;
      document.body.appendChild(ping);
      ping.addEventListener('animationend', () => ping.remove());
      voyage.sound.blip(1180);
    });
  };

  // ===========================================================================
  // Mode switches
  // ===========================================================================
  const relaunch = document.querySelector('[data-relaunch]');

  const textMode = (remember) => {
    if (remember) local.set('pcs-mode', 'text');
    if (voyage) {
      voyage.dispose();
      voyage = null;
    }
    clearInterval(hudTimer);
    root.classList.remove('voyage', 'hud-on', 'boot-lock');
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
    startLife();
    if (relaunch && !reduced) relaunch.hidden = false;
  };

  if (relaunch) {
    relaunch.addEventListener('click', () => {
      // A reload is the honest way back: the voyage assumes a fresh document
      local.set('pcs-mode', '3d');
      location.reload();
    });
  }

  // ===========================================================================
  // Ignition
  // ===========================================================================
  const igniteVoyage = async () => {
    root.classList.add('voyage', 'boot-lock');

    // The boot module is voyage furniture; the classic page never pays for it
    let startBoot;
    try {
      ({ startBoot } = await import('./boot.js'));
    } catch (err) {
      console.error('[voyage] boot module failed to load:', err);
      session.set('pcs-no3d', '1');
      textMode(false);
      return;
    }

    startBoot({
      revisit: session.get('pcs-booted') === '1',

      // The heavy work, reported stage by stage to the boot bar
      load: async (milestone) => {
        const mod = await import('./voyage/main.js');
        milestone('engine');
        voyage = mod.createVoyage({
          canvas: document.getElementById('space'),
          sectionIds: ['top', 'what-we-do', 'how-we-work', 'who-we-are', 'fun', 'contact', 'registry-end'],
          onTelemetry: (t) => { telemetry = t; },
          // A machine that cannot hold a usable frame rate even at reduced
          // resolution gets the page instead of the slideshow — this visit
          // only, in case it was a fluke of load.
          onTooSlow: () => {
            session.set('pcs-no3d', '1');
            textMode(false);
          },
        });
        milestone('station');
        // Two frames: one to compile every shader, one to prove it flows
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        milestone('shaders');
      },

      onEngage: (revisit) => {
        session.set('pcs-booted', '1');
        root.classList.remove('boot-lock');
        root.classList.add('hud-on');
        startHud();
        if (!revisit) voyage.engage();   // the flyby is a first-time honor
        else voyage.remeasure();
      },

      onTextMode: () => textMode(true),

      onFail: () => {
        // WebGL that lies about itself, an import that died — whatever it
        // was, this visit is a classic one and we stop asking this session.
        session.set('pcs-no3d', '1');
        textMode(false);
      },
    });

    armWarpNav();
    armPing();
  };

  // ===========================================================================
  // Conway's Life behind the hero — the classic page's weather. Unchanged,
  // but now only summoned when the voyage is not flying.
  // ===========================================================================
  function startLife() {
    if (lifeStarted || reduced) return;
    lifeStarted = true;
    const hero = document.querySelector('.hero');
    if (hero && 'ResizeObserver' in window) {
      const begin = () => import('./life.js').then((m) => m.startLife(hero));
      if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 2000 });
      else setTimeout(begin, 200);
    }
  }

  if (voyageWanted) igniteVoyage();
  else startLife();
})();
