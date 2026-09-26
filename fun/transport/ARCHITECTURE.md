# Transport module reference

Static ES modules. No build step. `model.js` owns all game state and exports:

- `BIOMES`: object keyed taiga/tundra/desert, each `{name, description}`.
- `INDUSTRIES`: object keyed kind, each `{name, inputs: {cargo:count}, outputs: {cargo:count}, cost, biomes: string[]}`.
- `CARGO`: object keyed cargo, each `{name, color, price}`.
- `createGame({biome='taiga', seed=1847, size='huge'}={})` returns JSON-serializable state.
- `build(game, tool, x, y)` returns `{ok, message}`; tools `road`, `rail`, `bridge`, `railbridge`, `tunnel`, `railtunnel`, `bus-stop`, `train-stop`, `port`, `residential`, `commercial`, `industrial`, `city`, `bulldoze`, or industry kind.
- `buildPath(game, tool, points)` returns `{ok, message}` for array `{x,y}`; safe partial placement is allowed but message must report errors/cost. Deduplicate points.
- `addRoute(game, {name, mode:'road'|'rail'|'water', stops:[stationId,stationId], cargo:'passengers'|cargoKey})` returns `{ok,message,route?}`. Requires connected infrastructure and a suitable cargo source/destination. Buys vehicle, exact upfront cost exposed by `VEHICLE_COSTS` export.
- `removeRoute(game, routeId)` returns `{ok,message}`.
- `tick(game, days)` advances time, vehicles, economy, growth. Can receive fractional days; sim rate one day per real second at 1x.
- `findPath(game, from:{x,y}, to:{x,y}, mode)` returns tile coordinate array or null.
- `saveGame(game)` / `loadGame()` / `deleteSave()` localStorage with validation/version.
- Optional additional exports welcome. `model.js` must stay DOM-free for Node tests, apart from guarded localStorage.

State shape:
```
{version:1, seed, biome, width:512, height:384, size:'huge', tiles:Tile[],
 money:400000, day:0, totalDelivered:0, totalRevenue:0,
 monthlyIncome:0, monthlyExpenses:0, history:[], notifications:[],
 cities:City[], industries:Industry[], stations:Station[], routes:Route[], vehicles:Vehicle[], zones:Zone[], revision:0, networkRevision:0 }
```
`tiles[y*width+x]` = `{terrain:'grass'|'water'|'forest'|'mountain'|'rock'|'sand'|'snow', elevation:number, variant:number, detail?:string, publicRoad?:boolean, road:false, rail:false, bridge:false, tunnel:false, building:null|{kind: keyof BUILDINGS | 'house'|'apartment'|'shop'|'office'|'factory',level:number}, zone:null|'residential'|'commercial'|'industrial'}`. Roads and rails can coexist for crossings; bridges/tunnels terrain traversal. Coastline water has water neighbors; rivers same water.

City `{id,name,x,y,population,activity,growth}`. Industry `{id,kind,name,x,y,capacity,inventory:{cargo:number},production:number}`. Station `{id,name,x,y,mode:'road'|'rail'|'water'}`. Zone `{x,y,kind,progress}`. Structures occupy one logical tile; raised roofs and port piers can visually overhang neighboring tiles. Route `{id,name,mode,stops:[id,id],cargo,delivered,revenue,color,path:[{x,y}],active:true}`. Vehicle `{id,routeId,x,y,angle,load,capacity,progress,direction}` uses tile-coordinate floating x/y, angle in radians. Renderer must tolerate optional/missing stats.

`createGame` starts with at least 3 cities, environment-specific industries, visible terrain varieties, an already working two-stop passenger road route and initial bus, plus an unconnected production opportunity. The starter city is centered near 43% of world width and 47% of height, with a second town 24 tiles to its east. Name taiga initial city Alderbrook. Starting roads avoid obstacles. Industry growth and zoning service depend on activity; connected routes earn income only by actual loading/delivery. Starting game economy net positive at 1x. Seed deterministically changes generated terrain.

`renderer.js` exports `createRenderer(canvas, game, options={})` returns:
- `setGame(game)` for new/load
- `render(now, {tool='inspect',hover=null,preview=[],selected=null,showGrid=false,showRoutes=true,routeStops=[]}={})`
- `resize()` use canvas CSS rect and devicePixelRatio capped 2
- `screenToTile(clientX,clientY)` -> `{x,y}` (coordinates relative viewport)
- `screenToInspectTile(clientX,clientY)` -> `{x,y}`; picks an industry when an Explore pointer hits its resource marker, otherwise returns the ordinary map tile. Construction always uses `screenToTile`.
- `pan(dx,dy)` pixels; `setZoom(value,clientX?,clientY?)` snaps to a supported view; `zoomAt(factor,clientX?,clientY?)` moves one level according to factor direction; `focus(x,y)` tile coords
- `getCamera()` -> `{x,y,zoom}`; zoom is exactly 0.5 (Region), 1 (Town), or 2 (Detail), as defined in `zoom.js`
- `setLayers(partial)` merges recognized boolean display flags; `getLayers()` returns a copy of the current flags
- `drawMinimap(canvas)`

Renderer handles camera and art only; UI handles DOM/pointers. Render continuously with requestAnimationFrame; static terrain cache invalidated via game.revision. Sprites combine bundled raster house atlases and code-native canvas artwork. Top-down 2D, detailed recognizable realistic sprite aesthetic; all assets are served with the game. Rich taiga: moss green land, dark fir forests, turquoise water, pale rocky mountain ridges, shadowed tile-sized buildings and transport. Keep terrain readable, organic and detailed, smooth continuous network rendering, route lines subtle. city/station/industry labels. Canvas background fills bounds. No imports from UI. The interface lives in `app.js`, `index.html` and `style.css`; the simulation lives in `model.js`, `environment.js` and `settlements.js`, with generation/catalogs in `world.js`, `data.js` and `buildings.js`; rendering lives in `renderer.js` and `sprites.js`.

## Local simulation

`environment.js` is DOM-free and exposes:

- `randomAt(game, day, key, salt=0)`: a stateless sample derived from seed, integer day, entity/cell key and decision channel. Camera renders, frame rates and save restoration cannot consume or reorder random samples.
- `weatherAt(game, x, y, day=game.day)`: spatially blended weather fronts and seasonal/biome/elevation effects, returning `wetness`, `cold`, `heat`, `growth` and `travel` factors.
- `localEnvironment(game, x, y, radius=3)`: a bounded neighborhood survey of infrastructure, vegetation, moisture, housing, shops, services, civic amenities, industry, pollution and active station coverage. Local road access uses adjacent tiles; rail access extends two tiles; active station coverage extends five tiles.
- `stepEcology(game)`: a daily sparse, asynchronous Moore-neighborhood update. It samples at most `min(4096, ceil(tileCount/128))` cells, buffers changes, then commits together. Grass, sand, snow and forest undergo local vegetation succession; water, mountains, rocks and every occupied/reserved plot remain protected. It returns the changed-tile count.

`settlements.js` exposes `stepSettlements(game)` for daily passenger demand, activity/supply decay, organic infill and zone development, plus `settlementSuitability(game, point, kind)` for the inspector's score and short positive/negative explanations. Decisions use seeded per-entity opportunities and local conditions. Building changes commit after proposals are collected, so new neighbors cannot trigger same-day development cascades. Organic growth only occupies vacant plots with road access; paid structures and civic landmarks are retained. Population rises when housing is actually added. Zone development requires recent deliveries and a local road; stalled interest can fade without deleting occupied buildings.

`industry-simulation.js` exposes `initializeIndustry(game, industry)`, `stepIndustries(game, notify)` and `industryConditions(game, industry)`. The inspector's productivity score and reasons use the same resource, access, neighboring structure and weather inputs as production. Industries save `lastProductionDay`, `nextProductionDay` and `nextReviewDay` for staggered work and capacity reviews. Production respects complete recipe proportions, available inputs and warehouse space.

`model.js` advances these processes at simulation-day boundaries, while vehicles move continuously between them. Fleet events advance in chronological order so vehicles competing for limited inventory receive the same cargo regardless of frame partitioning. Vehicles save `dwellRemaining` and `tripSerial` to preserve seeded loading waits. Monthly reporting remains a calendar operation.

`revision` describes visible world changes. `networkRevision` changes when transport infrastructure changes; pathfinding and the cached base infrastructure upkeep use this separate revision. Growing trees or houses therefore do not force routes to replan or recount the entire huge world. Optional simulation fields are validated when present; legacy saves receive deterministic defaults on load. New simulation state remains JSON-serializable and fits the existing compact save envelope.


## Expanded worlds

`cargo-icons.js` owns the 20 resource pictograms used throughout the interface. `cargoIcon(kind, {decorative})` returns an SVG; `cargoBadge(kind, {count, label})` adds a resource name/quantity and accessible description; `cargoRecipe(inputs, outputs, {counts, labels})` renders grouped input/output badges and an accessible recipe sentence. Decorative nested SVGs defer their accessible name to the containing badge. The route form’s illustrated cargo buttons update `formDraft.cargo` and a hidden native select, so changing stops or rebuilding the panel preserves the selected resource.

`NEW_WORLD_SIZES` exposes square512, square1024 and square2048; 512 is the default. `WORLD_SIZES` also retains regional 128×96, large 256×192, huge 512×384 and vast 768×576 for compatibility. Square maps have 48/128/320 towns and 8/20/48 complete industry districts. `MAX_WORLD_TILES` bounds decoding at 2048². Version 2 uses domain-warped regional fields sampled on a four-tile lattice, spatial lake buckets, branching river curves, weighted settlement regions and habitat-scored industry sites; digest fixtures prevent silent changes that would invalidate procedural saves. Old 100×72 saves remain valid. The tile codec stores base properties in four bytes per tile, uses exact elevation/detail palettes, and stores buildings/zones/extra flags sparsely. Public generated roads are excluded from company road upkeep.

`BUILDINGS` defines the 26 architectural identities used by world generation, growth, construction, inspectors and sprite selection. `residentialKind(variant, level)` chooses among the nine house designs; `commercialKind` selects shops/services. Legacy generic kinds still render.

Rendering uses 8×8 tile chunks with an LRU memory budget. Each of the three zoom views uses its own sprite detail profile and a native raster scale of `zoom × devicePixelRatio` (DPR capped at 2). `createSprites(biome, {pixelScale, detailLevel})` draws directly at the target resolution; it does not enlarge a low-resolution image. Chunks include raster scale and detail profile in their identity, while revision fingerprints update changed terrain in every cached view. Camera transforms align to physical pixels, keeping tile picking and drawing consistent.

`getStats()` reports chunk count, bytes, memory limit, maximum canvas dimensions, raster scale, detail profile and DPR. It also counts visible vehicle load indicators by empty, partial and full state. Vehicle indicators render after map labels in screen coordinates: loaded carriers show their route's cargo pictogram and a proportional meter, while empty carriers have a smaller unfilled meter. Resource images share the existing local SVG cache with industry markers. A per-frame route lookup avoids scanning the route list separately for every vehicle and indicator.

The cache budget starts at 48 MiB and can grow for large high-density viewports, up to 256 MiB. The minimap/atlas caps its raster at 512 pixels per side and reuses its pixel buffer across ecology revisions. A sparse road/rail overlay preserves one-tile networks even when terrain is downsampled, and rebuilds its network index only when `networkRevision` changes. `getStats()` separates sampled minimap dimensions from logical world dimensions and exposes sample/scan counters. The app coalesces continuous wheel gestures into a single neighboring view change, and all button and keyboard inputs use the same three-level contract.

## Production and route planning

`chains.js` derives production dependencies and compatible destinations from the economy catalogs. `chains-view.js` and `chains.css` present the current environment's complete graph, an output's recursive ingredient chain, and every world instance of a selected industry type. Locating an instance centers the map and opens its inspector. The inspector shows downstream cargo consumers and up to five closest matching industry or town destinations. Distances describe direct map distance, not a verified road, rail or water connection.

`route-planner.js` provides the DOM-free route filtering and connection validation used by the Routes panel. The panel keeps its text search and mode/status/cargo filters separate from the route draft. Native station selectors remain available alongside map picking. Selecting a departure on the map advances to arrival selection; only stations matching the route's transport mode are accepted. Cancel, Escape and changing away from Routes end the picker. On mobile, choosing the final stop reopens the management panel.

The route planner verifies the actual network and station cargo coverage before launch. Its cached path result is invalidated by selected stops, transport mode or `networkRevision`; changes to available funds and cargo eligibility also update launch availability. The simulation's `addRoute` still performs authoritative validation when the form is submitted.

`compact-hud.css` fits navigation, finances, date and speed into one header row. Company delivery and connection totals are exposed through the finances button's hover/focus/click tooltip. `industry-targets.css` keeps the expanded industry inspector scrollable within the map on desktop and mobile.

## Local save slots

The automatic checkpoint keeps the existing `transport-save-v1` key and compact tile format. Named snapshots use one independent `transport-slot-v1:<id>` localStorage entry per slot; listing enumerates this prefix without a separate index. Each versioned envelope includes its id, name, biome, game day, balance, save timestamp, dimensions, route count, payload encoding, checksum and complete compact game payload. Native gzip compresses a `tile-binary-v1` frame with raw packed tile bytes before base64 encoding for original sizes or dense 15-bit UTF16 packing for Vast; JSON remains the fallback when compression is unavailable. The payload checksum lets listing flag accidental edits and truncation without expanding each world.

`save-slots.js` provides `listSaveSlots()`, asynchronous `writeSaveSlot(game, {id?, name})` and `readSaveSlot(id)`, plus `renameSaveSlot(id, name)` and `deleteSaveSlot(id)`. List metadata distinguishes ready, corrupt and unavailable entries. The autosave has id `autosave` and is read-only through this API. Writes validate and serialize before a single `setItem`, preserving the previous record when storage rejects a write. Renaming changes metadata without re-encoding its payload. Reading validates and hydrates the complete world but does not activate it or change storage.

`saves-view.js` and `saves.css` mount the Load / save dialog with named slots, an independent autosave checkpoint, asynchronous progress/errors, and inline confirmations for replacing the world, overwriting a slot or deleting one. Disposal prevents an outstanding read from activating a company after the dialog has closed. The dialog retains an accessible close control while operations run and while its list scrolls.

`app.js` activates a loaded or generated world only after writing its new autosave successfully. New-world generation paints a progress state before synchronous generation and disables duplicate submission. Atlas/minimap geometry follows the current world aspect ratio. Activation refreshes the renderer, minimap, camera, tool, route draft and filters, inspector and chain selection. Failed activation leaves the current company and prior autosave intact. The dialog pauses the simulation and periodic autosaving; the previous simulation speed resumes on closing. Named saves are independent snapshots and are not updated by periodic autosave or new-world generation.

## Map visibility

`visibility.js` defines thirteen independent display preferences: `trees`, `buildings`, `roads`, `rails`, `stations`, `names`, `industryIcons`, `vehicles`, `vehicleLoads`, `routes`, `zones`, `lighting` and `grid`. Defaults enable all except the grid. `layerPreset('all')` enables all thirteen, while `layerPreset('terrain')` disables all thirteen. Normalization accepts only known boolean fields. Browser persistence uses `transport-visibility-v1`, independently of both the active autosave and named game slots; read/write failures leave the current interface usable.

`visibility-view.js` and `visibility.css` present a nonmodal popover with native labeled checkbox switches, presets, keyboard support and outside/Escape dismissal. It reads current flags through callbacks and delegates changes to `app.js`, without touching simulation state. Opening this panel does not pause the game. Loading or generating a company retains the existing display preferences.

`renderer.js` applies scenery/network flags to cached terrain composition. Changing trees, buildings, roads, railways, stations or zones invalidates baked chunks across zoom levels. Names, industry icons, vehicles, load indicators, routes and the grid are live overlays. Vegetation includes forest sprites and plant details; rocks and mountains remain terrain. Buildings includes houses, civic structures and industry art. Roads, rails and stops remain independently controllable. Hidden vehicles never draw load indicators, while hiding only their loads retains the vehicles.

`getStats().layers` exposes a copy of renderer preferences alongside cache and vehicle-indicator statistics. Legacy `render(now, {showGrid, showRoutes})` arguments remain optional per-render overrides and do not rewrite stored preferences. The minimap and atlas reflect applicable scenery/network flags. Hidden industry icons no longer contribute extended inspection hitboxes; hidden stop badges likewise lose their extended map-picker hitboxes. Their actual tiles remain inspectable and all gameplay occupancy/network rules remain intact. Selection, coverage and construction previews are contextual interaction overlays rather than persistent layers.

## Rivers and shipping

World generation carves connected water channels with `detail: 'river'`, joins tributaries to the trunk rivers and connects river mouths to sea. A navigable river runs beside both starter towns, with shoreline berths within the existing five-tile catchment. Generated streets preserve water and mark crossings as bridges; building placement skips water. River detail uses the existing lossless detail palette without a save format change. Existing saved terrain is not regenerated.

`build(game, 'port', x, y)` creates a water-mode station on unoccupied water cardinally adjacent to land. Ports cannot overlap bridges or other structures. `findPath(..., 'water')` follows cardinally connected water, including bridge tiles, and requires no network flags. Ports share `stationCoverage`, freight recipes, passenger eligibility, route validation, load/unload and saved state with land transport. A ship costs $64,000 and carries 140 units; a port costs $18,000. Water travel uses a slower base speed with seeded weather, shoreline, bridge-approach and port-traffic effects; port loading pauses and upkeep use the same deterministic simulation clocks.

The route planner, filters, map picking, port inspector and save validation accept the water mode. Ship and ferry rendering respects the Vehicles and Cargo loads switches; ports follow Stops. Ships pass under the visible bridge deck, while road and rail vehicles render above it. Port badges retain the existing 14-pixel station hitbox, using an anchor rather than the bus/train letter.

## Annual economy and vehicle generations

`economy-pricing.js` derives Gregorian years from the same January 1950 epoch as the HUD. `inflationInfo(game)` returns calendar year, year index, the seeded annual rate and the compound price index. `priceFor(game, basePrice)` rounds the current price. Rates and unlocked vehicle levels derive from seed and simulation day, requiring no new persisted schedule. A bounded cached calculation handles far-future saves. Monthly financial reports use Gregorian month boundaries from the same epoch. Construction, clearing surcharges, purchases, upgrades, upkeep and delivery revenue share this pricing layer; arrival revenue uses the actual arrival day.

`getVehiclePurchase` quotes the latest generation. Each calendar year unlocks one level, increasing base capacity by 20% and base speed by 10% per level. `getVehicleUpgrade` and `getFleetUpgrade` provide read-only quotes; `upgradeRouteVehicle` and `upgradeFleet` perform authoritative affordability checks and mutate the eligible fleet atomically. Vehicles store `level` and `paidPrice`, and retain load, position, progress and dwell time when upgraded. Legacy vehicles default to level zero and their original base purchase price. Retirement returns 45% of paid price, including upgrades. The UI refreshes quotes with calendar and funds changes.

## Biome scenery and lighting

`BIOME_NATURE` in `terrain-sprites.js` shares tree, mountain and plant catalogs between seeded world generation and local ecology. Expanded detail strings preserve the seven gameplay terrain classes and use the existing tile codec. Habitat patches choose related species; new woodland often inherits nearby species. `isPlantDetail` identifies decorative vegetation for rendering and environmental calculations. Hiding trees removes foothill vegetation while retaining the mountain itself.

`tree-sprites.js` generates 64 deterministic woodland compositions per biome/detail, containing one to five trees with per-tree species, leaf coverage, height, placement and branch/crown seeds. Composition is independent of zoom; each profile only adjusts fine marks. The renderer hashes tile coordinates, world seed and the saved variant into the artwork seed, so legacy 16-variant maps gain the new art without changing save state. Forest canvases are 48×48 logical pixels (x −8…40, y −16…32); their crowns can overlap neighboring cells. Other sprites keep the 32×40 envelope. Chunk padding covers these overhangs.

`relief-sprites.js` draws irregular mountain crests, layered desert formations and fractured boulders. `terrain-sprites.js` separates geometry and texture streams for stable vegetation between zooms. Nature uses 64 cached variants, other art retains 12; the sprite factory has a 16 MiB LRU limit in addition to the chunk budget.

`lighting.js` derives a 60-second cycle at 1× from saved simulation day, beginning at noon. A smooth ambient tint and cached glow sprites render after terrain and before screen-space labels. Windows, lamps, port reflections, headlights and navigation lights obey the matching visibility flags; the Lighting preference disables the pass for constant daytime. Lighting never advances the economy or invalidates baked terrain chunks. `hasClearableDecoration` keeps Bulldozer placement previews and authoritative cleanup consistent.

## Simple construction and map controls

`construction-plan.js` adapts the five-tool interface to existing model operations. `resolveBuildTool` chooses bridges/tunnels for Road/Rail and a station mode for Stop; explicit legacy tools still pass through. `quoteBuildPlan` deduplicates tiles and calls the authoritative construction quote. `buildPlan` delegates every placement to `model.build`, preserving single-placement metadata and the existing partial-success path policy. Renderer highlights resolve through the same adapter. The active tool never changes save structure or simulation rules.

`app.js` owns compact zoom/options popovers and the active-tool Done control. Every tool/view/dialog change cancels captured gestures. The gesture stores the original tool; releases cannot apply a subsequently chosen tool. Single-object dragging pans, while line tools build on release. A second touch cancels construction, pans with the midpoint and advances at most one of the three zooms per pinch gesture; releases remain inert until all touches lift. Space retains native button behavior, and a pan cannot also toggle pause. `controls.css` keeps map targets at least 44px and moves secondary options behind menus.

## Playability and accounting

`gameplay-insights.js` derives optional next projects, truthful town service, industry input/storage states and actionable route health. It uses the simulation’s five-tile station catchment and capacity-dependent900-unit storage. The interface keeps search/filter inputs mounted during periodic entity refresh, returns explicit view changes to the top, and exposes building benefits in the catalog and inspector.

Passenger loading and delivery share `passengerEndpoints`, selecting a distinct pair of covered towns by nearest combined walking distance. Homes record `populationCityId` to retain population ownership after new towns are founded; outlying homes explicitly retain null. Housing creation and demolition share `housingCapacity`. A finished construction gesture refreshes network connections while paused.

`monthlyOperatingExpenses` separates upkeep from total cash expenditure. Routes accumulate allocated vehicle/station/network expenses; shared infrastructure is charged once, with unassigned infrastructure and factories left as company overhead. Legacy saves establish revenue baselines and accounting start days so historical fares are not compared with nonexistent historical upkeep. New worlds and loaded saves both write the next autosave before replacing the active game.

## Square-world persistence and material detail

`transport-procedural-v1` retains the generation descriptor and packed changed tiles. `rememberGeneratedWorld` stores an exact four-byte baseline per tile plus sparse extras in a WeakMap, using 16 MiB for 2048² without retaining a second object grid. Every save compares current fields with that baseline, preserving direct edits, unknown properties, nested fields and deletion/reversion. Changed indices use delta varints and existing UTF16 tile packing. Loading regenerates the explicitly versioned recipe, captures its baseline and applies patches. Legacy JSON and compact-v1 saves continue to decode. Metadata listing validates packed fields without regenerating a second continent.

`water-art.js` paints cached depth/bank detail in the water clip; small live ripples derive from simulation day. `raster-houses.js` supplies nine generated house designs per biome, with 256×256 transparent masters and prefiltered 16/32/64/128-pixel sprite cells. The runtime loads only the smaller atlases, choosing a cell size matching `32 × zoom × devicePixelRatio`. Artwork occupies a 32×32 square within the existing 32×40 sprite envelope. `lighting.js` uses hand-measured pane rectangles for each house and biome.

Startup waits at most four seconds for house and world artwork, loading both groups concurrently. Late arrivals increment a separate artwork revision, refreshing sprite/chunk caches and palette thumbnails without changing game state. Missing biome artwork falls back to taiga, then to `drawTownBuilding` when no complete atlas is available. Asset loading, downscaling provenance and prompts are documented in `assets/houses/README.md`. `processing-sprites.js` retains native factory/extractor fallback drawings; production rules remain in the economy catalog.

`world-v2.js` combines the terrain and placement recipes in `world-terrain-v2.js` and `world-placement-v2.js`. New square maps use recipe 3, which preserves recipe 2 terrain and expands industry sites to valid 2×2 footprints. `world.js` retains recipes 1 and 2 and the old rectangular sizes. Shared deterministic primitives live in `world-noise.js`. The save descriptor, baseline and validation carry the explicit generation version, so old companies regenerate their original geography. Never change a released recipe without introducing a new version and retaining existing digest fixtures.

## Generated world artwork and industry sites

`atlas-runtime.js` loads complete sets of prefiltered display atlases, selects a level for the actual render density, and notifies sprite, chunk, marine and palette caches when artwork arrives. It never mutates simulation state. `raster-buildings.js`, `raster-industries.js`, `raster-nature.js` and `raster-transport.js` share that registry and retain native fallback drawings. Original sources and prompt records are documented in `assets/world/README.md`.

`industry-sites.js` owns footprint geometry and validation. New industries use `footprint: 2`; absent or explicit `footprint: 1` preserves legacy extent. Every occupied tile resolves to the same industry for picking, demolition and overlap prevention. Station catchment uses the nearest site tile; environment access, production conditions and service-related upkeep sample the whole site. Industry artwork uses a 64×72 logical canvas for a two-tile site, with measured window anchors scaled accordingly.

`vehicle-directions.js` selects one of eight independently drawn frames for each of nine vehicle identities. Canvas angles start east and increase clockwise. Artwork stays in the fixed world camera while loads, route-color markings and lights follow the quantized heading. Each trailing train car uses its own path segment angle. Marine caches include heading and load band; art revisions invalidate their frames. Source normalization measures principal-axis length so diagonal views do not grow during turns.
