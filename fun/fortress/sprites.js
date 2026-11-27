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
const crossbowPoses = new Image();
crossbowPoses.src = new URL('./assets/orc-crossbow.webp', import.meta.url).href;
const guardShadows = new Map();
const shadowPad = 0.18;

function prepareGuardShadows() {
  if (guardShadows.size) return;
  for (const pose of ['guard', 'guard-idle', 'guard-action']) {
    const rect = frames[pose];
    const mask = document.createElement('canvas');
    mask.height = 192;
    mask.width = Math.ceil(mask.height * rect[2] / rect[3]);
    const ink = mask.getContext('2d');
    ink.drawImage(atlas, ...rect, 0, 0, mask.width, mask.height);
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = '#091510';
    ink.fillRect(0, 0, mask.width, mask.height);
    const shadow = document.createElement('canvas');
    const px = Math.ceil(mask.width * shadowPad), py = Math.ceil(mask.height * shadowPad);
    shadow.width = mask.width + 2 * px;
    shadow.height = mask.height + 2 * py;
    const c = shadow.getContext('2d');
    c.filter = 'blur(7px)';
    c.drawImage(mask, px + 7, py + 7);
    c.globalAlpha = 0.72;
    c.filter = 'blur(2px)';
    c.drawImage(mask, px + 3, py + 3);
    guardShadows.set(pose, shadow);
  }
}

export function drawGuardShadow(ctx, pose, x, y, w, h) {
  const shadow = guardShadows.get(pose);
  if (shadow) ctx.drawImage(shadow, x - w * shadowPad, y - h * shadowPad,
    w * (1 + 2 * shadowPad), h * (1 + 2 * shadowPad));
}

function crossbowElevation(pitch) {
  return Math.max(0, Math.min(12, Math.round(pitch * 12 / Math.PI) + 6));
}

// Stock tips measured from the boot midpoint, in the same unscaled artwork
// coordinates as the atlas below. Reduced motion holds the aim frame.
const bowTips = [
  [[-70,-292],[-20,-304],[31,-302],[80,-288],[123,-261],[105,-199],[124,-169],
    [112,-112],[111,-89],[104,-68],[94,-48],[80,-31],[62,-16]],
  [[-40,-311],[13,-314],[66,-304],[114,-280],[154,-245],[153,-206],[172,-163],
    [139,-107],[136,-82],[129,-59],[118,-37],[104,-18],[86,-1]],
];
export function crossbowTip(pitch, reduced) {
  return bowTips[reduced ? 1 : 0][crossbowElevation(pitch)];
}

export function drawCrossbowPose(ctx, frame, pitch, height) {
  // Thirteen aim elevations, from straight up to straight down. Each triplet
  // includes its own soft shadow and shares the same midpoint between the boots.
  const elevation = crossbowElevation(pitch);
  const sw = crossbowPoses.naturalWidth / 6, sh = crossbowPoses.naturalHeight / 7;
  if (!sw) return;
  const scale = height / 268;
  const col = elevation % 2 * 3 + frame;
  ctx.drawImage(crossbowPoses, col * sw, Math.floor(elevation / 2) * sh, sw, sh,
    -215 * scale, -359 * scale, 470 * scale, 415 * scale);
}

let source = atlas;
let mip = 1;
const prepared = new Map();
const distantGuards = new Map();
const catapultOutlines = new Map();
const scaledAtlases = new Map();
const tints = {
  dawn: 'rgba(218,158,117,.055)',
  dusk: 'rgba(109,72,109,.12)',
  night: 'rgba(44,63,102,.22)',
};

// A small set of broad material faces keeps load-bearing pieces easy to read
// against the painted rooms. Intact pieces and their broken polygons sample
// the same surface, including its transparency and time-of-day lighting.
const materialNames = ['stone', 'limestone', 'graystone', 'repaired', 'wood', 'glass', 'steel'];
const tileWidth = 256, tileHeight = 96;
const materialRows = new Map(materialNames.map((name, row) => [name, row]));
const materialGrades = new Map();
let materialSource;

function paintMaterialTiles() {
  const sheet = document.createElement('canvas');
  sheet.width = tileWidth;
  sheet.height = tileHeight * materialNames.length;
  const c = sheet.getContext('2d');
  c.scale(2, 2);
  const fill = (color, path) => { c.fillStyle = color; c.fill(new Path2D(path)); };
  const band = (color, y, height) => { c.fillStyle = color; c.fillRect(0, y, 128, height); };
  const stoneTones = [
    ['#b4aea0', '#a39c8d'], ['#c2b9a5', '#b0a793'], ['#aaa99e', '#99988c'], ['#b7ad9d', '#a59b8a'],
  ];
  for (const [row, name] of materialNames.entries()) {
    if (row < stoneTones.length) {
      const [top, bottom] = stoneTones[row];
      const stone = c.createLinearGradient(16, 0, 75, 48);
      stone.addColorStop(0, top); stone.addColorStop(1, bottom);
      band(stone, 0, 48);
      fill('#d9d1bc', 'M0 0H128L121 3L6 4L3 42H0Z');
      fill('#79776c', 'M128 0V48H0L5 44L120 43L124 18Z');
      // A broad chipped bevel or cut corner, with a quiet center for impact cracks.
      fill('#ffffff15', row % 2 ? 'M4 5L43 4L28 9L7 12Z' : 'M8 4H58L39 8L29 7Z');
      fill('#605f571d', row % 2 ? 'M94 43L111 35L122 32L120 43Z' : 'M58 44L76 39L92 38L99 43Z');
    } else if (name === 'wood') {
      const grain = c.createLinearGradient(0, 0, 8, 48);
      grain.addColorStop(0, '#d59b5d'); grain.addColorStop(0.38, '#bd814a'); grain.addColorStop(1, '#a3673e');
      band(grain, 0, 48);
      fill('#e5b576', 'M0 0H128L125 3L4 5L0 4Z');
      fill('#7e4f34', 'M0 44Q42 42 78 44L128 42V48H0Z');
      fill('#885833a8', 'M0 18Q26 15 50 21T101 21Q81 26 65 25T27 19Z');
      fill('#dfa56a', 'M34 32Q53 25 72 30T128 26Q104 32 87 33T60 30Q48 30 34 32Z');
      fill('#9a64402e', 'M119 3L128 2V43L121 43Z');
    } else if (name === 'glass') {
      const pane = c.createLinearGradient(0, 0, 62, 48);
      pane.addColorStop(0, '#a7eee0b6'); pane.addColorStop(1, '#47b5c0af');
      band(pane, 0, 48);
      fill('#e3ffeedc', 'M0 0H128L122 3H4L2 45L0 48Z');
      fill('#3d929cda', 'M128 0V48H0L5 44H123Z');
      fill('#ecfff6a1', 'M42 3H60L35 44H17Z');
      fill('#eafff587', 'M66 3H70L45 44H41Z');
    } else {
      band('#4f6779', 0, 48);
      const web = c.createLinearGradient(0, 7, 0, 41);
      web.addColorStop(0, '#455b6b'); web.addColorStop(0.64, '#607c8f'); web.addColorStop(1, '#536d80');
      band(web, 7, 35);
      band('#93a9b8', 0, 6); band('#bdcfce', 0, 1.8); band('#364b59', 6, 3);
      band('#93a7b5', 38, 2); band('#738d9f', 40, 6); band('#405765', 46, 2);
      c.fillStyle = '#3f5361';
      for (const x of [9, 119]) {
        c.beginPath(); c.ellipse(x, 23, 2.3, 2.6, 0, 0, Math.PI * 2); c.fill();
      }
    }
    c.translate(0, tileHeight / 2);
  }
  return sheet;
}

function materialGrade(phase) {
  if (!materialGrades.has('day')) materialGrades.set('day', paintMaterialTiles());
  if (!tints[phase]) return materialGrades.get('day');
  if (!materialGrades.has(phase)) {
    const base = materialGrades.get('day'), sheet = document.createElement('canvas');
    sheet.width = base.width; sheet.height = base.height;
    const c = sheet.getContext('2d');
    c.drawImage(base, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = tints[phase]; c.fillRect(0, 0, sheet.width, sheet.height);
    materialGrades.set(phase, sheet);
  }
  return materialGrades.get(phase);
}

export function materialFace(ctx, name, x, y, width, height, u = 0, v = 0, du = 1, dv = 1) {
  const row = materialRows.get(name);
  if (row === undefined || !materialSource) return;
  ctx.drawImage(materialSource, u * tileWidth, (row + v) * tileHeight, du * tileWidth, dv * tileHeight,
    x, y, width, height);
}

// Bake the two moving silhouettes at a fixed density. The wider rim keeps a
// complete machine readable when the whole siege is only a few hundred pixels wide.
function prepareCatapultOutlines() {
  for (const name of ['chassis', 'arm']) {
    const [sx, sy, sw, sh] = frames[name];
    const mask = document.createElement('canvas');
    mask.width = name === 'chassis' ? 396 : 244;
    mask.height = Math.round(mask.width * sh / sw);
    const m = mask.getContext('2d');
    m.drawImage(atlas, sx, sy, sw, sh, 0, 0, mask.width, mask.height);
    m.globalCompositeOperation = 'source-in';
    const variants = [];
    for (const stroke of [4.4, 10.4]) {
      const pad = Math.ceil(stroke * 2.6);
      const canvas = document.createElement('canvas');
      canvas.width = mask.width + 2 * pad;
      canvas.height = mask.height + 2 * pad;
      const c = canvas.getContext('2d');
      c.shadowColor = '#ffcd5b';
      c.shadowBlur = stroke * 2;
      c.drawImage(mask, pad, pad);
      c.shadowBlur = 0;
      for (const [color, radius] of [['#715027', 1.28], ['#ffce69', 1], ['#fff2b6', 0.68]]) {
        m.fillStyle = color;
        m.fillRect(0, 0, mask.width, mask.height);
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6;
          c.drawImage(mask, pad + stroke * radius * Math.cos(angle), pad + stroke * radius * Math.sin(angle));
        }
      }
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(mask, pad, pad);
      variants.push({ canvas, padX: pad / mask.width, padY: pad / mask.height });
    }
    catapultOutlines.set(name, variants);
  }
}

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
  await Promise.all([atlas.decode(), crossbowPoses.decode()]);
  prepareGuardShadows();
  prepareSprites(phase, scale);
}

export function prepareSprites(phase, scale) {
  if (!spriteReady()) return;
  if (!distantGuards.size) prepareDistantGuards();
  if (!catapultOutlines.size) prepareCatapultOutlines();
  materialSource = materialGrade(phase);
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

export function drawCatapultOutline(ctx, name, x, y, width, height, distant) {
  const rim = catapultOutlines.get(name)?.[distant ? 1 : 0];
  if (!rim) return;
  const dx = width * rim.padX, dy = height * rim.padY;
  ctx.drawImage(rim.canvas, x - dx, y - dy, width + dx * 2, height + dy * 2);
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
