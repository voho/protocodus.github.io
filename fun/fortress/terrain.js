// Rock strata run through the hill in world space. Only the thin sod or snow
// cap follows the slope. A cliff never stretches a column of landscape pixels.
const BASE = 389;
const WORLD = { width: 1200, height: 480 };

function traceHill(ctx, ridge, bottom) {
  ctx.moveTo(ridge[0].x, ridge[0].y);
  for (let i = 1; i < ridge.length - 1; i++) {
    const a = ridge[i - 1],
      b = ridge[i],
      c = ridge[i + 1];
    const incoming = Math.hypot(b.x - a.x, b.y - a.y),
      outgoing = Math.hypot(c.x - b.x, c.y - b.y);
    const radius = Math.min(1.65, incoming * 0.28, outgoing * 0.28);
    ctx.lineTo(b.x + ((a.x - b.x) * radius) / incoming, b.y + ((a.y - b.y) * radius) / incoming);
    ctx.quadraticCurveTo(
      b.x,
      b.y,
      b.x + ((c.x - b.x) * radius) / outgoing,
      b.y + ((c.y - b.y) * radius) / outgoing,
    );
  }
  const end = ridge.at(-1);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(end.x, bottom);
  ctx.lineTo(ridge[0].x, bottom);
  ctx.closePath();
}

const earthLight = {
  dawn: 'rgba(191,150,121,.13)',
  dusk: 'rgba(81,60,90,.29)',
  night: 'rgba(20,34,57,.57)',
};

// Keep the entire contact surface in world space. Camera tracking and zooming
// transform one bitmap; they never resample scenery or regenerate geometry.
export function paintTerrain(points, image, phase, previousCanvas) {
  if (!points?.length || !image?.naturalWidth || !image.naturalHeight) return null;
  const imageW = image.naturalWidth,
    imageH = image.naturalHeight;
  const left = points[0].x,
    right = points.at(-1).x;
  const minY = Math.min(...points.map((p) => p.y));
  const top = minY - 1.6,
    bottom = BASE + 54;
  const width = right - left,
    height = bottom - top;
  const scale = Math.min(3.2, imageW / WORLD.width);
  const canvas = previousCanvas || document.createElement('canvas');
  const w = Math.ceil(width * scale),
    h = Math.ceil(height * scale);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sx = imageW / WORLD.width,
    sy = imageH / WORLD.height;
  const shelf = BASE * sy,
    substrate = imageH - shelf;
  if (substrate < 2) return null;
  const sourceX = (x) => Math.max(0, Math.min(imageW, x * sx));
  ctx.save();
  ctx.beginPath();
  traceHill(ctx, points, bottom);
  ctx.clip();
  const sourceLeft = sourceX(left),
    sourceWidth = sourceX(right) - sourceLeft;
  if (sourceWidth > 0.01) {
    // Use undistorted root and bedrock detail from the realm painting for the
    // whole face, even where a short horizontal run descends dozens of units.
    ctx.drawImage(
      image,
      sourceLeft,
      shelf + substrate * 0.15,
      sourceWidth,
      substrate * 0.84,
      left,
      minY,
      right - left,
      bottom - minY,
    );
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i],
      dx = q.x - p.x,
      dy = q.y - p.y;
    const slopeAngle = Math.atan2(dy, dx),
      steep = Math.abs(slopeAngle),
      span = Math.hypot(dx, dy);
    if (steep > 0.5) {
      const inset = Math.sign(-dy) * Math.min(18, Math.abs(dy) * 0.45);
      const shade = ctx.createLinearGradient((p.x + q.x) / 2, 0, (p.x + q.x) / 2 + inset, 0);
      shade.addColorStop(0, dy > 0 ? 'rgba(20,27,34,.31)' : 'rgba(29,33,28,.16)');
      shade.addColorStop(1, 'rgba(29,32,29,0)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x + inset, bottom);
      ctx.lineTo(p.x + inset, bottom);
      ctx.closePath();
      ctx.fill();
    }
    // Exposed near-vertical bedrock has a bare side. A steep face does not
    // carry a long ribbon of grass or snow hanging straight down it.
    const coverage = Math.max(0, Math.min(1, (1.2 - steep) / 0.55));
    if (coverage <= 0 || span < 0.1) continue;
    const capH = 3.7 + 5.8 * coverage;
    const sampleW = Math.min(imageW, span * sx);
    const center = sourceX((p.x + q.x) / 2);
    const capX = Math.max(0, Math.min(imageW - sampleW, center - sampleW / 2));
    ctx.save();
    ctx.translate(p.x, p.y - 0.3);
    ctx.rotate(slopeAngle);
    ctx.drawImage(
      image,
      capX,
      Math.max(0, shelf - 0.9 * sy),
      sampleW,
      substrate * 0.16,
      -0.26,
      0,
      span + 0.52,
      capH,
    );
    ctx.restore();
  }
  ctx.restore();

  if (earthLight[phase]) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = earthLight[phase];
    ctx.fillRect(left, top, width, height);
  }
  const fade = ctx.createLinearGradient(0, BASE + 2, 0, bottom);
  fade.addColorStop(0, 'white');
  fade.addColorStop(1, 'transparent');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(left, top, width, height);
  const sides = ctx.createLinearGradient(left, 0, right, 0);
  sides.addColorStop(0, 'transparent');
  sides.addColorStop(0.016, 'white');
  sides.addColorStop(0.984, 'white');
  sides.addColorStop(1, 'transparent');
  ctx.fillStyle = sides;
  ctx.fillRect(left, top, width, height);
  ctx.globalCompositeOperation = 'source-over';
  return { canvas, left, top, width, height };
}
