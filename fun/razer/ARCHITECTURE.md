# Razer module contract

Static ES modules with a Three.js import map to `/assets/vendor/three/three.module.min.js`. World units are metres. Y is up, X/Z is the ground plane, and car forward is local +Z. Yaw is `atan2(dx,dz)`. Six cars race three laps.

## track.js

Exports `generateTrack(seed, environment = 'auto')`, `createRandom(seed)`, `ENVIRONMENTS`.

A track exposes `seed`, `hash`, `environment`, `name`, `width`, `length`, `elevationGain`, `points`, `routes`, `boosts`, `decorations`, `bounds`, `river` and pure spatial queries:

- `heightAt(x,z)`: terrain/road elevation, with continuous hills, carved river banks and off-road microrelief.
- `nearest(x,z)`: nearest main or alternate road projection, returning `x,y,z,distance,progress,tangent,routeId,width`. Distance is horizontal, measured from the road centreline.
- `sample(progress, routeId = 'main')`: position and tangent at normalized MAIN-circuit progress. Alternate points map monotonically to their corresponding main-road interval.
- `surfaceAt(progress, routeId)`: asphalt, gravel, dirt or sand.
- `terrainAt(x,z)`: off-road `surface`, `forest` density and `moisture`.
- `riverAt(x,z)`: nearest river sample including `distance`, `width` and water height, or null.

The closed main point list excludes the duplicate endpoint. Alternate records include `id,points,start,end,length,mainLength`; the generator numerically matches actual 3D length within 0.5%. Scenery records use `type,x,y,z,scale,rotation,radius`; radius zero means noncollidable. Roads and water receive decoration clearance. Sharing uses the original seed and environment choice; hash is only a fingerprint. Determinism is scoped to this generator version.

The physical road height remains flat across each cross-section through the full visible shoulder, 8.4 metres from the centreline, before blending into surrounding hills or river banks.

## simulation.js

`await createSimulation(track)` owns the local Rapier world and race state. Interface: `step(dt,input)`, `reset()`, `recover(carId?,reason?)`, `dispose()`. The application supplies a fixed 1/60-second step; the simulation rejects oversized time jumps.

Input is `{throttle:0..1,brake:0..1,steer:-1..1,drift:boolean}`. Positive steer increases yaw. From the trailing camera this turns left: keyboard A/Left and touch-left map to +1; D/Right map to -1. Gamepad horizontal input is inverted to match.

`sim` exposes `cars`, `player`, `time`, `finished`, `position`, `laps`, `pickups`, `events`, `world`. Each car has pose/velocity (`x,y,z,yaw,pitch,roll,vx,vy,vz,speed`), surface/contact state (`surface,traction,offRoad,inWater,airborne,groundedWheels,suspension,wheels`) and race state (`boost,lap,progress,totalProgress,routeId,finished,finishTime,lapTimes`). Visual `y` is the wheel plane; the chassis body origin includes ride height.

Each wheel stores an identity, world contact position, contact flag, normal load, compression, surface, traction, steer angle, slip, longitudinal force and lateral force. Four spring/damper terrain probes act at separate wheel positions. Tire forces act at the contact points; front wheels steer and all four drive. Rapier integrates all three translation and rotation axes. Yaw assistance, angular damping, tipping assistance, a deep-penetration bump stop and recovery retain arcade playability.

Steering rack angle is limited by available lateral acceleration divided by speed squared. The yaw assist uses that same rack target and surface/impact grip budget, rather than commanding a fixed turn rate beyond the tires' capacity. Front/rear cornering stiffness stabilizes normal turns, with rear slip reserved for the handbrake. Pitch and roll stabilization torques follow chassis-local axes, and airborne tires provide no yaw assistance. Grip recovery scales with relative collision intensity.

Car/car and car/prop collisions use physical momentum and scenery colliders at actual elevation. Collision events use relative closing speed; brief grip recovery preserves impact displacement. Ordered checkpoints and minimum road travel validate laps and recovery. A car more than 30 metres beyond any road edge resets automatically. Water resistance, submersion recovery and rollover recovery are separate conditions.

Events include `boost`, `lap`, `finish`, `collision`, `land` and `recover`, with `carId` and event-specific details. Collision and landing include normalized `intensity`; recovery may include `reason`. The application drains events each frame. All AI cars share these dynamics, surface-aware corner braking and alternate routes.

## render.js / camera.js

`await createRenderer(canvas,track,onProgress)` prepares textures, world geometry, local models, shadow maps and compiled materials before resolving. Interface: `render(dt,sim,{mode,time,camera})`, `resize()`, `dispose()`. Modes are preview/race/paused/finished; cameras follow/wide. The render side does not advance physics.

Terrain uses a dense grid, continuous distant hills, surface colors and normal/roughness maps. A dedicated world-space atlas with a second UV channel bakes terrain crease and prop contact occlusion. The sun's shadow map also bakes once. Current environments are daylight, so vehicle lamps create no lights or shadow passes. Cars use moving contact shadows, with opacity reduced while airborne.

The visible chassis uses the rigid body's orientation and a rotated local ride-height offset. There is no extra cosmetic steering lean or speed bob. Wheel placement samples ground at each visible tire, and the small road-surface offset fades continuously at the shoulder; crossing the road edge cannot abruptly drop the model.

The six-face procedural cloud skybox also provides environment reflections. Rivers use directional normal flow, animated vertex waves and shore foam; the coastal ocean shares the surface treatment. This is a visual surface model, not volumetric fluid dynamics. Fixed-size dust and skid pools avoid unbounded allocations.

`createChaseCamera(track)` exposes `reset(car,wide)` and `step(dt,car,wide)`, returning persistent position/target/yaw state. A 120 ms heading history plus exponential smoothing follows the car from behind, wraps angles continuously, compensates for terrain occlusion and snaps after recovery teleports. Paused calls with zero dt preserve the view.

`view.renderer`, `scene`, `camera`, `diagnostics`, `textureAssets` and `terrainShadowTexture` support development inspection. Resource registries dispose geometry, materials, texture maps, shadow targets and imported model resources when regenerating.

## car-model.js / scenery-models.js / textures.js

The car factory builds shared high-detail rally meshes, merges static body details into material batches, and retains separate wheel pivots for steer/spin/suspension. Physics pose drives the chassis and contact data drives individual wheels.

The scenery loader prepares local optimized CC0 glTF models and reuses their geometry/materials through instancing. Procedural scenery remains available as fallback. Source and license records live in `assets/models/ASSETS.md` and `manifest.json`.

The road texture loader reads local generated albedo plus prebaked normal/roughness WebP maps. Albedo is sRGB; data maps are linear. If any assets fail, deterministic local materials and wrapped albedo-derived relief provide a playable fallback. Image-generation prompts and map preparation are in `assets/textures/ASSETS.md`.

## audio.js / input.js / main.js

`createEngineState()` produces bounded RPM, six-gear telemetry, shift/load state and lift-off events. `createAudio()` constructs a four-cylinder combustion buffer, exhaust/intake filters, turbo and surface/slip/wind layers. `update(car,active,throttle,dt)` drives their parameters; `cue(type,intensity)` creates short race/impact sounds. The graph is reused across races, fades when inactive, and activates only after user interaction. HUD gear/RPM use the same audio telemetry.

Input retains keyboard, simultaneous touch and gamepad state, clears on focus/visibility loss, and preserves controller button edges across menus and pause. `main.js` owns staged loading, seed/environment URLs, the fixed-step accumulator, mode changes, sound, minimap, HUD and local best times. `?debug=1` exposes inspection objects; production UI remains uncluttered.
