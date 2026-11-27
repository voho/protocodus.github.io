// Trimmed source rectangles in the hand-painted, transparent art atlas.
const frames = {
  arm: [2, 1148, 690, 139],
  azure: [685, 778, 130, 190],
  chassis: [2, 2, 820, 463],
  crimson: [551, 778, 130, 195],
  dwarf: [1444, 469, 216, 260],
  'dwarf-action': [819, 778, 177, 183],
  'dwarf-idle': [2, 778, 177, 216],
  elf: [1714, 2, 204, 310],
  'elf-action': [183, 778, 177, 216],
  'elf-idle': [654, 469, 177, 281],
  fairy: [1645, 1148, 108, 108],
  'fairy-up': [1000, 778, 108, 172],
  glass: [1050, 998, 520, 144],
  gnome: [2, 469, 204, 305],
  'gnome-action': [1664, 469, 177, 259],
  'gnome-idle': [1059, 469, 177, 267],
  gothic: [826, 2, 440, 337],
  graystone: [1364, 778, 248, 152],
  guard: [835, 469, 220, 272],
  'guard-action': [364, 778, 183, 213],
  'guard-idle': [1845, 469, 183, 239],
  keg: [1240, 469, 200, 264],
  limestone: [1112, 778, 248, 153],
  pennant: [1220, 1148, 255, 132],
  repaired: [1616, 778, 248, 149],
  royal: [1270, 2, 440, 335],
  steel: [2, 998, 520, 146],
  stone: [696, 1148, 520, 139],
  timbered: [210, 469, 440, 291],
  unicorn: [1757, 1148, 162, 88],
  'unicorn-look': [1479, 1148, 162, 108],
  wood: [526, 998, 520, 144],
};

const atlas = new Image();
atlas.src = new URL('./assets/fortress-atlas.webp', import.meta.url).href;

let source = atlas;
let mip = 1;
const prepared = new Map();
const distantGuards = new Map();
const scaledAtlases = new Map();
const tints = {
  dawn: 'rgba(218,158,117,.055)',
  dusk: 'rgba(109,72,109,.12)',
  night: 'rgba(44,63,102,.22)',
};

// Downsample each overview pose once with larger areas of skin, red leather and a
// light-facing contour. The close view still draws the original painted artwork.
function prepareDistantGuards() {
  for (const name of ['guard', 'guard-idle', 'guard-action']) {
    const [sx, sy, sw, sh] = frames[name];
    const image = document.createElement('canvas');
    image.height = 144;
    image.width = Math.round((image.height * sw) / sh);
    const ctx = image.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, image.width, image.height);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const p = pixels.data, r = p[i], g = p[i + 1], b = p[i + 2];
      if (!p[i + 3]) continue;
      const skin = Math.min(1, Math.max(0, (g - r + 5) / 28)) * Math.min(1, Math.max(0, (g - b - 17) / 45));
      const row = Math.floor(i / (4 * image.width)) / image.height;
      const leather = row > 0.43 && row < 0.75 && r > g * 1.29 && g > b * 1.05;
      p[i] = r * (leather ? 1.13 : 1.05) + 5 - 35 * skin;
      p[i + 1] = g * (leather ? 0.77 : 1.06) + 5 + 39 * skin;
      p[i + 2] = b * 1.04 + 5 + (leather ? 8 : 0) + 13 * skin;
    }
    ctx.putImageData(pixels, 0, 0);
    const rim = document.createElement('canvas');
    rim.width = image.width;
    rim.height = image.height;
    const rc = rim.getContext('2d');
    rc.drawImage(image, 0, 0);
    rc.globalCompositeOperation = 'source-in';
    const light = rc.createLinearGradient(0, 0, image.width * 0.5, image.height);
    light.addColorStop(0, '#fff3be');
    light.addColorStop(0.52, '#dfd5a7');
    light.addColorStop(1, '#736944');
    rc.fillStyle = light;
    rc.fillRect(0, 0, rim.width, rim.height);
    ctx.globalCompositeOperation = 'destination-over';
    for (const [dx, dy] of [[-3.6, -3.2], [2.3, -2.7], [-2.8, 1.5], [2, 1.8]]) ctx.drawImage(rim, dx, dy);
    ctx.globalCompositeOperation = 'source-over';
    distantGuards.set(name, image);
  }
}
function scaleAtlas(scale) {
  if (scale === 1) return atlas;
  if (scaledAtlases.has(scale)) return scaledAtlases.get(scale);
  const image = document.createElement('canvas');
  image.width = Math.ceil(atlas.naturalWidth * scale);
  image.height = Math.ceil(atlas.naturalHeight * scale);
  const ctx = image.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(atlas, 0, 0, image.width, image.height);
  // Recover a little local contrast after minification. Skip transparent edges
  // so mortar, wood grain and steel bevels stay clear without bright fringes.
  const frame = ctx.getImageData(0, 0, image.width, image.height);
  const p = frame.data, stride = image.width * 4;
  const luma = new Uint8Array(image.width * image.height);
  for (let i = 0; i < luma.length; i++) {
    const j = i * 4;
    luma[i] = (p[j] * 54 + p[j + 1] * 183 + p[j + 2] * 19) / 256;
  }
  for (let i = image.width + 1; i < luma.length - image.width - 1; i++) {
    const j = i * 4;
    if (p[j + 3] < 248 || p[j - 1] < 248 || p[j + 7] < 248 ||
      p[j + 3 - stride] < 248 || p[j + 3 + stride] < 248) continue;
    const neighbor = (luma[i - 1] + luma[i + 1] + luma[i - image.width] + luma[i + image.width]) * 0.25;
    const detail = Math.max(-12, Math.min(12, (luma[i] - neighbor) * 0.43));
    p[j] += detail;
    p[j + 1] += detail;
    p[j + 2] += detail;
  }
  ctx.putImageData(frame, 0, 0);
  scaledAtlases.set(scale, image);
  return image;
}

// A prepared palette is reused when another castle or zoom has the same light
// and pixel density. The menu can prime it before exposing the battlefield.
export async function whenSpritesReady(phase = 'day', scale = 1) {
  await atlas.decode();
  prepareSprites(phase, scale);
}

export function prepareSprites(phase, scale) {
  if (!spriteReady()) return;
  if (!distantGuards.size) prepareDistantGuards();
  mip = scale < 1.65 ? 0.25 : scale < 3 ? 0.5 : 1;
  const key = phase + '/' + mip;
  source = prepared.get(key);
  if (source) return;
  source = scaleAtlas(mip);
  if (tints[phase]) {
    const surface = document.createElement('canvas');
    surface.width = source.width;
    surface.height = source.height;
    const ctx = surface.getContext('2d');
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tints[phase];
    ctx.fillRect(0, 0, surface.width, surface.height);
    source = surface;
  }
  prepared.set(key, source);
}

let loaded = false;
export function spriteReady() {
  if (!loaded) loaded = atlas.complete && atlas.naturalWidth > 0;
  return loaded;
}

export function sprite(ctx, name, x, y, width, height) {
  const frame = frames[name];
  if (!frame || !spriteReady()) return false;
  const [sx, sy, sw, sh] = frame;
  ctx.drawImage(source, sx * mip, sy * mip, sw * mip, sh * mip, x, y, width, height);
  return true;
}

// Use a fractional area of the original illustration for chipped masonry or debris.
export function sampleSprite(ctx, name, left, top, w, h, x, y, width, height) {
  const frame = frames[name];
  if (!frame || !spriteReady()) return false;
  const [sx, sy, sw, sh] = frame;
  ctx.drawImage(
    source,
    (sx + left * sw) * mip,
    (sy + top * sh) * mip,
    w * sw * mip,
    h * sh * mip,
    x,
    y,
    width,
    height,
  );
  return true;
}

export function sampleGuard(ctx, pose, overview, left, top, w, h, x, y, width, height) {
  if (overview < 1) sampleSprite(ctx, pose, left, top, w, h, x, y, width, height);
  if (!overview) return;
  const image = distantGuards.get(pose);
  if (!image) return;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * overview;
  ctx.drawImage(image, left * image.width, top * image.height, w * image.width, h * image.height, x, y, width, height);
  ctx.globalAlpha = alpha;
}
