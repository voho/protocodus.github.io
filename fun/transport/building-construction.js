import { BUILDINGS } from './buildings.js';
import { INDUSTRIES } from './data.js';
import { buildingTiles } from './building-sites.js';
import { industryTiles } from './industry-sites.js';
import { noteSiteChanges } from './change-journal.js';

export const CONSTRUCTION_MONTH_DAYS = 30;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const COMPLEX_MONTHS = Object.freeze({ hospital: 8, stadium: 10, ballpark: 8, church: 6, school: 6, 'town-hall': 6, 'sports-hall': 6, 'swimming-pool': 5, 'service-bank': 5, 'service-hotel': 6, 'mall-neighborhood': 6, 'mall-shopping': 8, 'mall-modern': 10 });

/** Calendar time for a new project. Existing generated buildings have no project and stay complete. */
export function constructionDuration(kind, { level = 1, footprint } = {}) {
  let months;
  if (Object.hasOwn(INDUSTRIES, kind)) {
    const definition = INDUSTRIES[kind];
    months = definition.farming || kind === 'farm' || kind === 'logging-camp' ? 6
      : kind === 'fishery' || kind === 'sand-pit' || kind === 'quarry' ? 7
      : /mine|oil-well/.test(kind) ? 9
      : /refinery|steel|equipment|chemical|power/.test(kind) ? 12 : 10;
  } else if (kind === 'factory' || kind === 'workshop') months = 6 + (Math.floor(level) - 1) * 2;
  else {
    const definition = BUILDINGS[kind], size = footprint || definition?.footprint || 1;
    months = COMPLEX_MONTHS[kind] ?? (definition?.group === 'homes'
      ? kind.startsWith('house-cheap') ? 2 : kind.startsWith('house-expensive') ? 4 : 3
      : definition?.naturalCover || ['park', 'playground', 'sports-field', 'tennis-courts'].includes(kind) ? 2
      : size >= 3 ? 8 : size >= 2 ? 5 : 3);
  }
  return clamp(Math.round(months), 2, 12) * CONSTRUCTION_MONTH_DAYS;
}

export const isUnderConstruction = entity => Boolean(entity?.construction);

/** Pure presentation state; progress follows game time, so pause also pauses every project. */
export function constructionState(game, entity) {
  const project = entity?.construction;
  if (!project) return null;
  const totalDays = project.completeDay - project.startedDay;
  const progress = clamp((game.day - project.startedDay) / totalDays, 0, 1);
  const stage = progress < .3 ? 'excavation' : progress < .8 ? 'frame' : 'finishing';
  return { startedDay: project.startedDay, completeDay: project.completeDay, totalDays, progress, stage, remainingDays: Math.max(0, Math.ceil(project.completeDay - game.day)) };
}
export const constructionStatus = constructionState;

// Only live projects are walked daily. World-sized tile scans happen once on hydration,
// or after Undo replaces saved building objects; the normal daily loop stays sparse.
const projects = new WeakMap();
export function initializeBuildingConstruction(game, { empty = false } = {}) {
  const index = { tiles: game.tiles, buildings: new Map(), industries: new Map() };
  if (!empty) {
    for (let i = 0; i < game.tiles.length; i++) {
      const entity = game.tiles[i].building;
      if (isUnderConstruction(entity)) index.buildings.set(i, { entity, stage: constructionState(game, entity).stage });
    }
    for (const entity of game.industries) if (isUnderConstruction(entity)) index.industries.set(entity.id, { entity, stage: constructionState(game, entity).stage });
  }
  projects.set(game, index);
  return index;
}
export const invalidateConstructionIndex = game => projects.delete(game);
function projectIndex(game) {
  const index = projects.get(game);
  return index?.tiles === game.tiles ? index : initializeBuildingConstruction(game);
}

/** The normal footprint is reserved immediately; its economic effects begin only at completion. */
export function startConstruction(game, entity, { x = entity.x, y = entity.y, populationGain = 0, populationCityId = entity.populationCityId, suppliesGain = 0, activityGain = 0, benefitCityId } = {}) {
  const index = projectIndex(game), startedDay = Math.floor(game.day);
  entity.construction = { startedDay, completeDay: startedDay + constructionDuration(entity.kind, entity),
    ...(populationGain > 0 && populationCityId ? { populationGain, populationCityId } : {}),
    ...(suppliesGain > 0 ? { suppliesGain } : {}), ...(activityGain > 0 ? { activityGain } : {}),
    ...((suppliesGain > 0 || activityGain > 0) && benefitCityId ? { benefitCityId } : {}) };
  const entry = { entity, stage: 'excavation' };
  if (Object.hasOwn(INDUSTRIES, entity.kind)) index.industries.set(entity.id, entry);
  else index.buildings.set(y * game.width + x, entry);
  return entity.construction;
}

/** Complete before the day's production. A factory never catches up months of unbuilt output. */
export function stepBuildingConstruction(game, notify = () => {}) {
  const index = projectIndex(game), day = Math.floor(game.day), touched = [], industryById = new Map(game.industries.map(entity => [entity.id, entity]));
  let completed = 0, industryChanged = false;
  for (const [entries, industry] of [[index.buildings, false], [index.industries, true]]) for (const [key, entry] of entries) {
    const entity = industry ? industryById.get(key) : game.tiles[key]?.building;
    if (entity !== entry.entity || !isUnderConstruction(entity)) { entries.delete(key); continue; }
    const state = constructionState(game, entity), x = industry ? entity.x : key % game.width, y = industry ? entity.y : Math.floor(key / game.width);
    if (day < state.completeDay && state.stage === entry.stage) continue;
    entry.stage = state.stage;
    const points = industry ? industryTiles(entity) : buildingTiles({ x, y, building: entity });
    for (const point of points) touched.push(point.y * game.width + point.x);
    if (industry) industryChanged = true;
    if (day < state.completeDay) continue;
    const project = entity.construction;
    const town = game.cities.find(city => city.id === project.populationCityId);
    if (town) town.population += project.populationGain || 0;
    const beneficiary = game.cities.find(city => city.id === project.benefitCityId);
    if (beneficiary) { beneficiary.supplies += project.suppliesGain || 0; beneficiary.activity += project.activityGain || 0; }
    delete entity.construction;
    if (industry) {
      entity.openedDay = day; entity.lastProductionDay = day; entity.nextProductionDay = day + 1; entity.nextReviewDay = day + 30;
      entity.production = 0; entity.idleDays = 0;
    }
    entries.delete(key); completed++;
    if (industry || entity.owner === 'player') {
      const name = industry ? entity.name : entity.kind === 'factory' ? 'Workshop' : BUILDINGS[entity.kind]?.name || 'Building';
      notify(game, `${name} completed and opened.`, 'success', industry ? { topic: 'industry-opening', target: { kind: 'industry', id: entity.id } } : undefined);
    }
  }
  if (touched.length) {
    const from = game.revision || 0; game.revision = from + 1;
    if (!industryChanged) noteSiteChanges(game, from, game.revision, touched);
  }
  return completed;
}

/** Strict, optional metadata keeps all older buildings complete and rejects impossible deadlines. */
export function validBuildingConstruction(game, entity) {
  if (entity?.construction === undefined) return true;
  const project = entity.construction;
  if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
  const allowed = new Set(['startedDay', 'completeDay', 'populationGain', 'populationCityId', 'suppliesGain', 'activityGain', 'benefitCityId']);
  if (Object.keys(project).some(key => !allowed.has(key))) return false;
  if (!Number.isInteger(project.startedDay) || project.startedDay < 0 || project.startedDay > game.day || !Number.isInteger(project.completeDay) || project.completeDay <= game.day || project.completeDay - project.startedDay !== constructionDuration(entity.kind, entity)) return false;
  for (const key of ['populationGain', 'suppliesGain', 'activityGain']) if (project[key] !== undefined && (!Number.isFinite(project[key]) || project[key] <= 0 || project[key] > 10000)) return false;
  for (const key of ['populationCityId', 'benefitCityId']) if (project[key] !== undefined && !game.cities.some(city => city?.id === project[key])) return false;
  if (project.populationGain !== undefined && !project.populationCityId) return false;
  if ((project.suppliesGain !== undefined || project.activityGain !== undefined) && !project.benefitCityId) return false;
  if (Object.hasOwn(INDUSTRIES, entity.kind) && (Object.keys(project).length !== 2 || entity.openedDay !== undefined)) return false;
  return true;
}
