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

## Realistic sprite atlases

Seven original PNG atlases were generated with the built-in ImageGen tool on 2026-09-19. The 113 usable cells replace the previous procedural artwork. The original generated PNGs are copied unchanged into `sprites/`; exact prompts, source paths, cell names and layouts are recorded in [sprites/prompts.json](./sprites/prompts.json).

| Atlas | Layout | Contents |
| --- | --- | --- |
| `sprites/fleet.png` | 4 × 3 | Ivory player, ten enemy hulls, one empty cell |
| `sprites/nature.png` | 4 × 4 | Plants, rocks, ice, crystals, coral, cloud |
| `sprites/structures.png` | 4 × 4 | Buildings, ruins, facilities, satellite, crawler, hauler |
| `sprites/materials.png` | 8 × 5 | Four tile materials for each of ten environments |
| `sprites/effects.png` | 4 × 4 | Eight explosion frames, smoke, fragments, scorches, two thrusters |
| `sprites/projectiles.png` | 4 × 3 | Six weapon profiles and six enemy projectile silhouettes |
| `sprites/pickups.png` | 2 × 1 | Repair capsule and salvage credits |

`sprite-assets.js` decodes the library before flight preparation and retains reusable alpha-trimmed cells. Connected hull/structure components keep wings and antennas intact where generated objects cross nominal grid boundaries. Color grading, shadows and sprite variants are baked into caches; combat drawing does not recolor pixels. Procedural art remains a fallback if an atlas cannot load.

## Terrain tile library

`terrain-sprites.js` bakes the generated material cells into 100 × 100 logical-pixel tiles at double resolution. Each biome has four materials with six orientations each, plus matching corner masks for banks and cliffs. Material luminosity preserves the generated surface detail; the original terrain palette supplies its hue. Common edge tones join adjacent tiles. `tile-map.js` generates connected terrain cells from the level hash. `worlds.js` assembles those cells into cached 800-pixel strips and places reusable scenery sprites from the same hash.

Five planes provide depth: water or space, tile ground, rocks and ground vehicles, trees and tall vegetation, then high structures and clouds. One extra cell beyond each horizontal edge covers the camera's 1% lateral drift. Terrain and ground vehicles use subdued biome materials; saturated complementary colors are reserved for airborne fleets.

## Ship sprite variants

Ship hulls use the generated fleet atlas, with weathered armor, recessed machinery and metallic lighting. Red armor and gold trim are mapped to each existing complementary fleet palette, while neutral metal and ivory player armor retain their shading. Each hull is prewarmed into three cached roll frames (`tilt -1`, `level`, `tilt +1`); the wings narrow and shift in height while the nose heading stays fixed. Exhaust, alpha-derived shadows, damage flashes and bloom share the same roll projection. Industrial crawlers and haulers have tracked/wheeled ground silhouettes, muted armor and no flight exhaust.

## Fonts

The interface uses the repository's existing self-hosted Space Grotesk and Oxanium fonts. No third-party font request is made.
