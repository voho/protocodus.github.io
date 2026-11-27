// Shares are by physical building piece, including foundations and roof caps.
const profiles = {
  wood:  { wood: .70, stone: .20, steel: .07, glass: .03 },
  stone: { wood: .18, stone: .70, steel: .08, glass: .04 },
  steel: { wood: .09, stone: .17, steel: .70, glass: .04 },
  glass: { wood: .06, stone: .16, steel: .08, glass: .70 },
  mixed: { wood: .31, stone: .35, steel: .21, glass: .13 },
};

export function chooseMaterialProfile(random) {
  const draws = ['wood', 'stone', 'steel', 'glass', 'mixed', 'mixed'];
  return draws[Math.floor(random() * draws.length)];
}

export function planMaterials(blocks, ward, profile, random) {
  const shares = Object.entries(profiles[profile]);
  const quota = Object.fromEntries(shares.map(([m, share]) => [m, Math.floor(blocks.length * share)]));
  const remainder = (m) => blocks.length * profiles[profile][m] - quota[m];
  const missing = blocks.length - Object.values(quota).reduce((a, b) => a + b, 0);
  for (const [m] of shares.slice().sort(([a], [b]) => remainder(b) - remainder(a)).slice(0, missing)) quota[m]++;

  const assignments = new Map();
  const candidates = [];
  const bays = ward.spans.map(() => Object.fromEntries(shares.map(([m]) => [m, random() * 2])));
  const ends = [];
  let edge = ward.left;
  for (const span of ward.spans) ends.push(edge += span);
  for (const block of blocks) {
    if (block.roofType) {
      assignments.set(block, block.material);
      quota[block.material]--;
      continue;
    }
    let bay = ends.findIndex((x) => x >= block.x);
    if (bay < 0) bay = ends.length - 1;
    const foot = block.y + block.height / 2 >= ward.base - 1;
    for (const [m] of shares) {
      let score = bays[bay][m] + random() * .8;
      if (m === block.material) score += 1.2;
      if (m === 'stone' && foot) score += 5;
      if (m === 'stone' && block.detail === 'column' && ward.style === 'pillar-hall') score += 6;
      if (m === 'steel' && block.detail === 'tie-beam') score += 3;
      if (m === 'glass' && block.detail === 'pane') score += 2;
      candidates.push({ block, m, score });
    }
  }
  // Place the best-fitting pieces first. Bay preferences give neighboring rooms
  // a common material while keeping the rolled proportions across the castle.
  candidates.sort((a, b) => b.score - a.score);
  for (const { block, m } of candidates) {
    if (quota[m] <= 0 || assignments.has(block)) continue;
    assignments.set(block, m);
    quota[m]--;
  }
  return assignments;
}
