// Seed generation never occupies the menu/loading screen's main thread.
import { createGame } from './sim.js';
self.onmessage = ({ data: { seed, difficulty, options } }) => {
  try { self.postMessage({ game: createGame(seed, difficulty, options) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
