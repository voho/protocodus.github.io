import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise real sprite closures with controlled image arrival. The canvas keeps
// the chosen source/density; no image pixels or native rendering are simulated.
const requests = [];
globalThis.Image = class {
  set src(url) {
    this.url = url;
    const cell = Number(url.match(/-(\d+)\.png$/)?.[1] || 256);
    this.naturalWidth = this.naturalHeight = cell * 3;
    requests.push(this);
  }
  get src() { return this.url; }
  decode() { return Promise.resolve(); }
};
const canvas = () => {
  const c = { width: 0, height: 0, draw: null }, context = {
    save() {}, restore() {}, scale() {}, translate() {},
    drawImage(image, sx, sy, sw) { c.draw = { source: image.src, cell: sw, sx, sy }; },
  };
  c.getContext = () => context;
  return c;
};
globalThis.document = { createElement: canvas };
const houses = await import('../raster-houses.js');
const { createSprites } = await import('../sprites.js');
const { residentialKind } = await import('../buildings.js');
const finish = async (matches, fail = false) => {
  for (const image of requests.filter(image => !image.done && matches(image.url))) {
    image.done = true;
    if (fail) image.onerror(); else image.onload();
  }
  for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve));
};
const cells = [16, 32, 64, 128, 256, 512];

test('a cached alternate fallback sharpens when its primary density arrives', async () => {
  void houses.preloadHouses({ biome: 'taiga', rotations: [0], designs: [0], cells: [16], waitMs: 0 });
  await finish(url => /\/houses-design-0-rotation-0\/atlas-16\.png$/.test(url));
  void houses.preloadHouses({ biome: 'taiga', rotations: [1], designs: [0], cells, waitMs: 0 });
  await finish(url => url.includes('/houses-design-0-rotation-1/'), true);
  const sprite = createSprites('taiga', { pixelScale: 1 });
  await finish(url => url.includes('/assets/world/') && !url.includes('/houses-design-0-rotation-0/'), true);
  const before = sprite('house-cheap-2', 1), revision = houses.houseAssetsRevision();
  assert.equal(before.draw.cell, 16);
  assert.match(before.draw.source, /\/houses-design-0-rotation-0\/atlas-16\.png$/);
  assert.equal(before, sprite('house-cheap-2', 19), 'the same requested rotation shares its cached fallback');
  assert.equal(requests.filter(image => /\/houses-design-0-rotation-0\/atlas-32\.png$/.test(image.url)).length, 1, 'the fallback shares the pending primary request');
  await finish(url => /\/houses-design-0-rotation-0\/atlas-32\.png$/.test(url));
  await finish(url => /\/houses-design-0-rotation-0\/atlas-64\.png$/.test(url), true);
  assert.ok(houses.houseAssetsRevision() > revision, 'the drawn fallback density arrival publishes a cache revision');
  const after = sprite('house-cheap-2', 1);
  assert.notEqual(after, before, 'the existing sprite closure replaces its cached low-density fallback');
  assert.equal(after.draw.cell, 32);
  assert.match(after.draw.source, /\/houses-design-0-rotation-0\/atlas-32\.png$/);
  assert.equal(after, sprite('house-cheap-2', 19));
});

test('a second climate shares neutral density requests and refreshes cached sprites', async () => {
  const sprite = createSprites('desert', { pixelScale: 4 });
  await finish(url => url.includes('/assets/world/') && !url.includes('/houses-design-0-rotation-0/'), true);
  const before = sprite('house-normal-3', 0), revision = houses.houseAssetsRevision();
  assert.equal(before.draw.cell, 32);
  assert.match(before.draw.source, /\/houses-design-0-rotation-0\/atlas-32\.png$/);
  assert.equal(requests.filter(image => /\/houses-design-0-rotation-0\/atlas-128\.png$/.test(image.url)).length, 1, 'Detail fetches the neutral sheet density');
  await finish(url => /\/houses-design-0-rotation-0\/atlas-128\.png$/.test(url));
  assert.ok(houses.houseAssetsRevision() > revision);
  const after = sprite('house-normal-3', 0);
  assert.notEqual(after, before);
  assert.equal(after.draw.cell, 128);
  assert.match(after.draw.source, /\/houses-design-0-rotation-0\/atlas-128\.png$/);
});

test('architectural variants retain separate identities and replace a cached base-design fallback', async () => {
  const sprite = createSprites('taiga', { pixelScale: 1 });
  const before = sprite('house-normal-1', 6), base = sprite('house-normal-1', 0);
  assert.match(before.draw.source, /\/houses-design-0-rotation-0\/atlas-32\.png$/);
  assert.notEqual(before, base, 'requested designs keep separate identities while a base sheet stands in');
  assert.equal(before, sprite('house-normal-1', 24), 'eighteen saved variants repeat the same design and rotation');
  const revision = houses.houseAssetsRevision();
  void houses.preloadHouses({ biome: 'taiga', designs: [1], rotations: [0], cells: [32], retry: true, waitMs: 0 });
  await finish(url => url.includes('/houses-design-1-rotation-0/'));
  await new Promise(resolve => setTimeout(resolve, 175));
  assert.ok(houses.houseAssetsRevision() > revision);
  const after = sprite('house-normal-1', 6);
  assert.notEqual(after, before, 'the first decoded design refreshes an existing sprite closure');
  assert.match(after.draw.source, /\/houses-design-1-rotation-0\/atlas-32\.png$/);
  assert.equal(after, sprite('house-normal-1', 24));
  assert.equal(houses.getHouseAssetStats('taiga', 0, 1).activeDesign, 1);
  assert.deepEqual(houses.HOUSE_DESIGNS, [0, 1, 2]);
  assert.deepEqual(houses.houseArtworkVariant(17), { rotation: 1, design: 2 });
  assert.deepEqual(houses.houseArtworkVariant(-1), { rotation: 1, design: 2 });
  assert.deepEqual(houses.houseArtworkVariant(18), { rotation: 0, design: 0 });
});

test('procedural residential kinds receive all architectural designs and both rotations', () => {
  for (const level of [1,2,3]) {
    const groups = new Map();
    for (let variant=0;variant<16;variant++) {
      const kind=residentialKind(variant,level),artwork=houses.houseArtworkVariant(variant);
      let group=groups.get(kind);if(!group){group={designs:new Set(),rotations:new Set()};groups.set(kind,group);}
      group.designs.add(artwork.design);group.rotations.add(artwork.rotation);
    }
    assert.equal(groups.size,3);
    for (const [kind,group] of groups) {
      assert.deepEqual([...group.designs].sort(),[0,1,2],`${kind}: economic kind selection does not constrain architecture`);
      assert.deepEqual([...group.rotations].sort(),[0,1],`${kind}: both physical orientations occur`);
    }
  }
  const sprite=createSprites('taiga',{pixelScale:1});
  for (const level of [1,2,3]) {
    const identities=new Map();
    for (let variant=0;variant<16;variant++) {
      const kind=residentialKind(variant,level),image=sprite('house',variant,level);
      assert.equal(image,sprite(kind,variant,level),'legacy procedural aliases retain the same artwork selection');
      let group=identities.get(kind);if(!group){group=new Set();identities.set(kind,group);}group.add(image);
    }
    for (const [kind,group] of identities)assert.ok(group.size>=5,`${kind}: the sixteen-value procedural pool draws at least five physical identities`);
  }
  for (const kind of houses.HOUSE_KINDS) {
    const identities=new Set(Array.from({length:18},(_,variant)=>sprite(kind,variant)));
    assert.equal(identities.size,6,`${kind}: eighteen seeds share six authored bitmap identities`);
    assert.equal(sprite(kind,0),sprite(kind,18));
    assert.equal(sprite(kind,6),sprite(kind,24));
    assert.notEqual(sprite(kind,0),sprite(kind,12),'the third design survives variant normalization');
  }
});
