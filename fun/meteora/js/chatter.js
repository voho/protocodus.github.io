/* Meteora — the wing talks.

   Between the script's lines, Lantern Wing keeps up the chatter a real
   wing would: Saint and Wren calling their kills, swearing when they are
   hit hard, praising a streak, shouting a torpedo at one of the ships we
   protect. It is rate-limited and never talks over the story: a line is
   only spoken when the radio is free and nobody has spoken for a while.
   Lines go through the mission's own radio, so they look and sound like
   every other transmission. */

export const LINES = {
  kill: {
    saint: ['Splash one.', 'Scratch one red eye.', 'That one\'s done.', 'Down he goes.', 'Another one for the scrapyard.'],
    wren: ['Got one!', 'He\'s down!', 'Kill! Did you see that?', 'Splash!', 'Got him, got him!'],
  },
  hurt: {
    saint: ['I\'m hit. Still flying.', 'Took a hard one — I\'m all right.', 'They\'re on me, they\'re on me!'],
    wren: ['I\'m hit! I\'m okay — I think!', 'Shields gone, still in it!', 'Someone get this one off me!'],
  },
  streak: {
    saint: ['Nice shooting, Lantern.', 'Leave some for the rest of us.', 'Show-off.'],
    wren: ['Whoa — nice, Lead!', 'That was incredible!', 'How are you doing that?'],
  },
  torpedo: {
    saint: ['Torpedo on the {name}! Somebody kill it!', 'Bomb run on the {name} — shoot that thing down!'],
    wren: ['Torpedo inbound on the {name}!', 'There\'s a torpedo heading for the {name}!'],
  },
  bomber: {
    saint: ['Bombers — they\'re the priority.', 'Heavy frames, lining up. Kill them first.'],
    wren: ['Mauls! Going for the big ships!', 'Bombers inbound!'],
  },
};

export function createChatter() {
  let quietUntil = 8, lastTorpedo = -99, lastBomber = -99, seed = 3;
  const pick = list => list[(seed = (seed * 16807) % 2147483647) % list.length];
  const said = new Set();

  function speak(world, who, kind, vars = {}) {
    const rt = world.mission;
    if (!rt?.m || rt.outcome) return false;
    const now = rt.time;
    // The radio is busy, or somebody just spoke.
    if (now < quietUntil || (rt.lastLine && rt.lastLine.at + rt.lastLine.dur + 1.5 > now)) return false;
    const speaker = world.entities.find(e => e.alive && e.name === (who === 'saint' ? 'Saint' : 'Wren'));
    if (!speaker) return false;
    const text = pick(LINES[kind][who]).replace('{name}', vars.name ?? 'convoy');
    rt.m.say(who, text);
    quietUntil = now + 9;
    return true;
  }

  return {
    reset() { quietUntil = 8; lastTorpedo = -99; lastBomber = -99; said.clear(); },
    handle(e, world) {
      if (world.state !== 'flying' || !world.mission?.m) return;
      const now = world.mission.time;
      switch (e.type) {
        case 'shipKilled': {
          if (e.team !== 1 || e.by == null) break;
          const killer = world.byId.get(e.by);
          if (killer?.name === 'Saint' || killer?.name === 'Wren') {
            if ((seed * 7) % 10 < 4) speak(world, killer.name.toLowerCase(), 'kill');
            seed = (seed * 16807) % 2147483647;
          }
          break;
        }
        case 'shipHit': {
          const v = world.byId.get(e.id);
          if (!v || (v.name !== 'Saint' && v.name !== 'Wren') || !e.hull) break;
          if (v.hull < v.maxHull * 0.4 && !said.has(`hurt${v.id}`)) {
            if (speak(world, v.name.toLowerCase(), 'hurt')) said.add(`hurt${v.id}`);
          }
          break;
        }
        case 'score':
          if (e.streak === 3 || e.streak === 5) speak(world, e.streak === 3 ? 'wren' : 'saint', 'streak');
          break;
        case 'missileLaunch': {
          if (!e.torpedo || e.team !== 1 || now - lastTorpedo < 25) break;
          const t = world.byId.get(e.targetId);
          if (t && t.team === 0 && t !== world.player && speak(world, now % 2 < 1 ? 'saint' : 'wren', 'torpedo', { name: t.name })) lastTorpedo = now;
          break;
        }
        case 'foldIn': {
          const v = world.byId.get(e.id);
          if (v?.role === 'bomber' && v.team === 1 && now - lastBomber > 60 && speak(world, now % 2 < 1 ? 'wren' : 'saint', 'bomber')) lastBomber = now;
          break;
        }
      }
    },
  };
}
