/* Meteora — every model's anchors in one map, keyed by model name.

   The Kestrel and the Thorn come from js/anchors.js (written by
   build_ships.py); every later model writes its own module in js/anchors/.
   All of them share one shape (see docs/2026-10-12-meteora-models-brief.md):
   nozzles, muzzles, RCS ports, launchers, the cockpit eye, the Tender's
   dock point, collision spheres, subsystems, turrets, launch bays, beacon
   lights and the names of animated nodes — glTF space, metres.

   `rock:N` names the belt's own asteroid N (0–4) used whole, as the Harrow
   haulers' stolen ore cores are. */

import { ANCHORS } from './anchors.js';
import { FIELD } from './config.js';
import swift from './anchors/swift.js';
import anvil from './anchors/anvil.js';
import maul from './anchors/maul.js';
import drone from './anchors/drone.js';
import torpedo from './anchors/torpedo.js';
import sentry from './anchors/sentry.js';
import seed from './anchors/seed.js';
import anchor from './anchors/anchor.js';
import shuttle from './anchors/shuttle.js';
import freighter from './anchors/freighter.js';
import station from './anchors/station.js';
import perpetua from './anchors/perpetua.js';
import colony from './anchors/colony.js';
import mother from './anchors/mother.js';
import mite from './anchors/mite.js';
import talon from './anchors/talon.js';
import warden from './anchors/warden.js';
import halberd from './anchors/halberd.js';

const EMPTY = {
  radius: 1, length: 2, nozzles: [], muzzles: [], rcs: [], launchers: [], cockpit: null, dock: null,
  colliders: [], subsystems: [], turrets: [], bays: [], lights: [], nodes: {},
};
const shape = a => ({ ...EMPTY, ...a });

export const HARDPOINTS = {
  fighter: shape({
    ...ANCHORS.fighter, length: 15.1,
    launchers: [{ name: 'launcher_0', pos: [0, -1.4, -1.5] }], dock: [0, 1.75, 1.2],
  }),
  interceptor: shape({
    ...ANCHORS.interceptor, length: 11.2,
    launchers: [{ name: 'launcher_0', pos: [0, -1.1, -1.4] }], dock: [0, 1.4, 0.8],
  }),
  swift: shape(swift), anvil: shape(anvil), maul: shape(maul), drone: shape(drone), torpedo: shape(torpedo),
  sentry: shape(sentry), seed: shape(seed), anchor: shape(anchor), shuttle: shape(shuttle),
  freighter: shape(freighter), station: shape(station), perpetua: shape(perpetua), colony: shape(colony),
  mother: shape(mother), mite: shape(mite), talon: shape(talon), warden: shape(warden), halberd: shape(halberd),
};

const rocks = new Map();
export function hardpoints(model) {
  if (HARDPOINTS[model]) return HARDPOINTS[model];
  const m = /^rock:(\d)$/.exec(model ?? '');
  if (m) {
    if (!rocks.has(model)) {
      const r = FIELD.types[Number(m[1])].radius;
      rocks.set(model, shape({ radius: r, length: 2 * r, colliders: [{ pos: [0, 0, 0], r: r * FIELD.collide }] }));
    }
    return rocks.get(model);
  }
  return shape({});
}
