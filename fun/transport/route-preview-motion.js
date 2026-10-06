// A draft pulses on the display clock, so it remains legible while the world is
// paused. It never vanishes, and reduced motion keeps the full-strength mark.
export function routePreviewAlpha(timestamp, reducedMotion=false) {
  if(reducedMotion)return 1;
  const now=Number.isFinite(timestamp)?timestamp:0;
  return .81+.19*Math.cos(now*Math.PI*2/1800);
}
