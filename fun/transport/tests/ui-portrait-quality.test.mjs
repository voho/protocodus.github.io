import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOT_BUILDING_ATLASES } from '../plot-building-catalog.js';

const requests = [], resizeListeners = new Set(), frames = new Map();
let nextFrame = 0;
let sourceOpaque = null;
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, listener) { if (type === 'resize') resizeListeners.add(listener); },
  removeEventListener(type, listener) { if (type === 'resize') resizeListeners.delete(listener); },
};
globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const flushFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
globalThis.Image = class {
  set src(url) {
    this.url = url;
    const cell = Number(url.match(/-(\d+)\.png$/)?.[1] || 256), atlas = PLOT_BUILDING_ATLASES.find(atlas => url.includes(`/${atlas.id}/`));
    this.naturalWidth = (atlas?.columns || 3) * cell; this.naturalHeight = (atlas?.rows || 3) * cell;
    requests.push(this);
  }
  get src() { return this.url; }
  decode() { return Promise.resolve(); }
};

class Context {
  constructor(canvas) { this.canvas = canvas; this.images = []; this.reads = 0; }
  drawImage(image, ...args) { this.images.push({ image, args }); }
  getImageData() {
    this.reads++;
    const { width, height, opaque } = this.canvas, data = new Uint8ClampedArray(width * height * 4);
    const visible = opaque || sourceOpaque;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!visible || visible(x, y, width, height)) data[(y * width + x) * 4 + 3] = 255;
    return { data };
  }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return '#texture'; }
  getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  measureText() { return { width: 10 }; }
}
for (const method of ['save', 'restore', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'ellipse', 'fill', 'stroke', 'clip', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'fillText']) Context.prototype[method] = () => {};
function canvas(width = 0, height = 0, dataset = {}) {
  const result = { width, height, dataset }, context = new Context(result);
  result.getContext = () => context;
  return result;
}
globalThis.document = { createElement: () => canvas() };

const { drawUIArtwork, portraitSprites, drawSpritePortrait } = await import('../ui-art.js');
const { mountGalleryEntry } = await import('../gallery-view.js');
const game = { biome: 'taiga', day: 1000, seed: 1847, money: 400000, routes: [], vehicles: [] };
const root = images => ({ querySelectorAll: () => images });
const lastDraw = image => image.getContext('2d').images.at(-1);
const finishArchitecture = async () => {
  for (const image of requests.filter(image => !image.done)) {
    image.done = true;
    if (image.url.includes('/plot-buildings-v2/')) image.onload(); else image.onerror();
  }
  for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
};

test('portrait fitting preserves aspect and includes every opaque fence and shadow pixel', () => {
  const image = canvas(200, 100);
  image.opaque = (x, y) => x >= 20 && x <= 179 && y >= 10 && y <= 59 || x === 180 && y === 90;
  const portrait = canvas(152, 152);
  drawSpritePortrait(portrait.getContext('2d'), image, { width: 152, height: 152 });
  const [sx, sy, sw, sh, x, y, w, h] = lastDraw(portrait).args;
  assert.deepEqual([sx, sy, sw, sh], [20, 10, 161, 81]);
  assert.equal(w / h, sw / sh, 'one scale applies to both axes');
  assert.equal(w, 140, 'the visible parcel fills the inset');
  assert.equal(x, 6); assert.ok(y > 6);
  drawSpritePortrait(portrait.getContext('2d'), image, { width: 104, height: 104 });
  assert.equal(image.getContext('2d').reads, 1, 'multiple UI sizes share cached alpha bounds');
});

test('selected small houses request high-density artwork and never enlarge prepared source pixels', () => {
  for (const density of [1, 2]) {
    window.devicePixelRatio = density;
    const portrait = canvas(152, 152, { buildingSprite: 'house-cheap-1', buildingVariant: '7' });
    drawUIArtwork(root([portrait]), game);
    const { image, args } = lastDraw(portrait), [, , sw, sh, , , w, h] = args;
    assert.deepEqual([portrait.width, portrait.height], [152 * density, 152 * density]);
    assert.ok(sw >= w * density && sh >= h * density, 'source pixels cover the physical display extent');
    assert.equal(image.width, 256 * density, 'portrait source retains the authored detail before fitting');
    assert.ok(requests.some(image => image.url.includes('/houses-design-1-rotation-1/') && image.url.endsWith(`-${256 * density}.png`)), 'correct design and rotation request the sharp density');
  }
});

test('UI banks survive other climates and share prepared identity across portraits', () => {
  const first = portraitSprites('taiga', 152, 152, 1, 1), image = first('house-cheap-2', 1, 1, '', 1);
  portraitSprites('desert', 152, 152, 1, 1)('house-cheap-2', 1, 1, '', 1);
  portraitSprites('tundra', 152, 152, 1, 1)('house-cheap-2', 1, 1, '', 1);
  const again = portraitSprites('taiga', 152, 152, 1, 1);
  assert.equal(again, first, 'climate filtering reuses its existing factory');
  assert.equal(again('house-cheap-2', 1, 1, '', 1), image, 'prepared pixels remain reusable');
});

test('workshop and saved building portraits use the actual logical footprint and level', async () => {
  window.devicePixelRatio = 1;
  const workshop = canvas(96, 100, { buildingSprite: 'factory' });
  drawUIArtwork(root([workshop]), game);
  await finishArchitecture();
  drawUIArtwork(root([workshop]), game);
  const workshopImage = lastDraw(workshop).image;
  assert.equal(workshopImage, portraitSprites('taiga', 96, 100, 2, 1)('factory', 0, 1, '', 2));
  assert.equal(workshopImage.getContext('2d').images.length, 1, 'two-tile workshop uses its generated city cutout');
  const compact = canvas(96, 100, { buildingSprite: 'church', buildingVariant: '7', buildingFootprint: '1', buildingLevel: '3' });
  drawUIArtwork(root([compact]), game);
  const compactImage = lastDraw(compact).image, key = compact.dataset.artDrawn;
  assert.equal(compactImage, portraitSprites('taiga', 96, 100, 1, 1)('church', 7, 3, '', 1));
  assert.equal(compactImage.getContext('2d').images.length, 0, 'compact saved church retains the world native fallback');
  compact.dataset.buildingFootprint = '2';
  drawUIArtwork(root([compact]), game);
  assert.notEqual(compact.dataset.artDrawn, key, 'saved extent participates in invalidation');
  assert.notEqual(lastDraw(compact).image, compactImage);
  assert.equal(lastDraw(compact).image.getContext('2d').images.length, 1, 'matching two-tile church uses the correct raster');
});

test('five-tile industry portraits account for inset alpha when choosing sharp source density', () => {
  // Current plot art has transparent frame margins. At DPR2 its visible crop
  // can be only257px wide in a320px source; fitting to280px needs another LOD.
  sourceOpaque = (x, y, width, height) => x >= width * .1 && x < width * .9 && y >= height * .1 && y < height * .9;
  for (const density of [1, 2]) {
    window.devicePixelRatio = density;
    const portrait = canvas(152, 152, { industrySprite: 'refinery', industryFootprint: '5' });
    drawUIArtwork(root([portrait]), game);
    const { image, args } = lastDraw(portrait), [, , sw, sh, , , w, h] = args;
    assert.equal(image.width, 320 * density); assert.equal(image.height, 336 * density);
    assert.ok(Math.abs(w / h - sw / sh) < 1e-12, 'industry artwork is not stretched into a fixed96×108 box');
    assert.ok(sw >= w * density && sh >= h * density);
  }
  sourceOpaque = null;
});

// Mount the real single-entry view. This small DOM adapter records its emitted
// canvas sizes and executes the actual artwork lifecycle rather than matching
// markup strings or duplicating portrait-selection logic.
function galleryContainer() {
  let images = [];
  const button = { addEventListener() {} };
  const detail = {
    set innerHTML(html) {
      images = [...html.matchAll(/<canvas\s+([^>]+)>/g)].map(([, attributes]) => {
        const values = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
        const dataset = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
        return canvas(Number(values.width), Number(values.height), dataset);
      });
    },
    querySelector: () => null, querySelectorAll: () => [],
  };
  return {
    set innerHTML(value) {},
    closest: () => null, addEventListener() {}, removeEventListener() {},
    querySelector: selector => selector === '.gallery-detail' ? detail : button,
    querySelectorAll(selector) {
      const climate = selector.match(/data-gallery-climate="([^"]+)"/);
      if (climate) return images.filter(image => image.dataset.galleryClimate === climate[1]);
      if (selector === '[data-gallery-nature]') return images.filter(image => image.dataset.galleryNature);
      return images;
    },
    get images() { return images; },
  };
}

test('every selected Gallery category has a target-sized DPR canvas and responds to density changes', () => {
  for (const entryId of ['building:house-cheap-1', 'industry:refinery', 'nature:water', 'vehicle:airliner', 'transport:airport-x']) {
    window.devicePixelRatio = 1;
    const container = galleryContainer(), view = mountGalleryEntry(container, game, {}, { entryId });
    assert.equal(container.images.length, 1, entryId);
    const portrait = container.images[0];
    assert.deepEqual([portrait.width, portrait.height], [152, 152], `${entryId}: CSS152 portrait is not upscaled from112`);
    for (const density of [2, 1, 2]) {
      window.devicePixelRatio = density;
      for (const resize of resizeListeners) resize();
      flushFrames();
      assert.deepEqual([portrait.width, portrait.height], [152 * density, 152 * density], `${entryId}: open portrait follows the current monitor density`);
    }
    view.dispose();
    assert.equal(resizeListeners.size, 0, 'disposing a view removes its resize lifecycle');
  }
});

test('inspector Gallery keeps the placed building variant, development and compact footprint', () => {
  window.devicePixelRatio = 1;
  const container = galleryContainer(), view = mountGalleryEntry(container, game, {}, {
    entryId: 'building:church', preview: { variant: 7, level: 3, footprint: 1 },
  });
  const portrait = container.images[0];
  assert.deepEqual([portrait.dataset.buildingVariant, portrait.dataset.buildingLevel, portrait.dataset.buildingFootprint], ['7', '3', '1']);
  assert.equal(lastDraw(portrait).image, portraitSprites('taiga', 152, 152, 1, 1)('church', 7, 3, '', 1));
  assert.equal(lastDraw(portrait).image.getContext('2d').images.length, 0, 'Gallery cannot substitute the larger catalog sprite for a compact world site');
  view.dispose();
});
