// Compact, homologation-style rally hatchback. All dimensions are in metres,
// +Z is forward, and the wheel contact patch rests at Y=0. Static detail is
// merged by material; the four wheels keep independent steering/spin pivots.
const kits = new WeakMap();
const COLOURS = ['#dfab35', '#b74d38', '#4e8f98', '#849177', '#d8dbd1', '#636e98'];

function makeTexture(THREE, width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeKit(THREE, geometry, keepTexture) {
  const bins = new Map();
  const matrix = new THREE.Matrix4();
  const transform = new THREE.Object3D();
  // Baking transforms and colours into one buffer per material avoids hundreds
  // of individual grille, seam, spoke and trim draw calls in a six-car race.
  function add(bin, source, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], tint = null, uv = null) {
    transform.position.set(...position); transform.scale.set(...scale);
    transform.rotation.set(...rotation); transform.updateMatrix(); matrix.copy(transform.matrix);
    const baked = source.index ? source.toNonIndexed() : source.clone();
    baked.applyMatrix4(matrix);
    const p = baked.attributes.position, n = baked.attributes.normal, tex = baked.attributes.uv;
    let bucket = bins.get(bin);
    if (!bucket) { bucket = { positions: [], normals: [], uvs: [], colors: [] }; bins.set(bin, bucket); }
    const color = tint ? new THREE.Color(tint) : null;
    for (let i = 0; i < p.count; i++) {
      bucket.positions.push(p.getX(i), p.getY(i), p.getZ(i));
      bucket.normals.push(n.getX(i), n.getY(i), n.getZ(i));
      const mapped = uv ? uv(p.getX(i), p.getY(i), p.getZ(i), tex?.getX(i) || 0, tex?.getY(i) || 0) : [tex?.getX(i) || 0, tex?.getY(i) || 0];
      bucket.uvs.push(mapped[0], mapped[1]);
      if (color) bucket.colors.push(color.r, color.g, color.b);
    }
    baked.dispose(); source.dispose();
  }
  function box(bin, position, size, rotation = [0, 0, 0], tint = null, uv = null) {
    add(bin, new THREE.BoxGeometry(1, 1, 1), position, size, rotation, tint, uv);
  }
  function panel(bin, vertices, uvRect = null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const [u0, v0, u1, v1] = uvRect || [0, 0, 1, 1];
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
    g.computeVertexNormals(); add(bin, g);
  }
  function rod(bin, a, b, radius, tint = null, uv = null) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), axis = end.clone().sub(start);
    const g = new THREE.CylinderGeometry(radius, radius, axis.length(), 8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    add(bin, g, start.add(end).multiplyScalar(.5).toArray(), [1, 1, 1], [0, 0, 0], tint, uv);
  }
  const paintUV = (x, y, z) => [(z + 2) / 4, Math.max(.03, Math.min(.96, (y - .28) / 1.3))];
  const cleanUV = () => [.52, .85];
  function bodyPanel(vertices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    add('paint', g, [0, 0, 0], [1, 1, 1], [0, 0, 0], null, paintUV);
  }
  // Bonnet, shoulder and rear deck have a crown and bevel instead of a box top.
  const stations = [[-1.95, .77, .79], [-1.78, .86, .92], [-1.35, .9, .995], [-.65, .9, 1.025], [.65, .89, 1.015], [1.38, .86, .96], [1.82, .8, .85], [1.96, .72, .74]];
  const cross = [[-1, -.055], [-.91, .005], [-.69, .034], [0, .044], [.69, .034], [.91, .005], [1, -.055]];
  for (let s = 0; s < stations.length - 1; s++) for (let j = 0; j < cross.length - 1; j++) {
    const a = stations[s], b = stations[s + 1];
    bodyPanel([[cross[j][0] * a[1], a[2] + cross[j][1], a[0]], [cross[j][0] * b[1], b[2] + cross[j][1], b[0]], [cross[j + 1][0] * b[1], b[2] + cross[j + 1][1], b[0]], [cross[j + 1][0] * a[1], a[2] + cross[j + 1][1], a[0]]]);
  }
  for (const side of [-1, 1]) {
    // An open silhouette cuts actual wheel arches out of the side panels.
    const outline = [[-1.95, .40], [-1.95, .79], [-1.78, .92], [-1.35, .995], [-.65, 1.025], [.65, 1.015], [1.38, .96], [1.82, .85], [1.96, .74], [1.93, .37]];
    for (const axle of [1.22, -1.24]) {
      outline.push([axle + .435, .37]);
      for (let i = 0; i <= 24; i++) { const t = i / 24 * Math.PI; outline.push([axle + Math.cos(t) * .435, .37 + Math.sin(t) * .435]); }
    }
    outline.push([-1.95, .40]);
    const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(side * -z, y)));
    const skin = new THREE.ExtrudeGeometry(shape, { depth: .04, steps: 1, bevelEnabled: true, bevelSegments: 2, bevelSize: .014, bevelThickness: .014, curveSegments: 12 });
    skin.rotateY(side * Math.PI / 2); skin.translate(side * .866, 0, 0);
    add('paint', skin, [0, 0, 0], [1, 1, 1], [0, 0, 0], null, paintUV);
    // Raised flares follow the tyre opening and taper into the lower sill.
    for (const axle of [-1.24, 1.22]) {
      const ring = [], triangles = [];
      for (let i = 0; i <= 32; i++) {
        const t = Math.PI * i / 32;
        for (const [x, r] of [[.884, .432], [.974, .429], [.981, .458], [.89, .491]]) ring.push(side * x, .37 + Math.sin(t) * r, axle + Math.cos(t) * r);
        if (i < 32) for (let f = 0; f < 3; f++) { const k = i * 4 + f; if (side > 0) triangles.push(k, k + 4, k + 1, k + 1, k + 4, k + 5); else triangles.push(k, k + 1, k + 4, k + 1, k + 5, k + 4); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3)); g.setIndex(triangles); g.computeVertexNormals();
      add('paint', g, [0, 0, 0], [1, 1, 1], [0, 0, 0], null, paintUV);
      box('trim', [side * .858, .285, axle - .40], [.275, .37, .042]); // Flexible mudflaps.
    }
    box('trim', [side * .887, .405, -.015], [.055, .12, 1.47]);
    box('paint', [side * .914, .468, -.015], [.075, .075, 1.48], [0, 0, 0], null, paintUV);
  }
  box('trim', [0, .395, 0], [1.63, .12, 3.78]);
  // Sloped cabin: black glazing remains inside distinct A/B/C pillars.
  const roofFront = .23, roofRear = -.70, roofY = 1.465, roofHalf = .665;
  panel('glass', [[-.797, 1.042, .739], [.797, 1.042, .739], [roofHalf, roofY, roofFront], [-roofHalf, roofY, roofFront]]);
  panel('glass', [[.786, 1.045, -1.369], [-.786, 1.045, -1.369], [-roofHalf, roofY, roofRear], [roofHalf, roofY, roofRear]]);
  for (const side of [-1, 1]) {
    const lower = side * .825, upper = side * .669;
    const front = [[lower, 1.047, -.115], [lower, 1.047, .648], [upper, 1.434, .205], [upper, 1.434, -.115]];
    const rear = [[lower, 1.047, -1.235], [lower, 1.047, -.185], [upper, 1.434, -.185], [upper, 1.434, -.685]];
    panel('glass', side > 0 ? front : front.toReversed());
    panel('glass', side > 0 ? rear : rear.toReversed());
    rod('paint', [side * .834, 1.03, .731], [side * .682, 1.456, .239], .042, null, cleanUV);
    rod('paint', [side * .834, 1.03, -1.37], [side * .682, 1.456, -.727], .065, null, cleanUV);
    rod('trim', [side * .837, 1.037, -.15], [side * .684, 1.455, -.15], .04);
    rod('trim', [side * .829, 1.04, -.80], [side * .683, 1.44, -.45], .015);
    rod('trim', [side * .839, 1.043, -1.35], [side * .839, 1.043, .73], .022);
    // Door gaps, handles and a compact door-mounted mirror.
    for (const seamZ of [.73, -.19, -1.02]) rod('trim', [side * .907, .56, seamZ], [side * .908, .978, seamZ], .006);
    box('trim', [side * .916, .945, -.027], [.016, .028, .16]);
    box('trim', [side * .914, .938, -.93], [.016, .025, .125]);
    rod('trim', [side * .828, 1.08, .58], [side * .96, 1.097, .50], .022);
    const mirror = new THREE.SphereGeometry(1, 12, 8);
    add('paint', mirror, [side * .994, 1.112, .486], [.117, .058, .102], [0, 0, 0], null, cleanUV);
    box('metal', [side * .993, 1.115, .4], [.155, .071, .008], [0, side * -.14, 0]);
    // Door numberboards, narrow sill stripe and quarter-panel sponsor marking.
    const x = side * .931;
    const number = [[x, .628, -.555], [x, .628, .05], [x, .979, .05], [x, .979, -.555]];
    panel('livery', number, side > 0 ? [0, .53, .58, .98] : [.58, .53, 0, .98]);
    const stripe = [[x, .529, -.76], [x, .529, .71], [x, .584, .71], [x, .584, -.76]];
    panel('livery', side > 0 ? stripe : stripe.toReversed(), [.76, .74, .92, .82]);
  }
  const roofRows = [[-.755, .625, 1.45], [-.68, .666, 1.49], [.20, .666, 1.49], [.28, .625, 1.447]];
  for (let i = 0; i < roofRows.length - 1; i++) {
    const a = roofRows[i], b = roofRows[i + 1];
    bodyPanel([[-a[1], a[2], a[0]], [-b[1], b[2], b[0]], [b[1], b[2], b[0]], [a[1], a[2], a[0]]]);
  }
  // The roof and bonnet stripe carries a crisp team wordmark, and keeps the
  // colour visible in peripheral vision without covering the entire car.
  panel('livery', [[-.14, 1.499, -.67], [-.14, 1.499, .19], [.14, 1.499, .19], [.14, 1.499, -.67]], [.76, .64, .91, .85]);
  const bonnetStripe = [[.68, 1.061], [1.38, 1.009], [1.78, .909]];
  for (let i = 0; i < bonnetStripe.length - 1; i++) {
    const a = bonnetStripe[i], b = bonnetStripe[i + 1];
    panel('livery', [[-.17, a[1], a[0]], [-.17, b[1], b[0]], [.17, b[1], b[0]], [.17, a[1], a[0]]], [.60, .02 + i * .225, .99, .245 + i * .225]);
  }
  // Roof air scoop, rear aero lip and a fine flexible antenna.
  box('paint', [0, 1.526, -.015], [.28, .073, .37], [0, 0, 0], null, cleanUV);
  box('trim', [0, 1.524, .173], [.222, .044, .009]);
  rod('trim', [.24, 1.491, -.57], [.26, 1.858, -.73], .008);
  box('paint', [0, 1.474, -.862], [1.54, .064, .22], [-.08, 0, 0], null, cleanUV);
  for (const side of [-1, 1]) box('trim', [side * .605, 1.417, -.80], [.039, .11, .10], [-.30, 0, 0]);
  // Visible roll cage and bucket seats behind reflective, slightly translucent
  // windows. These details share the existing trim and alloy batches.
  for (const side of [-1, 1]) {
    box('trim', [side * .37, .908, -.12], [.43, .35, .37], [-.12, 0, 0]);
    box('trim', [side * .37, 1.125, -.265], [.40, .35, .11], [-.16, 0, 0]);
    box('trim', [side * .37, 1.32, -.295], [.24, .135, .095]);
    rod('metal', [side * .63, .75, -.50], [side * .58, 1.37, -.50], .018);
    rod('metal', [side * .58, 1.37, -.50], [side * .57, .71, -1.23], .018);
  }
  rod('metal', [-.58, 1.37, -.50], [.58, 1.37, -.50], .018);
  rod('metal', [-.56, .78, -1.20], [.56, 1.36, -.52], .016);
  rod('metal', [.56, .78, -1.20], [-.56, 1.36, -.52], .016);
  box('trim', [0, 1.0, .46], [1.39, .17, .35]);
  const steering = new THREE.TorusGeometry(.112, .012, 6, 20);
  add('trim', steering, [-.37, 1.08, .305], [1, 1, 1], [-.38, 0, 0]);
  // Moulded bumpers with a recessed radiator, intercooler, towing eye and lamps.
  box('paint', [0, .57, 1.916], [1.67, .30, .115], [0, 0, 0], null, paintUV);
  box('trim', [0, .423, 1.95], [1.73, .063, .12]);
  box('trim', [0, .633, 1.981], [.91, .185, .016]);
  box('metal', [0, .611, 1.991], [.61, .085, .005]);
  for (let i = 0; i < 6; i++) box('trim', [0, .576 + i * .018, 1.999], [.69, .006, .006]);
  for (let i = -5; i <= 5; i++) box('trim', [i * .063, .615, 2.001], [.006, .087, .005]);
  box('trim', [0, .849, 1.888], [.77, .098, .12], [-.15, 0, 0]);
  for (const side of [-1, 1]) {
    box('trim', [side * .62, .814, 1.868], [.45, .176, .125], [0, side * -.1, 0]);
    box('lamps', [side * .62, .819, 1.936], [.366, .118, .026], [0, side * -.1, 0]);
    for (let line = -2; line <= 2; line++) box('trim', [side * .62 + line * .064, .819, 1.955], [.007, .10, .006]);
    box('trim', [side * .646, .60, 1.981], [.20, .105, .025]);
    box('lamps', [side * .646, .60, 1.998], [.097, .071, .008]);
    box('trim', [side * .65, .564, -1.921], [.37, .18, .139]);
    box('brake', [side * .698, .861, -1.872], [.294, .108, .089], [0, side * .08, 0]);
    box('lamps', [side * .607, .845, -1.922], [.059, .039, .009]);
    box('trim', [side * .68, .776, -1.909], [.323, .014, .026]);
    // Bonnet catches, wiper arms and narrow heat-extraction louvers.
    box('metal', [side * .64, .922, 1.49], [.055, .012, .049], [.15, 0, 0]);
    rod('trim', [side * .63, 1.085, .694], [side * .25, 1.227, .525], .008);
    for (let i = 0; i < 4; i++) box('trim', [side * .42, 1.04 - i * .006, .84 + i * .064], [.225, .008, .024], [.095, 0, 0]);
  }
  box('paint', [0, .626, -1.924], [1.64, .29, .103], [0, 0, 0], null, paintUV);
  box('trim', [0, .439, -1.95], [1.69, .076, .092]);
  box('trim', [0, .719, -1.983], [.474, .147, .016]);
  panel('livery', [[.203, .67, -1.995], [-.203, .67, -1.995], [-.203, .759, -1.995], [.203, .759, -1.995]], [.02, .06, .55, .23]);
  box('brake', [0, 1.42, -.827], [.235, .028, .023]);
  rod('trim', [.52, 1.126, -1.257], [.02, 1.242, -1.067], .008);
  const exhaust = new THREE.CylinderGeometry(.053, .059, .23, 16, 1, true); exhaust.rotateX(Math.PI / 2);
  add('metal', exhaust, [-.53, .381, -1.91]);
  const exhaustHole = new THREE.CircleGeometry(.048, 16); exhaustHole.rotateY(Math.PI);
  add('trim', exhaustHole, [-.53, .381, -2.029]);
  const tow = new THREE.TorusGeometry(.045, .012, 6, 14);
  add('brake', tow, [.47, .528, 2.01]);
  // Wheel components are combined into one vertex-coloured mesh. Geometry is
  // rotated onto X before instancing, so animation about local X is true roll.
  const wheelUV = (_x, _y, _z, u, v) => [u, .52 + v * .47];
  const alloyUV = () => [.08, .10];
  const profile = [[.220, -.14], [.303, -.143], [.344, -.130], [.362, -.099], [.367, -.06], [.367, .06], [.362, .099], [.344, .130], [.303, .143], [.220, .14]];
  const rubber = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 32);
  rubber.rotateZ(Math.PI / 2);
  add('wheel', rubber, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#737779', wheelUV);
  const disk = new THREE.CylinderGeometry(.203, .203, .244, 32); disk.rotateZ(Math.PI / 2);
  add('wheel', disk, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#54534f', alloyUV);
  for (const side of [-1, 1]) {
    const lip = new THREE.TorusGeometry(.22, .012, 6, 32); lip.rotateY(Math.PI / 2);
    add('wheel', lip, [side * .148, 0, 0], [1, 1, 1], [0, 0, 0], '#c4c7c5', alloyUV);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      box('wheel', [side * .15, Math.cos(a) * .136, Math.sin(a) * .136], [.024, .175, .028], [a, 0, 0], '#d0d2ce', alloyUV);
    }
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5, bolt = new THREE.CylinderGeometry(.011, .011, .012, 6); bolt.rotateZ(Math.PI / 2);
      add('wheel', bolt, [side * .17, Math.cos(a) * .045, Math.sin(a) * .045], [1, 1, 1], [0, 0, 0], '#555b5c', alloyUV);
    }
  }
  const hub = new THREE.CylinderGeometry(.064, .064, .323, 16); hub.rotateZ(Math.PI / 2);
  add('wheel', hub, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#919997', alloyUV);
  const assembled = {};
  for (const [name, batch] of bins) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
    if (batch.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    g.computeBoundingSphere(); assembled[name] = geometry(g);
  }
  let randomSeed = 51729;
  const random = () => { randomSeed = Math.imul(1664525, randomSeed) + 1013904223 | 0; return (randomSeed >>> 0) / 4294967296; };
  const weather = keepTexture(makeTexture(THREE, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, w, h);
    const dust = ctx.createLinearGradient(0, h * .59, 0, h);
    dust.addColorStop(0, 'rgba(119,106,82,0)'); dust.addColorStop(1, 'rgba(105,89,65,.38)');
    ctx.fillStyle = dust; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3800; i++) {
      const y = h * (.55 + Math.sqrt(random()) * .45), r = random() * 2.4;
      ctx.fillStyle = `rgba(96,81,60,${random() * .14})`; ctx.fillRect(random() * w, y, r, r * .64);
    }
    ctx.strokeStyle = 'rgba(80,75,67,.08)'; ctx.lineWidth = .5;
    for (let i = 0; i < 33; i++) { const x = random() * w, y = h * (.65 + random() * .35); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 + random() * 19, y + random() * 2); ctx.stroke(); }
  }));
  const wheelMap = keepTexture(makeTexture(THREE, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#42474a'; ctx.fillRect(0, 0, w, h / 2);
    for (let i = 0; i < 48; i++) {
      const x = i * w / 48;
      ctx.strokeStyle = '#202629'; ctx.lineWidth = 2.5;
      for (let row = 0; row < 5; row++) { const y = 32 + row * 38; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 17); ctx.lineTo(x + 2, y + 30); ctx.stroke(); }
    }
    ctx.strokeStyle = '#6c7172'; ctx.lineWidth = 2;
    for (const y of [12, 24, 231, 241]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }));
  return { geometries: assembled, weather, wheelMap };
}

export function createRallyCar(THREE, { index = 0, geometry, material, keepTexture }) {
  let kit = kits.get(geometry);
  if (!kit) { kit = makeKit(THREE, geometry, keepTexture); kits.set(geometry, kit); }
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  root.name = `rally-car-${index + 1}`;
  const paint = material(COLOURS[index % COLOURS.length], { map: kit.weather, roughness: .35, metalness: .26 });
  const brakeMaterial = material('#a32117', { emissive: '#ee2416', emissiveIntensity: .24, roughness: .28 });
  const liveryMap = keepTexture(makeTexture(THREE, 1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#e8e6d9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#17201f'; ctx.fillRect(18, 25, 563, 82);
    ctx.fillStyle = '#e9e8db'; ctx.font = 'bold 41px Arial'; ctx.textAlign = 'center'; ctx.fillText('RAZER  /  WORKS', 299, 82);
    ctx.fillStyle = '#17201f'; ctx.font = 'bold 290px Arial'; ctx.fillText(String(index + 7).padStart(2, '0'), 300, 389);
    ctx.font = 'bold 27px Arial'; ctx.fillText('RALLY SPORT', 300, 449);
    ctx.fillStyle = '#262c2b'; ctx.fillRect(18, 785, 550, 163);
    ctx.fillStyle = '#dadbcb'; ctx.font = 'bold 84px monospace'; ctx.fillText(`RZ ${String(index + 7).padStart(3, '0')}`, 293, 896);
    ctx.save(); ctx.translate(811, 780); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#27302e'; ctx.font = 'bold 55px Arial'; ctx.fillText('RAZER', 0, 0); ctx.restore();
    ctx.fillStyle = 'rgba(117,93,67,.15)';
    for (let i = 0; i < 70; i++) { const x = (i * 127.7) % 570, y = 440 + (i * 29.1) % 25; ctx.fillRect(x, y, 2 + i % 4, 1 + i % 3); }
  }));
  const surface = {
    paint,
    trim: material('#171b1c', { roughness: .85 }),
    glass: material('#29414a', { metalness: .48, roughness: .17, transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide }),
    metal: material('#adb4b2', { metalness: .73, roughness: .37 }),
    livery: material('#ffffff', { map: liveryMap, roughness: .48, metalness: .05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    lamps: material('#ede9ce', { emissive: '#fff3cd', emissiveIntensity: 0, roughness: .22, metalness: .12 }),
    brake: brakeMaterial,
  };
  for (const [name, g] of Object.entries(kit.geometries)) {
    if (name === 'wheel') continue;
    const part = new THREE.Mesh(g, surface[name]); part.name = `car-${name}`;
    part.castShadow = false; part.receiveShadow = true; body.add(part);
  }
  // A single shared wheel material and four meshes keep the finished vehicle at
  // eleven draw calls. tire/rim aliases preserve the renderer's spin interface.
  const wheelMaterial = material('#ffffff', { map: kit.wheelMap, vertexColors: true, roughness: .71, metalness: .23 });
  const wheels = [];
  for (const side of [-1, 1]) for (const front of [false, true]) {
    const pivot = new THREE.Group(); pivot.position.set(side * .839, .367, front ? 1.22 : -1.24); root.add(pivot);
    const tire = new THREE.Mesh(kit.geometries.wheel, wheelMaterial);
    tire.name = `wheel-${front ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}`;
    tire.receiveShadow = true; pivot.add(tire);
    wheels.push({ pivot, tire, rim: tire, front, radius: .367 });
  }
  return { root, body, wheels, paint, brakeMaterial };
}
