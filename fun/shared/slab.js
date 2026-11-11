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

/* Paints a number, centred, into a `size` square. */
export function digitPainter(text, colour = '#f3f4f4', weight = 600) {
  return (ctx, size) => {
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scale = text.length > 1 ? 0.52 : 0.64;
    ctx.font = `${weight} ${Math.round(size * scale)}px ${LABEL_FONT}`;
    ctx.fillText(text, size / 2, size * 0.54);
  };
}

/* A Patcher clue: wide and square silhouettes above their numbers, tall
   silhouettes beside them. Shape-only clues sit in the middle of a key.
   Returns the painter of a `size` square. */
export function cluePainter({ shape, number }, colour = '#f3f4f4') {
  return (ctx, size) => {
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
  };
}

/* All the labels of a board on one texture: one canvas, one upload and one
   material, where a texture and a material per label cost a canvas each on
   every new board and every placed patch. `painters[i]` draws label `i`
   into a `size` square; `intensity` above one is picked up by the bloom. */
export function labelSheet(painters, { size = 256, intensity = 1 } = {}) {
  const columns = Math.ceil(Math.sqrt(painters.length)) || 1, rows = Math.ceil(painters.length / columns) || 1;
  const canvas = document.createElement('canvas');
  canvas.width = columns * size;
  canvas.height = rows * size;
  const ctx = canvas.getContext('2d');
  painters.forEach((paint, i) => {
    ctx.save();
    ctx.translate((i % columns) * size, Math.floor(i / columns) * size);
    paint(ctx, size);
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false,
    color: new THREE.Color(intensity, intensity, intensity),
  });
  const geometries = new Map();
  return {
    material,
    /* Label `index` as a flat mesh lying on a slab, `width` across. */
    mesh(index, width) {
      const key = `${index}:${width}`;
      if (!geometries.has(key)) {
        const geometry = new THREE.PlaneGeometry(width, width);
        const uv = geometry.attributes.uv, column = index % columns, row = Math.floor(index / columns);
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (column + uv.getX(i)) / columns, 1 - (row + 1 - uv.getY(i)) / rows);
        geometries.set(key, geometry);
      }
      const mesh = new THREE.Mesh(geometries.get(key), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      return mesh;
    },
    dispose() {
      texture.dispose();
      material.dispose();
      for (const geometry of geometries.values()) geometry.dispose();
    },
  };
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
