// Adjacent entries already have the renderer's exact back-to-front order.
// A moving object may split a group at draw time; those groups use the original
// entries instead of flattening a vehicle behind a foreground building.
export function partitionScenery(objects, scale, { maxObjects = 32, maxWidth = 1280, maxPixels = 1024 * 1024 } = {}) {
  const groups = [];
  let group = null;
  const flush = () => { if (group) groups.push(group); group = null; };
  for (const object of objects) {
    const b = object.bounds;
    if (!b) { flush(); groups.push({ objects: [object], bounds: null }); continue; }
    // A diagonal has a narrow projected height. Crossing its right-to-left
    // wrap creates a mostly empty bitmap and crosses many vehicle depths.
    if (group && group.objects[0].depth !== object.depth) flush();
    const bounds = group ? {
      left: Math.min(group.bounds.left, b.left), top: Math.min(group.bounds.top, b.top),
      right: Math.max(group.bounds.right, b.right), bottom: Math.max(group.bounds.bottom, b.bottom),
    } : { ...b };
    if (group && (group.objects.length >= maxObjects || (bounds.right - bounds.left) * scale > maxWidth || (bounds.right - bounds.left) * (bounds.bottom - bounds.top) * scale * scale > maxPixels)) flush();
    if (!group) group = { objects: [], bounds: { ...b } };
    else group.bounds = bounds;
    group.objects.push(object);
  }
  flush();
  return groups;
}

// One current view, including its pan border, has a strict extra-memory cap.
// An oversized view falls back to original sprites without eviction/rebuild
// loops. Bitmaps are explicitly released when the view or world changes.
export function createSceneryBudget(limit = 96 * 1024 * 1024) {
  const images = [];
  let bytes = 0;
  return {
    allocate(width, height) {
      const size = width * height * 4;
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || bytes + size > limit) return null;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      bytes += size; images.push(canvas); return canvas;
    },
    clear() { for (const image of images) image.width = image.height = 0; images.length = 0; bytes = 0; },
    stats: () => ({ bytes, limit, surfaces: images.length }),
  };
}
