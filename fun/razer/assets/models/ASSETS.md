# Razer scenery models

These are optimized, locally served photogrammetry assets from [Poly Haven](https://polyhaven.com). Both assets are released under [CC0 1.0](https://polyhaven.com/license), allowing modification and redistribution. The full dedication is in [CC0-1.0.txt](CC0-1.0.txt).

| Runtime file | Original asset | Artists | Triangles | Download size |
| --- | --- | --- | ---: | ---: |
| `boulder.glb` | [Namaqualand Boulder 02](https://polyhaven.com/a/namaqualand_boulder_02) | Greg Zaal, photography; Rico Cilliers, modeling | 1,760 | 674,460 bytes |
| `deadwood.glb` | [Dead Tree Trunk 02](https://polyhaven.com/a/dead_tree_trunk_02) | Jenelle van Heerden, photography; Rico Cilliers, processing | 2,898 | 773,936 bytes |

Total model payload: **1,448,396 bytes**. Each asset has one material and embedded 1024px WebP albedo, normal, and packed roughness textures. No third-party network request is made while playing.

## Preparation

Original 1K glTF downloads and their dependencies were verified against Poly Haven's published MD5 checksums. [manifest.json](manifest.json) records their URLs/checksums and the final GLB SHA-256 hashes.

The assets were processed with glTF Transform 4.5.0: deduplication, flattened transforms, welded vertices, simplification, pruning, WebP compression, and precomputed MikkTSpace tangents. Geometry remains uncompressed glTF 2.0, so no WebAssembly decoder is required. WebP uses the standard `EXT_texture_webp` extension, supported by the bundled Three.js loader.

Reproduction commands, run against downloaded source files:

```sh
npx --yes @gltf-transform/cli@4.5.0 optimize namaqualand_boulder_02_1k.gltf boulder.glb --compress false --texture-compress webp --texture-size 1024 --simplify-ratio 0.018 --simplify-error 0.02 --instance false
npx --yes @gltf-transform/cli@4.5.0 optimize dead_tree_trunk_02_1k.gltf deadwood.glb --compress false --texture-compress webp --texture-size 1024 --simplify-ratio 0.035 --simplify-error 0.018 --instance false
npx --yes @gltf-transform/cli@4.5.0 tangents boulder.glb boulder-with-tangents.glb
npx --yes @gltf-transform/cli@4.5.0 tangents deadwood.glb deadwood-with-tangents.glb
```

The tangent-bearing outputs are shipped under the original `boulder.glb` and `deadwood.glb` names.

`js/scenery-models.js` bakes the loaded node transforms, centers the geometry on X/Z, puts its bottom at Y=0, and normalizes its largest extent to one. A placement's scalar `scale` therefore specifies the model's largest dimension in metres. Instances share all prototype geometry, materials, and textures. Runtime diagnostics include loaded/used model counts, instances per kind, total instance count, instanced draw calls, and prototype triangle counts.

Poly Haven's API was used only during asset preparation; the game ships the CC0 assets and does not depend on or call its live API.
