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

  // The module arrived and parsed; the inline failsafe in <head> stands down
  window.__pageAlive = true;

  const root = document.documentElement;
  // Kept as a live query, not a sample: the preference can change while the
  // page is open, and the voyage has to stand down when it does.
  const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = motionMq.matches;

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
  // WebGL2 specifically — three r185 requests a webgl2 context and nothing
  // else — and import maps, which every voyage module leans on to resolve
  // `three`. A browser missing either would boot into a guaranteed failure.
  const canWebGL = () => {
    try {
      if (!HTMLScriptElement.supports || !HTMLScriptElement.supports('importmap')) return false;
      return !!document.createElement('canvas').getContext('webgl2');
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
  let lifeInstance = null;

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
  // A click during a jump retargets the jump: the newest order wins.
  // ===========================================================================
  let warpJob = null;   // { from, target, hash, t0 } while a jump is flying

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

  const WARP_MS = 1000;
  const warpEase = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  const warpStep = (now) => {
    const job = warpJob;
    if (!job) return;
    const u = Math.min((now - job.t0) / WARP_MS, 1);
    scrollTo(0, job.from + (job.target - job.from) * warpEase(u));
    if (u < 1) {
      requestAnimationFrame(warpStep);
    } else {
      warpJob = null;
      root.classList.remove('warping');
      root.style.scrollBehavior = '';
      // Pushed, not replaced: a native anchor click makes a history entry,
      // and Back is expected to retrace the jumps. A retargeted warp still
      // lands as one entry — the one the visitor ended up choosing.
      history.pushState(null, '', job.hash);
    }
  };

  const warpTo = (hash) => {
    const target = scrollTargetFor(hash);
    if (target === null) return false;

    // Mid-jump, a new order replaces the old one: same streaks, new course.
    // Without this the browser's native jump and the running tween fight,
    // and the running tween wins — over the visitor's newest choice.
    if (warpJob) {
      warpJob = { from: scrollY, target, hash, t0: performance.now() };
      voyage.warpBurst(WARP_MS);
      return true;
    }

    if (Math.abs(target - scrollY) < innerHeight * 0.75) return false;   // too close to bother

    warpJob = { from: scrollY, target, hash, t0: performance.now() };
    voyage.warpBurst(WARP_MS);
    root.classList.add('warping');
    root.style.scrollBehavior = 'auto';
    requestAnimationFrame(warpStep);
    return true;
  };

  const armWarpNav = () => {
    document.addEventListener('click', (e) => {
      // A modified click is a request for native behavior — a new tab, a
      // context menu — and the warp has no business intercepting it.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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
  let abandoned = false;    // set the moment the voyage is renounced, so the
  let bootCtl = null;       // in-flight load knows to stand down

  const textMode = (remember) => {
    if (remember) local.set('pcs-mode', 'text');
    abandoned = true;
    // A warp in flight dies with the voyage — its tween would go on
    // scrolling the classic page toward a destination measured in a layout
    // that no longer exists.
    if (warpJob) {
      warpJob = null;
      root.classList.remove('warping');
      root.style.scrollBehavior = '';
    }
    if (bootCtl) {
      bootCtl.abort();
      bootCtl = null;
    }
    if (voyage) {
      voyage.dispose();
      voyage = null;
    }
    clearInterval(hudTimer);
    root.classList.remove('voyage', 'hud-on', 'boot-lock');
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
    startLife();
    if (relaunch && !motionMq.matches) relaunch.hidden = false;
  };

  // The preference can flip while the page is open; honoring it live is the
  // difference between a setting and a suggestion — in both directions.
  // Reduction arriving: the voyage stands down (without this, the CSS side
  // hides the boot dialog while the lock stays on — a frozen page), and so
  // does Life, a requestAnimationFrame loop no CSS rule can stop. Reduction
  // leaving: the classic weather may resume, and the way back to 3D shows.
  if (motionMq.addEventListener) {
    motionMq.addEventListener('change', (e) => {
      if (e.matches) {
        if (root.classList.contains('voyage')) textMode(false);
        if (lifeInstance) {
          lifeInstance.halt();
          lifeInstance = null;
        }
      } else {
        if (lifeStarted && !lifeInstance) lifeStarted = false;   // a halt is not forever
        startLife();
        if (relaunch && !root.classList.contains('voyage') && canWebGL()) {
          relaunch.hidden = false;
        }
      }
    });
  }

  if (relaunch) {
    relaunch.addEventListener('click', () => {
      // A reload is the honest way back: the voyage assumes a fresh
      // document. A deliberate retry also clears the session's automatic
      // rejection — otherwise the button would reload into the very gate
      // that hid the voyage, and do nothing at all.
      local.set('pcs-mode', '3d');
      session.set('pcs-no3d', '');
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
    // The voyage can be renounced while that import was in flight —
    // reduced motion switching on is the realistic route — and a curtain
    // raised after the audience left would lock an empty theatre.
    if (abandoned) return;

    bootCtl = startBoot({
      revisit: session.get('pcs-booted') === '1',

      // The heavy work, reported stage by stage to the boot bar. The
      // `abandoned` checks bracket the expensive steps: text mode chosen
      // mid-download must not leave a renderer running behind the page.
      load: async (milestone) => {
        const mod = await import('./voyage/main.js');
        if (abandoned) return;
        milestone('engine');
        voyage = mod.createVoyage({
          canvas: document.getElementById('space'),
          sectionIds: ['top', 'what-we-do', 'how-we-work', 'who-we-are', 'fun', 'contact', 'registry-end'],
          onTelemetry: (t) => { telemetry = t; },
          // A machine that cannot hold a usable frame rate even at reduced
          // resolution gets the page instead of the slideshow — this visit
          // only, in case it was a fluke of load.
          onTooSlow: () => {
            // `?fx=on` overrides the bailout: some people insist on the
            // scenic route whatever it costs, and they get to.
            if (new URLSearchParams(location.search).get('fx') === 'on') return;
            session.set('pcs-no3d', '1');
            textMode(false);
          },
        });
        if (abandoned) {
          voyage.dispose();
          voyage = null;
          return;
        }
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
        // Engaging releases the held stage; the flyby is a first-time honor
        voyage.engage(!revisit);
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
    if (lifeStarted || motionMq.matches) return;
    lifeStarted = true;
    const hero = document.querySelector('.hero');
    if (hero && 'ResizeObserver' in window) {
      // The preference is re-read at fire time: an idle callback can
      // outlive the setting it was scheduled under
      const begin = () => {
        if (motionMq.matches) return;
        import('./life.js').then((m) => { lifeInstance = m.startLife(hero); });
      };
      if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 2000 });
      else setTimeout(begin, 200);
    }
  }

  if (voyageWanted) {
    igniteVoyage();
  } else {
    startLife();
    // A visitor who chose text mode — or was dropped to it by a failed or
    // too-slow session — must still be able to change their mind: the way
    // back cannot only exist right after the way out. The relaunch click
    // clears the session rejection, so the retry is real.
    const declined = local.get('pcs-mode') === 'text' || session.get('pcs-no3d') === '1';
    if (relaunch && !reduced && declined && canWebGL()) {
      relaunch.hidden = false;
    }
  }
})();
