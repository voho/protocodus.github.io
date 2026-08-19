/* The voyage, assembled. This module owns the WebGL side of the page: the
   stage, the station and everything flying around it, the camera's flight
   plan, warp, and the synthesised ambience. The page script decides WHETHER
   any of this runs (see the gate in assets/js/main.js) and drives it through
   the small object returned here — so the boundary between document and
   simulation stays one function wide. */

import * as THREE from 'three';
import { detectQuality, ANCHORS } from './config.js';
import { Stage } from './stage.js';
import { buildStarfield } from './starfield.js';
import { buildNebula } from './nebula.js';
import { buildPlanet } from './planet.js';
import { buildStation } from './station.js';
import { buildGates } from './gates.js';
import { buildTraffic, buildLiners } from './traffic.js';
import { buildAbyss } from './abyss.js';
import { buildFlyby } from './flyby.js';
import { buildWarp } from './warp.js';
import { FlightPlan } from './path.js';
import { createSound } from './sound.js';

export function createVoyage({ canvas, sectionIds, onTelemetry, onTooSlow }) {
  const quality = detectQuality();
  const stage = new Stage(canvas, quality);
  if (onTooSlow) stage.onTooSlow = onTooSlow;
  const { scene, camera } = stage;
  scene.add(camera);   // warp streaks are children of the camera

  const stars = buildStarfield(quality);
  stage.add(stars.group, stars.update);

  const nebula = buildNebula(quality);
  stage.add(nebula.group, nebula.update);

  const planet = buildPlanet();
  stage.add(planet.group, planet.update);

  const station = buildStation(quality);
  stage.add(station.group, station.update);

  const gates = buildGates();
  stage.add(gates.group, gates.update);

  const traffic = buildTraffic(quality, station.docks, gates);
  stage.add(traffic.group, traffic.update);

  const liners = buildLiners();
  stage.add(liners.group, liners.update);

  const abyss = buildAbyss(quality);
  stage.add(abyss.group, (dt, t) => abyss.update(dt, t, camera));

  const flyby = buildFlyby(scene, camera);
  stage.add(null, flyby.update);

  const warp = buildWarp(camera, quality);
  const sound = createSound();
  const plan = new FlightPlan(sectionIds);

  /* Warp timeline: the page announces a jump's length; strength rises fast,
     rides, and falls with it. FOV and star dimming hang off strength. */
  let warpUntil = 0;
  let warpClock = 0;
  stage.add(null, (dt, t) => {
    warpClock = t;
    let target = 0;
    if (t < warpUntil) target = 1;
    const s = warp.strength + (target - warp.strength) * (1 - Math.pow(target ? 0.002 : 0.02, dt));
    warp.set(s);
    stars.setDim(1 - s * 0.75);
    const fov = stage.baseFov + s * 24;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  /* The camera follows the plan; telemetry goes back to the HUD. */
  let smoothVel = 0;
  stage.add(null, (dt, t) => {
    const speed = plan.update(dt, t, scrollY, camera);
    smoothVel += (speed - smoothVel) * Math.min(1, dt * 3);
    if (onTelemetry) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      onTelemetry({
        vel: warp.strength > 0.05 ? 1 + warp.strength * 8 : Math.min(0.99, smoothVel / 320),
        warp: warp.strength > 0.05,
        hdg: (Math.round(THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z))) + 360) % 360,
        rng: camera.position.distanceTo(plan.look),
        progress: plan.progress,
      });
    }
  });

  /* Pointer lean (mouse only) and drag-to-look. Touch keeps its native
     scroll; hijacking it would cost the one control everyone already has. */
  const finePointer = matchMedia('(pointer: fine)').matches;
  const onMove = (e) => {
    plan.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  };
  if (finePointer) addEventListener('pointermove', onMove, { passive: true });

  let dragging = false;
  let dragFrom = null;
  const dragIgnore = (t) => t.closest && t.closest('a, button, input, textarea, select, .menu, .boot, .hud');
  const onDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || dragIgnore(e.target)) return;
    dragging = true;
    dragFrom = { x: e.clientX, y: e.clientY };
  };
  const onDrag = (e) => {
    if (!dragging) return;
    plan.setDrag(
      THREE.MathUtils.clamp((e.clientX - dragFrom.x) / innerWidth * 1.4, -0.5, 0.5),
      THREE.MathUtils.clamp((e.clientY - dragFrom.y) / innerHeight * 1.0, -0.35, 0.35),
    );
  };
  const onUp = () => {
    dragging = false;
    plan.setDrag(0, 0);   // the view eases back home on its own spring
  };
  addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onDrag, { passive: true });
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);

  const onResize = () => plan.measure();
  addEventListener('resize', onResize);
  // Section heights settle late (fonts, images); measure again when idle
  if ('requestIdleCallback' in window) requestIdleCallback(() => plan.measure());
  else setTimeout(() => plan.measure(), 600);

  // Render one frame now so ENGAGE lifts the curtain on a finished scene
  // rather than a compile hitch: the first render is where WebGL pays for
  // all its shaders at once.
  stage.play();

  return {
    zoneLabels: ANCHORS.map((a) => a.label),
    sound,

    engage() {
      flyby.play();
      plan.measure();
    },

    /* A nav jump of `ms` milliseconds: light the streaks for its duration. */
    warpBurst(ms) {
      warpUntil = warpClock + ms / 1000;
      sound.warp();
    },

    remeasure() { plan.measure(); },

    dispose() {
      if (finePointer) removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onDrag);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('resize', onResize);
      stage.dispose();
    },
  };
}
