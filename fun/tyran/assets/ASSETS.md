# Tyran assets

## `hero.jpg`

Original Tyran title artwork generated with the built-in ImageGen tool on 2026-09-15. Exported as a 1672 × 941 JPEG for the title screen and social preview. The runtime environments and ships are drawn independently by the game renderer.

### Generation prompt

Use case: stylized-concept. Asset type: original cinematic title-screen artwork for TYRAN, a beautiful top-down scrolling science fiction shooter. Primary request: A beautiful sleek small ivory and gunmetal fighter with turquoise luminous cockpit and powerful orange exhaust, flying north above a lush alien jungle canyon. Rich layered terrain, fern forests, immense palm trees, a winding brilliant turquoise river, mysterious ruined geometric structures with lights, atmospheric clouds. Two much smaller enemy fighters and a distant orange explosion. Premium retro arcade spirit rendered as luxurious highly detailed modern concept art, painterly but believable mechanical detail. Composition: wide 16:9 landscape; oblique top-down view; main fighter occupies center-right at about 66% across and 48% down, nose points up and slightly right; majestic deep jungle recedes below. Left 40% contains dark, softer forest and shadow for a text overlay. Lighting: gorgeous cinematic teal mist, amber sunlight from upper right, bright cool engine lighting, contrasting orange sparks. Emerald, turquoise, desaturated jade, warm stone, orange. Avoid text, logos, UI, frames, watermark, close-up humans, readable lettering, starry outer space. This is illustrative title artwork for a top-down arcade shooter. Beautiful crisp details and restrained bloom.

## Realistic sprite atlases

The six active base atlases were generated with the built-in ImageGen tool on 2026-09-19. Three destruction sheets and ten sector fleet sheets bring the active library to 19 atlases. Every ship uses one fixed hull. [sprites/prompts.json](./sprites/prompts.json) records the exact prompts, historical generation sources, cell names and layouts. A failed specialized sheet uses the common fleet or procedural fallback.

The library contains the `.webp` files used by the runtime, exported with `cwebp -lossless -exact -m 6`. The original 20 exports were verified against their original PNGs for identical decoded RGBA pixels and dimensions before removing the duplicate PNGs. These lossless atlases preserve the complete artwork and transparency for future edits. The unused pickup sheet, retired terrain paintings and banking sheets have been removed; gameplay uses seeded material tiles. Historical source/reference paths in the provenance record describe generation inputs, not required repository files.

| Atlas | Layout | Contents |
| --- | --- | --- |
| `sprites/fleet.webp` | 4 × 3 | Ivory player, ten enemy hulls, one empty cell |
| `sprites/nature.webp` | 4 × 4 | Plants, rocks, ice, crystals, coral, cloud |
| `sprites/structures.webp` | 4 × 4 | Buildings, ruins, facilities, satellite, crawler, hauler |
| `sprites/materials.webp` | 8 × 5 | Four tile materials for each of ten environments |
| `sprites/effects.webp` | 4 × 4 | Eight explosion frames, smoke, fragments, scorches, two thrusters |
| `sprites/projectiles.webp` | 4 × 3 | Six weapon profiles and six enemy projectile silhouettes |
| `sprites/structure-light.webp` | 4 × 4 | Light damage matching all 16 structure/vehicle cells |
| `sprites/structure-heavy.webp` | 4 × 4 | Heavy damage matching all 16 structure/vehicle cells |
| `sprites/structure-crater.webp` | 4 × 4 | Craters and wreckage matching all 16 structure/vehicle cells |

Each sector fleet sheet uses a 4 × 3 layout. Cell 0 is an unused player reference and is omitted from the decoded cell cache; pilots, drones and shop previews share `fleet.webp` cell 0. Cells 1–10 contain the nine enemy classes and guardian, and cell 11 is empty. Connected-component ownership and all cell indices remain unchanged. Enemy class order matches `fleet.webp`; each family supplies its own hull designs.

| Sector | Fleet family | Atlas |
| --- | --- | --- |
| Jungle | Scarlet Talons | `sprites/fleet-jungle.webp` |
| Snow | Halo Syndicate | `sprites/fleet-snow.webp` |
| Desert | Relic Array | `sprites/fleet-desert.webp` |
| Paradise | Sunwake Raiders | `sprites/fleet-paradise.webp` |
| Asteroid belt | Scrap Convoy | `sprites/fleet-asteroid.webp` |
| Mars | Redline Foundry | `sprites/fleet-mars.webp` |
| Volcanic | Cryo Lances | `sprites/fleet-volcanic.webp` |
| Neon | Circuit Runners | `sprites/fleet-neon.webp` |
| Alien | Spore Covenant | `sprites/fleet-alien.webp` |
| Void | Aurum Cathedral | `sprites/fleet-void.webp` |

`sprite-assets.js` decodes the library before flight preparation and retains one reusable alpha-trimmed canvas per cell, releasing each full decoded sheet after extraction. Connected hull/structure components keep wings and antennas intact where generated objects cross nominal grid boundaries. Color grading, shadows and sprite variants are cached by appearance. Ship caches are bounded to roughly one fleet and both pilots; exhaust frames are shared across palettes. Flight preparation warms all fresh scenery and building damage appearances for the active sector, along with foundations and fixture overlays. Damage art has an 80-entry cap (20.7 MiB); other sectors' derived art is released on a world change. All 24 material cells and 252 bank/cliff masks are prepared before flight. Opening strips and the next strip are ready before play, then bounded nearby terrain streams through small idle row jobs with scenery prepared ahead of the camera. Procedural art remains a fallback if an atlas cannot load.

## Resolution and unused-art audit (2026-09-27)

All 47 remaining media files have runtime references: 19 sprite sheets, 23 audio files, four fonts and the title image. Removing the unused pickup sheet saves 665,914 download bytes and 2,213,436 decoded RGBA bytes. Omitting the ten unused sector player reference cells saves another 3,033,924 decoded bytes. Shared source surfaces now retain about 70.6 MiB, a 5.0 MiB reduction; full decoded sheets are released after extraction. Licenses and generation provenance remain available.

| Artwork | Source dimensions | Prepared use and sizing conclusion |
| --- | --- | --- |
| Terrain materials | 1586 × 992, 8 × 5 cells | Each 198–199 px cell feeds a 200 px tile. Keep this resolution for large displays. |
| Structures and three damage sheets | 1254 × 1254 each, 4 × 4 cells | Cached in 260 px canvases with roughly 121–183 px of visible art. Source sheets have downsizing headroom; this cleanup preserves their original pixels and damage alignment. |
| Projectiles | 1448 × 1086, 4 × 3 cells | Prepared as 128 px textures. Smaller source sheets could reduce loading and source memory; they would not reduce the prepared texture size or flight drawing cost. |
| Shared and sector fleets | 1448 × 1086 each, 4 × 3 cells | Hull caches are 384 px, or 640 px for bosses. Preserve boss detail; omit unused player reference cells from sector caches. |
| Nature and effects | 1254 × 1254 each, 4 × 4 cells | Large cloud and explosion draws need their detail. Avoid reducing whole sheets just to shrink smaller individual props. |
| Title image | 1672 × 941 | Used across the title screen and social preview; retained at its existing resolution. |

These are source-memory and loading savings. Flight already uses cropped, prepared textures and bounded caches; they are not a measured additional CPU/GPU percentage. Sprite-memory, all 100 fleet hulls and offline preflight checks pass after cleanup.

## Terrain tile library

`terrain-sprites.js` bakes the generated material cells into 100 × 100 logical-pixel tiles at double resolution. Each biome has four materials with six orientations each, plus matching irregular corner masks for banks and cliffs. Shared crossings and tangents keep all six contour variants connected. Broken rims, layered ledge shadows, fissures and low mounds add visual depth; material crops vary to soften repetition. Material luminosity preserves the generated surface detail; the original terrain palette supplies its hue. Common edge tones join adjacent tiles. `tile-map.js` generates connected terrain cells from the level hash. `worlds.js` assembles those cells into cached 800-pixel strips and places reusable scenery sprites from the same hash. A separate seeded stream adds clustered pebbles, brush, coral and rubble to cached ground strips while preserving all destructible IDs and positions.

Three scrolling planes provide depth. The **ground** plane contains water or space, terrain, rocks, plants, vehicles, buildings and destruction remains under one shared translation. Nothing standing on the map drifts away from its terrain cell. The **atmosphere** plane contains clouds and their ground shadows at 1.32× ground speed; **foreground weather** adds peripheral wisps and particles at 1.85×. Reduced motion removes the extra drift. Large displays retain both cached terrain and scenery strips at 2× resolution. Viewport width adds 100-unit terrain columns at a fixed height-based camera scale. Seeded 1,200-unit districts preserve scenery and supply identities across resize. One extra cell beyond each horizontal edge covers the camera's lateral drift (up to 12 map units). Terrain and ground vehicles use subdued biome materials; saturated complementary colors are reserved for airborne fleets.

## Fixed ship sprites

Ship hulls use weathered armor, recessed machinery and metallic lighting. All family sources share a red-armor/gold-trim color convention. The renderer maps those materials to each existing complementary fleet palette, while neutral metal and ivory player armor retain their shading. This common source convention allows different hull designs to keep the same strong contrast with their sector's terrain.

Every player and enemy uses one fixed hull and alpha-derived shadow. Players face up and enemies face down; steering never rotates, skews or replaces the hull. Source artillery orientation is normalized once during caching. Engine flicker and a subtle reactor pulse use cached overlays, while the hull and hitbox stay still. Reduced-motion mode freezes these decorative effects. Industrial crawlers and haulers have tracked/wheeled ground silhouettes, muted armor and no flight exhaust.

## Structure destruction

`structures.webp` supplies the fresh state. The three matching sheets supply light damage, heavy damage and the final crater for every building, facility, ruin and ground vehicle. Cell indices remain identical across all four atlases. The renderer grades all stages through the same biome material palette and keeps their placement anchored to the ground plane.

| State | Remaining health | Source |
| --- | --- | --- |
| Fresh | Above 70% | `structures.webp` |
| Light damage | Above 35%, up to 70% | `structure-light.webp` |
| Heavy damage | Above zero, up to 35% | `structure-heavy.webp` |
| Crater | Zero | `structure-crater.webp` |

Structure durability scales with footprint area (`size²`) and a type-specific armor factor. Cached scenery strips rebuild only when an object changes visual state. The damage ledger stores either injured health or a crater marker per object, preserving both after scrolling, cache eviction and save/load without duplicating terminal states. Earlier saves used lower linear health totals; migration keeps the original percentage remaining when applying the new area-based totals.

Service lights, small radar sweeps and rooftop exhaust animate over the cached structure bodies. Their intensity follows the damage stage and stops at destruction. The overlays use cached light/cloud textures, with no per-frame pixel processing.

Seeded supply buildings reuse these same structure bodies and destruction stages, with mint beacons marked by the bonus they release. Their contents use a separate hash so existing scenery positions and damage IDs stay stable. Ground turrets have been removed, and natural scenery and ground vehicles no longer take damage.

The crater is painted by the scenery renderer. Ground explosion effects add transient fire, smoke and fragments without adding a second persistent wreck. A large structure's final blast gently displaces nearby small ships; its decaying, mass-sensitive impulse causes no damage and leaves large craft and bosses unaffected.

The unused repair capsule/chip atlas and its preload entry have been removed; its generation record remains in `sprites/prompts.json`. All seven live pickups now use the same cached beveled teal case, mint rim, pale emblem and green halo from `bonus-sprites.js`. Supply-building markers reuse those badges.

Distinct repair, credit, lightning, shield, power, drone and nova symbols distinguish bonuses within the shared shape and palette. Temporary bonuses show their remaining duration in the pilot HUD. Cached mint barrier art and mint wing markers show active bonuses without replacing or tilting the ship hull.

## Fonts

Menus, HUD and canvas text use locally served Chakra Petch in four Latin WOFF2 weights (about 39 KB total). See [font provenance and license](fonts/README.md). No third-party font request is made.

## Audio

Tyran includes 18 CC0 sound-effect variants from Kenney's Sci-fi Sounds and Digital Audio packs, plus five MP3 tracks supplied by the user and identified as Suno AI generations. The sound-effect notices and the supplied music inventory are recorded separately; no public-domain license is claimed for the Suno tracks:

- [Sound effects and licenses](audio/sfx/SFX-SOURCES.md)
- [Supplied music inventory](audio/music/MUSIC-SOURCES.md)

`audio-assets.js` preloads all 23 files before flight, regardless of the mute setting. Eighteen short WAV effects decode in an OfflineAudioContext; the five full MP3s remain compressed in local Blob URLs and play through one reusable media element. This avoids keeping fully decoded song buffers in memory. All sectors and retries share the in-memory assets, and optional versioned Cache Storage retains downloaded bytes for later visits. Playback never fetches assets. One 15-second deadline bounds the entire preload queue; missing or stalled assets use the synthesized fallback for the session with no in-flight retries. Preloading does not create a live playback context or start audio.

Collectible icons are drawn and cached by `bonus-sprites.js`; every bonus uses the same teal case and mint palette with a distinct symbol.

## Shop previews

`shop-art.js` composes thirteen 640 × 280 product images from the existing decoded fleet, structure, projectile and effects art. Weapon cards show firing patterns; support cards show drones, a reserve ship and nova hardware; system cards show armament, firing cadence, shot power, shields, armor and the reactor. Startup caches these inline PNG previews once, so opening or updating the shop makes no additional asset requests.
