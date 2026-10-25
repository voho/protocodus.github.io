// Run with: node fun/patcher/tests/board-render-check.mjs
// Exercise real transforms and GPU buffers without requiring a WebGL device.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { generate } from '../js/puzzle.js';

const listeners = new Set();
const scene = new THREE.Scene();
let shadows = 0, wakes = 0, materials = 0;
const stage = {
  scene, time: 0, reduced: false,
  material(options) { materials++; return new THREE.MeshPhysicalMaterial(options); },
  frame() {}, wake() { wakes++; }, pulse() {},
  invalidateShadows() { shadows++; },
  onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
const fx = Object.fromEntries(['confetti', 'dust'].map((name) => [name, { alive: false, update() {}, burst() {} }]));
const cachedSlabs = new Map();
const context = vm.createContext({
  THREE, console,
  slabGeometry(w, d, h) {
    const key = `${w}:${d}:${h}`;
    if (!cachedSlabs.has(key)) cachedSlabs.set(key, new THREE.BoxGeometry(w, h, d));
    return cachedSlabs.get(key);
  },
  clueTexture: () => new THREE.Texture(),
  labelMesh: () => new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial()),
});
for (const [path, entry] of [['../../shared/tiles.js', 'createTileBatch'], ['../js/board.js', 'createBoard']]) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(`export function ${entry}`, `globalThis.${entry} = function`);
  vm.runInContext(source, context);
}
const puzzle = generate('hard', 'render-check');
const board = context.createBoard(stage, puzzle, { accent: '#87d7be', fx });
const group = scene.children[0];
const tiles = group.getObjectByName('tiles');
assert.equal(tiles.count, puzzle.size ** 2, 'every tile is batched into one draw call');
assert.equal(materials, 3, 'plinth, edge and the entire tile grid need only three physical materials');
assert.ok([...cachedSlabs.values()].every((geometry) => !geometry.attributes.tileEmission), 'instance attributes never modify the shared slab cache');
let disposedGeometry = 0, disposedMaterial = 0;
tiles.geometry.addEventListener('dispose', () => { disposedGeometry++; });
tiles.material.addEventListener('dispose', () => { disposedMaterial++; });

const advance = (seconds) => {
  for (let i = 0; i < seconds * 60; i++) {
    stage.time += 1 / 60;
    for (const listener of listeners) listener(1 / 60, stage.time);
  }
};
const versions = () => [tiles.instanceMatrix.version, tiles.instanceColor.version, tiles.geometry.attributes.tileEmission.version];
advance(1);
const idle = versions(), idleShadows = shadows;
advance(1);
assert.deepEqual(versions(), idle, 'idle tiles upload no unchanged buffers');
assert.equal(shadows, idleShadows, 'a resting board keeps its shadow map');
assert.equal(group.position.y, 0, 'the board holds still in the tilted view');

const clueCell = puzzle.clues[0].cell;
const labelHolder = group.children.find((child) => child.userData.label && child.position.x === board.centre(clueCell).x && child.position.z === board.centre(clueCell).z);
board.hover(clueCell);
advance(1);
assert.ok(labelHolder.position.y > 0, 'a clue label follows its raised tile');
const transform = new THREE.Matrix4();
tiles.getMatrixAt(clueCell, transform);
assert.ok(Math.abs(transform.elements[13] - labelHolder.position.y) < 1e-7, 'the instance and its clue share the same height');
board.hover(-1);
advance(1);
assert.equal(labelHolder.position.y, 0, 'hover settles exactly without endless tiny transforms');
const settled = versions(), settledShadows = shadows;
advance(1);
assert.deepEqual(versions(), settled);
assert.equal(shadows, settledShadows);

const patch = puzzle.solution[0];
let landed = 0;
board.place(patch, '#d3ad76', () => { landed++; });
advance(3);
assert.equal(landed, 1, 'the patch lands exactly once');
assert.equal(labelHolder.userData.label.visible, false, 'the patch replaces the original clue label');
const resting = versions(), restingShadows = shadows;
advance(1);
assert.deepEqual(versions(), resting, 'landed patch ripples finish uploading');
assert.equal(shadows, restingShadows, 'landed patches stop invalidating their shadows');
board.lift(patch.clue);
advance(2);
assert.equal(labelHolder.userData.label.visible, true, 'lifting restores the tile clue');

board.preview(patch, true);
const previewWakes = wakes;
board.preview({ ...patch }, true);
assert.equal(wakes, previewWakes, 'repeated pointer samples in one rectangle do not wake the renderer again');
board.preview(null);
stage.reduced = true;
const beforeReducedPreview = wakes;
board.preview(patch, true);
assert.equal(wakes, beforeReducedPreview + 1, 'a reduced-motion preview wakes the renderer immediately');
advance(2);
assert.equal(wakes, beforeReducedPreview + 1, 'a static reduced-motion preview does not keep waking the renderer');
board.preview(null);
board.dispose();
assert.equal(disposedGeometry, 1, 'the tile instance geometry is released');
assert.equal(disposedMaterial, 1, 'the tile shader material is released');
assert.equal(listeners.size, 0, 'a disposed board stops updating');
assert.equal(scene.children.length, 0, 'a disposed board leaves the scene');
console.log('Patcher render checks passed: instanced tiles, settled buffers/shadows, clue relief, patch landing/lifting, preview deduplication and disposal.');
