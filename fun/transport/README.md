# Transport

[Play Transport](https://protocodus.cz/fun/transport/) · [All games](https://protocodus.cz/fun/)

Transport is a single-player, isometric transport and city-building game for computers. A new company starts with two connected towns and a running passenger bus. Extend that network into a profitable regional economy, then found towns and develop neighborhoods of your own.

Play with a keyboard and mouse or trackpad in a desktop or laptop browser. Phones and tablets display `please use computer to play the game` before the game starts. This computer-only decision was made on 2026-10-06 and is recorded in [AGENTS.md](./AGENTS.md).

## Start a company

The game opens at its main menu. Choose **New world**, pick a landscape and a map size, and press **Create world**; hover it to see that it replaces the autosave while named saves stay. **World options** holds the rest: the number of towns and of industry districts, each district a complete set of production chains (the fold shows the total industry count), the starting funds and the seed. **Starting funds** sets how much money the company begins with: **Relaxed · $400k** (recommended, and the default), **Standard · $200k** or **Lean · $100k**. Even a lean company can afford its first road route, and nothing else changes with the choice. The **World seed** lets you recreate a landscape with the same settings.

When this browser holds an autosave, **Continue** heads the menu with its landscape, game date and how long ago it was saved; one click reopens that company. Choose **Load game** to open the autosave or a named local save; each lists its landscape, game date, balance, map size and routes. Opening the menu alone does not generate a map or overwrite a save. Creating a new world replaces the autosave after a successful write; named saves remain unchanged. During play, **Game menu → Main menu** pauses the company and offers **Resume**, New world and Load world.

The main toolbar puts **Road**, **Rail**, **Stop** and **Clear** one click away, with their R/T/S/X keys and a clear selected state. **Network**, **Buildings**, **Industry** and **Terrain** open compact tool pickers. Buildings separates **Zones & towns** from **Place buildings**; Industry separates **Suppliers** from **Factories**. Each picker links to related activities. **Routes**, **Industries** and **Towns** open browsing views. Labels fold to icons in narrower computer windows; unusually narrow windows can scroll the navigation rail while money, time and Menu remain accessible.

**Menu** shows one short group at a time: **Game**, **Company**, **Map** or **Help**. Company reports separate overview, history, routes, property and loans. Guide separates building, routes, growth and resources, with buttons that take you straight to the activity. Saved games starts with **Save current**; switch to **Load worlds** to browse saves. Inspectors keep the next action visible and place stock, conditions, buyers and other detail in sections that remember whether you opened them. A route card keeps a priced **Add vehicle** button and current earnings visible, with direct **Map**, **Edit** and **Manage** actions. Manage separates optional **Fleet** and **Earnings** detail. Starting a route from a stop immediately asks for its destination on the map; **Choose from list** offers the dropdown alternative. **Layers** opens directly from the map with six **Essentials** and a separate **More layers** view; closing it returns to the current management screen and preserves the draft. Related actions use the same labeled, rounded button style throughout. See [UI-FLOWS.md](./UI-FLOWS.md) for navigation and keyboard behavior.

## Your first connection

1. Follow **Next goal** at the top right of the map for a nearby suggestion, or find a producer and a matching customer yourself, such as a logging camp and a sawmill in the taiga.
2. Open **Network**, choose **Road** or **Railway** (or press **R** / **T**) and drag between them. Water automatically becomes a bridge and mountains become tunnels. Clear land is leveled where necessary and safe; the preview shows the full price and how much of it is for leveling. Usable straight slopes stay as they are, with no leveling charge. When the plain L cannot be built safely, the drag can bend the other way or step around obstacles, reusing existing roads or tracks, and the tip adds **follows terrain**. Hold **Shift** while dragging to keep the plain L, bent along the direction you drag first. Blocked or unaffordable strokes leave both the network and terrain unchanged and cost nothing. Read the refusal in the tip, then choose another path or drag in shorter segments. The tool stays selected after each stroke, ready for the next segment; use Done, Escape or right-click when finished.
3. Choose **Network → Stop** or press **S** and click the completed network within **4 tiles** of each industry, or inspect a road/railway tile and use its priced **Build road stop** / **Build rail station** action. The tool selects a road stop or train station from the tile; at a road/rail crossing, use the small Road/Rail choice. Stations need open ground; they cannot occupy a bridge or tunnel.
   While you place it, a ring shows its 4-tile reach: industries it would reach get a green tick and the others fade, and your other stops of the same kind show their reach faintly, so gaps and overlaps are easy to see.
4. Open **Routes → New route**, choose the start and end stops from the lists or on the map, then choose a cargo supplied at either stop. The start determines transport. The name fills with the towns and cargo unless you override it; choose the vehicle count, review total cost and monthly revenue/net estimates, then buy and launch. A connected draft blinks on the map. A road vehicle starts at $18,000 and a train at $78,000.
5. Vehicles load from the producer's inventory and earn money when they deliver: longer trips pay more, and very slow ones keep less (see **Delivery pay**). Connect the customer's output to the next factory or a town to extend the chain.

The **Next goal** card suggests one optional project at a time. For the first cargo route it names a producer and a buyer that stops can actually serve, then ticks a checklist as you work: a stop near each site, a connection, a launched route and its first delivery. The card has one button: **Plan road** while the game can plan the line, otherwise the open step's own action. The open step's label runs that step too: it frames both sites and picks Road, Stop or Port, or opens Routes with the stops and cargo already chosen. Until the two sites are joined, **Plan road** does the first three steps in one go: it previews a road that follows the terrain from a stop beside the producer to a stop that already serves the buyer, reusing its roads, or to a new stop beside the buyer, and a banner such as *Road 6 tiles + 1 stop · $10,160 · then a truck $18,000* waits for **Build** or **Cancel** (Escape or choosing a tool also cancels). Nothing is spent before Build. Build lays the road and stops in one step, which one **Undo** takes back until a route uses them, then opens Routes with both stops and the cargo chosen, so only **Launch route** remains. It is offered for this first route and again for the two freight goals after it, supplying a factory and carrying its output onward, whenever both sites can be reached by land; later connections are yours to lay out. **Another idea** offers up to two other nearby pairs. Later goals follow your company: 100 cargo deliveries, supplying a factory, carrying its output onward, growing a neighborhood and then the company goals below. Passenger and mail fares never count. During the first route the card shows its checklist and the sentence behind it waits in the title's tooltip. After the first route the goal is one line under the top bar: a flag, the goal, its figure such as *96 of 100* and a thin orange progress line along the bottom. Click it to open the card with the goal's detail and its action; taking the action folds it back to one line. The chevron at the card's top folds it too. Folding the card keeps it folded, even after a reload; new goals only update the line, which takes a soft orange tint until you open it again. Opening a drawer or inspector temporarily hides the goal at every window size; closing it restores the same open or folded state. Switching off **Next goal** in Map layers removes it until you turn that layer back on.

## Company goals

Sixteen optional challenges in four chapters mark how your company grows, and each pays a one-off cash reward when you reach it. **Getting started**: a first freight delivery, 100 freight deliveries, a factory at work and supplies (food, goods, furniture, machinery or fuel) for a town. **A growing network**: five towns served, a 30-tile railway, a first ship service, a $25,000 month of operating profit and an industry grown to 200% while you carry its output. **Thriving towns**: a town you serve reaching 2,000 residents, prestige homes in a residential zone and a town you founded yourself, once served. **A transport empire**: 10,000 freight deliveries, a $100,000 month, twenty towns served and a full production chain, from raw material through two factories to a town. Passenger and mail fares never count as freight, and profit goals use 1950 prices that rise with inflation.

Milestones count whenever you reach them, in any order. A chapter is complete when all but one of its goals are done, so a goal you don't want, or one your map makes awkward, never holds you back. Rewards grow with the chapters, in 1950 dollars that rise with inflation: $10,000–$25,000 for getting started (enough for another truck), $40,000–$60,000 for a growing network, $60,000–$100,000 for thriving towns and $200,000–$250,000 for a transport empire, about $1.5 million in all. A goal pays once, at the prices of the day you reach it, and unlocks nothing. Rewards arrive in the balance beside fares rather than among them, so the finances card lists **Goal rewards** this month and they never count toward operating profit or a profit goal. The **Next goal** card ends its sentence with the reward of the goal it is helping you toward, including the first route, the first 100 deliveries and supplying a factory. Once the first-route suggestions are behind you, **Next goal** offers the first open milestone of the lowest open chapter with its progress, and **Another idea** cycles through the rest of that chapter. **Game menu → Company goals**, or **Company goals** at the foot of the card, lists every chapter with the date each milestone was reached and progress toward the others.

A milestone is announced once, with its reward and a **Goals** button, and at most one a game month; the first freight milestone joins the first-delivery notice instead of adding its own. Later milestones that month still pay, and appear in News and Company goals only. Company goals shows each open goal's reward at today's prices. An older save takes in the milestones it has already met, without announcements or rewards, on its first day after loading.

Passenger and mail routes need two different towns within their stations' catchment areas. Every route runs one or more vehicles between its two stops. A broken network stops the affected service until you repair it; connection status updates even while paused. Route cards explain missing producers, buyers and factory inputs, say when a buyer's stores are full (its deliveries still pay), and show this year's profit after route upkeep. Demolishing the only producer or buyer a freight route relies on warns you at once, naming the stop to build a new one near. They judge catchment like the Stop tool: an industry counts when any of its tiles is within that stop’s reach. New road stops, rail stations and ports reach 4 tiles. Existing stops in older saves retain their 5-tile reach; airports retain 7 tiles from their full site. Retiring a route sells its vehicles for 45% of the amount paid, including upgrades; retire services before removing their stations.

Capacity is the biggest lever on a busy line. On a route card or in **Manage → Fleet**, the priced add button buys another vehicle at the current price and **−** sells one for 45% of what it cost, including upgrades; the oldest generation goes first, then the emptiest, and any cargo aboard is lost. The last vehicle stays until you retire the route. A new vehicle starts in the middle of the widest gap in the round trip, so a fleet spreads out instead of running as a convoy. **Waiting** on the card counts the stock at the start stop's producers, or the passengers in the quieter of the two towns; the town inspector shows each town's waiting passengers. Once a route has run for a month and two full fleet loads (at least 50) wait at its start, or four in each of its towns, a quiet *Room for more* under its vehicles (the count is on the **Waiting** tag beside it); point at it to see about how many more another vehicle would carry a month. A running route's explanation, such as *Passengers travel both ways.*, is the Waiting tag's tooltip; a route with a problem keeps its reason on the card. It is only a hint: the route still reads *Running*, and nothing counts it as a problem. Next to this year's profit, the card shows the monthly average since the route's accounts began, and last year's profit once a year has closed.

**Routes** opens the service list. **New route** and **Edit route** have separate screens, while **Manage** opens only the selected service with separate Fleet and Earnings views. **Back to routes** returns to browsing. Use the route search and mode, status and cargo filters to find services in a large network. In **New route**, choose the start stop from the list or with its **Map** button. The start determines the transport; the end list and map picker then accept only matching stops. Cancel the picker or press Escape to return to normal map controls. The connection check updates as you change stops or infrastructure.

**New route** starts with fresh stops, an automatic name, one vehicle and default orders. Opening it from a stop starts with that stop selected. When a second compatible stop is missing, the planner explains where to place it and offers **Build road stop**, **Build rail station**, **Build port** or **Build airport**. Choosing that tool spends nothing. Cargo that cannot run on the selected connection has a readable explanation and a **Change stops** action; selecting it opens the explanation. Live changes to cargo availability preserve your draft, focus and text selection.

Every route has a number and a line colour, like a transit map. The number is its own for as long as it runs: route 2 stays route 2 when others open or retire, and a new route takes the lowest free number, so retiring route 2 lets the next route be route 2. A new route takes a colour that no route at its stops wears, the one fewest of your routes use, so lines that meet always differ; colours never change afterwards. The nine colours alternate deep and light and leave out green, teal and orange, which belong to the land, the water and the map's own marks. A route shows as a numbered bullet in its colour, shaped by its transport: a rounded square for road, a circle for rail and a pill for water. Companies saved before numbers get them on loading, oldest route first, and keep their colours: the old teal, for example, now reads as Cobalt.

Route lines follow each service over its roads, railways or water in its line colour, a deep colour on a paper halo and a light one on a thin ink edge, so every line reads on grass, roads and rivers. Freight lines carry small chevrons pointing from the loading stop to the delivery stop; they keep pace with the game speed and hold still while paused. Point at or tab into a route card to light its line above the buildings and dim the others, even with route lines hidden. **Show** turns route lines on, fits the whole route on screen at the closest view that holds both stops, rings them and lights the line for a few seconds. A disconnected route fades to a pale line whose first gap is dashed red, with a cut mark and a **Not connected** plate. A route that cannot run at all, because it is disconnected, lost a stop or has no producer, buyer or second town in reach, names its problem in orange on its card, and the top bar shows *1 route needs attention* (on narrow screens just the count) until it runs again. Click it to list just those routes; the **Needs attention** status filter shows the same list. A route waiting for cargo, or with more waiting than its vehicles can carry, still runs and never counts.

**New route** opens a focused planner separate from the route list. First choose the start and end stops, then choose cargo, then choose how many vehicles to buy. Cargo choices include only what either stop supplies, including producers whose stores are temporarily empty; a cargo the other stop cannot receive explains what is missing and cannot launch. Once cargo is chosen, the stops collapse to a compact summary with **Change stops**. The name fills automatically with the towns and cargo, such as *Alderbrook to Pinehaven — stone*, falling back to the served sites or stops where no town is nearby. Type a name to override it; clear it or use **Use automatic name** to restore the suggestion. Another route with the same name adds a number. Choose a whole number of vehicles and **Buy & launch** to buy them together. If this service already exists, the planner instead buys that many vehicles for the existing route and keeps its name and full-load order. After a launch or fleet purchase, Routes opens only that service’s details. Saving an edit opens the same focused details screen; **Back to routes** returns to the full list. A connected draft draws a gently blinking dashed route and endpoint rings on the map, including while paused or with route lines hidden. Both stops are framed in the visible map clear of the drawer, goal card and other controls; reduced motion keeps the preview steady.

To move a service instead of replacing it, choose **Edit** on its route card. The planner opens as **Edit route** with the route's stops and cargo. Pick another start or end, on the map or from the lists, or another freight, then **Save changes**. The same vehicles carry on with their generation and paid price, so nothing is bought or sold and the edit is free. The transport stays fixed, and passenger and freight services never swap, since buses and trucks differ; mail keeps its own route too. A new freight leaves the old load behind, so the game asks first when vehicles have cargo aboard. From the edit on, the card counts net earnings afresh, while its moved total stays. A route still named after its stops takes the name of the new ones; a name you chose stays. **Cancel** leaves the route as it was.

**Full load** is optional and off for every route. For a freight route, open **More options** when you plan or edit it and tick **Wait for a full load**. Its vehicles then wait at the stop where they load until they are full, the earliest arrival first, and never longer than a month. A waiting vehicle costs 45% of its usual running cost, as on a broken route, so full load pays when a route has more vehicles, or bigger ones, than its supplier can fill. A line of waiting trucks means you could sell one. Waiting vehicles load before other routes that share the same supplier. Waiting counts toward delivery time, so time-sensitive cargo earns a little less after a long wait. Passenger and mail routes always leave as soon as they have loaded. While vehicles wait, the route card reads *Loading* with the first one's load, such as *Waiting for a full load, 12 of 24, with 2 more in line*, and a waiting vehicle's card names the stop it waits at. The forecast counts the days a vehicle would stand and its lower running cost while it does.

The planner always keeps purchase cost and approximate monthly revenue and net profit in its footer, with guidance until the stops and cargo are ready. The quote updates with the requested vehicle count: output limits revenue, while every vehicle adds upkeep. Payback or a likely-loss explanation appears when an estimate is available. Running costs are a large share of fares, so a long route with a cheap cargo or an underused train can lose money; the estimate counts the coming season's weather the way upkeep is charged. It averages the next six months: a served mine, farm or other raw producer grows while its output is carried away; a factory is limited to what it made lately or what your routes bring it. Folded **Estimate details** shows source output, supply left after other fleets, vehicle capacity, running cost and the fare and length of a trip. When adding to an existing service, the estimate covers only the additional vehicles and uses that service's full-load order. Editing costs nothing and estimates the retained fleet on the proposed connection. Every figure is approximate because weather, traffic and deliveries vary; a poor estimate never blocks an otherwise valid purchase.

Inspectors lead straight to a route. Every route, stop, town and industry a panel names is a link: pointing at it lights it on the map, a click on a route frames it and opens its own details in Routes, and anything else is framed and inspected, with a **Back** line to the inspector you came from. A stop lists the routes here with their vehicles and state, and after six the rest open in Routes. Click a resource under its **Loads** to ship it from this stop, or under **Accepts** to deliver it here: Routes opens with the stop and cargo chosen and asks for the other end on the map. A line below names the towns and industries the stop covers. An industry names the stops within its reach and how many routes carry its cargo, with each route's bullet, and under **Supplied by** the two nearest sites producing each of its inputs, with their distance. A town names the stops that reach it and the routes that call there. **Plan route from here** starts its first output at the nearest stop, and a factory adds **Supply** for each input; with no stop in reach, **Place a stop nearby** picks the Stop tool at the site. A nearest target gets **Plan** once stops of the same transport reach both ends; it fills both stops and the cargo. A road or railway lists the routes running over it and says whether a road is public, with no upkeep, or your own. When the end is already chosen, picking the start on the map completes the pair. The Bulldozer names the routes that still use a stop, such as *Retire Line 1 before removing this road stop.*

New stops take the name of the nearby town or site and a number, such as *Alderbrook Stop 4*, and never repeat a name already on the map. To rename a stop or a route, click the pencil beside its name: in the stop's inspector, or on the route card, where it appears when you point at the title. Type up to 36 characters, then press **Enter** or click elsewhere; **Escape** keeps the old name. Route cards, the planner's stop lists and route search use the new name at once. Older saves can hold two stops with one name; the planner lists each with its tile, such as *Rural Stop 3 · 41, 17*.

Resources use a shared set of 24 illustrated icons in industry recipes, inventories, station coverage and routes. Industry markers on the map show their output resource; hover to reveal the name and state, such as *Steel mill · Needs coal*, or click the marker in Explore mode to inspect the industry. Recipe numbers show how much of each input a factory consumes and how much it produces. Choose cargo with the illustrated buttons in the route form; the field guide’s **Resources** tab includes a complete resource key. Hover a resource for its name and amount. Resource names and recipe quantities are also available to screen readers.

Markers also show your service at a glance. A site that one of your freight routes loads at or delivers to is ringed in that route's colour; passenger and mail stops never count. From the Town view in, a thin dark bar along the bottom of each marker shows how full its output store is; it turns amber-brown from 90% full. A factory your route supplies that still lacks another input shows those inputs as small amber-edged icons under its marker, or an amber dot in the Region view. The mini map marks served sites in green, or amber while such a factory waits, and **Industry icons** in Map layers carries a short key.

A marker normally sits just in front of its site. When that spot lies on a neighbouring site or a large building such as a stadium, or is taken by a town name, a stop sign or another marker, the marker moves onto its own building, or else just beside the front on a thin stem, so it never stands on another site. Markers keep their places as you pan the map.

To see where a freight cargo comes from and where it can go, click it in the route form, choose an industry type in **Industries**, or use **Locate** in **Chains**. The map then lights its producers with a green ▲ tab and its buyers with a teal ▼ tab; other industry markers fade to half strength. From the Town view in, the lit sites show their names, and when towns buy the cargo, each town name carries its icon. The atlas and mini map mark the same producers and buyers as green and teal squares and ring the buying towns. A chip beside the zoom control reads *Showing iron ore*; its × or Escape turns the highlight off. A highlight chosen in Routes also ends when you choose Passengers or Mail or the planner sets another cargo, launch the route, fold the planner, close the drawer or switch views, and one from Industries ends with **All industries**, another view or closing the drawer; picking stops on the map or locating a listed site keeps it. One from Chains stays until you clear it or choose another. The highlight is only a view: it is never saved and never changes the cargo you launch.

## Transport contracts

After your company's first freight delivery, **Contract offers** appears in Routes below Fleet upgrades, folded until you open it. At the start of each month up to three offers name a producer the world generated and a buyer 20 to 70 tiles away that no running route serves yet: a factory that uses the cargo, or a town for town cargo. Each offer shows the distance, how many times the normal fare its deliveries will pay, such as *2.7× fares for 12 months*, and when it lapses. **Show** frames both sites and inspects the producer.

Any route that loads the cargo at that producer and delivers it to that buyer wins the contract with its first delivery; for a town, the delivery must reach that town. For the next 12 months every delivery on the route pays its normal fare plus the bonus, and the income rising above its stop includes it. Longer hauls earn a larger bonus, so a served contract earns more per vehicle than a short local route. The route card shows the route's normal monthly net and the bonus side by side, such as *≈ $2.1k + $4.5k bonus*; hover it for the end date. The offer list marks the contract as won and tells you what normal fares will bring afterwards. When the year is up the route keeps running at normal fares. Retiring the route, or losing either site, ends the contract.

Contracts are entirely optional and nothing is lost by ignoring them. Offers appear and lapse without a notice; only a won contract and a finished one, with the extra it earned, are announced. Industries you build yourself are never the producer, and route forecasts count normal fares only.

## Rivers and shipping

New worlds have connected, meandering rivers with tributaries and mouths that reach the sea. They gather rain from their watersheds, so they grow downstream, fill basins as lakes and carve valleys with floodplains; tundra plains are dotted with ponds, and a desert river arrives from beyond the map edge with a green belt along its banks. Both starting towns have a nearby riverbank. Town streets cross water on bridges, so they do not block navigation. Existing saves keep their original landscape; ships can use their lakes, rivers and seas too.

Road and railway bridges have raised decks, guardrails and piers above the water. Route lines follow the bank ramps and continue across each deck beneath the vehicles. Existing crossings gain the same appearance without rebuilding them.

Vehicles remain visible as their bodies cross each deck joint, and train carriages keep their correct overlap in both directions. Bank approaches join the deck smoothly.

Choose **Port** in **Network**, or press **P**. A port costs $18,000 and occupies an empty water tile directly beside land, away from bridges. Place two ports on the same connected waterway within **4 tiles** of the cargo source and customer. In Routes choose **Water · ship / ferry**, select the ports and cargo, and launch for $64,000. Ships carry 140 units; passenger cargo uses a ferry. No track or waterway construction is needed, and ships can pass beneath road and railway bridges.

Ship speed varies with weather, nearby banks, bridge approaches and port traffic. Ports and ships have running costs. Cargo follows the same industry recipes and town demand as road and rail freight, while passenger ferries serve different towns. Routes, port inspection, cargo indicators, local saves and map layers all support shipping. The **Stops** layer controls ports, and **Vehicles** controls ships.

## Airports and flights

Air travel arrives on 1 January 1952. Before then the **Airport** card in **Network** waits with its year, and **A** only says when; a company already past 1952 can build at once. The first January of air travel brings the news once, during play, as a headline with **Build an airport** (or a notice when headlines are off); loading a save never replays it.

Choose **Airport** in **Network**, or press **A**. An airport costs $60,000 and needs a clear, dry, level 6 × 2 site: a runway, an apron with two stands, a 1950s terminal with a control tower, a hangar, a fuel depot and a windsock. The site follows the pointer, a dashed outline shows its reach, and the tip names the towns it will serve. Press **A** again, or **Turn** on the tool bar, to turn the runway between east–west and north–south. Level a slope first with **Terrain → Level area**.

An airport serves towns whose centre lies within **7 tiles** of any of its tiles. It carries passengers and mail, never freight, and serves no industries. Click any of its twelve tiles, or its sign above the terminal, to open it; in the route picker any airport tile picks it.

In Routes choose **Air, plane** and two airports at least **16 tiles** apart. No road, track or waterway is needed. Planes fly straight, land, roll out, taxi to a stand, board, taxi back and take off the other way; each visit takes about a day and a half on the ground. A plane's card says what it is doing: landing, taxiing, boarding, taking off, or heading to the next airport with the tiles still to fly. **Follow** stays with it on the ground and in the air.

A plane costs $150,000 and carries 40 passengers in 1950 terms, 56 on its 1952 debut, and grows with the yearly generations like every vehicle (the Aldwyn series first, the Corvane from 1963). It flies 12 tiles a day, more than twice as fast as a train, and costs more to run; an airport's upkeep is shared by the routes that use it. Fares count the grid distance between the airports, as for every route, so a diagonal flight arrives sooner for the same fare. Planes shine on long routes; short hops suit buses and trains.

Running costs are all there is to it: there are no crashes, delays or noise complaints, and planes may share a stand for a moment on a busy apron. An airport a route uses cannot be bulldozed; retire the route first, then one click clears the whole site for one charge.

In Layers, **Stops** controls airports, **Vehicles** planes and their shadows, **Cargo loads** their badges and **Route lines** the dashed flight paths.

## Yearly vehicles and prices

Every January 1 brings the next mark of every vehicle: **20% more base capacity** and **10% more base speed**. Buses, trucks, passenger trains, freight trains, ferries, cargo ships and, from 1952, planes each follow their own fictional series (the Hollin bus, the Rowdon freight train, the Aldwyn plane…), and every decade or so a new series takes over: 1961's bus is the Pendle Mk 1. The route planner, route cards, upgrade tooltips and the vehicle card name each model; the vehicle card also shows its model year and age. In Routes, use a route's **Upgrade** button or **Upgrade all** for the entire eligible fleet. Upgrades jump to the latest model, retain cargo and journey progress, and require the full quoted amount. New routes and added vehicles buy the latest model automatically. Route cards show how many vehicles run and how full they are, and below that the models they run, such as *Hollin Mk 1–3*; hover the models for each one's count, and on an up-to-date fleet for the year newer ones arrive. A card offers **Upgrade** while a newer model exists (hover it for the improvement). Older vehicles keep running exactly as before; an upgrade simply brings the newer capacity and speed. The next model year appears above the fleet controls.

Route cards lead with the route's profit this year, fares minus route upkeep since January 1, and once a year has closed show last year's beside it (until then, the monthly average since launch). Hover the figure for the net since the route's accounts began. Routes in older saves start counting this year's profit when first loaded.

**Running costs** are charged every day, in 1950 prices that rise with inflation: a bus or truck $55, a train $225, a ship $175 and a plane $375, a little more in cold or hot weather and 45% while a vehicle waits or its route is broken. Your own road costs $0.15 a tile a day, track $0.35, each bridge or tunnel tile $0.50 more, and each road stop, rail station, port and airport $3, $10, $15 and $45; town streets cost nothing. A well-used 1950 truck pays for itself in about a year and a full train in under a year, while a cheap bulk cargo over a long road, or a train the supply cannot fill, may only cover its costs. The company report lists routes that earn less than their upkeep.

Inflation is a seeded **1–5% each year**, compounded from 1950 prices. It affects construction, vehicles, upgrades, upkeep and delivery fares. Hover or click the finances to see this year's rate. Costs throughout the interface update with the calendar; prices quoted in this guide are starting prices. Selling a vehicle returns 45% of the amount actually spent on it, including upgrades.

## Delivery pay

Every delivery is paid for distance and speed. Distance is the shortest connected path between the two stops, counted up to twice their grid distance (east–west plus north–south), so loops and long detours never multiply a fare. Fares grow in a straight line: a 40-tile delivery pays about 2.4× a 10-tile one, and an 80-tile one about 4.2×.

The clock runs from boarding to arrival. Each cargo belongs to one of four classes, paid in full for its first days on the way and a little less for each day after:

| Class | Cargo | Full pay for | Then each day |
|---|---|---|---|
| Express | Passengers, mail | 14 days | 1.5% less |
| Time-sensitive | Food, fish, goods, milk, fruit & vegetables | 16 days | 1.2% less |
| Standard | Lumber, steel, grain, furniture, machinery, fuel, glass, copper wire, cement, livestock | 25 days | 0.8% less |
| Bulk | Timber, coal, iron ore, copper ore, stone, sand, crude oil | 45 days | 0.4% less |

A delivery always earns at least half its distance fare. In 1950 a bus keeps full fares up to about 34 tiles, a train 56 and a ferry 19; a 1952 plane keeps them up to about 170, counting its time on the ground. For bulk the limits are 110, 181 and 63 tiles. Each generation is 10% faster and stretches them.

Cargo that nothing at the end stop takes, such as after its buyer was removed, starts its clock again when it is carried back out. Cargo on a broken or edited route starts again when the route runs again. Cargo aboard in an older save is paid by distance only on its next delivery.

Route cards show the length, the recent days on the way and what one unit earns at today’s prices, such as *24 tiles, 10 days* and *$72 each*; before the first delivery the days are an estimate (*about 10 days*), and a slow route adds its share, such as *93% of full pay*. Hover the row for the full explanation. The route form estimates the same before launch, a vehicle's card says how long its load has been aboard, and the Guide's **Resources** tab charts the payment rates: what 10 of each cargo earn over 20 tiles by days on the way, with a table view. **Cargo payment rates** at the foot of the company report opens the chart. Pay never raises a warning or a notice: a slow route still earns, and faster or newer vehicles simply keep more.

## Mail between towns

Every town writes letters: about one bag a day for every 400 residents, a little more with services such as a post office, bank or hotel near its centre, and at most one bag for every 12 residents waiting at once. Nothing happens to mail nobody carries: it simply stops piling up, with no notice, deadline or goal.

To carry it, choose **Mail** in the route form for two stops that serve different towns. For two town stops the form still suggests **Passengers** first, so Mail is always your choice. A mail route loads at both ends, like passengers, and its vehicles are mail trucks, mail trains and mail ships in the freight bodies. Stops near a town list Mail among the cargo they load and accept, and the town's delivered count and growth include the bags you bring.

A bag pays about 45% more than a passenger. Mail is express: it keeps its full fare when the trip takes 14 days or less, then loses 1.5% a day, never more than half. In 1950 a mail truck keeps full pay up to about 34 tiles, a train about 56 and a ship about 19, and each new generation reaches 10% further, so trucks suit neighbouring towns and trains the long runs. The route form and the route card show the trip time and the share kept. Once both of its towns hold four full loads or more, a mail route's card shows *Room for more*, as a passenger route's does. Mail counts as town service, not as freight: it never completes a freight goal, starts contracts or earns a first-delivery notice.

## Company report and loan

**Game menu → Company**, or **Open report** at the foot of the finances card (hover or click the balance), opens the company report. Four small charts follow the last 36 closed months: operating profit, balance, residents across all towns and units delivered each month. **Year by year** sums each calendar year once it closes on January 1: fares, operating profit with its change on the year before, units delivered, residents, routes and the best route, the one that earned the most that year. **Top routes** ranks up to five routes by their average net a month since tracking began, meaning fares less route upkeep without construction, each with **Show**. A route at least 90 days old whose net since its accounts began is below zero appears under **Earning less than their upkeep**, with **Show** and **Retire**. Once you own property in a town, **Property** follows: last month's rent, what your property is worth today, this year's rent and its yield a year, a small line of rent month by month and your top eight towns by rent, each with **Show**. The report pauses the game while it is open.

The **Loan** is an optional credit line, and nothing ever requires it. **Borrow** adds $50,000 at a time, up to $250,000 (1950 prices, rising with inflation), and the button shows the extra monthly interest before you press it. Interest is a flat 0.5% a month on what you owe and never rises. It is charged as each month closes and counts as a running cost, but never in a route's accounts. There is no due date, no automatic borrowing or repayment and no bankruptcy; **Repay** returns $50,000 at a time whenever you have the money. Borrowed and repaid money is neither income nor an expense. While you owe money, the finances card adds **Loan** and **Interest** rows.

When a month closes with the balance below zero, a warning suggests borrowing or retiring a route that earns less than its upkeep, with a **Loan** button. It appears only when the balance first falls below zero and again each January while it stays there; News keeps every month's warning. Retiring your last running route warns you first when the balance and the vehicle sale together would not buy a new bus.

## Notices and news

Every company notice reaches the screen, including news of a new industry near your towns. Notices that arrive together appear one after another, oldest first and warnings first. When several routes lose their connection at once, one demolition leaves several routes without a supplier or buyer, or several industries expand or open on the same day, one notice names them all. Repeating the same rejected action adds a count to its notice instead of stacking copies. Warnings and errors stay for 8 seconds, other notices for 5.

Point at a notice or focus its action to pause its remaining display time, including **Undo** after construction. The timer resumes after both the pointer and keyboard focus leave. Escape works inside form fields and dismisses one layer at a time; arrow keys scroll panels and move the map when the map has focus.

A notice about a route, town or industry has a **Show** button: a route is framed and lit on the map and opens at its card in Routes, and a town or industry is framed and inspected. A new company greets you when it opens; loading a save never replays old notices. Each January 1 names one of the year's new models (your most-used kind of vehicle, or a new series when one begins) and the year's price rise. Once a whole year has closed, the notice adds that year's operating profit, its change on the year before and its best route, such as *1952 operating profit +$51.9k (+4%) · best route Alderbrook – Pinehaven*, and **Open report** opens the company report. When vehicles can be upgraded, **Review upgrades** opens Routes at **Upgrade all**; it never spends money. The first delivery of each new freight route, and a served town passing 1,000 residents, are announced as they happen. With sound on, only warnings, errors and these moments play a tone, at most once per batch.

Rare big moments arrive as a headline card at the top of the map: the first bus, truck, train, ferry, ship or plane to reach a town (your two starting towns excepted), the company's first train, first ship and first plane, a served town passing 2,500, 5,000 or 10,000 residents, and a new series of a kind of vehicle you run, such as the Pendle buses of 1961, and the arrival of air travel in January 1952. That January's notice then keeps only the price rise and the year's report. One headline shows at a time for about ten seconds, longer while you point at it, with at least 15 seconds between them. They wait while you build or pick stops and while a menu is open, never pause the game, never take focus and never spend money. **×** or Escape dismisses one; **Show** or **Review upgrades** jumps to what it describes. **Game menu → News** keeps the latest 24 headlines beside the notices. Untick **Show headlines on the map** there to keep them in News only, and the town, first-delivery and January notices return as before; this browser remembers the choice.

**Game menu → News** lists the latest 24 company notices and headlines with their dates, newest first, and a **Show** button while the route, town or industry still exists. The yearly, first-delivery and 1,000-resident moments are shown as they happen and are not kept in News. Milestones reached within the span of the log join it by date, one line per day, with a **Goals** button.

## Achievements

**Game menu → Achievements** keeps long-term records of your company, from 100,000 deliveries to a century in business. There are 41 in six groups. **Deliveries and earnings** counts everything delivered over the company's lifetime, your best year's operating profit, the most one route earns in a year and your yearly rent. **Fleet and network** counts the vehicles you own at once, the road and railway tiles you built (town streets don't count), your bridge and tunnel tiles and your longest running route by road, rail or water. **Towns** counts the towns you serve, every town on a map of 25 or more, towns of 5,000 residents and a town you founded reaching 2,500. **Industry and cargo** asks for mail and every cargo your landscape makes, then all of them within one calendar year, and for industries at their full 300% at the same time. **Company** marks your years in business. Money is counted in 1950 dollars: a year's total is divided by that year's prices, so inflation never earns a record for you.

Each record comes in bronze, silver, gold or platinum. On the default 512 map bronze arrives in your first years, silver over a decade or with a sizeable network, gold over decades or with a large network, and platinum over a century; some platinum records, such as a hundred towns served, suit the larger maps. Every record starts beyond the last Company goal. Five more are hidden: they show as **?** until you find them.

Each medal pays a one-off prize by its tier, in 1950 dollars that rise with inflation: bronze $25,000, silver $100,000, gold $400,000 and platinum $1.5 million. The prize arrives with the medal, as a goal reward does, and the dialog shows what the next medal of each record pays. Achievements unlock or change nothing else, and nothing reminds you of them: no badge, no countdown, nothing to lose. A record, once earned, is yours to keep, whatever happens later. Deliveries and the fleet count at the end of each day, most records as each month closes and the yearly ones on January 1; a record you have met but not yet earned says when it will be. The dialog shows each record's medals, the next one with its progress, and the last one earned with its date. Like every dialog it pauses the game.

When you earn one, a notice with **Open achievements** names it; two or more on the same day share one notice, and at most one such notice arrives each game month, so later records that month wait quietly in the dialog. Gold and platinum records arrive as a headline card instead, or as a notice while headlines are off. The Company report shows how many you have earned, and so does the century evaluation. An older save is credited quietly when it loads: its records begin that day, shown as **Records began** in the dialog, and whatever it has already reached is stamped that day without a notice or a prize.

## Company rating

Each quarter, as March, June, September and December close, your company is reviewed and rated from 0 to 1,000 on nine measures. Each measure earns its points as it nears full marks, fastest at first: half of a target earns about 70% of its points.

- **Vehicles earning a profit** (100 points): vehicles on routes that made a profit last year; full marks at 250.
- **Stops in use** (100): stops on running routes; 150.
- **Weakest route** (100): the lowest profit a vehicle made last year on any of your routes; $25,000 a vehicle. It counts once 10 vehicles have run a whole year.
- **Weakest quarter** (50) and **Best quarter** (100): operating profit in the last twelve whole quarters; $5,000,000 and $10,000,000.
- **Cargo delivered** (400): in the last 12 months; 400,000.
- **Cargo types** (50): the kinds of cargo you deliver; 8.
- **Cash** (50): $100,000,000.
- **No loan** (50): full marks without a loan, fewer the more of the credit line you use.

Money targets are in 1950 prices and rise with inflation. A route launched or edited during a year counts from the first whole year of its accounts.

Every 120 points earns a title: Engineer, Traffic manager (120), Transport coordinator (240), Route supervisor (360), Director (480), Chief executive (600), Chairman (720), President (840) and Tycoon (960). A title, once earned, is yours to keep; a falling score changes nothing and is never announced. The rating is recognition only: it never changes money, prices, towns, industries or vehicles, and there is nothing to do about it unless you want to.

The finances card (hover or click the balance) shows your title and the latest score in its **Title** row, and its tooltip names the next title. A new title arrives as a Company news headline, or as a notice while headlines are off, with **Open report**. The company report opens with the rating: the title, the score, the way to the next title, the review dates and the **Company value**, which is your cash, your vehicles and property at their resale value and half of what your roads, rails, bridges, tunnels, stops and bought industries would cost today, less any loan. Property counts at its sale price for buildings you placed and half of today's zoning cost for your plots. **What counts** unfolds the nine measures with the value at the review, full marks and the points each earned, names the weakest route with **Show**, and lists the titles you have earned with their dates. **Year by year** adds each December's rating.

When December 2049 closes, on 1 January 2050, your company's first hundred years are evaluated once. A headline, **A century of transport**, offers **See evaluation**: a card with your title, score, company value and the titles you earned. It never opens by itself, and the company report keeps it. Play continues; there is no end date.

## Building and object gallery

Open **Game menu → Gallery** to browse all buildings, industries, farms, transport objects, landscape species and cargo. Search by name or cargo, choose a collection, and switch between your climate and **All climates**. Select an object for its current build price, footprint and role; homes also offer their three designs and two orientations.

Click an object on the map to see its portrait, live information and available actions in the inspector. Its plot gets a translucent ground tint and an outlined border beneath the sprite, following the terrain and the full footprint. **View in Gallery** opens that object’s complete reference entry, including production recipes, cargo destinations, resident capacity and demand where applicable. Closing Gallery returns to the selected object and restores focus to its reference button.

Industry cards show base daily input and output recipes and the actual next consumers. Follow a consumer to inspect it, use **Back to previous object** to return, or open **Open production chain**. Food delivery links include the grocers, bakeries, butchers and malls that contribute to their town's market. Town workshops show the recipes for the preview climate and their shared processing allowance.

Homes show resident capacity at levels 1–3 and their potential monthly contribution to food, household and fuel demand. Orders, passengers and mail belong to the town; the gallery labels these contributions rather than showing separate house inventories. Actual orders depend on population and retail outlet reach.

**Build** closes the guide and selects the matching construction tool. Industries from another climate and airports before 1952 keep their availability explanation. Vehicles are purchased through routes, and natural objects occur in the landscape. Browsing, changing the preview climate and following catalog links do not change the company or its save.

## Controls and saving

Drag the map in **Explore** mode to pan; click a place to inspect it. Choose one of three views: **Region (50%)**, **Town (100%)**, or **Detail (200%)**. Scroll, press + / − (or Page Up / Page Down), or use the zoom buttons to move one view at a time; click the view's name beside them to open the three choices and **Back to home town**. A sideways trackpad swipe or tilt wheel moves the map left and right without zooming. Trackpad users can switch scrolling to pan with **Game menu → Map options → Scroll to pan**; a pinch or Ctrl+scroll still zooms, and this browser remembers the choice. Turn on **Game menu → Mini map** to navigate with a small overview, or press **M** for the region atlas. Construction tools place a structure with a click or lay roads, tracks and zones with a drag. Roads, railways and their bridge and tunnel tools stay active after successful strokes, keeping the drawer closed so you can continue building. Press **Done**, **Escape**, or right-click to leave construction; during a drag, Escape or right-click first cancels the drag and keeps the tool. Right-drag or hold Space while dragging to move the map while building.

The inspector keeps its numbers current while the game runs, and a click on its buttons always lands, including in Safari. Resource tooltips stay open while nothing in the inspector changes. Opening a nearest target, a town or an industry from a list with the keyboard moves focus to the inspector's heading; screen readers announce the inspector as a region named after the selected place.

Click a vehicle or its load badge in Explore mode to open its card: its model (such as *Hollin Mk 3 bus*) with its model year and age, its route, the load aboard and how many days it has been on board, the stop it is heading to with the tiles left, and how the route is doing. A ring marks it on the map. **Follow** keeps the camera on it at any speed until you drag or scroll the map, press Escape, choose a tool or close the card; started at 8× in Detail, it steps out to Town to keep up. **Show route** frames and lights its route, **Open in Routes** opens that route’s details (these three are icon buttons; their names show as tooltips), and **+ Bus** (or truck, train, ship, plane) adds another vehicle to the same service. A plane's card says instead whether it is landing, taxiing, boarding or taking off at an airport. A stop's sign opens that stop, even where the sign stands over a neighbouring tile.

Buttons that find something on the map, such as **Show**, **Locate**, **Show route**, **Follow**, a list card or a Next goal step, move the map in a short glide and frame the place in the part of the map the drawer and the inspector leave free. A jump of more than three screens cuts straight there instead and rings the place in orange for a moment, and **Back to where you were** at the bottom left of the map takes you back for eight seconds. With reduced motion set in your system, every move is a cut. A selected vehicle, building or workshop carries its name in a small dark tag above it; towns, stops and sites already show theirs.

Management stays closed until needed. Click **Network**, **Buildings**, **Industry** or **Terrain** for construction, or **Routes**, **Industries** or **Towns** for browsing; click the same view again or its close button to return to the full map. Choosing a construction tool closes the drawer and leaves a small active-tool reminder with a **Done** button. Done returns to that tool’s construction area. **Shift+1/2/3/4** open Network, Buildings, Industry and Terrain; **Shift+B** reopens the last area. The top lane keeps the balance with this month's profit under it, the date with the local weather under it, and the speed visible, without labels. **Game menu** at the top right groups the rest, each row with its key: Company, Company goals, Achievements and News; Production chains, Gallery, Map layers, the mini map and Map options; Sound effects, the Guide and **Keyboard shortcuts**; then Saved games, New world and Main menu. The minimap is off by default. The drawer has no heading of its own: each view's title heads it, with the close button beside it.

The reminder states the tool's rule along with its gesture: roads and rails go straight up slopes and turn on flat ground, a new stop goes on a road or railway within 4 tiles of its customers, and a zone drag fills an area (Shift for a line).

The landscape uses diamond-shaped tiles, with upright buildings and trees layered by their distance from the camera. Roads, railways, rivers, selections and construction previews follow the same isometric grid. Dragging and arrow keys move in screen directions; zoom keeps the location beneath your pointer in place. The atlas remains a flat overhead map for easy navigation. Existing companies, routes and terrain levels work unchanged in the new view.

**Network** contains Road, Rail, Stop, Port and Airport; Bulldozer stays available directly and in every construction area. Grid, route lines, centering on your home town and Scroll to pan are in **Game menu → Map options**. The finances tooltip separates fares, running costs, construction/vehicle purchases and the previous month’s operating profit. Hover, focus or click the balance/profit area to see delivered cargo and connected-town totals. Local weather and save status are in the Game menu's header and footer.

Open **Game menu → Map layers**, or press **L**, to control trees and plants, buildings, roads, railways, stops, names, industry icons, vehicles, cargo loads, delivery income, route lines, zones, weather, the grid and the Next goal card. Buildings includes industry structures. Hiding vehicles also hides their load indicators. **Terrain only** shows bare ground, water, mountains and rocks; **Show all** enables every layer, including the grid. Selection outlines and construction previews remain available for building and inspection. The panel leaves the simulation running, and Escape closes it.

Layer settings change the view while the transport network and hidden structures continue operating. These browser preferences survive reloads and remain the same when creating or loading a different company; they are separate from game saves. A fresh browser starts with all layers visible, including a gentle tile grid. Press **G** to toggle it.

Right-click during a drag cancels it and keeps the tool, and so does the first Escape; press Escape again to finish the tool. A road, track, zone or earthwork dragged past the map edge stops at the edge instead of being discarded.

Hold a road, track, zone or earthwork drag near the edge of the view, or past it, and the map scrolls that way, faster the further out you go, so one stroke can run as far as you like; a drag that starts by the edge scrolls only once it moves. Arrow keys and the zoom buttons also move the map under a held drag, and the stroke, its highlight and its quote follow the pointer.

The map plays from the keyboard too. Tab to the map and press **Enter**: a tile cursor framed in orange appears in the middle of the view. Arrow keys move it one tile along the diamond grid: Right and Left follow a row down-right and up-left, Down and Up a column down-left and up-right. The map scrolls to keep the cursor in view; Shift with an arrow moves the map instead. Press Enter again to inspect the place under the cursor, place a stop, port or building there, or pick it as a route's start or end stop. With Road, Rail, a bridge or tunnel, zones, earthworks or the Bulldozer, Enter starts a line at the cursor (a rectangle for zones), including the Enter that first shows it; move to the far end, check the same preview and quote a drag shows, and press Enter to build. Nothing is spent before that second Enter. Escape steps back one stage at a time: it drops a started line, then hides the cursor, then finishes the tool. An inspect moves focus to the inspector's heading, and Escape there returns to the map with the cursor where it was. A cursor left off screen by Shift-arrows, **H** or the atlas comes back to the middle of the view on the next arrow or Enter. Moving the mouse over the map hands control back to the pointer. A moment after the cursor settles, screen readers hear its tile, the place, the tool and its cost or problem.

| Key | Action |
| --- | --- |
| R / T / S | Road / rail / automatic stop |
| P | Port |
| A | Airport (press again to turn the runway) |
| B / N | Bridge / tunnel for the current road or rail mode |
| [ / ] / E | Lower / raise / level land |
| X | Bulldozer |
| 1 / 2 / 3 | Residential / commercial / industrial zoning |
| Shift + 1 / 2 / 3 / 4 | Open Network / Buildings / Industry / Terrain |
| Shift + B | Open the last construction area |
| Escape | Step back one level: close an open menu, cancel the stroke or keyboard line, hide the tile cursor, finish the tool, then close the inspector (back to the place you came from first) and the drawer; with nothing open, clear a cargo highlight |
| Right-click | Finish the current tool; during a drag, cancel the stroke |
| Space | Press to pause or resume; hold while dragging to pan |
| . / , | Faster / slower (below 1× is pause) |
| Shift | Hold while dragging Road or Rail to keep the plain L instead of following the terrain, a zone to lay a line instead of a rectangle, or the Bulldozer to clear a rectangle |
| Enter | On the map, show the tile cursor; then inspect, place, pick a stop, or start and finish a line under it |
| Arrow keys | Move the tile cursor one tile along the grid; without the cursor, pan the map |
| Shift + arrow keys | Pan the map |
| + / − or Page Up / Page Down | Zoom in / out |
| G / H or Home / M | Toggle grid / center on starting town / region atlas |
| F | Show the selection again; with a vehicle's card open, Follow it (again to stop) |
| ? | Keyboard shortcuts, every key on one sheet, with a link to the Guide |
| C | Production chains |
| Shift + B / R / T / I | Open or close Build / Routes / Towns / Industries (a letter alone picks a tool) |
| Shift + N / C / G | News / Company / Company goals |
| L | Map layers |
| Ctrl+S or Cmd+S | Open Saved games |
| Ctrl+Z or Cmd+Z | Undo the last construction |

Woodland uses 64 arrangements per habitat, from a single mature tree to five-tree clusters. Each climate has 27 tree sprites, with three extra hollow trunks in tundra: 84 in total. Added species include open pines, cedars, maples, willows, northern birches and spruces, branching palms, baobabs and dryland trees. Crown shape, trunk forks and natural heights distinguish them at the same world scale. Tundra's hollow trees appear sparsely among older bare trunks. Nine additional desert cacti range from small barrels and hedgehog clumps to tall saguaro, organ pipe and cardon; existing cactus patches choose them stably. Pine, spruce, fir, broadleaf and mixed stands retain varied heights, saplings, leafy crowns and bare branches. Crowns overlap tile edges to break up regular rows. Mountains, boulders, shrubs and ground plants also vary in shape, size and placement. This artwork updates existing saves when you reload, and all named trees and cacti appear in **Game menu → Gallery**.

Larger groves occupy **2×2 or 3×3 tiles**. New mountain formations, glaciers and boulder outcrops occupy **3×3 through 6×6 tiles**, with larger formations appearing less often. Trees, rocks, flowers and shrubs appear only on flat tiles. Larger objects require the same height at every grid point across their full footprint; slopes stay free of decorations. Inspect any occupied tile to see the whole footprint. Bulldozing any part of a grove or rock outcrop clears its complete site for one charge. Construction and earthworks break up intersected formations, leaving smaller objects on the remaining natural tiles. Mountains retain their elevation and use the terrain and tunnel tools.

Every ground grid point has one of eight integer heights, 0–7; most land sits around levels 3–4. Shared edges connect these points into hills, valleys and plateaus using a small set of straight ramps, triangular raised or lowered corners, and ridges. Corner slopes leave the other half of the tile level. Textures follow each face, with slightly stronger sunlight and shade making the slopes easier to read. The Terrain height views retain their names and your preference, with proportions suited to these simple slopes. Ground color follows altitude, moisture and geological material, with warmer dry patches, darker mossy grass, fine sand grain and mottled snow. Small biome-specific flowers and grasses are more common than stones; snowy ground and dunes no longer repeat boulder sprites. Woodland varies between dense canopy and open clearings, with soft shadows matching each tree and grove. Smooth riverbanks and local shallows replace uniform bright shoreline outlines. The same relief appears on the overview and remains visible with decorations hidden. These rendering improvements use existing companies' saved elevations. Newly generated companies also preserve natural elevation beneath roads and settlements, avoiding rectangular depressions; choose **New world** for that generation change.

Generated miniature artwork covers houses, civic buildings, shops, services, dedicated town workshops, industries, nature, vehicles and transport infrastructure. The city collection was regenerated in every climate, together with asphalt, rail and bridge materials and the lawn, paving and gravel of vacant zones. Grass now combines fine irregular grain, soil pores, broken moss patches, blades and seed heads, with lighter detail at Region view. Houses use smaller structures at the vehicle scale, surrounded by fenced gardens, gates and paths. Each house has two physically drawn orientations, chosen from its saved tile variant so the choice stays fixed across reloads and zoom changes. Foundations on slopes use irregular, chipped stone with climate-specific colors. Small homes and shops occupy **1×1 tile**, prestige homes and most civic buildings use **2×2 tiles**, and stadiums use **3×3 tiles**. Every new industry uses **5×5 tiles**, with recognizable pits, yards, tanks and machinery; farms have **5×5 fenced plots** around smaller **2×2 building cores**. Stops can serve either kind from any plot edge. New town pairs, town–industry pairs and related industries leave room for both stop ranges plus at least **5 road edges** between the nearest possible serving stops. The gap is measured from full industry plot edges and town centres: normally at least **13 tiles** (4 + 4 + 5), with extra room where older 5-tile stops already serve either site. Related industries are the same kind or a supplier and its customer; they also retain the 16-tile centre-distance minimum. Unrelated industries may stand side by side. Existing geography is preserved. Placement reserves the complete plot, and selecting or bulldozing any occupied tile acts on that one building. Older compact buildings expand in place only when every required tile is free; otherwise they retain their saved footprint. Every bus, truck, locomotive, coach, wagon and ship has eight separately drawn travel directions, with cargo and lighting following its heading. Sprite sources and generation prompts are recorded in [assets/world/README.md](assets/world/README.md). Build menus, industry lists and inspectors, production chains and route vehicle previews use the same artwork, with display-density matching on Retina screens. Resource and navigation pictograms remain clear at small sizes.

Sprites and terrain are drawn at the resolution of each view, including high-density displays. Buildings share one physical scale: ordinary doors, storeys and garden fences keep the same dimensions across houses, civic buildings and factories. Larger buildings gain additional wings, floors and bays. Broad roofs, wall colours and large identifying features replace tiny brick joints, roof tiles and decorative speckle so buildings remain recognizable at Region view. [SPRITES.md](SPRITES.md) describes the shared art direction and generation workflow. Tundra roofs carry snow, and yards use plants suited to the environment. Sawmills, blast furnaces, food plants, silos, glassworks, wire mills and assembly factories have distinct silhouettes and working yards. Water has deeper basin colors, translucent shallows, damp banks, occasional sand and broken shoreline foam. Gentle glints and river currents animate at every zoom level; motion pauses with the simulation. Region emphasizes clear silhouettes, Town balances building detail and network planning, and Detail makes fine architectural and terrain features easier to inspect. Zooming toward the pointer keeps the same map location under it.

Broken wave crests gently lap toward the banks of lakes, rivers and coasts, with soft fades and small movements. The surface and shore animation freezes with **Pause**; your browser's reduced-motion preference keeps the water detail still. Animation reuses the terrain cache and leaves the world's land and waterways intact.

Local weather also affects the finished map palette, gently: overcast skies soften its colors, rain cools the scene, and snow adds a pale winter cast. The seasons turn with the climate's own 360-day year, so the light agrees with the weather: a fresh green as it warms, a golden light as it cools and a pale chill at its coldest, when the snow falls. The tint is strongest in the taiga, brief in the tundra and faint in the desert. Subtle precipitation follows simulation time and freezes while paused; reduced-motion settings keep the palette effect without moving particles. **Game menu → Map layers → Weather** switches it off. Sprite artwork is unchanged.

Choose **Bulldozer** in the main toolbar or press **X**, then click or drag to clear buildings, tracks, roads, trees and decorative plants. Hold **Shift** while dragging to clear a rectangle of up to 16 × 16 tiles; the tip counts the sites it will clear, and a drag passes over empty ground. Existing cities and stops serving active routes remain protected. Clearing ports or bridges leaves the water intact. Tiles that carry a running route turn orange, and the tip names the route the demolition would cut.

Every construction tip matches what the release will do. Red tiles are refused and the tip explains why. Zone and Bulldozer drags may still build part of a stroke; the amber tip says how many tiles, for example **Builds 2 of 9 · funds for 2**. Hovering the **Stop** or **Port** tool over a valid tile names what the stop would load, accept and serve, or warns that no customers are within 4 tiles.

Roads, railways, bridges and tunnels include any necessary leveling in the same construction. The quoted total covers both; there is no separate terrain step or payment. One **Undo** restores the network and all ground changed by that build and refunds the full amount, subject to the usual protection for later changes.

After building, a brief green outline confirms the ground that changed. Demolition and Undo use a quiet ink outline. The marks clear even while paused, and reduced motion keeps them still. **Game menu → Sound effects** adds gentle, distinct cues for construction, demolition, Undo and launching a route. Sound starts off, remembers your choice, and waits for your first keyboard or pointer action; muting stops it immediately.

Changed your mind? Press **Ctrl+Z / Cmd+Z**, or choose **Undo** on the notice after a build, to take back your latest construction for a full refund, demolition included. Each press steps back through up to ten builds since you opened the world, even after the month has closed; vehicles, cargo and town growth elsewhere carry on untouched. A build stays once its ground has changed (a zone grew a house, a later build stands on it, you sold it), once a town it founded owns homes or an industry it placed has traded cargo, and after you launch or retire a route. A home, shop, service or workshop you placed undoes only within the month you placed it, before it has paid rent; after that, sell it instead. The list itself is never saved, so loading a world starts a fresh one.

The build notice shows **Undo** only while that construction can still be reversed. Launching a route, building over its ground or a zone developing removes the unavailable action; the construction confirmation stays visible.

The **Terrain height** selector beside the speed buttons changes the visible relief: **Flat**, **Gentle**, **Normal** or **Steep**. Normal is the default. Roads, vehicles, buildings and stone foundations follow the selected view, while terrain levels and construction rules stay the same. This browser remembers the choice independently of saved companies.

The simulation runs at 1×, 3× or 8× speed. One real second represents one day at 1×. World updates commit about once a second; vehicles animate smoothly from recorded paths with a one-second presentation buffer. Pause, speed changes and saves preserve the pending fraction of a second. You can build while paused, and dialogs pause the simulation while open. While the map is paused, *Paused* replaces the weather word under the date in orange and a thin orange line runs along the top of the map; press Space, the full stop or 1× to resume. The comma and full stop step the speed down and up, through pause.

The game autosaves to local storage when a company is activated, three seconds after your last construction stroke, after route changes, every 20 seconds while the world changes, and when hiding or leaving gameplay. Reloading returns to the main menu; choose **Continue** to pick up the latest company. Hidden tabs do not advance the simulation, and there is no offline time progression.

A full-screen loading view shows progress while opening the game, creating a world or restoring a save. Generation and restoration run in the background, keeping the loading screen responsive. Choose **Cancel** or press **Escape** during creation or restoration to return without replacing your current world or autosave. The map appears when its first view is ready; the loading animation respects reduced-motion preferences. The game downloads only the artwork sizes your screen needs: sharper pictures for close zoom load the first time you zoom in, and on a slow connection the map shows every building and vehicle first and sharpens them in a few steps.

Vehicles keep moving while an autosave captures its checkpoint; only the next day's economy waits until the capture is complete, which on large maps at 8× can take a fraction of a second. The save is then encoded in the background. Closing or hiding the page takes a final synchronous checkpoint so the browser cannot abandon your latest progress with an unfinished worker.

If browser storage is full or blocked, a notice appears once, the Game menu button shows an orange dot and the menu reads **Save unavailable**. Delete older saves in **Save / load** to free space; the dot clears and a short notice confirms when autosave works again.

Open **Game menu → Save / load** or press **Ctrl+S / Cmd+S**. Give the current world a name and choose **Save game** to keep an independent snapshot. The dialog lists each saved company's landscape, game date, balance and save time. You can load, rename, overwrite or delete named slots. The in-game dialog confirms loading, overwriting and deleting; loading replaces the active world and its autosave. Named snapshots change only when you overwrite them, so generating a new world preserves your other companies.

The latest autosave also appears in the dialog as a load-only checkpoint. The simulation and periodic autosaving pause while the dialog is open. Square worlds save a versioned generation seed plus lossless changes to the original terrain. New square worlds use generation recipe 13: towns and related sites leave room for meaningful transport journeys, rival industries that buy or make the same cargo never share a stop's reach, every industry plot keeps five free tiles from other plots and from town streets, and neighbouring towns never grow into each other. This comes alongside drainage-shaped valleys, towns on level ground, **5×5 sites for every industry**, full building plots, sparse 3×3–6×6 landforms and localized mountain relief. Recipes 1–12 remain unchanged so older sparse saves reconstruct their exact original geography, including recipe 8's 3×3 industries and recipe 9's 7×7 farms. Loading an older company expands smaller industries into empty adjoining land where it fits, preserving their original occupied tiles; a 7×7 farm becomes a contained 5×5 plot only if all existing freight stops still reach it. Sites that cannot resize safely keep their saved footprint. Roads, buildings and stop connections remain protected. Local ecology, construction, removals, inventories, routes and every other gameplay field are retained; older full-map saves remain supported. Browser compression keeps named slots compact. An autosave and two developed 2048 × 2048 worlds, each with a year of simulation and 100,000 additional terrain edits, fit a conservative 5 MiB quota in testing. Creating a new world activates it only after its autosave succeeds; a failed write leaves the current world intact. Save capacity depends on the browser's available storage; failed writes report an error and preserve existing saves. Slots are local to this browser and device, and clearing browser storage removes them.

## Worlds and industry

New companies offer **512 × 512**, **1024 × 1024**, and **2048 × 2048** square maps. The default 512 map has 48 towns and 8 complete industry districts; 1024 has 128 towns and 20 districts; 2048 has 320 towns and 48 districts across 4,194,304 real tiles. Older rectangular worlds remain loadable at their original dimensions. New worlds use irregular coastlines, mountain ranges with foothills, branching river watersheds, lakes in natural basins and uneven forest regions. Towns settle on dry, low and even ground near water, leaving quieter wilderness between them. Hamlets, villages, towns and cities each have their own size, street grid and back lanes, and civic buildings follow size: a hamlet may have a pub, a town adds a church, a school and a post office, and only a city has a hospital. Mines need rock nearby, logging camps woodland, farms open fields (by water in the desert) and sand pits dunes; sites prefer level ground, factories favor town fringes, fisheries use natural shorelines, and related industries keep their 16-tile spacing. The two opening towns retain their short passenger connection and navigable river. Taiga adds spruce, fir, birch, oak and aspen around granite peaks and wooded foothills, with bluebells, ferns and berry bushes. Tundra has larches, dwarf birches and pines, ice peaks and glaciers, with arctic poppies, cotton grass, heather and lichen. Desert adds palms, acacia, Joshua trees, mesas and buttes, with agave, aloe, prickly pear and desert flowers. Reeds and other plants follow local moisture, and tree species spread gradually from neighboring woodland. Each environment has its own colors, towns and industry catalog. Entering the same seed, environment and size recreates the same starting world under the current generator. Existing saves retain their original generator and geography; choose **New world** to see the new landscapes. Open the region atlas with **M** or the minimap heading, then click a location to travel there. Existing 100 × 72 saves continue to load at their original size; choose a size in **New world** for a new square landscape. Towns and Industries have searchable lists; industry search also matches input/output cargo, with a separate industry-type filter.

| Environment | Simple chains | Longer production chains |
| --- | --- | --- |
| Taiga | Timber → lumber; grain → food | Coal + iron ore → steel; lumber + steel → furniture; steel + fuel → machinery |
| Tundra | Fish → food; oil → fuel | Coal + iron ore → steel; steel + fuel → goods or machinery |
| Desert | Stone → cement; copper ore → wire; grain → food | Sand + fuel → glass; glass + wire + cement → goods |

Oil wells, refineries and quarries are available in all environments. Extractors generate raw materials; processors consume their recipe ingredients to produce finished cargo. Deliveries move inventory between industries. Factories accept deliveries even when their stores are full; they produce only with every input. Food, furniture, goods, fuel, stone, cement and machinery can supply towns. Towns with workshops also buy the materials their workshops use: lumber and steel in taiga, steel in tundra, and glass and copper wire in desert (see **Grow your towns**).

**Industry** adds four optional farm kinds and three food processors in Taiga and Desert. The existing grain farm supplies feed to dairy and livestock farms; vegetable farms and orchards harvest their own produce. Connect each leg with freight routes, then carry the processors' finished food to a city stop serving its grocers, bakeries, shopping centres and other shops. Shops pay the existing food-demand premium; they buy the processed food rather than the raw ingredients. These seven additional industry kinds are player-built, so generated worlds and saves retain their original production chains.

Every new industry reserves **5×5 tiles**. Grain, dairy, vegetable, orchard and livestock farms use that plot around a **2×2 building core**, with a working yard, a gate, an access lane and surrounding fenced fields. Grain fields vary between wheat and corn; vegetable beds, orchard trees and livestock pastures distinguish the other farms. Their ground follows the world's terrain. All 25 tiles belong to the farm: stops can serve any field edge, construction cannot occupy its fields, and selecting or bulldozing a far corner acts on the complete farm. One Undo reverses its construction or demolition until later construction or cargo trading prevents it. Food plants, dairy plants, canneries, meat packing plants and every other industry also use **5×5 sites**. Older saves resize only where adjoining construction and existing station connections stay safe; otherwise the saved footprint remains.

| Farm chain | Processing recipe | City cargo |
| --- | --- | --- |
| Grain farm → dairy farm (2 grain → 4 milk) | Dairy plant: 4 milk → 3 food | Food |
| Vegetable farm or orchard → fruit & vegetables | Cannery: 4 produce → 3 food | Food |
| Grain farm → livestock farm (3 grain → 3 livestock) | Meat packing plant: 3 livestock → 2 food | Food |

**Industries** and **Towns** list the places nearest the middle of your view first, 40 to a page. Each card says how far away it is, and an industry card also names its nearest town, so eight logging camps are easy to tell apart. The select beside the search sorts by **Status** (full stores first, then sites with more to carry, then those waiting for an input), by **Population**, or by **Name**; once a town pays you rent, Towns also sort by **Your property** (rent, then the past year's returns). The order is set when you open the list or change its search, type or sort, so figures update while the game runs without moving any card; open the list again after moving the map to sort around the new spot. Click a card to center the map on it and open its details.

The **Chains** explorer connects recipes into a complete production graph for the current environment. Select an output to follow its ingredients back to the raw materials, or show every industry. Select a factory type to see every matching site in the world, then use **Locate** to center the map and inspect it. An industry's inspector lists customers for its outputs and the five closest matching destinations, including towns when they accept that cargo. These distances are straight-line planning aids; routes still require connected roads, railways or water and stops whose reach covers the actual source and destination.

While an industry's inspector is open, the map draws a light dashed arc from its marker to each of those destinations, with a numbered bubble that matches the list. When a destination is off screen or behind a card, its bubble waits at the edge of the open map, where the arc leaves it. Point at or tab to a row, or its **Plan** button, to pick out its arc; the others fade. The arcs go when you select something else or close the inspector, and they are never clickable: the row's locate button still takes you there.

The world changes through slow, local updates. Factories work on staggered days; output and expansion depend on their surroundings, ingredients and deliveries. Forests help logging camps, water helps farms, mineral ground helps mines, and road or rail access helps factories. Weather changes productivity and travel. Industry capacity is reviewed at varied intervals, so factories do not expand together on the first day of each month. Industries grow only while their output is being carried away: once an output store is half full, capacity holds until more is shipped. The inspector shows how full storage is; from half full it reads *Output piling up*, which is never a fault: the route still earns the same. When one of your services already loads there, it names the route where another vehicle would carry more.

The region also gains industries over the decades. From 1952, once your company has delivered freight, a new mine, farm or factory now and then opens 10–24 tiles from a town one of your stops reaches: one every few years for a small company and up to about one a year for a large network. It opens on free, gentle ground with a buyer or supplier within reach, outside the reach of existing stops, clear of homes, zones and other industries, and with the same space for stop ranges and a journey that new towns and industry plots require, so nothing you already run changes. A notice names it, **Show** finds it, News keeps it, and its inspector says when it opened. Serve it whenever you like, or never. Industries never close; a region gains at most half as many new industries as it started with.

Vehicles vary their pace with local conditions and pause to load at stops. Buses, trucks, trains and ships pull away from a stop and brake into the next, over less than a tile for road vehicles and about a tile and a half for trains; this only changes where they are drawn, so arrivals, days on the way, fares, upkeep and where a rerouted vehicle rejoins its line are exactly as before. Vehicle and infrastructure upkeep continues between deliveries. Vehicles waiting for a full load, like vehicles on a broken route, cost 45% of their usual running cost. Accounts close at real calendar-month boundaries, including leap years. Operating profit excludes construction and vehicle purchases, which remain visible separately in the finances tooltip. Route earnings deduct a share of used infrastructure and vehicle upkeep; idle infrastructure and factories remain company costs. Older saves begin operating-cost tracking when first loaded by this version, instead of inventing historical expenses. Factories expand only after productive operation; delivering one ingredient to a stalled recipe does not increase capacity.

Trains keep their engine and coaches spaced together through stops and reversals; the engine pushes the same coaches on the return trip. Click any visible coach to inspect the train. Vehicles disappear at a tunnel's mouth and reappear at the exit, including tunnels made automatically by Road or Rail. A train entering a tunnel keeps its load badge and selection on its visible portion; fully underground vehicles leave no floating badges or rings.

Each vehicle has a small load badge above it: a pill whose tail points down at the vehicle, edged on the left in its route's colour. Loaded vehicles show their resource icon, including passengers; a full green meter means full capacity, an amber meter shows a partial load, and an unfilled meter means empty. These badges stay readable in all three zoom views. Town names rise clear of a stop and its bullets at or beside the town centre, and a badge that crosses a town name or a stop fades so the name and the stop stay legible.

Town names sit on paper nameplates with the population after a thin rule. Road stops have a green circular bus sign and rail stops a blue rectangular train sign, floating just above the shelter or platform; both remain visible with names switched off. Signs occupy 20, 22 and 24 display pixels in Region, Town and Detail, while the buildings keep their shared physical scale. Pale road-bay edges, amber platform safety lines and end boards distinguish the stop on the ground. From the Town view in, a sign carries the bullets of up to three routes that call there, lowest number first, then a *+2* tag for the rest; the Region view keeps only the bullets that clear the town names. An offline route's bullet is faded, a stop whose routes are all offline has a red border, and a grey border marks a stop that no route uses, which still costs upkeep. Point at a sign, or select its stop, to see the stop's name. Where two stops or a stop and a town name would meet, the later sign steps aside on a thin stem. A selected place is outlined in orange, and the place under the pointer in pale paper.

Every paid delivery floats its income above the stop (above an airport's sign, over its terminal), with the cargo’s icon, and the month’s profit in the top lane glows briefly. Deliveries at one stop within a moment share a figure, and in the Region view nearby stops add up to one total. Figures never cover a town’s name: one at a town-centre stop starts above the name. The figures fade after about a second and a half, stay in place with reduced motion, and can be hidden with **Map layers → Income**. With sound on, a delivery on screen also rings a soft two-note chime; the browser remembers the sound choice and starts audio after your first keyboard or pointer action.

## Grow your towns

Recent passenger arrivals and cargo supplies create demand for gradual growth. Roads, neighboring homes, shops and local services help neighborhoods fill in; greenery improves residential surroundings, while nearby industry discourages housing. Development happens in small, staggered steps. A new town costs $45,000 and needs level land at least 11 tiles from another town center.

New homes appear on free land beside a road within a few tiles of the town center, and larger towns reach a little further. Towns take level plots first, then a sloping plot they can level, and level it for free; only a plot that shares a corner with a sloping street, another building or the shore keeps its stone plinth. When a town you serve has no such land left, it now and then lays a short street of its own, two or three tiles straight out from a road at its edge, and new homes follow along it. Town streets are public roads: they cost you nothing to maintain and can be bulldozed like any road. They only use open, buildable ground and stay more than two tiles from your stations, ports and railways, off your zones and the land a zone needs to grow, and off a road you are drawing. Towns ringed by water, rock or steep slopes stop growing once their streets are full; zoning or a road of your own gives them room again.

A town's inspector shows how it has grown: **Growth** counts the residents it gained since its count three months back (towns are counted on the first of each month, so a new company sees the line from February), or reads *quiet* when nothing has changed. **Help it grow**, folded closed at the bottom, says how many free road-side plots are left within the town's reach and holds the **Add zones** button; it stays open once you open it. In the Towns list, a town that has gained residents over those months carries a *Growing* tag.

Place residential, commercial or industrial zones near a town, then provide nearby roads and transport service. Isolated zoning stays vacant. A zone drag fills the rectangle between its corners, up to 16 × 16 tiles, so one diagonal drag across a street zones both sides; hold **Shift** to zone a single line instead. The drag leaves roads, railways, stops, buildings, industries, water, mountains and tiles already in that zone as they are, and the tip counts the rest, for example **Residential · 6 × 6 · 32 tiles · 20 need a road · $13,440**. A zone grows only with a road on one of its eight neighboring tiles. The preview marks the tiles without one in muted amber; they are still zoned, so you can lay the street afterwards. Residential buildings house more people, commercial buildings support the town, and industrial zones develop into workshops. Bulldozing housing removes its residents from the town that originally received them, even if another town is later founded nearby. Cargo-producing mines and factories are separate buildings in the industry catalog. Existing buildings remain in place when development stalls. Larger upgrades require a clear contiguous plot and can consolidate adjoining empty zones of the same category. Roads, other zone categories and existing buildings block the expansion; the inspector explains when an upgrade needs more space.

What you deliver shapes what towns become. Passenger service alone lifts zoned homes through every tier, only slowly. Food delivered to a town within the last 120 days lets its homes grow into comfortable homes about four times faster, and goods, furniture or machinery (whichever your environment makes) do the same for prestige homes. Goods or fuel help shops become services, and stone or cement speeds up every zoned building. Nothing is lost when a supply lapses: development only slows again and never goes backwards. While one of a town's zones is waiting on such a cargo, its **Town economy** fold names it, and the Towns list shows what each town has received.

**Workshops** are a town's light industry, and they make freight of their own. Industrial zones develop into 2 × 2 workshops: a zoned 2 × 2 block builds one on its top tile, whichever tile is ready first, and a lone industrial tile builds one over clear land beside it (the zone inspector says *Needs 2 × 2 clear tiles* when there is none). You can also place a **Workshop** from **Buildings** for $12,000 within 10 tiles of a town center. It opens after six months of construction. **Expand** in its inspector starts a timed upgrade that adds a level, up to 3, for the same price. A town with workshops buys their materials at any stop whose reach covers its center, always at the full fare, whatever the size of its workshops. Each level turns 15 materials a month into about 7 products (two materials make one), which wait in town for a route; a workshop's size only limits what it makes. The products must go to another town: the route form refuses a route that would bring them back to the town that made them. Delivered to another town, furniture and goods count as its household goods. **Town economy** lists a town's workshops, what waits for them and what is ready, and routes name such an end *Alderbrook workshops*. Workshops cost no upkeep; left alone, they simply wait.

| Environment | Workshops turn |
| --- | --- |
| Taiga | Lumber to furniture; steel to machinery |
| Tundra | Steel to goods |
| Desert | Glass to goods; copper wire to goods |

Each town is also a small market. Inspect a town and open **Town economy** to see three demand bars, **Homes**, **Shops** and **Workshops**, each Low, Some or Strong. Regular passenger service raises Homes, most of all with two stops in town, and local services and jobs add to it. The passengers you bring in go shopping (mail bags do not), so a busy town wants more shops than it has, and a town of 150 residents or more with few shops or workshops wants workshops. The bars are reviewed on the first of each month and only ever speed things up: a zone grows up to half as fast again while its bar is up, and a town whose homes are in demand builds its own homes up to half as fast again. The zone and town inspectors name a strong bar as *Homes in demand*, *Shops in demand* or *Workshops in demand*. Under **Shops want each month** the town lists what its shops would buy this month: food, household goods (furniture in taiga, goods in tundra and desert) and fuel, which grow with its residents and with the grocers, bakeries, butchers, hardware shops, florists, hotels, garages and pubs it has, plus building materials (stone or cement) while zones beside a road are still developing there. Wanted cargo pays 25% more than its full fare, up to those amounts each month, and the line ticks once a want is met. Beyond them, and for every other delivery, the town still takes everything at the full fare, so nothing is lost if you ignore it. The route form's forecast counts the bonus a new route would earn (its details say how much), and the balance tooltip shows last month's market bonus.

Each town has an opinion of your company, from Appalling to Outstanding. Inspect a town and open **Opinion of your company** at the foot of its inspector to see why. Towns start at Good. Regular service builds it over ten months, and stops in town and recent town deliveries add to it. Demolishing homes, other town buildings or woodland within 10 tiles lowers it for a while, and the town forgets within a year. Opinion never blocks construction, never slows growth and never changes fares. Excellent and Outstanding towns build their own homes 5% and 10% faster, and the first time a town rates you Outstanding a short notice says so. **Town hall**, the fold right after it, offers two optional purchases, priced by town size and inflation with the price on the button. **Advertise** brings about 50% more passengers to your stops there for six months, which pays when your vehicles leave with empty seats. **Fund development** lets the town build its own homes about twice as fast for a year, and your zones there develop twice as fast, even without service. Zones still need a road. Under the button the town hall says what a funded year would reach: your zoned tiles there, or the town's free plots nearby. Both simply end when their time is up: there is no upkeep, reminder or notice, and advertising never buys opinion.

**Your property.** Zones you paint are your land: once developers build on them, they pay you ground rent each month, by the zone tiles you bought and the level of what stands there, so a 2 × 2 home grown from one zone pays for one tile. Homes, shops and services you place from **Buildings**, and the workshops you place, are yours outright and pay rent on their price. Schools, hospitals, police and fire stations, stadiums, churches, pubs, town halls, parks and sports grounds are the town's and pay nothing. Rent arrives as each month closes and floats up above the town's name, unless the **Income** layer is off; the finances card shows last month's rent, and your very first rent arrives once as a notice. How full your property is follows your transport: regular passenger service fills homes, stocked shelves and visiting passengers fill shops, and materials in and products out keep workshops busy. Occupancy never falls below 60% for homes, 40% for shops and 30% for workshops, so rent never stops, and property has no upkeep and never loses value. Property earns only within 10 tiles of a town centre. A building's inspector shows its rent, occupancy and worth; **Sell** returns one you placed to its town for 60% of today's value, and the building stays as it is. **Town economy** shows last month's rent in a town and the plots and buildings you hold there.

Before you invest, the zone and building tools say what an investment would bring. While you drag zones, or point a home, shop, service or workshop at its spot, the tip adds a second line under the price: the town, then about how many residents and how much rent a month residential zones bring once built up and when they pay back; the rent and payback of commercial zones and what the town's shops would want more of; the products a month industrial blocks (one workshop per whole 2 × 2 square) or a workshop would make from delivered materials; or a placed building's rent, with what a shop would earn with its shelves stocked. A town without recent service reads *Develops once a route serves Alderbrook* (a funded town develops anyway), zones more than 10 tiles from every town centre read *Too far from a town to develop*, a building in the countryside *earns no rent*, and the town's own buildings, such as schools, show nothing. The figures are today's: they follow your service, the town's demand bars and its stocked shelves, and never promise a larger building spreading onto free land. Afterwards, **Town economy** shows what the past year there brought you: rent, market bonus and workshop freight, with a small line of the months. Workshop freight is the fares for materials the town's workshops took and for products only they could have made, less any market bonus; products loaded at a stop that also reaches a factory making them stay with the route. The Towns list gives each town that pays you rent a **Your property** row, and the Company report's property table adds each town's past twelve months. While you build in a town, or inspect a town or a property, the map outlines your property from the Town view in: buildings you own in a solid green line, plots developers built on your zones dashed.

Nature also changes gradually: neighboring vegetation, moisture, climate and development influence local succession. It spreads in small steps and preserves roads, stations, industries, buildings and designated zones. The same seed and actions reproduce the same future; simulation speed and frame rate do not change the random outcomes. Saving preserves production schedules and vehicle loading waits.

## Building over time

New homes, shops, amenities, workshops and industries begin as construction sites. Their full price is paid when placed, and the complete plot is reserved immediately. Construction cards, the placement preview and Gallery show the duration. Inspect the site for its progress and opening date.

Red-and-white tape surrounds excavations, followed by structural frames and finishing work. Small homes take about **2–4 months**; larger civic buildings, workshops and shops take longer. Farms and raw-material sites take **6–9 months**, and complex factories take up to **12 months**. Construction follows game time, pauses with the game and survives saving and loading. Sites open automatically; residents, services, production and rent begin then. Connections can be prepared beforehand, and route estimates explain when a supplier or buyer is still being built. Roads, tracks and stops remain immediately usable.

Buildings already present in generated worlds or older saves stay complete. Normal Undo and demolition work on construction sites too.

## Living woodland

Trees have a roughly **ten-year life cycle**. Saplings grow for their first two years, mature woodland ages after about eight years, and fallen timber remains for roughly six months before the ground clears. A clearing stays bare for at least six months; nearby trees may then seed new growth when local conditions allow it. Existing forests begin with varied ages, so the landscape changes gradually. Tree growth never replaces buildings, roads, tracks or reserved sites.

## Building variety

**Buildings** offers zoning and an illustrated catalog of **43 directly placeable building kinds**. New generated towns use 37 kinds, including town halls, parks, playgrounds, pools, sports grounds and three additional shops; worlds made with recipes 1–7 retain their original 26-kind collection; residential/commercial zoning still develops varied homes, shops and services. Three parks and three shopping centres are additional player-built projects.

| Collection | Designs |
| --- | --- |
| Affordable homes | Workers’ cottage, timber cabin, terraced cottage |
| Comfortable homes | Gabled family home, brick villa, garden bungalow |
| Prestige homes | Country manor, grand townhouse, courtyard villa |
| Community | School, hospital, police station, fire station, stadium, church, village pub, town hall, park, playground, swimming pool, sports field, tennis courts, sports hall, ballpark |
| Parks | Village green, formal gardens, woodland park |
| Shops | Grocer, bakery, butcher, hardware shop, florist, café, pharmacy, bookshop |
| Shopping centres | Neighbourhood shopping centre, shopping mall, modern shopping mall |
| Services | Post office, bank, hotel, garage, barber |

The nine house kinds each have three architectural designs and two physically drawn rotations: 54 architectural cutouts shared across the three climates. They include old timber, stone and brick homes, classic cottages and villas, modern glass and flat-roof homes, solar timber houses and planted roofs. All retain smaller structures, gardens, fences and paths. A saved tile variant chooses the design and rotation consistently across reloads and zoom changes. Architecture shares a muted material palette while transparent gardens reveal each environment's terrain. Matching display densities cover all three zoom levels and standard/Retina displays. Existing towns receive the artwork on reload. See [sprite scale and generation](SPRITES.md).

Each of the five small shops has **three visual styles**, chosen consistently by its saved tile variant while keeping the same business and footprint. These 15 architectural cutouts share their materials across the three environments. Gardens reveal the actual grass, snow or soil beneath them while keeping the house, fences, flowerbeds and paths. On sloped ground, the raised garden repeats that same terrain on its level top; irregular fieldstones support its sides.

Parks add usable greenery and local amenities and reduce nearby pollution. The village green and formal gardens use 2×2 plots; the woodland park uses 3×3. They are public community buildings and earn no private rent. Shopping centres are private commercial property: they add shopping jobs and outlets for both food and household goods, increasing the town's monthly wants and the amount eligible for its delivery premium. Household goods are furniture in Taiga and goods in Tundra and Desert. Supplying both retail families improves a centre's occupancy and rent.

| Shopping centre | Footprint | Shop units | Food / household outlets |
| --- | --- | ---: | ---: |
| Neighbourhood shopping centre | 2×2 | 4 | 2 / 2 |
| Shopping mall | 3×3 | 8 | 4 / 4 |
| Modern shopping mall | 3×3 | 12 | 6 / 6 |

The parks, play and sport, the town hall and the café, pharmacy and bookshop use generated painted artwork in all three climates ([town feature assets](assets/world/buildings-town-features/README.md)).

Town streets beside homes and zones have paved sidewalks with street lamps and litter bins. Road tiles joined into a block, 2 × 2, 2 × 3 or larger, are paved as one square, like a town square or car park, with kerbs and parking bays where it meets land; vehicles still drive across it.

Residential zoning moves through the three housing tiers as it develops. Community buildings and services improve local development conditions; the game does not simulate individual education, crime, disease or fire incidents.

## Shape the land and cross it

Hills and valleys use eight discrete grid-point heights, 0–7, with 12-pixel steps at Normal relief. Most terrain occupies the middle levels, leaving room for both valleys and peaks. Neighboring points differ by at most one level. Fifteen simple corner patterns each use two triangular faces, with stronger light on northwest faces and shade on southeast faces. Sparse mountain and glacier objects occupy 3×3 to 6×6 tiles, with larger formations appearing less often. Existing worlds receive the new rendering without changing their geography. Choose **New world** for mountain ranges, river valleys, desert mesas and towns on level ground.

Open **Terrain** in the main toolbar. **Raise +1** and **Lower −1** change each selected dry grid point by one level per click or drag. The connected faces reshape around it. Land stays between levels 1 and 7; water and shoreline points stay at 0. Clear adjoining buildings, zones and networks first. If a higher point is blocked by lower neighbors, raise those neighbors first. Cities, industries and stops remain protected. The preview shows the level change and price; edits are saved with your company.

**Level area** matches a rectangle of grid points to its first point’s height. The preview includes the full price; each changed point is charged for every height step. Protected land, an unreachable boundary height or insufficient funds reject the whole area. Leave a border around the corridor you want to build so its edges can slope into the surrounding land.

Roads and railways climb straight uphill/downhill grades; turns and junctions need flat ground. Construction keeps usable grades and automatically levels clear land where needed to make the selected path work. The preview includes the leveling charge in its total and marks the proposed ground heights in light amber, including changes beside the path. Water, occupied land and existing networks stay protected: if the path cannot be made safely, the complete stroke is refused before either building or reshaping the ground. Existing saved networks continue to work. Raise, Lower and Level area remain available for deliberate landscape changes.

Choose **Road** or **Rail** in the same section, then **Bridge** or **Tunnel**. Drag at least three tiles between dry ends; the preview snaps to a straight line. Bridges cross water or lower ground; tunnels pass through higher dry ground. Construction levels clear approaches to a shared height when it can do so safely, and includes that work in the upfront price. Banks beside protected water or occupied ground may need a different starting point. Invalid or unaffordable spans show the reason before you release and leave the whole landscape and balance unchanged. One Undo takes back both the crossing and its leveling. Connect roads or rails to each end; routes use the completed crossing. Ordinary Road and Rail tools still provide automatic crossings over water and mountain terrain.

## Scope

Transport uses a compact economic simulation with one or more vehicles per two-stop service and automatic vehicle movement. Road vehicles, trains and ships can carry passengers or freight, and planes passengers and mail, with different speeds, capacities and costs. Fares grow with distance and reward fast delivery. Road and rail crossings are allowed. There are no signals, collision management, air traffic control, competitors, multiplayer, canals or vehicle timetables; the one vehicle order is the optional full load for freight. Road and Rail automatically choose bridges and tunnels per tile across the relevant terrain.

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

The minimap renders at most 512 × 512 terrain samples while preserving thin roads and rails in a separate overlay. Ecology samples at most 4,096 cells per simulation day on large maps. The map then redraws only the terrain around the cells that changed, which roughly halves the cost of drawing a new day at Region view. An open mini map recolours only the pixels of those cells, so it keeps up at 8×; a hidden one is not drawn until you open it.

The optional browser smoke uses Playwright and an installed Chrome browser. With the server running on port 8000:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/browser-check.mjs
```

Set `TRANSPORT_PLAYWRIGHT` to an absolute Playwright module path if it is not installed in the current Node environment. The smoke exercises desktop construction and routes, saving and reloading huge worlds, all building collections, civic placement, atlas navigation, rendering cache limits, biome generation and the delivery milestone. It writes screenshots to `/tmp/transport-qa` by default.

The construction-feedback check exercises real builds, Undo, refused placements, paused cleanup and reduced motion on desktop and laptop screens. The sound check covers the real audio toggle, immediate mute, hidden-page silence and a remembered choice unlocked by keyboard. The next-step check verifies road suggestions after Railway was selected and producer-to-town supply drafts:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/construction-feedback-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/game-audio-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/next-step-ui-check.mjs
```

The lifecycle-art check covers excavation, frames, finishing and completed buildings; tree growth, aging, fallen timber and clearings; full-plot picking; paused rendering and scenery-cache reuse. It checks Region, Town and Detail at DPR 1 and 2, including all three woodland climates, and writes images and results to `/tmp/transport-lifecycle-art`. The lifecycle-UI check uses the real desktop and laptop controls to place homes and factories, inspect durations and progress, save and restore active projects, and verify automatic completion and woodland inspection. Its screenshots and results go to `/tmp/transport-lifecycle-ui`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/lifecycle-art-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/lifecycle-ui-browser-check.mjs
```

The optional computer-only entry check opens portrait and landscape phones, a tablet, a touch-only device and a mobile browser with a mouse. It verifies the exact message, preserved saves and preferences, and that no game modules load. Narrow computer windows and hybrid laptops still reach the start menu:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/computer-only-browser-check.mjs
```

The focused autosave check waits for a real timed write, leaves the page, and verifies restoration without creating a named save. It then blocks storage and checks the single failure notice, the Game menu marker and recovery:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/autosave-browser-check.mjs
```

The gameplay shell check covers the initial main menu, collapsed management, full-width playfield, tool selection and its rule hints, optional minimap, map menus, keyboard focus, return to the main menu and Resume. It verifies desktop and laptop layouts and saves screenshots to `/tmp/transport-compact-play`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/compact-play-browser-check.mjs
```

The construction-toolbar check covers the four construction areas, focused drawer contents, the shared Bulldozer shortcut, Road/Railway/Stop keyboard controls, Gallery access through the Game menu and focus return, goal visibility and fold preservation, quoted stop construction from selected infrastructure, road/rail crossings, complete Undo and the handoff to route creation. It checks compact headers at desktop and narrow computer widths and multiple display densities, writing screenshots to `/tmp/transport-construction-toolbar-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/construction-toolbar-browser-check.mjs
```

`tests/route-workflow-browser-check.mjs` checks separate route browsing, creation, editing and selected-service details. `tests/route-framing-browser-check.mjs` keeps draft endpoints clear of visible panels at desktop and laptop sizes. `tests/persistent-network-tool-browser-check.mjs` covers consecutive gestures for all six network tools, exact pricing, Undo and cancellation at both sizes. `tests/world-spacing-v12.test.mjs` checks recipe 12 site spacing and frozen recipe 11 and 12 geography; `tests/world-spacing-v13.test.mjs` checks the current recipe's rivals, plot gaps and town separation. `tests/world-spacing-browser-check.mjs` builds and launches the first freight route in all three climates, then saves and restores each recipe 12 company through the menu.

The route-entry check covers fresh drafts from the route list and stop inspectors, correct construction tools for missing stops, unsuitable cargo explanations and preserving focus and text selection during live updates. Keyboard-panel and notice-action checks cover Escape inside fields, native panel scrolling, map arrow controls, pausing notice expiry during hover/focus, Undo and finance popover focus:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/route-entry-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/keyboard-panel-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/notice-actions-browser-check.mjs
```

The focused station-art check compares direct and prepared road/rail pixels, native display sizes, missing-art fallback and shared portraits at Region, Town and Detail on standard and Retina displays:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/rail-station-browser-check.mjs
```

The stop-orientation check covers road and rail endpoints, through routes, corners, junctions and slopes at every view and DPR 1/2. It verifies ground registration, opaque-art picking, live orientation changes, and readable bus/train pictograms with names hidden. Screenshots and results go to `/tmp/transport-stop-orientation`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/stop-orientation-browser-check.mjs
```

The station-picking check covers opaque road, rail and harbor artwork beyond its ground tile, transparent margins, neighboring reserved parcels, foreground occlusion and scenery-cache reuse:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/station-sprite-picking-browser-check.mjs
```

The focused zoom check exercises every zoom input, wheel gestures (a sideways scroll pans at the same view; with Scroll to pan, small vertical scrolls pan, Control+scroll still zooms one view and the choice survives a reload), pointer anchoring, tile picking, high-density rendering, resizing, cache limits and construction invalidation at all three views. It saves desktop screenshots to `/tmp/transport-zoom-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/zoom-browser-check.mjs
```

The focused resource check covers the illustrated key, recipe quantities, inventory and station symbols, clicking map markers at all three zooms (including a served marker, with its ring and storage-bar counts, and a marker moved onto its own building), that no marker stands on another site, that markers keep their places through a long pan, construction beneath markers, selecting and delivering freight, the cargo payment rates chart (a line per biome cargo, the hover and arrow-key tip, legend highlights and the table view), the Mail entry and its caption in the key, and readable layouts at desktop and laptop widths. It saves screenshots and an icon contact sheet to `/tmp/transport-resource-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/resources-browser-check.mjs
```

The readability check starts a seed-1847 world and verifies that the first town's name clears its central stop sign at all three zooms, that Region stop signs still pick route stops, that the stop inspector keeps its values clear of the coverage below, and that inspector tags, the drawer heading and dialogs use sentence case. Screenshots go to `/tmp/transport-readability-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/readability-browser-check.mjs
```

The hover-picking check sweeps the pointer over the start town at all three zooms at 2× density. Each sprite must be read back at most once, with no more readback warnings than sprites, and every pick must stay under 3 ms. At 500 seeded points per zoom, at 1× and 2×, the sprite masks must pick the same tiles as one-pixel readbacks. Sixty moves inside one tile of a paused map may repaint it at most twice. Screenshots go to `/tmp/transport-hover-pick-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/hover-pick-browser-check.mjs
```

The focused network-planning check covers complete production graphs, industry locations and nearby customers with the arcs a selected industry draws to them, route searching/filtering, renaming stops and routes, editing a route's end stop and freight without selling its trucks, selecting stations on the map, live network verification, route highlights, Show framing, break pins and the needs-attention chip, vehicle load indicators at all three zooms, a saved teal line drawn in its Cobalt fill, stop signs that clear town names and each other, use mode pictograms instead of letters, show red or grey status borders and name their stop on hover, default route names, a mail route between the first two towns (Passengers kept, Mail offered second, its name, truck, price, envelope floater, card and reload), and compact computer layouts. It uses isolated browser storage and writes screenshots to `/tmp/transport-features-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/features-browser-check.mjs
```

The route stress view builds twenty routes of road, rail and water on seed 1847 and screenshots them around the first town at Region, Town and Detail, with a sheet of every bullet shape in every line colour on paper and on grass. Look at each picture after changing the line language; screenshots go to `/tmp/transport-route-stress`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tools/route-stress.mjs
```

The focused save-slot check creates distinct companies, switches their complete state, checks active autosave restoration, and exercises rename, overwrite, delete/cancel, damaged data and storage failures. It also checks reload persistence and the dialog at laptop sizes. Browser storage is isolated from your saves; screenshots go to `/tmp/transport-slots-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/slots-browser-check.mjs
```

The focused Layers check compares rendered pixels for the 15 map switches at every zoom (the 16th, Next goal, shows or hides a card), verifies restoration and overview rendering, checks that ecology days patch the overview to exactly a full resample at 512² and 2048² and that a hidden mini map is not sampled until it opens, checks hidden industry/stop marker picking and unchanged game state, and covers preference persistence and recovery, blocked storage, synchronized map buttons, keyboard controls and computer layouts. It uses isolated browser storage; screenshots go to `/tmp/transport-layers-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/layers-browser-check.mjs
```

The airports check plays seed 1847 from 1950: the greyed Airport card and **A** before 1952, the card enabling itself and the one debut headline in January, placing Fernford's airport with its tip, reach outline and **Turn**, refusals on a town centre and a raised vertex that spend nothing, Elmhaven's north–south airport, footprint lookups from runway and apron tiles, a 108-tile flight picked by the airports' signs, the first delivery's figure above the sign, the plane's card and **Follow**, save and reload without a replayed debut, and bulldozing. It renders taiga, tundra and desert at all three zooms, DPR 1 and 2; compares pixels for Stops, Vehicles and Cargo loads; measures the terminal, tower and airliner art against the houses' weight; and checks the Airport card and **Turn** control. Screenshots go to `/tmp/transport-airports-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/airports-browser-check.mjs
```

The delivery-income check waits for a real delivery at 3×, then compares the pixels above the stop: the figure appears above the town’s name, rises, fades, stays still with reduced motion and disappears with **Income** off. It also checks the profit glow, one summed figure per Region cell and that a paused map stops redrawing once the figures fade. Screenshots go to `/tmp/transport-floaters-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/delivery-floaters-browser-check.mjs
```

The property check places a cottage near Alderbrook with the Build tool and runs the month's last hours at 8×: one rent pill with the Rent pictogram rises above the town's name without a chime and hides with **Income** off, and the first-rent notice appears once and never after a reload. The cottage's inspector shows its rent, occupancy, worth and **Sell**; **Keep it** changes nothing, selling pays 60% of its value, and Ctrl+Z then refuses. The company report's **Property** section fits at desktop and laptop sizes, and a fresh world shows none of it. Screenshots go to `/tmp/transport-property-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/property-browser-check.mjs
```

The city check drags a residential rectangle beside Alderbrook and reads its forecast under area-zoning's quote, drags one far from every town (a warning: *Too far from a town to develop*), and points the cottage, school and grocer tools near the town. It then places a cottage and a workshop, lays a road from a new sawmill with Plan road's builder and runs a lumber route for 13 months: Town economy shows the past year's rent and workshop freight with their line, the Towns list gains **Your property** and its sort, and the Company report its past twelve months. Property outlines appear with Buildings open or a town inspected at the Town view, and not in Explore or at the Region view; seventy of them add well under 0.3 ms a frame. The inspector and forecast tip fit a laptop window. Screenshots go to `/tmp/transport-city-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/city-browser-check.mjs
```

The cargo-lens check chooses Iron ore in Routes and compares the on-screen producer and buyer counts with the iron mines and steel mills in view, checks that another marker renders at half strength and that the atlas colours the mine and a steel mill. It then clears the lens with Passengers, the chip, the planner, another view, the drawer and Escape, keeps it while picking stops, and covers the Industries filter and Chains Locate with town chips. Screenshots go to `/tmp/transport-cargo-lens-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/cargo-lens-browser-check.mjs
```

Shipping has a focused browser check for building ports on generated rivers, map picking, ferry deliveries, search/filtering, disconnected lakes, save restoration and computer layouts:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/shipping-browser-check.mjs
```

The annual-economy browser check verifies individual and fleet upgrades, affordability, price display, save restoration and clearing decorations:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/evolution-browser-check.mjs
```

The inspector check emulates Safari's click focus and presses **Full chain** 20 times at 1× and 8×, confirms an unchanged station inspector is never rewritten, and follows a target with the keyboard to the labelled inspector heading:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/inspector-browser-check.mjs
```

`selection-underlay-browser-check.mjs` checks full plots, slopes and moving carriers at every zoom and display density, ensuring opaque sprite pixels stay above selection and warm scenery caches remain reusable. `selection-gallery-browser-check.mjs` exercises real object clicks, unduplicated portraits and reference links, actual designs and airport orientation, live actions, complete facts and recipes in the Gallery dialog, related entries and returning with selection and focus intact.

The notices check covers the welcome toast, bursts of notices, grouped disconnections with their Show action and attention count, a demolished quarry's warning and its route under Needs attention, News, the January toast and its upgrade review, the Towns search across January, a mail route that delivers without a toast or News entry, first deliveries, town milestones, quiet save loading and computer layouts. Screenshots go to `/tmp/transport-notices-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/notices-browser-check.mjs
```

The company check picks a Lean start in the new-game form, runs the company for three years and checks the January review with **Open report** and **Review upgrades**, the report's four charts, yearly table and route ranking, borrowing and repaying with the finances card's loan rows, the below-zero warning shown once per streak while News keeps each month, a route below its upkeep and the retire warning, and a laptop layout without sideways scrolling. Screenshots go to `/tmp/transport-company-qa`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/company-browser-check.mjs
```

Marine rendering has a focused check in `tests/shipping-renderer-check.mjs`.

The nature check renders woodland contact sheets and wilderness views in each biome at all three zooms and DPR 1/2, measuring clipping, transparency, Layers restoration, cache reuse, construction and save compatibility. It writes artifacts to `/tmp/transport-nature`:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/nature-browser-check.mjs
```

`tree-variety-browser-check.mjs` verifies all added species and atlas densities, physical scale, roots, shadows, seeded woodland, missing-art recovery, Gallery entries and unchanged legacy-save terrain across climates, zooms and display densities. `generated-art-coverage-browser-check.mjs` checks every registered nature identity and climate-scoped startup loading.

The controls check covers automatic crossings and stops, exact quotes (refused strokes that spend nothing, partial zone drags, stop coverage and route warnings in the tip, and pixel checks that only the offending tile turns red), drag cancellation, area zoning (a diagonal drag zones both sides of a street in one toast and leaves the road alone; Shift keeps a line; the 16 × 16 cap; a Shift-held Bulldozer rectangle counts sites), keyboard activation, the keyboard tile cursor (Tab to the map, then R, Enter, three Right arrows and Enter build four road tiles for their quote; S and Enter place a stop; Enter picks both route stops; Escape steps back; Enter on a town lands on the labelled inspector heading), long strokes (a road held at the right edge scrolls the map and grows, ArrowUp mid-drag moves its end), compact menus and desktop controls:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/controls-browser-check.mjs
```

`next-goal-browser-check.mjs` walks the seed-1847 first route through the Next goal checklist, alternatives, the folded preference with its changed chip and v1 migration, the Next goal layer, temporary hiding during browsing or inspection without duplicate drawer suggestions, a paused chip that clears the card in a compact computer window, and desktop and laptop layouts. `milestones-browser-check.mjs` covers the first milestone riding on the first-delivery toast, one milestone toast a game month, News and Company goals at desktop and laptop sizes, the card past the first-route stages, and silent backfill and no replay after a reload. `node fun/transport/tests/next-goal-servable-check.mjs` is a slower sweep: 75 new worlds must suggest only producers and buyers a stop can serve.

`plan-connection-browser-check.mjs` goes from a new seed-1847 world through **Plan road**, **Build** and **Launch route** in three actions, checks that nothing is spent before Build and that Build spends exactly the banner's sum, that Cancel, Escape, Another idea and exploring the map behave, that a stop placed since the preview makes Build show the new plan first, that one Undo refunds the bundle, that taiga 7 and desert 1847 deliver within a month as well, and that the card and banner fit a laptop window.

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/plan-connection-browser-check.mjs
```

`contracts-browser-check.mjs` follows seed 1847 from the first stone delivery to silent offers folded below Fleet upgrades, **Show** framing both sites beside the inspector in a desktop window, a stone contract for Pinehaven won with one toast and a card that keeps its height, no replay after a reload, and the closing toast twelve months later.

`interconnection-browser-check.mjs` covers references and the camera on seed 1847 with the stone route: hovering an injected quarry reference links every copy and tells the map within 300 ms; a click glides, lands within 600 ms, inspects the quarry and frames it in the band beside the inspector; a reference inside the inspector adds **Back to Stone quarry**, which returns at its scroll; Enter on a reference lands on the inspector's heading and Escape hands focus back; map hover lights the references; a far town's edge pointer names its distance and cuts there with **Back to where you were**, which returns the camera; reduced motion cuts in one frame and scrolls panels without smoothing. Screenshots go to `TRANSPORT_OUTPUT`.

`town-outlook-browser-check.mjs` starts seed 1847 with no growth line and a closed **Help it grow** fold, then after 200 days checks Alderbrook's growth and room-to-grow lines against the saved counts and lots, a fold that stays open through live refreshes, a quiet unserved town, **Add zones**, and *Growing* tags in the Towns list that match the counts.

`route-building-browser-check.mjs` exercises the full stop → supplied cargo → vehicle-count flow, automatic and manual names, atomic purchases, existing-service fleet additions, edits, map and keyboard selection, paused blinking previews, reduced motion and laptop layouts. `route-preview-motion.test.mjs` checks the pulse and reused route geometry.

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/route-building-browser-check.mjs
```

The comprehensive follow-up checks include `cohesion-browser-check.mjs` (projects, searches, finances, paused disconnection and storage failure), `vast-browser-check.mjs` (large-world quota and continuation), and `controls-browser-check.mjs` (mouse, keyboard and trackpad controls).

`scroll-input-browser-check.mjs` checks real drag, click, Space/right-button and wheel-pan input at fractional and Retina display densities. `scrolling-performance-browser-check.mjs` measures forest, city and traffic-heavy Town views during 120 continuous-pan frames across several cache boundaries, with screenshots after timing. It checks bounded memory, retained scenery, traffic fallback and preparation after release. Optional `TRANSPORT_RENDERER_SOURCE` and `TRANSPORT_SCENERY_SOURCE` paths load frozen modules for repeatable before/after comparisons; `TRANSPORT_DPRS`, `TRANSPORT_SCENES`, `TRANSPORT_FRAMES` and `TRANSPORT_OUTPUT` narrow the run. Run performance measurements separately from other browser checks. Paired `scenery-batches-browser-check.mjs` and `scenery-view-browser-check.mjs` verify pixels, picking, reverse/fractional pans, infrastructure, journal edits and oversized display fallback.

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/scrolling-performance-browser-check.mjs
```

Square-world checks: `square-world-ui-check.mjs` creates all three sizes through the UI and reloads a 2048 world; `square-save-browser-check.mjs` checks developed 2048 saves and named slots; `square-renderer-check.mjs` verifies the bounded minimap and thin networks. `square-world-benchmark.mjs` benchmarks all three 2048 biomes in sequential processes to bound peak test memory.

`uneven-world-check.mjs` compares old and new atlas layouts, habitat variation and settlement clustering across seeds, environments and all square sizes.

`ui-art-browser-check.mjs` verifies generated art in computer build menus, inspectors, filtered lists, production chains, route vehicle selection and biome previews, including Retina density. Screenshots go to `/tmp/transport-ui-art`.

`raster-houses-browser-check.mjs` verifies all nine house kinds, three architectural designs and two rotations in each environment at every zoom and display density, along with transparent sources, cache limits, delayed loading and artwork fallbacks. It saves source sheets, zoom galleries and gameplay views to `/tmp/transport-raster-houses-qa`.

The shared architectural scale, palette and measured ground registration are documented in [SPRITES.md](SPRITES.md). [building-registration.test.mjs](tests/building-registration.test.mjs) checks actual source landmarks, doorway dimensions, retained source hashes and atlas transforms. [sprite-scale-browser-check.mjs](tests/sprite-scale-browser-check.mjs) reviews full sprite envelopes at Region, Town and Detail; use `TRANSPORT_SCALE_FAMILIES=houses,features,cores` for the refreshed families. [town-sprite-sharpness-browser-check.mjs](tests/town-sprite-sharpness-browser-check.mjs) checks display density, camera movement, picking and cached rendering. [rail-terrain-browser-check.mjs](tests/rail-terrain-browser-check.mjs) verifies gray connected tracks on flat ground, slopes, crossings, bridges and tunnel approaches across climates and display densities.

The native recovery art uses fresh metre-based architecture in `native-building-art.js`, shared by town buildings, community features, processors and farm cores. [native-fallback-browser-check.mjs](tests/native-fallback-browser-check.mjs) blocks every raster request and checks all architectural cutouts, transparent gutters, compact saved extents, and complete farm scenes across climates, zooms and display densities. Crop rows, fences, orchard canopies and livestock use the same elevated view; bare ground stays transparent in both map and Gallery portraits.

[native-nature-browser-check.mjs](tests/native-nature-browser-check.mjs) reviews native canopy tops, radial foliage and sparse ground planting, and checks transparent gutters for all 1,664 published forest arrangements. The native redraw retains their existing species, roots, sizes and seeds; only the drawing changes.

The farm and town expansion checks cover all 25 reserved field tiles, blocked outer corners, catchment from every edge, road/rail planning, complete construction and demolition undo, safe legacy-site migration, and exact recipes 1–9. Food-chain checks carry grain, milk, produce and livestock through processing to town shops. Park and mall checks verify greenery, pollution, monthly food/household demand, stocking, rent and saved footprints. Browser checks verify climate-specific 2×2 farm cores, slope-following field ground, fences and markers at all zooms, and garden cutouts, raised terrain and stone foundations at standard and Retina density:

```sh
node --test fun/transport/tests/farm-plots.test.mjs fun/transport/tests/farm-food-chains.test.mjs fun/transport/tests/parks-malls.test.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/farm-core-art-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/farm-fields-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/house-ground-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/town-variety-art-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/parks-farms-app-browser-check.mjs
```

`town-variety-art-browser-check.mjs` checks the three styles of each of the five shops and the six park/mall kinds across climates, zooms and display densities. `parks-farms-app-browser-check.mjs` exercises their real computer catalog, placement on recipe10 terrain, the 25-cell farm preview, a single charge, far-corner inspection, road refusal, whole-field demolition and Undo, mall food/rent inspection and exact new-type save restoration.

`art-loading-browser-check.mjs` keeps generated art through missing densities and their recovery. It checks that startup requests no 256-pixel cells, nor 128-pixel cells at standard density, that every zoom at DPR 1 and 2 matches eager loading once artwork settles, and that late art on an 8 Mbps connection arrives in a few batches. Screenshots go to `/tmp/transport-art-loading`.

The terrain construction browser check covers raising/lowering with real pointer gestures, level and cost previews, protected tiles, road/rail bridges and tunnels, invalid span rejection, save restoration, and the compact computer tools. The automatic-leveling check covers combined quotes, committed ground changes, protected land, cancellation, affordability, Undo and reloading through real construction controls:

```sh
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/earthworks-browser-check.mjs
TRANSPORT_URL=http://localhost:8000/fun/transport/ node fun/transport/tests/auto-level-construction-browser-check.mjs
```

Raised-ground checks: `terrain-geometry.test.mjs` covers shared corners, picking, height edits, deck approaches and bounded large-world caches. `terrain-geometry-renderer-check.mjs` verifies ground/overlay registration, foundations, camera operations and screenshots across three zooms and DPR 1/2. `terrain-mesh-browser-check.mjs` checks texture seams and facet shading. `flat-scenery-browser-check.mjs` verifies flat-only trees, rocks and plants, multi-tile fallbacks, and scenery refresh after height edits across all zooms and display densities. `terrain-leveling-browser-check.mjs` exercises paid area leveling through computer controls and save restoration.

**Type.** Everything the player reads, on the map too, is set in Inter, drawn for small screen sizes, from `/assets/fonts/inter-latin.woff2` (SIL Open Font License, `assets/fonts/OFL-Inter.txt`); the wordmark and the start menu's hero keep Space Grotesk. Explanations a panel only needs now and then live in tooltips: a running route's reason, an industry's steady output, the route planner's hint and the transport's notes, the start menu's fine print, and a first-route goal's sentence.

**Words.** Every message, notice and status follows DESIGN.md section 6: one name per thing (route, stop, town, industry, supplier and buyer), full sentences that end with a full stop, and errors that say what happened and then how to fix it, such as *Timber run uses this stop. Retire the route first, then remove the stop.* `copy.js` is the only formatter for money (with a true minus: −$154), counts, cargo amounts (*144 stone*), dates (*Jan 1950*, *12 Jan 1950*) and vehicle and stop words. A model notice that names a route, stop, town or industry also keeps a template, such as `{route:route-104} is no longer connected.`, so the interface can show each name as a link.

UI changes follow [DESIGN.md](./DESIGN.md). With the server running, `node fun/transport/tools/ui-snapshot.mjs --out DIR` captures every UI state in `tests/ui-states/` at 1440 and 1024 px wide, as screenshots and computed styles, and `--diff A B` lists what changed between two captures.

Every line icon comes from `ui-icons.js`. With the server running, open `/fun/transport/tools/icon-sheet.html` to see each glyph at 16, 20 and 24 px on paper and on ink, beside a label, and every cargo pictogram on its well tile; look at it at 1× and 2× after drawing or changing a glyph.

Buttons, fields, switches, states, rows, menus, the tool bar and the other shared controls live in `components.css`. With the server running, open `/fun/transport/tools/ui-specimen.html` to see each one at rest, on hover, with focus, disabled and pending, on paper and on ink; press *Check this page* for the contrast and type floor, and look at it at desktop and laptop sizes after changing a control.

Performance changes, reproducible dense-world benchmarks and remaining large-map limits are documented in [PERFORMANCE.md](./PERFORMANCE.md).
