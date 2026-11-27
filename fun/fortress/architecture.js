// Each band names its use, relative frontage and fraction of the tallest roof.
// Even a small castle has every band; larger castles widen them into several bays.
const plans = {
  'linked-towers': [['tower', 3, 1], ['gallery', 1, 0.52], ['tower', 2, 0.82]],
  gatehouse: [['tower', 1, 0.70], ['court', 1, 0.22], ['keep', 3, 1], ['court', 1, 0.22], ['tower', 1, 0.61]],
  'pillar-hall': [['tower', 1, 0.68], ['hall', 3, 0.75], ['hall', 2, 1], ['hall', 2, 0.75]],
  'stair-tower': [['hall', 2, 0.27], ['gallery', 2, 0.45], ['tower', 2, 0.72], ['stair', 2, 1]],
  'curtain-keep': [['tower', 1, 0.57], ['wall', 3, 0.24], ['keep', 3, 1], ['wall', 2, 0.24], ['tower', 1, 0.45]],
  spire: [['court', 2, 0.20], ['gallery', 2, 0.40], ['tower', 1, 1], ['gallery', 2, 0.55], ['court', 2, 0.20]],
  citadel: [['wall', 2, 0.42], ['keep', 3, 0.82], ['tower', 2, 1], ['keep', 2, 0.73], ['wall', 2, 0.42]],
};
export const FORTRESS_STYLES = Object.keys(plans);

export function planArchitecture(random, spans, peak, requestedStyle) {
  const style = FORTRESS_STYLES.includes(requestedStyle)
    ? requestedStyle : FORTRESS_STYLES[Math.floor(random() * FORTRESS_STYLES.length)];
  const bands = plans[style];
  const weights = bands.map(([, frontage]) => frontage * (0.8 + random() * 0.4));
  const counts = bands.map(() => 1);
  for (let i = bands.length; i < spans.length; i++) {
    let widest = 0;
    for (let b = 1; b < counts.length; b++) {
      if (weights[b] / counts[b] > weights[widest] / counts[widest]) widest = b;
    }
    counts[widest]++;
  }
  const zones = [], heights = [];
  for (const [i, [zone, , rise]] of bands.entries()) {
    const height = Math.max(1, Math.round(peak * (rise === 1 ? 1 : rise * (0.9 + random() * 0.2))));
    for (let bay = 0; bay < counts[i]; bay++) {
      zones.push(zone);
      heights.push(height + (style === 'spire' && rise === 1 ? 2 : 0));
    }
  }
  if (random() < 0.5) { zones.reverse(); heights.reverse(); }
  const openFloors = Array(zones.length).fill(0);
  const middle = Math.floor(zones.length / 2);
  let gate = middle;
  if (style === 'linked-towers') {
    gate = zones.indexOf('gallery');
    // The gallery's lowest deck bridges the two towers, leaving a real passage beneath.
    openFloors[gate] = Math.max(1, heights[gate] - 1);
    heights[gate] = openFloors[gate] + 1;
  }
  const stairBay = heights.indexOf(Math.max(...heights));
  return { style, zones, heights, openFloors, gate, stairBay };
}
