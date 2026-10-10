// Prefer background generation when the browser allows module workers.
import { createGame } from './sim.js';
// The game's typed grids (terrain, minerals, fog, navigation) move to the page instead of being copied; this worker
// never touches the generated game again.
export const transferables = game => [...new Set(Object.values(game)
  .flatMap(value => Array.isArray(value) ? value : [value])
  .filter(value => ArrayBuffer.isView(value))
  .map(view => view.buffer))];
self.onmessage = ({ data: { seed, difficulty, options } }) => {
  try { const game = createGame(seed, difficulty, options); self.postMessage({ game }, transferables(game)); }
  catch (error) { self.postMessage({ error: error.message }); }
};
