/* Patcher — the board on the table: clue tiles, the patches that drop onto
   them, the ghost of the patch being drawn, and the hint outline. */
import * as THREE from 'three';
import { slabGeometry, clueTexture, labelMesh } from '../../shared/slab.js';

const CELL = 1;
const TILE = 0.9, TILE_H = 0.14, TILE_R = 0.16;
const PATCH_H = 0.3, PATCH_GAP = 0.12, PATCH_R = 0.18;
const DROP_FROM = 0.8;
const ease = (value, goal, dt, speed) => value + (goal - value) * (1 - Math.exp(-dt * speed));

export function createBoard(stage, puzzle, { accent, fx, theme = {} }) {
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
    stage.material({ color: theme.plinth || '#160d1c', roughness: 0.2, metalness: 0.3, clearcoatRoughness: 0.08 }));
  plinth.position.y = -0.3;
  plinth.castShadow = plinth.receiveShadow = true;
  group.add(plinth);
  disposables.push(plinth.material);

  const edge = new THREE.Mesh(slabGeometry(plinthSize + 0.05, plinthSize + 0.05, 0.055, 0.28, 0.016),
    stage.material({ color: accent, emissive: accent, emissiveIntensity: 0.22, roughness: 0.3, metalness: 0.25 }));
  edge.position.y = -0.34;
  group.add(edge);
  disposables.push(edge.material);

  const tileGeometry = slabGeometry(TILE, TILE, TILE_H, TILE_R, 0.035);
  const tiles = [];
  const clueOf = new Int16Array(N).fill(-1);
  puzzle.clues.forEach((clue, k) => { clueOf[clue.cell] = k; });
  for (let cell = 0; cell < N; cell++) {
    // Dark glossy tiles, violet at one corner shading to wine at the other.
    const blend = ((cell % n) + Math.floor(cell / n)) / Math.max(1, 2 * (n - 1));
    const base = new THREE.Color(theme.tileA || '#221a3b').lerp(new THREE.Color(theme.tileB || '#3d192b'), blend);
    const material = stage.material({ color: base, roughness: 0.3, metalness: 0.1, emissive: accentColour, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(tileGeometry, material);
    mesh.position.set(cellX(cell), 0, cellZ(cell));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = { glow: 0, lift: 0, press: 0, label: null };
    if (clueOf[cell] >= 0) {
      const texture = clueTexture(puzzle.clues[clueOf[cell]], theme.clue || '#f6e7b8');
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
  const coveredBy = new Int16Array(N).fill(-1);

  const ghostMaterial = new THREE.MeshBasicMaterial({ color: accentColour, transparent: true, opacity: 0.42, depthWrite: false });
  const ghost = new THREE.Mesh(slabGeometry(1 - PATCH_GAP, 1 - PATCH_GAP, 0.035, PATCH_R, 0.01), ghostMaterial);
  ghost.visible = false;
  ghost.renderOrder = 3;
  group.add(ghost);
  const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5),
  ]);
  const outlineMaterial = new THREE.LineBasicMaterial({ color: accentColour, transparent: true, opacity: 0.95, depthTest: false });
  const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
  outline.visible = false;
  outline.renderOrder = 4;
  group.add(outline);
  disposables.push(outlineGeometry, outlineMaterial);
  const hintMaterial = new THREE.MeshBasicMaterial({ color: accentColour, transparent: true, opacity: 0.3, depthWrite: false });
  const hintGhost = new THREE.Mesh(patchGeometry(1, 1), hintMaterial);
  hintGhost.visible = false;
  hintGhost.renderOrder = 3;
  group.add(hintGhost);
  disposables.push(ghostMaterial, hintMaterial);

  stage.frame(plinthSize / 2, plinthSize / 2);

  let hovered = -1;
  let ghostShake = 0;
  let rejectUntil = -1;
  let hintUntil = -1;
  let hoveredPatch = null;
  // A ripple: every tile rises and flashes in turn by its distance from a move.
  const rippleAt = new Float32Array(N).fill(-1);
  const rippleColour = new THREE.Color(accent);
  let rippleStrength = 1;
  function ripple(fromX, fromZ, colour, strength = 1) {
    rippleColour.set(colour);
    rippleStrength = strength;
    for (let cell = 0; cell < N; cell++) {
      rippleAt[cell] = stage.time + (Math.abs(cellX(cell) - fromX) + Math.abs(cellZ(cell) - fromZ)) * 0.04;
    }
    stage.wake(1.5);
  }

  function patchAt(cell) {
    return coveredBy[cell] >= 0 ? patches.get(coveredBy[cell]) : null;
  }

  function placeGhost(mesh, rect) {
    if (mesh.userData.w !== rect.w || mesh.userData.h !== rect.h) {
      mesh.geometry = mesh === ghost
        ? slabGeometry(rect.w * CELL - PATCH_GAP, rect.h * CELL - PATCH_GAP, 0.035, PATCH_R, 0.01)
        : patchGeometry(rect.w, rect.h);
      mesh.userData.w = rect.w; mesh.userData.h = rect.h;
    }
    const [x, z] = rectCentre(rect);
    mesh.position.set(x, TILE_H + 0.06, z);
  }

  function update(dt, time) {
    hoveredPatch = hovered >= 0 ? patchAt(hovered) : null;
    let busy = lifting.length > 0 || hintGhost.visible || ghost.visible || fx.confetti.alive || fx.dust.alive;
    group.position.y = stage.reduced ? 0 : Math.sin(time * 0.6) * 0.03;
    for (let cell = 0; cell < N; cell++) {
      const tile = tiles[cell];
      const data = tile.userData;
      const free = !patchAt(cell);
      data.glow = ease(data.glow, hovered === cell && free ? 0.16 : 0, dt, 12);
      data.lift = ease(data.lift, hovered === cell && free ? 0.05 : 0, dt, 14);
      data.press = Math.max(0, data.press - dt * 5);
      let wave = 0;
      if (rippleAt[cell] >= 0) {
        const u = (time - rippleAt[cell]) / 0.45;
        if (u >= 1) rippleAt[cell] = -1;
        else if (u > 0) wave = Math.sin(u * Math.PI) * rippleStrength;
      }
      tile.material.emissive.copy(wave > 0 ? rippleColour : accentColour);
      tile.material.emissiveIntensity = data.glow + wave * 0.5;
      tile.position.y = stage.reduced ? 0 : data.lift - data.press * 0.06 + wave * 0.06;
      if (wave > 0) busy = true;
    }
    for (const entry of patches.values()) {
      const { mesh, patch } = entry;
      const [x, z] = rectCentre(patch);
      if (entry.state === 'drop') {
        busy = true;
        entry.t = stage.reduced ? 1 : Math.min(1, entry.t + dt / 0.14);
        mesh.position.y = TILE_H + (1 - entry.t * entry.t) * DROP_FROM;
        if (entry.t >= 1) {
          entry.state = 'rest';
          entry.landed = time;
          for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) tiles[(patch.y + j) * n + patch.x + i].userData.press = 1;
          // The landing runs a ripple out across the board in the patch's
          // colour and glows in the backdrop. Gentle, since a move lands
          // many times a game: the colour should tint the board, not wash
          // over it.
          ripple(x, z, entry.colour, 0.3);
          stage.pulse(new THREE.Vector3(x, TILE_H, z), entry.colour, 0.6);
          fx.dust.burst({
            origin: new THREE.Vector3(x, TILE_H + 0.05, z), count: stage.reduced ? 0 : Math.min(32, 10 + patch.w * patch.h * 2),
            colours: [entry.colour, '#ffffff'], speed: [0.8, 2.2], direction: new THREE.Vector3(0, 0.35, 0), spread: 1.5,
            gravityPull: 2.5, airDrag: 2.5, lifespan: [0.35, 0.7], size: [0.07, 0.05], spinRate: 6,
            scatter: Math.max(patch.w, patch.h) * 0.8,
          });
          entry.onLand?.();
        }
      } else {
        const u = time - entry.landed;
        const spring = !stage.reduced && u < 1.2 ? Math.exp(-7 * u) * Math.cos(16 * u) : 0;
        if (u < 1.2 || entry.hopAt >= 0) busy = true;
        let hop = 0;
        if (entry.hopAt >= 0) {
          const v = (time - entry.hopAt) / 0.5;
          if (v >= 1) entry.hopAt = -1;
          else if (v > 0 && !stage.reduced) hop = Math.sin(v * Math.PI);
        }
        const bob = !stage.reduced && hoveredPatch === entry ? 0.05 : 0;
        entry.lift = ease(entry.lift, bob, dt, 14);
        mesh.scale.set(1 + 0.1 * spring, 1 - 0.26 * spring, 1 + 0.1 * spring);
        mesh.position.y = TILE_H + entry.lift + hop * 0.28;
        // A solved board runs a rainbow across the patches as they hop.
        if (hop > 0 && entry.hue >= 0) mesh.material.emissive.setHSL((entry.hue + time * 0.15) % 1, 1, 0.6, THREE.SRGBColorSpace);
        else mesh.material.emissive.set(entry.colour);
        mesh.material.emissiveIntensity = 0.06 + hop * 0.7 + (hoveredPatch === entry ? 0.12 : 0);
      }
    }
    for (let i = lifting.length - 1; i >= 0; i--) {
      const entry = lifting[i];
      entry.t = stage.reduced ? 1 : Math.min(1, entry.t + dt / 0.14);
      const t = entry.t;
      entry.mesh.position.y = TILE_H + (stage.reduced ? 0 : t * 0.5);
      const s = 1 - 0.5 * t * t;
      entry.mesh.scale.set(s, s, s);
      entry.mesh.material.opacity = 1 - t;
      if (t >= 1) {
        group.remove(entry.mesh);
        entry.mesh.material.dispose();
        entry.label?.material.dispose();
        entry.texture?.dispose();
        lifting.splice(i, 1);
      }
    }
    ghostShake = Math.max(0, ghostShake - dt * 4);
    if (rejectUntil >= 0 && time >= rejectUntil) {
      rejectUntil = -1;
      ghost.visible = outline.visible = false;
    }
    if (ghost.visible) {
      ghost.position.x += (stage.reduced ? 0 : Math.sin(time * 60) * 0.05 * ghostShake) - (ghost.userData.shakeX || 0);
      ghost.userData.shakeX = stage.reduced ? 0 : Math.sin(time * 60) * 0.05 * ghostShake;
      ghostMaterial.opacity = 0.16 + (stage.reduced ? 0 : Math.sin(time * 6) * 0.025);
    }
    if (hintGhost.visible) {
      hintMaterial.opacity = 0.26 + (stage.reduced ? 0 : Math.sin(time * 7) * 0.1);
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
      rejectUntil = -1;
      if (!rect) { ghost.visible = false; outline.visible = false; return; }
      placeGhost(ghost, rect);
      ghost.position.x -= ghost.userData.shakeX || 0;
      ghost.userData.shakeX = 0;
      ghost.position.y = TILE_H + 0.015;
      ghostMaterial.color.set(ok ? accent : '#ff6b6b');
      outlineMaterial.color.copy(ghostMaterial.color).multiplyScalar(1.5);
      outline.position.set(ghost.position.x, TILE_H + 0.06, ghost.position.z);
      outline.scale.set(rect.w * CELL - PATCH_GAP, 1, rect.h * CELL - PATCH_GAP);
      outline.visible = true;
      ghost.visible = true;
      stage.wake();
    },
    reject(rect) {
      if (rect) this.preview(rect, false);
      ghostShake = stage.reduced ? 0 : 1;
      rejectUntil = stage.time + 0.35;
      stage.wake(0.5);
    },
    /* A patch drops onto the board in its colour, with the clue on top;
       `settled` puts it straight down, as after a change of theme. */
    place(patch, colour, onLand, settled = false) {
      hintGhost.visible = false;
      const material = stage.material({ color: colour, roughness: 0.2, metalness: 0, emissive: colour, emissiveIntensity: 0.06, clearcoatRoughness: 0.06 });
      const mesh = new THREE.Mesh(patchGeometry(patch.w, patch.h), material);
      const [x, z] = rectCentre(patch);
      mesh.position.set(x, TILE_H + (settled ? 0 : DROP_FROM), z);
      mesh.castShadow = mesh.receiveShadow = true;
      const clue = puzzle.clues[patch.clue];
      const texture = clueTexture(clue, '#1a1420');
      const label = labelMesh(texture, 0.8, 1);
      label.position.set(cellX(clue.cell) - x, PATCH_H + 0.002, cellZ(clue.cell) - z);
      mesh.add(label);
      group.add(mesh);
      const tileLabel = tiles[clue.cell].userData.label;
      if (tileLabel) tileLabel.visible = false;
      for (let j = 0; j < patch.h; j++) for (let i = 0; i < patch.w; i++) coveredBy[(patch.y + j) * n + patch.x + i] = patch.clue;
      patches.set(patch.clue, { patch, mesh, label, texture, colour, state: settled ? 'rest' : 'drop', t: 0, landed: settled ? -10 : 0, lift: 0, hopAt: -1, hue: -1, onLand });
      stage.wake(2);
    },
    lift(clueIndex) {
      const entry = patches.get(clueIndex);
      if (!entry) return;
      hintGhost.visible = false;
      patches.delete(clueIndex);
      for (let cell = 0; cell < N; cell++) if (coveredBy[cell] === clueIndex) coveredBy[cell] = -1;
      entry.mesh.material.transparent = true;
      entry.mesh.castShadow = false;
      lifting.push({ mesh: entry.mesh, label: entry.label, texture: entry.texture, t: 0 });
      const tileLabel = tiles[puzzle.clues[clueIndex].cell].userData.label;
      if (tileLabel) tileLabel.visible = true;
      const [x, z] = rectCentre(entry.patch);
      ripple(x, z, '#ffffff', 0.3);
      fx.dust.burst({
        origin: new THREE.Vector3(x, TILE_H + 0.2, z), count: stage.reduced ? 0 : 8, colours: [entry.colour],
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
    clearHint() { hintGhost.visible = false; },
    celebrate() {
      const time = stage.time;
      const order = [...patches.values()].sort((a, b) => (a.patch.x + a.patch.y) - (b.patch.x + b.patch.y));
      order.forEach((entry, i) => { entry.hopAt = time + 0.1 + i * 0.05; entry.hue = i / order.length; });
      ripple(0, 0, '#ffffff', 1.2);
      stage.pulse(new THREE.Vector3(0, 0.5, 0), '#ffffff', 1.4);
      stage.wake(4);
      const colours = [...(theme.palette || []), '#ffffff'];
      fx.confetti.burst({ origin: new THREE.Vector3(0, 1.2, 0), count: stage.reduced ? 0 : 180, colours, speed: [4, 9], spread: 0.9, gravityPull: 8, lifespan: [1.4, 2.6], size: [0.14, 0.09], scatter: n * 0.6 });
    },
    dispose() {
      stopFrames();
      stage.scene.remove(group);
      for (const entry of patches.values()) { entry.mesh.material.dispose(); entry.label.material.dispose(); entry.texture.dispose(); }
      for (const entry of lifting) { entry.mesh.material.dispose(); entry.label?.material.dispose(); entry.texture?.dispose(); }
      for (const item of disposables) item.dispose();
    },
  };
}
