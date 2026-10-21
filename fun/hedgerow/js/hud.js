/* Hedgerow — the HUD (DOM over the canvas): crosshair, hit markers,
   damage direction, health, ammo, objective with a compass marker,
   notices, prompts, the grenade warning and enemy-awareness arrows. */

import { clamp, smoothstep } from './util.js';

export function createHud(root) {
  const $ = (s) => root.querySelector(s);
  const el = {
    cross: $('[data-crosshair]'), hit: $('[data-hitmark]'), damage: $('[data-damage]'), hurt: $('[data-hurt]'),
    health: $('[data-health]'), stance: $('[data-stance]'),
    wname: $('[data-weapon-name]'), mag: $('[data-ammo-mag]'), reserve: $('[data-ammo-reserve]'), grenades: $('[data-grenades]'),
    objective: $('[data-objective]'), objText: $('[data-objective-text]'),
    compass: $('[data-compass]'), strip: $('[data-compass-strip]'), mark: $('[data-compass-mark]'), dist: $('[data-compass-dist]'),
    notice: $('[data-notice]'), prompt: $('[data-prompt]'), gwarn: $('[data-grenade-warn]'), detect: $('[data-detect]'),
    debug: $('[data-debug]'),
    reload: $('[data-reload]'), reloadFill: $('[data-reload-fill]'), reloadHint: $('[data-reload-hint]'),
  };
  const ammoBox = el.mag.parentElement;

  // compass strip: ticks every 15°, letters at the cardinals
  const PX_PER_RAD = 160;
  const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let deg = -360; deg <= 720; deg += 15) {
    const s = document.createElement('span');
    const d = ((deg % 360) + 360) % 360;
    if (labels[d] !== undefined) { s.textContent = labels[d]; if (d % 90 === 0) s.className = 'major'; }
    else s.className = 'tick';
    s.style.left = `${(deg * Math.PI / 180) * PX_PER_RAD}px`;
    el.strip.appendChild(s);
  }

  // damage arcs
  const arcs = [];
  for (let i = 0; i < 6; i++) { const a = document.createElement('i'); el.damage.appendChild(a); arcs.push({ el: a, t: 0 }); }
  let arcCursor = 0;
  // awareness arrows
  const detects = [];
  for (let i = 0; i < 6; i++) { const a = document.createElement('i'); a.style.opacity = 0; el.detect.appendChild(a); detects.push(a); }

  let hitTimer = 0, noticeTimer = 0, lastHealth = 1, calm = false;
  let objectiveAngle = null, objectiveDist = 0;

  return {
    show(on) { root.hidden = !on; },

    /* `sights`: aiming means looking down the iron sights (first person): the
       crosshair gives way to them */
    crosshair(spread, aimT, fovDeg, sights = false) {
      const px = Math.tan(spread) / Math.tan((fovDeg * Math.PI) / 360) * (window.innerHeight / 2);
      el.cross.style.setProperty('--spread', `${clamp(px, 3, 90).toFixed(1)}px`);
      el.cross.classList.toggle('dot', aimT > 0.5 && !sights);
      el.cross.style.opacity = sights ? (1 - smoothstep(0.2, 0.6, aimT)).toFixed(2) : '';
    },
    hideCrosshair(on) { el.cross.classList.toggle('hidden', on); },

    hitmark(kill) {
      el.hit.classList.add('on');
      el.hit.classList.toggle('kill', !!kill);
      hitTimer = kill ? 0.35 : 0.15;
    },

    damageFrom(relAngle) {
      const a = arcs[arcCursor++ % arcs.length];
      a.el.style.transform = `rotate(${(-relAngle * 180) / Math.PI}deg)`;
      a.el.classList.add('on');
      a.t = 0.9;
    },

    health(frac) {
      if (frac > 0) calm = false;
      el.health.style.width = `${(clamp(frac, 0, 1) * 100).toFixed(1)}%`;
      el.health.classList.toggle('low', frac < 0.35);
      lastHealth = frac;
    },

    stance(text) { if (el.stance.textContent !== text) el.stance.textContent = text; },

    weapon(name, ammo, grenades) {
      el.wname.textContent = name;
      el.mag.textContent = ammo.mag;
      el.reserve.textContent = ammo.reserve;
      el.grenades.textContent = grenades;
      ammoBox.classList.toggle('low', ammo.mag <= 2);
    },

    /* reload progress 0..1 (null: not reloading); hint: magazine low */
    reload(progress, hint) {
      el.reload.hidden = progress == null;
      if (progress != null) el.reloadFill.style.width = `${(progress * 100).toFixed(1)}%`;
      el.reloadHint.hidden = !hint;
    },

    objective(text, flash = true) {
      el.objText.textContent = text;
      if (flash) {
        el.objective.classList.remove('flash');
        void el.objective.offsetWidth;
        el.objective.classList.add('flash');
      }
    },

    /* target bearing relative to the camera yaw (radians, + = left) */
    objectiveMarker(rel, dist) { objectiveAngle = rel; objectiveDist = dist; },

    compass(yaw) {
      // heading: north = +z. yaw 0 looks north; turning left increases yaw (towards +x = west)
      const heading = -yaw;
      const w = el.compass.clientWidth;
      el.strip.style.transform = `translateX(${(w / 2 - heading * PX_PER_RAD).toFixed(1)}px)`;
      if (objectiveAngle == null) { el.mark.style.display = 'none'; return; }
      el.mark.style.display = '';
      const x = clamp(w / 2 - objectiveAngle * PX_PER_RAD, 8, w - 8);
      el.mark.style.left = `${x.toFixed(1)}px`;
      el.dist.textContent = `${Math.round(objectiveDist)} m`;
    },

    notice(text, sub = '', time = 3) {
      el.notice.innerHTML = '';
      el.notice.append(text);
      if (sub) { const s = document.createElement('small'); s.textContent = sub; el.notice.append(s); }
      el.notice.classList.add('on');
      noticeTimer = time;
    },

    prompt(html) {
      if (!html) { el.prompt.hidden = true; return; }
      el.prompt.hidden = false;
      if (el.prompt.innerHTML !== html) el.prompt.innerHTML = html;
    },

    grenadeWarning(on) { el.gwarn.hidden = !on; },

    /* after death: the red of the wounds fades so the view behind reads */
    calm(on) { calm = on; },

    /* list of {angle (rel, + = left), level 0..1, alert} */
    awareness(list) {
      for (let i = 0; i < detects.length; i++) {
        const d = list[i];
        const a = detects[i];
        if (!d) { a.style.opacity = 0; continue; }
        a.style.opacity = (0.25 + 0.75 * d.level).toFixed(2);
        a.style.transform = `rotate(${(-d.angle * 180) / Math.PI}deg)`;
        a.classList.toggle('alert', d.alert);
      }
    },

    debug(text) {
      if (text == null) { el.debug.hidden = true; return; }
      el.debug.hidden = false;
      el.debug.textContent = text;
    },

    update(dt) {
      if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) el.hit.classList.remove('on'); }
      if (noticeTimer > 0) { noticeTimer -= dt; if (noticeTimer <= 0) el.notice.classList.remove('on'); }
      for (const a of arcs) if (a.t > 0) { a.t -= dt; if (a.t <= 0) a.el.classList.remove('on'); }
      const hurt = clamp((0.55 - lastHealth) * 2.2, 0, 1);
      el.hurt.style.opacity = (calm ? Math.min(hurt, 0.2) : hurt).toFixed(2);
    },
  };
}
