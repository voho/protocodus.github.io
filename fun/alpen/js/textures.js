/* One photograph, one decode, one upload.

   Four modules on this mountain wear the same two plates. The jacket weave
   is on the rider and on every other skier on the piste; the slate is the
   boulders' stone, the huts' plinths and chimneys, and the gondola's
   weathered steel. Each module used to ask its own `TextureLoader` for the
   file, and a loader asked twice fetches twice, decodes twice and — the part
   that costs — uploads twice: two copies of the same 1024² image in video
   memory, and two decodes on the main thread during the load the title card
   is already waiting on. The browser's HTTP cache saves the second fetch and
   nothing else.

   So the first caller loads it and everybody gets the same `Texture`. The
   settings are the ones every caller wanted anyway — these are photographs,
   so sRGB; they tile, so repeat; and they are seen across a slope at a
   grazing angle, so anisotropic — and they are set on the object before the
   image arrives, which is when three reads them.

   `ready` is for the callers that swap a uniform from a neutral placeholder
   only once the picture exists, so a surface never samples an image-less
   texture in the frames before it lands. It runs at once if the plate is
   already here. The cache is keyed by the loader class as well as the URL,
   so a test that hands a module a stub namespace never gets a texture made
   by the real one, or the other way round. */
const cache = new Map();

export function sharedTexture(THREE, url, ready = null) {
  let entry = cache.get(url);
  if (!entry || entry.loader !== THREE.TextureLoader) {
    entry = { loader: THREE.TextureLoader, texture: null, loaded: false, waiting: [] };
    cache.set(url, entry);
    const e = entry;
    e.texture = new THREE.TextureLoader().load(url, (t) => {
      e.loaded = true;
      for (const fn of e.waiting) fn(t);
      e.waiting.length = 0;
    });
    e.texture.wrapS = e.texture.wrapT = THREE.RepeatWrapping;
    e.texture.colorSpace = THREE.SRGBColorSpace;
    e.texture.anisotropy = 8;
  }
  if (ready) {
    if (entry.loaded) ready(entry.texture);
    else entry.waiting.push(ready);
  }
  return entry.texture;
}
