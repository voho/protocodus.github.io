/* Patcher — the board on the table: clue tiles, the patches that drop onto
   them, the ghost of the patch being drawn, and the hint outline. */
import * as THREE from 'three';
import { slabGeometry, clueTexture, labelMesh } from '../../shared/slab.js';

const CELL = 1;
const TILE = 0.9, TILE_H = 0.14, TILE_R = 0.16;
const PATCH_H = 0.3, PATCH_GAP = 0.12, PATCH_R = 0.18;
const DROP_FROM = 2.4;
const ease = (value, goal, dt, speed) => value + (goal - value) * (1 - Math.exp(-dt * speed));

export const PALETTE = ['#87d7be', '#f6d155', '#f29e8e', '#9fb8ff', '#d3a6f2', '#ffb86b', '#7fd8f2', '#c8e67a', '#f28fc3', '#b0a8f7', '#8fe3c2', '#f2c6a0'];

export function createBoard(stage, puzzle, { accent, fx }) {
  const n = puzzle.size, N = n * n;
  const group = new THREE.Group();
  stage.scene.add(group);
  const mid = (n - 1) / 2;
  const cellX = (cell) => ((cell % n) - mid) * CELL;
  const cellZ = (cell) => (Math.floor(cell / n) - mid) * CELL;
  const rectCentre = (rect) => [(rect.x + (rect.w - 1) / 2 - mid) * CELL, (rect.y + (rect.h - 1) / 2 - mid) * CELL];
  const accentColour = new THREE.Color(accent);
  const disposables = [];

  const plinthSize = n * CELL + 0.5;
  const plinth = new THREE.Mesh(slabGeometry(plinthSize, plinthSize, 0.3, 0.26, 0.05),
    new THREE.MeshStandardMaterial({ color: '#15101a', roughness: 0.32, metalness: 0.2 }));
  plinth.position.y = -0.3;
  plinth.castShadow = plinth.receiveShadow = true;
  group.add(plinth);
  disposables.push(plinth.material);

  const tileGeometry = slabGeometry(TILE, TILE, TILE_H, TILE_R, 0.035);
  const baseColour = new THREE.Color('#2a2331');
  const tiles = [];
  const clueOf = new Int16Array(N).fill(-1);
  puzzle.clues.forEach((clue, k) => { clueOf[clue.cell] = k; });
  for (let cell = 0; cell < N; cell++) {
    const material = new THREE.MeshStandardMaterial({
      color: baseColour, roughness: 0.48, metalness: 0.08, emissive: accentColour, emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(tileGeometry, material);
    mesh.position.set(cellX(cell), 0, cellZ(cell));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = { glow: 0, lift: 0, press: 0, label: null };
    if (clueOf[cell] >= 0) {
      const texture = clueTexture(puzzle.clues[clueOf[cell]], '#f6e7b8');
      const label = labelMesh(texture, 0.8, 1.2);
      label.position.y = TILE_H + 0.002;
      mesh.add(label);
      mesh.userData.label = label;
      disposables.push(texture, label.material);
    }
    group.add(mesh);
    tiles.push(mesh);
    disposables.push(material);
  }

  const patchGeometry = (w, h) => slabGeometry(w * CELL - PATCH_GAP, h * CELL - PATCH_GAP, PATCH_H, PATCH_R, 0.045);
  const patches = new Map();
  const lifting = [];

  const ghostMaterial = new THREE.MeshBasicMaterial({ color: accentColour, transparent: true, opacity: 0.42, depthWrite: false });
  const ghost = new THREE.Mesh(patchGeometry(1, 1), ghostMaterial);
  ghost.visible = false;
  ghost.renderOrder = 3;
  group.add(ghost);
  const hintMaterial = new THREE.MeshBasicMaterial({ color: accentColour, transparent: true, opacity: 0.3, depthWrite: false });
  const hintGhost = new THREE.Mesh(patchGeometry(1, 1), hintMaterial);
  hintGhost.visible = false;
  hintGhost.renderOrder = 3;
  group.add(hintGhost);
  disposables.push(ghostMaterial, hintMaterial);

  stage.frame(plinthSize / 2, plinthSize / 2);

  let hovered = -1;
  let ghostShake = 0;
  let hintUntil = -1;
  let hoveredPatch = null;

  function patchAt(cell) {
    const x = cell % n, y = Math.floor(cell / n);
    for (const entry of patches.values()) {
      const p = entry.patch;
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return entry;
    }
    return null;
  }

  function placeGhost(mesh, rect) {
    if (mesh.userData.w !== rect.w || mesh.userData.h !== rect.h) {
      mesh.geometry = patchGeometry(rect.w, rect.h);
      mesh.userData.w = rect.w; mesh.userData.h = rect.h;
    }
    const [x, z] = rectCentre(rect);
    mesh.position.set(x, TILE_H + 0.06, z);
  }

  function update(dt, time) {
    hoveredPatch = hovered >= 0 ? patchAt(hovered) : null;
    let busy = lifting.length > 0 || hintGhost.visible || ghost.visible || fx.confetti.alive || fx.dust.alive;
    for (let cell = 0; cell < N; cell++) {
      const tile = tiles[cell];
      const data = tile.userData;
      const free = !patchAt(cell);
      data.glow = ease(data.glow, hovered === cell && free ? 0.16 : 0, dt, 12);
      data.lift = ease(data.lift, hovered === cell && free ? 0.05 : 0, dt, 14);
      data.press = Math.max(0, data.press - dt * 5);
      tile.material.emissiveIntensity = data.glow;
      tile.position.y = data.lift - data.press * 0.06;
    }
    for (const entry of patches.values()) {
      const { mesh, patch } = entry;
      const [x, z] = rectCentre(patch);
      if (entry.state === 'drop') {
        busy = true;
        entry.t = Math.min(1, entry.t + dt / 0.22);
        mesh.position.y = TILE_H + (1 - entry.t * entry.t) * DROP_FROM;
        if (entry.t >= 1) {
          entry.state = 'rest';
          entry.landed = time;
          for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) tiles[(patch.y + j) * n + patch.x + i].userData.press = 1;
          fx.dust.burst({
            origin: new THREE.Vector3(x, TILE_H + 0.05, z), count: 14 + patch.w * patch.h * 2,
            colours: [entry.colour, '#ffffff'], speed: [0.8, 2.2], direction: new THREE.Vector3(0, 0.35, 0), spread: 1.5,
            gravityPull: 2.5, airDrag: 2.5, lifespan: [0.35, 0.7], size: [0.07, 0.05], spinRate: 6,
            scatter: Math.max(patch.w, patch.h) * 0.8,
          });
          entry.onLand?.();
        }
      } else {
        const u = time - entry.landed;
        const spring = u < 1.2 ? Math.exp(-7 * u) * Math.cos(16 * u) : 0;
        if (u < 1.2 || entry.hopAt >= 0) busy = true;
        let hop = 0;
        if (entry.hopAt >= 0) {
          const v = (time - entry.hopAt) / 0.5;
          if (v >= 1) entry.hopAt = -1;
          else if (v > 0) hop = Math.sin(v * Math.PI);
        }
        const bob = hoveredPatch === entry ? 0.05 : 0;
        entry.lift = ease(entry.lift, bob, dt, 14);
        mesh.scale.set(1 + 0.1 * spring, 1 - 0.26 * spring, 1 + 0.1 * spring);
        mesh.position.y = TILE_H + entry.lift + hop * 0.28;
        mesh.material.emissiveIntensity = hop * 0.5 + (hoveredPatch === entry ? 0.08 : 0);
      }
    }
    for (let i = lifting.length - 1; i >= 0; i--) {
      const entry = lifting[i];
      entry.t = Math.min(1, entry.t + dt / 0.2);
      const t = entry.t;
      entry.mesh.position.y = TILE_H + t * 0.9;
      const s = 1 - 0.5 * t * t;
      entry.mesh.scale.set(s, s, s);
      entry.mesh.material.opacity = 1 - t;
      if (t >= 1) {
        group.remove(entry.mesh);
        entry.mesh.material.dispose();
        entry.label?.material.dispose();
        lifting.splice(i, 1);
      }
    }
    ghostShake = Math.max(0, ghostShake - dt * 4);
    if (ghost.visible) {
      ghost.position.x += Math.sin(time * 60) * 0.05 * ghostShake - (ghost.userData.shakeX || 0);
      ghost.userData.shakeX = Math.sin(time * 60) * 0.05 * ghostShake;
      ghostMaterial.opacity = 0.38 + Math.sin(time * 6) * 0.06;
    }
    if (hintGhost.visible) {
      hintMaterial.opacity = 0.22 + Math.sin(time * 7) * 0.14;
      if (time > hintUntil) hintGhost.visible = false;
    }
    fx.confetti.update(dt);
    fx.dust.update(dt);
    if (busy) stage.wake(0.3);
  }
  const stopFrames = stage.onFrame(update);

  return {
    cellAt(point, clamp = false) {
      let c = Math.round(point.x / CELL + mid), r = Math.round(point.z / CELL + mid);
      if (clamp) { c = Math.max(0, Math.min(n - 1, c)); r = Math.max(0, Math.min(n - 1, r)); }
      return c < 0 || c >= n || r < 0 || r >= n ? -1 : r * n + c;
    },
    hover(cell) { if (cell !== hovered) { hovered = cell; stage.wake(); } },
    /* The middle of a cell's top, on the table. */
    centre(cell) { return new THREE.Vector3(cellX(cell), TILE_H, cellZ(cell)); },
    /* The patch being drawn, or null for none. */
    preview(rect, ok) {
      if (!rect) { ghost.visible = false; return; }
      placeGhost(ghost, rect);
      ghost.position.x -= ghost.userData.shakeX || 0;
      ghost.userData.shakeX = 0;
      ghostMaterial.color.set(ok ? accent : '#ff6b6b');
      ghost.visible = true;
      stage.wake();
    },
    reject() { ghostShake = 1; stage.wake(); },
    /* A patch drops onto the board in its colour, with the clue on top. */
    place(patch, colour, onLand) {
      hintGhost.visible = false;
      const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness: 0, emissive: colour, emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(patchGeometry(patch.w, patch.h), material);
      const [x, z] = rectCentre(patch);
      mesh.position.set(x, TILE_H + DROP_FROM, z);
      mesh.castShadow = mesh.receiveShadow = true;
      const clue = puzzle.clues[patch.clue];
      const texture = clueTexture(clue, '#1a1420');
      const label = labelMesh(texture, 0.8, 1);
      label.position.set(cellX(clue.cell) - x, PATCH_H + 0.002, cellZ(clue.cell) - z);
      mesh.add(label);
      disposables.push(texture);
      group.add(mesh);
      const tileLabel = tiles[clue.cell].userData.label;
      if (tileLabel) tileLabel.visible = false;
      patches.set(patch.clue, { patch, mesh, label, colour, state: 'drop', t: 0, landed: 0, lift: 0, hopAt: -1, onLand });
      stage.wake(2);
    },
    lift(clueIndex) {
      const entry = patches.get(clueIndex);
      if (!entry) return;
      hintGhost.visible = false;
      patches.delete(clueIndex);
      entry.mesh.material.transparent = true;
      entry.mesh.castShadow = false;
      lifting.push({ mesh: entry.mesh, label: entry.label, t: 0 });
      const tileLabel = tiles[puzzle.clues[clueIndex].cell].userData.label;
      if (tileLabel) tileLabel.visible = true;
      const [x, z] = rectCentre(entry.patch);
      fx.dust.burst({
        origin: new THREE.Vector3(x, TILE_H + 0.2, z), count: 8, colours: [entry.colour],
        speed: [0.4, 1.2], spread: 1.4, gravityPull: -0.5, airDrag: 2, lifespan: [0.3, 0.6], size: [0.05, 0.05], scatter: 0.6,
      });
    },
    /* Outline the patch a hint points at, for a few seconds. */
    show(rect, { mistake = false } = {}) {
      placeGhost(hintGhost, rect);
      hintGhost.position.y = TILE_H + (mistake ? PATCH_H + 0.025 : 0.06);
      hintMaterial.color.set(mistake ? '#ff7777' : accent);
      hintGhost.visible = true;
      hintUntil = stage.time + 5;
      stage.wake(5.2);
    },
    celebrate() {
      const time = stage.time;
      const order = [...patches.values()].sort((a, b) => (a.patch.x + a.patch.y) - (b.patch.x + b.patch.y));
      order.forEach((entry, i) => { entry.hopAt = time + 0.1 + i * 0.05; });
      stage.wake(4);
      const colours = [...PALETTE, '#ffffff'];
      fx.confetti.burst({ origin: new THREE.Vector3(0, 1.2, 0), count: 240, colours, speed: [4, 9], spread: 0.9, gravityPull: 8, lifespan: [1.4, 2.6], size: [0.14, 0.09], scatter: n * 0.6 });
    },
    dispose() {
      stopFrames();
      stage.scene.remove(group);
      for (const entry of patches.values()) { entry.mesh.material.dispose(); entry.label.material.dispose(); }
      for (const entry of lifting) { entry.mesh.material.dispose(); entry.label?.material.dispose(); }
      for (const item of disposables) item.dispose();
    },
  };
}
