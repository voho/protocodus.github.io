import { listJoin, token } from './copy.js';

// DOM-free batching between the model's notice log and HUD toasts. The model
// keeps its newest 24 notices first; the HUD shows every unseen one, oldest first.
export const NOTICE_LIMIT = 24;
export const TOWN_MILESTONES = [1000, 2500, 5000, 10000];
const LEGACY_TOPICS = [[/has lost its (water )?connection|is no longer connected/, 'route-connection'], [/expanded to/, 'industry-growth']];
const names = list => list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : listJoin(list);
// A burst reads as one sentence, with its plain names from the messages (older saves' wording too) and its template from the targets.
const GROUP_TEXT = {
  'route-connection': [count => `${count} routes are no longer connected`, /^(.*?) (?:has lost its (?:water )?connection|is no longer connected)/, 'a route'],
  'industry-growth': [count => `${count} industries expanded`, /^(.*?) expanded to /, 'an industry'],
  'route-supply': [count => `${count} routes lost a supplier or buyer`, /^(.*?) lost its /, 'a route'],
};
function groupText(topic, members) {
  const [lead, pattern, unnamed] = GROUP_TEXT[topic], ids = members.map(notice => notice.target?.id);
  const message = `${lead(members.length)}: ${names(members.map(notice => notice.message.match(pattern)?.[1] || unnamed))}.`;
  return ids.every(Boolean) ? { message, template: `${lead(members.length)}: ${names(members.map(notice => token(notice.target.kind === 'city' ? 'town' : notice.target.kind, notice.target.id)))}.` } : { message };
}

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
    return { ...members.length > 1 ? groupText(topic, members) : { message: members[0].message, ...members[0].template ? { template: members[0].template } : {} }, type: members.some(notice => notice.type === 'warning') ? 'warning' : members.at(-1).type, topic, day: members.at(-1).day, count: members.length, targets: members.map(notice => notice.target).filter(Boolean) };
  });
}

/** The highest resident threshold reached since the town's recorded peak, or 0. */
export function crossedMilestone(peak, population) { return TOWN_MILESTONES.filter(n => peak < n && population >= n).at(-1) || 0; }

/** A below-zero month toasts when the streak begins and each January; News keeps every one. */
export function creditToast(notice, history) {
  const index = history.findIndex(entry => entry.day === notice.day);
  return index < 1 || history[index - 1].money >= 0 || history[index].month % 12 === 11;
}

export function newYearNotice(year, rate, { generation = true } = {}) { return generation ? `New for ${year}: vehicles carry 20% more and run 10% faster. Prices rise ${(rate * 100).toFixed(1)}% this year.` : `Prices rise ${(rate * 100).toFixed(1)}% in ${year}.`; }
