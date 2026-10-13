# Craft (group `craft`) — notes for MODELS.md

Built by `tools/blender/build_craft.py`, which reuses the helpers of
`build_ships.py` (`import build_ships as S`) and writes one anchors module
per model in `js/anchors/<name>.js`.

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_craft.py [-- swift anvil drone torpedo shuttle]
```

A full build of the five takes about 1,600 CPU-seconds, 5½ minutes on an
idle Apple-silicon Mac (most of it the two 2048² bakes; it stretches when
other Blender jobs share the CPU); `METEORA_FAST=1` builds the geometry with
256² textures in under two minutes. The build is deterministic (fixed
seeds; the canopy meshes are re-ordered canonically because Blender's bisect
does not keep face order from run to run). `tests/models-craft-check.mjs`
checks the files against the brief.

## Files

| file | nodes (triangles) | textures | size |
|---|---|---|---|
| `swift.glb` | `hull` 9,798 + `hull_1` 2,182 + `glass` 312 = 12,292 | base and normal 2048², MR and emissive 1024² | 1,581 KB |
| `anvil.glb` | `hull` 9,264 + `hull_1` 9,770 + `hull_2` 936 + `glass` 720 + `turret_rear` 184 + `turret_rear_gun` 340 = 21,214 | base and normal 2048², MR and emissive 1024² | 2,121 KB |
| `drone.glb` | `hull` 2,240 + `arm_R` 242 + `arm_L` 240 = 2,722 | 1024² | 421 KB |
| `torpedo.glb` | `hull` 1,140 | 512² | 133 KB |
| `shuttle.glb` | `hull` 7,592 | 1024² | 713 KB |
| **all five** | | | **4.89 MB** |

The Swift's and the Anvil's hulls come in parts (`hull`, `hull_1`, `hull_2`)
of at most 9,800 triangles, all one material: Blender's tangents are not
repeatable on a mesh over 10,000 triangles, so a bigger hull would export
differently every build. The normal map is baked part by part and merged.

Every model has one baked material (base colour, tangent normal map,
metallic-roughness with G = roughness and B = metallic, emissive) shared by
all its mesh nodes; the glass is a plain dark material with factors only, as
on the Kestrel. Emissive carries the engine throats, navigation and work
lights, the Skiff's windows and cockpit glazing, and the drone's status
light; the game's ×3 emissive scale for ships applies.

## The craft

- **Swift** (`swift.glb`), the Belt Watch interceptor: 9.9 m long, 7.0 m
  span. A slender dart: a long pointed nose with a graphite radome and
  anti-glare panel, a bubble canopy (`glass`, smoky amber tint) with a
  graphite bow, hoop and sills, a turtle deck behind it carrying the dock
  (a hazard-ringed attach plate with four locating pins), small canards on
  the shoulders, low cranked-delta wings set well aft with a long
  leading-edge root extension, 3° of anhedral and wingtip fairings, a short
  dorsal fin and two canted ventral strakes over one big engine (petal
  nozzle, glowing throat). Guns in blisters at the wing roots, one missile on
  a ventral rail. Off-white `#d9d6cf` with graphite `#2b2d31` radome, belly,
  walkway and engine shroud, an orange `#c8642a` speed stripe and pinline,
  nose ring, wingtips and roundels, side number 21, stencils. Detailed for
  the hangar's close look: flaps and elevons in slots with actuator
  fairings, a separate rudder, canard pivot plates, intakes under the wing
  roots (striped lips, ducts with guide vanes, splitter plates), a ribbed
  petal nozzle over liner bands and a turbine face, heat-sink fins,
  perforated gun shrouds and muzzle brakes, a framed canopy, three-nozzle
  RCS clusters, antennas, probes and a chin sensor; the paint adds rivet
  rows, hatches, chevrons, walkways and soot.
- **Anvil** (`anvil.glb`), the Belt Watch bomber: 19.5 m from the gun tips
  to the nozzles, 12.9 m span. A
  thick, slab-sided lifting body with a blunt shovel prow, a raised cabin
  with a stepped two-seat canopy (`glass`: two bubbles, the rear higher),
  two big engines in nacelles on the rear quarters, each with a canted fin,
  short thick wings carrying ceramic-grey armour plates top and bottom and
  pods with nav lights at the tips, flank armour, two guns in chin pods, a
  recessed torpedo bay in the belly (ribs, cradles, folded doors and two
  Lance torpedoes inside, a hazard frame round it) and a rear auto-turret
  on the dorsal tail. Same paint scheme as the Swift with Ember-wing
  chevrons on the rear deck and number 07 on the nose and fins. Detailed
  for the hangar: dorsal intake scoops with ducts and splitters,
  eighteen-petal nozzles over liner bands and turbine faces, heat sinks, a
  dorsal spine with a satcom dome and antennas, separate flaps, ailerons
  and rudders, a missile on a pylon under each wing, flank armour as four
  plates a side, torpedo-bay doors with stiffeners, hinges and rams, braked
  chin guns, a collared turret with a sensor lens, eight RCS clusters.
- **Tender** (`drone.glb`), the repair drone: 3.6 m long, 2.2 m wide. A
  rounded utility box in Belt Watch off-white with a green `#2a8c4a` cross
  band and white crosses, four thruster pods on struts round the rear (all
  exhausting aft), gas tanks strapped along the upper flanks, a sensor eye
  and two white work lamps on the face, grab rails, a green status light and
  antenna on top, an attach plate on a pedestal underneath (the dock), and
  two manipulator arms folded under the nose: the right one ends in a
  welding torch with a heat shield, the left in a three-finger gripper.
- **Lance** (`torpedo.glb`): 4.5 m from the seeker to the motor exit, a
  0.5 m body, fins 1 m tip to tip. An ogive seeker nose (dark glass), a long off-white body with a
  graphite seeker cap, an orange band and a yellow warhead ring, a guidance
  ring and four strakes, a cable raceway, stencils, a boat-tail with four
  cruciform fins and a motor bell. The game tints a copy dark red for the
  Spike.
- **Skiff** (`shuttle.glb`), the evacuation shuttle: 28.1 m long, 11.9 m
  across the engine pods. A boxy, rounded-rectangle hull: a sloped cockpit
  nose with a glazed band and mullions, a long passenger cabin with two
  decks of lit windows (warm `#ffd9a0`, a few dark) on each flank, a hazard-
  framed side door with a lit porthole and floodlight, module collars, a
  dorsal equipment trough with radiators, a dish and whip antennas, a rust-
  orange `#b8652a` drive section with vents and hazard stripes `#d9a21b`
  round the stern, a hazard-striped rear ramp, two big engine pods on stub
  pylons, landing legs folded into their bays under the belly, a red
  beacon, white strobes and red/green nav lights. Off-white over warm grey
  `#8c857a`, rust cheat line, the number 12 painted large on both cockpit
  flanks and the roof.

## Anchors

The empties are parented to `hull` (and exported as glTF nodes); the build
converts their world transforms to glTF space (Blender `(x, y, z)` →
`(x, z, -y)`, so noses point along −Z, tops +Y, right +X) and writes
`js/anchors/<name>.js` in the shape the brief gives: `radius` (largest vertex
distance from the origin, over every mesh node), `length` (extent along Z),
and the lists below. Every list is present, empty when unused.

| anchor | swift | anvil | drone | torpedo | shuttle |
|---|---|---|---|---|---|
| `nozzles` (size = exit radius) | `nozzle_C` 0.55 | `nozzle_L/R` 0.8 | `nozzle_0..3` 0.12 | `nozzle_C` 0.2 | `nozzle_L/R` 1.2 |
| `muzzles` | `muzzle_L/R`, wing-root gun tips | `muzzle_L/R`, chin gun tips | — | — | — |
| `launchers` | `launcher_0`, the missile on the belly rail | `launcher_0/1`, the two torpedoes in the bay | — | — | — |
| `rcs` | 16 | 16 | — | — | 16 |
| `cockpit` | in the canopy | in the front canopy | null | null | behind the windscreen |
| `dock` | top of the deck plate behind the canopy | top of the dorsal plate | bottom of its attach plate | null | top of the roof ring |
| `colliders` | 31 | 53 | 16 | 5 | 42 |
| `turrets` | — | `turret_rear` | — | — | — |
| `bays` | — | — | — | — | `bay_0`, the rear ramp, launching aft |
| `lights` | 3 | 4 | 3 | — | 5 |
| `nodes` | — | — | `armL: 'arm_L'`, `armR: 'arm_R'` | — | — |

- **Nozzles**: `pos` is the centre of the exit plane, `dir` the exhaust
  direction (the empty's Blender local −Y), ≈ glTF +Z for all of them.
- **RCS**: `dir` is the puff direction out of the hull (Blender local +Z);
  a port pushes the craft along −`dir`. The layout follows the Kestrel's:
  nose up, down, left, right; tail up, down, left, right; four ports for
  roll (Swift: wingtip fairings; Anvil: wingtip pods; Skiff: roof and belly
  either side of the centre line); two forward-facing nose ports (reverse);
  two aft-facing ports (Swift and Anvil: the tails of the wingtip
  fairings/pods; Skiff: the stern). Every linear direction and every
  rotation has at least two ports (checked).
- **Colliders** (`col_NN`; the empty's uniform scale is the radius) are
  fitted by the build: surface samples clustered with k-means, one
  minimal ball per cluster, mirrored left and right, grown until every
  vertex lies within a few centimetres of a ball (Swift 6 cm, Anvil 13 cm,
  Skiff 7 cm, drone and torpedo 1 cm; the build log prints the coverage,
  and the check holds every model to that). Thin antennas are left out.
  They are listed nose to tail.
- **Turret** (Anvil): `turret_rear` is a mesh node whose origin is the yaw
  pivot on the dorsal tail, with local +Y up (glTF) — yaw it about its local
  Y. Its child `turret_rear_gun` (mantlet, trunnion, twin barrels) has its
  origin on the trunnion axis — pitch it about its local X. At rest the
  barrels point aft (`fwd` = glTF +Z; in node-local terms the barrels run
  along the node's −Z, the usual three.js forward). `size` 0.6 is the base
  radius. Both share the hull's baked texture.
- **Drone arms**: `arm_R` (welder) and `arm_L` (gripper) are mesh nodes with
  their origins at the shoulder joints (glTF ±0.7, −0.22, −0.98), axes
  aligned with the model. The arms are modelled folded under the nose;
  swinging a node about its local X unfolds it (a positive rotation about
  +X lifts the tool, a negative one lowers it).
- **Lights** (`light_N`, colour and blink period in s, 0 = steady):
  Swift `light_0` red port wingtip, `light_1` green starboard wingtip,
  `light_2` white fin-tip strobe (1.2 s); Anvil `light_0/1` red and green
  wingtip pods, `light_2/3` white fin-tip strobes (1.4 s); drone `light_0`
  green status (1 s), `light_1/2` white work lamps; Skiff `light_0/1` red
  and green on the engine pods, `light_2` white tail strobe (1 s), `light_3`
  red roof beacon (1.6 s), `light_4` white belly strobe (1 s).
- **Docking**: the Tender's `dock` is the underside of its attach plate, the
  lowest point of the drone; put it on a craft's `dock` with the drone's top
  along the craft's top and its nose along the craft's nose. On the Swift the
  drone's pods then clear the fin and canards; on the Anvil and the Skiff
  the deck around the dock is flat.
