// Easy preserves the original combat tuning. Higher settings increase enemy
// pressure without adding actors, changing rewards or reducing telegraph time.
export const REAL_PRESSURE = 5.7156;
const profile = (id, label, pressure, description) => Object.freeze({
  id, label, pressure, description,
  health: 1 + pressure * .12,
  damage: 1 + pressure * .65,
  shotSpeed: 1 + pressure * .22,
  fireRate: 1 + pressure * .35,
  diveRate: 1 + pressure * .35,
  diveSpeed: 1 + pressure * .1,
});
export const DIFFICULTIES = Object.freeze([
  profile('easy', 'Easy', 0, 'Room to learn.'),
  profile('medium', 'Medium', REAL_PRESSURE / 3, 'Faster attacks.'),
  profile('hard', 'Hard', REAL_PRESSURE * 2 / 3, 'Heavy fire. Harder hits.'),
  profile('real', 'Real', REAL_PRESSURE, 'Maximum pressure.'),
]);
const profiles = new Map(DIFFICULTIES.map(entry => [entry.id, entry]));
export const normalizeDifficulty = value => profiles.has(value) ? value : 'easy';
export const difficultyProfile = value => profiles.get(normalizeDifficulty(value));
