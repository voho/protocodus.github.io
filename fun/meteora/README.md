# Meteora

A 3D space shooter in a seeded asteroid belt. Fly a heavy fighter with real
momentum, break rocks apart and outfight endless waves of interceptors.
[Play it](index.html) — no installation, no account.

## Controls

| Input | Action |
|---|---|
| Mouse | Aim: the ship turns toward the crosshair, harder the farther it is from the centre |
| Left click | Cannons |
| Right click | Missile (homes on a locked target) |
| W / S | Speed up / slow down |
| Q / E | Roll (a tap is gentle, a held key rolls fully) |
| Tab | Afterburner (hold) |
| T | Cycle targets, nearest the crosshair first |
| Z | Lock your speed to the target's; W or S hands the throttle back |
| Esc | Pause and the key guide; Esc again resumes |

The game asks for pointer lock on the first click. When the browser grants
it, the mouse moves the crosshair; when it does not, the crosshair simply
follows the pointer. Either way the game flies, and pausing always gives the
mouse back.

## Flying

The physics has no drag and no speed limit: a ship has a position, a
velocity, an orientation and a spin, and only thrusters change them.
Flight assist sits on top, using those same thrusters to hold the speed you
set. The lateral thrusters push at half the main engine's force, so turning
the nose at speed leaves the old velocity sideways for a few seconds — the
ship slides. The blue velocity marker on the HUD shows where you are really
going; the small chevron shows where the nose points.

The afterburner adds a 12 g sprint for up to four seconds of energy, which
refills after a short pause. The speed lock can hold any speed up to the
afterburner's (enemies cruise faster than your full throttle) without
spending that energy.

## Fighting

- The cannons swing up to 10° off the nose toward the crosshair and both
  guns converge on the point under it. Bolts keep the ship's own velocity.
  Holding the trigger builds heat; at the limit the guns lock until they
  have cooled to 40 %.
- T selects a target. It is framed in red with its distance and closing
  speed, and a red arrow on the screen edge points to it when it is off
  screen. The red diamond is where to aim so the bolts and the enemy arrive
  together; put the crosshair on it and fire. ON TARGET confirms the aim.
- Missiles lock on a target held in front of the nose for under a second and
  steer by proportional navigation. Six are carried; one rearms every eight
  seconds.
- Enemies come in waves of three, then one more each wave up to ten. They
  fly the same physics as you, fire in bursts only when the shot would land,
  break off and come round again, jink when hit or locked, and steer around
  the rocks.
- The shield absorbs damage first and recharges after three quiet seconds;
  the hull does not. Ramming a rock faster than 8 m/s costs hull. Kills score
  100 × the wave; broken rocks score 10, 25 or 50 by size. The best score is
  kept in the browser.

## The world

- The belt is a seeded slab of about 8 × 2 × 8 km: twenty-one thousand rocks
  in five sizes plus six kilometre-scale landmarks, clumped by a noise field
  into lanes and voids. The three smaller sizes break apart into drifting
  fragments.
- The sky is generated at load: the Milky Way with dust lanes, faint stars
  coloured by temperature, five nebulae and galaxies from an Andromeda-like
  spiral to about 150 tiny distant ones, under two star layers and two faint
  nebula veils that drift very slowly. A ringed gas giant hangs 44 km out.
- Engine flames follow speed — a blue glow at rest, a long plume at cruise,
  fire tongues at pace, white-hot shock diamonds on the afterburner.

## Models

Every model is built by Blender scripts in `tools/blender/` and committed as
`.glb` with baked WebP textures; `assets/models/MODELS.md` lists triangle
counts, sizes and anchor conventions. To rebuild them all (about three
minutes; it needs the GPU, so run it outside a sandbox):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_all.py
```

The ship build also writes `js/anchors.js` — muzzles, nozzles, attitude
thrusters and the cockpit eye point, exported from named empties.

## Code and checks

The simulation (`flight`, `field`, `weapons`, `ai`, `combat`, `world`,
`controls`, `shake`, `cull`, `resolution`) imports nothing from three.js and
runs in Node. Run the checks from `fun/meteora`:

```sh
for f in tests/*-check.mjs; do node "$f" || break; done
```

They cover the flight model and flight assist, belt generation and
collision queries, swept projectiles and missile guidance, enemy pilots in a
dense cell, combat rules and the fixed-step world, input and pointer lock in
Chrome's and Safari's behaviours, the key guide against the bindings, model
budgets and anchors, culling, adaptive resolution and the sky's depth
layout.

## Performance

- The belt is culled per frame (cells, then rocks; about 0.15 ms) and drawn
  in one call per rock size and detail level — ten calls in all.
- The pixel ratio adapts to frame time between 0.6 and 1.5, judged against
  the display's own refresh rate.
- The simulation runs at 120 Hz; a ten-enemy fight averages under 0.1 ms per
  step.
- `?debug` shows frame time, draw calls, triangles, rocks drawn and the pixel
  ratio. `?debug&autopilot` flies a scripted pattern.

The design and the implementation plan are in `docs/`.
