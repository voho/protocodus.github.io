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

// Local length/width axes of a horizontal surface pointing at a screen angle.
// Unlike a screen rotation, this preserves the ground's 2:1 foreshortening.
// Screen-horizontal length is the unit reference; depth-facing length is half.
export function projectedGroundBasis(screenAngle) {
  const direction=unprojectPoint(Math.cos(screenAngle),Math.sin(screenAngle));
  const length=Math.hypot(direction.x,direction.y),x=direction.x/length,y=direction.y/length;
  const along=projectPoint(x,y),across=projectPoint(-y,x),scale=Math.SQRT1_2;
  return {a:along.x*scale,b:along.y*scale,c:across.x*scale,d:across.y*scale};
}

export function projectedDepth(x, y) {
  return (x + y) / 2;
}
