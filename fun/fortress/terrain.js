// Terrain is cached in world space. Every crater uses the same profile for
// collision, the near edge of the cut, and the broken sod on either side.
const BASE = 389;
const WORLD = { width: 1200, height: 480 };
const BOTTOM = BASE + 131;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function heightAt(points, x) {
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid].x <= x) low = mid;
    else high = mid;
  }
  const a = points[low],
    b = points[high];
  return a.y + (b.y - a.y) * clamp((x - a.x) / (b.x - a.x || 1), 0, 1);
}

// The two profiles can have different sample positions after excavation.
// Their difference is linear between each pair of consecutive breakpoints.
function changedSpan(old, next) {
  const xs = [...new Set([...old.map((p) => p.x), ...next.map((p) => p.x)])].sort((a, b) => a - b);
  let left = Infinity,
    right = -Infinity,
    previousX = xs[0],
    previousChanged = false;
  for (const x of xs) {
    const changed = Math.abs(heightAt(old, x) - heightAt(next, x)) > 0.015;
    if (changed || previousChanged) {
      left = Math.min(left, previousX);
      right = x;
    }
    previousChanged = changed;
    previousX = x;
  }
  return [Math.floor(left - 22), Math.ceil(right + 22)];
}

function traceFace(ctx, ridge, bottom) {
  ctx.beginPath();
  ctx.moveTo(ridge[0].x, ridge[0].y);
  for (let i = 1; i < ridge.length - 1; i++) {
    const a = ridge[i - 1],
      b = ridge[i],
      c = ridge[i + 1];
    const incoming = Math.hypot(b.x - a.x, b.y - a.y),
      outgoing = Math.hypot(c.x - b.x, c.y - b.y);
    if (!incoming || !outgoing) continue;
    const radius = Math.min(1.4, incoming * 0.24, outgoing * 0.24);
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

function belowShelf(points) {
  const pits = [];
  let rim = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (Math.max(a.y, b.y) <= BASE) continue;
    if (a.y <= BASE) {
      const x = a.x + ((BASE - a.y) / (b.y - a.y)) * (b.x - a.x);
      rim = [{ x, y: BASE }];
      pits.push(rim);
    } else if (!rim) {
      rim = [a];
      pits.push(rim);
    }
    if (b.y > BASE) rim.push(b);
    else {
      const x = a.x + ((BASE - a.y) / (b.y - a.y)) * (b.x - a.x);
      rim.push({ x, y: BASE });
      rim = null;
    }
  }
  return pits;
}

// Mirror the painting at its edges so expanded flanks meet the original
// soil seamlessly. The same world coordinate always samples the same rock.
function drawStrata(ctx, image, sx, sourceY, sourceH, left, width, top, height) {
  const right = left + width;
  for (let x = left; x < right;) {
    const tile = Math.floor(x / WORLD.width);
    const stop = Math.min(right, (tile + 1) * WORLD.width);
    const span = stop - x, offset = x - tile * WORLD.width;
    if (tile & 1) {
      ctx.save();
      ctx.translate(stop, top);
      ctx.scale(-1, 1);
      ctx.drawImage(image, (WORLD.width - offset - span) * sx, sourceY, span * sx, sourceH, 0, 0, span, height);
      ctx.restore();
    } else {
      ctx.drawImage(image, offset * sx, sourceY, span * sx, sourceH, x, top, span, height);
    }
    x = stop;
  }
}

// The panorama contains an unbroken soil cross-section. Inside a hole paint
// the distant bank across that old shelf. A darker back wall descends from
// the bank to the actual foreground rim. Everything moves with the terrain.
function paintPit(ctx, rim, image, sx, sy) {
  const left = rim[0].x,
    right = rim.at(-1).x,
    width = right - left;
  if (width < 0.15) return;
  const lowest = Math.max(...rim.map((p) => p.y));
  const depth = lowest - BASE;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left, BASE - 1);
  ctx.lineTo(right, BASE - 1);
  for (let i = rim.length - 1; i >= 0; i--) ctx.lineTo(rim[i].x, rim[i].y + 1);
  ctx.closePath();
  ctx.clip();
  drawStrata(ctx, image, sx, (BASE - 21) * sy, 19 * sy, left, width, BASE - 1.1, Math.max(2.5, depth * 0.34));
  const back = rim.map((p) => ({ x: p.x, y: BASE - 0.8 + (p.y - BASE) * 0.18 }));
  traceFace(ctx, back, lowest + 2);
  ctx.clip();
  drawStrata(ctx, image, sx, (BASE + 16) * sy, 63 * sy, left, width, BASE - 1, Math.max(3, depth + 4));
  const shade = ctx.createLinearGradient(0, BASE - 1, 0, lowest + 1);
  shade.addColorStop(0, 'rgba(27,28,31,.46)');
  shade.addColorStop(0.46, 'rgba(30,27,31,.57)');
  shade.addColorStop(1, 'rgba(20,22,29,.79)');
  ctx.fillStyle = shade;
  ctx.fillRect(left, BASE - 1, width, depth + 3);
  ctx.restore();
}

const earthLight = {
  dawn: 'rgba(191,150,121,.13)',
  dusk: 'rgba(81,60,90,.29)',
  night: 'rgba(20,34,57,.57)',
};

export function paintTerrain(points, image, phase, previous, original = points) {
  if (!points?.length || !image?.naturalWidth || !image.naturalHeight) return null;
  const left = original[0].x,
    right = original.at(-1).x;
  const minY = Math.min(...original.map((p) => p.y)),
    top = minY - 2;
  const width = right - left,
    height = BOTTOM - top;
  const sx = image.naturalWidth / WORLD.width,
    sy = image.naturalHeight / WORLD.height;
  const scale = Math.min(3.2, sx),
    w = Math.ceil(width * scale),
    h = Math.ceil(height * scale);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null;
  const compatible =
    previous?.canvas &&
    previous.image === image &&
    previous.phase === phase &&
    previous.original === original;
  const canvas = previous?.canvas || document.createElement('canvas');
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const result = { canvas, left, top, width, height, image, phase, original, points };
  let [from, to] = compatible ? changedSpan(previous.points, points) : [left, right];
  from = Math.max(left, from);
  to = Math.min(right, to);
  if (from >= to) return result;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
  ctx.beginPath();
  ctx.rect(from, top, to - from, height);
  ctx.clip();
  ctx.clearRect(from, top, to - from, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const rim of belowShelf(points)) {
    if (rim.at(-1).x >= from && rim[0].x <= to) paintPit(ctx, rim, image, sx, sy);
  }

  ctx.save();
  traceFace(ctx, points, BOTTOM);
  ctx.clip();
  const shelf = BASE * sy,
    substrate = image.naturalHeight - shelf;
  // Strata run horizontally through the hill. Their texture stays anchored
  // to the original bedrock when an explosion cuts through the hilltop.
  const oldBottom = BASE + 54;
  drawStrata(ctx, image, sx, shelf + substrate * 0.15, substrate * 0.84, left, width, minY, oldBottom - minY);
  drawStrata(ctx, image, sx, shelf + substrate * 0.46, substrate * 0.53, left, width,
    oldBottom - 0.1, BOTTOM - oldBottom + 0.2);

  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i];
    if (q.x < from || p.x > to) continue;
    const dx = q.x - p.x,
      dy = q.y - p.y,
      span = Math.hypot(dx, dy);
    if (dx <= 0 || span < 0.1) continue;
    const angle = Math.atan2(dy, dx),
      steep = Math.abs(angle);
    const center = (p.x + q.x) / 2;
    const cut = (p.y + q.y) / 2 - heightAt(original, center) > 0.45;
    if (steep > 0.5) {
      const inset = -Math.sign(dy) * Math.min(18, Math.abs(dy) * 0.45);
      const shade = ctx.createLinearGradient(center, 0, center + inset, 0);
      shade.addColorStop(0, dy > 0 ? 'rgba(20,27,34,.31)' : 'rgba(29,33,28,.16)');
      shade.addColorStop(1, 'rgba(29,32,29,0)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x + inset, BOTTOM);
      ctx.lineTo(p.x + inset, BOTTOM);
      ctx.closePath();
      ctx.fill();
    }
    const coverage = clamp((1.2 - steep) / 0.55, 0, 1);
    if (!cut && coverage <= 0) continue;
    const sampleW = Math.min(image.naturalWidth, span * sx);
    const tile = Math.floor(center / WORLD.width);
    const offset = center - tile * WORLD.width;
    const capX = clamp((tile & 1 ? WORLD.width - offset : offset) * sx - sampleW / 2, 0, image.naturalWidth - sampleW);
    ctx.save();
    ctx.translate(p.x, p.y - 0.35);
    ctx.rotate(angle);
    if (cut) {
      // Newly exposed rock has a broken mineral lip and loose chips, even
      // on a flat crater floor where healthy grass would otherwise return.
      ctx.drawImage(
        image,
        capX,
        shelf + substrate * 0.32,
        sampleW,
        substrate * 0.21,
        -0.3,
        0,
        span + 0.6,
        7.3,
      );
      ctx.fillStyle = dy > 0 ? 'rgba(250,217,158,.49)' : 'rgba(226,195,145,.32)';
      ctx.fillRect(-0.25, 0.15, span + 0.5, 0.8);
      const start = Math.ceil(p.x / 4) * 4;
      for (let x = start; x < q.x; x += 4) {
        const noise = Math.abs(Math.sin(x * 6.183 + 1.9));
        if (noise < 0.22) continue;
        const at = ((x - p.x) / dx) * span,
          size = 0.46 + noise * 0.93;
        ctx.fillStyle = noise > 0.74 ? '#ac9778' : '#675e50';
        ctx.beginPath();
        ctx.moveTo(at, 1.5 + noise * 1.9);
        ctx.lineTo(at + size, 0.8 + noise * 1.9);
        ctx.lineTo(at + size * 2.25, 1.8 + noise * 2.1);
        ctx.lineTo(at + size * 0.9, 2.4 + noise * 2.1);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.drawImage(
        image,
        capX,
        shelf - 0.9 * sy,
        sampleW,
        substrate * 0.16,
        -0.26,
        0,
        span + 0.52,
        3.7 + 5.8 * coverage,
      );
    }
    ctx.restore();
  }
  // Fade the opaque foreground into the deep panoramic soil. The transition
  // follows the bottom of a pit; it never restores the old grass across it.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x;
    if (b.x < from || a.x > to || dx <= 0) continue;
    const y = Math.max(BASE, a.y),
      endY = Math.max(BASE, b.y);
    ctx.save();
    ctx.transform(1, (endY - y) / dx, 0, 1, a.x, y);
    const fade = ctx.createLinearGradient(0, 2, 0, 54);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(1, '#000');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 2, dx + 0.02, height);
    ctx.restore();
  }
  ctx.restore();

  if (earthLight[phase]) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = earthLight[phase];
    ctx.fillRect(from, top, to - from, height);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const sides = ctx.createLinearGradient(left, 0, right, 0);
  sides.addColorStop(0, 'transparent');
  sides.addColorStop(0.016, '#fff');
  sides.addColorStop(0.984, '#fff');
  sides.addColorStop(1, 'transparent');
  ctx.fillStyle = sides;
  ctx.fillRect(left, top, width, height);
  ctx.restore();
  return result;
}
