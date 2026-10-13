## Civil models (`build_civil.py`)

Built by `tools/blender/build_civil.py` (shared parts, paint, baking,
collider fitting and the anchors writer in `tools/blender/civil_parts.py`,
which builds on the helpers in `build_ships.py` and the rock sculpt in
`build_asteroids.py`):

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_civil.py [-- freighter station colony]
```

The full build of the three takes about 4–5 minutes on an Apple-silicon
Mac (about 11 minutes when other builds share the CPU); `METEORA_FAST=1`
gives a geometry pass in about half a minute. It writes the GLBs and
`js/anchors/<name>.js`; the previews come from
`METEORA_PREVIEW_ENGINE=CYCLES … render_previews.py -- freighter station colony`.
`tests/models-civil-check.mjs` checks the budgets, the WebP textures and
their sizes, the length along the nose axis, the anchors modules against
the GLB nodes (names and positions), nozzle directions and sizes, the
turret node pairs, collider coverage, the station's bay lane and the ark's
ring opening.

| file | nodes (triangles) | textures | size |
|---|---|---|---|
| `freighter.glb` | `hull` 9,110 | base and normal 2048², MR and emissive 1024²; window tile 512² | 1,438 KB |
| `station.glb` | `hull` 15,955 + `rock` 8,640 + six turrets 2,208 = 26,803 | hull: base and normal 2048², MR and emissive 1024²; rock: base and normal 2048², MR 1024²; window tile 512² | 3,035 KB |
| `colony.glb` | `hull` 21,564 + `drive` 7,008 + four turrets 1,472 = 30,044 | hull: base and normal 2048², MR and emissive 1024²; drive: all four 1024²; window tile 512² | 3,006 KB |
| **all three** | 65,957 | | **7.3 MB** |

### How they are made

- **Geometry carries the scale.** Big hulls are kitbashed from bmesh
  primitives — chamfered lofts, lathed tanks and bells, lattice trusses,
  pipes, ribbed containers, patch plates, airlocks, greebles at several
  sizes — so they read at a distance and stay believable up close (the
  game adds its tri-planar detail layer on top).
- **Paint** (`civil_parts.finish`): weathered off-white and warm grey
  plates, panel seams in metres with per-panel tint and mismatched
  replacement plates, AO grime, streaks, rust bleeding from seams and
  recesses, chipped edges to bare metal; rust-orange `#b8652a` cargo paint,
  hazard stripes `#d9a21b`, teal `#2e6f8e` and gold bands, stencilled names
  and numbers from a small 5×7 stencil font.
- **Bake**: each texture set is one joined mesh, unwrapped by a
  hard-surface chart unwrap (charts split at sharp edges and kept within
  ~70° of their first face, unwrapped conformally, packed at one texel
  density) and baked in Cycles from its own procedural materials. The
  normal map carries the Bevel node's rounded edges plus the seams' bump.
  Faces buried in the station's rock are culled before unwrapping.
- **Windows** are not in the atlas: they are quads a few centimetres proud
  of the hull whose UVs repeat a 512² tile of 8×8 lit windows (warm
  `#ffd9a0`, some dim, some blinds drawn), one tile cell per window, so
  they stay crisp at any distance. They join the hull as a second
  material (`fr_windows`, `st_windows`, `co_windows`: base colour and
  emissive maps, roughness 0.32 factor, no normal map).
- **Lights**: every `light_N` empty sits on a small emissive fixture in
  the bake, so the lamps show even before the game adds its sprites.

### Mule (`freighter.glb`)

111.9 m from the bow docking collar to the main nozzle exit, 39.6 m
across the radiators, 34 m from the belly to the mast top; radius 57.7 m.
A working ore hauler: a chamfered cab with a two-deck crew block, a raked
bridge with a wraparound window band, a hazard-ringed docking pad on the
bridge roof, a mast, a dish and whip antennae, flood lights and a chin
sensor; `MULE-07` stencilled on the cab flanks. Behind it a square spine
with pipes and a catwalk carries five cargo frames (warm-grey girders,
hazard-striped corner gussets) holding eleven ribbed rust-orange ore
containers in a 2×2 grid at three stations (one slot empty; two
replacement boxes, one off-white, one faded teal; big white stencilled
numbers on the outer faces), then two ore hoppers with lids and a loader
truss on top and two strapped ore pods below. The drive section aft: an
engineering block, a reactor housing with glowing vents, two strapped fuel
tanks with feed pipes, V radiators on hinges, one big engine and two
smaller ones with hooped bells and glowing throats.

| node | meaning |
|---|---|
| `nozzle_C` | main engine exit, size 3.2, exhaust +Z |
| `nozzle_L`, `nozzle_R` | the smaller engines, size 2.4, slightly lower |
| `dock` | centre of the docking pad on the bridge roof |
| `sub_bridge` | the bridge, r 8.5 |
| `sub_engine_0` | the drive section, r 9 |
| `light_0` … `light_9` | red/green nav lights on the cab flanks, the radiator tips and the middle cargo frame (red to port, green to starboard); white strobes on the mast top and the belly (blink 1.2 s); amber beacons on the loader truss and the reactor (2 s) |
| `col_00` … `col_26` | 27 spheres: cab, neck, the container grid, hoppers and pods, the drive, tanks, radiators, engines |

### Varlaam (`station.glb`)

457.7 m from the docking ring to the reactor's radiator fins, about 330 m
across and 350 m tall from the keel to the tower spire; radius 271 m. The
rock (`rock` node, radius ≈ 150 m) is sculpted like `build_asteroids.py`
— lumps, knobs, planar cuts for a town plateau on top, a dock face in
front, cliffs and a flattened base, craters — with a terraced open-pit
quarry on the port flank (ochre strata on the benches, pale tailings on
the floors). The town: three round habitat towers (one 86 m tall with a
spire) and a stepped box tower with lit window decks, low blocks, two
greenhouse domes with ribbed glass and lit cells, plazas and lanes, sky
bridges, a landing pad marked `V1`; a ring of terraced houses round the
plateau rim; cliff houses hanging on the east and north-west faces like
the monasteries the town is named after, on struts, joined by walkways;
airlock domes with work lamps, tank farms and pipes over the rock. The
quarry has a gantry bridge with a trolley and bucket, haulers on the
benches, and a conveyor gallery on trestles to a mill with three ore
silos and a loader arm reaching to the dock. In front a pylon (with a
truss and pipes) carries the hub with its lit bay door and the docking
ring on four spokes (eight docking ports, hazard sectors, red, green and
amber lights). On the flanks four solar arrays on truss masts; on the back
the comms mast with two dishes, and the reactor block with stacks, glowing
vents and radiator fins. `VARLAAM` is stencilled on the pylon, mostly
hidden behind its truss.

| node | meaning |
|---|---|
| `rock` | the asteroid (child of `hull`, its own texture set) |
| `bay_0` | in front of the hub's bay door, launching −Z (forward); the lane ahead is clear of colliders |
| `sub_dock` | the docking ring's centre, r 56 |
| `sub_comms` | on the comms mast, r 16 |
| `sub_reactor` | the reactor block, r 32 |
| `turret_00` … `turret_05` + `_gun` | six mounts (size 4.2 = base radius): plateau, starboard flank, port quarter, under the bow, under the stern, on top of the dock hub |
| `light_0` … `light_25` | pad corners (amber, 1.5 s), the spire strobe, red beacons round the plateau rim (2 s), the docking ring (amber top and bottom, green starboard, red port), quarry haulers (amber, staggered), gantry floods, the mill and dock-hub beacons, port/starboard nav lights on the rock, a keel strobe |
| `col_00` … | 103 spheres: 49 hugging the rock (a core plus spheres sunk 35 m under the surface), 26 for the docking ring and hub (the ring's opening stays clear), 28 over the structures standing out of the rock |

### Long Mercy (`colony.glb`)

892 m from the front of the drive ring to the engine exits; the ring is
323 m across; radius 479 m. An evacuation ark assembled in a hurry: an
asymmetric stack of cylindrical modules — a big bow habitat with a bridge
and mast, four habitat cylinders of different sizes and liveries bundled
behind it with connector tubes and girders, a cargo spine (an open truss
round a core) with fourteen Mule containers in frames, two spherical
tanks and three long tanks, the big aft habitat with `LONG MERCY`
stencilled on both flanks, two side modules, the engine section with
radiator wings, tanks and a reactor, and two engines with gold-hooped
bells. Liveries: *Perpetua* spares in white with teal bands, the ark's own
gold bands, freighter modules in warm grey with rust bands; patch plates,
airlocks and lit window decks everywhere. Four truss struts with gold
conduits reach forward from the bow to the fold drive.

The **fold drive** (`drive` node, origin at the ring's centre, axis along
the ship's Z): a white outer casing with gold trim, hazard sector marks and
a ring of running lights on its rims; inside, past a gap bridged by radial
webs, the dark coil track (wider than the casing), 24 gold coil housings
wrapped round it and 24 focusing emitters aimed at the centre; the track's
inner face and rims glow pale cyan between the windings. The drive is one
15° sector repeated 24 times with shared UVs, so its 1024² set is sharp
(about 8 px/m). Ships fly through it: nothing intrudes inside about 113 m
of the axis (emitter tips), colliders stay outside 104 m.

| node | meaning |
|---|---|
| `drive` | the ring (separate mesh and material; emissive coils for the game to pulse) |
| `sub_drive` | the ring's centre, r 120 (the coil track's inner radius) |
| `nozzle_0`, `nozzle_1` | port and starboard engine exits, size 30, exhaust +Z |
| `sub_engine_0`, `sub_engine_1` | the engines, r 40 |
| `turret_00` … `turret_03` + `_gun` | four mounts (size 5.95): bow port and starboard, aft habitat top and bottom |
| `light_0` … `light_11` | bow mast strobe, bow nav lights (red port, green starboard), radiator-tip nav lights, a keel strobe, amber beacons on the aft habitat, white strobes on the four ring mounts (1 s) |
| `col_00` … | 108 spheres: 32 over the stack, 36 in chains along the struts, 40 round the ring's rim |

### Anchor conventions (all three)

- `js/anchors/<name>.js` is written from the empties in glTF space, metres:
  nose −Z, top +Y, right +X; Blender (x, y, z) → glTF (x, z, −y).
- Nozzle `dir` is the empty's Blender local −Y; `size` is the exit radius.
- `col_NN`, `sub_*`: the empty's uniform scale is the radius (`r`).
- `bay_N` launches along the empty's Blender local −Y (`dir`).
- `light_N`: colour and blink period (s, 0 = steady) are set in the
  script; red to port, green to starboard, white strobes, amber beacons.
- Turrets: `turret_NN` is a mesh node (origin at the yaw pivot on the hull)
  with the child mesh `turret_NN_gun` (origin at the trunnion, 3.5 × the
  turret scale above the pivot). In glTF the base's local +Y is `up` and
  its local −Z is `fwd` (barrels at rest); yaw the base about its local
  +Y, pitch the gun about its local X. The anchors list `up`/`fwd` in
  model space. Both use plain material factors (off-white, graphite and a
  rust band), shared by every turret of a model — clone them before
  darkening one turret. Under 400 triangles each.
- `radius` is the largest distance of any mesh vertex from the origin;
  `length` the extent along Z.
- The game's `prepareShip` multiplies emissive by 3 for materials with an
  emissive map: that includes the window materials and the drive.

### Known weaknesses

- Texel density is low on the big hulls (station hull ≈ 2.7 px/m, rock
  ≈ 2.8 px/m, ark hull ≈ 1.7 px/m; the freighter ≈ 8.8 px/m): close up
  the baked paint is soft, which is what the runtime detail layer is for;
  the geometry, the window tiles and the stencils stay crisp.
- The rock colliders trade a little poke-out for less empty bulge: about
  3 % of the rock's surface lies outside the spheres, by at most ~6 m.
- Thin parts (solar wings, radiator panels, antennas, whips) have no
  colliders on purpose, so ships pass through them.
