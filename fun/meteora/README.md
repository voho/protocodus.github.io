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
| Esc | Pause and the key guide; Esc again resumes. The pause screen also sets the sound volume |

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
- Collisions have mass and spin: ramming a drifting fragment shoves it
  (momentum is conserved), a heavy fighter shoves a light interceptor, a
  scrape along a rock spins the ship through friction, fragments knock each
  other aside, and missile blasts push ships and rocks away.
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

## Explosions

- A kill is a white flash and a point light that lights the rocks and hulls
  nearby, a fireball of noise lobes that swell, cool from white through
  orange to dull red and burn out in patches, a shock ring, molten sparks,
  embers, torn hull plates that glow and trail smoke as they tumble away,
  and lit smoke that spreads and thins for seconds.
- Everything inherits the velocity of what blew up: an interceptor killed
  at 200 m/s leaves a fireball that carries on at 200 m/s, so a kill on the
  pass streaks by. Sparks and debris fly dead straight, as nothing in vacuum
  slows them.
- Missiles burst into a smaller fireball and ring. A breaking rock flashes,
  sheds chips of itself and raises a cloud of grey regolith dust; the oldest
  fragments crumble to dust when there are too many. A bolt on rock throws
  grit, on a hull sparks and fire, on a shield a cyan splash and ripple.
- Close blasts shake the camera and briefly raise the exposure, as a camera
  or an eye would be dazzled; with `prefers-reduced-motion` both are halved.
- When the fighter is lost, the camera leaves it and watches the wreck,
  keeping its momentum at first and then falling behind as the burning
  cloud drifts away.

## Sound

Space carries no sound; the cockpit makes it from what the sensors track,
placed in 3D (Web Audio's HRTF panner, best on headphones) around the camera.
Every sound is synthesised at load from oscillators and noise — there are no
audio files.

- **Engine:** a dark drone whose pitch glides with speed — continuously,
  never in steps, and on past the afterburner's speed — under a rumble that
  follows the thrust. The afterburner lights with a whoomp and roars and
  crackles while it burns.
- **Other ships:** the nearest four interceptors within 1.6 km are each a jet
  whine at their position, dulled by distance and bent by doppler (computed
  from the closing speed), so a flyby rises, roars past and drops. Missiles
  hiss in flight.
- **Weapons:** our cannons fire from their muzzles, left and right; enemy
  fire is a rougher buzz wherever the shooter is. Hits sound by what they
  strike — a crack and a rattle of grit on rock, a fizz and a ring on a
  shield, a clang on a hull — and our own hits land close and unplaced.
- **Explosions:** rocks crunch and rattle, warheads and ships boom with a
  sub-bass drop and a tail of debris, a ship with a second blast a beat
  later.
- **Cockpit:** a chirp when the target changes; while a missile locks, beeps
  that quicken as the lock builds, and a steady tone once it holds.

Sound starts with the Launch click, as browsers require; the volume is on
the pause screen and kept in the browser.

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
budgets and anchors, culling, adaptive resolution, the sky's depth layout,
explosions (every layer appears, carries the wreck's momentum, burns out on
time and stays within its pools; smoke and fire are sorted for blending),
the sound bank (every sound audible, unclipped and click-free at both ends;
engine pitch, doppler, distance and the lock tone) and the camera (its shake
never reaches the aim; the death view keeps the wreck ahead of it).

## Performance

- The belt is culled per frame (cells, then rocks; about 0.1 ms) and drawn
  in one call per rock size and detail level — ten calls in all — packed
  nearest cell first, so the depth test rejects hidden rocks before they
  are shaded.
- Each rock switches to its far mesh at 100 of its own radii (the same size
  on screen for a pebble as for a boulder), capped at 2.5 km; landmarks keep
  full detail. That draws 12–37 % fewer triangles than a single 2 km switch
  (spawn 1.53M → 1.02M, densest clump 1.26M → 0.79M).
- Glow sprites are judged against the camera: anything level with the
  camera plane or behind it is dropped, and anything close fades. The chase
  camera sits inside the length of the player's own plume, whose nearest
  sprites used to project to screen-sized quads: measured at 1920×1080 on
  full afterburner, the glow pass now covers 0.07 screens of pixels per
  frame instead of 2.07.
- The pixel ratio adapts to frame time between 0.6 and 1.5, judged against
  the display's own refresh rate.
- The belt's spatial hash is frozen into a flat grid (two typed arrays)
  once the belt is placed, so the enemy pilots' rock-avoidance sweeps walk
  index ranges instead of Map lookups: a 30 s ten-enemy fight takes 30 %
  less CPU (median of seven interleaved runs, 434 → 302 ms; about 84 µs per
  120 Hz step).
- Measured in a browser with `?bench` against `?bench&legacy` (same flight,
  pixel ratio 1.5, a 745×1324 window): GPU time per frame 3.13 → 2.88 ms
  mean and 4.20 → 3.80 ms at the 95th percentile, triangles 0.35M → 0.24M;
  both held 60 fps, so on that machine the gain is headroom rather than
  frames. The bench flight does not use the afterburner, so the glow fix is
  not part of that comparison.
- Explosions add five draw calls whatever is burning (smoke, fireball lobes,
  shock rings, hull shards, rock chips); a fireball lobe is two triangles
  with the ball traced per pixel. Their CPU work in Node averages 0.44 ms a
  frame (p95 0.75 ms) for a busy fight — a kill every three seconds, a rock
  breaking every two, a hit every fifth frame — and about 1.6 ms (p95 about
  2.5 ms) for the bench's `blasts` load, a kill every half second with every
  pool full.
  The two explosion lights are always in the scene, at zero when idle,
  because adding a light recompiles every lit material.
- The sound bank, about 30 s of audio, is synthesised during loading in
  6 ms slices between frames: about half a second of work in all, the
  sounds a fight needs first coming first.
- `node tools/bench.mjs` measures the simulation, the per-frame effects work,
  explosions under load and culling in Node. `?debug` shows frame time,
  draw calls, triangles, rocks drawn, live effects and the pixel ratio in
  the browser; `?debug&autopilot` flies a scripted pattern (silently: sound
  waits for a click).

The design and the implementation plan are in `docs/`.
