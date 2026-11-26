import { prepareRiver } from './mission.js';

// Solve an incoming procedural link and its alternative hints before play.
self.onmessage = ({ data: seed }) => {
  try { self.postMessage(prepareRiver(seed)); }
  catch (error) { self.postMessage({ error: error.message }); }
};
