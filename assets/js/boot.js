/* The boot terminal. A wall of falling glyphs, a typed wake-up log, a bar
   that only moves when something real finished, and the ENGAGE that lifts
   the curtain. It is the voyage's loading screen, its consent screen, and
   its one theatrical indulgence, in that order of importance.

   The log's milestones are real: `engine` is the import graph landing,
   `station` is the world built, `shaders` is the first rendered frame. If a
   stage takes four seconds the bar sits still for four seconds. */

const LINES = [
  { text: '> wake up, founder …', pause: 500 },
  { text: '> the build has you', pause: 620 },
  { text: '> helm ................ ok', pause: 90 },
  { text: '> reactor ............. ok', pause: 90 },
  { text: '> hyperdrive .......... ok', pause: 90 },
  { text: '> universal translator  ok', pause: 90 },
  { text: '> bug shield .......... ok', pause: 90 },
  { text: '> pressure hull ....... ok', pause: 260 },
  { text: '> all systems nominal — engage when ready', pause: 0 },
];

const MILESTONES = { wake: 8, engine: 48, station: 78, shaders: 100 };

/* The rain: one canvas, one column of glyphs per 18px, heads bright and
   trails erased by a translucent wash. Capped at 24fps — it is weather, not
   action — and stopped the moment the curtain lifts. */
function startRain(canvas) {
  const ctx = canvas.getContext('2d');
  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789<>[]{}=+*#$';
  let raf = 0;
  let cols = 0;
  let drops = [];
  let last = 0;

  const resize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    cols = Math.ceil(canvas.width / 18);
    drops = Array.from({ length: cols }, () => ({
      y: Math.random() * -canvas.height,
      v: 90 + Math.random() * 180,
    }));
    ctx.fillStyle = '#030509';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  resize();
  addEventListener('resize', resize);

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 42) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    ctx.fillStyle = 'rgba(3, 5, 9, 0.16)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '15px monospace';
    for (let i = 0; i < cols; i++) {
      const d = drops[i];
      d.y += d.v * dt;
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      ctx.fillStyle = 'rgba(191, 255, 236, 0.9)';
      ctx.fillText(ch, i * 18, d.y);
      ctx.fillStyle = 'rgba(0, 255, 195, 0.5)';
      ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * 18, d.y - 18);
      if (d.y > canvas.height + 60) {
        d.y = Math.random() * -200;
        d.v = 90 + Math.random() * 180;
      }
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
  };
}

export function startBoot({ revisit, load, onEngage, onTextMode, onFail }) {
  const boot = document.getElementById('boot');
  const log = boot.querySelector('[data-boot-log]');
  const bar = boot.querySelector('[data-boot-bar]');
  const fill = boot.querySelector('[data-boot-fill]');
  const go = boot.querySelector('[data-boot-go]');
  const text = boot.querySelector('[data-boot-text]');

  boot.hidden = false;
  const stopRain = startRain(boot.querySelector('.boot-rain'));

  let typed = revisit;      // the log's side of readiness
  let loaded = false;       // the machine's side
  let failed = false;
  let engaged = false;
  let progress = 0;

  const paint = () => {
    fill.style.width = `${progress}%`;
    bar.setAttribute('aria-valuenow', String(progress));
  };

  const milestone = (id) => {
    progress = Math.max(progress, MILESTONES[id] || 0);
    paint();
    if (id === 'shaders') {
      loaded = true;
      maybeReady();
    }
  };

  const print = (str) => {
    const p = document.createElement('p');
    p.textContent = str;
    log.appendChild(p);
    return p;
  };

  const maybeReady = () => {
    if (!typed || !loaded || failed || engaged) return;
    if (revisit) {
      // This session has seen the show; straight to the bridge
      engage();
      return;
    }
    go.disabled = false;
    go.focus({ preventScroll: true });
  };

  const engage = () => {
    if (engaged || failed) return;
    engaged = true;
    document.removeEventListener('keydown', onKey);
    boot.classList.add('lift');
    // The curtain takes 700ms in CSS; the rain works until it is gone
    setTimeout(() => {
      stopRain();
      boot.hidden = true;
    }, 750);
    onEngage(revisit);
  };

  const bail = (handler) => {
    document.removeEventListener('keydown', onKey);
    stopRain();
    boot.hidden = true;
    handler();
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !go.disabled) engage();
    if (e.key === 'Escape') bail(onTextMode);
  };

  go.addEventListener('click', engage);
  text.addEventListener('click', () => bail(onTextMode));
  document.addEventListener('keydown', onKey);

  milestone('wake');

  /* The typed log. A revisit skips the theatre and shows the punchline. */
  if (revisit) {
    print(LINES[LINES.length - 1].text);
  } else {
    let li = 0;
    const typeLine = () => {
      if (li >= LINES.length) {
        typed = true;
        maybeReady();
        return;
      }
      const { text: line, pause } = LINES[li++];
      const p = print('');
      let ci = 0;
      const tick = () => {
        // Status lines land in chunks — a machine does not hunt and peck
        ci = Math.min(line.length, ci + (line.startsWith('> ') && li > 2 ? 4 : 1));
        p.textContent = line.slice(0, ci);
        if (ci < line.length) setTimeout(tick, 16);
        else setTimeout(typeLine, pause);
      };
      tick();
    };
    typeLine();
  }

  /* The machine's side, running while the log types. */
  load(milestone).catch((err) => {
    console.error('[voyage] boot failed:', err);
    failed = true;
    print('> visual systems offline — dropping to text mode');
    setTimeout(() => bail(onFail), 1400);
  });
}
