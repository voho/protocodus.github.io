# Transport

[Play Transport](https://protocodus.cz/fun/transport/) · [All games](https://protocodus.cz/fun/)

Transport is a single-player, top-down transport and city-building game. A new company starts with two connected towns and a running passenger bus. Extend that network into a profitable regional economy, then found towns and develop neighborhoods of your own.

## Your first connection

1. Find a producer and a matching customer, such as a logging camp and a sawmill in the taiga.
2. Build a continuous road or railway between them. Use bridges on water and tunnels through mountains. Clear occupied buildings before laying a connection.
3. Place a road stop or train station on the completed network within **5 tiles** of each industry. Stations need open ground; they cannot occupy a bridge or tunnel.
4. Open **Routes**, choose the transport mode and cargo, then choose two stations from the lists or pick them on the map. The planner checks the continuous network and cargo coverage before enabling launch. Buying a road vehicle costs $18,000; a train costs $78,000.
5. Vehicles load from the producer's inventory and earn money when they deliver. Connect the customer's output to the next factory or a town to extend the chain.

Passenger routes need two different towns within their stations' catchment areas. Every route operates one vehicle between two stops. A broken network stops the affected service until you repair it. Retiring a route sells the vehicle for 45% of the amount paid, including upgrades; retire services before removing their stations.

Use the route search and mode, status and cargo filters to find services in a large network. **Pick on map** selects a departure and then an arrival; only stations for the chosen transport mode are accepted. Cancel the picker or press Escape to return to normal map controls. The connection check updates as you change stops or infrastructure.

Resources use a shared set of 20 illustrated icons in industry recipes, inventories, station coverage and routes. Industry markers on the map show their output resource; hover to reveal the name or click the marker in Explore mode to inspect the industry. Recipe numbers show how much of each input a factory consumes and how much it produces. Choose cargo with the illustrated buttons in the route form; the field guide’s **Resources** tab includes a complete resource key. Hover a resource for its name and amount. Resource names and recipe quantities are also available to screen readers.

## Rivers and shipping

New worlds have connected, meandering rivers with tributaries and mouths that reach the sea. Both starting towns have a riverbank within their five-tile catchment. Town streets cross water on bridges, so they do not block navigation. Existing saves keep their original landscape; ships can use their lakes, rivers and seas too.

Choose **Port** in Build → Network, or press **P**. A port costs $18,000 and occupies an empty water tile directly beside land, away from bridges. Place two ports on the same connected waterway within **5 tiles** of the cargo source and customer. In Routes choose **Water · ship / ferry**, select the ports and cargo, and launch for $64,000. Ships carry 140 units; passenger cargo uses a ferry. No track or waterway construction is needed, and ships can pass beneath road and railway bridges.

Ship speed varies with weather, nearby banks, bridge approaches and port traffic. Ports and ships have running costs. Cargo follows the same industry recipes and town demand as road and rail freight, while passenger ferries serve different towns. Routes, port inspection, cargo indicators, local saves and map layers all support shipping. The **Stops** layer controls ports, and **Vehicles** controls ships.

## Yearly vehicles and prices

Every January 1 unlocks one new vehicle generation for roads, railways and ships. Each generation adds **20% of base capacity** and **10% of base speed**. In Routes, use a service's **Upgrade** button or **Upgrade all** for the entire eligible fleet. Upgrades jump to the latest available generation, retain cargo and journey progress, and require the full quoted amount. New routes buy the latest generation automatically. Vehicle cards show capacity and speed; upgrade tooltips show the improvement. The next model year appears above the fleet controls.

Inflation is a seeded **1–5% each year**, compounded from 1950 prices. It affects construction, vehicles, upgrades, upkeep and delivery fares. Hover or tap the finances to see this year's rate. Costs throughout the interface update with the calendar; prices quoted in this guide are starting prices. Selling a vehicle returns 45% of the amount actually spent on it, including upgrades.

## Controls and saving

Drag the map in **Explore** mode to pan; click a place to inspect it. Choose one of three views: **Region (50%)**, **Town (100%)**, or **Detail (200%)**. Scroll, press + / −, or use the zoom buttons to move one view at a time; click its percentage to select it directly. Click the minimap to travel around the region. Construction tools place a structure with a click or lay roads, tracks and zones with a drag. On a narrow screen, **Manage** opens the construction and management panel.

Balance, monthly profit, date and simulation speed share a compact header. Hover, focus or tap the balance/profit area to see delivered cargo and connected-town totals.

Open **Layers** on the map, or press **L**, to control trees and plants, buildings, roads, railways, stops, names, industry icons, vehicles, cargo loads, route lines, zones, day/night lighting and the grid. Buildings includes industry structures. Hiding vehicles also hides their load indicators. **Terrain only** shows bare ground, water, mountains and rocks; **Show all** enables every layer, including the grid. Selection outlines and construction previews remain available for building and inspection. The panel leaves the simulation running, and Escape closes it.

Layer settings change the view while the transport network and hidden structures continue operating. These browser preferences survive reloads and remain the same when creating or loading a different company; they are separate from game saves. A fresh browser starts with everything visible except the grid.

| Key | Action |
| --- | --- |
| R / T / S | Road / railway / road stop |
| P | Port |
| B / X | Road bridge / bulldozer |
| 1 / 2 / 3 | Residential / commercial / industrial zoning |
| Escape | Return to Explore |
| Space | Tap to pause or resume; hold while dragging to pan |
| Arrow keys | Pan the map |
| + / − | Zoom in / out |
| G / H / M / ? | Toggle grid / center on starting town / region atlas / field guide |
| C | Production chains |
| L | Map layers |
| Ctrl+S or Cmd+S | Open Load / save |

Woodland uses 64 arrangements per habitat, from a single mature tree to five-tree clusters. Pine, spruce, fir, broadleaf and mixed stands have varied heights, saplings, leafy crowns and bare branches; desert and tundra keep their own species. Crowns overlap tile edges to break up regular rows. Mountains, boulders, shrubs and ground plants also vary in shape, size and placement. This artwork updates existing saves when you reload.

Sprites and terrain are drawn at the resolution of each view, including high-density displays. Region emphasizes clear silhouettes, Town balances building detail and network planning, and Detail makes fine architectural and terrain features easier to inspect. Zooming toward the pointer keeps the same map location under it.

A smooth day/night cycle takes **one minute at 1×**, with warm windows, street and port lights, vehicle headlights and ship navigation lights. It follows simulation speed and pause, and resumes at the saved phase. Switch off **Day / night** in Layers for constant daytime.

Choose **Bulldozer** in Build → Network, or press **X**, then click or drag to clear buildings, tracks, roads, trees and decorative plants. Existing cities and stops serving active routes remain protected. Clearing ports or bridges leaves the water intact.

The simulation runs at 1×, 3× or 8× speed. One real second represents one day at 1×. You can build while paused, and dialogs pause the simulation while open.

The game autosaves to local storage immediately on opening, after construction and route changes, every 20 seconds, and when hiding or leaving the page. Reloading resumes the latest autosaved company. Hidden tabs do not advance the simulation, and there is no offline time progression.

Open **Load / save** with the save button, **Ctrl+S / Cmd+S**, or the save icon in the mobile management panel. Give the current world a name and choose **Save game** to keep an independent snapshot. The dialog lists each saved company's landscape, game date, balance and save time. You can load, rename, overwrite or delete named slots. Loading, overwriting and deleting ask for confirmation; loading replaces the active world and its autosave. Named snapshots change only when you overwrite them, so generating a new world preserves your other companies.

The latest autosave also appears in the dialog as a load-only checkpoint. The simulation and periodic autosaving pause while the dialog is open. Huge-world snapshots use compact, lossless tiles and browser compression when available. Save capacity depends on the browser's available storage; failed writes report an error and preserve existing saves. Slots are local to this browser and device, and clearing browser storage removes them.

## Worlds and industry

New companies default to a **512 × 384 tile Huge world** (196,608 tiles, about 27 times the original area), with 32 towns and 60–72 industry sites. The new-world dialog also offers Regional (128 × 96, eight towns) and Large (256 × 192, sixteen towns). Each world has meandering rivers, tributaries, lakes, a coastline, mountain ranges and valleys. Taiga adds spruce, fir, birch, oak and aspen around granite peaks and wooded foothills, with bluebells, ferns and berry bushes. Tundra has larches, dwarf birches and pines, ice peaks and glaciers, with arctic poppies, cotton grass, heather and lichen. Desert adds palms, acacia, Joshua trees, mesas and buttes, with agave, aloe, prickly pear and desert flowers. Reeds and other plants follow local moisture, and tree species spread gradually from neighboring woodland. Each environment has its own colors, towns and industry catalog. Entering the same seed, environment and size recreates the same starting world. Open the region atlas with **M** or the minimap heading, then click a location to travel there. Existing 100 × 72 saves continue to load at their original size; choose **New world → Huge** for the larger landscape.

| Environment | Simple chains | Longer production chains |
| --- | --- | --- |
| Taiga | Timber → lumber; grain → food | Coal + iron ore → steel; lumber + steel → furniture; steel + fuel → machinery |
| Tundra | Fish → food; oil → fuel | Coal + iron ore → steel; steel + fuel → goods or machinery |
| Desert | Stone → cement; copper ore → wire; grain → food | Sand + fuel → glass; glass + wire + cement → goods |

Oil wells, refineries and quarries are available in all environments. Extractors generate raw materials; processors consume their recipe ingredients to produce finished cargo. Deliveries move inventory between industries. Food, furniture, goods, fuel, stone, cement and machinery can supply towns.

The **Chains** explorer connects recipes into a complete production graph for the current environment. Select an output to follow its ingredients back to the raw materials, or show every industry. Select a factory type to see every matching site in the world, then use **Locate** to center the map and inspect it. An industry's inspector lists customers for its outputs and the five closest matching destinations, including towns when they accept that cargo. These distances are straight-line planning aids; routes still require connected roads, railways or water and stops within five tiles of the actual source and destination.

The world changes through slow, local updates. Factories work on staggered days; output and expansion depend on their surroundings, ingredients and deliveries. Forests help logging camps, water helps farms, mineral ground helps mines, and road or rail access helps factories. Weather changes productivity and travel. Industry capacity is reviewed at varied intervals, so factories do not expand together on the first day of each month.

Vehicles vary their pace with local conditions and pause to load at stops. Vehicle and infrastructure upkeep continues between deliveries. Monthly accounts still close every 30 simulation days. Purchases count toward those expenses, so a large construction project can temporarily make a profitable service's monthly balance negative.

Each vehicle has a small load meter above it. Loaded vehicles show their resource icon, including passengers; a full green meter means full capacity, an amber meter shows a partial load, and an unfilled meter means empty. These indicators stay readable in all three zoom views.

## Grow your towns

Recent passenger arrivals and cargo supplies create demand for gradual growth. Roads, neighboring homes, shops and local services help neighborhoods fill in; greenery improves residential surroundings, while nearby industry discourages housing. Development happens in small, staggered steps. A new town costs $45,000 and needs level land at least 11 tiles from another town center.

Place residential, commercial or industrial zones near a town, then provide nearby roads and transport service. Isolated zoning stays vacant. Residential buildings house more people, commercial buildings support the town, and industrial zones increase local activity. Cargo-producing mines and factories are separate buildings in the industry catalog. Existing buildings remain in place when development stalls.

Nature also changes gradually: neighboring vegetation, moisture, climate and development influence local succession. It spreads in small steps and preserves roads, stations, industries, buildings and designated zones. The same seed and actions reproduce the same future; simulation speed and frame rate do not change the random outcomes. Saving preserves production schedules and vehicle loading waits.

## Building variety

**Development** offers zoning and an illustrated catalog of 26 directly placeable building designs. Generated towns contain these same buildings, and residential/commercial zoning develops varied houses, shops and services over time.

| Collection | Designs |
| --- | --- |
| Affordable homes | Workers’ cottage, timber cabin, terraced cottage |
| Comfortable homes | Gabled family home, brick villa, garden bungalow |
| Prestige homes | Country manor, grand townhouse, courtyard villa |
| Community | School, hospital, police station, fire station, stadium, church, village pub |
| Shops | Grocer, bakery, butcher, hardware shop, florist |
| Services | Post office, bank, hotel, garage, barber |

These buildings share the original miniature sprite style. Residential zoning moves through the three housing tiers as it develops. Community buildings and services improve local development conditions; the game does not simulate individual education, crime, disease or fire incidents.

## Scope

Transport uses a compact economic simulation with two-stop routes, one vehicle per service, and automatic vehicle movement. Road vehicles, trains and ships can carry passengers or freight, with different speeds, capacities and costs. Road and rail crossings are allowed. There are no signals, collision management, competitors, multiplayer, terrain sculpting, canals or vehicle timetables. Bridges and tunnels are built per tile across the relevant terrain.

## Run locally

Serve the repository root with any static HTTP server, then open `/fun/transport/`. There is no build step and no runtime dependency to download.

```sh
python3 -m http.server 8000
```

Transport and simulation timing live in `model.js`, production in `industry-simulation.js`, local nature and weather in `environment.js`, and town development in `settlements.js`. The catalogs live in `data.js` and `buildings.js`; `world.js` generates the map. `zoom.js` defines the three shared view scales. `renderer.js` composes nearby terrain in bounded cached chunks rather than allocating full-world images; `sprites.js`, `tree-sprites.js`, `relief-sprites.js`, `building-sprites.js`, `terrain-sprites.js` and `marine-sprites.js` draw the art. `save-codec.js` packs the tile state losslessly. `app.js` connects the interface and input to the simulation. All game logic uses native JavaScript modules.

Run the simulation checks from the repository root with a recent Node.js version:

```sh
node --test fun/transport/tests/*.test.mjs
```

The checks cover seeded worlds, construction, connected deliveries, production conservation, local development and ecology, frame-independent random outcomes, huge-world simulation costs, and save validation and continuation.

The optional browser smoke uses Playwright and an installed Chrome browser. With the server running on port 8000:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/browser-check.mjs
```

Set `TRANSPORT_PLAYWRIGHT` to an absolute Playwright module path if it is not installed in the current Node environment. The smoke exercises desktop construction and routes, saving and reloading huge worlds, all building collections, civic placement, atlas navigation, rendering cache limits, biome generation, the delivery milestone, and mobile management and navigation. It writes screenshots to `/tmp/transport-qa` by default.

The focused autosave check waits for a real timed write, leaves the page, and verifies automatic restoration without pressing Save:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/autosave-browser-check.mjs
```

The focused zoom check exercises every zoom input, wheel gestures, pointer anchoring, tile picking, high-density rendering, resizing, cache limits and construction invalidation at all three views. It saves desktop and mobile screenshots to `/tmp/transport-zoom-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/zoom-browser-check.mjs
```

The focused resource check covers the illustrated key, recipe quantities, inventory and station symbols, clicking map markers at all three zooms, construction beneath markers, selecting and delivering freight, and readable layouts at desktop and 390/320px mobile widths. It saves screenshots and an icon contact sheet to `/tmp/transport-resource-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/resources-browser-check.mjs
```

The focused network-planning check covers complete production graphs, industry locations and nearby customers, route searching/filtering, selecting stations on the map, live network verification, vehicle load indicators at all three zooms, and compact desktop/mobile layouts. It uses isolated browser storage and writes screenshots to `/tmp/transport-features-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/features-browser-check.mjs
```

The focused save-slot check creates distinct companies, switches their complete state, checks active autosave restoration, and exercises rename, overwrite, delete/cancel, damaged data and storage failures. It also checks reload persistence and the mobile dialog at 390/320px. Browser storage is isolated from your saves; screenshots go to `/tmp/transport-slots-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/slots-browser-check.mjs
```

The focused Layers check compares rendered pixels for all 13 switches at every zoom, verifies restoration and overview rendering, checks hidden industry/stop marker picking and unchanged game state, and covers preference persistence and recovery, blocked storage, synchronized map buttons, keyboard controls and mobile layouts. It uses isolated browser storage; screenshots go to `/tmp/transport-layers-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/layers-browser-check.mjs
```

Shipping has a focused browser check for building ports on generated rivers, map picking, ferry deliveries, search/filtering, disconnected lakes, save restoration and mobile layout:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/shipping-browser-check.mjs
```

The annual-economy browser check verifies individual and fleet upgrades, affordability, price display, save restoration and clearing decorations:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/evolution-browser-check.mjs
```

Marine and lighting rendering have focused checks in `tests/shipping-renderer-check.mjs` and `tests/daynight-renderer-check.mjs`.

The nature check renders woodland contact sheets and wilderness views in each biome at all three zooms and DPR 1/2, measuring clipping, transparency, Layers restoration, cache reuse, construction and save compatibility. It writes artifacts to `/tmp/transport-nature`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/nature-browser-check.mjs
```
