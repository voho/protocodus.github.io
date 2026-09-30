/* The sky the forest takes away from the snow under it.

   Snow under a spruce is darker than the snow in the open, and not because
   of the sun. A crown hides a large part of the sky from the ground beneath
   it, and on snow the sky is most of the light: the hemisphere fill, and in
   cloud, at dusk and at night the whole of it. The depth map already lays
   each tree's sun shadow down the slope, but it only exists while there is a
   sun to cast one — it fades out in a storm, at dusk and under the moon (see
   `shadowTarget` in sky.js) — and in all three the forest stood on perfectly
   even snow, lit exactly like the open piste beside it. A wood with nothing
   under it reads as trees pasted onto a white page, and it is most of the
   day that the sun is not doing the work.

   This is the occlusion as a field on the ground. Every crown near the rider
   is splatted, once, into a small world-anchored grid — a soft disc a little
   wider than the crown, deepest at the trunk, combined so that a thicket is
   darker than one tree without ever going black — and the snow reads it with
   one filtered fetch. The grid is a window: whole texels on a fixed one-metre
   world lattice, led ahead of the rider along the camera heading the same way
   the shadow box is, and redrawn only when the rider has moved far enough or
   the forest has streamed. Because the lattice is fixed to the world and each
   texel is a pure function of the trees around it, a redraw writes the same
   value into every texel the old window also covered: nothing slides, nothing
   pops, and only the window's edges — which are faded, and a long way off —
   ever change.

   The field multiplies indirect light always, and direct light only in
   proportion to how far the sun's own shadows have faded. With the depth map
   at full strength the sun is already correctly blocked, and taking it again
   here would double the shadow under every tree; with the depth map gone, the
   diffuse key light that stands in for an overcast or moonlit sky is exactly
   the light a crown intercepts. */

// One metre a texel, 256 of them: a quarter of a kilometre, which is further
// than any tree stays readable against the snow before the haze takes it.
const SIZE = 256;
const TEXEL = 1;
const SPAN = SIZE * TEXEL;
// How far ahead of the rider the window's middle sits along the camera
// heading: half the field lies ahead of that, so coverage runs from sixty
// metres behind the rider to nearly two hundred ahead.
const LEAD = 64;
// Redraw when the window's snapped centre has moved this far, or the forest
// changed under it. A few times a second at full speed; a 64 KiB upload.
const REDRAW = 12;
// The share of the sky a crown hides at its trunk. Measured hemispherical
// photographs under isolated alpine conifers sit around half.
const DEPTH = 0.5;
// How much wider than the crown the dimmed ring reaches. The sky a crown
// hides is not only the sky straight overhead.
const REACH = 1.45;

export function createCanopy(THREE, shading) {
  const data = new Uint8Array(SIZE * SIZE);
  const field = new Float32Array(SIZE * SIZE);
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat,
    THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const u = shading.uniforms;
  u.uCanopyMap.value = texture;
  // x, y: world X/Z of the window's corner; z: 1 / span; w: how much of the
  // direct light the field may take (see the note above).
  const win = u.uCanopyWin.value;

  let originX = NaN;
  let originZ = NaN;
  let seenCount = -1;
  let seenFirst = null;
  let seenLast = null;

  /* Splat every crown whose disc touches the window. Occlusion from several
     crowns combines as the product of what each lets through, so two trees
     side by side are darker than one and a thicket saturates towards the
     depth of the thickest canopy rather than towards black. */
  function draw(solids, ox, oz) {
    field.fill(1);
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const crown = s.canopy;
      if (!crown) continue;
      const reach = crown * REACH;
      const cx = (s.x - ox) / TEXEL;
      const cz = (s.z - oz) / TEXEL;
      const rt = reach / TEXEL;
      if (cx + rt < 0 || cz + rt < 0 || cx - rt >= SIZE || cz - rt >= SIZE) continue;
      const x0 = Math.max(0, Math.floor(cx - rt));
      const x1 = Math.min(SIZE - 1, Math.ceil(cx + rt));
      const z0 = Math.max(0, Math.floor(cz - rt));
      const z1 = Math.min(SIZE - 1, Math.ceil(cz + rt));
      const depth = DEPTH * (s.canopyDensity === undefined ? 1 : s.canopyDensity);
      const inv = 1 / (rt * rt);
      for (let z = z0; z <= z1; z++) {
        const dz = z + 0.5 - cz;
        const row = z * SIZE;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const q = 1 - (dx * dx + dz * dz) * inv;
          if (q <= 0) continue;
          field[row + x] *= 1 - depth * q * q;
        }
      }
    }
    for (let i = 0; i < field.length; i++) {
      data[i] = Math.round((1 - field[i]) * 255);
    }
    texture.needsUpdate = true;
  }

  /* Once a frame. `forward` is the camera's heading; `shadowLevel` is how
     much of the sun's depth map is currently in force. */
  function update(solids, riderPos, forward, shadowLevel) {
    let cx = riderPos.x;
    let cz = riderPos.z;
    const heading = Math.hypot(forward.x, forward.z);
    if (heading > 0.2) {
      cx += (forward.x / heading) * LEAD;
      cz += (forward.z / heading) * LEAD;
    }
    // The corner, on the world's own one-metre lattice.
    const ox = Math.floor((cx - SPAN / 2) / TEXEL) * TEXEL;
    const oz = Math.floor((cz - SPAN / 2) / TEXEL) * TEXEL;
    /* The forest streams in forty-metre bands and a band swap replaces the
       tail of the list, so its length and its two ends are enough to notice
       that it changed without walking it. */
    const n = solids.length;
    const first = n ? solids[0] : null;
    const lastSolid = n ? solids[n - 1] : null;
    const moved = !(Math.abs(ox - originX) < REDRAW && Math.abs(oz - originZ) < REDRAW);
    if (moved || n !== seenCount || first !== seenFirst || lastSolid !== seenLast) {
      originX = ox;
      originZ = oz;
      seenCount = n;
      seenFirst = first;
      seenLast = lastSolid;
      draw(solids, ox, oz);
      win.x = ox;
      win.y = oz;
      win.z = 1 / SPAN;
    }
    win.w = 1 - Math.max(0, Math.min(1, shadowLevel));
  }

  function reset() {
    originX = NaN;
    originZ = NaN;
    seenCount = -1;
  }

  return {
    update, reset, texture,
    // For the checks: the stored occlusion at a world position, 0..1.
    sample(x, z) {
      const tx = Math.floor((x - originX) / TEXEL);
      const tz = Math.floor((z - originZ) / TEXEL);
      if (tx < 0 || tz < 0 || tx >= SIZE || tz >= SIZE) return 0;
      return data[tz * SIZE + tx] / 255;
    },
    get origin() { return [originX, originZ]; },
  };
}

export const CANOPY = { SIZE, TEXEL, SPAN, LEAD, REDRAW, DEPTH, REACH };
