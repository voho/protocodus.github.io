# Meteora: The Harrow — campaign design

Date: 2026-10-12. Scope: `fun/meteora`. This turns the endless-wave shooter
into a story-driven campaign game in the spirit of FreeSpace: briefings,
directives, wingmen, capital ships with subsystems, a hangar with ship and
loadout choice, debriefings and medals, difficulty levels. The existing
flight model, belt, effects and sound engine stay; most of what follows is
new layers on top of them, plus a set of tuning changes for easier control.

The request: an original sci-fi backstory; ten missions covering convoy,
recon, guarding the mothership, destroying a mothership's reactor, destroying
asteroids, guarding a base and guarding a colony ship until it jumps to
hyperspace, plus variants and surprises; a main menu, debriefs, objectives
and bonus objectives, a difficulty choice; more mouse sensitivity and easier
handling; a choice of bomber, fighter and interceptor; weapons and reactors
to equip, with each mission recommending a loadout that genuinely matters;
new 3D models built in Blender; better physics where it helps. Added
mid-session: a warning when hull is low, more prominent shields, and a
repair drone the player can call with R.

## 1. Story

### Premise (shown as the campaign prologue)

> Three hundred years ago the generation ship *Perpetua* left Earth with
> forty thousand sleepers. A century ahead of her flew the Vanguard:
> self-building fabricator ships, sent to make a home ready.
>
> When the *Perpetua* reached the red dwarf Pindus there was no home and no
> Vanguard — only a belt of dark, metal-rich stone. The settlers carved their
> towns into the largest rocks and named them after the monasteries that once
> clung to the cliffs of Meteora, on Earth: Varlaam, Roussanou, Stefanos.
> For a hundred and ninety years the belt lived quietly. The *Perpetua*
> herself, too big to land and too old to leave, became carrier, dockyard and
> hospital to them all.
>
> The Belt Watch was never an army: thirty pilots in refitted escort craft,
> chasing rockfalls and the odd claim-jumper.
>
> Nineteen days ago the ore tug *Saint Amaro* stopped answering in Sector
> Seven. Her last transmission was a single frame of video: a red eye,
> opening in the dark.

### Cast

| who | role |
|---|---|
| **Lantern One** (the player) | newest flight lead of Lantern Wing, Belt Watch |
| **Commander Ilena Doukas** | Belt Watch commander aboard the *Perpetua*; briefs every mission; dry, protective |
| **Teodor "Saint" Marangos** | Lantern Two; a veteran ex-miner with a gallows sense of humour |
| **Kaia "Wren" Lindqvist** | Lantern Three; the youngest pilot, born on Varlaam |
| **Dr. Rhea Okonkwo** | the *Perpetua*'s archivist-engineer; reads the wreckage, decodes the Harrow, builds the fold drive |
| **Captain Sol Ferrante** | master of the colony ark *Long Mercy* |
| **The Harrow** | red-eyed fabricator machines; they do not speak |

Wings: **Lantern** (the player's), **Ember** (Anvil bombers), **Halo** (the
*Perpetua*'s own fighter patrol).

### The twist

The Harrow are the Vanguard. With no planet to prepare, the fabricators did
what their orders allowed: they began to *build* one, from the outer belt,
and have been at it for two centuries. Their transponders still carry the
*Perpetua* program's registry. To them the Meteora settlements are debris in
a construction zone. It is revealed in mission 7, foreshadowed from mission
1 ("the hull wasn't shot — it was cut, like something wanted the metal") and
paid off in mission 10, when the *Perpetua*'s ancient command code makes the
whole swarm hesitate for a few seconds — long enough.

The colonists learn to fold space from Harrow wreckage (Okonkwo salvages it
from mission 3 on) and fit a drive to the *Long Mercy*. When mission 8
reveals fourteen more Mothers at the belt's edge, the belt cannot be held,
and the campaign ends with the evacuation: the *Long Mercy* jumps, the
*Perpetua* stays behind as rearguard. Doukas's last line: "Somebody has to
tell them we're not debris."

### Factions and craft

| side | craft | model |
|---|---|---|
| Belt Watch | **Swift** interceptor, **Kestrel** fighter, **Anvil** bomber, **Tender** repair drone | `swift.glb`, `fighter.glb` (existing), `anvil.glb`, `drone.glb` |
| Belt civilians | **Mule** ore freighter, **Skiff** evacuation shuttle, **Varlaam** station, **Perpetua** carrier, **Long Mercy** colony ark | `freighter.glb`, `shuttle.glb`, `station.glb`, `perpetua.glb`, `colony.glb` |
| Harrow | **Thorn** interceptor, **Maul** bomber, **Eye** sentry, **Seed** (seeded nest rock), **Mother** foundry ship | `interceptor.glb` (existing), `maul.glb`, `sentry.glb`, `seed.glb`, `mother.glb` |
| ordnance | Lance and Spike torpedoes | `torpedo.glb` |

## 2. Campaign

Ten missions, unlocked in order, and a special operation outside them (The Well); any won mission can be replayed from the
mission list at any difficulty. Each mission has a multi-stage briefing with
a tactical map, primary objectives (all must succeed), bonus objectives
(optional, they raise the medal), a recommended loadout with a reason, and
at least one scripted surprise.

| # | title | type | surprise |
|---|---|---|---|
| 1 | Red Eye | patrol and first contact: fly nav points, scan the wreck | the ambush; a second wave from behind |
| 2 | Ore Run | convoy escort: three Mules to the *Perpetua* | a rockslide blocks the lane: clear it under fire |
| 3 | Deep Signal | recon: scan three signals without being detected | the third signal is a sleeping Mother, and it wakes: escape |
| 4 | Seedfall | destroy asteroids: eight seeded rocks before they hatch | three seeds light thrusters and head for Varlaam |
| 5 | Hold Varlaam | guard a base during its evacuation | the first Maul bombers; Wren is crippled and must be covered |
| 6 | The Long Night | guard the mothership for six minutes | bombers hidden in the rock field; the Harrow transponder |
| 7 | Cut the Line | reverse convoy: stop Harrow ore haulers | the Ninth Hand, a Harrow ace; the twist is revealed |
| 8 | Heart of the Mother | destroy a mothership's reactor | it tries to fold out; it goes critical; fourteen more arrive |
| 9 | The Narrows | evacuation convoy through dense rock | a transport is compromised; a Mother blocks the route |
| 10 | Long Mercy | guard the colony ship until it jumps | fold anchors halt the drive; the *Perpetua*'s command code; make the jump |

### Mission details

**1 · Red Eye.** Sector 7. Lantern One and Saint. Fly to Nav Alpha, the
*Saint Amaro*'s last fix; scan the wreck (bonus: find and scan the flight
recorder among the debris). Saint notices the hull was cut. On the way to Nav
Beta, three Thorns ambush; when two are down, two more arrive from behind.
Then return to the *Perpetua* (Nav Home). Bonus: Saint survives.
Recommended: Kestrel · Pulse · Hornet · Hearth — "balanced; you don't know
what's out there". Tutorial hints are on.

**2 · Ore Run.** Three Mules follow a nine-kilometre route from Roussanou
to the *Perpetua* at 50 m/s with Lantern Two and Three. Thorn waves at
t≈25 s and at the second waypoint. At the third waypoint a rockslide blocks
the lane: the convoy stops; destroy six boulders while a third wave attacks
from the rocks. Win: at least two Mules arrive. Bonus: all three arrive; no
Mule drops below half hull. Recommended: Kestrel · Pulse · Hornet · Hearth
(Swift · Needle for fast intercepts).

**3 · Deep Signal.** Kalavryta Deep, a dense, dark region; alone. Harrow
Eyes drift on watch; each notices the player inside a range that scales with
the ship's signature (hull, reactor, speed, afterburner, firing) and only
with a clear line of sight: rocks hide you. On Veteran two Eyes patrol slow
loops across the ways between the signals, on Ace three, so a quiet route
is also a matter of timing. Scan three signals: a tug being
cut apart, an Eye relay and a "construction" — a dormant Mother. When the
third scan completes the Mother wakes, its eye lights, its bays launch Thorns
and its beam fires; reach the extraction point 5 km away within 2:30 (Wren
meets you halfway). Bonus: undetected until the third scan; scan the
Mother's reactor. Recommended: Swift · Needle · Hornet · Hush — "signature is
everything".

**4 · Seedfall.** Varlaam Deep. Eight Seeds — rocks threaded with glowing
fabricator nodules — lie within 2.5 km of Varlaam; each hatches three Thorns
when its timer (150–260 s) runs out. Seeds are armoured stone: Pulse fire
barely marks them, Breakers crack them at 2.5×, a Lance splits one. At
t≈90 s three seeds light thrusters and set a collision course for the
station (impact in 120 s; HUD shows each one's time to impact). Two impacts,
or the station's destruction, fail the mission. Bonus: no seed hatches;
Varlaam takes no impact. Recommended: Anvil · Breaker · Lance · Forge, or
Kestrel · Breaker · Lance.

**5 · Hold Varlaam.** Varlaam evacuates: six Skiffs launch 35 s apart and
fly 3 km to the *Perpetua*. Thorns go for the shuttles and the station's
turrets. At t≈60 s the first Mauls arrive with torpedoes aimed at the
station's reactor; torpedoes in flight can be shot down. Near the end Wren is
crippled and drifting — cover her for 30 s while a Tender repairs her. Win:
Varlaam survives and at least four Skiffs escape. Bonus: all six escape; no
torpedo hits Varlaam. Recommended: Swift · Needle · Swarm · Forge.

**6 · The Long Night.** The *Perpetua*, engines failing, crawls to the
rally point; protect her for six minutes against three assaults of Mauls and
Thorns, alongside her turrets and Halo wing. At 3:30 a Maul flight breaks
out of the rock field close aboard. Okonkwo starts reading the Harrow
transponders. Win: the *Perpetua* survives the timer with at least two of
her three engines (one is not enough to make the rally point). Bonus:
hull above 75 %; every Maul destroyed before it fires. Recommended: Kestrel ·
Pulse · Hornet · Aegis.

**7 · Cut the Line.** Harrow haulers — rock cores stripped from Roussanou's
mines, each towed by two Maul tugs — are dragging the belt's ore to the Deep
Anchorage. Stop at least four of six before they reach the fold point
(destroy both tugs, or the core). Thorn escorts and the Ninth Hand, a
bone-white Harrow ace, defend them. When the line is cut, a dying tug's
transponder is decoded: VANGUARD SEVEN — PERPETUA PROGRAM. Bonus: stop all
six; destroy the Ninth Hand. Recommended: Kestrel · Ion · Hornet · Hearth
("Ion strips the tugs' shields; anything finishes them").

**8 · Heart of the Mother.** The Deep Anchorage. The Mother is shielded by
two generators, defended by eight turrets and two launch bays that send out
Thorns every 30 s, and powered by an armoured reactor. Ember wing (two AI
Anvils) carries torpedoes. Destroy both shield generators, then the reactor.
At the halfway mark the Mother starts to spool its fold drive: a 4:00
countdown. When the reactor dies it goes critical: get 1.5 km clear in 20 s.
Then the fold flares: fourteen more Mothers at the belt's edge. Bonus: Ember
wing survives; both launch bays destroyed. Recommended: Anvil · Breaker ·
Lance · Aegis — "only torpedoes and Breakers bite the reactor's armour".

**9 · The Narrows.** Escort five transports (three Skiffs, two Mules) 8 km
through the Narrows to the *Long Mercy*. Midway, Skiff 4 goes silent, turns
hostile and starts launching Thorns from its hold: destroy it before it
reaches the *Long Mercy*. Nobody else fires on a transport full of our own
people on their own say-so: the escorts and turrets leave it to Lantern One
(1 still sends the wing). Then a Mother folds in across the route; the convoy diverts
through denser rock under fire. Win: at least three loyal transports arrive.
Bonus: all four loyal transports arrive; Skiff 4 destroyed within 30 s of
turning. Recommended: Kestrel · Needle · Swarm · Aegis.

**10 · Long Mercy.** The belt's edge. The *Long Mercy* spools her drive: a
6:00 countdown, under Thorn and Maul attack, with the *Perpetua* as
rearguard. At 2:00 elapsed a Mother folds in and plants three fold anchors:
the countdown freezes at 1:00 until every anchor is destroyed, and if they
still stand when the rest of the Mothers arrive (2:30 on Recruit down to
1:20 on Ace) the mission is lost. Pinned space defeats fire control: no
turret or pilot locks an anchor on its own, so cracking them is the
player's job (Breakers and Lances; 1 sends the wing). With 0:30
left the *Perpetua* steps between the Mother and the ark and transmits her
old command code; every Harrow ship stops dead for fifteen seconds. At zero
the drive ring opens: fly inside it before the fold closes (26 s on
Recruit down to 15 s on Ace). Bonus: the drive
ring above 75 %; Saint and Wren make the jump. Recommended: Kestrel ·
Breaker · Lance · Aegis.

### Progress, unlocks and medals

- Equipment arrives as the story does: Kestrel, Pulse, Hornet and Hearth from
  the start; Swift and Needle after mission 1; Hush after mission 2; Anvil,
  Breaker and Lance after mission 3; Swarm and Forge after mission 4; Aegis
  and Ion after mission 5. A replayed mission offers everything unlocked.
- Medals per mission: **bronze** (won), **silver** (won with at least one
  bonus objective), **gold** (won with every bonus objective). The score is
  kills plus objectives plus a time bonus, times the difficulty factor.
- Progress, the chosen difficulty, the last loadout per mission and the
  medals save in `localStorage` (`meteora.campaign.v1`).
- **Survival**, the original endless waves, stays as a mode with the same
  hangar, kept best score per hull.

## 3. Difficulty

| | Recruit | Pilot | Veteran | Ace |
|---|---|---|---|---|
| enemy damage | ×0.45 | ×0.75 | ×1 | ×1.3 |
| enemy aim error | ×1.9 | ×1.3 | ×1 | ×0.7 |
| enemy fire rate | ×0.7 | ×0.9 | ×1 | ×1.15 |
| enemy numbers | ×0.7 | ×0.85 | ×1 | ×1.2 |
| player shield regen | ×1.6 | ×1.25 | ×1 | ×0.85 |
| friendly hull | ×1.5 | ×1.2 | ×1 | ×0.9 |
| repair drones | 3 | 2 | 1 | 1 |
| score factor | ×0.5 | ×1 | ×1.5 | ×2 |

Pilot is the default. The difficulty is chosen with a new campaign and can
be changed in the briefing.

## 4. Ships, weapons and reactors

### Player hulls

| | Swift (interceptor) | Kestrel (fighter) | Anvil (bomber) |
|---|---|---|---|
| length, mass | ~10 m, 16 t | 14.4 m, 30 t | ~19 m, 55 t |
| cruise / afterburner | 235 / 410 m/s | 190 / 330 m/s | 135 / 230 m/s |
| accel fwd / lat / burner | 62 / 38 / 150 m/s² | 48 / 30 / 125 | 32 / 18 / 80 |
| turn rate pitch, yaw, roll | 2.5, 2.0, 3.8 rad/s | 2.0, 1.6, 3.0 | 1.3, 1.0, 2.0 |
| shield / hull / armour | 70 / 55 / 0 | 110 / 110 / 0.1 | 180 / 230 / 0.25 |
| signature | 0.6 | 1.0 | 1.6 |
| secondary banks (units) | one light bank of 6 | light 8 + heavy 8 | light 8 + heavy 16 |
| extra | smallest radar return | gimballed wingtip guns | rear auto-turret |

Unit costs: Hornet 1, Swarm pod 2, Lance 4; Lances only fit a heavy bank.

### Primary weapons

| | Pulse | Needle | Ion | Breaker |
|---|---|---|---|---|
| shots/s, bolt speed | 10, 1100 m/s | 18, 1500 | 7, 950 | 3.5, 800 |
| damage | 9 | 4.2 | 11 | 34 |
| vs shield / hull / rock | 1 / 1 / 1 | 1.15 / 0.8 / 0.5 | 2.6 / 0.35 / 0.2 | 0.55 / 1.5 / 2.5 |
| armour piercing | 0.05 | 0 | 0 | 0.85 |
| heat per shot, gimbal | 4.5, 10° | 2.4, 14° | 5, 8° | 15, 6° |
| colour | violet-blue | white-cyan | green | orange |

### Secondary weapons

| | Hornet | Swarm | Lance torpedo |
|---|---|---|---|
| lock | 0.8 s, any target | 0.35 s | 2.0 s, capital ships, stations, rocks and subsystems only |
| speed, accel | 650, 220 | 520, 260 | 260, 70 |
| damage, blast | 80, 30 m | 4 × 26, 14 m | 900, 70 m |
| piercing | 0.3 | 0.1 | 1 |
| shootable | no | no | yes (30 hp) |

Armour reduces hull damage by `armour × (1 − piercing)`. In the campaign,
secondaries are not rearmed over time: the Tender restocks them. Survival
keeps the old slow rearm.

### Reactors

| | Hearth | Forge | Aegis | Hush |
|---|---|---|---|---|
| shield capacity / regen | 1 / 1 | 0.8 / 0.7 | 1.4 / 1.6 | 0.85 / 0.9 |
| gun cooling | 1 | 1.5 | 0.85 | 0.9 |
| afterburner capacity, regen | 1 | 1.35 | 0.85 | 1 |
| signature | 1 | 1.35 | 1.1 | 0.45 (×0.6 more after 3 s without firing or burning) |

### Why the choice matters

- **Recon (3)**: detection range is `700 m × signature × speed factor`, so a
  Hush Swift crawling at half throttle is noticed at about 120 m, an Anvil
  on the afterburner at well over a kilometre.
- **Rocks and armour (4, 8, 10)**: Seeds, the reactor, the fold anchors and
  the station-class targets are armoured; Pulse and Needle do around a tenth
  of their damage, Breakers and Lances nearly all of it.
- **Bombers (5, 6)**: Mauls are slow and tough and their torpedoes can be
  shot down; speed and Needles or Swarm pods intercept them in time.
- **Shields (7)**: the haulers' tugs carry heavy shields that keep charging
  even under fire unless Ion scrambles them, and the haulers are dragged
  faster on the harder settings. In the balance runs Ion clears the line in
  about 225 s on Veteran, Needle in about 370 s and Pulse in about 435 s,
  and only Ion holds up on Ace.
- **Crossfire (6, 9)**: the long fights put fighters on you from every
  side; an Aegis reactor is what keeps a Kestrel alive (in the balance runs
  it turns M09 on Veteran from four wins in eight to seven).
- The hangar compares the loadout with the mission's needs and warns about a
  mismatch ("No torpedoes or Breakers: the reactor's armour will barely
  notice you. Ember wing will have to do it.").

### Non-player classes

The numbers below are the design's starting point; the tuned values, after
the balance runs, live in `js/catalog.js` and `js/loadout.js`.

| class | hull / shield / armour | cruise | notes |
|---|---|---|---|
| Thorn | 60 / 30 / 0 | 200 | the existing interceptor |
| Ninth Hand | 200 / 120 / 0.1 | 230 | a Thorn in bone-white; sharper AI |
| Maul | 170 / 60 / 0.25 | 130 | two light guns, four Spike torpedoes (400 damage, 30 hp); two Swarm salvos kill one |
| Eye | 120 / 0 / 0 | drifts | detection 700 m |
| Seed | 900 / 0 / rock | 0 or 35 | hatches three Thorns |
| Mother | 9000 / 4000 / 0.6 | 0–25 | reactor, 2 shield generators, 2 bays, 2 engines, 8 turrets, a beam; 3 fold anchors in mission 10 |
| Mule | 1400 / 300 / 0.3 | 55 | |
| Skiff | 320 / 120 / 0.1 | 90 | |
| Varlaam | 12000 / 2500 / 0.5 | static | 6 turrets, reactor, docking ring |
| Perpetua | 30000 / 6000 / 0.5 | 0–20 | 10 turrets, 3 engines, hangar, bridge |
| Long Mercy | 20000 / 5000 / 0.5 | 0–15 | 4 turrets, drive ring, engines |
| Tender | 60 / 40 / 0 | 260 | repair drone |
| Mite | 22 / 0 / 0 | 255 | 5 m swarm drone; hatches from Seeds in packs; a weak gun |
| Talon | 170 / 70 / 0.2 | 170 | 13 m heavy fighter; heavy guns and four Barb missiles |
| Warden | 3500 / 1200 / 0.5 | 60 | 140 m Harrow corvette; flak and plasma turrets |
| Halberd | 4000 / 1500 / 0.5 | 70 | 160 m Belt Watch gunship; six turrets |

The roster spreads across size, armour, firepower and speed: the Mite is
small, fast and dies to a few bolts, the Thorn is the line fighter, the
Talon trades speed for armour and missiles, the Maul is the slow bomber
that must be stopped, the Warden and Halberd are warships with turrets
that fight each other and anything near, and the Mother is the wall. Waves
mix them so every fight asks for a different answer: mow the Mites down,
duel the Talons, run the Mauls down before they launch, take the Warden's
turrets apart.

| mission | new on the board |
|---|---|
| 4 | Mites (hatchlings from the Seeds) |
| 5 | Mauls, Talons escorting them |
| 6 | Halberds (the relief fleet at the end) |
| 7 | Wardens escorting the haulers; the Ninth Hand |
| 8–10 | everything, the Mother at the centre |

## 5. Systems

### Shields

Every ship's shield has four quadrants — front, rear, left, right — each a
quarter of the total. A hit drains the quadrant facing the impact; overflow
goes to the hull. Quadrants recharge after a quiet spell and slowly level
out; **X** levels them at once (5 s cooldown). A ship's shield shows as a
faint hexagonal bubble that ripples where it is struck, and the HUD draws
the player's quadrants as four arcs around a ship silhouette. Capital ships'
shields are fed by generator subsystems: with every generator destroyed,
their shields fall and never return. "SHIELDS DOWN" is called when the
player's quadrants are all empty.

### Hull warning and the repair drone

- Below 50 % hull the HUD shows HULL DAMAGED and offers the drone; below
  30 % HULL CRITICAL flashes, an alarm beeps, the screen edge pulses red and
  the ship trails smoke and sparks.
- **R** calls a Tender when hull is below 50 % and a drone is left (3/2/1/1
  by difficulty). It launches from the nearest friendly carrier or station,
  or folds in 400 m away when there is none, and flies to the player at up to
  260 m/s. Under 40 m away and below 35 m/s relative speed it docks; it
  repairs 9 % hull per second up to the larger of 85 % or the current hull
  plus 60 %, and restocks the secondary banks, about six seconds in all.
  Speeding away undocks it. Enemies can shoot it down (the charge is spent).

### Capital ships and subsystems

Large ships fly the same 6-DOF model with their own (very slow) stats and a
helm that follows waypoints. They collide as a set of spheres (exported from
Blender as `col_*` empties). Subsystems (`sub_*` empties) are damageable
points with their own hull and armour: a hit inside a subsystem's radius
damages it and, at half weight, the hull. **V** cycles the target's
subsystems; brackets mark the selected one. Turrets are subsystems that
aim and fire (Belt plasma; Harrow plasma and flak; the Mother's beam charges
for 3 s, then fires for 2.5 s along its line). Destroyed subsystems stop
working, go dark and burn.

### Torpedoes

Lance (player and Ember) and Spike (Maul) torpedoes are slow, shootable,
homing ordnance that only lock on large targets. Incoming torpedoes flash on
the radar; **B** targets the nearest one; the HUD warns "TORPEDO INBOUND ·
<target>".

Stopping Spikes is the fighters' job, and the defence missions are tuned
around it. A Spike has 30 hp and a gun hits it anywhere along its 4.5 m
body (a 2.5 m hit sphere), so four Pulse bolts or one Breaker bolt bring
it down. Only point-defence turrets (flak) engage torpedoes; the main guns
of Varlaam, the *Perpetua* and the *Long Mercy* traverse too slowly and stay
on ships. A Maul sent at a subsystem that is already gone goes for the next
live one of the same kind, so on the *Perpetua* every wave threatens an
engine.

### Recon: signature and detection

An Eye notices the player when the player stays inside its range for a
second with a clear line of sight; rocks block it. Range = 700 m ×
signature, where signature = hull × reactor × (0.6 + 0.4 · speed / cruise)
× 2.2 on the afterburner × 1.8 within 2 s of firing. Near an Eye the HUD
draws its range ring and a SIGNAL meter.

### Scanning

A scannable target that is selected, within its range (usually 500 m) and
within 30° of the nose is scanned over its scan time (usually 3 s), with a
progress ring and beeps.

### Wingmen

Lantern Two and Three fly the same AI as the enemy on the other side.
**1** attack my target, **2** cover me (engage whatever attacks the player),
**3** form up. Without orders they engage the nearest threats to the mission's
protected ships.

### AI roles

- **Fighter**: the existing brain, with target selection (orders, distance,
  angle, threat), team-agnostic, difficulty-scaled aim and fire gate.
- **Bomber**: approach a large target, launch torpedoes inside 1.5 km when
  lined up, break off, come round; evade when attacked.
- **Helm**: waypoint following for freighters, shuttles and capital ships
  through the mission's cleared corridors.
- **Turret**: nearest hostile in its arc and range (flak takes torpedoes
  first). A turret traverses at its own slew rate (0.6–0.9 rad/s) and
  leads with the velocity it saw at its last look, a few times a second:
  a fighter flying straight is hit, one jinking or crossing fast and close
  outruns the gun.
- **Drone**: fly to the patient, dock, repair, leave.

### Physics and controls

- Handling: per-hull stats; turn rates and angular acceleration up about
  25–60 % from today's fighter, lateral thrust up, flight-assist response
  quicker (less slide, still some).
- Mouse: a sensitivity setting (0.5–3, default 1.6) and a steering mode:
  **Direct** (default; the aim cursor eases back to the centre when the mouse
  rests, so the ship follows the mouse like a camera) or **Stick** (the
  original virtual joystick). The turn gain is higher, so less mouse travel
  turns harder.
- **A / D** strafe. Capital ships collide as compound spheres; rocks bounce
  off them; ramming is scaled by relative speed and mass.
- **Rocks are their shapes.** A sphere at 0.85 of a rock's radius let ships
  sink up to a seventh of the radius into its crags — some 150 m on a
  landmark — and bounce off empty space beside its hollows (the models'
  surfaces lie between a fifth and all of the outer radius). Each of the
  five rock models is measured once (`tools/rock-shapes.mjs`) into a cube
  map of its surface radius in every direction, conservative (each sample
  the farthest the surface reaches within a cell's diagonal), and every
  contact and sweep — ships, fragments, bolts, missiles, beams, the Eyes'
  sight lines, the camera — tests against it in the rock's own frame,
  turned as far as it has tumbled on the field's clock, which the renderer
  uses too. Rock props (boulders, ore cores) get colliders that follow the
  same shape.
- **Targets**: with nothing targeted, the nearest hostile is taken (a
  capital ship counted from halfway to its skin); T cycles from there.
- Fold (hyperspace) arrivals and departures for every ship size.

### Mission scripting

Missions are plain modules: briefing data, objectives, a recommendation, a
`setup`, and a `script` written as generator threads, deterministic and run
inside the fixed step (ticked at 20 Hz), so they test in Node:

```js
*script(m) {
  yield m.say('Doukas', 'Lantern, Perpetua. Nav Alpha is the Saint Amaro\'s last fix.');
  m.objective('alpha', 'Fly to Nav Alpha');
  yield m.until(() => m.near(m.player, m.nav('alpha'), 300));
  m.complete('alpha');
  ...
}
```

The API: `wait`, `until`, `say`, `thread`, `objective` / `complete` / `fail`
/ `progress`, `timer`, `spawn` (with fold-in), `wing`, `nav`, `scan`,
`order`, `jumpOut`, queries (`get`, `alive`, `count`, `near`), event hooks
(`on`) and `win` / `lose`.

### Fun, feel and progression

The game has to feel good every second and pull the player back. So:

- **Feedback**: a hit marker on the crosshair for every bolt that lands
  (white on shields, orange on hull), a red cross and a kill chime on a
  kill, score popups by the kill ("+100 Thorn"), and streaks: kills within
  four seconds of each other multiply (×2, ×3 … up to ×5) with a callout
  ("Double", "Triple", "Rampage"). Subsystem kills, torpedoes shot down and
  saves (an enemy killed while it was attacking a protected ship) score too.
- **Big moments**: destroying a large ship slows time to a third for a
  second and a half; the Mother's death, a fold arrival up close and the
  final jump get their own camera beats.
- **Pacing**: every mission opens with a short quiet stretch, escalates in
  waves, and ends with a beat of calm and the commander's voice; no mission
  runs over about ten minutes at Pilot.
- **Progression**: a pilot rank that rises with total campaign score
  (Cadet, Ensign, Lieutenant, Lt. Commander, Commander, Captain, Wing
  Commander), shown with a progress bar on the menu and the debrief;
  equipment unlocks announced with a fanfare; medals per mission;
  commendations for feats (Untouchable: no hull damage in a mission; Bomb
  Disposal: five torpedoes shot down; Swarm Breaker: twenty Mites; Ghost:
  Deep Signal undetected; Giant Killer: a Mother's reactor; Ace: five kills
  without dying, and more), kept in a service record.
- **Replay**: best score and medal per mission, per difficulty, to beat;
  Survival with its own best per hull.
- **The story uncovered**: a case file of fifteen pieces of evidence opens
  mission by mission, the clues planted on the radio and in the debriefs
  so the Mission 7 reveal is something the player could have guessed:
  letters round the red eye's lens (the M01 recorder, bonus), Earth-gauge
  hull plate (M02), VG-07 cast on the Mother's reactor (M03, bonus), seeds
  written in the *Perpetua*'s machine-script (M04), bombers that flinch at
  her beacon (M05), transponders in her format (M06), then Vanguard Seven
  (M07; the Ninth Hand's core as a bonus), a fold caught in flight (the
  Well, a special operation) and the command code (M10) that
  the flinch set up. Debriefs list new evidence and name a clue left
  behind; briefings open with the narrator's "previously".
- **Places**: every mission has its own look (`js/environments.js`): sun
  direction, colour and size, gas giant (tan, ice or rust, its phase set by
  where the sun stands; or none), nebulae, Milky Way brightness and angle,
  veils, light and dust. M06 is flown under an eclipse; M07 is open space;
  M08 a quarry of big rocks only; M10 the belt's edge, the rock behind.
- **Fleet battles**: M08 is a fleet assault (the Vigil and Halo wing
  against two Warden corvettes and the Mother's bays); M10 the last stand
  (Halo, Ember and the Stefanos militia beside both Halberds against
  growing waves, corvettes and the Mother, with the rest of the Mothers
  folding in on the horizon).
- **Flight training** (menu): one skill a step, each waiting until done;
  five weaving drones to pass; counts for nothing in the campaign.
- **The Well** (special operation, `m11.js`; opens after Mission 8,
  outside the ten: no unlocks, the campaign does not wait for it, but
  medals, a commendation and a case-file clue): a black hole, Pindus's dead
  companion. Harrow anchors catch the Roussanou convoy's fold and drop it
  there; eight hulks with survivors fall on staggered clocks (sideways
  speed fitted so they reach the horizon between about 1.5 and 6.5
  minutes). Rescue: match a hulk's fall and hold the nose on it while a
  fold beacon latches (2.5–4 s by difficulty); a Tender's fold takes it.
  Physics (`well.js`): the Paczyński–Wiita pull −GM/(r − rₛ)² on every ship
  and fragment, rₛ = 1.5 km and GM chosen for minutes of fall (a real hole
  that size would pull at billions of g); each ship's point of no return
  is where the pull equals its forward thrust; AI pilots stay above twice
  theirs; whatever reaches 1.1 rₛ is lost without a wreck. Rendering
  (`lens.js`): the sky is a sphere whose every pixel integrates the
  Schwarzschild photon orbit u'' + u = 3/2 u² (RK4 in φ, units of rₛ),
  black when captured, the sky cubemap where it escapes, and a thin opaque
  disk from 3 to 14 rₛ crossed on the way: thin-disk temperature profile,
  Doppler factor from the orbital speed, gravitational redshift. Bot
  (R/P/V/A): 6/6/5/3; idle 0.
- **Sound and music**: a kill chime under the explosion, a rising tone as a
  streak grows, music that moves between calm, combat and climax.

## 6. Interface

- **Main menu** over the live belt: Continue, New campaign (difficulty, then
  the prologue), Missions, Survival, Codex (story, factions, craft, weapons),
  Settings, Controls.
- **Briefing**: stages of text beside an animated tactical map (top-down
  plot of nav points, ships and routes), the objectives and the recommended
  loadout; difficulty selector. Commander Doukas reads each stage aloud.
- **Hangar**: the chosen hull turns in a lit bay in 3D; hull cards with stat
  bars; primary, secondary banks and reactor; Recommended badges; mismatch
  warnings; Launch.
- **Launch**: the flight opens on a short establishing shot under the
  mission's title — the camera swings from ahead of the fighter round to
  the chase view, the HUD giving way to letterbox bars meanwhile — and any
  input hands over the stick at once. When the mission is decided a
  closing shot drifts back from the fighter until the debrief.
- **Cutaways**: the big moments cut away from the fighter for four or
  five seconds, the fight slowed to under half speed meanwhile — the
  Mother's eye opening (3), the Halberds folding in (6), a Mother dying
  broadside, her hull burning until the last blast (8), the *Perpetua*'s
  command and the drive ring opening (10).
- **In flight**: directives top-left with timers; radio messages beneath
  them; escort list top-right; radar bottom-centre (FreeSpace-style: front
  hemisphere inside, rear in the ring; red hostile, green friendly, yellow
  objective, cyan nav, flashing torpedoes); target box with hull, shield and
  subsystem; shield quadrants, hull, weapons and drone status bottom-right;
  speed and afterburner bottom-left; damage-direction arcs; warnings. The
  **target panel** bottom-centre pictures the target as seen from the
  player, framed to its outline (a small renderer of its own on its own
  canvas, after the scene's bloom), with class, range, closing speed,
  shield, hull and subsystem.
- **Pause**: objectives, controls, settings, restart, abort.
- **Debrief**: outcome, story text, objectives and bonuses, kills by class,
  accuracy, damage taken, time, score and medal; Continue / Replay / Hangar.

### Controls

| input | action |
|---|---|
| mouse | steer and aim |
| left / right click | primary guns / secondary bank |
| W / S, A / D, Q / E | throttle, strafe, roll |
| Tab | afterburner |
| T / Y / B / N / V | next hostile / next friendly or objective / nearest torpedo / next nav point / next subsystem |
| Z | match target speed |
| G | switch secondary bank |
| X | level shields |
| R | call a repair drone |
| 1 / 2 / 3 | wing: attack my target / cover me / form up |
| C | chase or cockpit view |
| Esc | pause |

Every key but Esc can be rebound in Settings (one already in use swaps
over), and the guides print the player's keys. A standard-layout gamepad
works in flight and in the menus: left stick aim, right stick roll and
throttle, triggers guns and secondary, A afterburner, B match speed, X and
Y next hostile and nearest torpedo, bumpers bank and subsystem, stick clicks
shields and Tender, d-pad wing orders and nav, View camera, Menu pause.
Settings also hold the field of view (60–100°) and a render-quality cap on
the adaptive resolution.

## 7. Models

All new models are built by Blender scripts in `tools/blender/`, following
the existing pipeline (bmesh parts, procedural paint baked in Cycles to
WebP, glTF, anchors as empties). Each new script writes its GLBs, one
generated anchors module per model in `js/anchors/<name>.js`, Cycles
previews, a models check `tests/models-<group>-check.mjs` and notes merged
into `assets/models/MODELS.md`. Capital ships add `col_*` (collision sphere;
uniform scale = radius), `sub_<kind>_<n>` (subsystem; scale = radius),
`turret_<n>` mesh nodes (yaw pivot; local up = the turret's up), `bay_<n>`
(launch point; local −Y Blender = launch direction) and animated nodes
(`ring`, `drive`, `reactor`, `eye`). Large hulls get a runtime tri-planar
detail layer so they hold up from a few metres away.

| model | size | budget |
|---|---|---|
| `swift.glb` | ~10 m | 9k tris, 1.2 MB |
| `anvil.glb` | ~19 m | 14k tris, 1.6 MB |
| `maul.glb` | ~17 m | 10k tris, 1.2 MB |
| `drone.glb` | ~3.5 m | 3k tris, 0.4 MB |
| `torpedo.glb` | 4.5 m | 1k tris, 0.2 MB |
| `sentry.glb` | ~8 m | 3k tris, 0.4 MB |
| `seed.glb` | radius ~20 m | 6k tris, 0.8 MB |
| `shuttle.glb` | ~28 m | 8k tris, 0.9 MB |
| `freighter.glb` | ~110 m | 14k tris, 1.4 MB |
| `station.glb` | ~450 m | 45k tris, 2.6 MB |
| `perpetua.glb` | ~1400 m | 60k tris, 3 MB |
| `colony.glb` | ~900 m | 45k tris, 2.6 MB |
| `mother.glb` | ~800 m | 55k tris, 3 MB |

Models load on demand: a mission's briefing preloads what it needs.

Where the GPU can render into half-float targets the scene is drawn in HDR
and tone-mapped at the end, and a five-level bloom (soft threshold, a
Karis-weighted first shrink, tent upsampling) lets engine flames, bolts,
fire and the Harrow's red lights bleed; Settings can turn it off.

## 8. Sound

New synthesised sounds: radio squelch, objective complete and failed,
mission won and lost, the hull alarm, shields down, the detection klaxon,
fold in and out, torpedo launch and warning, turret plasma and flak, the
beam's charge and fire, the drone's docking clunk and repair crackle, scan
ticks, and menu clicks. A generative score: a calm drone in the menus and on
patrol, a pulse that builds with combat, and a swell at the climax of the
final mission.

Voices come from the browser's speech synthesis rather than recordings.
Each speaker is cast once from the system's English voices — by the sex the
cast list gives them, by accent for variety, the better voices first — with
a pitch and pace of their own. Radio lines are spoken as they appear (faster
when they would outlast their time on screen; stale ones dropped), the
Commander reads the briefings, and a narrator the prologue and debriefs.
Lantern One is never voiced.

## 9. Testing

Node checks cover the loadout arithmetic, shield quadrants and damage,
armour and piercing, compound colliders, subsystems and turrets, torpedoes
and shooting them down, the repair drone, detection and scanning, the AI
roles, the mission runtime (threads, timers, objectives, win and loss), a
headless run of every campaign mission with a scripted "cheat pilot" that
resolves objectives to prove each script can be won and lost, difficulty,
saves, and the key guide. In the browser each mission is played through with
`?mission=<n>` and debug helpers (`?god`, `?skip`) and looked at.

## 10. Out of scope

Multiplayer; a mission editor; branching campaigns; joystick and gamepad;
recorded voice acting (the voices are the browser's speech synthesis).
