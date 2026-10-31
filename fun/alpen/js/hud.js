/* The HUD reports the simulation; it never decides the outcome of a trick.
   Native text stays sharp at every render scale. Numeric readouts update at
   12 Hz and only changed values touch the DOM; charge uses a composited bar.
   There is no full-window bitmap repaint or blur over the moving playfield. */
import { gradeAt } from './terrain.js';
import { RIDER, SCORE } from './config.js';

export const HUD_WIDTH = 640;
export const HUD_HEIGHT = 360;
const BANNER_HOLD = 2.2;
/* THE BANNER IS A QUEUE, not a slot.

   Two awards in one physics step — a gate threaded on the landing of a
   trick, MAX FLOW arriving on the trick that filled it, a cocoa stop and a
   milestone — used to overwrite each other, so the player was paid for two
   things and told about one. Now a banner that arrives while another is up
   waits its turn, and the one on screen is cut to `BANNER_MIN` so a backlog
   drains rather than stacking up two seconds at a time; the last in line
   keeps its full hold. `QUEUE_MAX` bounds it: past four, the oldest waiting
   callout is dropped, because a read-out running five seconds behind the
   run is describing a different run. */
const BANNER_MIN = 0.8;
const QUEUE_MAX = 4;
/* In the air the band belongs to the flight — the air clock and the live
   trick name are the read-out a rider in the middle of a spin needs — so a
   callout that arrives up there (a perfect pop, a gate crossed mid-flight)
   rides the kicker line above them for this long instead of replacing them. */
const FLASH_HOLD = 1.3;
const HINT_SECONDS = 7;
const AUDIO_UNLOCK_DELAY = 0.75;
const GRAB_RELEASE_LEAD = 0.65;
const fmt = new Intl.NumberFormat('en-US');

export function createHud(root) {
  // Retained for callers that know the original API. A 1-pixel hidden canvas
  // uses no display-sized backing store; the DOM owns the visible readout.
  const canvas = root.querySelector('canvas') || root.appendChild(document.createElement('canvas'));
  canvas.hidden = true;
  canvas.width = canvas.height = 1;
  canvas.setAttribute('aria-hidden', 'true');
  root.insertAdjacentHTML('beforeend', `
    <div class="ride-ui" data-hud="ride" hidden aria-hidden="true">
      <section class="ride-score">
        <p class="ride-eyebrow">Alpen <span>/ Freeride</span></p>
        <div class="score-line"><strong data-hud="score">0</strong><span class="combo" data-hud="combo" hidden>×1</span></div>
        <div class="flow-line"><span>Flow</span><i class="meter"><i data-hud="flow"></i></i><span class="flow-level" data-hud="flow-level">Build your line</span></div>
        <p class="personal-best" data-hud="best">Best 0</p>
        <p class="gate-run" data-hud="gates" hidden></p>
      </section>
      <section class="ride-speed">
        <div class="speed-line"><strong data-hud="speed">0</strong><span>km/h</span></div>
        <p class="descent" data-hud="descent"></p>
        <p class="conditions" data-hud="weather"></p>
      </section>
      <div class="ride-event" data-hud="event" hidden>
        <p class="event-kicker" data-hud="event-kicker"></p>
        <p class="event-name" data-hud="event-name"></p>
        <p class="event-points" data-hud="event-points" hidden></p>
      </div>
      <div class="ride-charge" data-hud="charge" hidden><p data-hud="charge-label">Load the legs</p><i class="meter"><i data-hud="charge-fill"></i></i></div>
      <div class="ride-guide" data-hud="guide" hidden></div>
      <p class="ride-hint" data-hud="hint"><span data-input-help="keyboard"><kbd>A</kbd> <kbd>D</kbd> carve <span>·</span> Hold <kbd>Space</kbd>, release to jump</span><span data-input-help="gamepad"><kbd>Left stick</kbd> carve <span>·</span> Hold <kbd>A</kbd>, release to jump</span></p>
      <p class="ride-tools"><span class="desktop-pause"><span data-input-help="keyboard"><kbd>Esc</kbd> pause</span><span data-input-help="gamepad"><kbd>Start</kbd> pause</span></span><span data-hud="muted" hidden>Sound off</span><span data-hud="audio-unlock" hidden>Tap or press a key for sound</span></p>
    </div>`);
  const fields = Object.fromEntries([...root.querySelectorAll('[data-hud]')].map(node => [node.dataset.hud, node]));
  const readout = root.querySelector('[data-readout]');
  const callout = root.querySelector('[data-callout]');
  const curtain = document.querySelector('.curtain');
  const guide = curtain?.querySelector('.control-guide');
  const guideSummary = guide?.querySelector('summary');
  const menuScroller = curtain?.querySelector('.curtain-inner');
  const primaryButton = curtain?.querySelector('.drop-in');
  const exitLink = curtain?.querySelector('.exit-link');
  const menuScore = curtain?.querySelector('[data-menu-score]');
  const menuDistance = curtain?.querySelector('[data-menu-distance]');
  const menuDrop = curtain?.querySelector('[data-menu-drop]');
  let shownScore = 0;
  let bannerName = '', bannerPoints = '', bannerTone = '', bannerKicker = '';
  let bannerTimer = 0, bannerShown = 0, hintTime = 0, drawIn = 0, sayIn = 0;
  let audioWait = 0;
  const queue = [];
  let flashText = '', flashTone = '', flashTimer = 0;
  let bestPassed = false;
  let lastMode = '';
  let last = null;
  let inputDevice = document.body.dataset.inputDevice || 'keyboard';
  let controllerFocus = null;

  const text = (name, value) => {
    const node = fields[name];
    if (node.textContent !== value) node.textContent = value;
  };
  const hidden = (name, value) => {
    if (fields[name].hidden !== value) fields[name].hidden = value;
  };
  const meter = (name, value) => {
    const scale = `scaleX(${Math.round(Math.max(0, Math.min(1, value)) * 100) / 100})`;
    if (fields[name].style.transform !== scale) fields[name].style.transform = scale;
  };

  const menuTargets = () => curtain
    ? [...curtain.querySelectorAll('button, summary, a[href]')]
      .filter(node => !node.disabled && node.getClientRects().length)
    : [];
  function clearControllerFocus() {
    if (controllerFocus) delete controllerFocus.dataset.controllerFocus;
    controllerFocus = null;
  }
  function markControllerFocus(target) {
    if (controllerFocus === target) return;
    clearControllerFocus();
    controllerFocus = target;
    target.dataset.controllerFocus = 'true';
  }
  function focusMenu(target, block = 'nearest') {
    markControllerFocus(target);
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block, inline: 'nearest', behavior: 'instant' });
  }

  // Help can be taller than a landscape menu. While its summary owns focus,
  // directional presses page through the text before moving to another
  // control. All layout reads are input-driven; idle menus never query it.
  function scrollGuide(direction) {
    if (!guide?.open || document.activeElement !== guideSummary || !menuScroller?.clientHeight) return false;
    const top = menuScroller.getBoundingClientRect().top + (menuScroller.clientTop || 0);
    const current = menuScroller.scrollTop;
    const limit = Math.max(0, menuScroller.scrollHeight - menuScroller.clientHeight);
    const start = Math.min(limit, Math.max(0, current + guideSummary.getBoundingClientRect().top - top));
    const end = Math.max(start, Math.min(limit,
      current + guide.getBoundingClientRect().bottom - top - menuScroller.clientHeight));
    if (direction > 0 ? current >= end - 1 : current <= start + 1) return false;
    const step = Math.max(40, menuScroller.clientHeight * 0.75);
    menuScroller.scrollTop = direction > 0
      ? Math.min(end, Math.max(start, current + step)) : Math.max(start, current - step);
    markControllerFocus(guideSummary);
    return true;
  }

  function menu(action) {
    if (!curtain || last?.mode === 'playing') return false;
    if (action === 'back') {
      if (!guide?.open) return false;
      guide.open = false;
      if (guideSummary) focusMenu(guideSummary);
      return true;
    }
    if (!['next', 'previous', 'activate'].includes(action)) return false;
    const targets = menuTargets();
    const at = targets.indexOf(document.activeElement);
    if (action === 'activate') {
      const target = at >= 0 ? targets[at] : targets.includes(primaryButton) ? primaryButton : null;
      if (!target) return false;
      focusMenu(target);
      target.click();
      // Native summary activation opens exactly once; align the newly
      // revealed text without moving focus away from its close control.
      if (target === guideSummary && guide.open) focusMenu(target, 'start');
      return true;
    }
    if (!targets.length) return false;
    const direction = action === 'next' ? 1 : -1;
    if (at >= 0 && scrollGuide(direction)) return true;
    const next = direction < 0 ? (at <= 0 ? targets.length - 1 : at - 1) : (at + 1) % targets.length;
    focusMenu(targets[next]);
    return true;
  }

  // Help and navigation must not trigger the curtain's click-anywhere start.
  // Browser chords pass through before any menu state or focus is changed.
  exitLink?.addEventListener('click', event => event.stopPropagation());
  exitLink?.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    clearControllerFocus();
    if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
  });
  guide?.addEventListener('click', event => event.stopPropagation());
  guide?.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    clearControllerFocus();
    if (event.key === 'Tab' || (event.key === 'Escape' && !guide.open)) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      guide.open = false;
      guide.querySelector('summary').focus();
    }
  });
  curtain?.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    clearControllerFocus();
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation(); // Tab must never become the game's "any key".
    const targets = menuTargets();
    if (!targets.length) return;
    const at = targets.indexOf(document.activeElement);
    const next = event.shiftKey ? (at <= 0 ? targets.length - 1 : at - 1) : (at + 1) % targets.length;
    targets[next].focus();
  });
  curtain?.addEventListener('pointerdown', clearControllerFocus, true);

  function setSize(width, height, pixel = 0, offsetX = 0, offsetY = 0, insets = null) {
    if (insets) {
      const density = Math.max(0.01, height / (window.visualViewport?.height || window.innerHeight || height));
      for (const edge of ['top', 'right', 'bottom', 'left']) {
        root.style.setProperty(`--hud-inset-${edge}`, `${(insets[edge] || 0) / density}px`);
      }
    }
    const ratio = window.devicePixelRatio || 1;
    const embedded = pixel > 0 && (offsetX || offsetY);
    root.style.left = embedded ? `${offsetX / ratio}px` : '';
    root.style.top = embedded ? `${offsetY / ratio}px` : '';
    root.style.width = embedded ? `${width * pixel / ratio}px` : '';
    root.style.height = embedded ? `${height * pixel / ratio}px` : '';
    drawIn = 0;
  }

  function draw(g) {
    const rider = g.rider;
    const combo = Math.round(g.combo);
    text('score', fmt.format(Math.round(shownScore)));
    text('combo', `×${combo}`);
    hidden('combo', combo <= 1);
    meter('flow', g.flow || 0);
    text('flow-level', g.flow > 0.99 ? `Maximum ×${SCORE.comboMax}` : combo > 1 ? `×${combo} multiplier` : 'Build your line');
    const record = g.bestAtStart || 0;
    text('best', bestPassed ? `Personal best · ${fmt.format(Math.round(g.best))}` : `Best ${fmt.format(Math.round(record))}`);
    if (fields.best.dataset.passed !== String(bestPassed)) fields.best.dataset.passed = String(bestPassed);
    text('gates', `${g.gateRun} ${g.gateRun === 1 ? 'gate' : 'gates'} linked`);
    hidden('gates', !(g.gateRun > 0));
    text('speed', String(Math.round(rider.speed * 3.6)));
    text('descent', `${(rider.distance / 1000).toFixed(2)} km  /  ${Math.round(rider.drop)} m ↓`);
    const slope = Math.round(Math.atan(gradeAt(rider.pos.z)) * 180 / Math.PI);
    text('weather', `${g.weather.phase} · ${g.weather.conditions} · ${slope}°`);
    const inAir = !rider.grounded && rider.airTime > 0.25;
    // main.js already publishes a name only after a press has carried a
    // qualifying rotation. Reuse that result; the HUD never judges it again.
    const inButter = g.mode === 'playing' && rider.state === 'ride'
      && rider.grounded && !!g.liveTrick;
    const showingBanner = bannerTimer > 0;
    const flashing = flashTimer > 0;
    hidden('event', !showingBanner && !inAir && !inButter && !flashing);
    if (showingBanner || inAir || inButter || flashing) {
      /* The read-outs share one band, in this order: a banner (what the
         last thing was worth, and — in the kicker — why: the multiplier and
         the factors that paid it, or what went wrong); the flight (air clock
         and live trick name, with any mid-air callout riding the kicker);
         a live butter; and a lone callout with the snow under it. */
      let kicker;
      let name;
      let tone;
      if (showingBanner) {
        kicker = bannerKicker || (bannerPoints ? 'Run score' : 'Freeride');
        name = bannerName;
        tone = bannerTone;
      } else if (inAir) {
        const air = `${rider.airTime.toFixed(1)} s airtime`;
        // Use the rider's existing ballistic prediction: this is advice,
        // never an extra terrain query or an automatic release. A brief
        // roller is not a judged trick, and falls are not flights.
        const releaseGrab = rider.state === 'air' && rider.grabbing
          && rider.airTime >= RIDER.minJudgedAir
          && rider.touchdownIn >= 0 && rider.touchdownIn <= GRAB_RELEASE_LEAD;
        kicker = releaseGrab ? `Release grab to land · ${air}`
          : flashing ? `${flashText} · ${air}` : air;
        name = g.liveTrick || 'Find your landing';
        tone = releaseGrab ? 'warn' : flashing && flashTone ? flashTone : 'air';
      } else if (inButter) {
        kicker = 'Release grab to finish';
        name = g.liveTrick;
        tone = '';
      } else {
        kicker = 'Freeride';
        name = flashText;
        tone = flashTone;
      }
      text('event-kicker', kicker);
      text('event-name', name);
      text('event-points', showingBanner ? bannerPoints : '');
      hidden('event-points', !showingBanner || !bannerPoints);
      if (fields.event.dataset.tone !== tone) fields.event.dataset.tone = tone;
    }
    const offset = g.pisteOffset || 0;
    const showGuide = Math.abs(offset) > 0.9 || (g.weather.storm > 0.45 && Math.abs(offset) > 0.4);
    hidden('guide', !showGuide);
    if (showGuide) text('guide', offset > 0 ? '← Back to the piste' : 'Back to the piste →');
    hidden('hint', hintTime >= HINT_SECONDS);
    if (g.mode === 'paused') {
      if (menuScore) menuScore.textContent = fmt.format(Math.round(g.score));
      if (menuDistance) menuDistance.textContent = `${(rider.distance / 1000).toFixed(2)} km`;
      if (menuDrop) menuDrop.textContent = `${Math.round(rider.drop)} m`;
    }
  }

  function update(g, dt, needsGesture = false) {
    last = g;
    const playing = g.mode === 'playing';
    // Ordinary starts settle before this grace period. A real refusal gets
    // one quiet explanation, retired as soon as recovery is no longer pending.
    audioWait = playing && needsGesture ? Math.min(AUDIO_UNLOCK_DELAY, audioWait + dt) : 0;
    hidden('audio-unlock', audioWait < AUDIO_UNLOCK_DELAY);
    const modeChanged = g.mode !== lastMode;
    if (modeChanged) {
      lastMode = g.mode;
      hidden('ride', !playing);
      if (playing) {
        clearControllerFocus();
        if (guide) guide.open = false;
        // A focused drop-in button must not intercept Space during riding.
        if (curtain?.contains(document.activeElement)) document.activeElement.blur();
      } else if (!menuTargets().includes(document.activeElement)) {
        // Input may navigate during the same frame that first pauses the
        // game. Keep valid native focus rather than taking it back here.
        curtain?.focus({ preventScroll: true });
      }
      drawIn = 0;
    }
    if (playing) {
      hintTime += dt;
      shownScore += (g.score - shownScore) * Math.min(1, dt * 8);
      if (Math.abs(g.score - shownScore) < 1) shownScore = g.score;
    }
    if (g.mode !== 'paused') {
      if (bannerTimer > 0) {
        bannerTimer = Math.max(0, bannerTimer - dt);
        bannerShown += dt;
      }
      if (bannerTimer <= 0 && queue.length) {
        show(queue.shift());
        // Still a backlog behind this one: it gets its minimum, not the hold.
        if (queue.length) bannerTimer = Math.min(bannerTimer, BANNER_MIN);
      }
      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
        if (flashTimer === 0) drawIn = 0;
      }
    }
    if (!bestPassed && playing && g.score > (g.bestAtStart || 0)) {
      bestPassed = true;
      // First scores count; ties do not. Keep the event that earned the
      // record (or an immediate crash reason) in the live announcement.
      if (callout && bannerTimer <= 0 && flashTimer <= 0) {
        callout.textContent = 'New personal best.';
      }
    }
    // A transform avoids layout while the player loads the jump. Neither a
    // full-charge bar nor a maximum-flow bar flashes.
    hidden('charge', !g.rider.charging);
    if (g.rider.charging) {
      meter('charge-fill', g.rider.charge);
      /* …but it does change colour, for the one moment it matters: when
         letting go now would be the lip pop. `lipReady` is the rider's own
         release test, published every step (see `groundStep`), so the tint
         and the payout are the same condition; `lipAhead` is its prediction
         a few tenths out, which is what gives a human hand time to be ready
         for it. An attribute, written only on change; the colour is the
         stylesheet's. */
      const lip = g.rider.lipReady ? 'ready' : g.rider.lipAhead ? 'ahead' : 'none';
      text('charge-label', lip === 'ready' ? 'Pop now — on the lip'
        : lip === 'ahead' ? 'Hold it — lip ahead'
          : g.rider.charge > 0.995 ? 'Release to fly' : 'Load the legs');
      if (fields.charge.dataset.lip !== lip) fields.charge.dataset.lip = lip;
    }
    drawIn -= dt;
    if (drawIn <= 0) {
      drawIn = 1 / 12;
      if (playing || modeChanged) draw(g);
    }
    sayIn -= dt;
    if (readout && sayIn <= 0 && playing) {
      sayIn = 1;
      // Written only on change, like every other field: a stationary run
      // should cost the DOM nothing, and this line was the one exception.
      const say = `Score ${Math.round(g.score)}, best ${Math.round(g.best)}, multiplier ${Math.round(g.combo)}, `
        + `${Math.round(g.rider.speed * 3.6)} kilometres per hour, `
        + `${(g.rider.distance / 1000).toFixed(2)} kilometres and ${Math.round(g.rider.drop)} metres down.`;
      if (readout.textContent !== say) readout.textContent = say;
    }
  }

  function show(item) {
    bannerName = item.name;
    bannerPoints = item.points;
    bannerTone = item.tone;
    bannerKicker = item.kicker;
    bannerTimer = item.hold;
    bannerShown = 0;
    drawIn = 0;
    if (callout) callout.textContent = item.say;
  }

  /* `opts.kicker` is the small line above the name — the factors that paid
     a trick, or what went wrong with it — and `opts.hold` how long it stays
     up when nothing is waiting behind it. */
  function banner(name, points, tone = '', opts = null) {
    const shownPoints = points ? `+${fmt.format(Math.round(points))}` : '';
    const kicker = opts?.kicker || '';
    const item = {
      name,
      points: shownPoints,
      tone,
      kicker,
      hold: opts?.hold || BANNER_HOLD,
      say: [name, kicker, points ? `plus ${Math.round(points)}` : '']
        .filter(Boolean).join(', '),
    };
    if (last?.rider?.state === 'air') {
      flashText = shownPoints ? `${name} ${shownPoints}` : name;
      flashTone = tone;
      flashTimer = FLASH_HOLD;
      drawIn = 0;
      if (callout) callout.textContent = item.say;
      return;
    }
    if (bannerTimer > 0) {
      if (queue.length >= QUEUE_MAX) queue.shift();
      queue.push(item);
      bannerTimer = Math.min(bannerTimer, Math.max(0, BANNER_MIN - bannerShown));
      return;
    }
    show(item);
  }

  function clearBanner() {
    bannerTimer = 0;
    queue.length = 0;
    flashTimer = 0;
    drawIn = 0;
  }

  function setMuted(value) {
    hidden('muted', !value);
  }

  function setInputDevice(device) {
    if (!['keyboard', 'gamepad', 'touch'].includes(device)) return;
    if (device !== 'gamepad') clearControllerFocus();
    if (device === inputDevice) return;
    inputDevice = device;
    // CSS selects retained help nodes. Switching never rebuilds a focused
    // menu or interrupts a held control, and steady input costs no DOM work.
    document.body.dataset.inputDevice = device;
    hintTime = 0;
    hidden('hint', false);
    drawIn = 0;
  }

  function resetScore() {
    shownScore = 0;
    bannerTimer = 0;
    queue.length = 0;
    flashTimer = 0;
    hintTime = 0;
    bestPassed = false;
    drawIn = sayIn = 0;
    if (callout) callout.textContent = '';
    if (last) draw(last);
  }

  return { update, banner, clearBanner, setMuted, setInputDevice, menu, resetScore, setSize, canvas };
}
