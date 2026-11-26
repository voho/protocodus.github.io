// A river fetches only its current landscape and vehicle. Each completed
// image wakes the renderer, including when reduced motion has paused it.
const images = new Map();
export const image = (name) => {
  if (!images.has(name)) {
    const img = new Image();
    img.onload = () => window.dispatchEvent(new Event('bridger-art-load'));
    img.src = new URL(`../assets/${name}.webp`, import.meta.url).href;
    images.set(name, img);
  }
  return images.get(name);
};
export const ready = (img) => img.complete && img.naturalWidth > 0;
