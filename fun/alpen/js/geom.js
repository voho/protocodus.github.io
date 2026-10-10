/* One draw call per creature.

   Everything alive or ridden in this game is a handful of primitives stuck
   together — a bear is six spheres and four cylinders — and left as a Group
   that is six or ten draw calls each, times seventeen animals. `compose`
   bakes the parts into a single geometry with the colours written into a
   vertex attribute, so a bear costs one call and a field of rabbits can be
   an InstancedMesh.

   The cost is that the parts can no longer move relative to each other. That
   turns out not to matter: at 240 pixels tall, a hop is a squash and a rear
   is a rotation, and neither needs a skeleton. */

/* Two attributes are optional because they are not free and most callers do
   not need them. `opts.uv` keeps each primitive's own unwrapping, which a
   baked figure needs the moment its material carries a map — without it
   three still compiles USE_MAP, reads a varying nothing wrote, and paints
   the whole animal in texel (0,0). `opts.sheen` writes `part.sheen` per
   vertex, which is what lets one merged mesh hold a matte glove and a
   mirrored goggle lens: the snow response reads `vN64Sheen`, so a per-part
   value in an attribute buys back exactly the thing merging took away.
   `opts.limb` writes `aLimb`, which leg a vertex swings with (see `sculpt`):
   a part's own `limb`, or the blended one a sculpted skin brings. */
export function compose(THREE, parts, opts = {}) {
  const wantUv = opts.uv === true;
  const wantSheen = opts.sheen === true;
  const wantLimb = opts.limb === true;
  const prepared = [];
  let total = 0;

  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();

    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot || [0, 0, 0]))),
      new THREE.Vector3(...(part.scale || [1, 1, 1])),
    );
    // applyMatrix4 carries the normals through the normal matrix, so a
    // squashed sphere is still lit as a squashed sphere
    g.applyMatrix4(m);

    const n = g.attributes.position.count;
    prepared.push({
      g,
      n,
      // A part with no colour of its own keeps the one its geometry carries
      // (a `sculpt` skin, blended across its joins)
      color: part.color === undefined ? null : new THREE.Color(part.color),
      sheen: part.sheen === undefined ? 1 : part.sheen,
      limb: part.limb,
    });
    total += n;
  }

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  const uv = wantUv ? new Float32Array(total * 2) : null;
  const sheen = wantSheen ? new Float32Array(total) : null;
  const limb = wantLimb ? new Float32Array(total * 4) : null;

  let o = 0;
  for (const { g, n, color: c, sheen: s, limb: l } of prepared) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (!c) color.set(g.attributes.color.array, o * 3);
    // A skin brings its blended limb weights; a rigid part is all its limb
    if (limb && g.attributes.aLimb) limb.set(g.attributes.aLimb.array, o * 4);
    else if (limb && l) {
      for (let i = 0; i < n; i++) limb.set([l[0], l[1], 1, l[2]], (o + i) * 4);
    }
    for (let i = 0; i < n; i++) {
      if (c) {
        color[(o + i) * 3] = c.r;
        color[(o + i) * 3 + 1] = c.g;
        color[(o + i) * 3 + 2] = c.b;
      }
      if (sheen) sheen[o + i] = s;
    }
    o += n;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (sheen) out.setAttribute('aSheen', new THREE.BufferAttribute(sheen, 1));
  if (limb) out.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4));
  out.computeBoundingSphere();
  return out;
}

/* A creature as one skin rather than as parts stuck together.

   `compose` gives one draw call but leaves every primitive its own closed
   shell, and close up that is exactly what shows: a crease wherever two
   meet, a haunch that is a disc laid on a flank, a neck of stacked beads.
   This reads a part list of ellipsoids (`radii`, optional `rot`) and
   tapered capsules (`pos` to `to`, radii `r`) as one distance field instead,
   joined by a smooth minimum over `k` metres, so a haunch swells out of the
   body the way a muscle does, and draws the surface that comes out with
   surface nets. Normals are the field's own gradient, so the shading is as
   round as the shape on however coarse a grid, and each vertex takes the
   colours of the parts it is near, blended across the same joins.

   A part marked `paint` is not shape at all: it colours whatever of the
   skin lies inside it, softened over its `k`, which is how a saddle or a
   pale throat is a marking rather than a lump. Anything thinner than about
   two cells (an ear, an eye) does not survive the grid and belongs in
   `compose` beside this. Built once per page. Indexed, with the same
   attributes as `compose`, whose part it can be.

   A part may name the leg it belongs to, `limb: [pivotY, pivotZ, phase]`,
   and the skin then carries `aLimb`: that pivot and phase, and how much of
   the vertex is that leg's, blended across the join exactly as the colour
   is, so a swinging thigh bends out of the flank rather than hinging off
   it. Parts of one leg share one array. */
export function sculpt(THREE, parts, { cell = 0.025, k = 0.04 } = {}) {
  const all = parts.map((p) => {
    const blend = p.k ?? k;
    if (p.to) {
      const [ax, ay, az] = p.pos;
      const dx = p.to[0] - ax;
      const dy = p.to[1] - ay;
      const dz = p.to[2] - az;
      const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const [r0, r1] = p.r;
      return {
        p, blend, reach: Math.max(r0, r1),
        cx: ax + dx * 0.5, cy: ay + dy * 0.5, cz: az + dz * 0.5,
        bound: Math.sqrt(len2) * 0.5 + Math.max(r0, r1),
        lo: [Math.min(ax, p.to[0]), Math.min(ay, p.to[1]), Math.min(az, p.to[2])],
        hi: [Math.max(ax, p.to[0]), Math.max(ay, p.to[1]), Math.max(az, p.to[2])],
        dist(x, y, z) {
          const ux = x - ax;
          const uy = y - ay;
          const uz = z - az;
          const t = Math.min(1, Math.max(0, (ux * dx + uy * dy + uz * dz) / len2));
          const qx = ux - dx * t;
          const qy = uy - dy * t;
          const qz = uz - dz * t;
          return Math.sqrt(qx * qx + qy * qy + qz * qz) - (r0 + (r1 - r0) * t);
        },
      };
    }
    const [cx, cy, cz] = p.pos;
    const [a, b, c] = p.radii;
    const e = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0])))
      .invert().elements;
    const reach = Math.max(a, b, c);
    return {
      p, blend, reach, cx, cy, cz, bound: reach,
      lo: [cx, cy, cz], hi: [cx, cy, cz],
      // The usual bound for an ellipsoid: exact on the surface, which is
      // the only place a smooth minimum and a mesher look closely
      dist(x, y, z) {
        const ux = x - cx;
        const uy = y - cy;
        const uz = z - cz;
        const lx = (e[0] * ux + e[4] * uy + e[8] * uz) / a;
        const ly = (e[1] * ux + e[5] * uy + e[9] * uz) / b;
        const lz = (e[2] * ux + e[6] * uy + e[10] * uz) / c;
        const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const mx = lx / a;
        const my = ly / b;
        const mz = lz / c;
        const k1 = Math.sqrt(mx * mx + my * my + mz * mz);
        return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
      },
    };
  });
  const shapes = all.filter((s) => !s.p.paint);
  const paints = all.filter((s) => s.p.paint);

  const field = (x, y, z) => {
    let d = shapes[0].dist(x, y, z);
    for (let i = 1; i < shapes.length; i++) {
      const s = shapes[i];
      const w = s.blend;
      // A part whose bounding sphere is a blend clear of the running
      // minimum cannot move it: skipping it is exact, and it is most of them
      const ox = x - s.cx;
      const oy = y - s.cy;
      const oz = z - s.cz;
      if (Math.sqrt(ox * ox + oy * oy + oz * oz) - s.bound >= d + w) continue;
      const e = s.dist(x, y, z);
      const h = Math.max(w - Math.abs(d - e), 0) / w;
      d = Math.min(d, e) - h * h * w * 0.25;
    }
    return d;
  };

  // The grid: every part's reach, and room for the blends and a border
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], s.lo[a] - s.reach - s.blend);
      hi[a] = Math.max(hi[a], s.hi[a] + s.reach + s.blend);
    }
  }
  const n = lo.map((l, a) => Math.ceil((hi[a] - l) / cell) + 3);
  for (let a = 0; a < 3; a++) lo[a] -= cell;
  const [nx, ny, nz] = n;
  const values = new Float32Array(nx * ny * nz);
  for (let kk = 0, i = 0; kk < nz; kk++) {
    for (let j = 0; j < ny; j++) {
      for (let ii = 0; ii < nx; ii++, i++) {
        values[i] = field(lo[0] + ii * cell, lo[1] + j * cell, lo[2] + kk * cell);
      }
    }
  }
  const at = (i, j, kk) => values[i + nx * (j + ny * kk)];

  // One vertex per cell the surface crosses, at the mean of its crossings
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  for (let kk = 0; kk < nz - 1; kk++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          corner[c] = at(i + (c & 1), j + ((c >> 1) & 1), kk + (c >> 2));
          if (corner[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let m = 0;
        for (let c = 0; c < 8; c++) {
          for (let bit = 1; bit < 8; bit <<= 1) {
            if (c & bit) continue;
            const v0 = corner[c];
            const v1 = corner[c | bit];
            if ((v0 < 0) === (v1 < 0)) continue;
            const t = v0 / (v0 - v1);
            sx += (c & 1) + (bit === 1 ? t : 0);
            sy += ((c >> 1) & 1) + (bit === 2 ? t : 0);
            sz += (c >> 2) + (bit === 4 ? t : 0);
            m++;
          }
        }
        cellIndex[i + (nx - 1) * (j + (ny - 1) * kk)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / m) * cell, lo[1] + (j + sy / m) * cell, lo[2] + (kk + sz / m) * cell);
      }
    }
  }

  // …then onto the surface itself, along the field's gradient
  const g = [0, 0, 0];
  const grad = (x, y, z) => {
    const h = cell * 0.25;
    g[0] = field(x + h, y, z) - field(x - h, y, z);
    g[1] = field(x, y + h, z) - field(x, y - h, z);
    g[2] = field(x, y, z + h) - field(x, y, z - h);
    const len = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= len; g[1] /= len; g[2] /= len;
    return g;
  };
  for (let v = 0; v < pos.length; v += 3) {
    for (let it = 0; it < 2; it++) {
      const d = field(pos[v], pos[v + 1], pos[v + 2]);
      const step = Math.max(-cell * 0.5, Math.min(cell * 0.5, d));
      grad(pos[v], pos[v + 1], pos[v + 2]);
      pos[v] -= g[0] * step;
      pos[v + 1] -= g[1] * step;
      pos[v + 2] -= g[2] * step;
    }
  }

  // A quad for every grid edge the surface crosses, wound to face outwards
  const index = [];
  const quad = (a, b, c, d, outX, outY, outZ) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3];
    const wy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const facing = (uy * wz - uz * wy) * outX + (uz * wx - ux * wz) * outY + (ux * wy - uy * wx) * outZ;
    if (facing >= 0) index.push(a, b, c, a, c, d);
    else index.push(a, c, b, a, d, c);
  };
  const ci = (i, j, kk) => cellIndex[i + (nx - 1) * (j + (ny - 1) * kk)];
  for (let kk = 1; kk < nz - 1; kk++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v = at(i, j, kk);
        // Outward is towards the end of the edge that is outside
        if ((v < 0) !== (at(i + 1, j, kk) < 0)) {
          quad(ci(i, j - 1, kk - 1), ci(i, j, kk - 1), ci(i, j, kk), ci(i, j - 1, kk), v < 0 ? 1 : -1, 0, 0);
        }
        if ((v < 0) !== (at(i, j + 1, kk) < 0)) {
          quad(ci(i - 1, j, kk - 1), ci(i, j, kk - 1), ci(i, j, kk), ci(i - 1, j, kk), 0, v < 0 ? 1 : -1, 0);
        }
        if ((v < 0) !== (at(i, j, kk + 1) < 0)) {
          quad(ci(i - 1, j - 1, kk), ci(i, j - 1, kk), ci(i, j, kk), ci(i - 1, j, kk), 0, 0, v < 0 ? 1 : -1);
        }
      }
    }
  }

  const count = pos.length / 3;
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const tint = shapes.map((s) => new THREE.Color(s.p.color));
  const pigment = paints.map((s) => new THREE.Color(s.p.color));
  const limbs = [...new Set(shapes.map((s) => s.p.limb).filter(Boolean))];
  const limbOf = shapes.map((s) => limbs.indexOf(s.p.limb));
  const limbWeight = new Float32Array(limbs.length);
  const limb = limbs.length ? new Float32Array(count * 4) : null;
  const d = new Float32Array(shapes.length);
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    grad(x, y, z);
    normal.set(g, v * 3);
    // Every part within its own blend of the nearest one has a say
    let near = Infinity;
    for (let s = 0; s < shapes.length; s++) {
      d[s] = shapes[s].dist(x, y, z);
      if (d[s] < near) near = d[s];
    }
    let r = 0;
    let gg = 0;
    let b = 0;
    let sum = 0;
    limbWeight.fill(0);
    for (let s = 0; s < shapes.length; s++) {
      const t = 1 - (d[s] - near) / shapes[s].blend;
      if (t <= 0) continue;
      const w = t * t;
      r += tint[s].r * w;
      gg += tint[s].g * w;
      b += tint[s].b * w;
      sum += w;
      if (limbOf[s] >= 0) limbWeight[limbOf[s]] += w;
    }
    if (limb) {
      let best = -1;
      for (let l = 0; l < limbs.length; l++) {
        if (limbWeight[l] > 0 && (best < 0 || limbWeight[l] > limbWeight[best])) best = l;
      }
      if (best >= 0) {
        const [py, pz, phase] = limbs[best];
        limb.set([py, pz, limbWeight[best] / sum, phase], v * 4);
      }
    }
    r /= sum;
    gg /= sum;
    b /= sum;
    for (let s = 0; s < paints.length; s++) {
      const a = Math.min(1, Math.max(0, 0.5 - paints[s].dist(x, y, z) / paints[s].blend));
      r += (pigment[s].r - r) * a;
      gg += (pigment[s].g - gg) * a;
      b += (pigment[s].b - b) * a;
    }
    color[v * 3] = r;
    color[v * 3 + 1] = gg;
    color[v * 3 + 2] = b;
  }

  /* The quad test above judges each quad by one of its two triangles, and
     where a crease twists a quad the other one can fold under: culled, it
     is a pinhole into the animal. Every triangle faces the way the field's
     own normals at its corners say. */
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3];
    const wy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const facing = (uy * wz - uz * wy) * (normal[a * 3] + normal[b * 3] + normal[c * 3])
      + (uz * wx - ux * wz) * (normal[a * 3 + 1] + normal[b * 3 + 1] + normal[c * 3 + 1])
      + (ux * wy - uy * wx) * (normal[a * 3 + 2] + normal[b * 3 + 2] + normal[c * 3 + 2]);
    if (facing < 0) {
      index[t + 1] = c;
      index[t + 2] = b;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (limb) out.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4));
  out.setIndex(index);
  out.computeBoundingSphere();
  return out;
}

/* Draw what is shared once.

   `compose` and the card builders write three vertices a triangle, and most
   of them are copies: a weathered stone is eighty faces on forty-two
   corners, a sprig card two triangles on four. A draw without an index runs
   the vertex shader for every copy — the post-transform cache only works
   through an index — so a dwarf pine was shading 4608 vertices to draw 852,
   a forest card twice what it needed, every instance, every frame, and
   again in the shadow pass.

   This merges the vertices whose every attribute is bit-identical and draws
   the same triangles through an index: the same values in the same order,
   so the picture cannot change. In place, so whatever else holds the
   geometry sees the same object; per-instance attributes are not vertices
   and are left alone, and anything this does not expect — an index already,
   groups, morphs, packed or interleaved data, or nothing yet at all (a pool
   waiting on its scan) — is returned untouched. Call it last, once every
   per-vertex attribute is on. */
export function weld(THREE, geometry) {
  if (!geometry.attributes.position || geometry.index || geometry.groups.length
    || Object.keys(geometry.morphAttributes).length) return geometry;
  const names = Object.keys(geometry.attributes)
    .filter((name) => !geometry.attributes[name].isInstancedBufferAttribute);
  const attrs = names.map((name) => geometry.attributes[name]);
  if (attrs.some((a) => a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array))) {
    return geometry;
  }
  const count = geometry.attributes.position.count;
  const sizes = attrs.map((a) => a.itemSize);
  const bits = attrs.map((a) => new Uint32Array(a.array.buffer, a.array.byteOffset, count * a.itemSize));
  const same = (i, j) => {
    for (let k = 0; k < bits.length; k++) {
      const w = bits[k];
      const s = sizes[k];
      for (let c = 0; c < s; c++) if (w[i * s + c] !== w[j * s + c]) return false;
    }
    return true;
  };
  const remap = new Uint32Array(count);
  const keep = [];
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    let h = 2166136261;
    for (let k = 0; k < bits.length; k++) {
      const w = bits[k];
      const s = sizes[k];
      for (let c = 0; c < s; c++) h = Math.imul(h ^ w[i * s + c], 16777619);
    }
    let bucket = buckets.get(h);
    let v = -1;
    if (bucket) {
      for (const j of bucket) if (same(keep[j], i)) { v = j; break; }
    } else {
      bucket = [];
      buckets.set(h, bucket);
    }
    if (v < 0) {
      v = keep.length;
      keep.push(i);
      bucket.push(v);
    }
    remap[i] = v;
  }
  if (keep.length === count) return geometry;
  for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k];
    const s = sizes[k];
    const out = new Float32Array(keep.length * s);
    for (let v = 0; v < keep.length; v++) {
      for (let c = 0; c < s; c++) out[v * s + c] = a.array[keep[v] * s + c];
    }
    geometry.setAttribute(names[k], new THREE.BufferAttribute(out, s, a.normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(
    keep.length > 65535 ? remap : Uint16Array.from(remap), 1));
  return geometry;
}
