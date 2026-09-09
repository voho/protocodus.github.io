# Razer surface materials

Created with the built-in image generation tool on 2026-09-09. These are original generated images, not third-party photographs or measured material scans.

| Material | Color | Tangent normal | Roughness |
| --- | --- | --- | --- |
| Asphalt | `asphalt-albedo.webp` | `asphalt-normal.webp` | `asphalt-roughness.webp` |
| Gravel | `gravel-albedo.webp` | `gravel-normal.webp` | `gravel-roughness.webp` |
| Dirt | `dirt-albedo.webp` | `dirt-normal.webp` | `dirt-roughness.webp` |
| Sand | `sand-albedo.webp` | `sand-normal.webp` | `sand-roughness.webp` |

Color maps are 1024×1024 WebP at quality 90. Data maps are 512×512 lossless WebP. All twelve assets total approximately 4.1 MiB. Color maps use sRGB; data maps use no color-space conversion. No remote asset service is needed during play.

Normal maps estimate height from perceptual luminance, apply a periodic binomial filter, and encode normalized central derivatives in tangent space. Roughness varies with luminance and local grain. This is an artistic approximation; dark minerals do not necessarily correspond to physical depressions. The derivation lives in `../../js/textures.js`, which also provides a local procedural fallback. Both maps were baked before shipping, then reduced from 1024 to 512 pixels for browser use.

## Generation prompts

Each prompt used this common framing, replacing `[material]` with the corresponding text below:

> Use case: photorealistic-natural. Asset type: physically based 3D racing game seamless square albedo texture, 1024x1024. Create only [material]. Perfect orthographic overhead view of about 3m square patch, material fills every pixel edge-to-edge. Photorealistic scanned material quality, fine microtexture and subtle large-scale natural variation, neutral flat diffuse lighting, no cast shadows, no directional lighting, no specular reflections, no perspective/depth of field. Seamless tileable edges, no objects, text, labels, border, watermark, tire tracks, leaves, road markings. Single square material image, not presentation/contact sheet.

- Asphalt: weathered dark grey asphalt road, fine 3 to 8 millimeter aggregate, tiny muted mineral flecks, subtle irregular tar wear, no painted markings or large cracks.
- Gravel: compacted grey beige rally-road gravel, angular 3 to 15 millimeter stones embedded in grey dusty earth, dense natural aggregate, slight darker tire-compacted variations, no tire lines.
- Dirt: dry brown compacted earth rally road, reddish umber loam, finely crushed small pebbles, subtle crumbly soil structure and faint compacted irregularities, no grass.
- Sand: pale warm beige packed sandy rally road, fine grains, tiny scattered mineral stones, slight shallow irregular wind ripples at small scale, not dunes.

The tool returned 1254×1254 PNG masters. Runtime copies were resized and encoded with `cwebp`; original generated masters remain in the session's generated-image output directory.
