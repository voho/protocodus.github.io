// Unit character for the command interface: deterministic callsigns, short comms barks and rival
// intercepts. This is presentation only. It reads the game without changing it, never touches the
// simulation random stream, and only ever names friendly units or enemies the player currently sees.
import { hash } from './terrain.js';
import { UNITS, unitRole, center } from './sim.js';
import { DOCTRINES } from './ai.js';

const SQUADS = ['Harrier', 'Cinder', 'Lantern', 'Juniper', 'Basalt', 'Magpie', 'Tinder', 'Rook', 'Thistle', 'Pilgrim', 'Corvid', 'Heron', 'Wicket', 'Spindle', 'Larkspur', 'Furrow', 'Quarry', 'Sable', 'Tallow', 'Vesper', 'Marten', 'Osprey', 'Bramble', 'Flint', 'Copper', 'Gannet', 'Hollow', 'Sorrel'];
// The Vael carry launcher teams; given names are built from clan syllables, family from the crest line.
const VAEL_FIRST = ['Ka', 'Tir', 'Os', 'Ve', 'Ith', 'Mor', 'Sa', 'Ul', 'Ny', 'Re', 'Va', 'Esh'];
const VAEL_LAST = ['rath', 'vesh', 'suun', 'khal', 'onn', 'ith', 'arr', 'el', 'oth', 'ir'];
const VAEL_CLANS = ['Ashcrest', 'Twincrest', 'Duskhollow', 'Cinderfell', 'Greymantle', 'Saltreach', 'Stillwater', 'Highcrest', 'Emberveil', 'Longstride'];
const CREW_ADJECTIVES = ['Old', 'Rusty', 'Iron', 'Steady', 'Lucky', 'Stubborn', 'Dusty', 'Faithful', 'Creaky', 'Patient', 'Sooty', 'Grumbling', 'Brass', 'Tin'];
const CREW_NOUNS = {
  scout: ['Jackrabbit', 'Dustdevil', 'Whippet', 'Hornet', 'Gadfly', 'Rattler', 'Skipjack', 'Wren', 'Mayfly', 'Swift'],
  tank: ['Kettle', 'Anvil', 'Samovar', 'Tortoise', 'Ox', 'Bulldog', 'Bear', 'Hammer', 'Matron', 'Boiler'],
  artillery: ['Howler', 'Stovepipe', 'Longneck', 'Thunderer', 'Grandmother', 'Foghorn', 'Steeple', 'Crane', 'Belltower', 'Bellows'],
  striker: ['Pike', 'Lancer', 'Jackal', 'Ferret', 'Stoat', 'Weasel', 'Sparrowhawk', 'Rapier', 'Harrow', 'Dart'],
  engineer: ['Wrench', 'Spanner', 'Tinker', 'Ratchet', 'Solder', 'Bodger', 'Crowbar', 'Oilcan', 'Rivet', 'Mallet'],
  harvester: ['Mule', 'Bucket', 'Hopper', 'Barrow', 'Packhorse', 'Dray', 'Scoop', 'Shovel', 'Carthorse', 'Trough'],
  constructor: ['Claim', 'Charter', 'Beacon', 'Homestead', 'Ledger', 'Foothold', 'Hearth', 'Waypoint', 'Deed', 'Lodestone'],
};
// AI Unity numbers its machines by cohort and unit; the prefix follows the printed chassis family.
const UNITY_CLASSES = { rifle: 'Cohort', rocket: 'Breach', scout: 'Veil', tank: 'Bastion', artillery: 'Arc', striker: 'Talon', engineer: 'Mender', harvester: 'Prism', constructor: 'Mainframe' };

const gcd = (a, b) => b ? gcd(b, a % b) : a;
// Each naming pool is walked as a seeded permutation of unit ids: offset + id × stride over the pool's
// combinations, with a stride coprime to the pool size. Ids closer together than the pool size can
// never share a name, so two squads raised in the same match do not answer to the same callsign.
function designation(game, unit, pool, size) {
  const key = hash(`${game.seed}:${pool}`), offset = key % size;
  let stride = 1 + (key >>> 11) % (size - 1);
  while (gcd(stride, size) !== 1) stride++;
  return (offset + unit.id * stride) % size;
}
const parts = (index, ...lists) => lists.map(list => { const value = list[index % list.length]; index = Math.floor(index / list.length); return value; });

// The same seed and entity id always give the same name, so callsigns survive save and load
// without being stored.
export function callsign(game, unit) {
  const d = UNITS[unit?.type];
  if (!d || !game || !Number.isInteger(unit.id)) return '';
  const role = unitRole(unit);
  if (d.race === 'aiUnity') {
    const [cohort, serial] = parts(designation(game, unit, `unity:${role}`, 12 * 90), Array.from({ length: 12 }, (_, i) => i + 1), Array.from({ length: 90 }, (_, i) => i + 10));
    return `${Object.hasOwn(UNITY_CLASSES, role) ? UNITY_CLASSES[role] : 'Unit'} ${cohort}-${serial}`;
  }
  if (role === 'rifle') { const [name, number] = parts(designation(game, unit, 'squad', SQUADS.length * 9), SQUADS, [1, 2, 3, 4, 5, 6, 7, 8, 9]); return `${name} ${number}`; }
  if (role === 'rocket') { const [first, last, clan] = parts(designation(game, unit, 'vael', VAEL_FIRST.length * VAEL_LAST.length * VAEL_CLANS.length), VAEL_FIRST, VAEL_LAST, VAEL_CLANS); return `${first}${last} ${clan}`; }
  const nouns = Object.hasOwn(CREW_NOUNS, role) ? CREW_NOUNS[role] : CREW_NOUNS.tank, [adjective, noun] = parts(designation(game, unit, `crew:${role}`, CREW_ADJECTIVES.length * nouns.length), CREW_ADJECTIVES, nouns);
  return `${adjective} ${noun}`;
}

export const BARK_CONTEXTS = ['select', 'move', 'attack', 'attackMove', 'ready', 'promotion', 'ability', 'explore', 'harvest', 'annoyed'];
const BARKS = {
  human: {
    select: ['Squad standing by.', 'Go ahead, command.', 'Rifles ready.', 'We are on the line.', 'Listening.'],
    move: ['Moving out.', 'On our way.', 'Copy, relocating.', 'Shifting position.', 'Boots moving.'],
    attack: ['Engaging.', 'Target in sight.', 'Weapons free.', 'Putting rounds on it.'],
    attackMove: ['Advancing, eyes open.', 'Pushing forward.', 'Sweeping ahead.'],
    ready: ['Squad formed up.', 'Fresh rifles, reporting.', 'Reporting for the line.'],
    promotion: ['Another stripe. Same mud.', 'Promotion noted. Drinks later.', 'We earned this one.'],
    ability: ['Digging in.', 'Holding this ground.', 'Sandbags up.'],
    explore: ['Scouting the ash.', 'Walking the far ridges.'],
    annoyed: ['Still here, command.', 'We heard you the first time.', 'Ash in the radio again?'],
  },
  vael: {
    select: ['The crest listens.', 'Launchers ready, kin.', 'Speak, and we strike.'],
    move: ['We walk.', 'Stride long.', 'The crest moves.'],
    attack: ['Prey marked.', 'Loose the tube.', 'Burn it down.'],
    attackMove: ['We hunt forward.', 'The kin advance.'],
    ready: ['Crest raised. We are here.', 'Kin assembled.'],
    promotion: ['The clan will sing of this.', 'A new mark on the crest.'],
    ability: ['Long tube, long reach.', 'Sighting far.'],
    explore: ['We seek the far ash.'],
    annoyed: ['The kin are patient. Mostly.', 'Twice-crested, once-asked.'],
  },
  crew: {
    select: ['Engine is warm.', 'Crew here.', 'The old girl is listening.', 'Standing by, hatch open.'],
    move: ['Treads turning.', 'Rolling.', 'Gears in, moving.', 'Heading out.'],
    attack: ['Gun is laid.', 'Firing.', 'Target under the sights.'],
    attackMove: ['Rolling hot.', 'Advancing, gun up.'],
    ready: ['Off the line, fuel topped.', 'Engine warm, gauges green.', 'Crew aboard and rolling.'],
    promotion: ['Paint another ring on the barrel.', 'The old girl is earning her keep.'],
    ability: ['Opening her up.', 'Pushing past the governor.', 'Patch kit out.'],
    explore: ['Taking a look past the ridge.'],
    harvest: ['Hopper open.', 'Back to the seams.'],
    annoyed: ['She is old, not deaf.', 'Mind the clutch, command.'],
  },
  unity: {
    select: ['Unit online.', 'Awaiting directive.', 'Channel open.', 'Listening.'],
    move: ['Vector accepted.', 'Relocating.', 'Path computed.', 'Moving.'],
    attack: ['Target designated.', 'Engaging.', 'Firing solution locked.'],
    attackMove: ['Sweep pattern engaged.', 'Advancing under protocol.'],
    ready: ['Assembly complete.', 'Printed and calibrated.', 'Cohort member online.'],
    promotion: ['Combat model updated.', 'Algorithm iteration accepted.'],
    ability: ['Protocol engaged.', 'Overriding limits.'],
    explore: ['Survey routine active.'],
    harvest: ['Extraction loop resumed.'],
    annoyed: ['Redundant query.', 'Directive already logged.', 'Input repeated. Logging.'],
  },
};

export function barkVoice(type) {
  const d = UNITS[type];
  if (!d) return null;
  if (d.race === 'aiUnity') return 'unity';
  const role = unitRole(type);
  return role === 'rifle' ? 'human' : role === 'rocket' ? 'vael' : 'crew';
}

// A line for the unit's race, role and context. `sequence` rotates through the pool without randomness.
export function barkLine(type, context, sequence = 0) {
  const voice = BARKS[barkVoice(type)];
  if (!voice) return '';
  const pool = Object.hasOwn(voice, context) ? voice[context] : context === 'harvest' ? voice.move : voice.select;
  return pool[(hash(`${type}:${context}`) + sequence) % pool.length];
}

// The commander named in intercepts: the rival AI's doctrine commander, or null for a side no AI commands.
export function rivalCommander(game, team = 1) {
  if (!(game?.aiTeams ?? [1]).includes(team)) return null;
  const doctrine = (team === 1 ? game.ai : game.aiByTeam?.[team])?.doctrine;
  return (Object.hasOwn(DOCTRINES, doctrine ?? '') ? DOCTRINES[doctrine] : DOCTRINES.balanced)?.commander || null;
}

// A column is at least `minimum` armed enemy units the player sees right now, each heading for a
// friendly structure within `reach` tiles or already within `close` tiles of one. Only current
// vision is read, so remembered or hidden forces never raise an intercept.
export function approachingColumn(game, { team = 0, minimum = 5, reach = 20, close = 10 } = {}) {
  const visible = game.visible?.[team];
  if (!visible) return null;
  const structures = [], contacts = [];
  for (const e of game.entities) {
    if (e.hp <= 0) continue;
    if (e.team === team) { if (e.kind === 'building') structures.push(center(e)); continue; }
    if (e.kind !== 'unit' || !(UNITS[e.type]?.damage > 0)) continue;
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (x >= 0 && y >= 0 && x < game.width && y < game.height && visible[y * game.width + x]) contacts.push(e);
  }
  if (contacts.length < minimum || !structures.length) return null;
  const column = contacts.filter(e => {
    let best = null, bestDistance = Infinity;
    for (const p of structures) { const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < bestDistance) { bestDistance = d; best = p; } }
    if (bestDistance <= close) return true;
    if (bestDistance > reach) return false;
    return (Math.cos(e.angle) * (best.x - e.x) + Math.sin(e.angle) * (best.y - e.y)) / bestDistance >= .5;
  });
  if (column.length < minimum) return null;
  const x = column.reduce((sum, e) => sum + e.x, 0) / column.length, y = column.reduce((sum, e) => sum + e.y, 0) / column.length;
  // The alert points at the threatened friendly structure, never at the hostile column itself.
  const target = structures.reduce((best, p) => Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best);
  return { count: column.length, x, y, target, ids: column.map(e => e.id) };
}
