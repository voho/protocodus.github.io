/* The campaign's three movements. Briefings state the job and its stakes;
   the tactical card stays visible while choosing a difficulty/loadout.
   `fails` is everything that loses the mission, in one sentence, shown
   under the objectives in the briefing and on the pause screen: it has to
   be kept true to the mission's script. */
export const OPERATIONS = {
  m01: { act: 'I · The silence', role: 'Search & first contact', pace: 'A quiet patrol becomes a fighting withdrawal.',
    stakes: 'Find the missing tug. Bring back proof, and bring Saint home.',
    tactic: 'Search the wreck before leaving. Keep your wing close when contacts appear.',
    fails: 'You are shot down. Nothing else ends this patrol early.' },
  m02: { act: 'I · The silence', role: 'Convoy escort', pace: 'Moving defense, a blocked lane, then a sprint home.',
    stakes: 'The ore in these holds becomes air, water and hull plate for Varlaam.',
    tactic: 'Raiders split their attacks. Clear the lane while your wing screens the Mules.',
    fails: 'Two Mules are destroyed, or you are shot down.' },
  m03: { act: 'I · The silence', role: 'Silent reconnaissance', pace: 'Choose your route, collect intelligence, escape pursuit.',
    stakes: 'Learn what is building the Harrow before it learns where we live.',
    tactic: 'Cold engines and rock cover beat the Eyes. Wren waits beyond the sensor net.',
    fails: 'You miss the fold point once the countdown starts, or you are shot down.' },
  m04: { act: 'II · A home under siege', role: 'Orbital demolition', pace: 'A race against hatching clocks becomes an interception.',
    stakes: 'Wren can see her childhood home through the gunsight.',
    tactic: 'Choose the oldest seeds first. Listen for ignition warnings; your wing handles the screen.',
    fails: 'Varlaam is destroyed or takes a second seed impact, or you are shot down.' },
  m05: { act: 'II · A home under siege', role: 'Evacuation & rescue', pace: 'Open-space interception with lives moving through the crossfire.',
    stakes: 'Hold the door until the people of Varlaam are through it.',
    tactic: 'Bombers threaten the reactor; raiders threaten the shuttles. A living wingman is worth a kill.',
    fails: 'Varlaam’s reactor is destroyed, more than two Skiffs are lost, or you are shot down.' },
  m06: { act: 'II · A home under siege', role: 'Carrier defense', pace: 'Eclipse, bomber feints and an emergency repair window.',
    stakes: 'Varlaam is aboard the Perpetua now. This is their home a second time.',
    tactic: 'Guard the engines. Fast interceptions create time to cover the repair crew.',
    fails: 'The Perpetua is destroyed or loses a second engine, or you are shot down.' },
  m07: { act: 'II · A home under siege', role: 'Supply interdiction', pace: 'Open-space pursuit while an ace hunts the hunters.',
    stakes: 'Every core that escapes becomes another ship sent against us.',
    tactic: 'Strip tug shields with Ion. Break the relay before it calls another escort.',
    fails: 'Too many haulers reach the fold point, or you are shot down.' },
  m08: { act: 'III · The long mercy', role: 'Coordinated fleet assault', pace: 'Open the shields, commit the bombers, survive the reactor breach.',
    stakes: 'The Watch commits its fleet to one chance at silencing the foreman.',
    tactic: 'Destroy bays to reduce pressure. Clear the flak before Ember starts its run.',
    fails: 'The Mother folds out with her reactor intact, or you are shot down.' },
  m09: { act: 'III · The long mercy', role: 'Convoy screening & quarantine', pace: 'Identify a hidden threat, then find a way around a capital ship.',
    stakes: 'These are the last people out. The ark has no second convoy to wait for.',
    tactic: 'Scan Skiff 4 before the checkpoint. A confirmed threat gives Vigil time to help.',
    fails: 'A second transport is lost, Skiff 4 reaches the Long Mercy (scanned or not, it has to be stopped), or you are shot down.' },
  m10: { act: 'III · The long mercy', role: 'Fleet rearguard & escape', pace: 'Multiple fronts build into one final jump.',
    stakes: 'Forty-one thousand lives. One drive ring. One chance.',
    tactic: 'Delegate targets to your wing. The anchors and the drive ring decide the battle.',
    fails: 'The Long Mercy or her drive ring is destroyed, the anchors hold until the Mothers arrive, or you miss the jump.' },
  m11: { act: 'Special operation · Day 37', role: 'Deep-space rescue', pace: 'Match falling hulks, attach beacons, climb back out.',
    stakes: 'The convoy is already lost. Its people need not be.',
    tactic: 'Watch your point of no return. Rescue the lowest hulls before chasing fighters.',
    fails: 'Too many hulks fall into the Well, or you fall in yourself.' },
};

export const difficultyTactics = key => ({
  recruit: 'Recruit: smaller formations, generous recovery time and tougher escorts.',
  pilot: 'Pilot: coordinated attacks; keep moving and choose priorities.',
  veteran: 'Veteran: flanking fighters, extra strike elements and tighter deadlines.',
  ace: 'Ace: aggressive crossfire, faster reactions and very little spare time.',
}[key] ?? '');

/* Debrief what the pilot actually did, including the price of a victory.
   Keep this derived from results so replays and old saves need no migration. */
export function aftermath(res) {
  if (!res.won) return '';
  const done = id => res.objectives.some(o => o.id === id && o.state === 'done');
  const wing = name => res.wing?.find(e => e.name === name)?.alive;
  switch (res.id) {
    case 'm01': return wing('Saint') ? 'Saint waits beside your ladder until the deck crew gives you a thumbs-up. Neither of you has to say why.' : 'Saint’s parking light stays dark. The deck crew leaves the space beside your ship empty.';
    case 'm02': return done('all') ? 'All three cargo manifests are stamped RECEIVED. You bought Varlaam another month of air.' : 'Two manifests are stamped RECEIVED. The third is folded into the Watch’s book of names.';
    case 'm03': return done('quiet') ? 'The Harrow never saw you coming. Your quiet approach gave the Watch its first complete picture of the Deep.' : 'The sensor logs came home through an alarm net. The Watch has its answers, and the Deep knows someone is listening.';
    case 'm04': return done('noimpact') ? 'Varlaam sends a message: the chapel windows are still whole. For one night, that is enough.' : 'Varlaam survives with open decks and names still being counted. The evacuation cannot wait.';
    case 'm05': return `${res.flags?.evacuated ?? 'Several'} Skiffs reached the fold point.${done('wren') ? ' Wren finds her mother on the manifest, then comes back to thank you in person.' : ' Wren’s rescue is marked incomplete. Saint reads the sortie log without a word.'}`;
    case 'm06': return done('crew') ? 'Engineering sends a grease-stained note: “The braces held. We are still here because you stayed.”' : 'The surviving engineers brace the engines from inside. It will take the whole watch to undo the damage.';
    case 'm07': return done('relay') ? 'The silenced relay never called its escort. The stopped cores drift where you left them: metal that will never become another raider.' : 'The line is broken. The relay’s final escort request keeps repeating to a convoy that is no longer moving.';
    case 'm08': return done('ember') ? 'Both Ember crews are back on deck. Their navigator paints a broken red eye beside your launch rail.' : 'An empty Ember berth makes the victory feel smaller. The deck crew paints the lost call signs beside the launch rail.';
    case 'm09': return res.flags?.identified ? 'Your manifest scan exposed the boarding before the infiltrator could open its hold. Vigil’s report credits Lantern One with the early warning.' : 'Skiff 4’s last clearance is still in the convoy log. Wren deletes it before anyone has to hear it again.';
    case 'm10': return done('wing') ? 'Two familiar running lights cross beside yours. Saint and Wren are there to see the new world.' : 'At the new world, roll call begins. Lantern Wing’s empty places are read aloud before anyone celebrates.';
    default: return '';
  }
}
