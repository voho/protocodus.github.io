// Simulation coordinates stay in the square world grid. Only presentation uses
// this 2:1 diamond projection; all distances here use the caller's world units.
export function projectPoint(x, y) {
  return { x: x - y, y: (x + y) / 2 };
}

export function unprojectPoint(x, y) {
  return { x: y + x / 2, y: y - x / 2 };
}

// Vehicle angles are clockwise from world east. Project the direction vector,
// rather than adding a fixed rotation, because the diamond compresses depth.
export function projectAngle(angle) {
  const x = Math.cos(angle), y = Math.sin(angle);
  return Math.atan2((x + y) / 2, x - y);
}

export function projectedDepth(x, y) {
  return (x + y) / 2;
}
