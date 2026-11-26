// A river fetches only its current landscape and vehicle. Each completed
// image wakes the renderer, including when reduced motion has paused it.
const images = new Map();
export const image = (name) => {
  if (!images.has(name)) {
    const img = new Image();
    const src = new URL(`../assets/${name}.webp`, import.meta.url).href;
    let retried = false, timer;
    const retry = () => {
      clearTimeout(timer);
      window.removeEventListener('online', retry);
      img.src = src;
    };
    img.onerror = () => {
      window.addEventListener('online', retry, { once: true });
      if (!retried && navigator.onLine) {
        retried = true;
        timer = setTimeout(retry, 500);
      }
    };
    img.onload = () => window.dispatchEvent(new Event('bridger-art-load'));
    img.src = src;
    images.set(name, img);
  }
  return images.get(name);
};
export const ready = (img) => img.complete && img.naturalWidth > 0;
