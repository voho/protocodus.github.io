/* The stage: renderer, scene, camera, lights, clock and the frame loop.
   Everything else registers an `update(dt, t)` and gets called while the tab
   is visible. Also home to the resolution governor — the one piece of the
   voyage allowed to trade sharpness for frame time. */

import * as THREE from 'three';
import { PALETTE, WORLD } from './config.js';

export class Stage {
  constructor(canvas, quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // The page shows through nothing — an opaque buffer is cheaper
      alpha: false,
    });
    this.renderer.setClearColor(PALETTE.space, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    // Just enough haze that distance reads; the abyss makes its own darkness
    this.scene.fog = new THREE.FogExp2(PALETTE.space, 0.00028);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 9000);
    this.camera.position.set(...([235, 95, 470]));
    this.baseFov = 58;

    const sun = new THREE.DirectionalLight(WORLD.sun.color, WORLD.sun.intensity);
    sun.position.set(...WORLD.sun.dir).multiplyScalar(2000);
    this.scene.add(sun);
    this.sun = sun;

    // Skylight: a faint blue from above (the nebula), almost nothing below.
    // Strong enough that the station's night faces read as metal, not holes.
    this.scene.add(new THREE.HemisphereLight(0x41527a, 0x0b0e16, 1.05));
    // The planet is big enough to bounce a little light back at the station
    const bounce = new THREE.DirectionalLight(0x2a4d63, 0.7);
    bounce.position.set(-1, 0.3, -1).multiplyScalar(1000);
    this.scene.add(bounce);

    this.updaters = [];
    this.running = false;
    this.pixelScale = 1;      // the governor's dial, 1 → 0.6
    this.slowFrames = 0;
    this.slowSeconds = 0;     // time spent under ~12fps with the dial at 0.6

    this.onFrame = null;      // page hook, called after each render
    this.onTooSlow = null;    // called once if this machine cannot fly at all

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    addEventListener('resize', this.resize);
    this.resize();

    // Named so dispose() can take it back down — a retained visibility
    // listener would happily restart a disposed stage behind the page
    this.onVisibility = () => {
      if (document.hidden) this.pause();
      else this.play();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.quality.dprCap) * this.pixelScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  add(object, update) {
    if (object) this.scene.add(object);
    if (update) this.updaters.push(update);
  }

  play() {
    if (this.running || this.disposed || this.held) return;
    this.running = true;
    this.last = undefined;
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    this.running = false;
    // The queued frame goes too: left pending, it would fire on the next
    // play() alongside the new one and each would breed its own loop —
    // one extra full render per display frame per hide/restore cycle.
    cancelAnimationFrame(this.raf);
  }

  /* A hold outranks everything that calls play() — the visibility handler
     included. It exists for the boot: the scene warms its shaders, then
     waits without spending a single frame until ENGAGE releases it. */
  hold() {
    this.held = true;
    this.pause();
  }

  release() {
    this.held = false;
    this.play();
  }

  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    // A backgrounded tab hands the first frame back a huge delta; clamping
    // keeps every animation continuous rather than teleporting. The raw
    // interval survives alongside it, because the performance accounting
    // below has to measure wall time — a clamped delta makes a 3fps machine
    // look three times faster than it is.
    if (this.last === undefined) this.last = now;
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(rawDt, 0.1);
    this.last = now;
    this.elapsed = (this.elapsed || 0) + dt;
    // Wall time for the accounting below — the animation clock crawls on a
    // slow machine, which is exactly when the accounting matters most.
    // Capped so a backgrounded stretch doesn't count as time served.
    this.wall = (this.wall || 0) + Math.min(rawDt, 2);
    const t = this.elapsed;

    for (const u of this.updaters) u(dt, t);
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame(dt, t);

    // The governor: three wall-clock seconds spent missing frames and the
    // buffer shrinks a step. Time rather than a frame count, because a
    // machine at five frames a second takes half a minute to show ninety of
    // them. It never grows back within a visit — a machine that struggled
    // once will struggle again, and resolution flapping is worse than
    // either setting.
    if (rawDt > 0.034 && rawDt < 2) {
      this.slowFrames += rawDt;
      if (this.slowFrames > 3 && this.pixelScale > 0.6) {
        this.pixelScale = Math.max(0.6, this.pixelScale - 0.2);
        this.slowFrames = 0;
        this.resize();
      }
    } else if (this.slowFrames > 0) {
      this.slowFrames = Math.max(0, this.slowFrames - rawDt);
    }

    // The last resort: with the dial already on the floor and the frame
    // rate still unusable, this machine has no business flying — a page at
    // three frames a second is broken, whatever it looks like in stills.
    // A grace period covers shader warm-up, and one report is all it gets.
    // Intervals over 2s are a tab coming back from the background, not a
    // slow frame, and count for nothing.
    if (this.onTooSlow && this.pixelScale <= 0.6 && this.wall > 6) {
      if (rawDt > 0.085 && rawDt < 2) this.slowSeconds += rawDt;
      else this.slowSeconds = Math.max(0, this.slowSeconds - rawDt * 2);
      if (this.slowSeconds > 6) {
        const report = this.onTooSlow;
        this.onTooSlow = null;
        report();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.pause();
    removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }
}
