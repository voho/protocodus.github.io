# Bridger

[Play Bridger](index.html) is a 2D bridge-building game for children and grown-ups.
Build a bridge over a river from road, wood, steel and cable, press **Go!**, and watch
a car, truck or train drive across it in a real physics test. Every member glows from
green to red with the force it carries, and the worst moment of the last test stays
on the drawing while you rebuild.

## How it plays

- **Grid and bolts.** Joints sit on a 2 m grid. Red bolts are fixed to the ground: the
  two road ends, a bolt on the land behind each bank, a lower bolt on each cliff face
  when it is above the water, and bolts on top of rock piers and islands.
- **Materials.**

  | Material | Cost | Longest | Strength | Notes |
  | --- | --- | --- | --- | --- |
  | Road | $30/m | 4 m | 80 kN | The only thing wheels roll on; heavy and stiff. |
  | Wood | $10/m | 6 m | 40 kN | Cheap and light. |
  | Steel | $25/m | 8 m | 110 kN | Strong and long. |
  | Cable | $12/m | 20 m | 90 kN | Light; pulls but goes slack when pushed. |

- **Vehicles.** A 1.5 t car, a 6 t three-axle truck, or a 12 t locomotive with two
  wagons. Heavier vehicles get narrower rivers.
- **Drawing.** Drag from a bolt or joint. Road is laid in 2 m pieces, so one swipe
  crosses the river. A beam drawn through existing joints joins them. **Mirror** (on by
  default) copies every beam, swap and erase to the other side of the centre line where
  it fits. Tap a beam with a material to swap it, or with Erase to remove it.
- **Rules.** Joints stay out of the rock and at least 1 m above the water; road can't be
  steeper than 1 in 2.
- **Bridge ideas.** The help card sketches a beam on a pier, a truss, an arch and a
  cable-stayed bridge. Any bridge that carries the vehicle across within the budget
  wins; one that crosses over budget is reported with how much it went over.

## Physics

[`js/physics.js`](js/physics.js) is a pin-jointed truss solved with XPBD: 24 substeps
of 1/60 s, one projection per member per substep. Every member is an axial spring
with compliance `L / EA`, carries half its own weight on each joint, and breaks when
its force (smoothed over 40 ms) passes its strength. Vehicles roll at a steady speed
along road members; each axle adds its mass to the two joints of the road piece under
it, so the bridge feels the weight and its inertia. A wheel with no road under it
falls. Wreckage lands on the banks and slows in the water.

## Missions

[`js/mission.js`](js/mission.js) builds a river from the seed in the URL
(`#medium-abc123`): span, vehicle, bank faces and slopes, water level, and
sometimes a rock pier or a low island. It then designs bridges from the classic
families (deck truss, through truss, deep truss, arch on the cliff bolts, beam on piers,
cable-stayed), each with random proportions and one of the Pratt, Howe, Warren or X
patterns. Each design runs in the same simulation; members above 85% of their strength
become steel, very lightly loaded steel goes back to wood, and the design counts only
when it carries the vehicle with every member under 95%. A river with no such
bridge is thrown away and the next one is tried.

The cheapest proven design sets the budget: **Easy** gives 50% more than it costs,
**Medium** 25% and **Hard** 10%. The river depends only on the seed, so changing
difficulty keeps the river and changes the budget. **Solution** designs a fresh random
bridge that passes the same test within the budget, falling back to the proof bridge.

Suspension bridges are not among the generated designs: on a 2 m grid the main
cable can't be shaped tall and smooth enough to hold a stiff road without stretching
it. Players can still try one.

## Looks

[`js/scenery.js`](js/scenery.js) draws faceted low-poly scenery from the seed. Five looks
can be previewed with `?theme=meadow|sunset|alpine|canyon|blueprint`; Meadow is the
default.

## Checks

```sh
node fun/bridger/tests/mission-check.mjs   # 36 missions: proof crosses, budget margin, Show solution, rules
node fun/bridger/tests/browser-check.mjs   # plays it in Chromium on a desktop and a phone
```

Both run in `npm test`.
