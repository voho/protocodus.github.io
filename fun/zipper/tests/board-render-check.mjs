// Run with: node fun/zipper/tests/board-render-check.mjs
// Exercise the real board against Three's scene graph without a GPU. The line
// must reuse its geometry throughout drawing and dispose delayed solve effects.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { generate } from '../js/puzzle.js';

const listeners = new Set();
const timers = new Set();
const scene = new THREE.Scene();
const stage = {
  scene, time: 0, reduced: false,
  material: (options) => new THREE.MeshPhysicalMaterial(options),
  frame() {}, wake() {}, pulse() {}, kick() {},
  onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
const fx = Object.fromEntries(['confetti', 'sparks'].map((name) => [name, { alive: false, update() {}, burst() {} }]));
const context = vm.createContext({
  THREE, console,
  slabGeometry: (w, d, h) => new THREE.BoxGeometry(w, h, d),
  digitTexture: () => new THREE.Texture(),
  labelMesh: () => new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial()),
  setTimeout() { const timer = {}; timers.add(timer); return timer; },
  clearTimeout(timer) { timers.delete(timer); },
});
const source = (await readFile(new URL('../js/board.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function createBoard', 'globalThis.createBoard = function');
vm.runInContext(source, context);
const puzzle = generate('hard', 'render-check');
const board = context.createBoard(stage, puzzle, { accent: '#87d7be', fx });
const group = scene.children[0];
const [segments, joints] = group.children.filter((mesh) => mesh.isInstancedMesh);
const segmentGeometry = segments.geometry;
const jointGeometry = joints.geometry;
const segmentBuffer = segments.instanceMatrix.array;
const jointBuffer = joints.instanceMatrix.array;
const advance = (seconds) => {
  for (let i = 0; i < seconds * 60; i++) {
    stage.time += 1 / 60;
    for (const listener of listeners) listener(1 / 60, stage.time);
  }
};
board.setPath(puzzle.solution);
advance(3);
assert.equal(segments.count, puzzle.solution.length - 1, 'all solution edges reach the displayed line');
assert.equal(joints.count, puzzle.solution.length, 'every turn gets a rounded join');
assert.ok([...segments.instanceMatrix.array].every(Number.isFinite), 'all segment transforms stay finite');
board.setPath(puzzle.solution.slice(0, 2));
advance(3);
assert.equal(segments.count, 1, 'retracing removes the displayed edges');
assert.equal(joints.count, 2);
assert.equal(segments.geometry, segmentGeometry, 'drawing reuses segment geometry');
assert.equal(joints.geometry, jointGeometry, 'drawing reuses join geometry');
assert.equal(segments.instanceMatrix.array, segmentBuffer, 'drawing reuses the segment buffer');
assert.equal(joints.instanceMatrix.array, jointBuffer, 'drawing reuses the join buffer');
board.celebrate();
assert.ok(timers.size > 0, 'solve sparks are scheduled');
board.dispose();
assert.equal(timers.size, 0, 'changing boards cancels delayed solve effects');
assert.equal(listeners.size, 0, 'the disposed board stops updating');
assert.equal(scene.children.length, 0, 'the disposed board leaves the scene');
console.log('Zipper render checks passed: fixed geometry and buffers, complete drawing/retracing, effect cleanup.');
