// Generated surface art and baked relief maps are loaded before the race.
// The fallback estimates height from albedo; these are artistic PBR maps,
// not measured scans. Derivatives wrap so the relief repeats cleanly.
const SURFACES = {
  asphalt: { relief: 2.5, roughness: .80, variation: .12, neutral: '#555954' },
  gravel: { relief: 4.1, roughness: .95, variation: .05, neutral: '#a29982' },
  dirt: { relief: 3.0, roughness: .94, variation: .06, neutral: '#9c7d58' },
  sand: { relief: 2.3, roughness: .96, variation: .035, neutral: '#cfbb90' },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const yieldFrame = () => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
  else setTimeout(resolve, 0);
});

function readPixels(source, limit) {
  const sourceWidth = source?.naturalWidth || source?.videoWidth || source?.width || 0;
  const sourceHeight = source?.naturalHeight || source?.videoHeight || source?.height || 0;
  if (!sourceWidth || !sourceHeight) throw new Error('Surface image is not decoded');
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  return { width, height, pixels: context.getImageData(0, 0, width, height).data };
}

function surfacePixels(pixels, width, height, profile) {
  const size = width * height, heightField = new Float32Array(size), smooth = new Float32Array(size);
  let mean = 0;
  for (let i = 0; i < size; i++) {
    const offset = i * 4;
    // Using perceptual luminance retains subtle grain on dark asphalt. This is
    // a height estimate, not a colour conversion for the rendered albedo.
    const value = (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255;
    heightField[i] = value; mean += value;
  }
  mean /= size;
  // A small periodic binomial filter removes single-pixel sparkling while
  // retaining aggregate edges. Every derivative wraps at the tile boundary.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ym = ((y + height - 1) % height) * width, yp = ((y + 1) % height) * width;
    const xm = (x + width - 1) % width, xp = (x + 1) % width, row = y * width;
    smooth[row + x] = (heightField[ym + xm] + heightField[ym + xp] + heightField[yp + xm] + heightField[yp + xp]
      + 2 * (heightField[ym + x] + heightField[yp + x] + heightField[row + xm] + heightField[row + xp]) + 4 * heightField[row + x]) / 16;
  }
  const normal = new Uint8Array(size * 4), roughness = new Uint8Array(size * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = y * width, ym = ((y + height - 1) % height) * width, yp = ((y + 1) % height) * width;
    const xm = (x + width - 1) % width, xp = (x + 1) % width, i = row + x, offset = i * 4;
    const dx = (smooth[row + xp] - smooth[row + xm]) * profile.relief;
    const dy = (smooth[yp + x] - smooth[ym + x]) * profile.relief;
    const inverseLength = 1 / Math.hypot(dx, dy, 1);
    normal[offset] = Math.round((-dx * inverseLength * .5 + .5) * 255);
    // Canvas rows run downward; positive texture V runs upward after flipY.
    normal[offset + 1] = Math.round((dy * inverseLength * .5 + .5) * 255);
    normal[offset + 2] = Math.round((inverseLength * .5 + .5) * 255);
    normal[offset + 3] = 255;
    const grain = Math.abs(heightField[i] - smooth[i]);
    const value = Math.round(clamp(profile.roughness + (heightField[i] - mean) * profile.variation + grain * .12, .58, 1) * 255);
    roughness[offset] = roughness[offset + 1] = roughness[offset + 2] = value;
    roughness[offset + 3] = 255;
  }
  return { normal, roughness };
}

/**
 * @returns Maps ready to spread into MeshStandardMaterial options. `sources`
 * distinguishes generated art from the deterministic fallback; progress is 0–1.
 * Registration includes supplied fallback textures (Set-based registries make
 * this idempotent). Call before compiling materials and starting the race.
 */
export async function loadRoadTextures(THREE, { keepTexture, renderer, fallbackTextures = {}, onProgress = () => {} }) {
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const maxSize = Math.min(1024, renderer?.capabilities?.maxTextureSize || 1024);
  const loader = new THREE.TextureLoader(), kinds = Object.keys(SURFACES);
  const materials = {}, sources = {};
  let loadedAlbedos = 0;
  function configure(texture, colorSpace, reference = null) {
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    if (reference) {
      texture.repeat.copy(reference.repeat); texture.offset.copy(reference.offset);
      texture.center.copy(reference.center); texture.rotation = reference.rotation;
      texture.flipY = reference.flipY;
    }
    texture.needsUpdate = true;
    return keepTexture(texture);
  }
  function neutralTexture(profile) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const context = canvas.getContext('2d'); context.fillStyle = profile.neutral; context.fillRect(0, 0, 8, 8);
    return new THREE.CanvasTexture(canvas);
  }
  function derivedTexture(data, width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(width, height); pixels.data.set(data); context.putImageData(pixels, 0, 0);
    // Retain a regular canvas image so a generated world can export its normal
    // and roughness maps as PNG assets without reading pixels back from WebGL.
    return new THREE.CanvasTexture(canvas);
  }
  onProgress(0, 'Loading road materials');
  // All maps are packaged locally. CPU derivation is only a missing-asset fallback.
  const loaded = await Promise.all(kinds.map(kind => Promise.allSettled(
    ['albedo', 'normal', 'roughness'].map(type => loader.loadAsync(new URL(`../assets/textures/${kind}-${type}.webp`, import.meta.url).href))
  )));
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index], profile = SURFACES[kind], [result, normalResult, roughnessResult] = loaded[index];
    const fallback = fallbackTextures[kind];
    let map = result.status === 'fulfilled' ? result.value : fallback || neutralTexture(profile);
    sources[kind] = result.status === 'fulfilled' ? 'generated' : 'procedural';
    configure(map, THREE.SRGBColorSpace, map === fallback ? null : fallback);
    let source;
    try { source = readPixels(map.image, maxSize); }
    catch {
      // Failed decoding or a canvas security restriction must not prevent a
      // race from loading. A readable local fallback still receives matching maps.
      if (map !== fallback && fallback) {
        map = configure(fallback, THREE.SRGBColorSpace); sources[kind] = 'procedural';
        try { source = readPixels(map.image, maxSize); } catch { /* Neutral below. */ }
      }
      if (!source) {
        map = configure(neutralTexture(profile), THREE.SRGBColorSpace, fallback);
        sources[kind] = 'neutral'; source = readPixels(map.image, 8);
      }
    }
    if (sources[kind] === 'generated') {
      loadedAlbedos++;
      // Generated art represents roughly three metres of surface. The road UVs
      // span a 12m carriageway and repeat every 14m along it; procedural fallback
      // textures retain their existing transform because they include wheel ruts.
      map.repeat.set(4, 14 / 3);
    }
    let normalMap, roughnessMap;
    if (sources[kind] === 'generated' && normalResult.status === 'fulfilled' && roughnessResult.status === 'fulfilled') {
      normalMap = configure(normalResult.value, THREE.NoColorSpace, map);
      roughnessMap = configure(roughnessResult.value, THREE.NoColorSpace, map);
    } else {
      // Dispose any orphaned successful data-map loads before deriving a pair.
      if (normalResult.status === 'fulfilled') normalResult.value.dispose();
      if (roughnessResult.status === 'fulfilled') roughnessResult.value.dispose();
      const { normal, roughness } = surfacePixels(source.pixels, source.width, source.height, profile);
      normalMap = configure(derivedTexture(normal, source.width, source.height), THREE.NoColorSpace, map);
      roughnessMap = configure(derivedTexture(roughness, source.width, source.height), THREE.NoColorSpace, map);
    }
    normalMap.name = `${kind}-normal`; roughnessMap.name = `${kind}-roughness`;
    map.name ||= `${kind}-albedo`;
    materials[kind] = { map, normalMap, roughnessMap };
    onProgress((index + 1) / kinds.length, `Preparing ${kind} relief and roughness`);
    await yieldFrame();
  }
  return { materials, normalMaps: kinds.length, loadedAlbedos, sources };
}
