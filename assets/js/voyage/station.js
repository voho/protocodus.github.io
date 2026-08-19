/* The station — the thing the whole voyage orbits. A spindle on the vertical,
   two counter-rotating habitat tori, four arms (three of them docking
   cradles, the fourth the forge, where a hull sits half-built in a lit
   scaffold), a signal spire with a slow dish, and a few thousand windows
   drawn as one cloud of points. Every part is procedural; there is no model
   file anywhere. */

import * as THREE from 'three';
import { PALETTE, WORLD } from './config.js';
import { hullTexture, windowTexture, glowTexture } from './textures.js';

const ARM = WORLD.armLength;

function hullMaterial(tint = 0xffffff, rough = 0.55) {
  const map = hullTexture();
  return new THREE.MeshStandardMaterial({
    map, color: tint, roughness: rough, metalness: 0.4,
  });
}

/* One cloud of lit windows. Given a list of [x,y,z,warmth] tuples it builds a
   single Points object — a thousand lives on the station for one draw call. */
function windowCloud(list, size = 3.4) {
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const warm = new THREE.Color(0xffd9a0);
  const cool = new THREE.Color(0xbfe9ff);
  const mint = new THREE.Color(PALETTE.mint);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const [x, y, z, w] = list[i];
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    c.copy(w > 0.92 ? mint : w > 0.45 ? warm : cool);
    c.multiplyScalar(0.7 + Math.random() * 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    phase[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: windowTexture() }, uSize: { value: size } },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uTime;
      uniform float uSize;
      varying vec3 vColor;
      varying float vOn;
      void main() {
        vColor = aColor;
        // A window is on or it is off; a handful toggle while you watch
        float s = sin(uTime * 0.2 + aPhase * 13.7);
        vOn = step(-0.96, s);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (620.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      varying vec3 vColor;
      varying float vOn;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        gl_FragColor = vec4(vColor, a * vOn);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.update = (t) => { mat.uniforms.uTime.value = t; };
  return points;
}

/* Windows wrapped around a cylinder of the spindle. */
function cylinderWindows(list, r, y0, y1, rows, perRow) {
  for (let row = 0; row < rows; row++) {
    const y = y0 + (y1 - y0) * (row + 0.5) / rows;
    for (let i = 0; i < perRow; i++) {
      if (Math.random() < 0.25) continue;   // dark offices exist
      const a = (i / perRow) * Math.PI * 2 + row * 0.13;
      list.push([Math.cos(a) * (r + 0.4), y, Math.sin(a) * (r + 0.4), Math.random()]);
    }
  }
}

function navLight(color, size = 6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(64), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

export function buildStation(quality) {
  const group = new THREE.Group();
  // The map is dark; the tint has to carry the metal up to where sun and
  // skylight can shape it. Untinted it reads as a silhouette with windows.
  const hull = hullMaterial(0xdde3ea, 0.5);
  const hullDark = hullMaterial(0xaab2bd, 0.65);
  const pulses = [];      // {sprite, rate, phase, min}
  const windows = [];     // static cloud
  const updaters = [];

  /* ---- Spindle ---------------------------------------------------------- */
  const spindle = new THREE.Group();
  const parts = [
    [16, 20, 250, 15, 0],        // main trunk, y -110..140
    [24, 24, 44, 122, 0],        // upper module
    [26, 30, 34, -60, 0],        // lower bulge where torus B meets it
    [9, 11, 90, -160, 0],        // lower boom
  ];
  for (const [rt, rb, h, y] of parts) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), hull);
    m.position.y = y;
    spindle.add(m);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(24, 24, 16), hullDark);
  dome.position.y = 152;
  spindle.add(dome);
  // Two broad lit decks where the trunk meets the tori — the station's own
  // storefronts, so the middle of the silhouette carries light of its own
  for (const [y, r] of [[55, 22], [-55, 27]]) {
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 6, 24),
      new THREE.MeshStandardMaterial({
        color: 0x2a313b, roughness: 0.4, metalness: 0.2,
        emissive: 0xffd9a0, emissiveIntensity: 0.35,
      }),
    );
    deck.position.y = y;
    spindle.add(deck);
  }
  // Greebles: tanks and antennae, jittered but seeded once at build
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = -90 + Math.random() * 200;
    const g = new THREE.Mesh(
      Math.random() < 0.5
        ? new THREE.BoxGeometry(4 + Math.random() * 8, 3 + Math.random() * 10, 4)
        : new THREE.CylinderGeometry(1.5, 1.5, 8 + Math.random() * 14, 8),
      hullDark,
    );
    const r = 17 + Math.random() * 3;
    g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    g.lookAt(0, y, 0);
    spindle.add(g);
  }
  group.add(spindle);
  cylinderWindows(windows, 16.4, -95, 130, 30, 34);
  cylinderWindows(windows, 24.4, 104, 140, 6, 48);
  cylinderWindows(windows, 27, -75, -48, 5, 40);

  /* ---- Solar wings on the lower boom ------------------------------------ */
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x1a3a63, roughness: 0.3, metalness: 0.7,
    emissive: 0x0a2038, emissiveIntensity: 1.1,
  });
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(90, 0.8, 26), panelMat);
    wing.position.set(side * 56, -160, 0);
    wing.rotation.z = side * 0.08;
    group.add(wing);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 24, 6), hullDark);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(side * 16, -160, 0);
    group.add(strut);
  }

  /* ---- Habitat tori ------------------------------------------------------ */
  const makeTorus = (radius, tube, y, spokes, speed) => {
    const wheel = new THREE.Group();
    wheel.position.y = y;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 72), hull);
    ring.rotation.x = Math.PI / 2;
    wheel.add(ring);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, radius, 8), hullDark);
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = -a;
      spoke.position.set(Math.cos(a) * radius / 2, 0, Math.sin(a) * radius / 2);
      wheel.add(spoke);
    }
    // The torus carries its own windows so they revolve with it
    const wlist = [];
    const per = Math.floor(quality.windows / 6);
    for (let i = 0; i < per; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      wlist.push([
        Math.cos(a) * (radius + Math.cos(b) * (tube + 0.4)),
        Math.sin(b) * (tube + 0.4) * 0.7,
        Math.sin(a) * (radius + Math.cos(b) * (tube + 0.4)),
        Math.random(),
      ]);
    }
    const wc = windowCloud(wlist, 3);
    wheel.add(wc);
    updaters.push((dt, t) => { wheel.rotation.y += speed * dt; wc.update(t); });
    group.add(wheel);
    return wheel;
  };
  makeTorus(120, 14, 55, 4, 0.05);
  makeTorus(86, 10, -55, 3, -0.075);

  /* ---- Arms: three docking cradles and the forge ------------------------- */
  const docks = [];
  const armAngles = [Math.PI / 2, Math.PI, Math.PI * 1.5];   // +Z, -X, -Z
  const allArms = [0, ...armAngles];                          // 0 = the forge
  for (const a of allArms) {
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(ARM - 30, 9, 9), hullDark);
    arm.position.copy(dir).multiplyScalar((ARM - 30) / 2 + 20);
    arm.position.y = 8;
    arm.rotation.y = -a;
    group.add(arm);
    // Light the arm's length faintly
    for (let i = 0; i < 8; i++) {
      const d = 30 + (i / 8) * (ARM - 40);
      windows.push([dir.x * d, 11, dir.z * d, 0.95]);
    }
  }

  for (const a of armAngles) {
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tip = dir.clone().multiplyScalar(ARM);
    tip.y = 8;
    // The cradle: two plates and a spine the shuttles slide between
    const cradle = new THREE.Group();
    cradle.position.copy(tip);
    cradle.rotation.y = -a;
    const plateGeo = new THREE.BoxGeometry(26, 1.5, 12);
    for (const dy of [-7, 7]) {
      const p = new THREE.Mesh(plateGeo, hull);
      p.position.y = dy;
      cradle.add(p);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 15, 12), hullDark);
    back.position.x = -13;
    cradle.add(back);
    group.add(cradle);

    const light = navLight(PALETTE.yellow, 7);
    light.position.copy(tip).add(new THREE.Vector3(0, 11, 0));
    group.add(light);
    pulses.push({ sprite: light, rate: 1.4, phase: a, min: 0.15 });

    docks.push({
      // Where a ship comes to rest, and the direction it approaches from
      pos: tip.clone().add(dir.clone().multiplyScalar(4)),
      approach: dir.clone(),
    });
  }

  /* ---- The forge --------------------------------------------------------- */
  const forge = new THREE.Group();
  forge.position.set(ARM + 22, 8, 0);
  // Scaffold: a lattice drawn as edges, mint like every working structure
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(64, 30, 30, 4, 2, 2)),
    new THREE.LineBasicMaterial({ color: PALETTE.mintDeep, transparent: true, opacity: 0.5 }),
  );
  forge.add(frame);
  // The hull under construction: solid at the bow, wireframe at the stern —
  // a product shipping one release at a time, drawn literally.
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 6.5, 22, 8), hullMaterial(0xb9c2cc));
  bow.rotation.z = Math.PI / 2;
  bow.position.x = 17;
  forge.add(bow);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7, 18, 8), hullMaterial(0xb9c2cc));
  mid.rotation.z = Math.PI / 2;
  mid.position.x = -3;
  forge.add(mid);
  const stern = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CylinderGeometry(7, 5.5, 20, 8)),
    new THREE.LineBasicMaterial({ color: PALETTE.mint, transparent: true, opacity: 0.7 }),
  );
  stern.rotation.z = Math.PI / 2;
  stern.position.x = -21;
  forge.add(stern);

  // Welding: a light that wanders the seam, sparks that live and die, and a
  // strobe — the flicker is most of what says "work is happening here"
  const weldLight = new THREE.PointLight(0xbfffff, 60, 90, 2);
  forge.add(weldLight);
  const weldGlow = navLight(0xdfffff, 10);
  forge.add(weldGlow);
  const sparkN = 26;
  const sparkPos = new Float32Array(sparkN * 3);
  const sparkVel = [];
  const sparkLife = new Float32Array(sparkN);
  for (let i = 0; i < sparkN; i++) { sparkLife[i] = Math.random(); sparkVel.push(new THREE.Vector3()); }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    map: glowTexture(32), color: 0xffe9b0, size: 2.6, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  forge.add(sparks);
  const weldAt = new THREE.Vector3();
  updaters.push((dt, t) => {
    // The torch walks the stern seam slowly; sparks fall away from it
    weldAt.set(-12 + Math.sin(t * 0.23) * 10, Math.sin(t * 0.4) * 5, Math.cos(t * 0.31) * 6);
    const arc = Math.random() < 0.55 ? (0.4 + Math.random()) : 0.05;
    weldLight.position.copy(weldAt);
    weldLight.intensity = 60 * arc;
    weldGlow.position.copy(weldAt);
    weldGlow.material.opacity = Math.min(1, arc);
    for (let i = 0; i < sparkN; i++) {
      sparkLife[i] -= dt * 1.6;
      if (sparkLife[i] <= 0) {
        sparkLife[i] = 0.4 + Math.random() * 0.6;
        sparkPos.set([weldAt.x, weldAt.y, weldAt.z], i * 3);
        sparkVel[i].set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(18);
      }
      sparkPos[i * 3] += sparkVel[i].x * dt;
      sparkPos[i * 3 + 1] += (sparkVel[i].y - 14 * (1 - sparkLife[i])) * dt;
      sparkPos[i * 3 + 2] += sparkVel[i].z * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  });
  group.add(forge);

  /* ---- Signal spire ------------------------------------------------------ */
  const spire = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 4, 70, 8), hullDark);
  mast.position.y = 185;
  spire.add(mast);
  // The dish: a shallow lathe bowl, slowly tracking something off to port
  const bowlPts = [];
  for (let i = 0; i <= 10; i++) {
    const r = (i / 10) * 16;
    bowlPts.push(new THREE.Vector2(r, r * r * 0.03));
  }
  const dish = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlPts, 20), hullMaterial(0xcfd6dd));
  bowl.rotation.x = -0.5;
  dish.add(bowl);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 10, 6), hullDark);
  feed.rotation.x = -0.5;
  feed.position.set(0, 4, 2.4);
  dish.add(feed);
  dish.position.y = 214;
  spire.add(dish);
  updaters.push((dt, t) => { dish.rotation.y = Math.sin(t * 0.11) * 0.9 + 0.4; });

  // Aviation strobe on top — white, brief, honest
  const strobe = navLight(0xffffff, 9);
  strobe.position.y = 226;
  spire.add(strobe);
  pulses.push({ sprite: strobe, rate: 0.9, phase: 0, min: 0, sharp: true });
  const beacon = navLight(0xff4444, 5);
  beacon.position.y = 222;
  spire.add(beacon);
  pulses.push({ sprite: beacon, rate: 0.5, phase: 1.6, min: 0.1 });

  /* Signal rings: the spire's transmission, three tori forever leaving —
     kept small enough to belong to the dish rather than to the sky. */
  const ringMat = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: PALETTE.mint, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.3, 6, 48), m);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 216;
    spire.add(ring);
    ringMat.push({ ring, m, offset: i / 3 });
  }
  updaters.push((dt, t) => {
    for (const { ring, m, offset } of ringMat) {
      const u = (t * 0.22 + offset) % 1;
      ring.scale.setScalar(0.4 + u * 4);
      ring.position.y = 216 + u * 26;
      m.opacity = 0.4 * Math.sin(Math.PI * u) * Math.max(0, 1 - u * 0.7);
    }
  });
  group.add(spire);

  /* ---- Static windows + pulsing lights ----------------------------------- */
  const staticCloud = windowCloud(windows);
  group.add(staticCloud);
  const mintTip = navLight(PALETTE.mint, 6);
  mintTip.position.set(0, -206, 0);
  group.add(mintTip);
  pulses.push({ sprite: mintTip, rate: 0.7, phase: 0.4, min: 0.2 });

  return {
    group,
    docks,
    update(dt, t) {
      for (const u of updaters) u(dt, t);
      staticCloud.update(t);
      for (const p of pulses) {
        const s = Math.sin(t * Math.PI * 2 * p.rate + p.phase) * 0.5 + 0.5;
        p.sprite.material.opacity = p.min + (1 - p.min) * (p.sharp ? Math.pow(s, 14) : s);
      }
    },
  };
}
