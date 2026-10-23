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

/* A Patcher clue: the shape icon, with the number under it when there is
   one. The any-shape icon is a dashed square. */
export function clueTexture({ shape, number }, colour = '#f3f4f4') {
  return canvasTexture((ctx, size) => {
    const both = number !== null && number !== undefined;
    const icon = (cx, cy, scale) => {
      const dims = { square: [1, 1], wide: [1.6, 0.9], tall: [0.9, 1.6], any: [1, 1] }[shape] || [1, 1];
      const w = dims[0] * scale, h = dims[1] * scale;
      ctx.lineWidth = size * (both ? 0.05 : 0.06);
      ctx.strokeStyle = colour;
      ctx.lineJoin = 'round';
      ctx.setLineDash(shape === 'any' ? [size * 0.06, size * 0.045] : []);
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, size * 0.035);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    if (both) {
      icon(size / 2, size * 0.29, size * 0.25);
      ctx.font = `600 ${Math.round(size * 0.46)}px ${LABEL_FONT}`;
      ctx.fillText(String(number), size / 2, size * 0.72);
    } else {
      icon(size / 2, size / 2, size * 0.4);
    }
  });
}

/* A flat label lying on a slab, `size` across, brighter than one for
   `intensity` above one (which the bloom picks up). */
export function labelMesh(texture, size, intensity = 1) {
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false,
    color: new THREE.Color(intensity, intensity, intensity),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
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
