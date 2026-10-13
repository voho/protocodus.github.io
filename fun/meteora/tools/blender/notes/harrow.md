## Harrow models (`build_harrow.py`)

Built by `tools/blender/build_harrow.py` (shared parts and paint in
`tools/blender/harrow_parts.py`, which builds on the helpers in
`build_ships.py` and the rock sculpt in `build_asteroids.py`):

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_harrow.py [-- maul sentry seed anchor]
```

The full build of the four takes 8–9 minutes on an Apple-silicon Mac
busy with other builds (about half of it the Maul's 2048² bakes) and
reproduces the files byte for byte; `METEORA_FAST=1` gives a geometry
pass in about a minute. It writes the GLBs and `js/anchors/<name>.js`;
the previews come from
`METEORA_PREVIEW_ENGINE=CYCLES … render_previews.py -- maul sentry seed anchor`.
`tests/models-harrow-check.mjs` checks the budgets, texture sizes, sizes
along the brief's axis, the anchors modules against the GLB nodes, nozzle
directions, the animated nodes, collider coverage of the hull and the
radius.

| file | nodes (triangles) | textures | size |
|---|---|---|---|
| `maul.glb` | `hull` 5,193 | base and normal 2048², MR and emissive 1024² | 1,198 KB |
| `sentry.glb` | `hull` 1,958 + `eye` 384 = 2,342 | 1024² | 437 KB |
| `seed.glb` | `rock` 5,922 | 1024² | 784 KB |
| `anchor.glb` | `hull` 2,532 + `emitter` 672 = 3,204 | 1024² | 643 KB |
| **all four** | 16,661 | | **3.0 MB** |

Every file has one texture set (base colour, tangent-space normal,
metallic-roughness, emissive; WebP). Child nodes (`eye`, `emitter`) share
the parent's images through their own material copy, so the game can tint
or pulse one node without touching the rest. The parts are bmesh
primitives joined into one mesh; edges are rounded in the normal map by
Cycles' Bevel node (the flat facets stay crisp), and the paint is the
Thorn's finish — panel lines with per-panel tint, AO grime, aft streaks,
chipped edges to bare metal — scaled with the model.

### Maul (`maul.glb`)

17.45 m from the snout to the tail spike (nozzle exits 8.5 m behind the
origin), 12.4 m span, 7.3 m tall from the torpedo spine to the tines,
radius 9.0 m. The Harrow bomber drone: the Thorn's faceted sections and
paint (gunmetal `#4a4f55`, oxblood `#5e1a1d`, hazard `#d9a21b`, red
`#ff2a1a` glow) on a heavy, hunched body. A steep faceted brow with a big
hexagonal red eye under a V of oxblood armour and two small sensor pits on
the cheeks; glowing gill slits behind the head; five layered carapace
plates down the back with one row of six raked harrow tines on the ridge;
a deep blade keel under the belly whose lower edge carries the torpedo
spine (a long octagonal magazine with hazard and oxblood bands, ring
collars, tail fins and a launch tube at its front); drooping forward-swept
blade wings with black leading-edge strips, hazard bands, oxblood tips,
tip spikes and red tip lights; layered pauldrons over the wing roots;
chine strakes; two gun blisters low on the cheeks with long barrels like
mandibles; twin octagonal engine housings with banded collars, big bells
and glowing throats; a tail spike between the engines; 16 RCS blocks. No
canopy.

| node | meaning |
|---|---|
| `nozzle_L`, `nozzle_R` | engine exits, size 0.75, exhaust +Z |
| `muzzle_L`, `muzzle_R` | gun barrel tips, low on the cheeks |
| `launcher_0` | front end of the torpedo spine, under the keel |
| `rcs_01` … `rcs_16` | the Thorn's layout: nose up/down/left/right, tail up/down/left/right (on the engine housings), four wingtip ports, two forward-facing snout ports, two aft-facing ports on the housings; every axis and turn has ≥ 2 |
| `cam_cockpit` | just in front of the eye lens |
| `dock` | on the carapace, over the engines |
| `light_0`, `light_1` | red wingtip lights, steady |
| `col_00` … `col_11` | 12 spheres: six along the body, shoulders, wingtips, two along the spine |

### Eye (`sentry.glb`)

8.0 × 8.1 m across the fins, 7.0 m long (glTF Z), radius 4.8 m. A
watching drone: an armoured sphere (r 2.4 m) of oxblood plates in front
and gunmetal plates
behind a hazard-striped equatorial belt, with dim red light leaking from
the seams between the plates; six swept blade fins radiating from the
belt (three long, three short, hazard bands and oxblood tips); six spines
raking back from the rear plates; a hexagonal drive boss with three vents
and an aerial with a red tip behind. In front a hexagonal collar holds
one large eye: a glossy dark ball with a domed red lens — aperture blades,
a dark pupil ring and a hot core in the emissive map.

| node | meaning |
|---|---|
| `eye` | the eyeball and lens, a child of `hull`. Origin at the eye's centre (glTF `[0, 0, -1.05]`); at rest it looks along its local −Z (Blender +Y). The ball (r 1.15 m) sits in its socket with 0.15 m to spare, so it can turn any way without touching the shell; past about 60° the lens goes behind the collar. |
| `sub_eye` | at the eye's centre, r 1.4 |
| `col_00` … `col_06` | the sphere (r 2.6) and one sphere on each fin |

### Seed (`seed.glb`)

A seeded nest rock: the rock reaches 20 m from the centre along its long
axis (the travel axis; its rear is sliced flat 16.4 m behind the centre),
the growths stand out to 24.3 m (`radius`), `length` 39.7 m. One mesh
node, `rock`. The rock is sculpted with `build_asteroids.sculpt` (seed
73, an elongated potato), its rear sliced
flat where the fabricators machined it, and an eruption crater with a
broken rim under each of three hatching pods: glowing cores in four
splayed oxblood armour petals. More growth breaks out around them —
metallic oxblood nodules with red pores, three clusters of steel-tipped
harrow tines, dark cables crawling over the rock to the rear — and the
rock around every growth is stained dark oxblood and threaded with
glowing red veins (thick near the pods, thinning to threads). On the
machined rear face, a three-armed thrust frame carries three rocket
clusters of three octagonal bells each. The rock is decimated from the
sculpt and its normals and paint baked from it (as the asteroids); the
growths and rockets bake their own paint, at about twice the rock's texel
density, into the same atlas.

| node | meaning |
|---|---|
| `rock` | the whole rock (the game may tumble or move it) |
| `nozzle_0` … `nozzle_2` | centre of each rocket cluster's exit plane, size 1.6, exhaust +Z (dark when idle: light them in the game) |
| `col_00` … `col_34` | 16 spheres hugging the rock (chosen greedily to cover its surface) and 19 on the pods, the tallest tines, the rocket clusters and the hub |

### Fold anchor (`anchor.glb`)

63.5 m tall along glTF +Y (Blender +Z; from −30.9 m at the claws to
+32.6 m at the cage top), the tripod 43 m across, radius 38.8 m (the
feet). A Harrow interdiction pylon: a tall hexagonal mast with banded
collars, three blades running up it carrying five hooked harrow
tines each (staggered blade to blade), oxblood armour plates on the faces
between the blades, red conduits glowing along the mast's edges and
hazard bands at the base and the top collar (with three red lamps); a
wide tripod of hexagonal legs with knee hinges and spurs, hydraulic
braces, clawed feet and blinking red foot lamps; at the top, the emitter.

| node | meaning |
|---|---|
| `emitter` | a glowing red crystal on a spindle in a six-pronged barbed cage, a child of `hull`; origin at the cage centre (glTF `[0, 28, 0]`), spins about its local Y |
| `sub_emitter` | at the emitter, r 5.2 |
| `light_0` … `light_2` | foot lamps, red, blink 1.4 s; `light_3` … `light_5` collar lamps under the emitter, steady |
| `col_00` … `col_23` | nine spheres up the mast (the last on the emitter) and five down each leg |

`length` in `js/anchors/anchor.js` is the pylon's height (glTF Y extent),
not its Z extent.

### Conventions and caveats

- Axis rule as for the ships: Blender `(x, y, z)` → glTF `(x, z, −y)`, so
  noses point along −Z and nozzles exhaust along +Z.
- `radius` is the largest distance of any vertex from the origin over all
  mesh nodes; `length` the extent along glTF Z (the anchor: along Y).
- Colliders are spheres: `col_NN` empties scaled uniformly to the radius;
  subsystems `sub_<kind>` likewise.
- The sentry's `eye` looks along its local −Z like a three.js camera,
  while `Object3D.lookAt` turns a mesh's +Z toward the target: aim it with
  `eye.lookAt(2 · eyeWorldPos − target)`, or rotate it by π about Y after
  `lookAt`.
- Emissive maps carry the eyes, lenses, lamps, gills, veins, pod cores,
  seams and throats; the game scales emissive by 3 for ships, which suits
  all four. The seed's rocket throats are only faintly lit in the map.
- The seed's `nodes.rock` names its only mesh node; the game can treat the
  whole file as the rock.
