import { OBJECTIVES, objectiveLabel, objectiveProgress } from './objectives.js';

// Keep one action visible until paid; end-of-sector goals follow progress goals.
export function objectiveTracker(state) {
  const goals = (state?.director?.objectives || []).filter(goal => OBJECTIVES[goal.kind]);
  if (!goals.length) return null;
  const goal = goals.find(item => !item.done && !OBJECTIVES[item.kind].final)
    || goals.find(item => !item.done);
  if (!goal) return {
    complete: true, label: 'Objectives complete', progress: `${goals.length}/${goals.length}`,
    description: `All ${goals.length} sector objectives complete.`,
  };
  const value = objectiveProgress(state, goal), final = OBJECTIVES[goal.kind].final;
  const progress = final
    ? goal.kind === 'precision' ? `${value}% / ${goal.target}%` : value ? 'On track' : 'Missed'
    : `${Math.min(value, goal.target)} / ${goal.target}`;
  const label = goal.kind === 'precision' ? 'Accuracy at sector clear' : objectiveLabel(goal);
  return {
    complete: false, label, progress,
    description: `${OBJECTIVES[goal.kind].title}: ${objectiveLabel(goal)}. ${progress}.`,
  };
}
