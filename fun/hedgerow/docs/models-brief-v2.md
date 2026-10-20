# Hedgerow — models brief v2: realism

The user asked for every model and the level to be **far more realistic and
detailed** ("10x"). v1 (`models-brief.md`) still defines names, origins,
colliders, anchors and the front = -Y convention; this brief adds what
changes. Keep every v1 node name working (the level uses them); add the new
nodes listed per set.

## 1. Textures: every model is baked (bake.py + surfaces.py)

Build the geometry as before with palette-key materials, set colliders and
anchors, `kit.finalize(...)`, then:

    import bake
    r = bake.bake_model(obj, tpm=120)      # texels per metre (see below)
    obj = r['object']                       # same object unless `keep` joined parts
    ...
    kit.export(objs, path, images=True)    # WebP textures inside the GLB

`bake_model` unwraps an atlas, bakes AO (with a ground plane), an edge mask,
then base colour / roughness / metallic / normal (bevelled edges + the
surface bump) / emission from the procedural surface of each palette key
(`surfaces.py`: rubble limestone with mortar, plaster with stains and fallen
patches, barrel tiles with lichen, slate, planks with grain and gaps, peeling
paint, chipped and rusted paint on steel, blued steel, board-formed concrete,
burlap, wool, leather, skin, walnut, bark, granite, ...) with shared
weathering (occlusion, cavity dirt, splash at the base, rain streaks, moss,
worn edges). The model ends with **one material** and one UV map.

* Look at `tools/blender/previews/v2test/house_a.png` for the level of finish
  expected, and keep going past it.
* `tpm`: ~100–120 for buildings and vehicles, 150–220 for small props and
  weapons, 2048 max. Normals are baked at half resolution above 1024.
* Need a look the library lacks (e.g. half-timbering, cast-iron, enamel
  sign, straw)? Write the recipe in your own `<set>_parts.py` and register
  it at runtime before baking:
  `kit.PALETTE['my_key'] = ('#hex', rough, metal)`,
  `surfaces.RECIPES['my_key'] = fn`, `surfaces.PROFILE['my_key'] = 'prop'`.
  **Do not edit kit.py, bake.py or surfaces.py** (shared, concurrent);
  report bugs or wishes in your final message.
* `keep=('leaf_card', ...)` leaves faces with those materials out of the bake
  (alpha-card foliage keeps its own textured material) and joins them back.
* `HEDGEROW_FAST=1` gives tiny, quick bakes for iteration.
* Bakes must not see other models: `bake_model` hides the rest of the scene
  while it bakes. Build/bake each model at the origin as in v1.

## 2. Geometry: real detail

Budgets roughly ×3 (they are ceilings, not targets): what matters is that
the things that make a place real exist as geometry and read at 2–10 m in
the rain at dusk. Bevel edges (the bake rounds them further), break straight
lines, add sag, damage and use. Concrete lists are per set below.

## 3. Alpha cards (nature, ivy, camouflage nets, barbed wire barbs if wanted)

Foliage, grass, ferns, ivy, nets: textured cards with alpha. Make the
atlases in Blender (render modelled leaves/needles/blades orthographically
with a transparent film into an RGBA image, or paint them procedurally),
material = base colour (+ alpha) → Principled Alpha through a Math
`GREATER_THAN 0.5` (or `ROUND`) node so the glTF exporter writes
**alphaMode MASK** — verify in the GLB JSON. Cards are drawn double-sided by
the game; give them sensible normals (pointing up/out, not along the card)
so they light like foliage.

## 4. Deliverables

As v1: the build script(s), the GLB(s), previews (768², and look at them:
front, back, a close-up at 2 m), notes updated. GLB size budgets:
village ≤ 22 MB, military ≤ 16 MB, nature ≤ 12 MB, soldier + weapons ≤ 12 MB.
Whole-set build including bakes ≤ ~20 min. Deterministic.

---

## Village v2 (`village.glb`)

Upgrade every v1 node and add new ones.

* **Houses**: irregular quoins; window reveals with stone lintels, sills
  with drips; wooden frames with mullions and glazing bars (glass set back);
  shutters as plank geometry with ledges, hinges and catches (some open at
  angles, one hanging off a hinge); plank doors with studs, iron furniture,
  stone steps; ridge tiles and verge as geometry, a sagging ridge, a few
  missing or slipped tiles; gutters with brackets, downpipes with shoes;
  chimney pots, flashing; iron tie plates, lamp brackets, an enamel-sign
  board (no text), flower boxes; damage: bullet pocks, chipped corners, one
  shell hole through a roof with splintered battens. Lit windows show a
  curtain behind the glass (`window_lit` gives the warm glow).
* **New houses**: `house_e` (corner house, hipped slate roof, 2 storeys +
  attic), `house_f` (Norman half-timbered colombage with brick/cob infill,
  jettied upper floor), `house_g` (café/shop: big windows, a canvas awning,
  a terrace with two tables and chairs knocked over), `ruin_b` (burnt-out
  house: blackened walls, charred roof timbers partly fallen in, a hole in
  the upper floor, rubble spilling into the street; walk-through like
  `ruin`).
* **Church**: lancet windows with stone tracery and dark leaded glass,
  buttresses with offsets, a porch, a bell in the belfry, a clock face
  (marks, no numerals), slate with lead ridges, weathered stone.
  New: `grave_a`, `grave_b` (headstones / cross), `churchyard_wall` (4 m,
  1.2 m, with coping).
* **Bridge**: voussoirs, cutwaters, coping stones on the parapets, moss and
  ivy, a broken parapet section near one end.
* **New props**: `rubble_pile` (stone, tiles, beams, ~3×3×1.2, steppable
  collider boxes), `rubble_small`, `beam_charred`, `furniture_broken`
  (an overturned table and chair), `bench`, `well` (stone well with a
  roof and winch), `water_trough`, `barrel_wood` (cask), `bicycle`
  (1940s French bicycle leaning), `wall_lamp` (wall lantern; anchor
  `light`), `ivy_patch` (wall ivy, alpha cards, 2×3 m, faces -Y),
  `steps_stone`, `fence_picket`, `poster_board` (an advertising column
  — a Morris column with paper layers, no readable text).

## Military v2 (`military.glb`)

* Upgrade all v1 nodes: sandbags with ties and slump; MG nest with ammo
  boxes, spent cases, a spare barrel case; bunker with board-marked
  concrete, chipped embrasure with a steel plate, camouflage paint blotches,
  rebar showing where a shell hit, steps down to the door, a lamp inside;
  barbed wire with real barbs; hedgehog with rivets and plates; crates with
  rope handles, stencil blocks (no text), lids nailed; barrels with rolling
  hoops and dents; Flak 38 with sights, seats, magazines, the cruciform
  base and jacks; trucks with chassis, leaf springs, tyres with tread,
  headlights, bumpers, the cab interior hinted, tilt with folds and ropes;
  jeep wreck with bent panels and a broken windscreen frame.
* **New**: `kubelwagen`, `motorcycle_sidecar` (BMW R75), `pak40`
  (anti-tank gun, trail legs open), `halftrack_wreck` (Sd.Kfz. 251,
  burnt; anchor `fire`), `ammo_stack` (boxes stacked, ~1.2 m),
  `jerrycan_stack`, `drum_stack`, `stretcher`, `dropped_helmet_de`,
  `dropped_helmet_us`, `cable_reel`, `field_telephone`, `camo_net`
  (alpha-card net over 4 poles, ~5×4×2.2), `dugout_entrance`
  (log-revetted entrance into a slope with steps, faces -Y),
  `mg42_tripod` (Lafette 34), `sandbags_ruined` (collapsed bag wall),
  `sign_minen` (wooden warning sign with a painted skull shape, no text).

## Nature v2 (`nature.glb`)

Trees, bushes, hedges and ground cover rebuilt with **alpha cards**:

* `pine_a/b/c` (Norway spruce, a spruce-fir, a Scots pine), `oak_a/b`
  (oak, beech), `birch_a` (new), `tree_dead`: real trunks with root flare
  and bark detail, branch geometry to the cards, needle sprays / leaf
  clusters as cards from atlases you render; full + `_lod` (cards only,
  far cheaper). Budget: full ≤ 6000 tris, lod ≤ 600.
* `hedge`, `hedge_low`: bocage — dense leaf cards over woody stems and a
  bank of earth at the foot (tile every 4 m as v1).
* `bush_a/b`, new `bramble`, `nettles`, `fern` (fronds), `grass_tuft`,
  new `grass_tall`, `weeds` (dock, thistle), `reeds`, new `ivy_ground`,
  new `leaf_litter` (flat card patch 2×2 m, for the forest floor),
  new `branches` (fallen twigs pile), new `mushrooms` (tiny cluster).
  Ground cover is instanced by the thousand: ≤ 150 tris each.
* Rocks: `boulder_a/b/c`, `outcrop`, `rocks_small` — sculpted-looking
  detail (displaced high-res surface baked down to a low mesh is ideal),
  moss and lichen from the bake.
* `log`, `log_bridge`, `stump`: bark, broken/cut ends with rings, moss.

## Soldier v2 (`soldier.glb`, `weapons.glb`)

* Bodies ~15–20k tris per outfit: anatomy and proportions of real young
  men; uniforms with geometry folds at the elbows, knees, waist and
  shoulders, collars, cuffs, pocket flaps with buttons, belts with buckles,
  pouches with snaps, canteen in its cover, bayonet, entrenching tool,
  gas-mask canister with ribs, bread bag, leggings with laces (US) and
  hobnailed jackboots (DE); helmets with liners and chinstraps (the US one
  with a net); faces with eye sockets and eyes, brows, nose, lips, ears,
  stubble from the bake; hands with fingers closing on the grip and the
  handguard in the aim poses.
* Bake each outfit with `bake_model` in the rest pose before skinning (or
  with the armature at rest), one material per outfit. Keep the bone names,
  socket and action names of v1; improve the animation weight and polish
  where it shows (aim steadiness, run, deaths ending naturally on uneven
  ground).
* Weapons 3–6k tris each, baked: blued steel worn at edges, walnut with
  oil finish, slings with buckles; the Garand's en-bloc clip visible.
