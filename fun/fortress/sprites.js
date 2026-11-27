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
const tints = {
  dawn: 'rgba(218,158,117,.055)',
  dusk: 'rgba(109,72,109,.12)',
  night: 'rgba(44,63,102,.22)',
};

// A prepared palette is reused when another castle or zoom has the same light
// and pixel density. The menu can prime it before exposing the battlefield.
export async function whenSpritesReady(phase = 'day', scale = 1) {
  await atlas.decode();
  prepareSprites(phase, scale);
}

export function prepareSprites(phase, scale) {
  if (!spriteReady()) return;
  mip = scale < 1.65 ? 0.25 : scale < 3 ? 0.5 : 1;
  const key = phase + '/' + mip;
  source = prepared.get(key);
  if (source) return;
  if (mip === 1 && !tints[phase]) {
    source = atlas;
  } else {
    const surface = document.createElement('canvas');
    surface.width = Math.ceil(atlas.naturalWidth * mip);
    surface.height = Math.ceil(atlas.naturalHeight * mip);
    const ctx = surface.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(atlas, 0, 0, atlas.naturalWidth * mip, atlas.naturalHeight * mip);
    if (tints[phase]) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = tints[phase];
      ctx.fillRect(0, 0, surface.width, surface.height);
    }
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
