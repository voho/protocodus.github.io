// Run with: node fun/patcher/tests/clue-layout-check.mjs
// Check the actual drawing coordinates against different Canvas text metrics.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { THEMES } from '../../shared/themes.js';

const size = 256;
let profile = 'normal';
const metricsFor = (text, font) => {
  const px = Number(/ (\d+)px/.exec(font)[1]);
  const wide = profile === 'wide' ? 0.95 : 0.56;
  const width = px * text.length * wide;
  // The visible ink may start after the left text anchor; the digit box
  // deliberately has unequal side-bearings to catch nominal-box centering.
  const left = -px * 0.04;
  return {
    width,
    actualBoundingBoxLeft: left,
    actualBoundingBoxRight: width + left,
    actualBoundingBoxAscent: px * (profile === 'tall' ? 0.86 : 0.69),
    actualBoundingBoxDescent: px * (profile === 'tall' ? 0.07 : 0.01),
  };
};
const context = vm.createContext({
  THREE, LABEL_FONT: '"Space Grotesk", system-ui, sans-serif',
  canvasTexture(draw) {
    const calls = {};
    const ctx = {
      beginPath() {}, fill() {},
      roundRect(x, y, width, height) { calls.icon = { x, y, width, height, ink: this.fillStyle }; },
      measureText(text) {
        const measured = metricsFor(text, this.font);
        return profile === 'legacy' ? { width: measured.width } : measured;
      },
      fillText(text, x, y) {
        const metrics = profile === 'legacy'
          ? { actualBoundingBoxLeft: 0, actualBoundingBoxRight: metricsFor(text, this.font).width,
            actualBoundingBoxAscent: Number(/ (\d+)px/.exec(this.font)[1]) * 0.72,
            actualBoundingBoxDescent: Number(/ (\d+)px/.exec(this.font)[1]) * 0.02 }
          : metricsFor(text, this.font);
        calls.text = { text, x: x - metrics.actualBoundingBoxLeft,
          y: y - metrics.actualBoundingBoxAscent,
          width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
          height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
          font: Number(/ (\d+)px/.exec(this.font)[1]) };
      },
    };
    draw(ctx, size);
    return calls;
  },
});
const source = await readFile(new URL('../../shared/slab.js', import.meta.url), 'utf8');
const start = source.indexOf('export function clueTexture(');
const end = source.indexOf('\nconst planes =', start);
vm.runInContext(source.slice(start, end).replace('export function clueTexture', 'globalThis.clueTexture = function'), context);
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, message);
let checked = 0;
for (profile of ['normal', 'wide', 'tall', 'legacy']) {
  for (const shape of ['square', 'wide', 'tall']) {
    for (const number of [null, undefined, 1, 3, 6, 9, 10, 88, 99]) {
      for (const colour of ['#f6e7b8', '#1a1420']) {
        const { icon, text } = context.clueTexture({ shape, number }, colour);
        const margin = size * 0.10 - 1e-6;
        assert.ok(icon.x >= margin && icon.y >= margin, `${shape}: icon respects top/left safe padding`);
        assert.ok(icon.x + icon.width <= size - margin && icon.y + icon.height <= size - margin,
          `${shape}: icon respects bottom/right safe padding`);
        if (number == null) {
          assert.equal(text, undefined, 'shape-only clues do not draw a number');
          close(icon.x + icon.width / 2, size / 2, 'shape-only clues are horizontally centered');
          close(icon.y + icon.height / 2, size / 2, 'shape-only clues are vertically centered');
          assert.ok(Math.max(icon.width, icon.height) >= size * 0.44, 'shape-only clues use their available space');
        } else {
          assert.ok(text.x >= margin && text.x + text.width <= size - margin, `${profile}: digits fit the safe width`);
          if (shape === 'tall') {
            assert.ok(text.x - icon.x - icon.width >= size * 0.12 - 1e-6,
              `${shape}/${number}: the number sits beside the icon with a clear gutter`);
            assert.ok(text.y >= size * 0.18 - 1e-6 && text.y + text.height <= size * 0.82 + 1e-6,
              `${profile}: side-by-side digits fit the central height`);
            close((icon.x + text.x + text.width) / 2, size / 2, 'the icon and measured digit ink form a centered group');
            close(icon.y + icon.height / 2, size / 2, 'the tall icon is vertically centered');
            close(text.y + text.height / 2, size / 2, 'side-by-side digit ink is vertically centered');
          } else {
            assert.ok(text.y >= size * 0.56 - 1e-6 && text.y + text.height <= size * 0.90 + 1e-6,
              `${profile}: stacked digits fit the dedicated number band`);
            assert.ok(text.y - icon.y - icon.height >= margin, `${shape}/${number}: icon and number keep a visible vertical gap`);
            close(icon.x + icon.width / 2, size / 2, 'stacked icons are horizontally centered');
            close(text.x + text.width / 2, size / 2, 'stacked digit ink is horizontally centered');
            close(text.y + text.height / 2, size * 0.73, 'stacked digit ink is vertically centered in its own band');
          }
          if (profile === 'normal') assert.ok(text.font >= size * 0.44, 'normal digits retain their mobile-readable font size');
        }
        if (shape === 'square') close(icon.width, icon.height, 'square clue silhouette stays square');
        if (shape === 'wide') assert.ok(icon.width / icon.height > 2, 'wide clue stays distinct');
        if (shape === 'tall') assert.ok(icon.height / icon.width > 1.8, 'tall clue stays distinct');
        checked++;
      }
    }
  }
}
// Test the ink that the real draw function supplies, including shape-only
// clues: a pastel shape tint must never wash out dark ink on placed patches.
const luminance = (style) => {
  const colour = new THREE.Color(style);
  return colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722;
};
const contrast = (a, b) => {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
};
let contrastChecks = 0, leastContrast = Infinity;
for (const [name, theme] of Object.entries(THEMES)) {
  for (const shape of ['square', 'wide', 'tall']) {
    for (const number of [null, 10]) {
      const placed = context.clueTexture({ shape, number }, '#1a1420').icon.ink;
      assert.equal(placed, '#1a1420', 'placed icon preserves the exact supplied dark ink');
      for (const patch of theme.palette) {
        const ratio = contrast(placed, patch);
        assert.ok(ratio >= 4.5, `${name}/${shape}: actual icon ink remains readable on patch ${patch}`);
        leastContrast = Math.min(leastContrast, ratio);
        contrastChecks++;
      }
      const empty = context.clueTexture({ shape, number }, theme.clue).icon.ink;
      for (const slot of [theme.tileA, theme.tileB]) {
        assert.ok(contrast(empty, slot) >= 4.5, `${name}/${shape}: gently tinted icons remain readable in empty slots`);
        contrastChecks++;
      }
    }
  }
}
console.log(`Patcher clue layout checks passed: ${checked} layout cases and ${contrastChecks} icon contrast checks (minimum placed contrast ${leastContrast.toFixed(2)}:1).`);
