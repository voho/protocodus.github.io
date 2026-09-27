// DOM-free batching between the model's notice log and HUD toasts. The model
// keeps its newest 24 notices first; the HUD shows every unseen one, oldest first.
export const NOTICE_LIMIT = 24;
export const TOWN_MILESTONES = [1000, 2500, 5000, 10000];
const LEGACY_TOPICS = [[/has lost its (water )?connection/, 'route-connection'], [/expanded to/, 'industry-growth']];
const names = list => list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '';
const GROUP_TEXT = {
  'route-connection': group => `${group.length} routes lost their connection: ${names(group.map(notice => notice.message.match(/^(.*) has lost its (water )?connection/)?.[1] || 'a route'))}`,
  'industry-growth': group => `${group.length} industries expanded`,
};

/** Older saves have no topics; their fixed wording still identifies a burst. */
export function noticeTopic(notice) { return notice.topic || LEGACY_TOPICS.find(([pattern]) => pattern.test(notice.message))?.[1] || ''; }

export function toastType(type) { return type === 'warning' || type === 'error' || type === 'milestone' ? type : 'ok'; }

/** Unseen notices, oldest first. A last id missing from the log shows only the newest six. */
export function collectNotices(notifications, lastId, max = NOTICE_LIMIT) {
  const list = notifications || [], limit = list.some(notice => notice.id === lastId) ? max : Math.min(6, max), fresh = [];
  for (const notice of list) { if (notice.id === lastId || fresh.length >= limit) break; fresh.push(notice); }
  return fresh.reverse();
}

/** One entry per burst of a groupable topic, placed at its oldest notice. */
export function groupNotices(list) {
  const groups = new Map(), entries = [];
  for (const notice of list) {
    const topic = noticeTopic(notice), groupable = Boolean(GROUP_TEXT[topic]);
    if (groupable && groups.has(topic)) { groups.get(topic).push(notice); continue; }
    const members = [notice]; if (groupable) groups.set(topic, members);
    entries.push(members);
  }
  return entries.map(members => {
    const topic = noticeTopic(members[0]);
    return { message: members.length > 1 ? GROUP_TEXT[topic](members) : members[0].message, type: members.some(notice => notice.type === 'warning') ? 'warning' : members.at(-1).type, topic, day: members.at(-1).day, count: members.length, targets: members.map(notice => notice.target).filter(Boolean) };
  });
}

/** The highest resident threshold reached since the town's recorded peak, or 0. */
export function crossedMilestone(peak, population) { return TOWN_MILESTONES.filter(n => peak < n && population >= n).at(-1) || 0; }

export function newYearNotice(year, rate) { return `${year} · Generation ${year - 1949} vehicles: +20% capacity, +10% speed · prices +${(rate * 100).toFixed(1)}% this year`; }
