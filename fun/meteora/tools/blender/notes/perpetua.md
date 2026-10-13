## Perpetua (`build_perpetua.py`)

Built by `tools/blender/build_perpetua.py` (geometry helpers, post-bake
instancing and the collider fit in `tools/blender/perpetua_parts.py`; it
reuses `build_ships.py`'s lathe, loft, box, bar and band helpers and
`common.py`'s bake and export):

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_perpetua.py [-- perpetua]
METEORA_PREVIEW_ENGINE=CYCLES /Applications/Blender.app/Contents/MacOS/Blender --background \
  --factory-startup --python fun/meteora/tools/blender/render_previews.py -- perpetua
node tests/models-perpetua-check.mjs          # from fun/meteora
```

A full build takes about 3–5½ minutes on an Apple-silicon Mac (the 2048²
bakes and the collider fit); `METEORA_FAST=1` gives a geometry pass in
about a minute. `METEORA_CHECK=1` also reports parts that touch nothing
and the ring's clearance inside its yokes; `METEORA_COLDEBUG=1` prints how
many collider spheres each region needs at several bulge bounds;
`METEORA_DUMP=<dir>` saves the baked maps as PNG. The build writes
`assets/models/perpetua.glb` and `js/anchors/perpetua.js`.
`tests/models-perpetua-check.mjs` checks the budgets, the WebP textures and
their sizes, the length, every anchor against the GLB's nodes, the nozzle
directions, the turret node pairs, the ring node, the lights, the bay and
the colliders' coverage.

| file | nodes (triangles) | textures | size |
|---|---|---|---|
| `perpetua.glb` | `hull` 28,928 + `ring` 3,232 + 10 × (`turret_NN` 120 + `turret_NN_gun` 204) = 35,400 | `hull`: base, normal and emissive 2048², MR 1024²; `ring`: base, normal and emissive 1024², MR 512²; turrets: glTF factors | 3,538 KB |

Budget: 65,000 triangles, 4 MB. The geometry is about half the file
(32,488 + 3,860 vertices with normals, UVs and tangents); the textures are
1.52 MB.

### The Perpetua (`perpetua.glb`)

1,428 m from the nose boss to the nozzle exits, radius 728 m about the
origin. The three-hundred-year-old generation ship, now the belt's carrier,
dockyard and hospital. From bow to stern:

- **Dust shield**, 344 m across, as wide as the habitat ring it protects,
  so the ring hides behind it seen head-on: a thick lens (about 75 m at
  the centre) with a raised inner disc, a 26 m bumper rim with a faded teal
  lip, a dark scorched nose boss with a strobe, twelve radial armour ribs
  and petal tiling. The face is scorched: radial soot streaks, heat-tinted
  rings, pitting, blocks of newer pale tiles and older darker ones,
  scattered patch plates in mismatched colours. Behind it are off-white
  plating with a teal ring band, 32 graphite ribs and pump boxes. A neck
  column and six struts with shock-absorber sleeves join it to the command
  section.
- **Command section**: an octagonal drum with rows of lit deck windows (warm,
  a few cool, some dark), an amber observation gallery, teal bands, the
  programme emblem on both flanks, the bridge tower with a lit window band,
  a top deck and a mast with yards (strobe), a high-gain dish on a boom, a
  sensor blister, comm whips, and two lifeboat shuttles docked on its
  flanks (scale cues). Turrets 00–03 sit on its diagonal flats.
- **Forward truss** (32 m square, Warren-braced) with a core tube and pipes,
  rust, ochre, teal and grey cargo containers on the sides and top, and an
  ore tug docked underneath.
- **Hangar module** round the spine: plated, with raised frames and
  conduits on top, PERPETUA in faded teal on both flanks, window rows, red
  and green nav lights, turrets 04–07 on its chamfers. In its belly is a 68
  × 138 m bay mouth, 38 m deep, with a hazard-striped frame and green and
  white guide lamps. Inside: a lit ceiling grid, wall light strips, three
  gantries and two parked shuttles. A flight-control blister with a window
  band sits on the mouth's forward edge.
- **Six capsule fuel tanks** (r 19.5 m), teal-banded, bound by two hoops;
  the bottom one is a mismatched replacement in primer and warm grey with a
  hazard band.
- **Habitat ring**, r 150 m to the section centre (40 × 28 m section,
  outer radius 164 m), the separate node `ring`: segment collars with lamps,
  rows of lit deck windows on both side walls, a skylight band on the
  inner face, windows and painted blocks on the outer face, teal bands. It
  rides through four static **bearing yokes** (hazard stripes, amber lamps)
  on four static **spokes** (lift tube, rails, a transfer pod with windows)
  from the **hub**, which has a lit window band, two dish antennas and two
  masts.
- **Eight spherical tanks** (four r 34 m, four r 26 m), then the bare aft
  truss with a **pump house** and two **radiator wings** (each two layers
  of charcoal panels with lighter heat-pipe ribs and a faint warm glow at
  the root, stays to the longerons, red and green tip lights).
- **Thrust plate** (teal and hazard bands, pump boxes, a stern mast with a
  strobe, turrets 08–09 on its rim) and **three fusion engines**: plated
  bodies with three magnet coils each (thin cyan glowing seams), and
  heat-tinted bells (straw to violet to steel, soot at the lip) with a blue
  glow inside and a glowing throat. Exit radius 35 m.

Paint: off-white `#d9d6cf` plates at two scales (sections and plates)
with per-plate tint, faded mission teal `#2e6f8e` bands that skip the
replaced plates, mismatched replacement plates (fresh off-white, warm grey,
cool grey, red-oxide primer, bare metal), broad colour drift, AO grime, aft
streaks and chipped edges. Graphite `#2b2d31` structure, hazard
`#d9a21b`, rust `#b8652a` cargo, warm windows. Edges are rounded in the
normal map by baking from a bevelled copy.

Texturing: `hull` and `ring` are two texture sets. Repeated parts are baked
once and copied after the bake with the master's UVs, so the texels go to
unique surfaces: the ring's four quadrants (seams under collars), the
shield's eight back sectors (seams under ribs), the spokes and yokes, five
of the six fuel tanks, both sphere-tank rings, the engines and the
mirrored radiator wing. The ring arcs, the shield's face and every lathed
part carry their own seam-free UVs. Texel density is weighted (the shield
face, command section and hangar get more; trusses and backs less). On the
hull that measures 0.5 m per texel on the favoured surfaces and 0.73 m at
the area-weighted median (1.5 m on trusses and backs); the ring gets
0.23 m. That is blurry a few metres away, so the scale is carried by
geometry (trusses, tanks, plates, greebles at several sizes, docked craft)
and the game's runtime tri-planar detail layer is meant to take over up
close.

| node | meaning |
|---|---|
| `hull` | everything that does not spin (one mesh, material `hull`) |
| `ring` | the habitat ring (material `ring`). Origin on the ship's axis at the ring's centre: glTF `(0, 0, 15)`. Spin it about its local Z (the ship's long axis); it clears the static yokes by 2 m at any angle |
| `turret_00` … `turret_09` | point-defence turret bases, children of `hull`; origin at the yaw pivot on a sponson. glTF local +Y = up out of the hull (Blender +Z): yaw about local Y |
| `turret_NN_gun` | child of its base; origin at the trunnion, 4.6 m above the pivot. Twin barrels along local −Z in glTF (Blender +Y): pitch about local X. Plain materials `turret_body` (off-white) and `turret_gun` (graphite) |
| `nozzle_0` (top), `nozzle_1` (lower port), `nozzle_2` (lower starboard) | engine exit centres, exhaust +Z, size 35 (exit radius) |
| `sub_engine_0..2` | the engines, r 38, at the coil stacks just ahead of the bells |
| `sub_bridge` | the bridge tower on top of the command drum, r 24 |
| `sub_hangar` | the hangar bay, r 48 |
| `bay_0` | the bay mouth's centre in the belly; launch direction (local −Y) down and slightly forward: glTF `(0, −0.97, −0.24)`. No collider contains it or the first 50 m of the launch path |
| `light_00` … `light_12` | nav lights. Red to port (`00` shield rim, `04` hangar, `08` radiator tip, `11` thrust plate) and green to starboard (`01`, `05`, `09`, `12`), steady. White strobes: `02` shield rim top (1.6 s), `03` nose boss (2.4 s), `06` bridge mast (1.2 s), `07` hangar belly (1.2 s), `10` stern mast (2.0 s). Each has a small glowing lamp in the mesh |
| `col_00` … `col_82` | 83 collision spheres (uniform scale = radius, r 22–94 m). `col_00`–`col_62` are hull spheres (children of `hull`); `col_63`–`col_82` are the ring's 20 (children of `ring`) |

### Notes for the game

- **Colliders.** The ring's 20 spheres (r 31) sit evenly round its
  section centre, one on each yoke, so the list holds at any spin angle;
  the static spokes and yokes need no special case. The hull's 63 are a
  greedy cover of the hull surface with a bounded bulge. Every hull face
  (except antennas, masts, the bay's inside and the bells' insides, which
  count as solid) lies inside a sphere or within 3 m of one. Spheres stand
  off the surface by at most 33 m, and that happens only at the thin
  places: the shield's bumper rim, the radiator stacks and the engine
  bells. Over the bulky modules they hug much closer (median radius 45 m).
  The space between hub and ring is open: fighters can fly between the
  spokes. The bay's launch path is kept clear.
- **Turrets**: `turrets[].up` and `fwd` are the base node's local +Y and
  −Z in glTF. `size` 14.1 is the largest distance from the pivot to any
  turret vertex (barrel tips). Barrels rest pointing forward (−Z).
- **Emissive**: windows, the bay, lamps, the coil seams, the bell interiors
  and the radiator roots are baked into the emissive maps at ordinary
  strength, expecting the game's ×3 scale for ships.
- The model's nose is the dust shield's boss (glTF z −726). The origin is
  near the middle of the length (by the ring), not at the centre of mass.
- **Known weaknesses.** The standard three-quarter preview crops the
  shield, because `render_previews.py` frames long ships tightly; the side,
  top, rear and close views show it whole. Texels are coarse at fighter
  range (see Texturing). The colliders bulge at the thin parts as
  described. The port radiator lamp only touches its wing after the mirror
  copy, so `METEORA_CHECK` lists it as loose before the bake.
