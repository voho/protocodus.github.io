/* Rounded slabs and the labels that sit on them, shared by the boards. */
import * as THREE from 'three';

const geometries = new Map();

/* A box with rounded corners and a soft bevelled edge, `height` tall,
   standing on y = 0 and centred on the x and z axes. Cached by size. */
export function slabGeometry(width, depth, height, radius = 0.12, bevel = 0.03) {
  const key = [width, depth, height, radius, bevel].join(':');
  if (geometries.has(key)) return geometries.get(key);
  const hw = width / 2 - bevel, hd = depth / 2 - bevel;
  const r = Math.max(0.01, Math.min(radius - bevel, hw, hd));
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, height - 2 * bevel), curveSegments: 6,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  geometry.computeVertexNormals();
  geometries.set(key, geometry);
  return geometry;
}

export const LABEL_FONT = '"Space Grotesk", "Segoe UI", system-ui, sans-serif';

/* A square canvas texture drawn by `draw(ctx, size)`. */
export function canvasTexture(draw, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* A number, centred. */
export function digitTexture(text, colour = '#f3f4f4', weight = 600) {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scale = text.length > 1 ? 0.52 : 0.64;
    ctx.font = `${weight} ${Math.round(size * scale)}px ${LABEL_FONT}`;
    ctx.fillText(text, size / 2, size * 0.54);
  });
}

/* A Patcher clue: a compact shape above the number, with a clear gap.
   Geometry carries the meaning; a quiet tint helps distinguish it too. */
export function clueTexture({ shape, number }, colour = '#f3f4f4') {
  return canvasTexture((ctx, size) => {
    const both = number !== null && number !== undefined;
    const tint = { square: '#a5d8c5', wide: '#a8c4ed', tall: '#d2b4e4', any: '#e1c990' }[shape] || '#a5d8c5';
    // Dark labels sit on coloured patches, light labels on dark tiles.
    const iconColour = new THREE.Color(colour).lerp(new THREE.Color(tint), 0.28).getStyle();
    const icon = (cx, cy, scale) => {
      const dims = { square: [0.65, 0.65], wide: [1.45, 0.24], tall: [0.24, 1.45], any: [0.65, 0.65] }[shape] || [0.65, 0.65];
      const w = dims[0] * scale, h = dims[1] * scale;
      ctx.lineWidth = size * 0.022;
      ctx.strokeStyle = iconColour;
      ctx.fillStyle = iconColour;
      ctx.lineJoin = 'round';
      ctx.setLineDash(shape === 'any' ? [size * 0.035, size * 0.025] : []);
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, size * 0.012);
      if (shape === 'any') ctx.stroke(); else ctx.fill();
      ctx.setLineDash([]);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    if (both) {
      icon(size / 2, size * 0.23, size * 0.22);
      ctx.fillStyle = colour;
      ctx.font = `600 ${Math.round(size * 0.44)}px ${LABEL_FONT}`;
      ctx.fillText(String(number), size / 2, size * 0.73);
    } else {
      icon(size / 2, size / 2, size * 0.29);
    }
  });
}

const planes = new Map();

/* A flat label lying on a slab, `size` across, brighter than one for
   `intensity` above one (which the bloom picks up). The plane is shared
   by every label of that size, so a board has only its textures and
   materials to release. */
export function labelMesh(texture, size, intensity = 1) {
  if (!planes.has(size)) planes.set(size, new THREE.PlaneGeometry(size, size));
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false,
    color: new THREE.Color(intensity, intensity, intensity),
  });
  const mesh = new THREE.Mesh(planes.get(size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

/* Wait for the label font so the first textures use it; no longer than
   `ms`, a fallback face is not worth a blank table. */
export function waitForFont(ms = 1200) {
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.race([
    Promise.all([document.fonts.load(`600 48px ${LABEL_FONT}`), document.fonts.load(`500 48px ${LABEL_FONT}`)]),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]).catch(() => {});
}
