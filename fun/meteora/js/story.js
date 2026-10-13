/* Meteora — the words around the fighting: the prologue, the codex and
   the case file. */

export const PROLOGUE = [
  {
    title: 'Three hundred years ago',
    text: 'The generation ship Perpetua left Earth with forty thousand sleepers. A century ahead of her flew the Vanguard: self-building fabricator ships, sent to make a home ready.',
  },
  {
    title: 'Pindus',
    text: 'When the Perpetua reached the red dwarf Pindus there was no home and no Vanguard — only a belt of dark, metal-rich stone. The settlers carved their towns into the largest rocks and named them after the monasteries that once clung to the cliffs of Meteora, on Earth: Varlaam, Roussanou, Stefanos.',
  },
  {
    title: 'The Meteora',
    text: 'For a hundred and ninety years the belt lived quietly. The Perpetua herself, too big to land and too old to leave, became carrier, dockyard and hospital to them all. The Belt Watch was never an army: thirty pilots in refitted escort craft, chasing rockfalls and the odd claim-jumper.',
  },
  {
    title: 'Nineteen days ago',
    text: 'The ore tug Saint Amaro stopped answering in Sector Seven. Her last transmission was a single frame of video: a red eye, opening in the dark.',
  },
];

export const CODEX = [
  {
    title: 'The Meteora belt',
    text: 'A dense, metal-rich asteroid belt around the red dwarf Pindus, home to some forty thousand people in settlements cut into its largest rocks — Varlaam, Roussanou, Stefanos and a dozen smaller holds. Ore is everything: air, water, hull plate and trade all come out of the stone.',
  },
  {
    title: 'The Perpetua',
    text: 'The generation ship that brought the first settlers, now three hundred years old. A kilometre and a half of truss, tankage and patched plate behind a scorched dust shield, with a habitat ring that still turns. Carrier, dockyard, hospital, chapel and the Belt Watch\'s home.',
  },
  {
    title: 'The Belt Watch',
    text: 'Thirty-odd pilots under Commander Ilena Doukas, flying refitted escort craft: the Swift interceptor, the Kestrel fighter and the Anvil bomber, with Tender drones to patch them up. Lantern Wing is yours: Saint, the ex-miner with the gallows humour, and Wren, the youngest, born on Varlaam.',
  },
  {
    title: 'The Harrow',
    text: 'Machines with red sensor eyes and oxblood plating that do not speak, do not bargain and do not stop. Named by the miners for the plough-like tines along their backs. Mites, Thorns and Talons fight; Mauls carry torpedoes; Eyes watch; Wardens escort; Mothers build all of them out of whatever they find.',
  },
  {
    title: 'Fold space',
    text: 'The Harrow cross distances that should take years in seconds, through folds that flare blue-white. Dr. Rhea Okonkwo has been taking their wrecks apart since the first ambush, to learn how.',
  },
];

/* The case file: what the Watch learns about the Harrow, a piece at a
   time. Each entry opens when its mission is won — some only if the clue
   was found (`requires`: the id of the bonus objective that finds it).
   Read in order, they lead to the truth Mission 7 tells outright: VG-07
   on a reactor housing, Earth-pattern plate under the paint, instructions
   in the Perpetua's own machine-script, bombers that flinched at the
   Perpetua's beacon, transponders that answer in her format, a fold caught
   in flight — and, at the end, a command code they still obey for fifteen
   seconds. */
export const CASE_FILE = [
  { id: 'harvested', mission: 'm01', title: 'Harvested, not attacked',
    text: 'The Saint Amaro was not shot. She was cut into plates and carried off, her crew left in the wreck. Whatever took her wanted the metal.' },
  { id: 'lens', mission: 'm01', requires: 'recorder', title: 'Letters round the lens',
    text: 'The Saint Amaro\'s recorder kept one clear frame of the red eye, close: a lens ringed with stencilled characters, worn almost smooth. Okonkwo is sure they are letters.' },
  { id: 'deep', mission: 'm02', title: 'Out of the Deep',
    text: 'Every raid folds in from one direction: the Kalavryta Deep, rock too thick for anyone to live in. Something out there is building the raiders.' },
  { id: 'plate', mission: 'm02', title: 'Earth-pattern plate',
    text: 'Under the oxblood paint, the raiders\' hull plate is rolled to an old Earth gauge — the gauge of the Perpetua\'s oldest frames. Nobody in the belt has rolled plate like it for a century.' },
  { id: 'factory', mission: 'm03', title: 'A factory that sleeps',
    text: 'In the Deep lies a Mother: eight hundred metres of fabricator that builds the Harrow out of rock and wrecks. It was asleep when Lantern One found it. It is not asleep now.' },
  { id: 'vg07', mission: 'm03', requires: 'reactor', title: 'VG-07',
    text: 'Cast into the Mother\'s reactor housing, under two centuries of scale: a registry, VG-07. It is not a Watch registry, nor any Okonkwo can find in the archive she is allowed to open.' },
  { id: 'script', mission: 'm04', title: 'Written instructions',
    text: 'The seeds carry the same machine-script in every nodule — grow, ripen, open. Okonkwo found its grammar in the Perpetua\'s own fabricator archive, in a dialect three hundred years old.' },
  { id: 'improvise', mission: 'm04', title: 'They improvise',
    text: 'No instruction tells a seed to fly at a station. The Harrow did it anyway. They do not only follow orders; they solve problems — and Varlaam was one.' },
  { id: 'flinch', mission: 'm05', title: 'They flinched',
    text: 'When the Perpetua\'s navigation beacon swept the Maul formation over Varlaam, every bomber checked its run for half a second. Saint saw it. So did the gun cameras. Machines do not flinch without a reason.' },
  { id: 'format', mission: 'm06', title: 'A registry like ours',
    text: 'The Harrow transponders answer on the Perpetua program\'s survey band, with a handshake older than anyone alive. Okonkwo took the transcript to the Commander\'s cabin. They talked for three hours.' },
  { id: 'vanguard', mission: 'm07', title: 'VANGUARD SEVEN',
    text: 'PERPETUA PROGRAM. TASK: PREPARE HABITAT. STATUS: IN PROGRESS. VG-07 is Vanguard Seven. The Harrow are the fabricators sent a century ahead of the Perpetua to make a home ready. Finding no world, they began to build one — and to them, the Meteora is debris in the construction zone.' },
  { id: 'ninth', mission: 'm07', requires: 'ninth', title: 'The Ninth Hand',
    text: 'The white Thorn\'s core held a flight model stitched together from the black boxes of Watch fighters it had harvested. It flew like a person because it learned from our dead.' },
  { id: 'foreman', mission: 'm08', title: 'Fourteen more',
    text: 'The foreman of this part of the belt is dead, and for nineteen hours every Harrow drone stopped. Then the fold flares began at the belt\'s edge: fourteen Mothers. The Meteora cannot be held. We are leaving.' },
  { id: 'caught', mission: 'm11', title: 'Caught in flight',
    text: 'The Roussanou convoy\'s fold did not misfire. Harrow anchors caught it in flight and dropped it on the Well, Pindus\'s dead companion. The Vanguard can steer a fold. The Long Mercy will get one jump, and it will have to be fast.' },
  { id: 'boarded', mission: 'm09', title: 'Seeds in the hold',
    text: 'Skiff 4 was boarded at the docks while it loaded; seeds were hours from opening in its hold. The Vanguard has watched us evacuate since Varlaam. It knows how we leave.' },
  { id: 'hold', mission: 'm10', title: 'HOLD',
    text: 'The Perpetua\'s command code stopped every Harrow ship dead for fifteen seconds — the flinch over Varlaam, all of it at once. The Vanguard still answers to its makers, a little. Somebody had to tell them we are not debris.' },
];

/* "Previously": the narrator's few words before a briefing, carrying the
   story over from the mission before — and the clues the player found
   there, when they found them. */
export const RECAPS = {
  m02: has => `The Saint Amaro was harvested, not attacked: cut into plates and carried off. Something in the belt wants metal.${has('lens') ? ' Her recorder kept one frame of the red eye — with letters round the lens.' : ''}`,
  m03: () => 'The ore came through. The raiders\' wrecks were rolled from Earth-gauge plate, the gauge of the Perpetua\'s oldest frames — and every raid had folded in from the Kalavryta Deep.',
  m04: has => `In the Deep, Lantern One found what builds the Harrow: a Mother, eight hundred metres long, asleep. It woke.${has('vg07') ? ' Cast into its reactor was a registry no one can place: VG-07.' : ''}`,
  m05: () => 'The seeds around Varlaam were written in the Perpetua\'s own machine-script, three centuries old. And they improvised: they flew at the station.',
  m06: () => 'Varlaam is empty, its people asleep in the Perpetua\'s holds. Over the station the Harrow brought bombers — and the bombers flinched when the Perpetua\'s beacon swept them.',
  m07: () => 'The Perpetua made the rally point. The Harrow transponders answer on her own survey band, with a handshake older than anyone alive. Okonkwo and the Commander talked for three hours.',
  m08: has => `A dying tug told us everything. VG-07 is Vanguard Seven: the Harrow are the Vanguard, building a world out of ours — and the tug's memory says where their foreman waits.${has('ninth') ? ' The white Thorn that learned to fly from our dead flies no more.' : ''}`,
  m11: () => 'The foreman is dead, and fourteen Mothers have come in its place. The Meteora is leaving. Roussanou went first: its convoy folded for the Long Mercy an hour ago.',
  m09: () => 'Lantern Wing brought back what it could of the Roussanou convoy out of the Well. The Harrow can catch a fold in flight now, so Stefanos, the last settlement, will go the slow way.',
  m10: () => 'Stefanos came through the Narrows, though the Vanguard knew how we leave. Forty-one thousand people are aboard the Long Mercy. One jump left.',
};

export const HINTS = [
  'Your velocity marker (the cyan circle) shows where you are really going; the chevron, where the nose points.',
  'Shields have four quadrants. X levels them when one side is taking a beating.',
  'R calls a Tender when your hull is below half. Hold under 35 m/s while it docks.',
  'Kills within four seconds build a streak multiplier.',
  'Torpedoes in flight can be shot down. B targets the nearest one.',
  'V cycles a large ship\'s subsystems. Kill the turrets that hurt, the generators that shield, the bays that launch.',
  'Z matches your speed to your target\'s: the easiest way to stay on a bomber\'s tail.',
  'An Eye cannot see through rock. Slow down, go cold, and hide behind the big ones.',
];
