# Hedgerow models

Every GLB here is built by the committed Blender scripts in
`fun/hedgerow/tools/blender/`. Do not edit the GLBs by hand: change the
scripts and rebuild. The builds are deterministic (fixed seeds) and run in
headless Blender 5.3 on the CPU (Cycles bakes, no GPU needed).

| file | built by | contents | size |
|---|---|---|---|
| `village.glb` | `build_village.py` | 42 nodes: 7 houses (three with shell holes through a wall), barn, two ruins, church, walls, fences, bridge, street furniture, rubble, graves, ivy | 20.3 MB |
| `military.glb` | `build_military.py` | 42 nodes: sandbags (some split and spilling sand), MG nest, bunker, trench pieces, wire, vehicles and wrecks (dented, mud-caked, rust-streaked), Flak 38, PaK 40, stencilled crates, signs, camouflage net | 17.3 MB |
| `nature.glb` | `build_nature.py` | 48 nodes: spruce, fir, Scots pine, oak, beech, birch, mature 21–28 m spruce, fir, oak and beech (+ far LODs), two horizon treelines and a hill copse, hedgerows, bushes, ground cover, rocks, logs | 13.4 MB |
| `soldier.glb` | `build_soldier.py` | the rig (20 bones), US and German outfits with three face morph targets (`face_broad`, `face_gaunt`, `face_older`), 17 animation clips (rifle and SMG reloads with their event frames) | 6.3 MB |
| `weapons.glb` | `build_soldier.py` | M1 Garand, Thompson, Kar98k, MP 40, MG 42, two grenades, the clips and magazines used in reloads | 2.1 MB |

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_<set>.py [-- node ... | flags]
    python3 -I fun/hedgerow/tools/fix_card_alpha.py fun/hedgerow/assets/models/{village,military,nature}.glb

Run `fix_card_alpha.py` after building any set with alpha cards (nature,
military, village; the nature build now runs it itself): it fills the colour under the transparent texels and the
pale anti-aliased fringe of the foliage atlases from the opaque leaves, so the
mipmaps do not wash grass and leaves out at a distance. It is idempotent.

Each set's notes (`tools/blender/notes/<set>.md`, written by the builds) list
every node with its size, triangles, texture sizes, colliders and anchors.
`docs/models-brief.md` is the contract with the game (names, origins, front
= -Y in Blender = +Z in three.js, colliders and anchors in the node extras),
`docs/models-brief-v2.md` the realism pass.

## How a model is made

1. Geometry from bmesh primitives and lofts in the build script, each part
   given a **palette key** material (`kit.PALETTE`).
2. `bake.bake_model()` unwraps an atlas, bakes ambient occlusion (with a
   ground plane) and an edge mask, swaps every palette key for its
   procedural surface from `surfaces.py` (coursed rubble with washed-out
   lime mortar, Caen-stone dressings, plaster with cracks, run-off and
   blown patches, dirty glass, barrel tiles with lichen, slate,
   planks, peeling paint, chipped and rusted paint on steel, blued steel,
   board-formed concrete, hessian, wool, leather, skin, bark, granite...)
   plus shared weathering (occlusion, cavity dirt, splash at the base, rain
   streaks, moss, worn edges), then bakes base colour, roughness, metallic,
   emission and a tangent-space normal (bevelled edges + bump).
   The village and military builds register their own recipes over the
   shared ones at run time (masonry, plaster, glass and paint in
   `village_parts.py`; rust and grime drip maps, mud, board-formed concrete,
   hessian and tyre rubber in `military_parts.py`).
3. One material per node; WebP textures inside the GLB
   (`EXT_texture_webp`, which three.js r185's `GLTFLoader` reads).
4. Foliage, ivy and the camouflage net are alpha cards (glTF alphaMode
   MASK) on atlases rendered in Blender from modelled leaves, needles and
   blades; the game draws them double-sided with the alpha test, lit from
   the card normals, swaying in the wind.

The game replaces nothing in a baked material; it only adds the rain
(darker porous surfaces, glossier everything, water film and ripples on
upward faces) in `js/materials.js`.

Review renders go to `tools/blender/previews/<set>/` (hundreds of MB, not
committed).
