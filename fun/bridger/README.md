# Bridger

[Play Bridger](index.html) is a 2D bridge-building game for children and grown-ups.
Hold up a road across a river with wood, steel and cable, press **Go!**, and watch
a car, truck or train drive across it in a real physics test. Every member glows from
green to red with the force it carries, and the worst moment of the last test stays
on the drawing while you rebuild.

## How it plays

- **Grid and bolts.** Free endpoints snap to a 2 m grid. You can also join a member
  at one of its marked connection points. Red bolts are fixed to the ground: the
  two road ends, a bolt on the land behind each bank, a lower bolt on each cliff face
  when it is above the water, and bolts on top of rock piers and islands.
- **Materials.**

  | Material | Cost | Longest | Strength | Notes |
  | --- | --- | --- | --- | --- |
  | Road | $30/m | 2 m pieces | 80 kN | Laid for you; heavy and stiff. Wheels roll only on road. |
  | Wood | $10/m | 6 m | 40 kN | Cheap and light. |
  | Steel | $25/m | 8 m | 110 kN | Strong and long. |
  | Cable | $12/m | 20 m | 90 kN | Light; pulls but goes slack when pushed. |

- **Vehicles.** A 1.5 t car, a 6 t three-axle truck, or a 12 t locomotive with two
  wagons. Heavier vehicles get narrower rivers.
- **Road.** Each river starts with a flat road laid from bank to bank in 2 m pieces.
  Its cost counts toward the budget. Drag along the deck to replace missing road pieces.
- **Drawing.** Drag from a bolt, joint or gold dot. Gold dots along wood, steel and cable
  show where braces can attach, including between grid points on diagonal members.
  Connecting there splits the original member and the pieces share a physical joint.
  Tap a support with another material to swap it. Double-click, double-tap or use Erase
  on any bridge piece to remove it. Erasing a joint removes the pieces attached to it.
  Undo restores one edit, and Clear restores the starting deck.
- **Asking first.** New river (top right, away from Go!), Clear and Solution ask before
  they replace a bridge you built. With nothing built they just go ahead.
- **Rules.** Joints stay out of the rock and at least 1 m above the water.
- **Bridge ideas.** The help card sketches a beam on a pier, a truss, an arch and a
  cable-stayed bridge. Any bridge that carries the vehicle across within the budget
  wins; one that crosses over budget is reported with how much it went over.

## Physics

[`js/physics.js`](js/physics.js) is a pin-jointed truss solved with XPBD: 24 substeps
of 1/60 s, one projection per member per substep. Every member is an axial spring
with compliance `L / EA`, carries half its own weight on each joint, and breaks when
its force (smoothed over 40 ms) passes its strength. Vehicles roll at a steady speed
along road members; each axle adds its mass to the two joints of the road piece under
it, so the bridge feels the weight and its inertia. The three-axle truck can lift a
tyre over a crest and transfer its load onto the other axles. The bumper, roof and
underside of each moving body can hit the terrain, a buckled road or loose pieces.
Keep level beams and cables above the deck high enough to clear the vehicle.
Diagonal and upright side braces run alongside the traffic lane.

When a wheel loses the road or the vehicle strikes an obstruction, each body (the car,
the truck, the locomotive and each wagon) becomes a rigid shape. The solver uses
the same sprite outline and tyre sizes as the moving vehicle, puts contact points
every 30 cm around the body and keeps the carriages coupled. Each body collides
with the terrain and bridge members, and pushes out any joint, snapped piece or
other body that gets inside its outline. Each wheel turns according to its own travel
along the surface and coasts when airborne. A member that snaps splits into two halves that stay
pinned to their own joints, so they dangle and swing. Fallen vehicles, loose joints and
snapped pieces collide with the terrain (along its slope, with friction) and with every
member they touch, and both sides of a contact move by their mass, so a truck landing
on the lower chord loads it and can break it too. Water slows everything down and
lets a vehicle sink slowly. An intact bridge never collides with itself, so a bridge
that holds behaves exactly as it did before.

## Missions

[`js/mission.js`](js/mission.js) builds a river from the seed in the URL
(`#medium-abc123`): span, vehicle, bank faces and slopes, water level, and
sometimes a rock pier or a low island. The paved approaches undulate between the
bolts. Rounded slopes and seeded ripples shape the banks, rocks and riverbed. The
renderer and the simulation use the same ground heights. The survey tries deck,
through and deep trusses, arches on cliff bolts, beams on piers and cable-stayed
bridges. Trusses can use Pratt, Howe, alternating or X bracing. Each design runs
in the same simulation. Members above 85% of their strength
become steel, very lightly loaded steel goes back to wood, and the design counts only
when it carries the vehicle with every member under 95%. A river with no such
bridge is thrown away and the next one is tried.

New river links have a versioned seed, such as `#easy-v2-check0`. Some rivers
reserve a shipping channel below the road. Others have a 4 m building height
limit or an unrestricted span. The survey also tries wide-panel, bowstring and
single-tower designs on these rivers. Both the survey and the editor enforce
the marked clearance. Older links and their saved bridges keep their original
river, budget and building rules.

The cheapest proven design sets the budget: **Easy** gives 50% more than it costs,
**Medium** 25% and **Hard** 10%. The river depends only on the seed, so changing
difficulty keeps the river and changes the budget. **Solution** also tries Warren
trusses with alternating two-panel triangles, bowstring trusses with arched ribs
and hangers, and cable fans from a single bank tower. Each click compares the
affordable designs that have crossed and favors a different arrangement of
members from the last few drawings. The survey's proof bridge is always available.

Suspension bridges are not among the generated designs: on a 2 m grid the main
cable can't be shaped tall and smooth enough to hold a stiff road without stretching
it. Players can still try one.

## Looks

Each river's seed selects one of thirteen gouache landscapes. Valley, Mesa, Snow,
Night, Forest, Sandstone, Night desert and Night city each have a new panorama and
painted terrain. Five more landscapes are available:

| World | Preview on the same river |
| --- | --- |
| Desert | [Sunlit mesas and cacti](index.html?theme=desert#easy-browsercheck) |
| Meadow | [Rolling wildflower fields](index.html?theme=meadow#easy-browsercheck) |
| Tropical Island | [Palm-lined coast](index.html?theme=tropical-island#easy-browsercheck) |
| Jungle | [Tropical canopy](index.html?theme=jungle#easy-browsercheck) |
| Canadian Forest with a Lake | [Boreal lakeshore](index.html?theme=canadian-forest#easy-browsercheck) |

River mist drifts between the banks. Hawks circle the valley, leaves fall in
the forests, snow blows across the glacier and a plane crosses the city skyline.
Dust devils turn over the desert floor,
butterflies flutter above the meadow and fireflies blink in the jungle. Other
worlds have clouds, flocks, stars and meteors. The scenery and water animations
respect the system's reduced-motion setting.

## Sound

[`js/sound.js`](js/sound.js) uses Web Audio for the construction and vehicle sounds.
Wood takes a short double knock, steel rings after the bolt seats, and a cable
makes a soft, short pluck. Longer members have a lower pitch. A straining joint
creaks before it gives way. The car and diesel truck change engine tone on a
slope, the locomotive chuffs, and each axle sounds as it rolls onto a new deck
piece. The vehicle moves across the stereo field, with a short echo from each bank.
When a vehicle hits the water, a stereo splash plays at the point of impact.
Its pitch and level follow the vehicle's mass and entry speed. [Recording credit](assets/CREDITS.md#water-impact)

## Checks

```sh
node fun/bridger/tests/mission-check.mjs   # 36 missions: proof crosses, budget margin, Show solution, rules
node fun/bridger/tests/browser-check.mjs   # plays it in Chromium on a desktop and a phone
```

Both run in `npm test`.
