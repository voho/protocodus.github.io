/* The flight plan. Scroll position is the only throttle the visitor has: this
   module turns it into a camera pose. Anchors from config.js are threaded on
   a Catmull-Rom; the segment boundaries are the real scroll positions of the
   real sections, measured from the DOM, so a design change to the page moves
   the waypoints without anyone touching a number here. On top of the spline
   ride three small liberties: an idle orbital drift (the station slowly
   wheeling past even when nobody scrolls), a lean toward the pointer, and a
   drag-to-look that eases back home when released. */

import * as THREE from 'three';
import { ANCHORS } from './config.js';

export class FlightPlan {
  constructor(sectionIds) {
    this.sectionIds = sectionIds;
    this.camCurve = new THREE.CatmullRomCurve3(
      ANCHORS.map((a) => new THREE.Vector3(...a.pos)),
      false, 'centripetal',
    );
    this.looks = ANCHORS.map((a) => new THREE.Vector3(...a.look));
    this.stops = [];       // document Y for each anchor
    this.measure();

    // Live pose state, smoothed toward the target pose every frame
    this.pos = this.camCurve.getPoint(0).clone();
    this.look = this.looks[0].clone();
    this.targetPos = this.pos.clone();
    this.targetLook = this.look.clone();

    this.pointer = { x: 0, y: 0 };
    this.lean = { x: 0, y: 0 };
    this.drag = { x: 0, y: 0 };
    this.dragTarget = { x: 0, y: 0 };
    this.progress = 0;

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /* Anchor i sits at section i's centre (first at the top of the document,
     last at the bottom), so arriving at a section means arriving at its
     waypoint. Called on resize — layout is the only input. */
  measure() {
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - innerHeight);
    this.stops = this.sectionIds.map((id, i) => {
      if (i === 0) return 0;
      if (i === this.sectionIds.length - 1) return max;
      const el = document.getElementById(id);
      if (!el) return (i / (this.sectionIds.length - 1)) * max;
      // Through the viewport rather than offsetTop, which measures from the
      // nearest positioned ancestor and silently loses the body's padding
      const r = el.getBoundingClientRect();
      const centre = scrollY + r.top + r.height / 2 - innerHeight / 2;
      return Math.min(max, Math.max(0, centre));
    });
    // Monotonic, or a segment could run backwards
    for (let i = 1; i < this.stops.length; i++) {
      this.stops[i] = Math.max(this.stops[i], this.stops[i - 1] + 1);
    }
  }

  /* Scroll → global t in [0,1], eased inside each segment so the camera
     glides into a waypoint, rests on it while its section is read, and pulls
     away as the reader moves on. */
  progressAt(scrollY) {
    const s = this.stops;
    let i = 0;
    while (i < s.length - 2 && scrollY > s[i + 1]) i++;
    const span = s[i + 1] - s[i];
    const u = THREE.MathUtils.clamp((scrollY - s[i]) / span, 0, 1);
    const eased = u * u * (3 - 2 * u);
    return (i + eased) / (s.length - 1);
  }

  segmentAt(scrollY) {
    const t = this.progressAt(scrollY) * (this.stops.length - 1);
    return { index: Math.round(t), t };
  }

  setPointer(x, y) { this.pointer.x = x; this.pointer.y = y; }
  setDrag(x, y) { this.dragTarget.x = x; this.dragTarget.y = y; }

  /* Compute and smooth the pose; returns speed for the HUD. */
  update(dt, t, scrollY, camera) {
    this.progress = this.progressAt(scrollY);
    const n = this.looks.length - 1;
    const ft = this.progress * n;
    const i = Math.min(Math.floor(ft), n - 1);
    const u = ft - i;

    this.camCurve.getPoint(this.progress, this.targetPos);
    this.targetLook.lerpVectors(this.looks[i], this.looks[i + 1], u * u * (3 - 2 * u));

    // Idle drift: the whole pose swings a few degrees about the look target,
    // so a parked reader still sees the station wheel slowly past.
    const drift = Math.sin(t * 0.05) * 0.14 + t * 0.006;
    this._a.copy(this.targetPos).sub(this.targetLook);
    this._a.applyAxisAngle(this._up, drift);
    this._a.add(this.targetLook);

    // Chase the target: fast enough to feel connected to the scroll wheel,
    // slow enough that a flick lands like a ship, not a cursor.
    const k = 1 - Math.pow(0.0016, dt);
    const prev = this._b.copy(this.pos);
    this.pos.lerp(this._a, k);
    this.look.lerp(this.targetLook, k);

    camera.position.copy(this.pos);
    camera.lookAt(this.look);

    // Pointer lean and drag-look, applied as rotation after lookAt
    this.lean.x += (this.pointer.x - this.lean.x) * 0.04;
    this.lean.y += (this.pointer.y - this.lean.y) * 0.04;
    this.drag.x += (this.dragTarget.x - this.drag.x) * 0.09;
    this.drag.y += (this.dragTarget.y - this.drag.y) * 0.09;
    camera.rotateY(-this.lean.x * 0.045 - this.drag.x);
    camera.rotateX(-this.lean.y * 0.03 - this.drag.y);

    return prev.sub(this.pos).length() / Math.max(dt, 0.001);
  }
}
