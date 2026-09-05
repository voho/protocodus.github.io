/* The HUD reports the simulation; it never decides the outcome of a trick.
   Native text stays sharp at every render scale. Numeric readouts update at
   12 Hz and only changed values touch the DOM; charge uses a composited bar.
   There is no full-window bitmap repaint or blur over the moving playfield. */
import { gradeAt } from './terrain.js';
import { SCORE } from './config.js';

export const HUD_WIDTH = 640;
export const HUD_HEIGHT = 360;
const BANNER_HOLD = 2.2;
const HINT_SECONDS = 7;
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
      <p class="ride-hint" data-hud="hint"><kbd>A</kbd> <kbd>D</kbd> carve <span>·</span> Hold <kbd>Space</kbd>, release to jump</p>
      <p class="ride-tools"><span class="desktop-pause"><kbd>Esc</kbd> pause</span><span data-hud="muted" hidden>Sound off</span></p>
    </div>`);
  const fields = Object.fromEntries([...root.querySelectorAll('[data-hud]')].map(node => [node.dataset.hud, node]));
  const readout = root.querySelector('[data-readout]');
  const callout = root.querySelector('[data-callout]');
  const curtain = document.querySelector('.curtain');
  const guide = curtain?.querySelector('.control-guide');
  const exitLink = curtain?.querySelector('.exit-link');
  const menuScore = curtain?.querySelector('[data-menu-score]');
  const menuDistance = curtain?.querySelector('[data-menu-distance]');
  const menuDrop = curtain?.querySelector('[data-menu-drop]');
  let shownScore = 0;
  let bannerName = '', bannerPoints = '', bannerTone = '';
  let bannerTimer = 0, hintTime = 0, drawIn = 0, sayIn = 0;
  let bestPassed = false;
  let lastMode = '';
  let last = null;

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

  // Help and navigation must not trigger the curtain's click-anywhere start.
  exitLink?.addEventListener('click', event => event.stopPropagation());
  exitLink?.addEventListener('keydown', event => {
    if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
  });
  guide?.addEventListener('click', event => event.stopPropagation());
  guide?.addEventListener('keydown', event => {
    if (event.key === 'Tab' || (event.key === 'Escape' && !guide.open)) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      guide.open = false;
      guide.querySelector('summary').focus();
    }
  });
  curtain?.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation(); // Tab must never become the game's "any key".
    const targets = [...curtain.querySelectorAll('button, summary, a[href]')].filter(node => node.getClientRects().length);
    if (!targets.length) return;
    const at = targets.indexOf(document.activeElement);
    const next = event.shiftKey ? (at <= 0 ? targets.length - 1 : at - 1) : (at + 1) % targets.length;
    targets[next].focus();
  });

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
    text('gates', `${g.gateRun} gates linked`);
    hidden('gates', !(g.gateRun > 0));
    text('speed', String(Math.round(rider.speed * 3.6)));
    text('descent', `${(rider.distance / 1000).toFixed(2)} km  /  ${Math.round(rider.drop)} m ↓`);
    const slope = Math.round(Math.atan(gradeAt(rider.pos.z)) * 180 / Math.PI);
    text('weather', `${g.weather.phase} · ${g.weather.conditions} · ${slope}°`);
    const inAir = !rider.grounded && rider.airTime > 0.25;
    const showingBanner = bannerTimer > 0;
    hidden('event', !showingBanner && !inAir);
    if (showingBanner || inAir) {
      text('event-kicker', showingBanner ? (bannerPoints ? 'Run score' : 'Freeride') : `${rider.airTime.toFixed(1)} s airtime`);
      text('event-name', showingBanner ? bannerName : (g.liveTrick || 'Find your landing'));
      text('event-points', showingBanner ? bannerPoints : '');
      hidden('event-points', !showingBanner || !bannerPoints);
      const tone = showingBanner ? bannerTone : 'air';
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

  function update(g, dt) {
    last = g;
    const playing = g.mode === 'playing';
    const modeChanged = g.mode !== lastMode;
    if (modeChanged) {
      lastMode = g.mode;
      hidden('ride', !playing);
      if (playing) {
        if (guide) guide.open = false;
        // A focused drop-in button must not intercept Space during riding.
        if (curtain?.contains(document.activeElement)) document.activeElement.blur();
      } else curtain?.focus({ preventScroll: true });
      drawIn = 0;
    }
    if (playing) {
      hintTime += dt;
      shownScore += (g.score - shownScore) * Math.min(1, dt * 8);
      if (Math.abs(g.score - shownScore) < 1) shownScore = g.score;
    }
    if (g.mode !== 'paused') bannerTimer = Math.max(0, bannerTimer - dt);
    if (!bestPassed && playing && g.bestAtStart > 0 && g.score >= g.bestAtStart) {
      bestPassed = true;
      if (callout) callout.textContent = 'New personal best.';
    }
    // A transform avoids layout while the player loads the jump. Neither a
    // full-charge bar nor a maximum-flow bar flashes.
    hidden('charge', !g.rider.charging);
    if (g.rider.charging) {
      meter('charge-fill', g.rider.charge);
      text('charge-label', g.rider.charge > 0.995 ? 'Release to fly' : 'Load the legs');
    }
    drawIn -= dt;
    if (drawIn <= 0) {
      drawIn = 1 / 12;
      if (playing || modeChanged) draw(g);
    }
    sayIn -= dt;
    if (readout && sayIn <= 0 && playing) {
      sayIn = 1;
      readout.textContent = `Score ${Math.round(g.score)}, best ${Math.round(g.best)}, multiplier ${Math.round(g.combo)}, `
        + `${Math.round(g.rider.speed * 3.6)} kilometres per hour, `
        + `${(g.rider.distance / 1000).toFixed(2)} kilometres and ${Math.round(g.rider.drop)} metres down.`;
    }
  }

  function banner(name, points, tone = '') {
    bannerName = name;
    bannerPoints = points ? `+${fmt.format(Math.round(points))}` : '';
    bannerTone = tone;
    bannerTimer = BANNER_HOLD;
    drawIn = 0;
    if (callout) callout.textContent = points ? `${name}, plus ${Math.round(points)}` : name;
  }

  function clearBanner() {
    bannerTimer = 0;
    drawIn = 0;
  }

  function setMuted(value) {
    hidden('muted', !value);
  }

  function resetScore() {
    shownScore = 0;
    bannerTimer = 0;
    hintTime = 0;
    bestPassed = false;
    drawIn = sayIn = 0;
    if (callout) callout.textContent = '';
    if (last) draw(last);
  }

  return { update, banner, clearBanner, setMuted, resetScore, setSize, canvas };
}
