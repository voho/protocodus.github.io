# Tyran visual assets

## `hero.jpg`

Original Tyran title artwork generated with the built-in ImageGen tool on 2026-09-15. Exported as a 1672 × 941 JPEG for the title screen and social preview. The runtime environments and ships are drawn independently by the game renderer.

### Generation prompt

Use case: stylized-concept. Asset type: original cinematic title-screen artwork for TYRAN, a beautiful top-down scrolling science fiction shooter. Primary request: A beautiful sleek small ivory and gunmetal fighter with turquoise luminous cockpit and powerful orange exhaust, flying north above a lush alien jungle canyon. Rich layered terrain, fern forests, immense palm trees, a winding brilliant turquoise river, mysterious ruined geometric structures with lights, atmospheric clouds. Two much smaller enemy fighters and a distant orange explosion. Premium retro arcade spirit rendered as luxurious highly detailed modern concept art, painterly but believable mechanical detail. Composition: wide 16:9 landscape; oblique top-down view; main fighter occupies center-right at about 66% across and 48% down, nose points up and slightly right; majestic deep jungle recedes below. Left 40% contains dark, softer forest and shadow for a text overlay. Lighting: gorgeous cinematic teal mist, amber sunlight from upper right, bright cool engine lighting, contrasting orange sparks. Emerald, turquoise, desaturated jade, warm stone, orange. Avoid text, logos, UI, frames, watermark, close-up humans, readable lettering, starry outer space. This is illustrative title artwork for a top-down arcade shooter. Beautiful crisp details and restrained bloom.

## Terrain paintings

Ten original 1024 × 1536 orthographic terrain paintings were generated with the built-in ImageGen tool on 2026-09-15 and exported as WebP at quality 88. Exact prompts, generation method, and original source paths are recorded in [world-prompts.json](./world-prompts.json). These are archived concepts; the runtime and visual tests do not load them. Gameplay uses the generated sprite library below.

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

`terrain-sprites.js` generates 100 × 100 logical-pixel material sprites at double resolution. Each biome has four materials with six variants each, plus matching corner masks for banks and cliffs. `tile-map.js` generates connected terrain cells from the level hash. `worlds.js` assembles those cells into cached 800-pixel strips and places reusable scenery sprites from the same hash. The previous six-slice painting tiles have been removed.

Five planes provide depth: water or space, tile ground, rocks and ground vehicles, trees and tall vegetation, then high structures and clouds. One extra cell beyond each horizontal edge covers the camera's 1% lateral drift. Terrain and ground vehicles use subdued biome materials; saturated complementary colors are reserved for airborne fleets.

## Ship sprite variants

Ship hulls are code-native artwork rasterized into reusable sprites. Each hull is prewarmed into three cached roll frames (`tilt -1`, `level`, `tilt +1`); the wings narrow and shift in height while the nose heading stays fixed. Exhaust, shadow, damage flashes and bloom share the same roll projection. Industrial crawlers and haulers have tracked ground silhouettes, muted armor and no flight exhaust.

## Fonts

The interface uses the repository's existing self-hosted Space Grotesk and Oxanium fonts. No third-party font request is made.
