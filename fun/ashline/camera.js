// Five native-resolution steps shared by mouse, touch, keyboard and save restoration.
export function zoomLevels(nativeZoom) {
  return [.5, .625, .75, .875, 1].map(scale => nativeZoom * scale);
}

export function nearestZoom(value, levels) {
  return levels.reduce((best, level) => Math.abs(level - value) < Math.abs(best - value) ? level : best);
}

export function steppedZoom(value, direction, levels) {
  const index = levels.indexOf(nearestZoom(value, levels));
  return levels[Math.max(0, Math.min(levels.length - 1, index + Math.sign(direction)))];
}

export function cameraDirection(keys, pointer, width, height) {
  let x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  let y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  if (pointer) {
    const edge = (coordinate, extent) => coordinate < 22 ? -Math.min(1, (22 - coordinate) / 14) : coordinate > extent - 22 ? Math.min(1, (coordinate - extent + 22) / 14) : 0;
    x = Math.max(-1, Math.min(1, x + edge(pointer.x, width)));
    y = Math.max(-1, Math.min(1, y + edge(pointer.y, height)));
  }
  const magnitude = Math.max(1, Math.hypot(x, y));
  return { x: x / magnitude, y: y / magnitude };
}
