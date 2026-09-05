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
  // -25, not -24: values just under 2^-24 still round up to the smallest
  // subnormal, and the shift below stays comfortably inside JS's 32-bit
  // shift range. Anything smaller genuinely is zero in half precision.
  if (exponent < -25) return sign;
  if (exponent < -14) {
    /* Subnormal halves. The implicit bit is restored and the value shifted
       so the target mantissa still sits 13 bits up, where the shared
       round-to-nearest below expects it — shifting all the way down here
       and then 13 more (the old `-exponent - 1`) flushed every |v| < 2^-14
       to signed zero. Rounding overflow at the 2^-14 boundary carries into
       0x0400, the smallest normal half, which is exactly right. */
    mantissa = (mantissa | 0x00800000) >>> (-exponent - 14);
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
  const count = directions * steps.length;
  const dx = new Int16Array(count);
  const dz = new Int16Array(count);
  const fx = new Float64Array(count);
  const fz = new Float64Array(count);
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (let direction = 0; direction < directions; direction++) {
    const t = directions > 1 ? direction / (directions - 1) : 0;
    const angle = azimuth[0] + (azimuth[1] - azimuth[0]) * t;
    for (let k = 0; k < steps.length; k++) {
      const p = direction * steps.length + k;
      const x = Math.sin(angle) * steps[k] / spacing;
      const z = -Math.cos(angle) * steps[k] / spacing;
      dx[p] = Math.floor(x);
      dz[p] = Math.floor(z);
      fx[p] = x - dx[p];
      fz[p] = z - dz[p];
      minX = Math.min(minX, dx[p]); maxX = Math.max(maxX, dx[p] + 1);
      minZ = Math.min(minZ, dz[p]); maxZ = Math.max(maxZ, dz[p] + 1);
    }
  }
  return { dx, dz, fx, fz, minX, maxX, minZ, maxZ };
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
  const { dx, dz, fx, fz, minX, maxX, minZ, maxZ } = buildOffsets(spec);
  // Only sample the halo the sun can reach; its daily arc never uses the
  // opposite side of the old square guard plate.
  const guardWidth = width + maxX - minX;
  const guardHeight = height + maxZ - minZ;
  const tileSpan = tileSamples * spacing;
  const worldX0 = originTileX * tileSpan;
  const worldZ0 = originTileZ * tileSpan;
  const heights = new Float32Array(guardWidth * guardHeight);

  for (let z = 0; z < guardHeight; z++) {
    const wz = worldZ0 + (z + minZ + 0.5) * spacing;
    const row = z * guardWidth;
    for (let x = 0; x < guardWidth; x++) {
      const wx = worldX0 + (x + minX + 0.5) * spacing;
      heights[row + x] = heightAt(wx, wz);
    }
  }

  // Distant peaks need long rays, but not the near field's dense height grid.
  // A world-aligned coarse plate shares all long-ray probes across this batch.
  // Precompute interpolation addresses per row/column so no height queries or
  // coordinate rounding happen in the horizon loop below.
  const farSteps = spec.farSteps || [];
  const inverseFarSteps = Float64Array.from(farSteps, (step) => 1 / step);
  let farHeights, farWidth, farX, farZ, farFX, farFZ;
  if (farSteps.length) {
    const farSpacing = spec.farSpacing;
    const offsets = buildOffsets({ ...spec, spacing: farSpacing, steps: farSteps });
    const x0 = Math.floor(worldX0 / farSpacing) + offsets.minX - 1;
    const z0 = Math.floor(worldZ0 / farSpacing) + offsets.minZ - 1;
    farWidth = Math.ceil((worldX0 + width * spacing) / farSpacing)
      - x0 + offsets.maxX + 1;
    const farHeight = Math.ceil((worldZ0 + height * spacing) / farSpacing)
      - z0 + offsets.maxZ + 1;
    farHeights = new Float32Array(farWidth * farHeight);
    for (let z = 0; z < farHeight; z++) {
      for (let x = 0; x < farWidth; x++) {
        farHeights[z * farWidth + x] = heightAt((x0 + x) * farSpacing,
          (z0 + z) * farSpacing);
      }
    }
    const rays = directions * farSteps.length;
    farX = new Int32Array(rays * width);
    farZ = new Int32Array(rays * height);
    farFX = new Float64Array(rays * width);
    farFZ = new Float64Array(rays * height);
    for (let ray = 0; ray < rays; ray++) {
      for (let x = 0; x < width; x++) {
        const u = (worldX0 + (x + 0.5) * spacing) / farSpacing - x0
          + offsets.dx[ray] + offsets.fx[ray];
        const i = ray * width + x;
        farX[i] = Math.floor(u);
        farFX[i] = u - farX[i];
      }
      for (let z = 0; z < height; z++) {
        const v = (worldZ0 + (z + 0.5) * spacing) / farSpacing - z0
          + offsets.dz[ray] + offsets.fz[ray];
        const i = ray * height + z;
        farZ[i] = Math.floor(v) * farWidth;
        farFZ[i] = v - Math.floor(v);
      }
    }
  }

  const ground = new Uint16Array(width * height);
  for (let z = 0; z < height; z++) {
    const wz = worldZ0 + (z + 0.5) * spacing;
    const src = (z - minZ) * guardWidth - minX;
    const dst = z * width;
    for (let x = 0; x < width; x++) {
      ground[dst + x] = toHalfFloat(heights[src + x] - gradeBase * wz);
    }
  }

  // Direction-major RG: horizon at the snow, then horizon `raise` metres up.
  const horizon = new Uint16Array(directions * width * height * 2);
  const stepCount = steps.length;
  const inverseSteps = Float64Array.from(steps, (step) => 1 / step);
  const offsets = Int32Array.from(dx, (x, i) => dz[i] * guardWidth + x);
  for (let direction = 0; direction < directions; direction++) {
    const directionBase = direction * width * height * 2;
    const offsetBase = direction * stepCount;
    for (let z = 0; z < height; z++) {
      const gz = z - minZ;
      for (let x = 0; x < width; x++) {
        const gx = x - minX;
        const point = gz * guardWidth + gx;
        const h = heights[point];
        let seen = -4;
        let seenRaised = -4;
        for (let k = 0; k < stepCount; k++) {
          // Bilinear samples stay on the actual ray. Rounding a short ray
          // to a 3 m lattice cell gave it the wrong bearing and slope, and
          // made adjacent sun bearings change shadow in visible steps.
          const ray = offsetBase + k;
          const p = point + offsets[ray];
          const a = heights[p] + (heights[p + 1] - heights[p]) * fx[ray];
          const b = heights[p + guardWidth]
            + (heights[p + guardWidth + 1] - heights[p + guardWidth]) * fx[ray];
          const rise = a + (b - a) * fz[ray] - h;
          const slope = rise * inverseSteps[k];
          const raisedSlope = (rise - raise) * inverseSteps[k];
          if (slope > seen) seen = slope;
          if (raisedSlope > seenRaised) seenRaised = raisedSlope;
        }
        for (let k = 0; k < farSteps.length; k++) {
          const ray = direction * farSteps.length + k;
          const ix = ray * width + x;
          const iz = ray * height + z;
          const p = farX[ix] + farZ[iz];
          const a = farHeights[p] + (farHeights[p + 1] - farHeights[p]) * farFX[ix];
          const b = farHeights[p + farWidth]
            + (farHeights[p + farWidth + 1] - farHeights[p + farWidth]) * farFX[ix];
          const rise = a + (b - a) * farFZ[iz] - h;
          const slope = rise * inverseFarSteps[k];
          const raisedSlope = (rise - raise) * inverseFarSteps[k];
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

/* Adjacent new rows/columns share their overlapping height halo. Preserve
   per-tile payloads so the main thread can still reject obsolete torus slots. */
export function buildShadowTiles(spec, tiles, heightAt) {
  const pending = new Map(tiles.map((tile) => [`${tile.x}:${tile.z}`, tile]));
  const results = [];
  while (pending.size) {
    const tile = pending.values().next().value;
    let tilesX = 1;
    while (pending.has(`${tile.x + tilesX}:${tile.z}`)) tilesX++;
    let tilesZ = 1;
    while (Array.from({ length: tilesX }, (_, x) =>
      pending.has(`${tile.x + x}:${tile.z + tilesZ}`)).every(Boolean)) tilesZ++;
    const region = buildShadowRegion({ ...spec,
      originTileX: tile.x, originTileZ: tile.z, tilesX, tilesZ,
    }, heightAt);
    const n = spec.tileSamples;
    for (let z = 0; z < tilesZ; z++) {
      for (let x = 0; x < tilesX; x++) {
        const key = `${tile.x + x}:${tile.z + z}`;
        const ground = new Uint16Array(n * n);
        const horizon = new Uint16Array(spec.directions * n * n * 2);
        for (let row = 0; row < n; row++) {
          const src = (z * n + row) * region.width + x * n;
          ground.set(region.ground.subarray(src, src + n), row * n);
          for (let d = 0; d < spec.directions; d++) {
            const start = (d * region.width * region.height + src) * 2;
            horizon.set(region.horizon.subarray(start, start + n * 2),
              (d * n * n + row * n) * 2);
          }
        }
        results.push({ tile: pending.get(key), horizon, ground });
        pending.delete(key);
      }
    }
  }
  return results;
}
