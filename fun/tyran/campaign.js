// A campaign keeps its absolute sector number while the ten environments repeat.
export const ENVIRONMENT_COUNT = 10;
export const normalizeLevel = level => Number.isSafeInteger(level) && level >= 0 ? level : 0;
export const environmentIndex = level => normalizeLevel(level) % ENVIRONMENT_COUNT;
export const campaignCycle = level => Math.floor(normalizeLevel(level) / ENVIRONMENT_COUNT);

// Keep the first circuit's movement, density and timing. Later circuits increase
// enemy power and salvage with diminishing increments, never frame workload.
export const combatTier = level => Math.min(normalizeLevel(level), ENVIRONMENT_COUNT - 1);
export const cycleScale = (level, rate) => 1 + rate * Math.log2(campaignCycle(level) + 1);
