// One group per entity; replacing a group leaves unrelated assignments intact.
export function assignControlGroup(game, ids, group, team = 0) {
  if (!Number.isInteger(group) || group < 1 || group > 5) return [];
  const selected = new Set(ids);
  const assigned = [];
  for (const entity of game.entities) {
    if (entity.team !== team || entity.hp <= 0) continue;
    if (entity.controlGroup === group) delete entity.controlGroup;
    if (selected.has(entity.id)) {
      entity.controlGroup = group;
      assigned.push(entity.id);
    }
  }
  return assigned;
}

export function controlGroupMembers(game, group, team = 0) {
  if (!Number.isInteger(group) || group < 1 || group > 5) return [];
  return game.entities.filter(entity => entity.team === team && entity.hp > 0 && entity.controlGroup === group).map(entity => entity.id);
}
