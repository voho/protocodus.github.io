// Presentation only. Progress, arrival times and cargo remain owned by the
// simulation; drawing, picking and camera follow share these same body poses.
export const RAIL_COACH_SPACING = 17 / 32;
const COACHES = 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function pathPoint(path, progress) {
  const index = Math.min(Math.floor(progress), path.length - 2), fraction = progress - index;
  const a = path[index], b = path[index + 1];
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

/** Three fixed bodies along a route, from its first stop toward its last.
 * Pass the already eased display progress, in path segments. The engine stays
 * at the same end of the train when travel reverses and pushes on the return.
 * The whole train moves inside the path: short routes reduce spacing while
 * retaining travel room, instead of clamping several bodies onto one point.
 * `scale` gives drawing/picking the matching short-route body size, if needed.
 * An empty path has no pose; a one-point path can show only its stationary engine.
 */
export function railConsistPoses(path, displayProgress = 0) {
  if (!Array.isArray(path) || !path.length) return null;
  const length = path.length - 1;
  if (!length) return { engine: { x: path[0].x, y: path[0].y, angle: 0, progress: 0 }, coaches: [], spacing: 0, scale: 1 };
  const progress = clamp(Number.isFinite(displayProgress) ? displayProgress : 0, 0, length);
  const span = Math.min(COACHES * RAIL_COACH_SPACING, length / 2), spacing = span / COACHES;
  const tail = (length - span) * (progress / length);
  const pose = at => {
    const point = pathPoint(path, at), rear = pathPoint(path, Math.max(0, at - spacing / 2)), front = pathPoint(path, Math.min(length, at + spacing / 2));
    return { ...point, angle: Math.atan2(front.y - rear.y, front.x - rear.x), progress: at };
  };
  return { engine: pose(tail + span), coaches: [pose(tail + spacing), pose(tail)], spacing, scale: spacing / RAIL_COACH_SPACING };
}
