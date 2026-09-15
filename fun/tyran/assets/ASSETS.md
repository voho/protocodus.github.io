# Tyran visual assets

## `hero.jpg`

Original Tyran title artwork generated with the built-in ImageGen tool on 2026-09-15. Exported as a 1672 × 941 JPEG for the title screen and social preview. The runtime environments and ships are drawn independently by the game renderer.

### Generation prompt

Use case: stylized-concept. Asset type: original cinematic title-screen artwork for TYRAN, a beautiful top-down scrolling science fiction shooter. Primary request: A beautiful sleek small ivory and gunmetal fighter with turquoise luminous cockpit and powerful orange exhaust, flying north above a lush alien jungle canyon. Rich layered terrain, fern forests, immense palm trees, a winding brilliant turquoise river, mysterious ruined geometric structures with lights, atmospheric clouds. Two much smaller enemy fighters and a distant orange explosion. Premium retro arcade spirit rendered as luxurious highly detailed modern concept art, painterly but believable mechanical detail. Composition: wide 16:9 landscape; oblique top-down view; main fighter occupies center-right at about 66% across and 48% down, nose points up and slightly right; majestic deep jungle recedes below. Left 40% contains dark, softer forest and shadow for a text overlay. Lighting: gorgeous cinematic teal mist, amber sunlight from upper right, bright cool engine lighting, contrasting orange sparks. Emerald, turquoise, desaturated jade, warm stone, orange. Avoid text, logos, UI, frames, watermark, close-up humans, readable lettering, starry outer space. This is illustrative title artwork for a top-down arcade shooter. Beautiful crisp details and restrained bloom.

## Terrain paintings

Ten original 1024 × 1536 orthographic terrain paintings were generated with the built-in ImageGen tool on 2026-09-15 and exported as WebP at quality 88. Exact prompts, generation method, and original source paths are recorded in [world-prompts.json](./world-prompts.json). Original PNG files remain preserved in the generation directory. The source paintings stay in the repository for provenance; the runtime loads the tiled library below instead of one tall background image. The renderer adds destructible scenery, layered clouds, particles, and moving light over these backgrounds; procedural terrain remains available while artwork loads.

- `world-jungle.webp` — Emerald Frontier
- `world-snow.webp` — Polar Silence
- `world-desert.webp` — Sunken Empire
- `world-paradise.webp` — Azure Archipelago
- `world-asteroid.webp` — Shattered Orbit
- `world-mars.webp` — Red Horizon
- `world-volcanic.webp` — Inferno Foundry
- `world-neon.webp` — Neon Afterlife
- `world-alien.webp` — Luminous Garden
- `world-void.webp` — Obsidian Citadel

## Terrain tile library

`terrain-tiles/<world>/tile-00.webp` through `tile-05.webp` are the production runtime assets. Each world has six sharpened 600 × 512 tiles (two columns by three rows) cut from its orthographic painting. The renderer assembles two rows of tiles into 1200 × 1024 chunks, caches those chunks independently, and shifts the complete strip by a 1% X-axis bleed as the pilot moves. This keeps the flight surface crisp, streamable, and free of a single-image draw path.

The three higher scenery caches sit above the tile ground: rocks and shrubs, trees and tall vegetation, then structures and high silhouettes. Clouds are rendered as the fifth foreground plane.

## Ship sprite variants

Ship hulls remain procedural so every palette can share one crisp renderer. Each hull is prewarmed into three cached Canvas sprites (`tilt -1`, `level`, `tilt +1`); flight only swaps those variants while the nose heading stays fixed. Exhaust, shadow and bloom are drawn in the same pass for a readable silhouette at speed.

## Fonts

The interface uses the repository's existing self-hosted Space Grotesk and Oxanium fonts. No third-party font request is made.
