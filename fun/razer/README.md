# Razer

A standalone 3D browser rally racer at `/fun/razer/`: six cars, three laps, four environments, and a seeded circuit prepared before racing. No build step or runtime CDN requests.

## Play locally

From the repository root:

```sh
python3 -m http.server 8088 --bind 127.0.0.1
```

Open <http://127.0.0.1:8088/fun/razer/>. Requires WebGL 2. Links are also on the home and games pages.

| Control | Action |
| --- | --- |
| W / Up | Accelerate |
| S / Down | Brake, then reverse |
| A / Left | Turn left |
| D / Right | Turn right |
| Space | Handbrake drift |
| R / Reset | Recover to validated road progress |
| Esc / P | Pause or resume |
| C / View | Change chase-camera distance |
| M / Audio | Toggle sound |
| Gamepad | Left stick steering; RT/A accelerate; LT/B brake; X drift; Y recover; Start menu/pause |

Phones have simultaneous touch controls. The race pauses on focus loss or when hidden. Best times and sound preference are stored locally. URLs preserve the seed and environment, e.g. `#seed=DUST-86&env=auto`. The eight-character circuit hash is a fingerprint, not a replacement seed.

## Driving

The normal asphalt top speed is 250 km/h. Five-second boosts permit 310 km/h; gravel, dirt, sand and off-road terrain reduce grip and speed. Each of the four wheels samples its own terrain and surface, computes suspension compression, damping, normal load and tire slip, and applies drive, braking and lateral forces at its contact point. Front wheels steer, all four drive, and the handbrake releases rear grip. Rapier integrates chassis translation and rotation, with physical pitch, roll, jumping and landing.

This remains an assisted rally game: yaw assistance, angular damping, bump stops and rollover recovery keep the handling playable. High-speed impacts transfer more momentum; brief grip recovery lets a struck car retain the shove. Leaving the nearest main or alternate road edge by more than 30 metres resets the car to validated progress. Water applies strong resistance and automatically recovers submerged cars.

Steering angle and yaw assistance share a speed- and surface-dependent cornering limit, so normal steering turns the car's momentum along with its body. Front and rear tire stiffness give stable grip without requiring the handbrake; deliberate handbrake turns loosen the rear tires. Minor bumper contacts cause proportionally smaller grip changes than major impacts.

The camera stays behind the car, delays heading changes by 120 ms, then smooths rotation and position. It lifts over terrain crests and resets cleanly after recovery.

## Generated worlds

1. Build a smooth closed main circuit, choose desert/jungle/beach/mountains, and add hills, grades and banked surroundings.
2. Solve two alternate roads to match their main-road segments' actual 3D length. They offer different corner shapes rather than a distance advantage.
3. Add mixed road surfaces, five-second speed pads, rivers, broad hills, terrain microrelief, forests, clearings, shrubs, grasses, reeds, stones and buildings.
4. Load local material maps and optimized scenery models. Prepare a cloud skybox, terrain geometry, road meshes and instanced scenery.
5. Bake ground contact/crease occlusion into a dedicated terrain atlas and render the static sun shadow map. Compile materials and initialize physics before unlocking Start race.

Water uses animated surface waves, flowing normals, sky reflections and shore foam. Immersion and water drag affect vehicles; this is a surface simulation, not a volumetric fluid solver. Current worlds are daylight: there are no vehicle light sources or headlight shadow passes. Sunlight, sky reflections, cached shadows and emissive brake/boost feedback remain.

AI uses the same vehicle dynamics and takes alternate roads. Sixteen ordered sectors and minimum road travel prevent skipped sections from awarding laps. The first start-line crossing begins lap one. Boosts are shared and respawn after eight seconds. Results show the field's order at the player's finish; drivers still racing show their current lap.

## Runtime and assets

- Three.js: repository vendor build in `/assets/vendor/three/`; local matching glTF loader dependencies.
- Rapier: pinned `@dimforge/rapier3d-compat` 0.20.0, embedded WASM ESM and Apache-2.0 license in `assets/vendor/rapier/`.
- Detailed bespoke rally cars: merged body panels, glass, interior, roll cage, wheels, tire tread, lamps and weathered liveries.
- Generated asphalt, gravel, dirt and sand color maps with baked normal/roughness maps: [material prompts and preparation](assets/textures/ASSETS.md).
- CC0 Poly Haven photogrammetry boulder and deadwood models: [sources, artists, licenses and optimization](assets/models/ASSETS.md).
- Web Audio: synthesized four-cylinder combustion pulses, load-sensitive exhaust/intake, six automatic gears, shift cuts, lift-off burbles, turbo, tire slip, surface noise and wind. Sound starts with the first player gesture.
- Static shadows and terrain occlusion bake once per world. Instanced scenery, shared model resources, merged car details, 140 dust particles and 420 skid segments keep rendering bounded.

## Verification

```sh
npm test --prefix fun/razer
node tests/navigation-check.mjs
node tests/background-check.mjs
```

Automated checks cover deterministic world generation, road topology, equal-length routes, grade and scenery constraints; vehicle and race mechanics; keyboard/touch/controller input; delayed camera behavior; and engine RPM/gearing. Physics regressions include full AI races across seeds and environments.

`tests/handling-check.mjs` also checks moderate turns, short keyboard taps through 180 km/h, sustained steering, release recovery, deliberate drifting and suspension contact on rolling roads. Add `--report` to print the measured slip, lane movement, yaw rate and wheel loads.

Browser QA exercises desktop and 390px/320px layouts, all four environment regeneration paths, preparation gating, real keyboard/touch driving, pause/resume, recovery, results and replay. Audio is also rendered through OfflineAudioContext to check finite output, level changes and headroom. Screenshots are inspected for model scale, road layering, ground shadows, sky/water, camera framing and HUD overlap.

Append `?debug=1` for `window.razerDebug.snapshot()` and access to the simulation/render objects. Debug controls are not exposed in the player UI.
