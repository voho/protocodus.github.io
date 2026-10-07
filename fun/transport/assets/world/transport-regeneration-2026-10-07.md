# Transport artwork renewal — 7 October 2026

The active fleet has 72 newly generated directional cutouts: bus, express bus,
truck, locomotive, coach, wagon, ferry, cargo ship and tanker in eight headings.
`vehicle-directions.js` selects the `vehicle-*-regenerated-v3` atlases. The nine
recovery cells in `vehicles-regenerated-v3` are copies of their southeast views.
The loading screen and start menu use the new locomotive sources too.

All sources were generated from new vehicle descriptions and the plain measured
camera guide, with a fixed 2:1 dimetric camera, broad muted material colours,
upper-left daylight and compact down-right shadows. Source pixels retain RGBA
transparency; packing never uses a colour key. Eight separate headings preserve
north/south foreshortening. Packing uses one family scale and independent
premultiplied-alpha mipmaps without sharpening, from 16 through 256 pixels.
The existing world frames remain 20px for road/rail and 43px for ships, preserving
vehicle spacing, payload registration and their shared scale with the map.

Actual observed front/rear features determine heading registration. Windshields,
red rear lamps and pointed bows were visually reviewed. The generated ferry
sheet duplicated the front diagonals; two new standalone front views supply SW
and SE. The tanker north view was regenerated. A rectangular extraction removes
neighboring shadow fragments that crossed the tanker source's grid boundaries.
These are source packing operations, not rotated or recoloured vehicle copies.

`cargo-regenerated-v3` contains nine new overhead payload layers. Their overhead
camera is intentional: the renderer projects them onto the vehicle's deck once.
The native payload recovery art also uses newly drawn log tops, bulk heaps,
barrel rings and strapped crates in the same muted material palette.
`isometric-portals-regenerated-v3` supplies eight new concrete road/rail portals,
including rear orientations, with transparent ground and compact shadows.

Native artwork was redrawn in its existing coordinate system:

- `road-surface-art.js`: connected 6.4m carriageway, 0.8m shoulders and restrained
  road markings; arms meet exact tile boundaries in all 15 connectivity masks.
- `rail-surface-art.js`: gray-green ballast, broad sleepers and pale steel,
  retaining the physical 1.435m gauge and continuous corner/junction geometry.
- Bridge and viaduct decks use these new connected surfaces, including raised
  bank approaches. Native piers and footings share a new muted concrete palette,
  northwest face light and short southeast shadows; no old bridge PNG is loaded.
- `airport-art.js`: clean runway/apron slabs and markings, plus a new regional
  turboprop with independently projected 48-heading geometry and matching shadow.
- `raster-transport.js`: transparent survey marks for vacant zoning parcels.
- `native-transport-art.js`: newly projected recovery vehicles, ships, bus and rail
  stops, ports, tunnel shells, street lamps and bins. Vertical edges and light stay
  fixed while the model turns in its ground plane. All infrastructure recovery
  frames share the 72px physical scale of the new station/port sheets.
- `ui-icons.js`, `cargo-icons.js`, `icon.svg`: entirely redrawn SVG pictograms,
  retaining accessible labels and the established icon vocabulary.

Rebuild from retained sources from any working directory:

```sh
python3 fun/transport/tools/rebuild-transport-art.py
```

The adjacent `transport-regeneration-jobs.json` keeps every built-in generation
prompt and repository-relative source path. Per-family `generation.json` records
source hashes, observed headings and additional source images. Original sources
are retained beside the shipping atlases.

Validation uses the real browser checks `vehicle-directions-browser-check.mjs`
and `network-art-browser-check.mjs` at Region, Town and Detail on DPR1 and DPR2.
They cover all headings, source densities, empty/loaded payloads, trailer turns,
recovery art, all network connectivity masks, transparent unused arms and cache
reuse. Node icon, rail, UI-reference and object-density tests cover the native
geometry and updated registrations.

`native-transport-browser-check.mjs` blocks every world PNG and checks all fleet
headings plus every station, port and portal orientation at three zooms and two
device densities. All 432 vehicle and 84 infrastructure profiles remain nonempty,
transparent and unclipped; repeated marine frames reuse their cache.
