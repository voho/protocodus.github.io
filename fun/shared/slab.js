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

/* A Patcher clue: wide and square silhouettes above their numbers, tall
   silhouettes beside them. Shape-only clues sit in the middle of a key. */
export function clueTexture({ shape, number }, colour = '#f3f4f4') {
  return canvasTexture((ctx, size) => {
    const both = number !== null && number !== undefined;
    const tint = { square: '#8fe0c4', wide: '#8cc2ff', tall: '#d9b2f5' }[shape] || '#8fe0c4';
    // Placed patches keep the same dark ink for both icon and number.
    // Only pale ink on empty slots takes a faint hint of the shape colour;
    // tinting dark ink towards a pastel would wash out its contrast.
    const inkColour = new THREE.Color(colour);
    const luminance = inkColour.r * 0.2126 + inkColour.g * 0.7152 + inkColour.b * 0.0722;
    const ink = luminance < 0.15 ? colour : inkColour.lerp(new THREE.Color(tint), 0.18).getStyle();
    const icon = (x, y, width, height) => {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, size * 0.025);
      ctx.fill();
    };
    if (!both) {
      const dimensions = { square: [0.44, 0.44], wide: [0.64, 0.26], tall: [0.26, 0.64] };
      const [width, height] = dimensions[shape] || dimensions.square;
      icon(size * (1 - width) / 2, size * (1 - height) / 2, size * width, size * height);
      return;
    }

    const beside = shape === 'tall';
    const text = String(number);
    const top = size * (beside ? 0.18 : 0.56), bottom = size * (beside ? 0.82 : 0.90);
    let fontSize = Math.round(size * 0.47);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const measure = () => {
      ctx.font = `600 ${fontSize}px ${LABEL_FONT}`;
      const metrics = ctx.measureText(text);
      return {
        left: metrics.actualBoundingBoxLeft ?? 0,
        right: metrics.actualBoundingBoxRight ?? metrics.width,
        ascent: metrics.actualBoundingBoxAscent ?? fontSize * 0.72,
        descent: metrics.actualBoundingBoxDescent ?? fontSize * 0.02,
      };
    };
    let bounds = measure();
    const fit = Math.min(1, size * (beside ? 0.52 : 0.80) / (bounds.left + bounds.right),
      (bottom - top) / (bounds.ascent + bounds.descent));
    if (fit < 1) {
      fontSize = Math.max(1, Math.floor(fontSize * fit));
      bounds = measure();
    }
    let textX;
    if (beside) {
      // The tall icon and visible digit ink form one centered group, with
      // a 12% gutter and at least 10% safe padding on either side.
      const width = size * 0.16, height = size * 0.56, gap = size * 0.12;
      const left = (size - width - gap - bounds.left - bounds.right) / 2;
      icon(left, (size - height) / 2, width, height);
      textX = left + width + gap + bounds.left;
    } else {
      // Horizontal silhouettes sit in their own padded band. Their bottom
      // stays at least 10% above the number's measured ink.
      const dimensions = { square: [0.30, 0.30], wide: [0.48, 0.19] };
      const [width, height] = dimensions[shape] || dimensions.square;
      icon(size * (1 - width) / 2, size * (0.28 - height / 2), size * width, size * height);
      textX = size / 2 + (bounds.left - bounds.right) / 2;
    }
    // Font baselines and digit side-bearings differ across fallback faces.
    // Center the visible glyphs, rather than the nominal line-height box.
    ctx.fillStyle = colour;
    ctx.fillText(text, textX, (top + bottom + bounds.ascent - bounds.descent) / 2);
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
