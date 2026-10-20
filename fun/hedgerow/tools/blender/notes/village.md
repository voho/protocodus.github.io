# Village set (v3) — `assets/models/village.glb`

Built by `tools/blender/build_village.py`, with helpers and the extra
surfaces in `village_parts.py`. Every node is modelled with palette-key
materials and then baked by `bake.bake_model`. After the bake, a node has
one PBR material: base colour, normal, packed metallic-roughness, and an
emissive map when it has lit windows. The textures are WebP inside the GLB.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_village.py [-- [node ...] [flags]]

* **No node names:** build and bake every node, export the GLB, then render
  three 768 px previews per node into `previews/village/`:
  * `<node>.png`, a front 3/4 view;
  * `<node>_back.png`, a back 3/4 view;
  * `<node>_close.png`, an eye-level view from about 2 m.

  It also renders `overview_houses.png` and `overview_street.png`.
* **With node names:** still bake and export the whole GLB, but preview only
  the named nodes.
* **`--dev`:** build only the named nodes and skip the export.
* **`--nobake`:** skip the bakes (palette colours) for fast geometry checks.
  `HEDGEROW_FAST=1` gives tiny bakes instead.
* **`--no-preview`:** skip the renders.
* **Review renders** go to `$TMPDIR`: `--street`, `--detail`, `--colliders`,
  `--normals`.

## Status of this build (v3, village.glb written 2026-10-20 11:15, card alpha fixed 11:29)

| | |
|---|---|
| nodes | 42 (names, origins, colliders and anchors unchanged from v2) |
| triangles | 109 797 |
| file size | 20 460 184 bytes (19.5 MiB; the budget is 26 MB) |
| textures | 133 WebP images, 11.3 MB |

* **Texture sizes per node:**
  * Street houses a, b, c, e, f, g: base colour 2560, normal 1280,
    metallic-roughness 640.
  * house_d, barn, ruin, ruin_b, church, bridge_stone: 2048.
  * shed, fountain, cart: 1024.
  * Props: 256–512.
* **Build time:** 40.6 min to the export (2 439 s) and 54.6 min with all
  previews. The other sets were baking at the same time.
  * The street houses took 125–426 s each to bake at 2560 px.
  * Props take 1–7 s now that small atlases use fewer samples.
* `fix_card_alpha.py` has been run on the GLB. Run it again after every
  build.
* All primitives have POSITION, NORMAL, TEXCOORD_0 and COLOR_0. There are no
  node transforms. `ivy` is the only MASK material.
* `bridge_stone` has its colliders again (10 boxes).
* **Remaining warnings:**
  * The exporter still says "Mesh house_c is not valid", probably from the
    shell-hole booleans. It exports and renders fine.
  * It also prints a harmless "More than one shader node tex image" once
    per node; this comes from the baked material.
* **Previews in `previews/village/` are the baked v3 renders** (768 px:
  front, back, a close-up from 2 m, and the two overviews).

## Conventions (unchanged from v1)

* Blender space, Z up, metres. The front of every node faces -Y (three.js
  +Z). There is one mesh object per node, with no node transform.
* **Origin = the centre of the wall footprint on the ground (z = 0)**, not the
  centre of the bounding box. Parts that stick out (steps, awnings, the
  barn's door leaf, rubble, the café terrace) do not move the origin.
* Exceptions:
  * `bridge_stone`: the origin is the centre of the deck on the deck surface.
    The deck top is at z = 0 and the abutments go down to z = -3.5.
  * `cart` and `bicycle`: the origin is the centre of the bounding box.
  * `wall_lamp`: the origin is the bottom of the wall plate on the wall
    surface (y = 0). The lantern hangs out towards -Y; its centre (anchor
    `light`) is at (0, -0.42, -0.01), and it reaches down to z -0.18.
  * `ivy_patch`: the origin is the bottom centre on the wall plane (y = 0).
    The cards stand out towards -Y by up to 0.18 m.
* Every v1 node name, origin, collider and anchor still works.

New anchors:

| node | anchor | position |
|---|---|---|
| `house_c` | `door_2` | outside its second door |
| `house_b`, `house_e`, `house_g` | `lantern` | the wall lantern's centre |
| `house_g` | `terrace` | the middle of the café terrace |
| `ruin_b` | `smoke` | the smouldering heap inside, (1.5, 0.2, 0.6) |
| `wall_lamp` | `light` | the lantern's centre, (0, -0.42, -0.01) |
| `ruin_b` | `fire` | *none* (there is no `fire` anchor; use `smoke`) |

## Materials and textures

* The bake replaces the palette materials with one material per node. The
  palette keys only steer the procedural surfaces. A few keys that
  `surfaces.py` lacks are registered at runtime from
  `village_parts.EXTRA_SURFACES`:

  | key | use |
  |---|---|
  | `lead` | flashing, ridge rolls, church cames |
  | `curtain` | glowing cloth behind lit windows |
  | `daub` | ochre cob infill |
  | `oak_beam`, `board`, `board_old`, `board_dark` | single boards and beams with grain, no plank gaps |
  | `shutter_*`, `door_*` | painted boards, peeling |
  | `iron_green`, `iron_black` | painted cast iron |
  | `enamel_blue`, `enamel_white`, `enamel_red` | enamel signs, with chips |
  | `poster` | layers of torn bills, no text |
  | `bronze` | the bell, spouts |
  | `water` | fountain, well, trough, butt |
  | `stone_soot`, `plaster_soot` | fire-blackened walls |
  | `straw` | hay |
  | `glass_leaded` | church quarries in lead cames |

* `orient_uvs` runs before the bake:
  * Roof faces get U across the slope and V up it, so tile and slate
    courses run level on every slope. This covers turned and hipped roofs.
  * Board and beam faces get their grain along the longest edge.
* `ivy`: the ivy cards keep their own material. It is a 512 px RGBA atlas
  painted procedurally, alpha-clipped, and exports as `alphaMode: MASK`.
  The game should draw it double-sided. The cards appear on `ivy_patch`,
  the bridge spandrels, house_a's left gable, house_d's right gable and the
  ruin's left wall. Those nodes have two primitives (the baked material plus
  `ivy`).
* After each bake the packed metallic-roughness map is shrunk to a quarter
  of the base size (a half for atlases under 2048 px). It holds smooth data,
  and this saves about 70 % of its bytes. The AO and edge masks are
  discarded.

## Footprints for street layout (front = -Y)

| node | wall rectangle (x, y) | sticks out of the rectangle |
|---|---|---|
| `house_a` | x ±4.2, y ±2.85 | eaves to y ±3.4, steps to y -3.6 |
| `house_b` | x ±2.9, y ±3.8 | shop front, awning frame to y -4.97, eaves to y ±4.3 |
| `house_c` | main x -5.3…2.9, y ±3.1; lean-to x 2.9…5.3, y ±2.3 | eaves to y ±3.8 |
| `house_d` | x ±3.0, y ±2.2 | thatch to y ±2.9, log pile to x -3.8, water butt to y -3.0 |
| `house_e` | x ±4.5, y ±4.0 | hipped eaves 0.45 m all round (x ±5.1, y -4.95…4.57), steps |
| `house_f` | ground x ±3.2, y ±4.0; upper floor jettied to y -4.38 | roof verge to y -4.9 |
| `house_g` | x ±4.0, y ±3.7 | awning and terrace furniture to y -6.75 |
| `barn` | x ±5.7, y ±3.7 | ajar door leaf to y -5.75, eaves |
| `ruin` | x ±4.3, y ±3.3 | rubble to x 5.9, y -4.55 / +4.8 |
| `ruin_b` | x ±4.4, y ±3.5 | rubble out of the front door to y -5.6; gables to z 9.1 |
| `church` | nave x ±4.3, y -6.9…7.8; tower x ±2.3, y -11.4…-6.8; chancel x ±3.0, y 7.8…11.6 | buttresses to x -5.17; south porch to x 7.38 (y -2.5…0.2) |

## Nodes

The table lists the bounding box size (Blender space), the triangle count,
the texture bytes in the GLB, the colliders, and the anchors in Blender
space.

| node | size x × y × z (m) | bounds (Blender) | tris | texture KB | colliders | anchors (Blender x, y, z) |
|---|---|---|---|---|---|---|
| `house_a` | 8.97 × 6.98 × 10.73 | x -4.48…4.49, y -3.62…3.36, z 0.00…10.73 | 12421 | 1068 | 3 boxes | door (0.00, -3.85, 0.00), lamp_1 (-2.60, -1.60, 1.68), lamp_2 (0.00, -1.60, 4.35), lamp_3 (1.60, 1.60, 1.60) |
| `house_b` | 6.84 × 9.33 × 10.57 | x -3.76…3.08, y -4.97…4.36, z 0.00…10.57 | 9121 | 840 | 3 boxes | door (1.56, -4.80, 0.00), lamp_1 (-0.74, -2.30, 1.77), lamp_2 (-1.35, -2.55, 5.03), lantern (-2.65, -4.22, 2.48) |
| `house_c` | 11.15 × 7.41 × 9.78 | x -5.57…5.58, y -3.81…3.61, z 0.00…9.78 | 11440 | 976 | 5 boxes | door (-2.90, -4.10, 0.00), door_2 (0.35, -4.10, 0.00), lamp_1 (-4.30, -1.85, 1.69), lamp_2 (-2.20, -1.85, 4.19), lamp_3 (-3.20, 1.85, 1.64) |
| `house_d` | 7.20 × 5.70 × 7.24 | x -3.86…3.34, y -2.98…2.72, z 0.00…7.24 | 4060 | 555 | 3 boxes + 1 cyl | door (-0.30, -3.20, 0.00), lamp_1 (-1.95, -0.95, 1.38), lamp_2 (-0.80, 0.95, 1.35) |
| `house_e` | 10.61 × 9.52 × 11.80 | x -5.11…5.50, y -4.95…4.57, z 0.00…11.80 | 12515 | 959 | 3 boxes | door (0.00, -5.00, 0.00), lamp_1 (-3.30, -2.75, 1.80), lamp_2 (-1.75, -2.75, 4.85), lamp_3 (-3.25, -2.60, 1.80), lantern (-5.00, -3.85, 2.88) |
| `house_f` | 7.52 × 9.58 × 10.79 | x -3.76…3.76, y -4.92…4.66, z 0.00…10.79 | 9998 | 785 | 4 boxes | door (1.60, -5.00, 0.00), lamp_1 (-1.20, -2.80, 1.65), lamp_2 (0.00, -3.18, 4.62), lamp_3 (2.00, -1.19, 4.60) |
| `house_g` | 9.16 × 11.02 × 10.77 | x -4.94…4.23, y -6.75…4.27, z 0.00…10.77 | 11045 | 859 | 4 boxes + 1 cyl | door (0.00, -4.70, 0.00), lamp_1 (-2.10, -2.20, 1.82), lamp_2 (2.10, -2.20, 1.82), lamp_3 (2.60, -2.45, 4.83), lantern (3.95, -4.15, 3.18), terrace (0.00, -5.60, 0.00) |
| `barn` | 12.13 × 9.83 × 7.89 | x -6.07…6.06, y -5.76…4.07, z 0.00…7.89 | 7598 | 527 | 11 boxes | door (0.00, -4.90, 0.00) |
| `ruin` | 10.34 × 9.45 × 7.00 | x -4.52…5.82, y -4.55…4.90, z 0.00…7.00 | 3238 | 524 | 21 boxes | door (-0.70, -4.30, 0.00) |
| `ruin_b` | 9.11 × 9.34 × 9.09 | x -4.60…4.51, y -5.58…3.75, z 0.00…9.09 | 4171 | 504 | 11 boxes | door (-1.00, -4.50, 0.00), smoke (1.50, 0.20, 0.60) |
| `church` | 12.54 × 24.67 × 24.55 | x -5.17…7.38, y -12.35…12.32, z 0.00…24.55 | 11082 | 784 | 35 boxes | door (0.00, -12.40, 0.00), sniper (0.00, -9.10, 14.00, yaw 0) |
| `shed` | 3.63 × 2.69 × 2.45 | x -1.59…2.04, y -1.35…1.35, z 0.00…2.45 | 699 | 140 | 1 box + 1 cyl | door (-0.05, -2.00, 0.00) |
| `wall_low` | 4.00 × 0.61 × 0.99 | x -2.00…2.00, y -0.29…0.32, z 0.00…0.99 | 340 | 97 | 1 box | — |
| `wall_high` | 4.00 × 0.64 × 2.31 | x -2.00…2.00, y -0.32…0.32, z 0.00…2.31 | 210 | 113 | 1 box | — |
| `wall_broken` | 4.00 × 1.19 × 0.99 | x -2.00…2.00, y -0.43…0.76, z 0.00…0.99 | 281 | 102 | 3 boxes | — |
| `fence` | 3.02 × 0.20 × 1.08 | x -1.51…1.51, y -0.12…0.07, z 0.00…1.08 | 94 | 7 | 1 box | — |
| `gate` | 3.01 × 0.41 × 1.40 | x -1.51…1.51, y -0.21…0.21, z 0.00…1.40 | 180 | 78 | 1 box | — |
| `fountain` | 3.44 × 3.44 × 2.43 | x -1.72…1.72, y -1.72…1.72, z 0.00…2.43 | 838 | 196 | 0 boxes + 2 cyl | — |
| `bridge_stone` | 6.76 × 22.00 × 4.61 | x -3.38…3.38, y -11.00…11.00, z -3.50…1.11 | 1968 | 668 | 10 boxes | — |
| `lamp_post` | 0.40 × 0.87 × 3.40 | x -0.20…0.20, y -0.43…0.43, z 0.00…3.40 | 336 | 16 | 0 boxes + 1 cyl | light (0.00, 0.00, 3.06) |
| `pole` | 1.40 × 0.48 × 7.05 | x -0.70…0.70, y -0.35…0.13, z 0.00…7.05 | 256 | 11 | 0 boxes + 1 cyl | — |
| `signpost` | 1.33 × 0.16 × 2.42 | x -0.65…0.68, y -0.09…0.07, z 0.00…2.42 | 80 | 11 | 0 boxes + 1 cyl | — |
| `cross` | 1.50 × 1.50 × 3.60 | x -0.75…0.75, y -0.75…0.75, z 0.00…3.60 | 158 | 107 | 4 boxes | — |
| `cart` | 2.00 × 3.84 × 1.59 | x -1.00…1.00, y -1.92…1.92, z 0.00…1.59 | 1160 | 172 | 1 box | — |
| `haystack` | 3.23 × 3.22 × 3.30 | x -1.61…1.62, y -1.64…1.58, z 0.00…3.30 | 344 | 82 | 0 boxes + 1 cyl | — |
| `grave_a` | 0.88 × 1.81 × 1.13 | x -0.44…0.44, y -0.86…0.95, z 0.00…1.13 | 110 | 96 | 2 boxes | — |
| `grave_b` | 1.12 × 2.00 × 1.72 | x -0.56…0.56, y -1.00…1.00, z 0.00…1.72 | 182 | 88 | 2 boxes | — |
| `churchyard_wall` | 4.00 × 0.57 × 1.21 | x -2.00…2.00, y -0.29…0.29, z 0.00…1.21 | 200 | 90 | 1 box | — |
| `rubble_pile` | 3.03 × 2.90 × 1.25 | x -1.37…1.65, y -1.42…1.48, z 0.00…1.25 | 714 | 112 | 3 boxes | — |
| `rubble_small` | 1.58 × 1.35 × 0.51 | x -0.79…0.79, y -0.63…0.72, z 0.00…0.51 | 264 | 29 | 1 box | — |
| `beam_charred` | 0.47 × 4.44 × 0.38 | x -0.19…0.28, y -2.01…2.44, z 0.00…0.38 | 80 | 5 | 1 box | — |
| `furniture_broken` | 1.73 × 2.26 × 0.80 | x -0.70…1.03, y -1.09…1.16, z 0.00…0.80 | 212 | 15 | 2 boxes | — |
| `bench` | 1.80 × 0.51 × 0.85 | x -0.90…0.90, y -0.24…0.27, z 0.00…0.85 | 232 | 20 | 1 box | — |
| `well` | 2.30 × 1.69 × 3.66 | x -1.15…1.15, y -0.85…0.85, z 0.00…3.66 | 672 | 94 | 2 boxes + 1 cyl | — |
| `water_trough` | 2.25 × 0.95 × 1.20 | x -1.15…1.10, y -0.36…0.59, z 0.00…1.20 | 92 | 70 | 1 box | — |
| `barrel_wood` | 0.69 × 0.69 × 0.88 | x -0.34…0.34, y -0.35…0.34, z 0.00…0.88 | 610 | 16 | 0 boxes + 1 cyl | — |
| `bicycle` | 0.63 × 1.83 × 1.06 | x -0.31…0.31, y -0.91…0.91, z 0.00…1.06 | 1438 | 35 | 1 box | — |
| `wall_lamp` | 0.21 × 0.53 × 0.44 | x -0.11…0.11, y -0.53…0.00, z -0.18…0.26 | 176 | 22 | 0 boxes | light (0.00, -0.42, -0.01) |
| `ivy_patch` | 2.42 × 0.21 × 3.31 | x -1.19…1.23, y -0.23…-0.02, z -0.10…3.21 | 140 | 17 | 0 boxes | — |
| `steps_stone` | 2.20 × 1.61 × 1.01 | x -1.10…1.10, y -0.80…0.80, z 0.00…1.01 | 90 | 93 | 7 boxes | — |
| `fence_picket` | 3.03 × 0.13 × 1.24 | x -1.52…1.52, y -0.04…0.08, z 0.00…1.24 | 408 | 73 | 1 box | — |
| `poster_board` | 1.44 × 1.44 × 3.65 | x -0.72…0.72, y -0.72…0.72, z 0.00…3.65 | 544 | 31 | 0 boxes + 1 cyl | — |

## What changed in v3 (realism pass)

### Surfaces

These are registered at runtime in `village_parts.register_v3()` and affect
only this build's process.

* **Masonry.** The wall keys `stone` and `stone_dark` now bake as Norman
  rubble walling:
  * rough courses of irregular, rounded stones in five tones (cream
    limestone, blue-grey, ochre, flint-grey, rust);
  * each stone domed and set proud or sunk;
  * dirty lime mortar, washed out in patches into dark joints;
  * lichen spots, green algae and splash at the foot.
* **New dressing keys:**
  * `ashlar`: Caen-stone quoins, jambs, lintels, sills, string courses,
    voussoirs and coping, with tooling, pits and chipped arrises.
  * `ashlar_step`: worn treads, no moss.
  * `fieldstone`: single proud or loose stones.
  * `stone_rubble`, `fieldstone_fresh`: rubble heaps that stay moss-free.
* **Render.** `plaster` and `plaster_dirty` now bake as lime render:
  * blotches and trowel texture;
  * a few long cracks (see below);
  * blown patches with a broken rim showing the rubble;
  * broad vertical run-off stains;
  * algae and splash at the foot.
* **Render cracks (reworked).** The first v3 cracks were Voronoi cell edges
  about 8 mm wide in near-black, baked at one sample per texel (~1 cm):
  they came out as dashed black lines in a polygon net, as if drawn on.
  Now (`_crack_dist`, `_crack_mask` in `village_parts.py`):
  * a domain-warped 2D Voronoi net in (x + y, z), so cracks meander, run
    on round the corners and cost a third of a 3D net;
  * kept on about a quarter of each wall and broken now and then into long
    open runs, so no closed cells show;
  * 1.6-2.6 cm across with soft edges (never under a texel), fading out at
    their ends, dark grey-brown; a faint dirt halo, grime washed down below
    (the crack field sampled 8 and 24 cm higher) and chips of render lost
    along the edges; a shallow groove in the normal map;
  * render has its own weathering profile (`render`): the shared fine rain
    streaks made regular vertical stripes on a smooth wall, so only a trace
    of them is left;
  * the village bakes its colour/roughness/metal channels at 2 samples per
    texel (`bake_model(..., samples_channels=2)`).
  * Review shots: `--detail` renders house_b's cracked side wall and house_e
    (`det_house_b_*.png`, `det_house_e_*.png` in `$TMPDIR`).
  * Known: house_e's right wall shows a faint dotted rectangle near the
    shell hole that does not come from the recipe (a seam from the breach
    cut, by its shape); not chased.
* **Glass.** `glass_dirty` is the default for every window: dust film, rain
  streaks and grime caked in the corners.
* **Paint.** Shutters (`shutter_*`) and doors (`door_*`) flake at the edges
  down to grey wood. Doors are also worn at handle height and rotting at
  the bottom.
* **North slopes.** Gable roofs give their back slope (+Y) the mossy
  variant: `roof_tile_n`, `roof_slate_n` or `thatch_n`, with heavy moss and
  lichen.
* **Weathering decals.** These are thin quads 4 mm proud of the wall. They
  carry the wall's own recipe plus an effect driven by a `stainuv` layer,
  and are clipped so they never cover an opening:
  * run-off stains under every sill;
  * gutter overflow streaks under the eaves;
  * soot tongues above the burnt openings of ruin_b.
* **Moss.** New weathering profiles keep moss off steps, the bridge deck and
  fresh rubble. It now appears only on old masonry tops and north roofs.
* **Chimneys.** The top 0.55 m of every stack and its cap are soot-black.

### Geometry

* **Proud stones** (1.5–4.5 cm) stand out on the rubble walls (house_a,
  house_d, barn), crowded at the corners and the foot.
* **Shutters sag** a few degrees on their hinges.
* **Tile roofs:**
  * The camera-facing (front) slope shows two more geometric tile courses
    above the eave course.
  * There are more missing and slipped tiles near the front eaves.
  * The gutters sag between their brackets and fall towards the downpipe.
* **Shell holes in walls**, each with a ragged breach through the masonry, a
  charred room behind, broken joists and boards, rubble inside and at the
  foot, blown render around and bullet pocks:
  * house_b: the left party wall, upper floor;
  * house_e: the right wall, ground floor;
  * house_g: the left wall, upper floor.
* **Texel density:**
  * The street houses are baked at 2560 px.
  * The hidden tops of the solid house blocks are deleted before the bake,
    and so are faces lying face-down on the ground.
  * Street-facing (-Y) islands get about 30 % more texels; roofs and
    undersides get fewer.

### Per node

| node | changes |
|---|---|
| house_a | rubble walls, ashlar dressings, proud stones, sill and eave stains, sagging shutters, two extra tile courses on the front slope, more missing and slipped tiles, mossy north slope, sooty stacks, 2560 px |
| house_b | render, shell hole in the left wall, sill and eave stains, mossy north slate, dirty glass, 2560 px |
| house_c | render, stains, more slipped tiles at the front eave, mossy north slope, 2560 px (the roof shell hole is unchanged) |
| house_d | rubble walls, proud stones, mossy north thatch, worn steps, 140 tpm |
| house_e | render, shell hole in the right wall (ground floor), stains on all four walls, 2560 px |
| house_f | worn steps, mossy north slope, an extra missing tile, 2560 px |
| house_g | render, shell hole in the left wall (upper floor), stains, mossy north slate, 2560 px |
| barn | rubble walls, ashlar jambs and quoins, proud stones, front tile courses |
| ruin, ruin_b | rubble, moss-free rubble heaps, ashlar surrounds; ruin_b has soot decals instead of painted plumes |
| church | rubble walls, ashlar dressings, portal, buttress caps, worn steps; the door is painted red |
| bridge_stone | rubble body, ashlar voussoirs and coping, moss off the deck |
| the props | rubble, ashlar and glass surfaces through the shared keys |

**Footprints:** unchanged, except that breach debris now lies outside three
walls: house_b to x -3.76, house_e to x 5.50, house_g to x -4.94.

## What is new in the geometry (v2)

* **Houses (a–g):**
  * Irregular quoins, some with chipped arrises.
  * Window reveals cut 0.2–0.3 m deep; stone sills with weathering and a
    drip groove.
  * Surrounds: long-and-short dressed jambs with a lintel (house_a), stucco
    rings with keystones, or brick segmental heads.
  * French casements: two leaves with glazing bars, the glass set back.
  * Lit windows: curtains in front of the glowing room. These are 2–4 per
    house, each with a `lamp_N` anchor about 1 m inside.
  * Plank shutters with ledges, a Z brace, strap hinges and shutter dogs;
    louvred shutters on the town houses. Some are open, ajar or closed; one
    is missing a leaf and one hangs from its lower hinge (house_a).
  * Studded plank doors with strap hinges, ring handles and escutcheons, on
    chamfered stone steps.
  * Tile roofs:
    * individual ridge tiles on a mortar bed;
    * the round tile ends along the eaves;
    * mortared verges;
    * missing tiles showing the battens, and slipped tiles.
  * Slate roofs have lead rolls.
  * A sagging ridge and a bell-cast kick at the eaves.
  * Gutters on brackets; downpipes with hoppers, clips and shoes.
  * Chimneys with oversailing caps, flaunching, lead flashing, pots and a
    cowl.
  * Iron tie plates, enamel signs, flower boxes, wall lanterns.
  * Bullet pocks, cut through the render to the stone, and chipped corners.
  * **The shell hole is in house_c's front slope.** It has splintered
    battens and rafters and a charred cavity into the house.
* **house_e:** the corner house. A hipped slate roof with lead hip rolls,
  two dormers on the front slope and two tall chimneys; dressed quoins, a plinth, string
  courses and a cornice; a door on three steps; a street plate on the
  corner; a lantern.
* **house_f:** colombage.
  * A stone plinth and brick nogging on the ground floor.
  * The upper floor is jettied 0.38 m, carried on joist ends and a
    bressummer.
  * Close studs with St Andrew's crosses and ochre daub; a timbered gable to
    the street.
  * A steep tile roof with bargeboards.
* **house_g:** the café.
  * A painted shop front with two deep, lit windows and café tables inside.
  * An extended canvas awning with a scalloped valance on iron arms.
  * On the terrace, two bistro tables and four chairs; one table and two
    chairs are knocked over, and a broken bottle lies there.
  * An enamel sign and a lantern.
* **ruin_b:** the burnt-out house.
  * The walls stand to the gables, blackened inside and out, with soot
    plumes over the openings and charred frames.
  * A broken, fallen ridge beam; a few rafters and battens with tiles left.
  * Burnt joists with a hole through the upper floor.
  * Rubble spilling out of the front door.
  * Walk-through: front door (x -1.0) to back door (x 1.5).
* **church:**
  * Y-tracery and an oculus in the nave lancets; leaded glass.
  * Lead ridges.
  * A gabled south porch with stone benches.
  * A clock face with marks and hands, no numerals.
  * A bronze bell on a yoke.
* **bridge_stone:**
  * Individual coping stones on the parapets.
  * **The +X parapet is broken open between y 6.8 and 8.9.** Its collider
    has the same gap. Fallen coping stones lie on the deck.
  * Cutwaters at the feet of the arch.
  * Ivy on the spandrels.

## Colliders (new and changed)

* **house_e:** the footprint box (to the eaves) and the step boxes.
* **house_f:** the ground-storey box, plus the jettied upper box (y -4.38…4.0,
  z 3–5.6). The steps are separate.
* **house_g:**
  * The house box and the shop-door step.
  * On the terrace, a cylinder for the standing table and a box for the
    knocked-over table. The fallen chairs have none.
* **ruin_b:** walls only.
  * The front and back walls are split around the doorways, with lintel
    boxes over them. The front doorway is x -1.575…-0.425; the back doorway
    is x 1.0…2.0.
  * The gable walls run full height.
  * Three rubble boxes at 0.34–0.4 m (steppable): inside, outside the front
    door, and in the back-left corner.
* **church:** as in v1, plus the porch side walls and the arch piers. The
  benches inside the porch have no collider. The belfry is unchanged: the
  floor top is at z = 14.0, parapets to 14.95.
* **barn, ruin, houses a–d:** as in v1.
* **New props:**
  * `rubble_pile`: stepped terraces with tops at 0.4, 0.8 and 1.1 m.
  * `rubble_small`: one 0.4 m box.
  * `steps_stone`: one box per step, 0.15 m apart, and the cheek walls.
  * `grave_a`, `grave_b`: a stone box plus a low kerb or slab.
  * `churchyard_wall`: 1.2 m.
  * `well`: a curb cylinder (0.92 m) and two posts.
  * `water_trough`: 0.6 m.
  * `bench`: 0.45 m (steppable).
  * `barrel_wood`, `poster_board`: one cylinder each.
  * `bicycle`, `beam_charred`, `fence_picket`: thin boxes.
  * `furniture_broken`: two boxes.
  * `wall_lamp` and `ivy_patch`: none.

## Notes on the shared tools

* **Runtime overrides.** `village_parts.register_v3()` replaces the recipes
  of `stone`, `stone_dark`, `plaster` and `plaster_dirty`, and the
  weathering profiles of a few keys, **inside the village build process
  only**. `surfaces.py` itself is unchanged; the other sets are not
  affected.
* **Fixed in the shared scripts since v2:**
  * `bake_model` now detects glow from any recipe, so the `curtain` key
    glows on its own.
  * Small atlases now use fewer samples.
* **New warning:** the glTF exporter prints "More than one shader node tex
  image used for a texture" once per baked material. It is harmless.
* **`kit.finalize` still writes the *active* UV layer.**
  * The village's ivy cards (`ivyuv`) and decals (`stainuv`) keep their UVs
    in extra layers.
  * `Model.build` makes sure `UVMap` is active before `finalize`, then
    copies the ivy UVs back.
  * `bake.finish_uvs` drops the extra layers after the bake.
* `kit.py`, `bake.py` and `surfaces.py` are not edited.
