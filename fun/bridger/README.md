# Bridger

[Play Bridger](index.html) is a 2D bridge-building game for children and grown-ups.
Hold up a road across a river with wood, steel and cable, press **Go!**, and watch
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
  | Road | $30/m | 2 m pieces | 80 kN | Laid for you; heavy and stiff. Wheels roll only on road. |
  | Wood | $10/m | 6 m | 40 kN | Cheap and light. |
  | Steel | $25/m | 8 m | 110 kN | Strong and long. |
  | Cable | $12/m | 20 m | 90 kN | Light; pulls but goes slack when pushed. |

- **Vehicles.** A 1.5 t car, a 6 t three-axle truck, or a 12 t locomotive with two
  wagons. Heavier vehicles get narrower rivers.
- **Road.** Every river starts with a flat road laid from bank to bank in 2 m pieces; its
  cost counts toward the budget. It can't be erased or swapped, so the job is to hold it
  up. Every proven design keeps the road flat too.
- **Drawing.** Drag from a bolt or joint. A beam drawn through existing joints joins
  them. Tap a beam with a material to swap it, or with Erase to remove it.
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
it, so the bridge feels the weight and its inertia. A wheel with no road under it
falls.

Once a wheel loses the road, the vehicle stops being scripted: each body (the car, the
truck, the locomotive and each wagon) becomes wheel and hull points held rigid, with the
train's couplings between them. A member that snaps splits into two halves that stay
pinned to their own joints, so they dangle and swing. Fallen vehicles, loose joints and
snapped pieces collide with the terrain (along its slope, with friction) and with every
member they touch, and both sides of a contact move by their mass, so a truck landing
on the lower chord loads it and can break it too. Water slows everything down and
lets a vehicle sink slowly. An intact bridge never collides with itself, so a bridge
that holds behaves exactly as it did before.

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

[`js/scenery.js`](js/scenery.js) draws faceted low-poly scenery from the seed. Each river
gets one of four worlds from its seed (Meadow, Sunset, Alpine or Canyon); `?theme=`
previews one on any river. Distant hills fade into the sky's haze so the bridge and its
stress colours stay in front, and the river is a translucent body that darkens with depth
and reflects the bridge.

## Checks

```sh
node fun/bridger/tests/mission-check.mjs   # 36 missions: proof crosses, budget margin, Show solution, rules
node fun/bridger/tests/browser-check.mjs   # plays it in Chromium on a desktop and a phone
```

Both run in `npm test`.
