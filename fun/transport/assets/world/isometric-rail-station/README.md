# Small railway station

Generated with the built-in image generator using the shared `buildingGenerationPrompt()` style, camera and physical scale. The ticket hall, broad roof, platform canopy and signal distinguish the rail stop from the road shelter. Gameplay reserves one tile; the artwork represents a 16 m parcel at the common 48-world-pixel building scale. A transparent padded 64-pixel runtime frame permits native 32/64/128-pixel images at Region/Town/Detail; padding adds no physical size to the station.

`generation-job.json` records the canonical job, `generation-prompt.json` records the first generation and `refinement-prompt.json` records the camera/scale correction. The first-pass source and `camera-scale-guide.png` are retained because that correction used them as references. `source-generated.png` is the final untouched output.

`registration.json` records the lossless translation of the untouched 1254-pixel source into a 1672-pixel transparent square: 209 source pixels right and 474 down, with no source resizing. The original 48-pixel parcel scale remains fixed inside the padded 64-pixel frame. Do not fit or enlarge the silhouette to that frame. The measured door is 4.29 world pixels against the shared 4.2-pixel target. Runtime bounds are left −32, top −60, size 64; the platform contact at 250/256 of the frame matches the road stop at +2.5 world pixels. This registered contact intentionally differs from the generation guide's preliminary anchor.

Rebuild the 16–256-pixel runtime atlases from `fun/transport`:

```sh
python3 tools/build-world-atlases.py \
  --atlas assets/world/isometric-rail-station/source-registered.png \
  --columns 1 --rows 1 --ids train-stop \
  --output-dir assets/world/isometric-rail-station \
  --aligned --preserve-grid-scale --max-cell 256 --no-sharpen
```

`isometric-infrastructure.js` uses the same `isometric:train-stop` identity for world sprites, build menus, inspectors and Gallery portraits. `rail-station-art.js` supplies the matching native fallback. The established road, harbor and portal atlases remain in their existing directories.
