// Contract and lifecycle checks. Exact texel/mip copies and the real shader
// are additionally exercised by the bounded WebGL texture-array gate.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createTerrainTextureArrays, GROUND_LAYERS } = await import('../js/terrain-textures.js');

function sources() {
  return Object.fromEntries(GROUND_LAYERS.flatMap((name, layer) => ['', '_n'].map(suffix => {
    const data = new Uint8Array(16 * 16 * 4).fill(layer * 40 + (suffix ? 20 : 0));
    const texture = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
    texture.colorSpace = suffix ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return [name + suffix, texture];
  })));
}

function renderer({ failCopy = false, lost = false, layers = 256 } = {}) {
  const copies = [], allocations = [], queries = [], listeners = new Map();
  const gl = { MAX_ARRAY_TEXTURE_LAYERS: 35071, NO_ERROR: 0, getParameter: parameter => { queries.push(parameter); return layers; },
    texStorage3D() {}, copyTexSubImage3D() {}, isContextLost: () => lost, getError: () => 0 };
  return { copies, allocations, queries, listeners, getContext: () => gl,
    domElement: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    initTexture(texture) { allocations.push(texture); },
    copyTextureToTexture(source, destination, region, position, sourceMip, destinationMip) {
      if (failCopy) throw new Error('simulated GPU copy failure');
      copies.push({ source, destination, region, layer: position.z, sourceMip, destinationMip,
        version: destination.version, mipmaps: destination.generateMipmaps });
    },
  };
}

assert.deepEqual(GROUND_LAYERS, ['mud', 'grass', 'forest', 'cobble']);
const interrupted = renderer({ lost: true, layers: null });
assert.throws(() => createTerrainTextureArrays(interrupted, sources()), /Interrupted while loading graphics.*Retry to reload/);
assert.equal(interrupted.queries.length, 0, 'lost contexts are identified before unreliable capability queries');
assert.equal(interrupted.allocations.length, 0, 'interrupted loads allocate no GPU storage');
assert.equal(interrupted.copies.length, 0);
assert.equal(interrupted.listeners.size, 0);
const unsupported = renderer({ layers: 3 });
assert.throws(() => createTerrainTextureArrays(unsupported, sources()), /fewer than four texture-array layers/);
assert.deepEqual(unsupported.queries, [unsupported.getContext().MAX_ARRAY_TEXTURE_LAYERS], 'real live-context limits still enforce the hardware requirement');
assert.equal(unsupported.allocations.length, 0);
const input = sources(), r = renderer();
let sourceDisposals = 0;
for (const texture of Object.values(input)) texture.addEventListener('dispose', () => sourceDisposals++);
const pixels = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.image.data.slice()]));
const packed = createTerrainTextureArrays(r, input);
assert.equal(r.copies.length, 8);
assert.equal(sourceDisposals, 8, 'temporary source GPU allocations are released after a successful pack');
assert.equal(packed.albedo.colorSpace, THREE.SRGBColorSpace);
assert.equal(packed.normal.colorSpace, THREE.NoColorSpace);
for (const texture of [packed.albedo, packed.normal]) {
  assert.deepEqual([texture.image.width, texture.image.height, texture.image.depth], [16, 16, 4]);
  assert.equal(texture.image.data, null, 'GPU copy does not create a canvas/CPU image round trip');
  assert.equal(texture.source.dataReady, false, 'null CPU storage is not uploaded');
  assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
  assert.equal(texture.anisotropy, 8); assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(texture.generateMipmaps, true);
  const copies = r.copies.filter(copy => copy.destination === texture);
  assert.deepEqual(copies.map(copy => copy.layer), [0, 1, 2, 3]);
  assert.equal(new Set(copies.map(copy => copy.version)).size, 1, 'mip toggling does not invalidate immutable storage');
}
for (const [key, texture] of Object.entries(input)) assert.deepEqual(texture.image.data, pixels[key], `${key}: retained source bytes unchanged`);
assert.ok(r.listeners.has('webglcontextrestored'));
assert.ok(r.listeners.has('webglcontextlost'));
let lostDisposals = 0;
for (const texture of [packed.albedo, packed.normal]) texture.addEventListener('dispose', () => lostDisposals++);
r.listeners.get('webglcontextlost')();
assert.equal(lostDisposals, 2, 'old context allocations/listeners are released before restoration');
r.listeners.get('webglcontextrestored')();
assert.equal(r.copies.length, 16, 'context restoration repopulates all layers');
assert.equal(sourceDisposals, 16);
let arrayDisposals = 0;
for (const texture of [packed.albedo, packed.normal]) texture.addEventListener('dispose', () => arrayDisposals++);
packed.dispose(); packed.dispose();
assert.equal(arrayDisposals, 2, 'dispose is idempotent');
assert.equal(r.listeners.size, 0, 'disposed arrays leave no restoration listener');

for (const [change, message] of [
  [s => delete s.grass, /missing texture grass/],
  [s => { s.grass.image.width = 8; }, /identical dimensions/],
  [s => { s.mud_n.colorSpace = THREE.SRGBColorSpace; }, /wrong color space/],
  [s => { s.forest.premultiplyAlpha = true; }, /unpremultiplied/],
  [s => { s.cobble.wrapS = THREE.ClampToEdgeWrapping; }, /wrapS/],
  [s => { s.mud.format = THREE.RedFormat; }, /RGBA8/],
]) {
  const s = sources(), mock = renderer(); change(s);
  assert.throws(() => createTerrainTextureArrays(mock, s), message);
  assert.equal(mock.allocations.length, 0, 'invalid bundles fail before GPU allocation');
}
const failing = renderer({ failCopy: true });
assert.throws(() => createTerrainTextureArrays(failing, sources()), /simulated GPU copy failure/);
assert.equal(failing.listeners.size, 0, 'failed packing leaves no event listener');
console.log('Terrain texture arrays: layer contract, packed data, input validation, recovery and disposal pass');
