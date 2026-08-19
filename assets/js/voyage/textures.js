/* Every texture in the voyage is painted here, into canvases, at load time.
   Nothing is fetched: the site's no-third-party-requests rule holds in orbit
   too, and a procedural map can be exactly the resolution the object needs. */

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/* A soft radial dot — the workhorse behind every glow, star and window. */
export function glowTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]) {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

/* A dot with a four-point flare, for the brightest stars and the sun. */
export function flareTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const m = size / 2;
  let grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  [[size, 2.2], [size * 0.7, 1.2]].forEach(([len, w], i) => {
    g.save();
    g.translate(m, m);
    if (i) g.rotate(Math.PI / 4);
    for (const rot of [0, Math.PI / 2]) {
      g.save();
      g.rotate(rot);
      const lg = g.createLinearGradient(-len / 2, 0, len / 2, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(-len / 2, -w / 2, len, w);
      g.restore();
    }
    g.restore();
  });
  return toTexture(c);
}

/* A nebula puff: several blurred blobs jittered about the centre, so no two
   sprites built from it read as the same cloud once tinted and rotated. */
export function puffTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const m = size / 2;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.26;
    const x = m + Math.cos(a) * r;
    const y = m + Math.sin(a) * r * 0.7;
    const rad = size * (0.08 + Math.random() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // Fade the whole puff to nothing at the sprite's edge, or rotated copies
  // betray their square.
  const mask = g.createRadialGradient(m, m, size * 0.2, m, m, m);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = mask;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

/* The planet's day map: banded seas and land painted with value noise, plus
   polar caps. 1024×512 wrapped on a sphere reads as continental weather from
   the distance the camera ever sees it. */
export function planetTexture() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);

  // Tiny value-noise: a coarse random lattice sampled with smooth bilinear
  // interpolation, three octaves. Enough for continents; nobody lands here.
  const lat = 64;
  const grid = new Float32Array((lat + 1) * (lat + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  const sample = (u, v) => {
    const x = u * lat;
    const y = v * lat;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const g00 = grid[yi * (lat + 1) + xi];
    const g10 = grid[yi * (lat + 1) + xi + 1];
    const g01 = grid[(yi + 1) * (lat + 1) + xi];
    const g11 = grid[(yi + 1) * (lat + 1) + xi + 1];
    return g00 + (g10 - g00) * s(fx) + (g01 - g00) * s(fy) + (g00 - g10 - g01 + g11) * s(fx) * s(fy);
  };

  const img = g.createImageData(W, H);
  const d = img.data;
  // An elevation ramp rather than hard bands: neighbouring heights blend, so
  // coasts shade into shelves instead of stamping camouflage.
  const RAMP = [
    [0.0, 7, 22, 46],      // deep sea
    [0.38, 12, 40, 80],    // sea
    [0.46, 20, 78, 96],    // shelf
    [0.52, 28, 102, 84],   // lowland
    [0.62, 74, 124, 94],   // upland
    [0.78, 132, 142, 132], // mountain
    [1.0, 168, 172, 164],
  ];
  const ramp = (t, out) => {
    let i = 0;
    while (i < RAMP.length - 2 && t > RAMP[i + 1][0]) i++;
    const a = RAMP[i];
    const b = RAMP[i + 1];
    const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    out[0] = a[1] + (b[1] - a[1]) * u;
    out[1] = a[2] + (b[2] - a[2]) * u;
    out[2] = a[3] + (b[3] - a[3]) * u;
  };
  const cap = [206, 220, 226];
  const rgb = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let n = sample(u, v) * 0.5
        + sample(u * 2 % 1, v * 2 % 1) * 0.28
        + sample(u * 4 % 1, v * 4 % 1) * 0.15
        + sample(u * 8 % 1, v * 8 % 1) * 0.07;
      ramp(n, rgb);
      // Latitude weather, gently — brightness bands, never a colour change
      const band = 1 + Math.sin(v * Math.PI * 7 + n * 3) * 0.05;
      // Ice caps fade in over the last stretch of latitude
      const lat = Math.abs(v - 0.5) * 2;
      const capT = Math.min(1, Math.max(0, (lat + n * 0.12 - 0.82) / 0.1));
      const jitter = band * (0.94 + sample((u * 8) % 1, (v * 8) % 1) * 0.12);
      const i = (y * W + x) * 4;
      d[i] = (rgb[0] + (cap[0] - rgb[0]) * capT) * jitter;
      d[i + 1] = (rgb[1] + (cap[1] - rgb[1]) * capT) * jitter;
      d[i + 2] = (rgb[2] + (cap[2] - rgb[2]) * capT) * jitter;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

/* City lights for the planet's night side: clustered dots along the coasts
   of nobody-knows-what. Sampled by the planet shader only where the sun
   does not reach. */
export function cityTexture() {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  for (let cl = 0; cl < 90; cl++) {
    const cx = Math.random() * W;
    const cy = H * (0.18 + Math.random() * 0.64);
    const n = 4 + Math.floor(Math.random() * 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.random() * 16;
      g.fillStyle = `rgba(255,214,140,${0.35 + Math.random() * 0.5})`;
      const s = Math.random() < 0.12 ? 1.6 : 0.9;
      g.fillRect(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r, s, s);
    }
  }
  return toTexture(c);
}

/* Alpha for the planetary ring: concentric bands with gaps, brightest in the
   middle third, transparent at both edges. */
export function ringTexture() {
  const W = 256;
  const [c, g] = canvas(W, 4);
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const band = Math.sin(t * 42) * 0.5 + Math.sin(t * 91) * 0.3 + Math.sin(t * 17) * 0.2;
    const edge = Math.sin(t * Math.PI);
    const a = Math.max(0, (0.42 + band * 0.35) * Math.pow(edge, 1.4));
    g.fillStyle = `rgba(236,228,208,${a})`;
    g.fillRect(x, 0, 1, 4);
  }
  return toTexture(c);
}

/* The hyperspace gate's mouth: a slow-rippled disc, brightest at the rim.
   The shader animates it; this is only its grain. */
export function gateTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.16)');
  grad.addColorStop(0.92, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

/* Windows for the station, drawn as points: a small crisp square with a hint
   of halo, so a thousand of them cost one draw call. */
export function windowTexture(size = 32) {
  const [c, g] = canvas(size, size);
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(m - 3, m - 2, 6, 4);
  return toTexture(c);
}

/* Hull plating: a dark metal sheet with panel seams and the occasional
   lighter plate, tiled small across the station so seams catch the sun. */
export function hullTexture(size = 256) {
  // Mid-grey, not gunmetal: the map multiplies the material tint, so a dark
  // map caps how bright any light can ever make the metal. The seams carry
  // the darkness; the plates carry the light.
  const [c, g] = canvas(size, size);
  g.fillStyle = '#707887';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const w = 16 + Math.random() * 48;
    const h = 10 + Math.random() * 30;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 96 + Math.floor(Math.random() * 44);
    g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(24,28,36,0.8)';
    g.lineWidth = 1;
    g.strokeRect(x, y, w, h);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
