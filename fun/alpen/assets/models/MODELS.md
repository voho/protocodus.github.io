# Alpen imported model sources

## nature/

Quaternius low-poly nature set (winter variants) — CC0 / public domain,
by Quaternius (https://quaternius.com), downloaded 2026-08-07 from the
MIT-licensed mirror https://github.com/flo-bit/tiny-planets
(`public/lowpoly_nature/`). glTF 2.0 with embedded buffers, exported by
FBX2glTF.

At runtime these are re-baked into the instanced prop pipeline by
`js/importedModels.js`: geometry merged, owned surfaces converted to
value-greys so the per-instance stand cast colours them, snow surfaces
routed into the scene's snow tint, rocks baked into the terrain's slate
and iron palettes. The procedural growers remain the fallback whenever a
file fails to load.

## Vendored loaders

`assets/vendor/GLTFLoader.js`, `assets/utils/BufferGeometryUtils.js` and
`assets/utils/SkeletonUtils.js` are from three.js r185
(https://github.com/mrdoob/three.js, MIT), matching the vendored three
build at the repository root.
