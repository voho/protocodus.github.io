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

The seven base PNG atlases were generated with the built-in ImageGen tool on 2026-09-19. Three destruction sheets and ten sector fleet sheets bring the active library to 20 atlases. The retired left/right banking sheets have been removed; every ship uses one fixed hull. The original generated PNGs are copied unchanged into `sprites/`; [sprites/prompts.json](./sprites/prompts.json) records the exact prompts, sources, cell names and layouts. A failed specialized sheet uses the common fleet or procedural fallback.

The runtime loads matching `.webp` files exported with `cwebp -lossless -exact -m 6`. Every export was verified against its original PNG for identical decoded RGBA pixels and dimensions. This reduces the complete library from 35.3 MB to 25.8 MB (27.0%) without changing its artwork. PNGs remain the editable source inventory listed below.

| Atlas | Layout | Contents |
| --- | --- | --- |
| `sprites/fleet.png` | 4 × 3 | Ivory player, ten enemy hulls, one empty cell |
| `sprites/nature.png` | 4 × 4 | Plants, rocks, ice, crystals, coral, cloud |
| `sprites/structures.png` | 4 × 4 | Buildings, ruins, facilities, satellite, crawler, hauler |
| `sprites/materials.png` | 8 × 5 | Four tile materials for each of ten environments |
| `sprites/effects.png` | 4 × 4 | Eight explosion frames, smoke, fragments, scorches, two thrusters |
| `sprites/projectiles.png` | 4 × 3 | Six weapon profiles and six enemy projectile silhouettes |
| `sprites/pickups.png` | 2 × 1 | Repair capsule and salvage credits |
| `sprites/structure-light.png` | 4 × 4 | Light damage matching all 16 structure/vehicle cells |
| `sprites/structure-heavy.png` | 4 × 4 | Heavy damage matching all 16 structure/vehicle cells |
| `sprites/structure-crater.png` | 4 × 4 | Craters and wreckage matching all 16 structure/vehicle cells |

Each sector fleet sheet uses a 4 × 3 layout. Cell 0 is an unused player reference, cells 1–10 contain the nine enemy classes and guardian, and cell 11 is empty. Enemy class order matches `fleet.png`; each family supplies its own hull designs.

| Sector | Fleet family | Atlas |
| --- | --- | --- |
| Jungle | Scarlet Talons | `sprites/fleet-jungle.png` |
| Snow | Halo Syndicate | `sprites/fleet-snow.png` |
| Desert | Relic Array | `sprites/fleet-desert.png` |
| Paradise | Sunwake Raiders | `sprites/fleet-paradise.png` |
| Asteroid belt | Scrap Convoy | `sprites/fleet-asteroid.png` |
| Mars | Redline Foundry | `sprites/fleet-mars.png` |
| Volcanic | Cryo Lances | `sprites/fleet-volcanic.png` |
| Neon | Circuit Runners | `sprites/fleet-neon.png` |
| Alien | Spore Covenant | `sprites/fleet-alien.png` |
| Void | Aurum Cathedral | `sprites/fleet-void.png` |

`sprite-assets.js` decodes the library before flight preparation and retains reusable alpha-trimmed cells. Connected hull/structure components keep wings and antennas intact where generated objects cross nominal grid boundaries. Color grading, shadows and sprite variants are baked into caches; combat drawing does not recolor pixels. Procedural art remains a fallback if an atlas cannot load.

## Terrain tile library

`terrain-sprites.js` bakes the generated material cells into 100 × 100 logical-pixel tiles at double resolution. Each biome has four materials with six orientations each, plus matching irregular corner masks for banks and cliffs. Shared crossings and tangents keep all six contour variants connected. Broken rims, layered ledge shadows, fissures and low mounds add visual depth; material crops vary to soften repetition. Material luminosity preserves the generated surface detail; the original terrain palette supplies its hue. Common edge tones join adjacent tiles. `tile-map.js` generates connected terrain cells from the level hash. `worlds.js` assembles those cells into cached 800-pixel strips and places reusable scenery sprites from the same hash. A separate seeded stream adds clustered pebbles, brush, coral and rubble to cached ground strips while preserving all destructible IDs and positions.

Exactly two scrolling planes provide depth. The **ground** plane contains water or space, terrain, rocks, plants, vehicles, buildings and destruction remains under one shared translation. Nothing standing on the map drifts away from its terrain cell. The **atmosphere** plane contains faster clouds and drifting particles. One extra cell beyond each horizontal edge covers the camera's 1% lateral drift. Terrain and ground vehicles use subdued biome materials; saturated complementary colors are reserved for airborne fleets.

## Fixed ship sprites

Ship hulls use weathered armor, recessed machinery and metallic lighting. All family sources share a red-armor/gold-trim color convention. The renderer maps those materials to each existing complementary fleet palette, while neutral metal and ivory player armor retain their shading. This common source convention allows different hull designs to keep the same strong contrast with their sector's terrain.

Every player and enemy uses one fixed hull and alpha-derived shadow. Players face up and enemies face down; steering never rotates, skews or replaces the hull. Source artillery orientation is normalized once during caching. Engine flicker and a subtle reactor pulse use cached overlays, while the hull and hitbox stay still. Reduced-motion mode freezes these decorative effects. Industrial crawlers and haulers have tracked/wheeled ground silhouettes, muted armor and no flight exhaust.

## Structure destruction

`structures.png` supplies the fresh state. The three matching sheets supply light damage, heavy damage and the final crater for every building, facility, ruin and ground vehicle. Cell indices remain identical across all four atlases. The renderer grades all stages through the same biome material palette and keeps their placement anchored to the ground plane.

| State | Remaining health | Source |
| --- | --- | --- |
| Fresh | Above 70% | `structures.png` |
| Light damage | Above 35%, up to 70% | `structure-light.png` |
| Heavy damage | Above zero, up to 35% | `structure-heavy.png` |
| Crater | Zero | `structure-crater.png` |

Structure durability scales with footprint area (`size²`) and a type-specific armor factor. Cached scenery strips rebuild only when an object changes visual state. The damage ledger preserves health and craters after scrolling, cache eviction and save/load. Earlier saves used lower linear health totals; migration keeps the original percentage remaining when applying the new area-based totals.

Service lights, small radar sweeps and rooftop exhaust animate over the cached structure bodies. Their intensity follows the damage stage and stops at destruction. The overlays use cached light/cloud textures, with no per-frame pixel processing.

The crater is painted by the scenery renderer. Ground explosion effects add transient fire, smoke and fragments without adding a second persistent wreck. A large structure's final blast gently displaces nearby small ships; its decaying, mass-sensitive impulse causes no damage and leaves large craft and bosses unaffected.

Repair and salvage pickups keep their original capsule/chip artwork, surrounded by a shared green halo baked into their cached textures.

## Fonts

The interface uses the repository's existing self-hosted Space Grotesk and Oxanium fonts. No third-party font request is made.
