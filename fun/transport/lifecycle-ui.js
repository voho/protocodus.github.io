import { constructionState, CONSTRUCTION_MONTH_DAYS } from './building-construction.js';
import { treeLifecycle } from './tree-lifecycle.js';
import { dayText } from './formatters.js';

export const constructionTimeText = days => {
  const months = Math.ceil(days / CONSTRUCTION_MONTH_DAYS);
  return `${months} ${months === 1 ? 'month' : 'months'}`;
};

export function constructionPanelHTML(game, entity) {
  const state = constructionState(game, entity);
  if (!state) return '';
  const percent = Math.floor(state.progress * 100), phase = { excavation: 'Groundworks', frame: 'Structure taking shape', finishing: 'Finishing work' }[state.stage];
  return `<section class="building-project" aria-label="Construction" data-construction-stage="${state.stage}"><div class="project-heading"><strong>Under construction</strong><span data-num>${percent}%</span></div><div class="progress-track" role="progressbar" aria-label="Construction progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div style="width:${percent}%"></div></div><p>${phase}. Opens ${dayText(state.completeDay)}.</p><p class="micro-note">Work continues automatically while time runs. Production, amenities and rent begin when the site opens.</p></section>`;
}

export function treeLifecycleHTML(game, x, y, tile) {
  if (tile?.terrain !== 'forest' && tile?.treeClearedDay === undefined) return '';
  const state = treeLifecycle(game, x, y, tile);
  const text = state.stage === 'young' ? 'Young trees. Their crowns grow as the years pass.'
    : state.stage === 'mature' ? 'Mature woodland. Trees age naturally over about ten years.'
    : state.stage === 'old' ? 'Old woodland. Crowns thin before the trees fall.'
    : state.stage === 'fallen' ? `Fallen timber. This patch clears by ${dayText(state.clearDay)}.`
    : 'Open ground after the trees fell. New growth may return when conditions are suitable.';
  return `<p class="tree-lifecycle" data-tree-stage="${state.stage}">${text}</p>`;
}
