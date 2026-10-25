/* Zipper — the board on the table: tiles, numbered pucks, glowing walls
   and the line itself, which grows and shrinks after the player's path. */
import * as THREE from 'three';
import { slabGeometry, digitTexture, labelMesh } from '../../shared/slab.js';

const CELL = 1;
const TILE = 0.9, TILE_H = 0.16, TILE_R = 0.16;
const LINE_Y = TILE_H + 0.16;
const LINE_R = 0.14;
const STEP_TIME = 0.085;
const easeOut = (t) => 1 - (1 - t) ** 3;
const ease = (value, goal, dt, speed) => value + (goal - value) * (1 - Math.exp(-dt * speed));

export function createBoard(stage, puzzle, { theme, fx }) {
  const n = puzzle.size, N = n * n;
  const accent = theme.accent;
  const group = new THREE.Group();
  stage.scene.add(group);
  const mid = (n - 1) / 2;
  const cellX = (cell) => ((cell % n) - mid) * CELL;
  const cellZ = (cell) => (Math.floor(cell / n) - mid) * CELL;
  const accentColour = new THREE.Color(accent);
  const disposables = [];

  const plinthSize = n * CELL + 0.5;
  const plinth = new THREE.Mesh(slabGeometry(plinthSize, plinthSize, 0.3, 0.26, 0.05),
    stage.material({ color: theme.plinth, roughness: 0.2, metalness: 0.3, clearcoatRoughness: 0.08 }));
  plinth.position.y = -0.3;
  plinth.castShadow = plinth.receiveShadow = true;
  group.add(plinth);
  disposables.push(plinth.material);

  const tileGeometry = slabGeometry(TILE, TILE, TILE_H, TILE_R, 0.035);
  const tiles = [];
  const { hue, sat, light, lit: litSpec } = theme.tiles;
  for (let cell = 0; cell < N; cell++) {
    // Deep tones in the theme's hues, shading from one corner to the
    // other, that light up to candy brightness under the line.
    const spread = ((cell % n) + Math.floor(cell / n)) / Math.max(1, 2 * (n - 1));
    const h = hue[0] + (hue[1] - hue[0]) * spread;
    const base = new THREE.Color().setHSL(h, sat, light, THREE.SRGBColorSpace);
    const litHue = litSpec.hue ? litSpec.hue[0] + (litSpec.hue[1] - litSpec.hue[0]) * spread : h;
    const lit = new THREE.Color().setHSL(litHue, litSpec.sat, litSpec.light, THREE.SRGBColorSpace);
    const material = stage.material({ color: base, roughness: 0.32, metalness: 0.05, emissive: accentColour, emissiveIntensity: 0, clearcoatRoughness: 0.2 });
    const mesh = new THREE.Mesh(tileGeometry, material);
    mesh.position.set(cellX(cell), 0, cellZ(cell));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = { glow: 0, lift: 0, press: 0, shake: 0, hopAt: -1, on: false, base, lit, hue: -1 };
    group.add(mesh);
    tiles.push(mesh);
    disposables.push(material);
  }

  const puckGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 40);
  disposables.push(puckGeometry);
  const pucks = new Map();
  puzzle.waypoints.forEach((cell, index) => {
    const material = stage.material({ color: '#ffffff', roughness: 0.15, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0, clearcoatRoughness: 0.05 });
    const puck = new THREE.Mesh(puckGeometry, material);
    puck.position.set(cellX(cell), TILE_H + 0.045, cellZ(cell));
    puck.castShadow = true;
    const texture = digitTexture(String(index + 1), '#0d0e12');
    const label = labelMesh(texture, 0.48, 1);
    label.position.y = 0.047;
    // The path passes through numbered cells; their numerals stay readable
    // over it, including the initial 1 beneath the line's starting point.
    label.material.depthTest = false;
    label.renderOrder = 4;
    puck.add(label);
    puck.userData = { glow: 0, pulse: 0, reached: false };
    group.add(puck);
    pucks.set(cell, puck);
    disposables.push(material, texture, label.material);
  });

  const wallColour = new THREE.Color(theme.wall);
  const wallAlong = slabGeometry(0.1, 0.96, 0.34, 0.05, 0.015);
  const wallAcross = slabGeometry(0.96, 0.1, 0.34, 0.05, 0.015);
  const walls = new Map();
  for (const [a, b] of puzzle.walls) {
    const sameRow = Math.abs(a - b) === 1;
    const material = new THREE.MeshStandardMaterial({ color: wallColour, emissive: wallColour, emissiveIntensity: 1.5, roughness: 0.4 });
    const mesh = new THREE.Mesh(sameRow ? wallAlong : wallAcross, material);
    mesh.position.set((cellX(a) + cellX(b)) / 2, 0, (cellZ(a) + cellZ(b)) / 2);
    mesh.castShadow = true;
    mesh.userData = { flash: 0 };
    group.add(mesh);
    walls.set(a < b ? `${a}-${b}` : `${b}-${a}`, mesh);
    disposables.push(material);
  }

  const lineMaterial = stage.material({ color: accentColour, emissive: accentColour, emissiveIntensity: 1.3, roughness: 0.15, clearcoatRoughness: 0.05 });
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), lineMaterial);
  tube.castShadow = true;
  tube.visible = false;
  const tail = new THREE.Mesh(new THREE.SphereGeometry(LINE_R, 24, 16), lineMaterial);
  tail.castShadow = true;
  const headMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: accentColour, emissiveIntensity: 2.2, roughness: 0.2 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(LINE_R * 1.45, 28, 20), headMaterial);
  head.castShadow = true;
  const lamp = new THREE.PointLight(accentColour, 3, 4.5, 1.6);
  lamp.position.y = 0.45;
  head.add(lamp);
  group.add(tube, tail, head);
  disposables.push(lineMaterial, headMaterial, tail.geometry, head.geometry);

  stage.frame(plinthSize / 2, plinthSize / 2);

  let target = [puzzle.waypoints[0]];
  const shown = { cells: [puzzle.waypoints[0]], t: 1 };
  const onLine = new Uint8Array(N);
  const points = [];
  let hovered = -1;
  let linePulse = 0;
  let headShake = 0;
  let dirty = true;
  let hintCells = new Set();
  let hintUntil = -1;
  let hintMistake = false;
  const mistakeColour = new THREE.Color('#ff7777');
  // A ripple: every tile rises and flashes in turn by its distance from a move.
  const rippleAt = new Float32Array(N).fill(-1);
  const rippleColour = new THREE.Color(accent);
  let rippleStrength = 1;
  let rippleStarted = -1;
  let sparkleAt = 0;
  const distance = (a, b) => Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  function ripple(from, colour, strength = 1) {
    // A fast drag steps several times a second; the small ripples wait their
    // turn so the board pulses rather than whites out.
    if (strength < 0.5 && stage.time - rippleStarted < 0.3) return;
    rippleStarted = stage.time;
    rippleColour.set(colour);
    rippleStrength = strength;
    for (let cell = 0; cell < N; cell++) rippleAt[cell] = stage.time + distance(from, cell) * 0.04;
    stage.wake(1.5);
  }
  const at = (cell, y = LINE_Y) => new THREE.Vector3(cellX(cell), y, cellZ(cell));

  function rebuildLine() {
    const cells = shown.cells;
    for (let i = 0; i < cells.length; i++) {
      points[i] = points[i] || new THREE.Vector3();
      points[i].set(cellX(cells[i]), LINE_Y, cellZ(cells[i]));
    }
    points.length = cells.length;
    onLine.fill(0);
    for (let i = 0; i < cells.length; i++) onLine[cells[i]] = i === cells.length - 1 && shown.t < 0.5 ? 0 : 1;
    if (cells.length > 1 && shown.t < 1) {
      const last = points[points.length - 1];
      last.lerpVectors(points[points.length - 2], last, Math.max(0.03, easeOut(shown.t)));
    }
    head.position.copy(points[points.length - 1]);
    tail.position.copy(points[0]);
    const atNumber = puzzle.numbers[cells[cells.length - 1]] && shown.t >= 1;
    head.visible = !atNumber;
    tail.visible = !puzzle.numbers[cells[0]];
    if (points.length < 2) { tube.visible = false; return; }
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), LINE_R, 14, false);
    tube.geometry.dispose();
    tube.geometry = geometry;
    tube.visible = true;
  }

  function update(dt, time) {
    let common = 0;
    while (common < shown.cells.length && common < target.length && shown.cells[common] === target[common]) common++;
    const pending = (shown.cells.length - common) + (target.length - common);
    const rate = (1 / STEP_TIME) * Math.max(1, pending * 0.75);
    if (shown.cells.length > common) {
      shown.t -= dt * rate;
      if (shown.t <= 0) { shown.cells.pop(); shown.t = 1; }
      dirty = true;
    } else if (target.length > shown.cells.length) {
      if (shown.t >= 1) { shown.cells.push(target[shown.cells.length]); shown.t = 0; }
      shown.t = Math.min(1, shown.t + dt * rate);
      dirty = true;
    } else if (shown.t < 1) {
      shown.t = Math.min(1, shown.t + dt * rate);
      dirty = true;
    }
    if (dirty) { rebuildLine(); dirty = false; stage.wake(0.3); }
    if (fx.confetti.alive || fx.sparks.alive) stage.wake(0.3);
    // The head sheds a sparkle or two while the line is on the move.
    if (shown.t < 1 && time > sparkleAt) {
      sparkleAt = time + 0.08;
      fx.sparks.burst({ origin: head.position, count: 1, colours: ['#ffffff', accent], speed: [0.3, 0.8], spread: Math.PI, gravityPull: -0.6, airDrag: 2, lifespan: [0.25, 0.45], size: [0.04, 0.04], spinRate: 3 });
    }
    group.position.y = stage.reduced ? 0 : Math.sin(time * 0.6) * 0.03;

    for (let cell = 0; cell < N; cell++) {
      const tile = tiles[cell];
      const data = tile.userData;
      const on = onLine[cell] === 1;
      data.glow = ease(data.glow, on ? 0.5 : hovered === cell ? 0.2 : 0, dt, 12);
      // Covered tiles show their candy colour; the accent glow stays a tint.
      data.lift = ease(data.lift, hovered === cell && !on ? 0.05 : 0, dt, 14);
      data.press = Math.max(0, data.press - dt * 5);
      data.shake = Math.max(0, data.shake - dt * 4);
      let hop = 0;
      if (data.hopAt >= 0) {
        const u = (time - data.hopAt) / 0.5;
        if (u >= 1) data.hopAt = -1;
        else if (u > 0) hop = Math.sin(u * Math.PI);
      }
      let wave = 0;
      if (rippleAt[cell] >= 0) {
        const u = (time - rippleAt[cell]) / 0.45;
        if (u >= 1) rippleAt[cell] = -1;
        else if (u > 0) wave = Math.sin(u * Math.PI) * rippleStrength;
      }
      const hinted = time < hintUntil && hintCells.has(cell);
      const emissive = tile.material.emissive;
      emissive.copy(hinted && hintMistake ? mistakeColour : accentColour);
      if (wave > 0) emissive.lerp(rippleColour, Math.min(1, wave));
      // A solved board runs a rainbow along the line as the tiles hop.
      if (hop > 0 && data.hue >= 0) emissive.setHSL((data.hue + time * 0.15) % 1, 1, 0.6, THREE.SRGBColorSpace);
      tile.material.emissiveIntensity = data.glow * 0.35 + data.press * 0.7 + hop * 0.7 + wave * 0.55
        + (hinted ? 0.5 + Math.sin(time * 6) * 0.2 : 0);
      if (hinted) stage.wake(0.3);
      tile.material.color.lerpColors(data.base, data.lit, Math.min(1, data.glow * 2));
      tile.position.y = data.lift - data.press * 0.06 + hop * 0.18 + wave * 0.07;
      tile.position.x = cellX(cell) + Math.sin(time * 60) * 0.04 * data.shake;
    }
    for (const [cell, puck] of pucks) {
      const data = puck.userData;
      const reached = onLine[cell] === 1;
      if (reached && !data.reached) data.pulse = 1;
      data.reached = reached;
      data.glow = ease(data.glow, reached ? 0.12 : 0, dt, 10);
      data.pulse = Math.max(0, data.pulse - dt * 3);
      puck.material.emissiveIntensity = data.glow + data.pulse * 0.15;
      const scale = 1 + Math.sin(data.pulse * Math.PI) * 0.22;
      puck.scale.set(scale, 1, scale);
      puck.position.y = TILE_H + 0.045 + tiles[cell].position.y;
    }
    for (const wall of walls.values()) {
      wall.userData.flash = Math.max(0, wall.userData.flash - dt * 4);
      wall.material.emissiveIntensity = 1.5 + wall.userData.flash * 3;
      wall.position.y = Math.sin(time * 50) * 0.03 * wall.userData.flash;
    }
    linePulse = Math.max(0, linePulse - dt * 1.2);
    lineMaterial.emissiveIntensity = 1.3 + linePulse * 0.9;
    headShake = Math.max(0, headShake - dt * 5);
    const beat = 1 + Math.sin(time * 4) * 0.05 + headShake * 0.3;
    head.scale.set(beat, beat, beat);
    headMaterial.emissiveIntensity = 2.2 + linePulse;
    lamp.intensity = 2.6 + Math.sin(time * 4) * 0.4 + linePulse * 4;
    fx.confetti.update(dt);
    fx.sparks.update(dt);
  }
  const stopFrames = stage.onFrame(update);

  const wallKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  return {
    /* The cell under a point on the table, or -1 off the board. */
    cellAt(point) {
      const c = Math.round(point.x / CELL + mid), r = Math.round(point.z / CELL + mid);
      return c < 0 || c >= n || r < 0 || r >= n ? -1 : r * n + c;
    },
    hover(cell) { if (cell !== hovered) { hovered = cell; stage.wake(); } },
    /* The middle of a cell's top, on the table. */
    centre(cell) { return new THREE.Vector3(cellX(cell), TILE_H, cellZ(cell)); },
    /* `settled` shows the line as it stands, without growing it, as
       after a change of theme. */
    setPath(cells, settled = false) {
      hintCells.clear();
      if (settled) {
        target = cells.slice();
        shown.cells = cells.slice();
        shown.t = 1;
        dirty = true;
        stage.wake();
        return;
      }
      const grew = cells.length > target.length;
      const shrank = cells.length < target.length;
      target = cells.slice();
      const head = cells[cells.length - 1];
      if (grew) {
        tiles[head].userData.press = 1;
        const number = puzzle.numbers[head];
        // Every step sends a small ripple across the board; a number reached
        // sends a bright one and lights the backdrop.
        ripple(head, number ? '#ffffff' : accent, number ? 1 : 0.25);
        fx.sparks.burst({ origin: at(head), count: number ? 26 : 4, colours: ['#ffffff', accent, theme.wall], speed: [0.8, number ? 3 : 1.4], spread: 1.3, gravityPull: number ? 2 : -0.5, airDrag: 2, lifespan: [0.3, number ? 0.9 : 0.5], size: [0.06, 0.06], spinRate: 5 });
        if (number) stage.pulse(at(head), accent, 1);
      } else if (shrank) {
        ripple(head, '#ffffff', 0.2);
      }
      stage.wake();
    },
    /* The line was pushed against a wall, or at a number out of turn. */
    bump(from, to) {
      const wall = walls.get(wallKey(from, to));
      if (wall) wall.userData.flash = 1;
      else tiles[to].userData.shake = 1;
      headShake = 1;
      stage.wake();
    },
    /* Cells removed by the player flare once. */
    flare(cells) {
      for (const cell of cells) tiles[cell].userData.press = 1;
      stage.wake();
    },
    /* Show guidance without adding or removing any part of the line. */
    showHint(cells, { mistake = false } = {}) {
      hintCells = new Set(cells);
      hintMistake = mistake;
      hintUntil = stage.time + 5;
      stage.wake(5.2);
    },
    celebrate() {
      const time = stage.time;
      target.forEach((cell, i) => { tiles[cell].userData.hopAt = time + 0.1 + i * 0.03; tiles[cell].userData.hue = i / target.length; });
      linePulse = 0.7;
      ripple(target[target.length - 1], '#ffffff', 1.2);
      stage.pulse(new THREE.Vector3(0, 0.5, 0), '#ffffff', 1.4);
      stage.wake(4);
      const colours = [accent, theme.secondary, theme.wall, '#ffffff'];
      fx.confetti.burst({ origin: new THREE.Vector3(0, 1, 0), count: 220, colours, speed: [4, 9], spread: 0.9, gravityPull: 8, lifespan: [1.4, 2.6], size: [0.14, 0.09], scatter: n * 0.6 });
      target.filter((_, i) => i % 3 === 0).forEach((cell, i) => {
        setTimeout(() => fx.sparks.burst({ origin: new THREE.Vector3(cellX(cell), LINE_Y, cellZ(cell)), count: 10, colours: [accent, '#ffffff'], speed: [0.6, 1.8], spread: 1.2, gravityPull: 1.5, airDrag: 2, lifespan: [0.5, 0.9], size: [0.06, 0.06], spinRate: 4 }), 100 + i * 90);
      });
    },
    dispose() {
      stopFrames();
      stage.scene.remove(group);
      tube.geometry.dispose();
      for (const item of disposables) item.dispose();
    },
  };
}
