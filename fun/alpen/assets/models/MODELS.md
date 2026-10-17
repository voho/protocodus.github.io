# Alpen imported model sources

## nature/alpine-boulders.glb, alpine-crags.glb — the rocks (built in Blender)

Not downloaded: `tools/blender/rocks.py` builds both, from the repository
root (about eight minutes on the CPU, most of it the bake; no GPU needed):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/rocks.py -- --out fun/alpen/assets/models/nature

(`--preview DIR` renders each rock on the snow; `--only boulders|crags`
builds one file; `--atlas 1024 --samples 8` is a quick draft.) They replace
the Poly Haven photoscans that stood here (rock_07, rock_09, rock_face_01,
mountainside, boulder_01 and the rock_moss_set_02 granites), one of which
was a half-shell and two of which were open faces drawn double-sided.

Each rock is a signed distance field in the game's space, written the way
the stone was made (`tools/blender/fieldkit.py` holds the method): a body
cut by its joint planes, its edges rounded by as much weathering as its
rock allows, chipped where its edges stick out, bent a few centimetres over
a metre. Granite is a jointed block with its corners weathered back and one
or two young, crisp-edged faces (one has a frost crack); slate is a book of
plates on edge, every face across the cleavage a staircase of plates; the
"iron" boulder is a schist slab split along its foliation. The crags are the
same rocks at the scale of a cliff — an envelope under a broken skyline,
divided into blocks by bedding and two sets of cross-joints, each block set
back and turned by its own amount, which leaves the ledges the snow holds and
the clefts between them; a face of bedded gneiss, a jointed buttress, a
granite tor. The field is meshed with surface nets on a narrow band (1.4 cm
for a boulder, 6 cm for a crag), pulled onto the true surface, kept as the
full-detail surface for the bake, and copied through Blender's voxel remesh
and quadric decimation into the closed, low surface the game draws.

The texture is baked in Cycles (CPU) from the full-detail surface onto the
low one, as an emission pass carrying the albedo with the occlusion
multiplied in, the way a photoscan's diffuse carries its own: granite's grain
over the structure of `textures/rock/rock-granite.jpg`, slate and schist from
`rock-slate.jpg` and `rock-granite.jpg` projected along their own cleavage,
the faces' weathering, iron staining, the black drip lines down steep faces,
pale crustose lichen mosaics, black crusts and map lichen (Rhizocarpon) on
the faces that see the sky — none on a fresh scar or on the foot the snow
lies against — and the soil at the foot. One 2048² WebP atlas per file, the
buried foot (and a crag's back) given a fraction of the texels.

| file | nodes (pool order) | tris | in game as |
|---|---|---|---|
| `alpine-boulders.glb` | `boulder_slate`, `boulder_iron`, `boulder_granite_a`, `_b`, `_c` | 2450 each | verge hazard boulders and erratics (`rockPools`) |
| `alpine-crags.glb` | `crag_face`, `crag_buttress`, `crag_block` | 4880–4900 each | flank crags (`cragPools`), looking down +z |

Every node stands on y = 0, centred, with no transform, and is built to the
height over half-width its pool's collider assumes — `SCAN_ASPECT` [0.90,
0.45, 0.70, 1.34, 1.20] and `CRAG_ASPECT` [1.44, 2.06, 1.10] in `props.js`;
each node's extras carry its `rock`, `aspect` and `sink` (the crags also
`faces: "+z"`). Each file is fed to its pools by
`js/importedModels.js#upgradeTexturedSet`, which normalises every node to
its grown stand-in's height and swaps it into the live pool;
`props.js#photoMat` adds the up-facing snow dusting.

## nature/alpine-deadwood.glb — stump, logs and branches (built in Blender)

Written by `tools/blender/deadwood.py` (the same kit, a couple of minutes):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/deadwood.py -- --out fun/alpen/assets/models/nature

It replaces the Poly Haven tree_stump_01, dead_tree_trunk, dead_tree_trunk_02
and dry_branches_medium_01 scans. A Norway spruce's forest floor in winter:

- `stump` — a sawn stump: the cut stepped at the faller's notch with the torn
  hinge standing between the two levels, the face greyed and checked
  radially, bark plates loose and gone in places, six buttress roots diving
  under the snow (about twice as wide as it is tall; the game fits it to 0.4 m
  and puts it in the last shrub slot). About 1750 tris.
- `log_fallen` — a snapped spruce top, 3.03 m along x: bark in plates, gone
  in strips along the grain, whorls of branch stubs, its top torn into a
  tongue and splinters, its butt an old ragged break. About 2430 tris.
- `log_windthrow` — an old windthrow, 4.05 m: the root flare with its torn
  root stubs, one limb standing, most of its bark gone to silver-grey wood
  checked along the grain, a long snap at the top. About 2420 tris.
- `branch_a`, `branch_b`, `branch_c` — crooked spruce branches with their
  twigs snapped short and forking, lying along z, 0.8–1.3 m, swept tubes
  with their own UVs. 380–720 tris.

Logs and stump are distance fields like the rocks (bark plates, checks,
splintered and sawn ends, stubs and roots welded on); their baked texture
maps `textures/tree/tree-bark.jpg` round the trunk (its seam blended on the
underside), grains the bare wood with `textures/huts/alpine-wood-planks.jpg`
laid along the trunk (its plank gaps read as checks), and adds end-grain
rings, rot, the grey leafy lichen of dead spruce, wolf lichen and moss. One
2048² WebP atlas. The trunks lie along +x at the sizes in `props.js`'s
`DEADWOOD` table (its capsule follows that axis) and keep their own metres;
the logs are solid and low enough to jump (a capsule of three circles), the
branches have no collision and no shadow. One `upgradeTexturedSet` call
feeds all six pools, each wearing its own snow amount over the one texture.

## Sapling impostor atlas (built in Blender)

`assets/textures/tree/sapling-impostors.webp` (1024 × 2048, RGBA) is
rendered by `tools/blender/saplings.py` from young trees modelled with the
forest's own kit (`trees.py`'s `Tree`, its sprig cards cut from
`alpine-sprigs.webp`, its occlusion bake and impostor material), from the
repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/saplings.py -- --out fun/alpen/assets

It renders with Cycles on the CPU, so it builds without a GPU, and prints
the `SAPLINGS` table for `js/props.js` (each sapling's frame `R`, `H` and
its three UV rectangles), which has to be pasted over the old one after a
rebuild. It replaced a render of Poly Haven's fir and pine sapling scans.

Six young trees of the forest's four species, grown as young trees rather
than small old ones — crowns to the ground with the lowest branches lying
on the snow, broad for their height, sprigs drawn at about life size — each
with a young tree's history (`Youth`: its light side, uneven years, the
odd broken branch, a stem swept at the foot by snow creep): a Norway spruce
(2.4 m), a silver fir in the stand's shade (1.8 m, level two-ranked
plates), a spruce the deer have browsed into a bushy three-leader (1.3 m) —
the three the placement puts in shelter — and a Swiss stone pine (2.1 m), a
three-stemmed treeline stone pine (1.3 m) and a bare European larch
(2.7 m) for the exposed ground.

Each is photographed from three bearings 60° apart, orthographic across
the card `saplingCardGeometry` stands there, framed from the snow line to
its top and to its crown's widest reach, as albedo — the sprig atlas's
colour times the baked crown occlusion — keyed like the forest's cards,
packed one sapling per 341 px row and colour-dilated into the gutter;
WebP at quality 90 with alpha. Frost twins of the sprigs give the snow
load. In game each view is a 3 × 3 card at the bearing it was drawn from:
24 triangles per young tree, each kind with its own sway height.

## nature/alpine-trees.glb — the Alpine forest (built in Blender)

Not downloaded: `tools/blender/trees.py` builds it, together with the
atlas its cards point into (`textures/tree/alpine-sprigs.webp`), from the
repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/trees.py -- --out fun/alpen/assets

(The sprigs are rendered with EEVEE, so this needs a GPU — it will not run
inside a sandbox that hides Metal.)

Four species, as they grow above 1500 m: **Norway spruce** (*Picea abies*,
the narrow subalpine spire with hanging curtains of shoots), **silver fir**
(*Abies alba*, level tiers of flat sprays; an old one flattens into a
stork's nest), **Swiss stone pine** (*Pinus cembra*, a dense rounded column
of upturned five-needle brushes, often with two or three leaders, one
wind-flagged), and **European larch** (*Larix decidua*, bare in winter).
Two trees per slot of `props.js`'s `SPECIES` table — 24, one per forest
pool (node `tree_<name>` for the first dozen pools, `tree_<name>_2` for the
second; `extras.height`, `extras.species`) — which the pools scale to their
grown heights and stretch a little across, so the same tree met twice is
two shapes.

No two of them grew alike. Each carries a growth history (`Growth` in
`trees.py`): the side its light came from (the crown is longer and fuller
there), good and bad years up the stem (whorls unevenly spaced, the crown
bulging and waisting), branches lost — more on the shaded side and low
down — and a lower crown that has died back to bare grey branches; a stem
swept at its foot by snow creep, with a gentle wobble above. Tops vary too:
a leader, a dead spike above the living crown, a forked second leader, or a
new top turned up out of a side branch where the old one broke.

`tools/blender/sprigs.py` models each species' foliage needle by needle —
spiralled spruce shoots, two-ranked fir sprays, pine fascicles of five,
larch twigs with their spur stubs and cones — adds a snow mantle (flattened
metaballs) for the evergreens and hoar frost for the larch, and photographs
them straight down onto black: two sprigs per species in the top half of
the atlas, their snow twins half an atlas below, and three bark strips
(spruce/fir from the old bough atlas, stone pine and larch from the two bark
photographs) left of u = 0.116, where `spruceMat` starts keying black.

Each tree is a trunk with buttress roots running on under the snow line,
the lowest branch stubs, and 300–550 cards: boughs drawn as skirts sloping
down off the trunk (split in two on long boughs so the sprig is never
stretched to a frond), curtains facing out of the crown, brush rosettes on
the pines. Occlusion is baked in Blender by casting rays through the
finished tree and exported as the custom attribute `_AO`; `_OWN` is the
`surfaceOwn` contract (needles 1, snow 0, bark 0.35); normals are canopy
normals. `props.js#alpineTreeGeometry` turns a node into pool geometry.
about 600–1000 triangles a tree. If either file fails to load, the card conifers
below take over.

The same script then photographs every finished tree from three bearings
(0°, 60°, 120°) with an orthographic camera into
`textures/tree/alpine-impostors.webp` (4096 × 1024, one 170 px column per
tree, one row per bearing), and writes the frame each was drawn in to its
node as `extras.impostor` = [column, half-width, bottom, top].
`props.js#treeImpostorGeometry` stands those three photographs as crossed
cards — six triangles — and the far forest draws every tree that way,
sharing the pool's own instance buffers. The whole tree is drawn only for
the nearest six rings of bands; between 170 m and 220 m the two dissolve
into each other on a per-pixel hash. Without the impostor atlas every tree
is drawn whole.

## nature/alpine-flora.glb — trackside flora and ground cover (built in Blender)

Written by `tools/blender/flora.py` (no rendering, so it builds anywhere):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/flora.py -- --out fun/alpen/assets/models/nature

The small things that still show above the snow beside an Alpine piste in
winter, one node each (`flora_<name>`): seed grass gone to straw, the dried
rosette of a silver thistle (*Carlina acaulis*), dead umbellifer stalks
holding caps of snow, alpenrose (*Rhododendron ferrugineum*), bilberry's
green winter twigs, a low juniper mat, a cluster of moraine stones, and two
lighter cuts — a grass tuft and a bilberry sprig — for the ground cover.
84–480 triangles each. Materials are roles; `props.js#floraGeometry` paints
them for the shared flora material, which adds the procedural snow and bark
grain each role asks for.

`props.js` places them in two layers, neither of which is a solid: the
trackside flora off the groomed piste — out across the verge and the
terrain beyond, thickest near the edge, one in ten surviving in the
piste's last two metres — in clumps, by ecology; and the ground cover —
the grass tuft and bilberry sprig in their thousands — in meadow patches
over the ground either side, each its own size, turn and lean. Both are
placed in every streamed band but drawn only for the nearest four rings
(at least 160 m ahead), dissolving out between 115 m and 150 m.

## wildlife/alpine-wildlife.glb — the hare, the deer and the wolf (built in Blender)

Written by `tools/blender/wildlife.py`; nothing is rendered unless asked,
so it builds anywhere:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/wildlife.py -- --out fun/alpen/assets/models/wildlife

(`--preview <dir>` adds a turnaround sheet per animal, drawn with Cycles on
the CPU; `--only hare,hind,stag,wolf` picks which.)

One node per instanced pool in `js/wildlife.js`, each in the game's own
frame — facing −Z, feet on y = 0:

| node | animal | triangles | extras |
|---|---|---|---|
| `wild_hare` | mountain hare (*Lepus timidus*) in its white winter coat, crouched in its form: long furred hind feet flat under it, short black-tipped ears | 4136 | `eyes` — the two eye centres the eye-shine sits on |
| `wild_deerBody` | red deer (*Cervus elaphus*), winter coat, withers down: deep narrow chest, tucked loin, buff rump patch, long fine legs with the hock pointing back | 1960 | `withers` — where the heads hang (the root of the neck, inside the chest); `legs` — each leg's pivot (y, z) |
| `wild_hindHead` | a hind's neck and head, from that pivot | 694 | |
| `wild_stagHead` | a stag's: the heavier dark-maned neck and a royal's antlers — brow, bez and trez tines and a three-point crown, twelve points | 1316 | |
| `wild_wolf` | grey wolf (*Canis lupus*, Alpine population), winter coat: the ruff, the dark saddle, pale cheeks and throat, the dark stripe down each foreleg, the low brush | 2890 | `legs` — as the deer's |

Each animal is a set of tubes — elliptical sections along a spline, one
clean ring per sample, so a leg is a stack of rings from the shoulder to
the hoof — fused into one skin with Blender's exact boolean, so legs,
haunches and ears grow out of the body rather than through it; eyes, nose,
hooves and antlers are laid on unfused. 288 KB in all.

Materials carry only a role (`fur`, `coat`, `earInner`, `eye`, `nose`,
`hoof`, `antler`). Two per-vertex weights, `_PALE` and `_DARK`, mark the
soft-edged markings; the look tables in `wildlife.js` give each role a base
and the pale and dark shades they mix in. The deer body and the wolf also
carry `_LEG` (1 fore −X, 2 fore +X, 3 hind −X, 4 hind +X) and `_SWING`, how
much of a vertex swings with that leg; with the pivots in `extras.legs` and
the game's gait tables, `modelledAnimal` turns them into the `aLimb` the
stride shader reads. The legs turn about the elbow and the stifle, where
they leave the body, so a full gallop bends the skin round them by no more
than a couple of centimetres. If the file fails to load, the sculpted
animals stay.

## piste/piste-furniture.glb — gate panel, piste marker, snow bridge (built in Blender)

Written by `tools/blender/piste.py` (no rendering needed; `--preview <dir>`
renders a Cycles contact sheet):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/piste.py -- --out fun/alpen/assets/models/piste

Three nodes, each at its own origin in the frame its procedural stand-in in
`props.js` uses:

- `gate_panel` (368 triangles) — a giant-slalom panel: two 32 mm flex poles
  screwed into black spring hinges on their drilled bases, caps, a snow
  collar at each foot, and the panel slid over both poles by its sleeves,
  with stitched hems and a printed sponsor field. Inner pole on the origin,
  outer at `GATE_PANEL.width`, fabric facing ±Z; `props.js#gatePanelGeometry`
  derives the flutter weight from the fabric roles.
- `waymark` (216 triangles) — a Swiss piste marker: a run-red fibreglass
  pole with reflective white bands and the run sign on top, a square
  aluminium plate in the run's red with a white border and the run number,
  clamped to the pole and facing +Z (up the hill); snow along the sign's top
  edge and drifted round the foot. 3.05 m tall.
- `snow_bridge` (1140 triangles) — one six-metre section of a steel snow
  bridge: two H-section girders carrying eight I-section grate beams on
  their uphill (+Z) face, leaning 8° downhill of the slope's normal; tubular
  struts behind to steel footings, tension anchors into the slope; the
  snowpack held against the lower beams and new snow on the upper ones.
  Built to the stand-in's footprint, whose box the collision is still cut
  from.

Materials are roles; `GATE_LOOKS`, `WAYMARK_LOOKS` and `FENCE_LOOKS` in
`props.js` give each its colour and how much race tint (`surfaceOwn`, on
the gate) or plank grain (`aGrain`, on `alpineMat`) it takes. Until the
file loads, and if it fails, the procedural stand-ins draw.

## nature/alpine-shrubs.glb — scrub, dwarf pine and plant patches (built in Blender)

Written by `tools/blender/shrubs.py` (no rendering needed):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/shrubs.py -- --out fun/alpen/assets/models/nature

The shrub and plant pools' models, one node each, sized like the grown
stand-ins whose bounding spheres the game still collides with:

- `shrub_alderScrub` (1367 triangles) — leafless green alder (*Alnus
  viridis*) and willow: grey-brown stems pressed down at the foot by the
  snow and rising in arcs, forked into redder twigs, the alder's winter
  catkins in threes and old cones, a few straight red willow wands, a drift
  at the foot and snow lodged in low forks.
- `shrub_mountainPine` (1334 triangles) — dwarf mountain pine (*Pinus
  mugo*): a dome of upturned, star-sectioned needle brushes over a dark
  core, prostrate stems running out at the rim, snow pillows on top.
- `plant_heath` (476 triangles) — a wind-scoured heath patch: clusters of
  little heather, crowberry and trailing-azalea bushes, a dead grass tuft
  with its seed head, snow banked in the lee.
- `plant_tussock` (482 triangles) — a tussock in winter straw: a crown of
  thatch, a fountain of arching blades, two standing culms, snow in its
  middle.

Materials are roles; `SHRUB_LOOKS` in `props.js` gives each its colour and
its `surfaceOwn` for the shared flora material (bark grain and procedural
snow). The grown stand-ins draw until the file loads, and if it fails.

## backdrop/alps.glb — the mountains round the run (built in Blender)

Written by `tools/blender/backdrop.py`, with its two maps
(`textures/backdrop/alps-shape.webp`, `alps-cover.webp`); nothing is
rendered, so it builds anywhere:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/backdrop.py -- --out fun/alpen/assets

It replaced the photographed sky panoramas. A real-sized Alpine landscape,
modelled in numpy — a ridged-multifractal range with glacial valleys cut
into it, the shoulder the run is on falling into the main valley eight
kilometres ahead, the ridges either side of it pressed to under half of
their relief over their own valleys so they stand forested below the eye,
a forested rock bar across the valley mouth seven kilometres out (it keeps
the valley floor from opening a pale plain in the middle of the view),
and four landmarks no noise draws: a leaning horn
(4350 m, 15 km, 17° left of the fall line), a row of granite needles, a
glaciated dome (4470 m, 23 km) and a north face off to the right. It is
sampled on a log-polar grid round the eye (3072 bearings × 480 distances,
2.4–48 km), every point slid along its line of sight from the eye to a drawn
radius between 1650 and 2800 m (which the eye cannot see), and decimated by
Blender's quadric collapse in that drawn space, where a metre of error is
about a pixel, to about 90 000 vertices — more down the run than behind it.
The ring is cut into 24 sectors of 15° (nodes `range_00`…`range_23`, with
`extras.bearing`, and the frame in `distance`, `radius`, `horizons`,
`horizonMax`), so the frustum keeps about a third of it and no sector spans
the sky probe's join.

Per vertex there is only the position and `_HORIZON_A`/`_HORIZON_B`: eight
normalised bytes, the elevation of the land round the vertex on eight
bearings (down the run, then every 45° towards +x), 0–50°. The game shades
the range with them (the sun is behind the land when it is under the horizon
on its bearing) and takes its sky occlusion from them. Everything else is
in the maps, on the same frame (u the bearing, v the log of the distance):
the normal's x and z and the cavity (4096 × 1024), and the snow, forest and
ice cover (4096 × 1024). `js/backdrop.js` reads all three and draws the range
— into the frame and into the sky probe the fog reads; if any of them fails
to load the procedural ranges in `sky.js` stand instead.

## huts/mountain-hut.glb — the mountain hut (built in Blender)

Written by `tools/blender/hut.py` (no rendering is needed to build it, so
it builds anywhere; `--preview DIR` adds Cycles CPU renders, and `--debug`
paints every back face magenta, which is how winding mistakes are found):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/hut.py -- --out fun/alpen/assets/models/huts

One node, `hut`, about 5.5k triangles (it is instanced three times). An
Alpine Berghütte on a slope: a rubble-stone storey with dressed quoins, a
drip-cut coping and barred cellar openings, standing two to four metres
out of the snow downhill; a log storey in Blockbau — squared, chamfered
logs, their ends crossing past every corner, the side walls' top logs
stepping out as corbels under the wall plates; a 30° roof on ridge, middle
and wall-plate purlins with carved heads and struts under the long front
overhang, rafters and boarding, verge boards, half a metre of snow that
rolls over each eave into a cornice with icicles under it; boarded gables
with sawn teeth, an attic window and a heart; the parlour's windows with
open green shutters, a shuttered window on two sides, a herringbone door
with its transom and the yellow "HÜTTE" sign; the terrace on stilts with a
sawn-board balustrade, a table, benches, the lantern's frame, skis by the
door, a woodpile on its own footing, and snow on every ledge.

The building is drawn where `js/huts.js` and `js/config.js` say a hut is:
the deck at `TERRACE_DECK`, the stone `PLINTH_DEPTH` deep, the chimney's
top at `CHIMNEY`, and every window opening exactly the glass `HUT_LIGHT`
lists (the panes, the lantern and the light they throw are drawn by the
game from that table). The node's extras carry those numbers
(`chimney`, `deck`, `plinthDepth`, `glass`, `bounds`) and the model check
holds the two files to each other — and casts rays out through each pane.

Materials are roles (`log`, `masonry`, `snow`, `shutter`…), painted and
classified by `huts.js#HUT_LOOKS`. `TEXCOORD_0` is what the hut material
samples: the plank photograph along each member's grain (a log mapped onto
exactly one plank of `alpine-wood-planks.jpg`), the slate photograph and a
procedural coursed-rubble pattern in metres for stone, a field of sawn
ends for the woodpile, rings for end grain. `_SHADE` is each piece's tone
times ambient occlusion baked by casting rays through the finished hut.
`huts.js#hutModelGeometry` builds the shell from it; if the file fails to
load, the procedural hut stays.

## Card conifer atlas (fallback)

The needled tree species were card conifers built at runtime by
`js/spruce.js` from `assets/textures/tree/spruce-card-atlas.webp`. The
atlas is composed offline from the Poly Haven **fir_tree_01** asset
(CC0): its `twig_diff/_ao/_alpha` maps supply two needle sprigs (stored
as luminance values so the per-instance cast supplies the colour, plus
frost variants derived from the alpha's top edges) and its
`bark_diff/_ao` maps supply the trunk strip. Layout is documented at the
head of `js/spruce.js`. The same builder grows the bare larches from a
second atlas drawn at boot (`createTwigAtlas`): two fractal twig sprigs
as luminance values, with their snow drawn a shade bluer than grey so the
card material can turn it back into the prop snow colour per texel.

## resort/lift.glb — the gondola line and the snow guns (built in Blender)

Written by `tools/blender/lift.py`. Building it renders nothing, so it runs
anywhere; `--preview DIR` adds turnaround renders in Cycles on the CPU, with
every back face painted magenta so a surface the game would cull shows up:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/lift.py -- --out fun/alpen/assets/models/resort

Five nodes, each swapped into the InstancedMesh `js/mountainLife.js` already
draws its procedural stand-in with, so the resort's draw calls do not change:

| node | what it is | triangles |
|---|---|---|
| `lift_cabin` | an eight-seat detachable cabin (Omega-style body with tumblehome, glazing pillars, double sliding door and its rail, rubbing strake, number plates, roof fairing, hanger, grip with jaws, spring pack and running wheels), snow on the roof | 1392 |
| `lift_cabinGlass` | the cabin's glazing, drawn with the cabins' own glass material | 96 |
| `lift_tower` | a 22 m tapered tubular tower: plinth, base flange with gussets and anchor nuts, two section flanges, T-head crossarm with stiffeners and the train brackets, a grated deck with toe boards, two-rail balustrade and struts, a ladder with a fall-arrest rail starting 2.4 m up, number plate; snow on the plinth, the deck and the arm | 1938 |
| `lift_sheaves` | one six-sheave support train: rubber-lined sheaves cantilevered off rocker plates on a balance beam, the pivot pin, an outboard rope catcher | 536 |
| `snowgun` | a fan gun on a tilting tower: footing, hinged mast with its hydraulic ram, slewing ring, yoke, yellow housing with blue nose, nozzle ring and nozzles, hub and stator, rear grille, water manifold and feed, control cabinet with beacon, hydrant pit with hose and cable; snow on the footing, the pit, the cabinet and the housing | 2050 |

The coordinates are the game's (+Y up, −Z down the hill) and every node is at
its own origin. The cabin hangs 1.7 m under the rope, which runs along Z
over its origin, door on +X; the tower stands on its mid-height (ground at
−11, ropes at +10.5, ±1.8 m either side); a train's origin is the rope's
centre over its middle, +X outboard; the gun's is its foot, barrel down +Z.
The node extras carry those numbers (`ropeY`, `groundY`, `gauge`, the
train's `sheaves`, `radius` and `bend`, the gun's `nozzle`, `aim` and
`nozzleRadius`), and `adoptLift` refuses a file that disagrees with its own.
The sheaves carry the custom attribute `_AXLE` — their axle's y and z in the
train's frame, and 1 — which the hardware material uses to turn each one
about itself in the vertex shader while the train as a whole is pitched and
headed along the rope over its tower. Materials are roles; `LIFT_LOOK` in
`mountainLife.js` gives each a colour, a share of the snow response and a
share of the slate grain. If the file fails to load, the procedural lift and
guns stay.

## Vendored loaders

`assets/vendor/GLTFLoader.js`, `assets/utils/BufferGeometryUtils.js` and
`assets/utils/SkeletonUtils.js` are from three.js r185
(https://github.com/mrdoob/three.js, MIT), matching the vendored three
build at the repository root.

## riders/ — the player and the other people (built in Blender)

`rider.glb` and `npcs.glb` are not downloaded assets: they are written by
`tools/blender/riders.py`, which builds every surface from tables (lofted
rings, swept profiles, one level of Catmull-Clark) and exports them. The
script is the source; rebuild after changing it, from the repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/riders.py -- --out fun/alpen/assets/models/riders

(Blender 4.2 or later; built with 5.3.) The tables are written in the
game's own three.js coordinates and the skeleton constants are copied from
`js/riderModel.js`, so the two must move together.

- `rider.glb` holds one node per rigid segment of the rig — pelvis, torso
  (jacket, hood, pack), head (gaiter, goggles, helmet), upper arm,
  forearm and thigh as lead/rear mirror pairs, shin, boot and binding —
  each at the origin of its segment's frame. The board's deck stays
  procedural (its flex shader and top-sheet mapping are built on it); the
  bindings and boots are bolted onto it at load.
- `npcs.glb` holds each figure's two halves for a skier and a boarder (the
  `deck` that stays on the snow and the `body` hinged at the hip, whose
  height is the node's `extras.hip`), plus helmet, beanie and pack nodes the
  game mixes per figure.

Materials carry only a role name (`shell`, `trim`, `npcJacket`…); colour,
the cloth masks and the per-figure dress are assigned in `riderModel.js`
and `mountainLife.js`. `js/riderAssets.js` reads the files without the glTF
loader (positions, normals and indices only). If they fail to load, the
procedural riders stay.

| file | nodes | triangles |
|---|---|---|
| `rider.glb` | 11 segments | ~13.8k as drawn (arms, legs, boots, bindings twice), plus the deck |
| `npcs.glb` | 2 × (deck, body, helmet, beanie, pack) | ≤ ~4k per dressed figure |
