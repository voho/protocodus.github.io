/* Canonical, world-fixed terrain horizons.

   This module is deliberately independent of Three.js. The main thread uses
   it once to prepare the complete opening cache before the scene is revealed;
   `shadow-worker.js` uses the same code for the occasional 96 m tile that is
   needed later. Both paths therefore produce bit-identical RG16F payloads.

   A horizon is a direction-independent fact about the mountain: the largest
   rise/run slope encountered along a bearing. Lighting compares the current
   sun slope with that stored value every frame. No time-of-day image is ever
   generated or published in the background. */

const halfBuffer = new ArrayBuffer(4);
const halfFloat = new Float32Array(halfBuffer);
const halfBits = new Uint32Array(halfBuffer);

/* IEEE754 float32 to float16, with round-to-nearest. Horizon values are finite
   and modest, but keeping the complete converter makes the worker payload an
   ordinary reusable numeric format rather than a private fixed-point code. */
export function toHalfFloat(value) {
  halfFloat[0] = value;
  const x = halfBits[0];
  const sign = (x >>> 16) & 0x8000;
  let mantissa = x & 0x007fffff;
  let exponent = (x >>> 23) & 0xff;

  if (exponent === 0xff) {
    return sign | (mantissa ? 0x7e00 : 0x7c00);
  }
  exponent -= 127;
  if (exponent < -24) return sign;
  if (exponent < -14) {
    mantissa = (mantissa | 0x00800000) >>> (-exponent - 1);
    return sign | ((mantissa + 0x00001000) >>> 13);
  }
  if (exponent > 15) return sign | 0x7c00;
  const rounded = mantissa + 0x00001000;
  if (rounded & 0x00800000) {
    exponent += 1;
    mantissa = 0;
    if (exponent > 15) return sign | 0x7c00;
  } else {
    mantissa = rounded;
  }
  return sign | ((exponent + 15) << 10) | (mantissa >>> 13);
}

function buildOffsets(spec) {
  const { directions, azimuth, steps, spacing } = spec;
  const dx = new Int16Array(directions * steps.length);
  const dz = new Int16Array(directions * steps.length);
  for (let direction = 0; direction < directions; direction++) {
    const t = directions > 1 ? direction / (directions - 1) : 0;
    const angle = azimuth[0] + (azimuth[1] - azimuth[0]) * t;
    const sx = Math.sin(angle);
    const sz = -Math.cos(angle);
    for (let k = 0; k < steps.length; k++) {
      const p = direction * steps.length + k;
      dx[p] = Math.round((sx * steps[k]) / spacing);
      dz[p] = Math.round((sz * steps[k]) / spacing);
    }
  }
  return { dx, dz };
}

/* Build one or more adjacent tiles with one shared guard-height plate. The
   opening 5×5 region therefore evaluates 57k canonical heights rather than
   evaluating the overlapping 118 m halo twenty-five separate times. */
export function buildShadowRegion(spec, heightAt) {
  const {
    originTileX, originTileZ, tilesX, tilesZ, tileSamples, spacing,
    directions, steps, raise, gradeBase,
  } = spec;
  const width = tilesX * tileSamples;
  const height = tilesZ * tileSamples;
  const guard = Math.ceil(steps[steps.length - 1] / spacing) + 2;
  const guardWidth = width + guard * 2;
  const guardHeight = height + guard * 2;
  const tileSpan = tileSamples * spacing;
  const worldX0 = originTileX * tileSpan;
  const worldZ0 = originTileZ * tileSpan;
  const heights = new Float32Array(guardWidth * guardHeight);

  for (let z = 0; z < guardHeight; z++) {
    const wz = worldZ0 + (z - guard + 0.5) * spacing;
    const row = z * guardWidth;
    for (let x = 0; x < guardWidth; x++) {
      const wx = worldX0 + (x - guard + 0.5) * spacing;
      heights[row + x] = heightAt(wx, wz);
    }
  }

  const ground = new Uint16Array(width * height);
  for (let z = 0; z < height; z++) {
    const wz = worldZ0 + (z + 0.5) * spacing;
    const src = (z + guard) * guardWidth + guard;
    const dst = z * width;
    for (let x = 0; x < width; x++) {
      ground[dst + x] = toHalfFloat(heights[src + x] - gradeBase * wz);
    }
  }

  // Direction-major RG: horizon at the snow, then horizon `raise` metres up.
  const horizon = new Uint16Array(directions * width * height * 2);
  const { dx, dz } = buildOffsets(spec);
  const stepCount = steps.length;
  for (let direction = 0; direction < directions; direction++) {
    const directionBase = direction * width * height * 2;
    const offsetBase = direction * stepCount;
    for (let z = 0; z < height; z++) {
      const gz = z + guard;
      for (let x = 0; x < width; x++) {
        const gx = x + guard;
        const h = heights[gz * guardWidth + gx];
        let seen = -4;
        let seenRaised = -4;
        for (let k = 0; k < stepCount; k++) {
          const sample = heights[
            (gz + dz[offsetBase + k]) * guardWidth + gx + dx[offsetBase + k]
          ];
          const rise = sample - h;
          const slope = rise / steps[k];
          const raisedSlope = (rise - raise) / steps[k];
          if (slope > seen) seen = slope;
          if (raisedSlope > seenRaised) seenRaised = raisedSlope;
        }
        const p = directionBase + (z * width + x) * 2;
        horizon[p] = toHalfFloat(seen);
        horizon[p + 1] = toHalfFloat(seenRaised);
      }
    }
  }

  return {
    originTileX, originTileZ, tilesX, tilesZ, width, height, horizon, ground,
  };
}

export function buildShadowTile(spec, heightAt) {
  return buildShadowRegion({ ...spec, tilesX: 1, tilesZ: 1 }, heightAt);
}
