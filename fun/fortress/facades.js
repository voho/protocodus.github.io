// Each bay's facing follows its floor and piers. The renderer drops it as soon
// as those supports separate, including the open galleries and their rails.
const panels = { casement: [0, 0], loophole: [1, 0], shutters: [0, 1], rose: [1, 1] };
const art = new Image();
art.src = new URL('./assets/castle-facades.webp', import.meta.url).href;
export const prepareFacadeArt = () => art.decode();
export const facadeStyles = Object.keys(panels);

export function paintFacade(style, phase) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const [column, row] = panels[style];
  const w = art.naturalWidth / 2, h = art.naturalHeight / 2;
  if (w && h) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art, column * w + 3, row * h + 3, w - 6, h - 6, 0, 0, canvas.width, canvas.height);
  }
  const tints = { day: '#33342716', dawn: '#9e5c3330', dusk: '#422b493d', night: '#15213d77' };
  ctx.fillStyle = tints[phase] || tints.day;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function chamberStyle(section, bay, row, occupied) {
  const height = section.heights[bay], crest = Math.max(...section.heights);
  const zone = section.zones?.[bay] ||
    (height >= crest - 1 ? 'keep' : height <= crest * 0.52 ? 'gallery' : 'tower');
  const top = row + 1 === height;
  const middle = Math.floor(section.spans.length / 2);
  const district = Math.floor((bay + section.pattern % 2) / 2);
  if (row === 0 && bay === section.gate) return 'gothic';
  if (zone === 'stair' || zone === 'court') return 'open';
  if (zone === 'gallery') return top || occupied ? 'balcony' : 'open';
  if (zone === 'wall') return top ? 'balcony' : 'loophole';
  if (zone === 'hall' && row < Math.max(2, Math.floor(crest / 3))) return row === 0 ? 'open' : 'balcony';
  if (row === 0) return 'loophole';
  if (occupied) return top ? 'balcony' : 'timbered';
  if (zone === 'hall') {
    if (top && Math.abs(bay - middle) <= 1) return 'rose';
    if (row === Math.floor(height / 2)) return 'gothic';
    return row >= height - 2 ? 'casement' : 'shutters';
  }
  if (top && height === crest && bay === section.heights.indexOf(crest)) return 'rose';
  if (zone === 'tower') return top ? 'balcony' : row % 4 === 2 ? 'open' : 'loophole';
  if (row >= Math.ceil(height * 0.64)) return district % 2 ? 'casement' : 'shutters';
  return row % 4 === 2 ? 'gothic' : 'loophole';
}
