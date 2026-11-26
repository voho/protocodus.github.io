import { createMission, randomSolution } from './mission.js';

// Keep the verified designs with the river so repeated hints reuse their proofs.
let mission;
self.onmessage = ({ data: { difficulty, seed, recent } }) => {
  try {
    mission ??= createMission(difficulty, seed);
    if (recent) {
      self.postMessage(randomSolution(mission, Math.random, 600, recent));
    } else {
      const { ground, ...fields } = mission;
      self.postMessage(fields);
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
