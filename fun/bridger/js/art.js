// One decoded drawable per painting. Keeping ImageBitmaps alive lets every
// world reuse its pixels without relying on the browser's decoded-image cache.
const images = new Map();
const loading = new Map();
const vehicleLayers = ['car', 'truck', 'loco', 'wagon', 'wheel-road', 'wheel-rail'];

export const image = name => images.get(name);
export const ready = img => Boolean(img?.width);

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* Try the browser's image decoder. */ }
  }
  const img = new Image();
  const url = URL.createObjectURL(blob);
  try {
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

async function load(name) {
  const url = new URL(`../assets/${name}.webp`, import.meta.url);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
      const bitmap = await decode(await response.blob());
      images.set(name, bitmap);
      return;
    } catch (error) {
      if (attempt || !navigator.onLine) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

export function preloadArt(themes) {
  const names = new Set([...vehicleLayers, ...themes.flatMap(theme => [theme.sky, theme.rock])]);
  return Promise.all([...names].map(name => {
    if (images.has(name)) return;
    if (!loading.has(name)) loading.set(name, load(name).finally(() => loading.delete(name)));
    return loading.get(name);
  }));
}
