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

export function compose(THREE, parts) {
  const prepared = [];
  let total = 0;

  for (const part of parts) {
    let g = part.geo.clone();
    if (g.index) g = g.toNonIndexed();

    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot || [0, 0, 0]))),
      new THREE.Vector3(...(part.scale || [1, 1, 1])),
    );
    // applyMatrix4 carries the normals through the normal matrix, so a
    // squashed sphere is still lit as a squashed sphere
    g.applyMatrix4(m);

    const n = g.attributes.position.count;
    prepared.push({ g, n, color: new THREE.Color(part.color) });
    total += n;
  }

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);

  let o = 0;
  for (const { g, n, color: c } of prepared) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) {
      color[(o + i) * 3] = c.r;
      color[(o + i) * 3 + 1] = c.g;
      color[(o + i) * 3 + 2] = c.b;
    }
    o += n;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.computeBoundingSphere();
  return out;
}
