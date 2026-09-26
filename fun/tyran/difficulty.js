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
  profile('easy', 'Easy', 0, 'The original balance. Room to learn and explore.'),
  profile('medium', 'Medium', REAL_PRESSURE / 3, 'Faster attacks and less room for mistakes.'),
  profile('hard', 'Hard', REAL_PRESSURE * 2 / 3, 'Relentless fire and punishing enemy hits.'),
  profile('real', 'Real', REAL_PRESSURE, 'The toughest flight. Precise dodging and careful upgrades.'),
]);
const profiles = new Map(DIFFICULTIES.map(entry => [entry.id, entry]));
export const normalizeDifficulty = value => profiles.has(value) ? value : 'easy';
export const difficultyProfile = value => profiles.get(normalizeDifficulty(value));
