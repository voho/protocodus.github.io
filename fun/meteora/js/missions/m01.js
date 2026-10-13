/* Mission 1 — Red Eye. Patrol and first contact.

   Sector Seven, where the ore tug Saint Amaro went silent. Fly to her last
   fix, scan what is left of her, find the flight recorder if you can, and
   meet whatever cut her open. Teaches flying, targeting, scanning, guns,
   missiles and the Tender. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, dir, onDeath, wave } from './kit.js';

const START = [0, 0, 0];
const ALPHA = [700, 60, -2700];
const BETA = [-1500, -120, -4200];
const HOME = [400, 180, 2600];
const PERPETUA = [400, 180, 3700];

const FIELD = belt({
  spawn: START, density: 0.9, landmarks: 4,
  clear: [{ pos: ALPHA, r: 260 }, { pos: PERPETUA, r: 950 }],
  lanes: [{ a: HOME, b: PERPETUA, r: 400 }],
});

export default defineMission({
  id: 'm01', number: 1, title: 'Red Eye', location: 'Sector Seven', dateline: 'Day 19 of the silence',
  field: FIELD, fieldSeed: 1234, seed: 101, par: 420, env: 'sector7',
  start: { pos: START, forward: dir(START, ALPHA), speed: 60 },
  area: { centre: [0, 0, -800], radius: 7000 },
  models: ['fighter', 'interceptor', 'freighter', 'perpetua', 'drone'],
  music: 'calm',
  recommend: {
    hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth',
    why: 'Balanced. You don\'t know what\'s out there yet, so bring a little of everything.',
  },
  needs: { fighters: true },
  briefing: {
    stages: [
      { text: 'Sector Seven is ore country, quiet for eleven years. Nineteen days ago the Saint Amaro went silent. Her last frame showed something looking back.', focus: ALPHA },
      { text: 'Fly to Nav Alpha, her last fix, with Saint on your wing. Scan whatever is left of her. Her flight recorder may still be pinging somewhere in the debris.', focus: ALPHA },
      { text: 'Her beacon pinged once more, two days later, near Nav Beta. Look there too. Then come home to the Perpetua.', focus: BETA },
      { text: 'Rules of engagement: weapons free if fired upon. Look, don\'t touch — until something touches you.', focus: START },
    ],
  },
  map: {
    extent: 8000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'nav', pos: ALPHA, label: 'Nav Alpha' },
      { kind: 'nav', pos: BETA, label: 'Nav Beta' }, { kind: 'capital', pos: PERPETUA, label: 'Perpetua' },
      { kind: 'unknown', pos: add(BETA, [300, 0, 500]), label: '?' },
    ],
    routes: [{ path: [START, ALPHA, BETA, HOME], kind: 'nav' }],
  },
  objectivesPreview: [
    { text: 'Fly to Nav Alpha and scan the wreck of the Saint Amaro' },
    { text: 'Investigate Nav Beta' },
    { text: 'Return to the Perpetua' },
    { text: 'Recover the flight recorder', bonus: true },
    { text: 'Saint survives', bonus: true },
  ],
  debrief: {
    won: 'The Saint Amaro was not attacked; she was harvested — cut into plates and carried off. The machines that ambushed you match nothing in the Watch\'s records: oxblood plating, red sensor eyes, no transmissions at all. Dr. Okonkwo has asked for every scrap of the wrecks you brought down. Commander Doukas has asked for something else: escorts. The ore runs from Roussanou start again tomorrow.',
    lost: 'Lantern One never came home. The Watch logged the loss as "unknown hostile action" and sent the next pilot out with a wingman more.',
  },

  setup(m) {
    const [saint] = m.wing('kestrel', 1, { names: ['Saint'], tags: ['saint'] });
    m.flag('saint', saint.id);
    m.spawn('perpetua', { team: 0, pos: PERPETUA, forward: [0, 0, -1], fixed: true, name: 'Perpetua', invulnerable: true });
    m.spawn('wreck', { team: -1, pos: ALPHA, forward: [0.4, -0.2, -1], name: 'Saint Amaro', objective: true,
      scan: { time: 3, range: 520, label: 'Wreck of the Saint Amaro' } });
    m.spawn('recorder', { team: -1, pos: add(ALPHA, [140, -30, 120]), name: 'Flight recorder',
      scan: { time: 2, range: 160, label: 'Flight recorder' } });
    // The tug's broken-off cargo, drifting.
    for (let k = 0; k < 14; k++) {
      const d = m.rng.unit([0, 0, 0]);
      m.world.field.addDynamicRock(k % 3 === 0 ? 1 : 0, add(ALPHA, d.map(v => v * m.rng.range(80, 220))), d.map(v => v * m.rng.range(0.3, 1.5)));
    }
    m.nav('alpha', 'Nav Alpha', ALPHA, { r: 450 });
    m.nav('beta', 'Nav Beta', BETA, { r: 600, hidden: true });
    m.nav('home', 'Perpetua', HOME, { r: 700, hidden: true });
  },

  *script(m) {
    const saint = m.world.byId.get(m.flags.saint);
    onDeath(m, saint, () => {
      m.fail('saint');
      m.say('doukas', 'Saint\'s beacon is down. Lantern, finish this and come home.');
    });
    m.objective('saint', 'Saint survives', { bonus: true, passOnWin: true });
    m.objective('recorder', 'Recover the flight recorder', { bonus: true });
    // The recorder can be found before anyone mentions it: the radio follows.
    let pinged = false, found = false;
    m.on('scanned', ev => {
      if (ev.label === 'Flight recorder') {
        found = true;
        m.complete('recorder');
        m.say('okonkwo', pinged
          ? 'Recorder\'s talking. Twelve minutes of cutting noise — and one clear frame of the eye. There are letters round its lens.'
          : 'A flight recorder — you found it before I had the ping. Twelve minutes of cutting noise, and one clear frame: letters round the red eye\'s lens.');
      }
    });

    yield m.say('doukas', 'Lantern One, Perpetua. Your first lead. The Saint Amaro\'s last fix is Nav Alpha. Look, don\'t touch.');
    m.hint('The mouse steers. {faster} and {slower} set your speed.');
    yield m.say('saint', 'Nineteen days. If she\'s out there, she\'s cold.');
    m.objective('alpha', 'Fly to Nav Alpha');
    m.hint('Cyan marker: Nav Alpha. {cycleNav} next nav point, {boost} afterburner.', 8);
    yield m.until(() => m.near(m.player, m.navPoint('alpha').pos, 900));
    m.complete('alpha');
    yield m.say('saint', 'There she is. Or most of her.');
    m.objective('scan', 'Scan the wreck of the Saint Amaro');
    m.target(m.get('Saint Amaro'));
    m.hint('{cycleFriendly} selects objectives. Keep the wreck ahead, within 500 m, to scan it.', 9);
    yield m.until(() => m.get('Saint Amaro')?.scan.done);
    m.complete('scan');
    yield m.say('saint', 'That hull wasn\'t shot. It was cut. Clean, like something wanted the metal.');
    if (!found) { pinged = true; m.say('okonkwo', 'There\'s a recorder pinging somewhere in that debris. Faint. Close to the wreck.'); }
    yield m.say('doukas', 'Copy, Saint. Her beacon pinged once more near Nav Beta. Take a look. Carefully.');
    m.showNav('beta');
    m.objective('beta', 'Investigate Nav Beta');

    // The ambush: as they close on Beta, or if they dawdle at Alpha.
    yield m.until(() => m.dist(m.player, BETA) < 2000 || m.time > 160);
    m.music('combat');
    const ambushAt = add(m.player.ship.pos, dir(m.player.ship.pos, BETA).map(v => v * 1300));
    const first = wave(m, 'thorn', m.n(3), add(ambushAt, [0, -150, 0]), { toward: m.player, spread: 200 });
    yield m.say('saint', 'Contacts! Three, low — unknown configuration!');
    m.say('doukas', 'Weapons free, Lantern. Weapons free!');
    m.complete('beta');
    m.objective('hostiles', 'Destroy the hostiles');
    m.hint('{cycleTarget} targets a hostile. Crosshair on the red diamond, left click.', 8);
    yield m.until(() => first.filter(e => e.alive).length <= Math.max(0, first.length - 2));
    const second = wave(m, 'thorn', m.n(2), m.offscreen(m.player, 1500), { toward: m.player });
    yield m.say('saint', 'Two more behind us — they were waiting!');
    m.hint('Keep the target ahead until it locks, then right click: missile.', 8);
    yield m.until(() => [...first, ...second].every(e => !e.alive));
    m.complete('hostiles');
    m.music('calm');
    yield m.say('saint', 'Red eyes. I\'m not sleeping tonight.');
    if (m.player.hull < m.player.maxHull * 0.5) m.hint('Hull damaged: {repair} calls a repair drone.', 8);
    yield m.say('doukas', 'Lantern, come home. I want every frame of those sensor logs on my desk.');
    m.showNav('home');
    m.objective('home', 'Return to the Perpetua');
    yield m.until(() => m.dist(m.player, HOME) < 900);
    m.complete('home');
    yield m.say('doukas', 'Lantern One, you\'re cleared to land. Good work out there.');
    m.win();
  },
});
