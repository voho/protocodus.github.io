# Alpen generated texture sources

Generated with built-in image-generation tools for real-time WebGL use.

## Texture Asset Catalog

### 1. Terrain & Snowpack (`assets/textures/snow/`, `assets/textures/rock/`)
- **`snow/powder-surface.webp`**: Seamless fresh high-alpine powder snow with micro-crystalline grain.
- **`snow/groomed-surface.webp`**: Seamless groomed Swiss-piste corduroy ribs.

Both snow plates are data, not pictures (lossless WebP, sampled as
`NoColorSpace`): R is albedo variation and G is height, both centred on
one half. B and A carry the height's slope, baked offline so the terrain
shader reads its relief in one fetch instead of differencing three:
`B = G(uv) − G(uv + probeX)` and `A = G(uv) − G(uv + probeZ)`, encoded as
`127.5 + d·127.5`. The probes match what the shader used to take — powder
9 cm along the two rotated world axes of its 4 m tile, corduroy 1.8 cm
along +V (world X) and +U (world Z). Rebake with the same probes if the
height channel ever changes.
- **`snow/ice-glacier.jpg`**: Compressed glacial hard-pack blue ice with luminous cyan subsurface depth.
- **`rock/rock-granite.jpg`**: High-relief Swiss granite cliff rock.
- **`rock/rock-sandstone.jpg`**: Warm alpine sandstone rock outcropping.
- **`rock/rock-slate.jpg`**: Dark layered Swiss alpine slate rock with fine fissures and frost crystals.

### 2. Player & NPCs (`assets/textures/rider/`)
- **`rider/snowboard-topsheet.webp`**: The high-contrast geometric alpine racing board photograph, cropped to the deck and turned nose-down so its length runs up `v`, the parameterisation `riderModel.js`'s `loft` writes; the deck's own `u` range (0.1125–0.8875) is the print's width, and the margins are bled from its edge columns.
- **`rider/snowboard-retro.jpg`**: 1990s retro alpine freestyle snowboarding graphic with vibrant electric cyan, magenta, and solar yellow geometric angles.
- **`rider/rider-fabric.jpg`**: Technical waterproof micro-ripstop Gore-Tex outerwear fabric with mountain weatherproofing weave.

### 3. Alpine Huts & Architecture (`assets/textures/huts/`)
- **`huts/alpine-wood-planks.jpg`**: Weathered rustic Swiss alpine timber planks with natural grain and snow dust.
- **`huts/shingle-roof-snow.jpg`**: Weathered mountain cabin wooden roof shingles with snow patches and frost dusting.

### 4. Trees & Flora (`assets/textures/tree/`)
- **`tree/pine-needles.jpg`**: Alpine conifer evergreen needles.
- **`tree/frosty-conifer-boughs.jpg`**: Dense frost-covered Norway spruce and stone pine conifer needles.
- **`tree/tree-bark.jpg`**: Deep conifer pine bark texture.
- **`tree/weathered-tree-bark.jpg`**: Rugged alpine conifer pine bark with deep vertical furrows and settled snow.

### 5. Mountains & Sky Panoramas (`assets/textures/sky/`)
- **`sky/alps-clear.webp`**: Production 360-degree equirectangular game skybox of distant Swiss Alps peaks on a crisp clear morning.
- **`sky/alps-storm.webp`**: Swiss Alpine snow squall panorama with diffuse steel-blue overcast light.
- **`sky/alps-sunrise.jpg`**: Alpine sunrise alpenglow mountain panorama.
- **`sky/alps-aurora-night.jpg`**: Polar aurora borealis curtains over nighttime alpine peaks.
- **`sky/alps-peaks-sunset.jpg`**: 360-degree panoramic golden-hour sunset Alpenglow across jagged Swiss alpine crests.
