# Set `military` → `assets/models/military.glb` (models v3)

Built by `tools/blender/build_military.py`, with helpers, extra surface
recipes, the v3 weathering and the camouflage-net atlas in
`military_parts.py`:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_military.py [-- node ... | --no-bake | --no-previews | --fast]

A full run builds all 42 nodes, bakes each with `bake.bake_model` (through
`military_parts.bake`), exports the GLB with WebP textures and renders three
previews per node at 768² (`<node>.png` front 3/4, `<node>_back.png`,
`<node>_close.png` from 2 m) into `tools/blender/previews/military/`. Naming
nodes after `--` builds and bakes only those and writes
`$TMPDIR/military_partial.glb`. Only a full build writes the real GLB.
`--no-bake` is for geometry checks; `--fast` gives tiny bakes. After a full
build, run the card fix on it:

    python3 -I fun/hedgerow/tools/fix_card_alpha.py fun/hedgerow/assets/models/military.glb

**GLB:** 42 nodes (25 from v1 and 17 from v2, all reworked in v3), 127,321
tris, 17,348,764 bytes after `fix_card_alpha` (16.5 MiB, within the 18 MB
budget). It holds 129 WebP textures (9.7 MB; base colour, normal and packed
metallic-roughness per node, plus the net atlas) and 43 materials. Geometry
is 7.5 MB (POSITION, NORMAL, TEXCOORD_0, COLOR_0, indices).

**Build time:**

* Full build with bakes and export, no previews: 8 min 42 s of wall time,
  with the load average at 20–40.
* An earlier run with the other sets baking (load 35–100) took 12 min 57 s.
* The 126 previews add 3–6.5 min, depending on load.

**Origins, colliders and anchors are those of v2:** every node's
`colliders` and `anchors` extras were compared with the v2 GLB and are
identical. Six nodes whose bounds grew in v3 (spilled sand, nails, saggier
bags) keep v2's origin through a pinned offset (`PIN` in the build script);
the MG nest's gun rest keeps v2's height (`floor`).

**Bases not on z = 0:**

* `jeep_wreck`: the rear-left tyre is on z = 0 and the nose is sunk to −0.36.
* `dugout_entrance`: the steps and floor inside the doorway go down to −0.75.
* `pak40`: the trail spades dig in to −0.06.
* `sandbags_ruined`: tumbled bags sink to −0.10.
* `mg_nest`: rolled bags reach −0.01.

## Nodes

Sizes are x × y × z in Blender space (z up, front = −Y), measured on the
exported mesh. Collider tops are heights in metres. Anchor positions are in
Blender space. In the extras they are in glTF space (from kit), with yaw in
radians. **Yaw 0 = facing the model's front (−Y in Blender, +Z in three.js).**
Every node has one baked material (the camouflage net has a second,
alpha-card material). Every primitive has POSITION, NORMAL, TEXCOORD_0 and
COLOR_0 (white after the bake: the occlusion is in the base colour).
Pickups have `colliders: []`. The sand heaps of the split bags make
`sandbags` 1.12 m and `sandbags_low` 1.08 m deep (the walls themselves are
unchanged).

#### v1 (upgraded)

| node | size x × y × z (m) | tris | texture | colliders | anchors |
|---|---|---|---|---|---|
| `sandbags` | 3.07 × 1.12 × 1.08 | 3846 | 2048² | 1 box; tops 1.06 | — |
| `sandbags_low` | 3.07 × 1.08 × 0.55 | 2058 | 1024² | 1 box; tops 0.55 | — |
| `sandbags_curve` | 2.46 × 2.47 × 1.08 | 3972 | 2048² | 3 box; tops 1.06 | — |
| `mg_nest` | 4.92 × 4.52 × 1.14 | 9211 | 2048² | 11 box; tops 0.92, 1.1 | `gun` (0.00, -1.76, 0.92) 0°; `gunner` (0.00, -0.76, 0.00) 0° |
| `bunker` | 7.89 × 6.96 × 3.33 | 3660 | 2048² | 14 box; tops 0.6, 1.2, 1.55, 2.7, 2.95 | `gunner` (-0.01, -1.52, 0.05) 0°; `slit` (-0.01, -2.97, 1.38); `door` (1.09, 2.73, 0.00) 180°; `lamp` (-0.01, -0.37, 1.93) |
| `trench_wall` | 4.06 × 0.46 × 1.78 | 1196 | 1024² | 1 box; tops 1.7 | — |
| `duckboard` | 0.84 × 3.00 × 0.11 | 860 | 512² | 1 box; tops 0.1 | — |
| `barbed_wire` | 4.00 × 1.00 × 1.08 | 6002 | 1024² | 1 box (kind wire); tops 1.09 | — |
| `hedgehog` | 1.84 × 1.93 × 1.50 | 846 | 1024² | 1 cyl; tops 1.35 | — |
| `barrier` | 5.61 × 0.38 × 1.24 | 1314 | 1024² | 4 box; tops 0.96, 0.99, 1.09, 1.2 | — |
| `sentry_box` | 1.24 × 1.24 × 2.60 | 1636 | 1024² | 3 box; tops 2.4 | `guard` (0.00, 0.05, 0.11) 0° |
| `crate` | 1.09 × 0.57 × 0.43 | 788 | 1024² | 1 box; tops 0.44 | — |
| `crate_large` | 1.40 × 1.22 × 1.00 | 552 | 1024² | 1 box; tops 1.0 | — |
| `barrel` | 0.60 × 0.59 × 0.89 | 796 | 1024² | 1 cyl; tops 0.88 | — |
| `jerrycan` | 0.35 × 0.17 × 0.50 | 614 | 512² | 1 box; tops 0.47 | — |
| `ammo_box` | 0.29 × 0.10 × 0.23 | 164 | 512² | none | — |
| `medkit` | 0.34 × 0.13 × 0.24 | 518 | 512² | none | — |
| `charge` | 0.29 × 0.16 × 0.24 | 504 | 512² | none | — |
| `tent` | 4.11 × 3.62 × 2.49 | 3478 | 1024² | 3 box; tops 1.4, 2.0 | `lamp` (0.00, 0.03, 2.00) |
| `radio_table` | 1.60 × 1.17 × 2.61 | 1944 | 1024² | 2 box; tops 0.79, 1.11 | `radio` (0.05, 0.26, 0.95); `operator` (0.05, -0.57, 0.01) 180° |
| `flak38` | 2.16 × 3.23 × 1.95 | 4300 | 1024² | 3 box + 1 cyl; tops 0.32, 1.1, 1.5 | `muzzle` (0.00, -1.59, 1.90); `charge` (0.82, 0.33, 0.27) 90°; `gunner` (-0.32, 0.99, 0.76) 0° |
| `truck` | 2.41 × 6.12 × 2.88 | 12411 | 2048² | 3 box; tops 1.57, 2.17, 2.87 | — |
| `truck_burnt` | 2.46 × 6.15 × 2.79 | 7987 | 2048² | 3 box; tops 1.38, 1.48, 1.98 | `fire` (0.01, -0.71, 1.11) |
| `jeep_wreck` | 1.62 × 3.62 × 1.45 (base -0.36) | 9644 | 2048² | 2 box; tops 0.67, 1.0 | `smoke` (-0.03, -1.00, 0.90) |
| `watchtower` | 2.94 × 3.15 × 7.04 | 2876 | 1024² | 6 box + 4 cyl (kind wire); tops 4.41, 4.51, 5.61 | `lookout` (0.00, -0.31, 4.51) 0°; `ladder` (0.31, 1.84, 0.01) 0°; `ladder_top` (0.31, 0.56, 4.51) 180°; `light` (0.55, -1.28, 5.87) 0° |

#### v2 (new)

| node | size x × y × z (m) | tris | texture | colliders | anchors |
|---|---|---|---|---|---|
| `kubelwagen` | 1.62 × 3.85 × 1.36 | 7554 | 2048² | 1 box; tops 0.98 | `driver` (-0.33, -0.33, 0.66) 0°; `passenger` (0.33, -0.33, 0.66) 0° |
| `motorcycle_sidecar` | 1.71 × 2.61 × 1.17 | 5274 | 1024² | 2 box; tops 0.89, 0.98 | `rider` (-0.40, 0.26, 0.96) 0°; `gunner` (0.42, 0.36, 0.67) 0° |
| `pak40` | 2.95 × 6.39 × 1.49 (base -0.06) | 4320 | 2048² | 3 box + 2 cyl; tops 0.36, 0.9, 1.48 | `muzzle` (0.00, -3.19, 1.11); `gunner` (-0.42, 0.65, 0.00) 0°; `loader` (0.45, 0.95, 0.00) 0°; `charge` (0.00, 0.82, 0.92) 180° |
| `halftrack_wreck` | 2.77 × 6.82 × 2.00 | 5468 | 2048² | 7 box; tops 0.7, 1.32, 1.6, 1.62, 1.65 | `fire` (0.26, 0.34, 0.95) |
| `ammo_stack` | 1.51 × 1.51 × 1.23 | 4668 | 1024² | 2 box; tops 0.67, 1.01 | — |
| `jerrycan_stack` | 1.83 × 1.09 × 1.25 | 2032 | 1024² | 1 box; tops 0.91 | — |
| `drum_stack` | 2.27 × 1.67 × 0.90 | 2312 | 1024² | 1 box + 3 cyl; tops 0.66, 0.88 | — |
| `stretcher` | 0.60 × 2.30 × 0.16 | 360 | 512² | none | — |
| `dropped_helmet_de` | 0.38 × 0.35 × 0.33 | 944 | 512² | none | — |
| `dropped_helmet_us` | 0.34 × 0.32 × 0.28 | 776 | 512² | none | — |
| `cable_reel` | 1.30 × 0.90 × 0.58 | 1072 | 512² | 1 box; tops 0.58 | — |
| `field_telephone` | 0.36 × 0.13 × 0.33 | 424 | 512² | none | — |
| `camo_net` | 5.83 × 4.54 × 2.26 | 1428 | 512² | 4 cyl; tops 2.21 | — |
| `dugout_entrance` | 4.40 × 3.88 × 3.10 (base -0.75) | 2186 | 1024² | 6 box; tops 0.6, 1.8, 1.85, 2.25 | `door` (0.00, 0.36, 0.00) 180°; `inside` (0.00, 1.56, -0.65) 180° |
| `mg42_tripod` | 0.98 × 1.64 × 0.64 | 2236 | 1024² | 1 box; tops 0.5 | `gunner` (-0.03, 0.95, 0.00) 0°; `muzzle` (-0.03, -0.82, 0.55) |
| `sandbags_ruined` | 3.49 × 2.64 × 0.83 (base -0.10) | 4796 | 1024² | 3 box; tops 0.34, 0.72 | — |
| `sign_minen` | 0.65 × 0.10 × 1.44 | 294 | 512² | 1 cyl; tops 1.2 | — |

## v3: the realism pass

Driven by the 2 m close-ups: flat paint, clean bags, white concrete and
blurry atlases read as CG. v3 changes the surfaces of every node and adds
detail geometry where the close-ups asked for it.

### Weathering overlays (every node)

`register_surfaces()` wraps every recipe of the process with an overlay
picked by material family (`FAMILY` → `OVERLAY` in `military_parts.py`).
The overlays read a per-model **drip map** baked just before the surfaces
(`_drip_maps`): the object-space position is baked into the atlas, which
gives the direction of "down" in every UV island; each texel then takes the
strongest source above it on the same surface, fading with distance
(pointer jumping in numpy, a few seconds per model). Its channels:

* **R, rust:** sparse spots on crevices (seams, round bolt and nail heads),
  chipped edges and a few top edges. Streaks are 4–45 cm long by kind.
* **G, grime:** rain-washed dirt from edges and the top rows of every face.
* **B, crevices:** occlusion over 3.5 cm.

The families:

* **Painted steel** (`camo_de`, `paint_sand`, `metal_olive`, `metal_gray`,
  `olive_wreck`, helmets, number plates, can stencils):
  * Dents and panel waviness in the normal map: 6 mm on vehicles, 12 mm on
    wrecks, 1–4 mm on guns and props.
  * Sun-faded tops and fine scratches.
  * Rust streaks running down from seams, bolts and chips, grime streaks,
    and dirt in the recesses.
  * Paint worn through in patches on low flat surfaces (treads, running
    boards, bumpers).
  * Mud: a ragged band up to the lower third of the model (at most 0.85 m),
    wet and dark low and paler where dry. Droplets and blobs are flung onto
    the sides and undersides, with a lumpy crust.
  * Mud caked under the wings and in the wheel arches.
* **Bare steel** (`metal_dark`, `iron`, `wire`, `rust`, gun metal): rust
  and grime streaks, crevice dirt, mud low down.
  * `rust` itself is now dark brown scale with orange only in flakes.
  * `iron` (the hedgehog, hasps, nails) is dark mill scale and brown rust in
    soft patches at several scales, instead of the old orange and black
    camouflage-like blotches.
* **Burnt** (`burnt_body`, `rust_dark`, `burnt`): soot streaks, orange rust
  runs, dents, mud. The ash is greyer and darker.
* **Wood**:
  * Silver-grey where the sky reaches it, with drying checks (most on the
    tops). Already-grey `wood_old` is darkened a little so it does not go
    chalky.
  * Rust from nail heads and grime streaks.
  * Damp and green-black algae at the foot of walls and posts, and mud.
* **Canvas**:
  * Folds in the normal map.
  * Water standing dark and glossy in the hollows of the top. On the truck
    tilt a per-vertex hint marks the sag between the hoops.
  * Mildew, grime and mud.
* **Cloth, webbing, leather:** crevice dirt, a little grime and mud.
* **Rubber** (`r_tyre`): dark, with brown-grey bloom and fine cracking on
  the sidewalls and a worn, slightly glossy tread. Mud is packed into the
  tread and caked on the lower half.
* **Glass:** a dust film and faint rain runs.
* **Sandbags** (`r_sandbag3` replaces the shared recipe in this process):
  * An open hessian weave with slubs, and creases where the sack is drawn
    tight.
  * Each bag has its own shade (a per-vertex hint from the builder) and a
    bleached top.
  * The lower part of every bag stays wet and dark, with a ragged tide line.
  * Grime runs, damp and algae at the foot, mud.
* **Concrete** (`r_concrete3`, also under `concrete_camo`):
  * Darker wartime concrete with 16 cm shuttering-board courses (tone and
    grain per board, fins at the joints).
  * Formwork panel joints every 1.25 m, and tie holes on a 0.6 m grid
    weeping rust.
  * Lime leaching white below the horizontal joints.
  * Air pits, and chipped arrises showing the aggregate.
  * Black algae streaks from the edges, moss and damp at the base.

The shared ground splash of `surfaces.finish` is turned off for these
families (`mil_*` profiles, splash 0) because the overlays lay their own
mud.

### New recipes

| key | what |
|---|---|
| `stencil_wood`, `stencil_wood_old`, `stencil_wood_dark` | worn stencilled lettering (strokes with stencil bridges) on the crate boards |
| `stencil_paint_sand`, `stencil_metal_olive` | the same on MG ammunition cans |
| `plate` | a white enamel number plate with black characters and a rusty rim |
| `sand_spill` | earth and sand run out of a split sack: damp, grainy, clods and pebbles |
| `crack` | the dark inside of a split in timber |

### Geometry

* **Sandbags:**
  * Bags sag and spread more in the middle.
  * Tie cords are hessian instead of pale webbing.
  * Split bags: a torn lips-and-fill tear on the belly of a bag (the most
    proud point near the aim) with the fill heaped at the foot. There is one
    on `sandbags`, `sandbags_low` and `sandbags_curve`, one on the inside of
    the `mg_nest` wall, and one on `sandbags_ruined` (`military_parts.spill`).
* **Tyres:** twice the segments, staggered tread blocks (centre 1.25× and
  shoulders 0.8× the lug depth). The loaded sidewall bulges at the contact
  patch on every flattened tyre.
* **Truck tilt:** sags 6.5 cm between the hoops (was 4 cm).
* **Timber:** drying splits in the end grain of the trench-wall posts and
  the barbed-wire frame legs (`split_end`).
* **Nails:** at every board end of `crate` and of the plank crates in
  `ammo_stack`.
* **Stencils:** blank plates replaced by worn stencilled lettering, laid
  1 mm proud on the boards. On `crate_large` the stencils sat 2 cm in front
  of the planks and now sit on them. The ammunition cans have stencilled
  labels.
* **Number plates** with characters on `truck`, `kubelwagen` and
  `motorcycle_sidecar`.
* **`trench_wall`:** the earth through the broken board is `sand_spill`.

### Atlases

Sizes are set per node in `BAKE`:

* **2048²** (roughness/metal 1024², normal 1024²): `truck`, `truck_burnt`,
  `halftrack_wreck`, `jeep_wreck`, `kubelwagen`, `pak40`, `bunker`,
  `mg_nest`, `sandbags`, `sandbags_curve`. These bake with 14/5/4 AO, edge
  and normal samples.
* **1024²** (roughness/metal 512²): the other large props.
* **512²:** small pickups.

Before packing, every UV island is scaled by how open its faces are (rays
cast from each face): enclosed faces and undersides get far fewer texels
(`_scale_islands`, passed to `bake_model` as `scale_islands`). On the truck
this took the median texel from 8.9 to 5.8 mm at 2048². The drip map is
baked at most 1024².

## What changed from v1 (in v2)

The v1 names, origins, colliders and anchors still hold. The bunker gains
wing-wall colliders and a `lamp` anchor, and the watchtower gains a `light`
anchor. The trench wall has an earth spill in front, so its depth is now
0.46 m. Everything has roughly ×3 the geometry and a PBR bake:

* **Sandbag walls** (`sandbags`, `_low`, `_curve`, `mg_nest`,
  `sandbags_ruined`): finer, plumper bags. Header bags have gathered tied
  ends with a cord round the neck and an ear. Stretcher rows are lofted with
  creases at the joints, with slump and lean. Burlap is baked with mud low
  down.
* **`mg_nest`**:
  * MG ammunition cans: stacked, one open with a belt hanging out.
  * Spent 7.92 mm cases scattered under the gun.
  * The spare-barrel case leaning on the wall, and a bag fallen in.
* **`bunker`**:
  * Board-formed concrete with weathered camouflage blotches
    (`concrete_camo`) outside, plain concrete inside.
  * Bullet pocks and chips round the embrasure.
  * A shell hit that tore open the front-left corner of the roof slab, with
    bent rebar.
  * A bolted armour plate with a narrower slit in the stepped embrasure.
  * Concrete wing walls forming an entrance cutting at the rear door, a
    steel door in an angle-iron frame swung open, and a vent pipe.
  * Inside: a bulkhead lamp that glows (anchor `lamp`), ammunition, a field
    telephone on the bench, and a cable run.
  * The brief's "steps down to the door" are not modelled. The interior
    floor stays at z = 0.05 so the level's heightfield terrain still works;
    the entrance is a level cutting.
* **Trench pieces**:
  * `trench_wall`: a broken board with earth spilling through, wire
    bindings, and anchor wires at the post heads.
  * `duckboard`: bevelled slats and a broken slat.
  * `barbed_wire`: real barbs (two wires wrapped round the strand), a
    twisted double strand, squared X-frames bolted at the crossing, and a
    concertina coil.
* **`hedgehog`**: L-angle beams with gusset plates and hex bolts at the
  joint, plus end plates.
* **`barrier`**:
  * Pivot bearing with bolts and a stopped boom tip.
  * A round stop disc hung from the boom (no lettering).
  * The counterweight is a plank box of stones.
* **`sentry_box`**:
  * Built of vertical boards with chevrons.
  * A felt-covered pyramid roof with a fascia and finial.
  * A shelf inside with a field telephone.
* **Crates, barrel, cans**:
  * `crate` and `crate_large`: boarded construction, nailed lids, rope
    handles, hasps, stencil blocks (lettered in v3).
  * `barrel`: rolling hoops, dents and bungs.
  * `jerrycan`: pressed X, triple handles, spout and cam lever.
  * `ammo_box` is now the MG ammunition can.
  * `medkit`: buckled straps and loops.
  * `charge`: strapped blocks with buckles, a detonator and a coiled red
    fuse.
* **`tent`**:
  * Canvas hanging in folds, sagging between poles, with hems.
  * Rolled door flaps with ties, guy ropes with wooden runners and pegs.
  * A hurricane lantern under the ridge that glows (anchor `lamp`).
* **`radio_table`**:
  * The radio has a dial window, knobs and sockets, with its lid down on the
    table and its power unit beside it.
  * On the table: a handset and cord, headphones, a Morse key, a notebook
    and pencil, a map case and papers, and a field telephone.
  * The operator's folding stool.
* **`flak38`**:
  * The cruciform platform has a bolt circle, ribs, and levelling jacks with
    screw housings, cranks and pads.
  * A geared traverse ring, and cheeks with lightening holes.
  * Handwheels with spokes and grips, pressed pan seats, footrests and a
    firing pedal.
  * A bolted shield with a sight hatch and wings.
  * On the gun: receiver ribs, the buffer housing, a cocking lever, the
    curved 20-round magazine, the Flakvisier, and a ring foresight.
  * Spare magazines in a rack.
* **`truck`**:
  * Opel Blitz in dunkelgelb camouflage (`camo_de`).
  * Chassis and running gear: leaf springs with hangers, an I-beam front
    axle and tie rod, the rear axle and differential, a propeller shaft,
    and the engine and gearbox.
  * Wheels: tread lugs and wheel nuts.
  * Front: bonnet with louvres, catches and hinge line; the grille with its
    badge; headlamps with rims and glass; and a blackout lamp.
  * Cab: door seams, rain gutters, hinges, mirrors and wipers.
  * Cab interior: bench, steering wheel with spokes, dash with dials, gear
    lever and pedals.
  * Bed: a planked floor, stake pockets and tailgate chains, with jerrycans
    in a rack.
  * Rear: tail lights, a number plate (lettered in v3), and the exhaust and silencer.
  * Tilt: canvas with folds and sag, rope lashing laced to hooks, and rear
    straps.
* **`truck_burnt`**:
  * The same truck burnt out (`burnt_body`: rust-brown oxide, grey ash,
    soot), on its rims.
  * The bonnet side panel lies in the dirt and the engine shows.
  * The left door hangs open on one hinge, and the bench is burnt down to
    its springs.
  * Two bent hoops remain; the bed boards are mostly gone, with the
    tailgate hanging.
* **`jeep_wreck`**:
  * Bent, dented panels in heavily chipped olive drab with rust and mud
    (`olive_wreck`), and a sprung bonnet.
  * The windscreen frame is folded onto the bonnet with one pane shattered
    and the right post torn and bent up.
  * Leaf springs, axles, differentials and the steering.
  * Seats on tube frames; the steering wheel, levers and dash.
  * Shovel and axe strapped to the side, and the jerrycan in its bracket.
* **`watchtower`**:
  * Bolts at every brace crossing.
  * A searchlight on a yoke at the front rail, with its cable run down a
    leg (anchor `light` at the lens).
  * Sandbags along the platform front, and a field telephone on a shelf.

## New nodes

* **`kubelwagen`**:
  * VW Typ 82 in `camo_de`: the flat-sided tub with pressed ribs and four
    door seams.
  * Bolted mudguards, the spare wheel in its well on the bonnet, and
    headlamps.
  * Windscreen, and the folded hood with its bows on the rear deck.
  * Engine louvres, seats, steering wheel and a jerrycan.
  * Anchors `driver` and `passenger` are the seats.
* **`motorcycle_sidecar`**:
  * BMW R75 with sidecar, plain dunkelgelb (`paint_sand`).
  * Spoked wheels, a boxer twin with finned cylinders and exhausts, the
    tank with knee pads, the sprung saddle, and the handlebar and headlamp.
  * The boat-shaped sidecar with its own wheel and a spare.
  * An MG on a pintle at the front of the sidecar.
  * Anchors `rider` and `gunner` are the saddle and the sidecar seat.
* **`pak40`**:
  * Split trails open about 50° with spades, handles and a towing eye.
  * The spaced double shield angled back with a sight port, and the lower
    apron.
  * The barrel with its double-baffle muzzle brake and recuperators; the
    breech and the loading-tray rails.
  * The ZF sight and handwheels.
  * An opened three-round basket and spent cases by the breech.
  * Anchors: `muzzle`, `gunner` (left of the breech), `loader` (right), and
    `charge` (on the breech).
* **`halftrack_wreck`**:
  * Burnt Sd.Kfz. 251 Ausf. D: the faceted hull with its open compartment
    and floor plates, and the front MG shield.
  * Engine hatches and louvres, stowage bins, the exhaust, and the front
    wheels burnt to the rims.
  * Geared drive sprockets, idlers, and interleaved road wheels.
  * The right track is intact. The left track has come off: it lies under
    the wheels and trails 1.2 m out behind, two road wheels are missing, and
    one lies in the dirt.
  * Bench frames burnt to springs, one rear door hanging open, and burnt
    jerrycans.
  * Anchor `fire` is the compartment centre.
* **`ammo_stack`**: twelve boarded 7.5 cm shell crates cross-stacked three
  high, with MG cans.
* **`jerrycan_stack`**: a pallet with six cans standing, two laid across, one
  on top and one fallen.
* **`drum_stack`**: three drums standing, two lying on log chocks, and one
  knocked over.
* **`stretcher`**: poles with stirrup feet, a sagging canvas bed, spreader
  bars and a folded blanket.
* **`dropped_helmet_de`**: an M40 Stahlhelm (flared skirt, visor, liner)
  tipped on its rim.
* **`dropped_helmet_us`**: an M1 with chinstraps trailing.
* **`cable_reel`**: a telephone cable drum on its carrier frame, with a crank
  and a loose end trailing 1 m on the ground.
* **`field_telephone`**: a Feldfernsprecher 33 with bakelite case, handset in
  its cradle, crank, terminals and strap. It is also used inside the
  bunker, the sentry box, the watchtower and on the radio table.
* **`camo_net`**:
  * Garnished netting as alpha cards over four forked poles, sagging between
    them and hanging down at the edges, with tufts along the border and guy
    ropes.
  * The card material `camo_net_cards` (RGBA atlas, 1 m per tile on the box
    UVs) exports as alphaMode MASK and doubleSided. The poles and ropes are
    baked.
* **`dugout_entrance`**:
  * A turf mound (the slope) with a cutting into it, revetted with stacked
    logs on stakes.
  * A log portal with a lintel, roof logs and a board.
  * Plank-lined walls inside, with three log steps down into the dark.
  * A gas curtain half drawn, a duckboard in the cutting, and sandbags by
    the door.
  * **Base:** the cutting is at z = 0. The steps and the floor inside the
    doorway go down to z = −0.75, so the terrain there must be lowered or
    hidden by the slope.
  * Anchors: `door` (in front of the portal, facing in) and `inside` (the
    dugout floor).
* **`mg42_tripod`**:
  * Lafette 34 with an MG 42: front legs with pads, the rear leg with its
    leather rest, the cradle with buffer, the traverse dial and the MGZ 34
    sight.
  * A belt running into the gun from an open can, and spent cases.
  * Anchors `gunner` and `muzzle`.
* **`sandbags_ruined`**: a 3.4 m wall collapsed in the middle. A two-course
  stump stands with the ends still four courses high, about 17 bags lie
  tumbled in front and behind, and there are heaps of spilled earth.
  Colliders: the stump (0.34) and the two end stacks (0.72).
* **`sign_minen`**: a stake with a yellow board nailed on and a painted black
  skull and crossed bones (no text).

## Baking and the extra surfaces

The surfaces are registered per process by
`military_parts.register_surfaces()`; `kit.py`, `bake.py` and `surfaces.py`
are untouched. `military_parts.bake` no longer swaps `bake.unwrap` (the
shared unwrap packs by bounding box now). It sets the weathering context
(`CTX`: kind, height, seed), passes `scale_islands`, halves the
roughness/metal image of large atlases, and removes the bake hints and
helper images afterwards. Per-node kinds (`KIND_OF` in the build script:
vehicle, wreck, gun, bags, concrete, wood, prop, small) set the mud line,
streak lengths and dent depth (`KIND`).

| key | what |
|---|---|
| `camo_de` | German 1944 three-tone on steel: dunkelgelb (greyer in v3) with sprayed olive-green and red-brown blotches, chips, rust bleed, dust |
| `paint_sand` | the same paint, plain dunkelgelb |
| `concrete_camo` | the v3 concrete with weathered camouflage blotches |
| `burnt_body` | steel after a petrol fire: rust-brown oxide, grey ash where hottest, soot round openings, blistered |
| `rust_dark` | dark rust for burnt running gear |
| `olive_wreck` | US olive drab, heavily chipped, rust bleeding, mud splashed high |
| `brass` | cartridge brass, tarnished (no overlay: spent cases stay bright) |
| `bakelite` | telephone and radio bakelite, worn at the edges |
| `paint_black`, `paint_yellow` | paint on boards, flaking (the Minen sign) |
| `wood_h`, `wood_old_h`, `wood_dark_h` | the plank recipe turned a quarter, with no gaps: for boards modelled lying horizontally |
| v3 keys | see "New recipes" above; `sandbag`, `concrete`, `rubber`, `glass`, `rust` and `iron` are replaced in this process by the v3 recipes |
