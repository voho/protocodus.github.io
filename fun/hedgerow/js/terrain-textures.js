/* Hedgerow — four ground layers in two texture-array samplers.

   The on-disk maps keep their RGBA contract: albedo RGB/height A, normal
   RGB/roughness A. Copy the uploaded textures on the GPU, not through a
   canvas (whose premultiplied-alpha round trip can damage packed data).
   Layer order is shared with terrain.js: mud, grass, forest, cobble.
*/
import * as THREE from 'three';

export const GROUND_LAYERS = Object.freeze(['mud', 'grass', 'forest', 'cobble']);

const SETTINGS = ['wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'generateMipmaps', 'internalFormat'];
const fail = (message) => { throw new Error(`Terrain texture arrays: ${message}`); };

function inspectGroup(textures, suffix, colorSpace) {
  const source = GROUND_LAYERS.map(name => {
    const key = name + suffix, texture = textures[key];
    if (!texture?.isTexture) fail(`missing texture ${key}`);
    if (texture.isCompressedTexture || texture.isCubeTexture || texture.isDataArrayTexture || texture.isData3DTexture || texture.isDepthTexture || texture.isRenderTargetTexture || texture.isVideoTexture || texture.isFramebufferTexture) {
      fail(`${key} must be an uncompressed 2D texture`);
    }
    if (texture.format !== THREE.RGBAFormat || texture.type !== THREE.UnsignedByteType) fail(`${key} must contain RGBA8 data`);
    if (texture.colorSpace !== colorSpace) fail(`${key} has the wrong color space`);
    if (texture.premultiplyAlpha) fail(`${key} must keep alpha unpremultiplied`);
    const image = texture.image;
    if (!Number.isInteger(image?.width) || !Number.isInteger(image?.height) || image.width <= 0 || image.height <= 0) {
      fail(`${key} has no decoded image`);
    }
    return texture;
  });
  const first = source[0];
  for (let i = 1; i < source.length; i++) {
    if (source[i].image.width !== first.image.width || source[i].image.height !== first.image.height) fail('all ground layers need identical dimensions');
    for (const key of SETTINGS) if (source[i][key] !== first[key]) fail(`ground layers disagree on ${key}`);
  }
  return source;
}

function arrayFor(source, name) {
  const first = source[0];
  const array = new THREE.DataArrayTexture(null, first.image.width, first.image.height, GROUND_LAYERS.length);
  array.name = name;
  array.format = first.format;
  array.type = first.type;
  array.colorSpace = first.colorSpace;
  for (const key of SETTINGS) array[key] = first[key];
  // The source upload has already applied its image orientation. A GPU
  // framebuffer copy preserves those texels, with no further unpack flip.
  array.flipY = false;
  array.premultiplyAlpha = false;
  array.unpackAlignment = 1;
  // Allocate immutable storage without trying to upload a null CPU buffer.
  // Retained source images repopulate the arrays after context restoration.
  array.source.dataReady = false;
  return array;
}

/**
 * Pack loaded ground maps once, after loadTextures and before scene building.
 * Returns {albedo, normal, dispose}; source Texture objects/images are retained
 * but their temporary GPU allocations are released after a successful copy.
 * Invalid inputs or GPU copy failure throw through the existing loading-error
 * path. There is no sampler-heavy rendering fallback for a failed pack.
 */
export function createTerrainTextureArrays(renderer, textures, { onRestoreError } = {}) {
  if (typeof renderer?.initTexture !== 'function' || typeof renderer?.copyTextureToTexture !== 'function') fail('renderer lacks the required GPU copy API');
  const gl = renderer.getContext();
  if (typeof gl?.texStorage3D !== 'function' || typeof gl?.copyTexSubImage3D !== 'function') fail('WebGL2 texture arrays are required');
  if (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) < GROUND_LAYERS.length) fail('fewer than four texture-array layers are available');
  const colors = inspectGroup(textures, '', THREE.SRGBColorSpace);
  const normals = inspectGroup(textures, '_n', THREE.NoColorSpace);
  if (colors[0].image.width !== normals[0].image.width || colors[0].image.height !== normals[0].image.height) fail('albedo and normal dimensions differ');
  const albedo = arrayFor(colors, 'ground-albedo-height');
  const normal = arrayFor(normals, 'ground-normal-roughness');
  const destination = new THREE.Vector3();
  let disposed = false;

  function upload(array, source) {
    const mipmaps = source[0].generateMipmaps;
    array.generateMipmaps = mipmaps;
    array.needsUpdate = true;
    // Full mip storage must exist before copying. Toggling generateMipmaps
    // after this must NOT set needsUpdate: r185 includes it in the storage
    // cache key, so an upload then would allocate a new, empty GPU texture.
    renderer.initTexture(array);
    array.generateMipmaps = false;
    try {
      for (let layer = 0; layer < source.length; layer++) {
        renderer.initTexture(source[layer]);
        if (layer === source.length - 1) array.generateMipmaps = mipmaps;
        destination.set(0, 0, layer);
        renderer.copyTextureToTexture(source[layer], array, null, destination, 0, 0);
      }
    } finally {
      array.generateMipmaps = mipmaps;
    }
  }

  function repopulate() {
    if (disposed) return;
    if (gl.isContextLost()) fail('the WebGL context is lost');
    upload(albedo, colors);
    upload(normal, normals);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) fail(`GPU layer copy failed (WebGL error ${error})`);
    // Ground source keys are terrain-only. Keep their decoded images for
    // diagnostics/recovery while avoiding eight duplicate GPU allocations.
    for (const source of new Set([...colors, ...normals])) source.dispose();
  }

  function restore() {
    try { repopulate(); }
    catch (error) {
      if (onRestoreError) onRestoreError(error);
      else console.error('Could not restore terrain texture arrays', error);
    }
  }

  function releaseLostAllocations() {
    if (disposed) return;
    // Three recreates WebGLTextures on restore. Remove the old generation's
    // dispose listeners while its context is lost, otherwise a later dispose
    // tries to delete both the old and new GPU objects. Texture.dispose only
    // releases the allocation; these Texture objects remain reusable.
    albedo.dispose();
    normal.dispose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.domElement?.removeEventListener('webglcontextlost', releaseLostAllocations);
    renderer.domElement?.removeEventListener('webglcontextrestored', restore);
    albedo.dispose();
    normal.dispose();
  }

  try { repopulate(); }
  catch (error) { dispose(); throw error; }
  // WebGLRenderer registered its own restoration listener at construction,
  // so it resets its GL caches before this listener uploads retained images.
  renderer.domElement?.addEventListener('webglcontextlost', releaseLostAllocations);
  renderer.domElement?.addEventListener('webglcontextrestored', restore);
  return { albedo, normal, dispose };
}
