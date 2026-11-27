// All sentry poses share the same helmet, cuirass, boots and painted crossbow.
// The boot midpoint is the origin for every frame, including the bolt tip.
const parts = new Image();
parts.src = new URL('./assets/orc-sentry.webp', import.meta.url).href;
const scale = .75, columns = 7, cellW = 264, cellH = 285;
const footX = 119, footY = 353;
const bodyHeight = 268;
const leftBoot = 42, rightBoot = 43;
let sheet, preparing;

const elevation = (pitch) => Math.max(0, Math.min(12, Math.round(pitch * 12 / Math.PI) + 6));
export const shootingPose = (frame, pitch) => 3 + elevation(pitch) * 3 + frame;

function poseFor(index) {
  const firing = index >= 3;
  const frame = firing ? (index - 3) % 3 : 0;
  const pitch = firing ? (Math.floor((index - 3) / 3) - 6) * Math.PI / 12 : [.25, .14, -.12][index];
  const lift = firing ? [2, -1, 3][frame] : [0, -2.3, 5][index];
  const recoil = firing && frame === 2 ? 9 : 0;
  const x = -34 + (pitch < 0 ? 83 : 58) * Math.abs(Math.sin(pitch)) - recoil * Math.cos(pitch);
  // Raise the stock on a steep downward aim so the limbs clear the guard's boots.
  const y = -142 + lift - recoil * Math.sin(pitch) - 34 * Math.max(0, Math.sin(pitch)) ** 3;
  return { pitch, lift, x, y };
}
const poses = Array.from({ length: 42 }, (_, i) => poseFor(i));
export function crossbowTip(pitch, reduced) {
  const p = poses[shootingPose(reduced ? 1 : 2, pitch)];
  return [p.x + 163 * Math.cos(p.pitch) + 12 * Math.sin(p.pitch),
    p.y + 163 * Math.sin(p.pitch) - 12 * Math.cos(p.pitch)];
}

// Coordinates in the original painting, packed at half resolution for delivery.
function cut(ctx, sx, sy, sw, sh, x, y, w, h) {
  ctx.drawImage(parts, sx / 2, sy / 2, sw / 2, sh / 2, x, y, w, h);
}

function upperArm(ctx, x, y, endX, endY) {
  const length = Math.hypot(endX - x, endY - y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(endY - y, endX - x));
  // Carry the painted arm around its shoulder, with the near glove over its end.
  cut(ctx, 719, 466, 98, 129, -4, -12.5, length + 9, 25);
  ctx.restore();
}

function paintPose(ctx, pose) {
  ctx.save();
  ctx.scale(-1, 1); // The painted face looks left; the shared shooting rig aims right.
  cut(ctx, 69, 23, 575, 762, -83, -bodyHeight + pose.lift, 166, 210 - pose.lift);
  ctx.restore();
  const c = Math.cos(pose.pitch), s = Math.sin(pose.pitch);
  upperArm(ctx, -50, -149 + pose.lift, pose.x + 4 * c, pose.y + 4 * s);
  upperArm(ctx, 49, -148 + pose.lift, pose.x + 68 * c - 18 * s, pose.y + 68 * s + 18 * c);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.pitch);
  cut(ctx, 714, 363, 772, 304, -2, -36, 168, 66);
  ctx.restore();
}

function bake() {
  const art = document.createElement('canvas');
  art.width = cellW * columns;
  art.height = cellH * Math.ceil((rightBoot + 1) / columns);
  const ctx = art.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i <= rightBoot; i++) {
    ctx.setTransform(scale, 0, 0, scale, (i % columns) * cellW + footX * scale,
      Math.floor(i / columns) * cellH + footY * scale);
    if (i < leftBoot) paintPose(ctx, poses[i]);
    else {
      // Overlap the tunic hem. The two boot sprites can also follow the ragdoll.
      const isLeft = i === leftBoot;
      ctx.scale(-1, 1);
      cut(ctx, isLeft ? 355 : 69, 753, isLeft ? 289 : 286, 247,
        isLeft ? -.43 : -83, -68, isLeft ? 83.43 : 82.57, 68);
    }
  }
  const mask = document.createElement('canvas');
  mask.width = art.width;
  mask.height = art.height;
  const ink = mask.getContext('2d');
  ink.drawImage(art, 0, 0);
  ink.globalCompositeOperation = 'source-in';
  ink.fillStyle = '#ece0a6';
  ink.fillRect(0, 0, mask.width, mask.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  for (const [dx, dy] of [[-1.2, -1.4], [1.1, -1], [-.8, .7]]) ctx.drawImage(mask, dx, dy);
  ink.fillStyle = '#102018';
  ink.fillRect(0, 0, mask.width, mask.height);
  ctx.filter = 'blur(2px)';
  ctx.drawImage(mask, 2, 3);
  ctx.filter = 'blur(5px)';
  ctx.drawImage(mask, 3, 5);
  return art;
}

export function prepareOrcArt() {
  return preparing ??= parts.decode().then(async () => {
    const art = bake();
    sheet = typeof createImageBitmap === 'function' ? await createImageBitmap(art).catch(() => art) : art;
  }).catch((error) => { preparing = undefined; throw error; });
}

export function orcUnit(height, screenScale) {
  const tiny = Math.max(0, Math.min(1, (38 - height * screenScale) / 28));
  return height * (1.18 + .31 * tiny) / bodyHeight;
}

export function drawOrcPart(ctx, index, unit) {
  if (!sheet) return;
  ctx.drawImage(sheet, index % columns * cellW, Math.floor(index / columns) * cellH, cellW, cellH,
    -footX * unit, -footY * unit, cellW * unit / scale, cellH * unit / scale);
}
export function drawOrcBoot(ctx, index, unit) { drawOrcPart(ctx, index ? rightBoot : leftBoot, unit); }
