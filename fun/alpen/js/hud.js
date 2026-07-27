/* The read-out.

   Everything here is DOM over the canvas rather than drawn into it, for
   three reasons: text stays crisp while the game itself is 288 lines tall,
   the type is the company's own, and a screen reader gets a running score
   for free.

   The discipline is that the HUD only ever states what the physics already
   did. Speed is the length of the velocity vector, the charge bar is the
   spring, the trick line is the rotation actually accumulated. Nothing in
   here is decided here. */

const fmt = new Intl.NumberFormat('en-US');

export function createHud(root) {
  const el = (sel) => root.querySelector(sel);

  const nodes = {
    score: el('[data-score]'),
    combo: el('[data-combo]'),
    speed: el('[data-speed]'),
    distance: el('[data-distance]'),
    best: el('[data-best]'),
    trick: el('[data-trick]'),
    live: el('[data-live]'),
    charge: el('[data-charge]'),
    chargeWrap: el('[data-charge-wrap]'),
    sky: el('[data-sky]'),
    mute: el('[data-mute]'),
    air: el('[data-air]'),
  };

  let shownScore = 0;
  let bannerTimer = 0;

  function update(g, dt) {
    // The score counts up to the truth rather than jumping to it. A number
    // that rolls reads as a reward; a number that changes reads as a field.
    shownScore += (g.score - shownScore) * Math.min(1, dt * 7);
    if (Math.abs(g.score - shownScore) < 1) shownScore = g.score;
    nodes.score.textContent = fmt.format(Math.round(shownScore));

    const combo = Math.round(g.combo);
    nodes.combo.textContent = combo > 1 ? `×${combo}` : '';
    nodes.combo.classList.toggle('hot', combo >= 5);

    nodes.speed.textContent = Math.round(g.rider.speed * 3.6);
    nodes.distance.textContent = `${(g.rider.distance / 1000).toFixed(2)} km`;
    nodes.best.textContent = fmt.format(Math.round(g.best));
    nodes.sky.textContent = `${g.weather.phase} · ${g.weather.conditions}`;

    // Charge bar, straight off the rider's own charge
    const charging = g.rider.charging;
    nodes.chargeWrap.classList.toggle('on', charging);
    if (charging) nodes.charge.style.transform = `scaleX(${g.rider.charge.toFixed(3)})`;

    // Air time is the only number that has to be live, because it is the
    // one the player is making a decision against
    const air = !g.rider.grounded;
    nodes.air.classList.toggle('on', air && g.rider.airTime > 0.25);
    if (air) nodes.air.textContent = `${g.rider.airTime.toFixed(1)}s`;

    nodes.live.textContent = air ? (g.liveTrick || '') : '';
    nodes.live.classList.toggle('on', air && !!g.liveTrick);

    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) nodes.trick.classList.remove('on');
    }
  }

  /* One banner, held long enough to read at speed and no longer. */
  function banner(text, points, tone = '') {
    nodes.trick.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'trick-name';
    name.textContent = text;
    nodes.trick.appendChild(name);
    if (points) {
      const pts = document.createElement('span');
      pts.className = 'trick-points';
      pts.textContent = `+${fmt.format(Math.round(points))}`;
      nodes.trick.appendChild(pts);
    }
    nodes.trick.className = `trick on ${tone}`;
    bannerTimer = 1.9;
  }

  function setMuted(muted) {
    nodes.mute.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    nodes.mute.classList.toggle('off', muted);
  }

  function resetScore() {
    shownScore = 0;
  }

  return { update, banner, setMuted, resetScore };
}
