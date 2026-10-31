# Alpen checks

Run from `fun/alpen` with Node.js; no test dependencies are needed:

```sh
node tests/riding-check.mjs
node tests/pause-charge-check.mjs
node tests/camera-occlusion-check.mjs
node tests/touch-input-check.mjs
node tests/input-device-check.mjs
node tests/controller-menu-check.mjs
node tests/npc-collision-check.mjs
node tests/flow-check.mjs
node tests/side-hit-shape-check.mjs
node tests/terrain-shadow-check.mjs
node tests/terrain-worker-check.mjs
node tests/models-check.mjs
node tests/graphics-check.mjs
node tests/gpu-timing-check.mjs
node tests/instance-lod-check.mjs
node tests/mobile-render-check.mjs
node tests/hud-check.mjs
node tests/trail-clods-check.mjs
node tests/solid-index-check.mjs
node tests/render-limit-check.mjs
node tests/audio-check.mjs
```

These cover jump charge and timing, ballistic flight, trick landing assistance,
input pulses, camera tracking, terrain continuity and determinism, shadow seams,
model geometry budgets, shadow refresh timing, and adaptive rendering recovery.
The pause-charge check runs the production pause and graphics-context recovery
handlers with real input and physics. Releasing Jump during an interruption
cannot spend an old charge or queued landing jump; a key held through resume
starts charging from zero. The desktop browser also checks the physical
Space → Escape → release → Escape sequence.
The clod check compares packed snow-chunk instance matrices with the original
quaternion path through trail recycling, anchor moves, fading and clear/reuse.
It also reports a local CPU microbenchmark for packing one fixed frame; the
orientation is now baked at placement without changing the GPU buffers.
The solid-index check compares z-window queries with the full prop scan across
seeded streaming, resets and collider refits, preserving object identity and
source order for compound contacts. It counts candidate and property visits
to verify that physics and camera queries inspect only nearby colliders.
The riding check also pins the momentum rules: a flight pays the same air drag
as the snow did, the tuck gains nothing on the flat or up a climb, an ollie
never brakes the run along the slope, the board lands matched to the slope it
lands on (never level over a pitch), and a landing skewed off its travel skids
off speed while a square one keeps it.
It also pins trick stance: a trick is named and paid by the stance it took off
in (a regular 180 lands switch but is a plain FRONTSIDE 180; a switch take-off
is SWITCH FRONTSIDE 180), with the landed stance kept separately as
`landedSwitch`. The surface speed ceiling is checked on both sides of the
lip: a flight over powder loses only its own air drag (it used to be cut to
the powder's ceiling in mid-air), and a board carried into powder above the
ceiling ploughs the excess off over about a second instead of snapping to it,
booking the plough as `scrub` inside `slide` so spray and sound answer it.
Timing feedback is pinned too: holding a charge towards a pitch break lights
`lipAhead` a few tenths early and never on the open pitch, `lipReady` is the
release test itself, releasing while it is lit is the lip pop, and
`perfectPop` fires after `launch` so the launch's banner clear cannot erase
it. Every non-clean landing carries a reason (HARD LANDING, UPSIDE DOWN,
UNDER-/OVER-ROTATED, GRAB HELD), and a bail hands it to the `fall` event.
Landings are braced for the rider's own pop. At 22 m/s into the snow, rolling
off a crest is a HEAVY LANDING, but the same impact after a full pop is clean.
The raised line stops `bracedMargin` short of the bail, so a too-fast popped
air is still heavy, and past the bail no pop saves it. On the side hits of
three seeds, a bot releasing on the lip cue now lands seven perfect pops in
twelve clean, where before none of them landed clean.
Airborne collisions during a flip recover upright through both normal rest
and the fall timeout. The remaining pitch enters the existing visual glide,
preserving orientation at recovery and avoiding a permanent inverted stance.
Checks cover signed and multiple rotations, an existing glide, the rendered
board orientation after recovery, and the next jump.
The HUD check covers the charge bar's lip states, banners queueing instead of
overwriting within a step, a mid-air callout riding the kicker line without
hiding the air clock or live trick, and a wipeout showing its reason.
Qualified grounded butters show their live name and release advice before
the scored award takes over. Pauses, falls and an ended press clear that
guidance; stable feedback causes no text, visibility, style or dataset writes.
The input-device check covers deliberate keyboard, controller and touch
handoffs without changing command ownership. Held buttons, small stick jitter,
release events and neutral polling cannot steal another device's prompts.
Unplugging the final controller restores the last non-controller help. The HUD
check verifies that device changes preserve menu focus and briefly refresh the
riding hint, while stable input causes no additional presentation writes.
Browser QA checks the displayed mappings and complete input-to-menu path,
including touch-capable layouts using keyboard/controller help and a tap that
opens help during a device handoff without accidentally starting the run.
Controller menu checks separate menu presses from riding commands: A selects,
B closes help or returns to a paused run, and Start/Back retain priority. Held
menu A and D-pad presses cannot become a jump, boost or brake after resuming.
Navigation repeat uses elapsed time, while drift and held controls across a
pause must return to neutral before navigating. Disconnect tests cover active
versus idle pads, reconnection, and interrupted jump ownership when another
controller or keyboard/touch input remains held. HUD and browser checks also
cover visible controller focus, native activation and reaching every help row
through bounded scrolling in short menus.
Snow types are pinned as well: at 20 and 28 m/s the corduroy out-carves
powder (it used to be the other way round by a third), deep snow bogs a
slow board down on a pitch the corduroy runs away on, and a loaded edge on
ice chatters (`rider.chatter`, which the camera, the pad and the mix read)
while the corduroy does not.
The camera check also holds the chase frame's speed curve: exactly the old
framing at 20 m/s, and the lens and boom still opening between 42, 60 and
96 m/s (they used to stop at 42) without the lens passing 76°.
Camera obstruction checks use the height of the boom above bounded rocks and
hut roofs. A clear flight keeps its framing, while a lower camera still
catching up during ascent retains clearance. Tree checks stay conservative
because their collision height is not a measured canopy bound.
The flow check rides the real rider down three seeded mountains with the award
rules from `main.js` and the race gates where `props.js` plants them (a panel
either side of the racing line on every guide slot): steering the line alone
must stay a low multiplier and never fill the bar, while a rider landing a
trick every few seconds must still reach it within a minute. It also pins the
hold, fade and tuck-spend rules in `flow.js`.
The trick payout itself now lives in `flow.js` (`scoreTrick`) and both
`main.js` and this check use it: the switch bonus follows the take-off
stance, and the factors it names for the banner's kicker (Off-axis, Switch,
Fast, Lip) are checked against the multipliers they stand for. The third
identical trick inside five landings pays `SCORE.repeatShare` of its points
(`repeatShare`); flow is still fed the full figure.
It also checks the side hits `terrain.js` plants beside the ribbon: about ten
per four kilometres on every seed, each off the corduroy and inside the
corridor, a pure function of the seed, and — compared exactly against the
same mountain with hits switched off — carrying no height at all within
`guide.tol` of the line while the crest stands its full height proud. A bot
that swings out to them must fly at least 70% of them for 0.6–1.6 s without
a fall, and the line bot must still leave the ground at most twice a minute.
The model check reads the modelled riders (`assets/models/riders`, built by
`tools/blender/riders.py`) with the game's own reader: every role has a
look, the budgets hold, each segment sits in its procedural frame (knee and
elbow balls cover the bend, the gaiter falls over the boot, no lamp on the
helmet), lead and rear limbs mirror, only the hem and upper
sleeves flutter, the eight figures bake in their own colours on the hip the
file carries — and under the rig the kneecaps face the toe edge and the
elbows point behind, which is the bend-plane roll the IK now applies.
It reads the modelled Alpine forest too (`assets/models/nature/alpine-trees.glb`,
built by `tools/blender/trees.py`): every `SPECIES` slot has its tree, four
species in all and the bare slots larches; each stands on its trunk at the
origin, under 1200 triangles, at the pool's height once converted, with its
trunk running on under the snow line; every corner is needles, snow or bark,
bark samples only left of the keyed foliage, snow cards only the frost half.
And the trackside flora (`assets/models/nature/alpine-flora.glb`, from
`tools/blender/flora.py`): every plant `props.js` places is in the file,
small, footed at the origin and under 500 triangles, every role it is painted
with has a look, and the loops that place the flora and the ground cover push
no solids — they are decoration. Each tree's far-forest impostor is three
cards in its own column of `alpine-impostors.webp`, framed round the whole
tree at the cell's aspect.
And the modelled range (`assets/models/backdrop/alps.glb`, from
`tools/blender/backdrop.py`): the frame in the file is the one `backdrop.js`
reads it in, every sector lies in the drawn ring and keeps to its own 15°
(so none spans the sky probe's join), the whole is under 120 000 vertices,
the skyline is believable all round with the horn standing 6–12° over the
run, and the two maps are WebPs of the sizes the shader assumes.
The model check also covers the race-gate panel (only its fabric may
flutter) and the sapling impostor cards (24 triangles, atlas rectangles that
keep each tree's drawn aspect), and that a set file bakes only the named node.
It reads their modelled replacements too: the gate panel, piste marker and
snow bridge of `assets/models/piste/piste-furniture.glb` (from
`tools/blender/piste.py`) — the gate in the stand-in's frame, only its fabric
rippling and never within 3 cm of a pole, the race tint kept off its hinges;
the marker three metres tall on its foot with its sign facing +Z; the
bridge's steel inside the box its collision is cut from, snow on its upper
beams; all in budget — the scrub and plant patches of
`assets/models/nature/alpine-shrubs.glb` (from `shrubs.py`: in budget,
footed on the snow line, about the size of the stand-in hulls the game still
collides with), and the sapling atlas from `saplings.py` (the four species,
rows that do not overlap, a 1024 × 2048 WebP with alpha). The stand-ins
carry the attributes the materials now read (`aGrain`, the gate's
`surfaceOwn`).
It reads the modelled rocks and deadwood too (`alpine-boulders.glb`,
`alpine-crags.glb`, `alpine-deadwood.glb`, built by `tools/blender/rocks.py`
and `deadwood.py`): every node a pool asks for is there, inside its triangle
budget, footed at the origin with its UVs in its one WebP atlas; every rock
and trunk is a closed solid; the boulders and crags stand at exactly the
height over half-width their colliders assume (`SCAN_ASPECT`, `CRAG_ASPECT`),
the trunks lie along x at `DEADWOOD`'s length and height, the stump spreads
wider than it is tall, and the three files together weigh less than the
photoscans they replaced, none of which is still requested.
It checks the ground the props keep off around each hut (`onHutGround`) too:
every corner of the roof, the woodpile and the terrace is on it, turned the
way the hut is turned, and the open snow twelve metres to one side is not.
The modelled hut (`assets/models/huts/mountain-hut.glb`, from
`tools/blender/hut.py`) is read the way the game reads it: 4–6k triangles,
every role has a look and a surface kind, the procedural fallback is all
kind 0; its extras agree with `CHIMNEY`, `TERRACE_DECK`, `PLINTH_DEPTH` and
`HUT_LIGHT`, the stone reaches the depth the site search assumes, the deck
is at the deck height, a ray from the room out through every pane meets
nothing while one beside it meets the wall, and everything below head
height but the snow lies inside the collision boxes.
Smoke checks cover framebuffer resizing, capped device pixels and sprite-size
limits. A native GPU fixture compares the production smoke vertex shader with
an equally sized mesh at 65/72/75/82° fields of view on two buffers. Both keep
the same projected size, while smoke retains its one-pixel floor and size cap.
The real smoke emitter also checks empty, first-emission, final-expiration and
reset states. Empty pools skip their draw; active puffs keep their full fade
and wake on the first emission, including after a zero-time capture or reset.
And it checks `weld`, which the prop pools, the forest cards and the animals
draw through: every corner keeps every attribute bit for bit through the
index, shared corners really are merged, and a pool still waiting on its
scan is left alone.
For the rider it pins a 10,500-triangle budget across every segment; the knee
and elbow joint fills and the domed thigh tops; the seat of the trousers as a
separate, unquilted pelvis buffer on the hips; the jacket's flutter weights
(free at the hem, rigid at the chest and under the pack, a third on the upper
sleeves, zero everywhere else); and the thin board — 11–15 mm at the waist,
tapering to the tips, bindings bolted to the new deck top, nothing below the
base and steel edges flush with the rails. It then drives the real rig
headlessly through a carve, a hard stop, all three grabs and a landing: every
matrix stays finite, both ankles stay in their bindings, the indy hand still
lands on the toe edge, the head leads each turn by less than the cap, a hard
stop pitches the chest forwards and settles, and breathing never scales or
shears the head.
The arms (`ARMS` in `riderModel.js`) are driven through the states they
answer, and in every frame of it each glove stays out of the jacket and
twelve centimetres from every leg bone (but in a grab), and each elbow keeps
some bend, never folds flat and never points forwards into the chest. On a
laid-over toeside carve the leading hand reaches down for the snow and sits
lowest, heelside the trailing one does, and no hand goes into the snow, also
riding switch; a pop throws both arms up; a tuck's hands are in a box in
front of the chest; the arms lead a spin in the air and coil against it on
the snow before the pop; a flip pulls them together; a held indy closes its
glove on the toe edge while the free arm bones out; an unclean landing waves
higher than a clean one of the same impact; a stop spreads the arms along the
board; and a fall throws them out in front. The hands are their own wrist
segments now, split off the forearm by role (`HAND_ROLES`), with open and
fist morph targets. Deer and wolves are checked standing on the real terrain
(fore and hind feet on the snow, most of the cross slope taken up, and the
tilt capped on ground steeper than an animal carries its spine), the
shared texture cache hands every caller one texture per file, the forest's
gust field is sampled at the wavelengths its drift wraps at, and the other
riders respawn beyond the clear-day fog and get up from a tumble without a
cut (both of those fail against the previous `mountainLife.js`). Their upper
halves are skinned to five bones (body, shoulders, hands) with every vertex
fully weighted, still two meshes a figure; over sixteen seconds a skier's
inside pole comes down to the snow at or ahead of the boots in the
two-thirds of a second before every edge change (the lean going over, by a
margin), the other arm at rest meanwhile, and no pole tip is ever in the
snow; a boarder's leading arm goes into toeside turns and the trailing one
out on heelside ones.
Turning figures also keep their ski nose and tail aligned with the actual
snow slope: 6,240 settled poses include oblique traverses and allow at most
12 mm difference in end clearance. The same two terrain probes now follow a
fixed distance along the heading instead of widening with the turn.
The NPC collision check runs the real mountain-life update at 20/30/60/120/240
Hz. Centered and grazing crossings below the riding speed limit must produce
one impact; those same 20 and 30 Hz cases fail with endpoint-only contact.
It also covers moving NPCs, parallel near misses, airborne clearance and
overlap of the horizontal and vertical contact intervals. Resets, recycled
figures, zero-time captures, renewed grace and teleports rebase motion history
without sweeping across the discarded path. Existing fall/grace/attract
behavior, repeat-hit suppression and finite impact spray remain checked.
The modelled lift and snow guns (`assets/models/resort/lift.glb`, from
`tools/blender/lift.py`) are loaded through `mountainLife.js`'s own fetch:
the cabin (with its glass) stays under 1500 triangles, the tower under 2500,
a sheave train under 600 and the gun under 2500; the cabin, tower and gun
carry snow that faces up; every sheave turns about its own axle and the rope
lies on all six. Adopted, the file reuses the meshes already drawing (the
resort stays at most 24), the hardware patch lands in three's Lambert shader
and turns the sheaves, every train lies along the rope between its
neighbouring towers with its frame inboard, every cabin hangs from the rope
by its grip with its door outboard, and the guns spray from their own nozzle
rings along their barrels. Without the file the procedural line stands.
Cabin glass color and lamp energy are checked across dusk and snowfall
thresholds for smooth changes, with the authored day/night endpoints retained.
The graphics check also loads the modelled range (`assets/models/backdrop`)
through the sky: it arrives as its 24 sectors, drawn after the ground and
before the haze cone, retires the relief shell and the far ribbons at every
hour (and without it they stand), hides a low sun behind the horn and shows
one above it, goes into a whiteout with everything else, and is never moved
however far the run goes.
Input regressions include releasing a spin before touchdown, controller menu
edges, and discarding stale jump gestures across pause and focus loss. The
triggers pass their analogue travel through (`brakeAmount`/`tuckAmount`) and
a half-squeezed brake is half a speed check; the pad's Back button restarts
once per press; and `rumble` falls back to `navigator.vibrate` only on a
bound touch pad, after a user gesture, and only for the stronger pulses.
HUD checks cover mode transitions, controls disclosure, focus and idle DOM writes.
The graphics check uses a renderer stub; it does not compile GPU shaders.
`await (await import('./tests/shade-radius-browser-check.mjs')).runShadeRadiusCheck()`
compares complete lit snow shaders with and without the horizon-map radius
guard. It covers ground and raised receivers, sun angles, clouds and fragment
quads across the fade cutoff. Three horizon/height reads are skipped once the
fade reaches zero, while distant cloud shade remains active.
`await (await import('./tests/glint-seam-browser-check.mjs')).runGlintSeamCheck()`
executes the production snow-crystal coordinates and coverage on real derivative
quads. Crystals crossing the 64 m wrapping seam match an interior patch at the
start, 26 km and 1,000 km down a run, while undersampled crystals still fade.
`await (await import('./tests/post-depth-browser-check.mjs')).runPostDepthCheck()`
checks the world target's unused depth resolve in WebGL. With MSAA enabled it
removes one full-size depth blit while preserving every output pixel, including
overlapping surfaces and antialiased edges; the non-MSAA fallback is checked too.
The mobile rendering check boots separate phone and desktop profiles. Phones
use a 450 m fog curtain, fewer outer terrain rows and scenery bands, smaller
world buffers, and lighter shadow and fog-panorama targets. Portrait and
landscape use the same profile; narrow desktop windows and touch laptops
retain desktop quality. The check measures actual geometry and render targets,
keeps the HUD at display resolution, and compares near-ground heights and
riding rules across profiles so reducing scenery cannot change the ride.
For distant-hill detail, run
`await (await import('./tests/backdrop-detail-browser-check.mjs')).runBackdropDetailCheck()`
in a served Alpen page. It renders the production forest detail in a separate
WebGL context and checks the old 47 m repetition at 2.4 km and the 160 m
repetition at 8 and 12 km against a legacy fixture. It also checks that the
crowns remain compact, retain their tone, stay fixed to the ground as the
view moves, and fade to their mean beyond 16 km.
Both crown fields also fade to their mean as their cells shrink to a few
pixels on screen. Before that, a forested slope two to five kilometres out
was one even dotting of identical crowns, the most visible repeating pattern
in the distance, with the 47 m field drawing diagonal dashes over it. The
slow field now sets how open each stand is, scaling the snow between the
crowns around its old amount so the forest keeps its tone, and the slope
reads as stands. The check's magnified views stay above that pixel fade.
For the mountain rendering optimization, run
`await (await import('./tests/backdrop-performance-browser-check.mjs')).runBackdropPerformanceCheck()`.
It compares the full lit image with the original texture-reading path at
near and far distances, across fade cutoffs, on steep cliffs and at the
panorama seam. The reference applies the same distance and pixel fades,
unconditionally. Texture reads are skipped only after their fade reaches zero;
the check allows at most one byte of GPU rounding difference.
`await (await import('./tests/forest-clip-browser-check.mjs')).runForestClipCheck()`
compares the real tree models and distant images before and after vertex
clipping, including the 170–220 m transition and both sides of its cutoff.
It also checks that distant trees still cast their original shadow silhouette.
It compares a complete tree batch before and after trimming its fully faded
tail, checks exact pixel equality, and reports the detailed tree triangles
submitted by the production pools. The Node instance LOD check covers arbitrary
pool ordering, transformed parents, multiple cameras, cutoff precision and
restoring counts without rewriting or uploading instance buffers.
In Chromium's software WebGL renderer, the seeded forest fixture submitted
222,858 → 195,750 detailed tree triangles (12.2% fewer), with zero changed
image bytes. This measures geometry savings, not a hardware FPS improvement.
The accompanying surface pass gives modeled stone and deadwood broken snow
caps that fill with the storm, using their existing albedo maps and the same
linear snow colour as the vegetation. The opening now starts in daylight so
the rider, course contours and forest shadows are visible immediately.
Browser QA covered charged keyboard and native touch jumps through landing,
pause/resume at 960×600 and 390×844, and terrain resets at 2.2 and 8 km.
The final captures reported no runtime/shader errors or horizontal overflow.
The graphics check's resolution governor cases tell a slow GPU from a slow frame clock: a
30 fps cap (or a frame time resolution does not change) walks down, finds
nothing gained at the floor and returns to full resolution for good; a GPU
timer showing idle time vetoes the walk outright; and a GPU just over budget
settles in under 40 resizes in ten minutes instead of cycling every few
seconds. Counted passes start from `info.reset()`, which main.js now calls
once per frame before the probe and rider-shadow passes.
It exercises all six snowfall bands across nine times of day, cloud extinction,
night-storm visibility, the modelled skyline's occlusion and its fallback.
It also pins the sun's depth-map box half a box ahead of the rider along the
camera heading (and dropped onto the slope it covers), and the glint grid's
camera origin wrapped into its 64 m period on the CPU, so no shader forms a
26 km coordinate. Nothing in the distance may change abruptly. Streamed props (trees, saplings,
rocks, deadwood, gates) dissolve into the haze before the forest window's far
edge. That edge is now 24 bands (960 m) out and moves with the rider
continuously. Only props carry the fade term, and it reads the view direction
after it is declared. The model check also covers wildlife arrival: a hare
placed this frame has not arrived yet, and is fully drawn 1.2 s later. Both
passes read the same value, so its shadow arrives with it. Hare coasting
matches the original 60 Hz path at 20/30/60/120/240 Hz and mixed frame times;
zero-time redraws preserve velocity and position. Fleeing, mesh pools and
the one existing terrain sample per hare remain checked. The modelled
animals (`alpine-wildlife.glb`, from `tools/blender/wildlife.py`) are
checked too: each pool's node is inside its budget (hare 4500, deer body
2000, hind head 1200, stag head 1400 for its twelve points, wolf 3200), on
the snow, symmetric and nose-first, every role has a look, and the hare's
eye-shine offsets are its eyes' centres. Every deer and wolf vertex swings
with one leg or none and never with a leg on the other side, the lower legs
are rigid and the back still, and a full stride at four phases stretches no
edge by 4 cm or more (it is about 2.5; a torn flank is tens). A browsing
head keeps its muzzle, and a stag's antlers, out of the snow without heaving
its neck over the withers. The game swaps all five pools to the file while
keeping their arrival and stride buffers, follows its eyes and withers, and
without the file keeps every sculpted animal whole. The canopy field (`canopy.js`) is checked too. A crown hides
about half the sky at its trunk and nothing beyond its reach. A thicket is
darker than one tree but never black, and a bare snag hides much less. It takes
direct light only as the sun's shadows fade. The window stays on the world's
metre lattice and is reused across short moves. A redraw stores the same value
at the same world point. The terrain shader check applies the production
`canopy` option, so the field's fetch is covered by the fog-exit rule.

The realism pass on light was compared in Chromium against the previous commit
from fixed, deterministic-time captures (golden hour and midday; chase, rider
close-up, into the sun and across the slope) with no shader or console errors.
Highlights above the shoulder now keep their hue when saturated — alpenglow
and the orange shell stay orange — while near-neutral snow still rolls to white
per channel. Clear air turns dark distant trees blue before it pales them, and a
storm removes that tint. The bloom's bright pass weights taps against
fireflies, and crepuscular rays only take light from near the sun rather than
from sunlit snow. Snow has a blue subsurface band at its terminator and a thin
blue fringe on shadow edges. The rider's highlights, sheen and the light
through spruce crowns now respect the depth map, the mountain's own horizon
shadow and cloud shadow. The rider's snow bounce now comes from world down, not
from the bottom of the screen. Rock and glacier photographs are decoded as sRGB,
each rescaled to its old mean, so cliffs regain their photographed contrast.

The gameplay pass (switch stance, speed ceiling, timing feedback, side hits,
snow types, start/restart, camera at speed, score factors) was checked in
headless Chromium on SwiftShader at 640×360 with physics stepped inside the
page: dropping in with the attract demo 1.4 km down started the run at the
top with the 1 km milestone still ahead; a side hit lit "lip ahead" 4 m
before its crest, popped on the lip and showed PERFECT POP on the kicker
over the air clock; the landing banner carried its reason and factors; the
wipeout banner its reason; and the pause screen's restart button resumed a
playing run with audio running. No console or shader errors were reported.

For browser checks, serve the repository root and open
`/fun/alpen/?seed=alpine-review`. Exercise carve, charged pop, grab/spin, landing,
brake, pause/resume and restart. Check a narrow touch viewport as well as desktop.
For phones, check 320×480 and 390×844 portrait, and 568×320 and 844×390 landscape,
including notch and home-indicator insets. All touch targets should be at least
44 pixels; both steering arrows stay together under the left thumb, and the
right thumb can charge and release a jump while steering. Slide the steering
thumb between arrows without lifting it. Pause or rotate while holding Jump,
then lift the old finger: no jump should fire, and a paused run must stay paused
until a fresh menu tap. Check native scrolling through expanded Controls & tricks
and the pause screen's restart action. The touch-input check covers simultaneous
fingers, steering slides, interrupted gestures, capture cleanup and accessible
button activation; real browser checks also cover the menu click after capture
is released, which synthetic pointer events alone do not reproduce.
The existing T key cycles morning, dusk and blue hour. `window.__alpen.debug()`
reports frame time, draw calls, triangles, render scale and simulation state.
It also reports CPU submission time and optional asynchronous GPU timing,
including separate averages for frames that refresh or reuse shadows.

The efficiency pass was checked from 390×844 through 3840×2160, including
expanded help, pause/resume and a native touch charged jump. Desktop labels
scale from about 14.5 px at 1440 pixels wide to 25 px at 4K, independently of
world rendering resolution. No horizontal overflow or shader errors occurred.
A frozen-scene framebuffer comparison against `dab491a`, at 1920×1080 with
4× MSAA, found a maximum difference of one 8-bit color step with rays both
enabled and disabled. The equivalent blur uses four texture reads instead of
five, inactive rays skip their composite read, and postpasses share a triangle.

Four alternating baseline/current eight-second opening rides at that same
resolution measured mean main-loop CPU time of 2.97 → 1.84 ms (about 38% less)
and total terrain-update time of 735 → 199 ms (about 73% less). Terrain retains
exact matching heights and surface neighborhoods across streamed builds.
Regression checks compare six complete terrain buffers in 48 streaming/reset
cases, including interrupted builds and seed changes at the same anchor.
The reuse buffers add about 0.94 MiB of CPU memory and no GPU memory.
Frame intervals stayed at 16.7 ms median / 17.6 ms p95 in both versions; GPU
timings varied without a clear overall change. These local measurements show
additional CPU headroom, not a guaranteed FPS increase on other hardware.

Terrain re-anchors are now built in a module worker (`js/terrain-worker.js`,
running the same `createLattice` from `terrain.js`), and the terrain worker
check proves they are the same bits. A deterministic 60 s streaming ride
(a flow burst, snapped builds, a restart, a new seed and a checkpoint jump)
hashes every mesh buffer at every upload with every build on the main thread
and then with every build in the worker, on the desktop and phone grids, and
each pair must match upload for upload. It then holds the worker's answers
back (a few frames, every sixth for 0.75 s, one never) and requires the late
builds to be finished on the main thread, the silent worker to be retired, and
every surface shown to match a fresh build of its transition. Node has no web
Worker, so the check runs the worker module on `worker_threads`.
In headless Chrome on an M1 Max (ANGLE Metal, 60 Hz, the attract demo on
seed `alpen01`, two alternating 60 s rounds per version, about 1.7 km and 140
re-anchors each), the terrain's main-thread time fell from 0.80–0.92 ms to
0.01 ms a frame and its worst frame from 4.4 to 0.2 ms; the whole frame's
main-thread time fell from 2.70–3.04 to 2.02–2.17 ms on average and from
8.7–9.6 to 5.1–5.7 ms at worst. The worker answered in 23–31 ms and was
never late. Phones were not measured.

The follow-up pass verified A/Start pause and resume through the production
loop with a simulated controller, plus actual touch jump and pause controls
at 390×844. Day, dusk and blue-hour captures at 8 km compiled without errors.
Conifer volume uses 7.2% fewer triangles in the seeded model sample; snow
variants share one surface and hanging needle cards supply depth. Mountain
geometry stays at 35,840 triangles and adds one existing 1024² granite map.
A local 160-frame renderer comparison against `76b47f0`, with a fixed camera
and 100% internal resolution at 1440×900, measured mean sampled GPU work
7.06 → 6.49 ms and render submission 1.03 → 0.98 ms. Both runs had 16.7 ms
median / 18.5 ms p95 frame intervals. This isolates rendering, not gameplay
CPU cost, and does not predict performance on other hardware.

The presentation pass was checked at 1440×900 and 390×844 with desktop and
native touch input, charged jumps, controls disclosure, pause/resume, restart,
and actual WebGL context loss/restoration. No runtime or shader errors were
reported. A 180-frame opening run measured 16.7 ms median / 18.6 ms p95 at
80% internal resolution, with mean CPU submission 2.6 ms and sampled GPU
work 6.1 ms. These are local measurements; the adaptive governor chooses
resolution for each device. Terrain checks also exercise three seeds over
12 km and long-range shadow seams. Tree triangle counts remain unchanged.

The earlier riding pass was validated in Chromium at 1440×900 and 390×844, including actual
touch events, daylight/dusk/blue hour/blizzard rendering, and terrain rebuilds
at 1.2, 3.6 and 8 km. No runtime or shader errors occurred in the final pass.
The 120-frame opening benchmark at 1200×1279 measured a 16.7 ms median and
17.6 ms p95 at full resolution, matching the original run's display-limited FPS.
CPU microbenchmarks measured height queries about 31% faster and a streamed
five-tile shadow row about 38% faster; those are local measurements, not a
cross-device FPS guarantee. Adaptive halo rendering saves three passes when
resolution falls below 80%, fading back in as performance recovers.

The weather pass was visually checked across clear, flurries, light snow,
snowing, heavy snow and blizzard conditions, all nine daylight phases, mist,
cloud cover and aurora. Light snowfall retains longer views, storm lighting
becomes more diffuse, and night storms retain enough ambient light to read
the near piste. Sun, glow and rays respect the modelled skyline, and a dim
night no longer revives the fallback ribbons.

The intermittent rectangle was captured during live riding: a single NaN
terrain pixel spread through the bloom filters into a roughly 144-pixel square.
A frozen redraw erased the original invalid pixel, which explains why earlier
particle-isolation checks missed it. Fog exits must preserve the neighboring
fragments needed by texture derivatives, and Fresnel inputs must stay within
their mathematical domain. Postprocessing also rejects nonfinite scene colors
before bloom or motion blur can spread them, without clipping valid HDR light.
The corrected shader keeps its fog shortcut by evaluating gradients first;
its texture-read and explicit-derivative counts remain unchanged. Live riding
through all 54 weather/time combinations produced 800 full-resolution HDR
scans without a nonfinite pixel or runtime/shader error. A 390×844 check also
verified native touch jump, pause and resume without horizontal HUD overflow.

Paired 1440×900 renderer checks with 4× MSAA retained a 16.7 ms median frame
interval and 17.5–17.8 ms p95. The safe terrain shader cost about 0.2–1.4 ms
more sampled GPU time than its unsafe predecessor across these runs; retaining
the fog shortcut recovered most of the storm cost of simply removing it.
These local timings vary with other system work and do not guarantee the same
FPS on other devices. No quality settings were reduced for the comparison.

To exercise that safeguard on the actual GPU, run this in the game console:

```js
await (await import('./tests/post-hdr-browser-check.mjs')).runPostHdrCheck()
```

This uses and disposes a separate offscreen WebGL context. It injects NaN,
positive infinity and negative infinity at idle and maximum speed, checks all
bloom/ray targets, and compares valid HDR images with the safeguard disabled.
With the safeguard, all six cases must stay finite and local. Without it,
spreading is diagnostic rather than required: GLSL ES 3.00 sections 4.5.1–4.5.2
allow NaN propagation and precision conversion to vary across drivers.
The report records `unguardedSpreadCases` and changed pixel counts; invalid
intermediate values need not survive later passes as a visible artifact. The Karis bright pass (`7bc08d3a`, after this check was written)
clamps each tap with `min(tap, 24.0)`. That always turns positive infinity
into 24, and NaN too wherever `min()` returns the number rather than the NaN,
as an M1 Max does; one tap of 24 among three dark ones then stays under the
threshold. Negative infinity can pass `min()`, and its Karis weight,
1/(1 − ∞) = −0, can generate NaN. Until the check allowed for this it failed
its own fixture on every commit from `7bc08d3a` on. On an M1 Max under ANGLE
Metal and GL, unguarded negative infinity put 2,055 invalid half-floats into
the bloom and ray targets and changed 26,192 pixels at both speeds, NaN and
positive infinity changed 5–11 pixels, and with the safeguard every case
changed at most five; the valid images stayed within one 8-bit step.

## Riding and hardware compatibility pass

Jump charge now follows combined keyboard, touch and controller ownership. Releasing or cancelling one source leaves another held source intact; hard focus loss cancels pending charge exactly once. The controls and riding checks cover device handoffs and interrupted releases.

A run rewards the first clean, held landing of each configured grab with 12% extra points. The existing trick kicker explains the premium, repeat penalties remain, and flow still uses the original trick payout. Restarting clears the bounded discovery set.

The post stack caps both output dimensions against texture, renderbuffer and viewport limits while retaining the existing area budget and aspect ratio. Device limits override the normal DPR floor when necessary. The new render-limit check covers landscape, portrait, unusually wide windows and independent device limits.

The engine module is preloaded from the existing import-map URL, so it starts loading while the HTML is parsed. The browser check confirms that the module graph reuses that single request; this is a loading-order improvement, not a measured startup-speed claim.

The HDR regression keeps finite output, localized invalid texels, unchanged valid radiance, and error-free WebGL mandatory. Its unguarded negative control reports GPU-dependent propagation rather than requiring one driver's NaN behavior.

The scoped **Alpen game QA** workflow runs all Node checks and a real Chromium pass. The browser pass checks boot, native controls, grab reward/reset integration, three device layouts, terrain chapters, clear/dusk/blizzard scenes, and the existing depth/HDR shader regressions. PNG captures and JSON scene reports are saved as an artifact. Software GPU mode is for coverage and does not benchmark a physical phone.

To run the browser pass locally, serve the repository root and run from `fun/alpen`:

```sh
ALPEN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs ALPEN_URL=http://127.0.0.1:8773/fun/alpen/ node tests/browser-ci-check.mjs
```

Use `ALPEN_BROWSER=chromium` for Playwright's bundled Chromium. A GPU-less Linux runner can opt into `ALPEN_SOFTWARE_GPU=1` only with a loopback URL. `ALPEN_QA_THUMBNAILS=1` emits compact QA scene images alongside the full PNG artifacts.
For input/menu changes, `ALPEN_QA_CONTROLS_ONLY=1` runs the real boot and
gameplay/control assertions without repeating scene captures and GPU fixtures.
Its report explicitly records those checks as skipped. CI leaves this flag
unset and continues to run the complete rendering suite.

CI device profiles run independently. Scene captures settle visual state without redundant intermediate GPU draws, then execute a complete production frame to refresh sky and rider shadows before recording. Capture metadata omits performance timings from that setup period.

On software WebGL only, controller menu checks temporarily suppress raster
draws while the production frame loop, input, physics and native DOM continue.
Their screenshots show the real menu over the retained boot image. GPU timing
and adaptive resolution stay suspended for that scope. A `finally` restores
the original renderer and timing functions, refreshes probes and shadows,
invalidates the paused cache, and verifies a complete native world draw before
the existing gameplay, scene captures and GPU checks continue. The run reports
the skipped draws, restoration checks and elapsed time; hardware runs use the
normal rendering path throughout.

## Riding sound and motion comfort

The system's reduced-motion preference now applies live to the chase camera
and postprocessing. It removes incidental shake, banking, landing zoom, body
bob, radial blur and chromatic splitting. Flight framing, terrain clearance
and the extra room needed by an obstructed portrait camera remain. The riding
and graphics checks exercise preference changes in both directions, impact
response, flight tracking and portrait visibility.

When a held grab is within 0.65 seconds of its predicted landing, the existing
airtime line says to release it. The cue uses the rider's current prediction,
keeps the trick visible and never changes input or scoring. HUD checks cover
release, unjudged hops, falls and unknown landing times. The menu arrow is an
inline SVG so it does not depend on an installed symbol font.

Riding audio keeps six looping voices and adds one optional stereo panner for
the edge and displaced snow. The actual grounded lean places that sound;
wind and body rumble stay centered. Filters keep brightening beyond 42 m/s
within fixed limits, snow contact changes bypass the normal control throttle,
and stationary boards no longer scrape. Moving body contact during a fall uses
the existing scrape voice independently of board contact; airborne tumbles and
stopped bodies stay quiet. Real fall, bounce, slide and recovery traces check
both contact transitions and the voice budget. No audio downloads, world geometry,
textures or render passes were added. The Node audio check covers those
budgets, the mono fallback and mute/pause/resume behavior.

The desktop browser check also renders the production audio graph through a
native `OfflineAudioContext` in an isolated iframe. It checks left/right
balance, centered-mix parity, airborne/idle sound, body-slide onset and release,
high-speed timbre and finite,
unclipped samples without touching the player's live audio or saved settings.
It can be run separately from the game console:

```js
await (await import('./tests/audio-browser-check.mjs')).runAudioCheck()
```

These checks establish behavior and resource bounds. Software WebGL coverage
does not establish a physical desktop or phone frame-rate improvement.

GPU timing now spans the rider shadow, sky refresh, world and postprocessing.
Only complete running frames feed adaptive resolution; boot/debug draws and
paused composites do not. Sampling still uses one reusable asynchronous query
every thirteen frames, without blocking for a result. The GPU timing check
executes the production submission block and verifies pass coverage, the
governor's response, query ownership, failures, disjoint results and context
restoration. It also checks that an unavailable timing extension never gates
rendering. Sampled milliseconds represent the complete frame, so they should
not be compared directly with older world/post-only diagnostics.

The desktop browser job enables Chromium's timer extension for native query
coverage, including a deliberate loss and restoration of a separate WebGL
context. Use `ALPEN_GPU_TIMERS=1` for the same local coverage; without the
extension the browser fixture reports a skip while rendering still works.
This flag enables test coverage, not a hardware performance benchmark.

```js
await (await import('./tests/gpu-timing-browser-check.mjs')).runGpuTimingCheck()
```

## Natural jumps and varied side hits

A charged ollie adds a modest leg impulse while the terrain tangent preserves approach speed and takeoff angle. Riding checks measure actual apex heights, speed and angle response, charge timing, and clean trick landings rather than only comparing velocity with configuration values.

Marked side hits vary their longitudinal profile and footprint. Rollers, drifts and wind lips have different crowns, shoulders and runouts; seeded placement remains deterministic and the central ribbon remains clear. Terrain checks sample the actual height field with and without the features to compare normalized silhouettes.

Browser QA uses the shared seed `1EE9566` and captures a consistent three-quarter view of each side-hit family, alongside the existing terrain, weather and device checks. Camera overrides are confined to capture setup, run through the production visual update order, and are restored afterwards.

## Frame overhead and paused composition

The trail writer leaves normal generation to the final longitudinal/transverse pass, eliminating an intermediate result that was overwritten before upload. `trail-normals-check.mjs` takes the actual baseline trail module path, compares all buffers and state through 1,600 frames, then reports alternating fixed-ground writer timings.

Shadow atlas installation copies contiguous typed-array rows, splitting only at torus seams. The terrain check verifies actual installation against an independent world-texel oracle, including negative coordinates, multi-page wraps, resident slots and untouched gutters. `shadow-install-benchmark.mjs` takes the baseline terrain module path and reports paired installation CPU times for a tile, five individual incoming tiles and an opening region.

Paused menu and lens fades reuse the completed HDR/light targets and redraw the final composite. The first paused frame, resizing, restored contexts, changed sun rays and a newly needed wide halo require a full render. Active riding always executes the full scene pipeline. Graphics checks cover invalidation and renderer error cleanup; `paused-composite-browser-check.mjs` compares actual cached/full pixels. The desktop gameplay check also counts continued paused-frame submissions.

CI fetches the two baseline source files pinned to commit `a3edd9d9cd0d3de13a384ea15e572df79a3dc60e`. Paired CPU measurements are diagnostic and have no timing pass threshold; software WebGL checks establish rendering correctness rather than physical-device frame rate.

## Mountain sidewalls and distant rock faces

Sidewall arêtes and bulk gullies have stronger relief, with an earlier coarse-cell fade so wide rings keep the existing geomorph bound. Existing filtered rock bedding, joints and normal relief have greater contrast. The corridor and its twenty-metre powder apron remain unchanged; no terrain vertices, height octaves or texture samples are added by the sidewall pass.

The loaded distant model gains broad, vertically coherent crags, snow channels and bounded indirect-light occlusion in gullies. Two conditional samples of the existing noise map supply structure at resolvable scales, with pixel-footprint, forest, slope, whiteout and distance fades. The model, skyline, textures and draw counts stay unchanged.

The browser detail profile compares baseline `ebb84e90` with current code at identical seed, time, camera and full art render scale. It captures both sidewalls and the far horn/massif, including native-resolution crops. Capture setup freezes test-only weather/cloud clocks and asserts all 24 model sectors/maps are loaded and fallback ranges hidden. The ordinary mobile/desktop profiles keep adaptive rendering enabled.

The actual-shader crag check verifies normal and final-color responses on fully snowy and bare mineral faces and exact bypass for forests, flat ground, unresolved patterns, whiteout and distant cutoff. Existing forest-pattern and shader-filtering checks run too. Paired artwork captures are visual evidence, not device frame-rate measurements.

The paired capture also renders the actual horn/massif material in isolation to report eligibility, pixel visibility, snow/forest coverage and final RGB differences. This catches a procedural effect that changes an encoded normal but remains imperceptible on the real mountain under the current light.
