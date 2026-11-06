/* NPC reload clips have their own event fractions, unlike the shouldered
   first-person sequence. Convert those actual prop/hand events to seconds
   once at reload birth; the sound scheduler still advances in simulation. */
export function actorReloadTiming(kind, { duration, events } = {}) {
  if (!Number.isFinite(duration) || duration < 1 || !Array.isArray(events)) return null;
  const event = new Map(events.filter(e => Number.isFinite(e.t) && e.t >= 0 && e.t <= 1).map(e => [e.name, e.t * duration]));
  if (kind === 'mp40' || kind === 'thompson') {
    const names = ['mag_grab', 'mag_out', 'mag_drop', 'mag_seated', 'bolt_back'];
    if (names.some(name => !event.has(name))) return null;
    const [release, extract, drop, seated, rack] = names.map(name => event.get(name));
    if (!(release < extract && extract < drop && drop < seated && seated < rack)) return null;
    return { release, extract, drop, insert: Math.max(drop + .03, seated - .18), seated,
      pull: Math.max(seated + .04, rack - .07), rack, shut: Math.min(duration - .02, rack + .1) };
  }
  if (kind === 'kar98k') {
    const names = ['clip_in_hand', 'clip_seated', 'oprod_slap'];
    if (names.some(name => !event.has(name))) return null;
    const [clipIn, seated, lock] = names.map(name => event.get(name));
    if (!(clipIn < seated && seated < lock)) return null;
    const roundsIn = Math.max(clipIn + .04, seated - .3);
    return { lift: .18, pull: .24, clipIn, roundsIn,
      roundClicks: [0.05, .102, .154, .206].map(offset => Math.min(seated - .01, roundsIn + offset)),
      clipOut: Math.max(seated + .03, lock - .3), push: lock - .1, lock };
  }
  return null;
}
