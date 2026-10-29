// Aim for a smooth 60 Hz flight even when its very first frames are slow.
// A measured 30 fps launch must not become the controller's quality target.
export function adaptiveResolutionScale(scale, frameMs, fastestFrameMs, renderMs, secondsSinceChange) {
  const cadence = Math.min(1000 / 60, fastestFrameMs);
  if (secondsSinceChange > 4 && frameMs > Math.max(25, cadence * 1.55) && scale > .7) {
    return Math.max(.7, Math.round((scale - .1) * 100) / 100);
  }
  if (secondsSinceChange > 12 && frameMs < Math.max(18, cadence * 1.15) && renderMs < 7 && scale < 1) {
    return Math.min(1, Math.round((scale + .05) * 100) / 100);
  }
  return scale;
}
