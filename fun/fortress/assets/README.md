# Fortress assets

## Fantasy landscapes

All five panoramas were painted for Fortress with the built-in OpenAI image generator on 27 November 2026. Each scene began with a 1983 × 793 composition. Four overlapping 1024 × 410 crops from each composition were individually repainted with the same tool. Each repaint produced a 1983 × 793 native-detail tile. The four tiles were aligned to their source landmarks, matched for broad lighting, and blended in their overlaps. The turf or snow shoulder sits at y = 389 in the 1200 × 480 game world.

The browser selects a 1600 × 640 WebP or a 3840 × 1536 WebP assembled from those painted tiles.

| Realm | Compact | 4K |
| --- | --- | --- |
| Bramblewatch Outpost | `bramblewatch.webp` | `bramblewatch-4k.webp` |
| Moonfen Crossing | `moonfen.webp` | `moonfen-4k.webp` |
| Cinderstone Hold | `cinderstone.webp` | `cinderstone-4k.webp` |
| Frostpeak Bastion | `frostpeak.webp` | `frostpeak-4k.webp` |
| Crownfall Citadel | `crownfall.webp` | `crownfall-4k.webp` |

### Shared composition prompt

> Use case: stylized-concept. Generate at exact 3840×1536 pixels, 4K large format, ultra-wide 2.5:1 aspect. A single high-definition landscape background for the side-view fantasy siege videogame Fortress. Premium polished hand-painted environment key art, with high-resolution fine brushwork, crisp confident organic edges, rock strata, irregular foliage clumps, delicate distant atmospheric layers and rich local hue variation, evocative of a classic European illustrated fantasy adventure. Full bleed, lush grounded forms, clean large silhouettes, bright readable daylight or twilight as appropriate, soft painterly light, beautifully authored shapes and a sense of a living kingdom. Avoid pixel art, low resolution, retro pixels, dithering, noise, smooth vector fills, hyperrealism or photographic collage. CAMERA is side-on, a stage for lateral gameplay, not an isometric view. At precisely 81% down the frame there is a perfectly horizontal narrow raised grass-and-soil shelf, level across the ENTIRE width, with the lowest 19% of the image showing the dark rocky earth beneath the turf in physical cross-section, beautifully detailed stones and mottled soil. Middle left around 12% width and middle right around 78% width will receive game pieces, so give them calm readable backgrounds. Large far landmarks are scenic and low-contrast with distance. No foreground player, characters, forts, structures, weapons, text, watermarks, logo or frames.

### Scene variations

**Bramblewatch Outpost**

> A bright blue alpine valley at late afternoon. Broad banks of soft cream clouds with blue celadon shadows in the clear turquoise azure sky. Dynamic jagged ridges of chalky golden rock and blue shadows, a small medieval fairytale castle visible far away around one-third from left on a rocky spur, tiers of alpine spruce forest, and bright sage and chartreuse meadow with tiny wildflower highlights. A broad tree frames the extreme left and a fir the extreme right. Warm sunlight from upper left glazes the summits and rolls across the green valley, cool blue forest shadows. Golden-green cut grass over rich umber earth dotted with sandstone boulders.

**Moonfen Crossing**

> An enchanting crescent-moon twilight over a misty fae woodland. Silvery mauve cloud wisps, dusky plum sky and distant rolling lilac hills. Great drooping purple and indigo willows at the extreme sides frame a calm middle clearing. Layered lavender fog, pointillistic firefly glows and tiny pink and jade meadow mushrooms in the distance. The foreground shelf has dark jade moss fringes over purple-black soil and rounded stones, lit by soft moonlight.

**Cinderstone Hold**

> An imposing volcanic fantasy basin at dusky sunset. Broad rose-plum clouds illuminated from beneath above a rust and ember orange sky. Layered towering red basalt mesas and a silent distant volcano to the right with blue-purple shadowed facets. Very tiny dwarven stone smokestacks far left. Warm atmospheric ember light, spacious lower central meadow. Thin ochre tundra grasses atop the foreground shelf, cutaway black iron soil with ruddy, beautifully fractured basalt stones.

**Frostpeak Bastion**

> Crisp sunrise in a breathtaking snowy dwarven alpine pass with jagged snow-coated mountains, turquoise blue high sky and cream light kissing pale apricot peaks. A very small dwarven gateway carved into a distant rock face at far left. Layered pines with boughs of fresh snow, bright blue shadow and fresh icy air. Quiet, open snow-dusted meadow. A thin horizontal snow and frosty grass shelf over a rock-studded cross-section of frozen teal and slate soil.

**Crownfall Citadel**

> A magical autumn kingdom under a luminous coral and apricot late afternoon sky with golden cloud towers. A distant medieval stone aqueduct crosses a left hillside above a thin waterfall. Folded purple mountains with touches of warm sun, layers of small gold, ochre, and russet maple canopies, a broad, tranquil sunlit valley floor. The flat foreground shelf has tawny golden grass and russet stony earth. A regal sense of a final campaign landscape.

### Detail-tile prompt

> Image 1 is the exact edit target: a rectangular crop of a wider hand-painted videogame panorama. Make a faithful, high-definition, 2× resolution detail restoration of this precise crop, keeping ALL composition, brush style, illumination, colors, framing, object silhouettes and edges spatially registered to the reference. This is a tile of a larger image, and it must meet adjacent tiles along every edge. Preserve every object, crop and landmark at its exact original place. Render refined original brush details inside the existing forms, crisp natural brushwork. Maintain smooth painterly distant lighting. Do not zoom, widen, extend, rotate, move, invent new shapes or add borders. Output edge-to-edge 2048x820 ultrawide image, same 2.5:1 aspect. No text.

## Typeface

`cinzel-latin.woff2` is the Latin webfont for Cinzel. Copyright 2020 The Cinzel Project Authors. Distributed under the SIL Open Font License 1.1. [Cinzel source](https://github.com/NDISCOVER/Cinzel) · [Bundled license](Cinzel-OFL.txt)

## Moving fortress artwork

`orc-crossbow.webp` uses the original orc as reference for three painted shooting sequences, aimed level, upward and downward. The atlas contains draw, aim and release frames at 13 elevations, with matching soft shadows and a shared foot position. The renderer mirrors the frames for the opposite flank.

`castle-facades.webp` contains four wall panels created for Fortress with the built-in OpenAI image generator. The casement, slate arrow slit, shuttered brickwork and rose window are graded for each time of day during startup. Open galleries leave the landscape visible between the load-bearing piers.

The built-in ImageGen tool produced seven transparent hand-painted sprite sheets with upper-left lighting and front-facing or side-on silhouettes. Their trimmed, alpha-masked cutouts share the optimized `fortress-atlas.webp` texture. The world renderer selects phase lighting and the appropriate pose or material at runtime.

| Sheet | Generation prompt |
| --- | --- |
| Characters and keg | Paint front-three-quarter storybook miniatures of the armored green orc, dwarf siege engineer, red-capped gnome, green-hooded elf and red coopered powder keg. Keep each full figure isolated on transparent alpha. |
| Character poses | Use the original costume and face designs. Draw the orc shading its eyes and ducking under its helmet, the dwarf adjusting goggles and pulling a release cord, the gnome straightening its hat and raising a fist, and the elf thinking and pointing. |
| Catapult | Paint a side-view oak chassis on spoked wheels with engraved bronze and ironwork, an exposed triangular axle mount and a windlass. Isolate its throwing arm, counterweight and empty leather sling as a separate articulated layer. |
| Architecture | Paint three open medieval arcades with transparent openings: an ivy-clad limestone Gothic arch, a carved timber guardroom, and a slate-and-gold royal keep. |
| Materials | Paint individual horizontal cutouts of hewn oak, quarried limestone, riveted blue steel, and translucent beveled aquamarine glass with detailed natural surfaces. |
| Heraldry and stonework | Paint three distinct squared ashlar blocks: weathered limestone, green-gray mineral stone and iron-repaired masonry. Paint separate embroidered crimson and blue tapestries and a loose crimson swallowtail pennant for animation. |
| Wildlife poses | Paint two grazing and alert poses of an ivory unicorn with a lilac mane, and two wingbeat poses for a tiny sage-and-gold fairy, each on transparent alpha. |

## Ammunition illustrations

The built-in ImageGen tool created a transparent two-by-two inventory sheet. The prompt requested an isolated chipped olive-gray river stone, a larger angular blue-gray granite boulder with fracture veins, a small cast-iron bomb with a brass collar and a lit curved wick, and a heavy iron bomb with a riveted vermilion band. All four used painterly upper-left lighting without lettering or a background. The trimmed cutouts are `ammo-small-stone.webp`, `ammo-big-stone.webp`, `ammo-small-bomb.webp` and `ammo-big-bomb.webp`. The HUD portrait `orc-portrait.webp` is cut from the original orc illustration.

The built-in image generator created `ammo-fireball.webp` from the prompt “a compact magical fireball with a molten golden center, scarlet-orange flames sweeping upward-left and a few sparks, in a hand-painted storybook style on a transparent background.” The game uses a trimmed WebP version with its original alpha channel.

The Siege bomb inventory illustration is a generated transparent cutout of a dwarven iron orb with bronze bands and an emerald rune. The HUD and battlefield share the same optimized WebP.

The Magic bomb uses a generated illustration of a faceted amethyst orb in engraved silver bands. The inventory and projectile share the transparent `ammo-magic-bomb.webp` cutout.

## Soundtrack

The supplied recordings are *Fingers of Grey*, *Blood on the Rampart*, and *Before the Iron Gate*, in playlist order. The game versions in `music/` use 112 kbps stereo MP3 with a constant gain adjustment to approximately −30 LUFS integrated. This preserves their dynamics at a quiet level on mobile devices that lock media-element volume to the system setting. All three compressed tracks are buffered at startup and streamed from memory by the browser's media player.

## Weather recordings

The stereo weather excerpts in `weather/` are edited from CC0 field recordings. The two rain beds use equal-power loop crossfades. Each thunder clip keeps a separate strike and its natural decay so the game can place it at the visible lightning.

| Game audio | Source recording |
| --- | --- |
| `rain.mp3` and the close rain in `downpour.mp3` | Ylmir, [Rain (loopable)](https://opengameart.org/content/rain-loopable), tracks 1 and 2 |
| The rain behind `downpour.mp3`, `thunder-rift.mp3` and `thunder-roll.mp3` | SamuelGremaud, [THUNDERSTORM & RAIN](https://freesound.org/people/SamuelGremaud/sounds/429189/), recorded in Monieux, France |
| `thunder-peal.mp3` | RyanKingArt, [Rain, Lightning, Thunderstorm](https://freesound.org/people/RyanKingArt/sounds/714582/) |
