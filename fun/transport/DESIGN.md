# Transport UI system

This file defines the UI system for `fun/transport`, and every UI change follows it. If code disagrees with this file, the code is wrong, unless this file changes in the same commit with the reason. Token values are defined here and copied into `tokens.css` (CSS custom properties) and `design-tokens.js` (canvas and JS). `tests/design-tokens.test.mjs` checks that all three match.

Some feature specs set their own colours, sizes or wording, such as literal hex values, a kicker joined with a middle dot, or "Next goal" eyebrows. Where they disagree with this file, this file wins, and the UI items restyle those parts.

---

## 1. What the UI is for

Transport is a calm isometric game about transport and town building. The map is generated and painterly (moss greens, turquoise water, warm roofs), and it is the hero. The UI is the instrument panel around its edges.

The UI has one job. It lets the player read the state of the world and act on it in as few obvious steps as possible. The player moves between the map and the panels without losing their place.

The players know Transport Tycoon, OpenTTD, Mini Motorways and Cities, and they want an elegant browser game, not a spreadsheet. The basic loop stays simple, and the player never has to open anything.

Transport Tycoon touches appear only where they fit: numbered routes, a newspaper for big moments, company records. Towns are the second pillar and get the same visual rigour as routes.

The brand is Protocodus: Space Grotesk, dark green ink, one orange accent (the orange t tile) and warm light paper.

## 2. Principles

1. **The map is the hero.** The default screen is the map, three small rails (navigation, instruments, zoom) and a one-line goal. Everything else opens when asked for and closes without leaving anything behind.
2. **A surface shows how long it lives.**
   - Paper rails are always there (elevation e1).
   - Paper sheets open when the player asks: the drawer, the inspector, the goal ladder, menus and popovers (e2).
   - Ink surfaces either go away on their own or follow the pointer: toasts, tooltips, placement tips, the selection tag, edge pointers and the back chip (e3).
   - Dialogs are paper over a scrim and stop map interaction (e4).
   - World labels drawn on the map are paper plates: town nameplates, delivery and rent floaters, industry badges. They belong to the world, not to the instrument.
3. **One signal.** Orange means "here, now, waiting on you". It marks:
   - the selection;
   - keyboard focus;
   - the current goal step;
   - the paused clock;
   - unread News.

   The t tile is the only orange that is always on screen. At most one orange-filled call to action is visible at a time: the action of the current goal step. The lit pause segment is a state, not a call to action.
4. **One memorable element: the line.** A route is shown as a numbered bullet in its line colour, shaped by its mode, together with a strip diagram of its state. This line language is used on the map and in rows, toasts, goals, forms and contracts. Everything else stays quiet.
5. **Everything named is a reference.** Every mention of a town, industry, stop, route, vehicle or cargo uses the same clickable, hoverable reference, and that reference finds the thing on the map.
6. **Motion only answers.** Things move when the player acts, or to show a change the player caused. Nothing loops except the loading screen.
7. **Plain words, one name per thing.** An action keeps its name from the button to the result. Errors say what happened and how to fix it.
8. **Structure means something.** A border, divider, number, colour or weight must carry information. If it does not, remove it.

## 3. Decisions (how the three proposals were merged)

Three directions were mocked up on real frames of the game and judged:

- **Wayfinding:** dark enamel HUD, transit bullets.
- **Atlas:** paper collar, the UI as the map's margin.
- **Quiet instrument:** light rails, dark means transient.

Two of three judges chose quiet instrument as the base, and all three wanted parts of wayfinding's network language. This system is quiet instrument's frame with wayfinding's line and map language, plus atlas's error handling, selection mark and context aids. Do not reopen these decisions without new evidence from the live game.

| Topic | Decision | Why |
|---|---|---|
| Chrome | Light paper rails. Ink only for transient surfaces. | Dark enamel slabs over the art pulled the eye away from the map (two judges). Light rails match the brand and today's DOM, and need the least CSS churn. |
| Route identity | Number + line colour + bullet shape by mode: road square, rail circle, water pill, air diamond. | Colour alone fails beyond 6 routes and for colour-blind players. Shape shows the mode without letters. Airports need no new chrome. |
| Line palette | 9 colours that alternate deep (white numerals) and light (ink numerals). No green, teal or orange. | Once land, water and signal hues are excluded, pastels alone run out of distinct hues. Per-line numeral colour is real transit practice. Checked on the live map: deep lines with a paper halo and light lines with an ink casing both read on moss, roads and river. Today's pastel teal vanished on the river. |
| Map labels | Keep the paper nameplate pills. Replace the lettered B/T stop sign with a roundel that carries route bullets. | Atlas's stroke-halo labels looked crude over roofs. The B sign collided with town names. |
| Selection | Orange footprint outline on a paper casing, plus an ink name tag. | Quiet instrument's pale outline was too faint. Orange means here. |
| Panel ↔ map | Linked state on every matching reference, a map highlight, and an edge pointer for off-screen targets. | Atlas's leader lines were restless and looked like rendering glitches. |
| Type | Space Grotesk only. 14 px body. 12 px floor everywhere, canvas included. | Quiet instrument's 11 px floor was marginal on phones. |
| Speed | Text segments: pause, 1×, 3×, 8×. | Play-glyph variants were harder to read. |
| Paused | Lit pause segment, "Paused" under the date, and a 2 px orange line along the top edge of the map. | A lit segment alone could read as an error. |
| Goal | One line by default. The ladder opens on demand, on paper, with the current step's priced action. | The dark expanded ladder was a heavy slab. |
| Strip diagram | Capsules filled when loaded; waiting counts per stop; direction chevrons; a cut mark identical to the broken glyph; 8 capsules, then +N. | Carries the most information in the space and solves clustering for large fleets. |
| Errors | What happened, with references; how to fix it; an action named after the fix ("Show the gap"). | Atlas's error wording was the strongest. |
| Context | "Back to <entity>" in the inspector. "Back to where you were" after long jumps. Esc steps back one level. | Players keep their place. |
| Primary buttons | Ink fill. Orange only for the single next step. | White text on an orange fill fails AA, and orange everywhere turns into noise. |
| Toasts / headlines | Toasts are ink (transient). Headlines are paper cards with a double rule. | The newspaper is the one Transport Tycoon touch that interrupts, so it reads like paper. |

## 4. Tokens

### 4.1 Surfaces and ink

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--paper` | `#F7F6EF` | Rails, sheets, dialogs, nameplates | base |
| `--well` | `#EEEFE5` | Hover rows, linked references, fields, meter tracks, the selected or expanded row, segment troughs | — |
| `--rule` | `#DDE0D3` | Hairline dividers only (decorative) | 1.2:1 |
| `--edge` | `#7F8A80` | Control outlines (inputs, secondary buttons, steppers), hollow goal nodes, unused stops | 3.3:1 on paper, 3.1:1 on well |
| `--ink` | `#1E3228` | Text, primary buttons, ink surfaces | 12.6:1 on paper, 11.8:1 on well |
| `--ink-2` | `#56665B` | The only secondary text colour | 5.6:1 on paper, 5.3:1 on well |
| `--ink-3` | `#8B958B` | Disabled controls only; never text a player needs | 2.9:1 |
| `--on-ink` | `#F7F6EF` | Text on ink | 12.6:1 |
| `--on-ink-2` | `#B9C4B5` | Secondary text on ink | 7.5:1 |
| `--signal` | `#E17B4A` | Here / now / waiting on you; the t tile | Ink on signal 4.6:1 |
| `--signal-ink` | `#A94B1A` | Orange words on paper ("Paused") | 5.2:1 |
| `--focus` | `#B5501F` | Focus ring on paper and well | 4.7:1 / 4.4:1 |
| `--scrim` | `rgb(15 27 21 / .35)` | Behind dialogs | — |

These replace the 704 colour literals and the parallel `--ui-*` tokens. The UI uses no other greys or greens.

### 4.2 States

A state is always a glyph plus a word in the state colour, and the reason follows in ink. There are no tinted pills and no tinted cards.

| State | On paper | On ink | Glyph | Examples |
|---|---|---|---|---|
| ok | `--ok #2F7A4B` (4.8:1) | `--ok-on-ink #8FD1A6` (7.7:1) | `ok` (check in a ring) | Running, done, +money |
| warn | `--warn #8A5A00` (5.5:1) | `--warn-on-ink #F2C14E` (8.1:1) | `warn` (triangle) | Needs coal, piling up, nearly full |
| error | `--error #B03A2A` (5.6:1) | `--error-on-ink #F4A08C` (6.7:1) | `error` (octagon), or `broken` for connections | Can't, not connected, no buyer, −money |
| paused | `--ink-2` | `--on-ink-2` | `pause` | A route the player paused |
| info | `--ink` | `--on-ink` | `info` | Neutral facts |

Money:
- Positive: `--ok` with "+".
- Negative: `--error` with a true minus (U+2212, "−$154").
- Zero: `--ink-2`.

### 4.3 Line colours

| # | Name | Fill | Numerals and map edge | Numeral contrast |
|---|---|---|---|---|
| 1 | Cobalt | `#2D5DA8` | white | 6.5:1 |
| 2 | Marigold | `#EFC16F` | ink | 8.1:1 |
| 3 | Crimson | `#B8323F` | white | 5.9:1 |
| 4 | Cornflower | `#88AEE4` | ink | 6.0:1 |
| 5 | Plum | `#833D86` | white | 7.1:1 |
| 6 | Heather | `#D893B1` | ink | 5.7:1 |
| 7 | Umber | `#8A5A1C` | white | 5.9:1 |
| 8 | Iris | `#A99BE0` | ink | 5.5:1 |
| 9 | Graphite | `#4C5761` | white | 7.4:1 |

- Never use green (land and ok), teal or turquoise (water), or orange (signal).
- Deep and light colours alternate, so neighbouring routes differ in lightness as well as hue. The number always tells them apart.
- Assigning a colour to a new route:
  - leave out every index used by a route that shares one of its stops;
  - of the rest, take the index the fewest routes use across the company;
  - if every index is used at its stops, take the index least used there;
  - on a tie, take the lowest.

  Retiring a route never recolours the others. (Taking simply the lowest free index made nine of twenty lines Cobalt on the seed-1847 stress map, since most routes share no stop; counting the whole company spreads the nine colours, and lines that meet still differ.)
- Saves keep their stored hex, and the display maps legacy colours:
  - `#69c6bc` → Cobalt
  - `#efc16f` → Marigold
  - `#e5966d` → Crimson
  - `#88aee4` → Cornflower
  - `#b3cf83` → Plum
  - `#d893b1` → Heather
  - any other hex → the nearest fill by RGB distance

  Always read a route's colour through `route-lines.js lineFor(route)`.
- Tokens: `--line-1` … `--line-9` and `--line-1-on` … `--line-9-on`. In JS, `LINE_COLORS` in `design-tokens.js`.
- Line colour appears only on bullets, lines and the strip. It is never a row background or a card stripe.

### 4.4 Other colour sets

- **Cargo colours** (`data.js`) are content. They appear only inside cargo pictograms and cargo tiles, never for state or chrome.
- **Achievement tiers:**
  - `--tier-bronze #B7794A`
  - `--tier-silver #A3ACAF`
  - `--tier-gold #D6A93C`
  - `--tier-platinum #C9D3D6`

  They are filled roundels with an ink glyph (at least 3.8:1).
- **Charts:**
  - ink for money lines;
  - `--ok` / `--error` for profit bars;
  - `--rule` gridlines;
  - `--ink-2` labels;
  - categories (the cargo payment rates' four classes) in line colours chosen with the palette validator, light ones with the 1 px ink edge of 8.2, always with a legend and a table view.

  No gradients and no fills under lines.
- **Map UI** (`design-tokens.js MAP`):
  - Nameplate: paper at 94%, with an ink edge at 14%.
  - Roundel: paper disc with a 2.5 px ink ring.
  - Locator and selection: signal over a 5 px paper casing.
  - Hover outline: paper at 85%.
  - Reach ring: dashed paper with an ink casing at 35%.
  - Break cut: `--error`.
  - Property outline: `--ok` at 2 px over a 4 px paper casing at 75%; dashed 5/4 for plots, solid for buildings you own.

### 4.5 Type

One family: Space Grotesk, loaded locally from `/assets/fonts/space-grotesk-latin.woff2` (variable, 300–700). It is registered as `Space`, with the fallback `system-ui, sans-serif`. Canvas labels use it too.

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `--fs-caption` | 12 / 16 | 400–500 | 0 | Units, times, axis labels, key hints, population. This is the floor. |
| `--fs-small` | 13 / 18 | 400–500 | 0 | Sub-lines, fact labels, tags, dense buttons |
| `--fs-body` | 14 / 20 | 400 (names 600; buttons and references 500) | 0 | Body text, rows, buttons |
| `--fs-lead` | 16 / 22 | 600 | 0 | HUD balance, goal line title |
| `--fs-title` | 18 / 24 | 600 | −0.01em | Drawer titles, inspector names |
| `--fs-display` | 22 / 28 | 600 | −0.01em | Dialog titles, headline titles |
| `--fs-hero` | 32 / 36 | 600 | −0.02em | Start menu and loading screen only |

- Weights are 400, 500 and 600. 700 is used only for bullet numerals and the wordmark.
- `#app`, dialogs and the start menu set `font-variant-numeric: tabular-nums`. `.prose` (Guide text, headline detail) switches back to proportional figures. Every figure cell carries `data-num`.
- Sentence case everywhere. No `text-transform`, no positive letter-spacing, and no eyebrow labels above titles.
- Nothing is smaller than 12 px, on canvas either:
  - nameplates 13/600 (12/600 at Region zoom);
  - population 12/500;
  - bullet numerals 12/700.

### 4.6 Space and size

- 4-point steps:
  - `--s-1` 4
  - `--s-2` 8
  - `--s-3` 12
  - `--s-4` 16
  - `--s-5` 24
  - `--s-6` 32

  2 px is used only for hairline offsets.
- Control heights:
  - `--control` 32 px on desktop;
  - `--control-dense` 28 px, in desktop lists only;
  - `--control-touch` 44 px at 700 px or narrower, or with `pointer: coarse`.
- Fixed sizes:
  - `--rail-h` 48 px
  - `--goal-h` 40 px
  - `--tabbar-h` 56 px
  - `--drawer-w` 400 px
  - `--inspector-w` 368 px
  - `--toast-max` 480 px
- `--gutter` is 12 px on desktop, 8 px on phones and 6 px at 360 px or narrower.
- Panel padding is 16 px (14 on phones).
- Rows are at least 40 px tall on desktop and 48 px on touch.

### 4.7 Radii by hierarchy

| Token | Value | Use |
|---|---|---|
| `--r-1` | 4 | Tags, tooltips, nameplates, road bullets, cargo tiles |
| `--r-2` | 6 | Controls: buttons, fields, segments, steppers |
| `--r-3` | 8 | Tiles, toasts, placement tips, hover wells in rows |
| `--r-4` | 12 | Rails, sheets, dialogs, the tool bar, the headline card |
| `--r-5` | 14 | Top corners of phone sheets |
| `--r-round` | 999 | Dots, rail and water bullets, roundels, capsules |

### 4.8 Elevation and stacking

| Token | Value | Use |
|---|---|---|
| `--e1` | `0 1px 2px rgb(20 35 25 / .18), 0 0 0 1px rgb(20 35 25 / .08)` | Rails: nav, cluster, zoom, goal line, tool bar |
| `--e2` | `0 14px 34px -10px rgb(20 35 25 / .34), 0 0 0 1px rgb(20 35 25 / .08)` | Sheets, drawer, inspector, menus, popovers, headline |
| `--e3` | `0 14px 30px -10px rgb(6 16 10 / .55)` | Ink surfaces |
| `--e4` | `0 28px 70px -12px rgb(15 27 21 / .40)`, over `--scrim` | Dialogs |

Nothing inside a sheet has a shadow. Structure inside a sheet comes from hairline rules and wells, and there are no cards inside cards.

z-index tokens, from lowest to highest:

| Token | Value | Layer |
|---|---|---|
| `--z-map` | 0 | The map |
| `--z-map-overlay` | 10 | Edge pointers, map tags |
| `--z-rail` | 20 | Rails |
| `--z-goal` | 22 | Goal line |
| `--z-sheet` | 30 | Drawer, inspector, phone sheets |
| `--z-toolbar` | 34 | Active-tool bar, back chip |
| `--z-toast` | 40 | Toasts |
| `--z-headline` | 42 | Headline card |
| `--z-popover` | 50 | Menu, layers, zoom menu, ledger |
| `--z-tooltip` | 55 | Tooltips |
| `--z-dialog` | 60 | Dialogs |
| `--z-loading` | 70 | Loading screen |

Toasts sit below menus and dialogs. (Today `.toast-region` sits above the game menu, which is wrong.)

### 4.9 Focus

- `:focus-visible` gets `outline: 2px solid var(--focus); outline-offset: 2px` on paper and well.
- Inside `.on-ink` surfaces the outline colour is `--signal`.
- The canvas gets an inset ring.
- Focus is never removed, only restyled. Focus and selection share the orange ring language on purpose.

### 4.10 Motion tokens

- `--t-quick` 120 ms: hover, linked state, highlight fade.
- `--t-toast` 160 ms.
- `--t-panel` 180 ms.
- `--t-row` 160 ms.
- `--t-meter` 300 ms.
- `--t-tint` 600 ms.
- Camera moves: 280–480 ms.
- `--ease: cubic-bezier(.2,.7,.2,1)`.

### 4.11 Breakpoints

- **Wide**, 1200 px or more: the drawer (left) and the inspector (right) sit side by side.
- **Compact**, 701–1199 px: the inspector overlays the drawer, and closing it returns to the drawer.
- **Phone**: 700 px or narrower, or `pointer: coarse` with a height of 500 px or less (short landscape).
- **Narrow**: 360 px or narrower.
- `pointer: coarse` gives 44 px targets at any width.

## 5. Icons

### 5.1 Grammar

- **Module.** All icons come from one module, `ui-icons.js`. `icon(name, {size, label})` returns an inline `<svg class="i i20">`.
  - An unknown name throws in development and renders nothing in production.
  - A lint checks every name statically.
- **Grid.** 24 units with a 2-unit inset, giving a live area of 20. Caps and joins are round. Rectangles have a corner radius of 2 units.
- **Stroke.** 1.5 px at 16 and 20 px, and 1.75 px at 24 px. It is fixed in CSS pixels with `vector-effect: non-scaling-stroke` and drawn in `currentColor`.
- **Fills.** None, except 1-unit dots (class `dot`) and the media glyphs pause and play (class `solid`).
- **Geometry.** Two families, both taken from the subject:
  - **Network** glyphs (routes, stops, vehicles, UI) use 0°, 45° and 90° strokes, with circles for stops, like a route map.
  - **Land** glyphs (road, rail, layers, raise, lower, level, zones, build) use the map's 2:1 isometric diagonal.
- **Sizes.** 16 (inline, buttons, rows), 20 (nav, rails, tools) and 24 (phone tab bar).
- **Labels.** An icon sits next to a visible label. Rails and icon buttons are the exception: they have an `aria-label` and a tooltip instead.
- **One glyph, one meaning.** Never reuse a glyph for two ideas. Guide topics each get their own glyph, or none.

### 5.2 Vocabulary

| Group | Glyphs |
|---|---|
| Navigation | `build` (iso tile with a plus), `routes` (two roundels joined by a stepped line), `town` (two gables), `industry` (sawtooth roof), `news` (folded paper), `menu`, `guide` (open book), `chains` (two boxes feeding one), `overview` (folded map), `layers` (stacked iso tiles), `company` (ledger), `achievements` (medal roundel), `saved` (disk), `world` (globe, for New world), `sound`, `soundOff`, `search` |
| Actions | `close`, `plus`, `minus`, `locate` (roundel with four ticks, used by every Show on map), `chevronRight` (opens something deeper), `chevronLeft` (Back), `chevronDown`, `chevronUp`, `more`, `edit`, `retire`, `undo`, `swap`, `check`, `pause`, `play` |
| States | `ok`, `warn`, `error`, `broken` (a line cut by two slashes, identical to the strip cut), `info`, `lock`, `clock`, `trendUp`, `trendDown` |
| Modes and things | `bus`, `truck`, `train`, `ship`, `plane`, `stop` (roundel on a post), `flag` (goals), `stock` (crates), `coin` (income), `house`, `shop`, `workshop`, `tree`, `leaf`, `label` |
| Tools (land family) | `road`, `rail`, `bridge`, `tunnel`, `bulldoze`, `raise`, `lower`, `level`, `zones`, `pointer` |
| Weather | `sun`, `cloud`, `rain`, `snow`, `fog`, `moon` |
| Biomes | `taiga`, `tundra`, `desert` |

`modeGlyph(mode, cargo)` picks the vehicle glyph:

| Mode and cargo | Glyph |
|---|---|
| road with passengers or mail | `bus` |
| road with freight | `truck` |
| rail | `train` |
| water | `ship` |
| air | `plane` |

Stops always use `stop`. Bus no longer stands for every stop.

### 5.3 Three picture languages, one rule each

- **Line glyphs** are for controls and kinds of thing.
- **Cargo pictograms** (`cargo-icons.js`: 21 painterly, coloured pictograms) are content.
  - They always sit on a well tile (16, 20 or 32 px, `--r-1`), which matches the badges on the map.
  - An industry is shown by its output pictogram.
  - They are never used as action icons.
- **Painterly sprites** (`ui-art.js`) are portraits of things you place or inspect: Build "Place" cards, inspector headers and vehicle purchase.
  - Terrain actions (bulldoze, raise, lower, level) are never sprites.
  - Sprite cards and line-icon buttons never share a grid.

### 5.4 Text characters are not icons

Replace `×` (close), `↗`, `→`, `•••`, `⌃`, `✓` and text `+`/`−` buttons with glyphs.
- `×` stays only in speed labels (1×, 3×, 8×), in footprints (2 × 2) and in repeat counts on toasts (×3).
- `→` never appears. Use "to" or the strip instead.

## 6. Words

### 6.1 Rules

1. Sentence case. Headings, labels, buttons and tabs have no trailing full stop. Prose and messages are full sentences with full stops.
2. No eyebrows. The title says what the thing is: "First 100 deliveries", not "Next goal" above it.
3. No middle-dot glue. Use layout (label and value columns, or a second line), commas or words: "from $180 a tile", "Stone by road, 2 trucks".
4. One name per thing, as in the glossary below. This applies everywhere, including errors, notices and model messages.
5. An action keeps its name in its result:
   - "Add truck" → "Truck added to [2]".
   - "Launch route" → "Route launched: [3] Coal mine to Steel mill. $18,000 spent."
   - "Retire route" → "Route retired: [2] Stone quarry to Alderbrook. $12k refunded."
6. "Show on map" always moves the camera and highlights the target, and does nothing else. Anything that opens a panel says "Open …" or uses a chevron.
7. The price is on the button before money is spent: "Add truck $18k". The price follows the label, never in parentheses. Toast actions never spend money.
8. Errors say what happened, then how to fix it, then offer an action named after the fix.
9. Empty states invite action and offer the button that does it.
10. Figures come first, then plain units: "123 waiting", "14 tiles", "+$1,356 a month", "144 stone".
11. The UI shows no coordinates, internal ids, generation numbers or "activity" scores.

### 6.2 Glossary

| Use | Never |
|---|---|
| route | service, connection, line (as the thing) |
| stop. Use road stop, rail station, port or airport only when the kind matters. | station on its own, sign |
| town | city |
| industry. Its roles are verbs ("supplies stone", "buys stone"). Route statuses use "No supplier" and "No buyer". | site (except for a footprint), factory, producer |
| vehicle, or truck / bus / train / ship / plane | unit, generation |
| cargo; passengers; mail | goods (unless the cargo is Goods) |
| Production chains (menu, dialog); Production chain (one industry) | Chains as a label, Explore chains, Follow the chain |
| Guide | How to play, Field guide, How to connect, Help |
| Overview map (M) | Atlas, Mini map, World map, Region overview |
| Map layers (L) | Map options |
| Saved games | Save / load, Load / save, Your worlds |
| New world | Main menu, New game, Create world (as a menu item) |
| News | Notifications, log |
| Company | Finances, statistics |
| Goals. A goal has steps, and the ladder has parts ("Part 1 of 4"). | Next goal as an eyebrow, chapter |
| Achievements | Awards |
| Done (ends a tool; Esc does the same) | Explore, Done to explore |
| Retire route; Remove (buildings); Bulldoze (tool) | Delete route |
| Launch route; Add truck; Sell truck; Upgrade trucks | Buy vehicle, + Bus |
| Region, Town, Detail (zoom levels) | 50%, 100%, 200% |

### 6.3 Numbers, money, units, dates

- Money formats:
  - `$372,875` in the HUD, ledgers and confirmations;
  - `$18k` or `$1.2M` in buttons, tags and the phone HUD.

  `copy.js money()` is the only formatter.
- Money over time:
  - rates use "a month" ("+$1,356 a month");
  - the current period uses "this month" or "this year";
  - the previous period uses "last month".
- Use a true minus (−) and words instead of slashes: "from $180 a tile", not "$180 / tile".
- Quantities name the cargo: "144 stone", "48 passengers", "12 mail". Never "units", and never invented tonnes.
- Distance: "14 tiles". Time: "12 months left", "in 1951".
- Dates: "Jan 1950" in the HUD; "12 Jan 1950" in News and records.
- Vehicle models are named: "Garrow Mk 1 truck, carries 24"; a fleet reads "Garrow Mk 1–3" or "Dunmore Mk 2 and older", and the model year stays in the title ("1950 model"). Upcoming models: "Newer trucks arrive in 1951". (Named series from ttd-vehicle-models refine the earlier "1950 truck" wording; `vehicle-models.js` holds the names.)

### 6.4 Status vocabulary

Every status has one reason line. When there is a fix, the fix appears as an action on the same line.

**Routes** (from `routeHealth`):

| State | Words |
|---|---|
| ok | Running; Loading (vehicles waiting for a full load, the optional freight order) |
| warn | Needs coal (its supplier is short of an input, so more vehicles would not help) |
| error | Not connected (with the broken glyph); Stop missing; No supplier; No buyer; No passengers; No mail |
| paused | Paused |
| info | First trip (before the first delivery); Stores full (the buyer's store for this cargo is full, and deliveries still pay) |

Spare demand is not a state. This file first listed *Passengers waiting*, *Mail waiting* and *Cargo waiting* as warn states from two full fleet loads. But the starter bus has more passengers waiting than it can carry from its first day, and a town's pool keeps growing without service, so the first route card a player opens would ask for another bus forever (simplicity guardrail 0). A route with spare demand therefore reads *Running*. Once it has run a month with two full fleet loads of freight (at least 50) at its start, or four in its quieter town, one ink-2 line sits beside the stepper, "Room for more: 606 waiting", and its tooltip says about how many more another vehicle would carry a month. It has no glyph, no state colour and no action of its own, and it never counts toward Needs attention. For the same reason *Buyer full* became *Stores full* (info): a factory takes and pays for every delivery of a cargo it lists, even with a full store, and the reason only suggests its missing input.

**Industries:**
- Producing (ok).
- Needs coal (warn). The missing input is a cargo reference.
- Storage nearly full; Output piling up (warn).
- Idle (info).

**Towns:**
- Growing (ok).
- Steady (info).
- Needs food (warn). Shows a cargo reference and the nearest supplier as a reference.
- Out of room (warn).

### 6.5 Errors, empty states and confirmations

**Errors:**
- "Can't launch this route. [Quarry yard] and [Pinehaven Central] aren't joined by road. Build the missing road, or pick another stop." [Show the gap]
- "Route 2 uses this stop. Retire the route first, then remove the stop." [Open route]
- "There's already a stop here. Pick an empty road tile."
- "Town centres can't be removed."
- "Need $18k to add a truck." (tooltip on the disabled +)

**Empty states:**
- Routes: "No routes yet. Put a stop near an industry and another near a town that buys its cargo." [New route]
- News: "Nothing yet. Deliveries, growth and problems appear here."
- Saved games: "No saved games yet. Save this world to come back to it later." [Save now]
- Search: "No routes match 'coal'." [Clear search]

**Confirmations:**
- Destructive actions inside a panel confirm in place: "Retire route 2 for a $12k refund? [Retire route] [Keep]".
- Only world-level actions use a dialog: replacing the world, overwriting a save, deleting a save.

### 6.6 Before → after (real strings)

| Before | After |
|---|---|
| Balance / $372,823 | $372,875 (no label; the ledger opens on hover) |
| Profit · month +$982 | +$982 this month |
| Paused · Space to resume (chip over the map) | Lit pause segment, "Paused" under the date and an orange top line. Tooltip: "Paused. Press Space to resume". |
| 100% ⌃ | Town ⌄ |
| Next goal / First 100 cargo deliveries / View services → | First 100 deliveries, 24 of 100. Step: "[2] Stone quarry to Alderbrook has 38 stone waiting." [Add truck to route 2 $18k] |
| Find cargo | Show supplier |
| How to connect ↗ | Removed. Guide is in the menu. |
| Alderbrook · Pinehaven | Alderbrook – Pinehaven |
| Stone quarry Stop 3 → Alderbrook Central | Stone quarry to Alderbrook |
| Waiting 123 · About 5 loads. Add a bus. | Running, with "Room for more: 123 waiting" in ink-2 beside the stepper once the route has run a month (6.4) |
| + Bus · $18k | Add bus $18k |
| 1 bus · 24 / 24 loaded | Passengers by road, 1 bus (load shown as capsules) |
| Net earned −$154 | −$154 a month |
| 0 moved | This year: 312 stone delivered |
| Latest model (disabled) / Fleet up to date | Hidden. When relevant: "Newer trucks arrive in 1951. You choose when to replace yours." |
| Gen 1 · 24 units | Garrow Mk 1 truck, carries 24 |
| Network / Retire this connection? (modal) | Retire route 2 for a $12k refund? [Retire route] [Keep] (inline) |
| Service retired. | Route retired: [2] Stone quarry to Alderbrook. $12k refunded. |
| X launched · $18k | Route launched: [3] Coal mine to Steel mill. $18,000 spent. |
| Launch separate service | Launch as a new route |
| Industry · 2 × 2 site | Industry near [Alderbrook] |
| Producing / Output depends on nearby nature, roads, workers and weather. (green box) | Producing, with its reason as one line. The explanation moves to the Guide. |
| Nearest targets 5 / Direct distance · transport required / 14 tiles · 220, 241 | Buyers of stone nearby: [Alderbrook], Served, 14 tiles |
| Activity 20; Potential / day | Removed, or said in words: "Growing slowly", "Could supply 40 a month" |
| Coverage 5 tiles | A reach ring on the map. Tool bar: "Place within 5 tiles of what it should serve." |
| Retire routes using this station before removing it. | Route 2 uses this stop. Retire the route first, then remove the stop. |
| There is already a station here | There's already a stop here. Pick an empty road tile. |
| A city center cannot be demolished | Town centres can't be removed. |
| …two different cities | …two different towns |
| Save / load, Load / save, Your worlds | Saved games |
| How to play, Field guide | Guide |
| Atlas ↗, Mini map, World map | Overview map |
| Main menu + New world (both open the start menu) | New world |
| Explore / Done to explore / Drag to build · Done to explore | Done. Tool bar: "Drag along the ground. The price shows before you let go." |
| Road · bus / truck | Road; "Buses and trucks" |
| from $180 / tile | from $180 a tile |
| Management (drawer eyebrow) | Removed |
| Follow the chain. / Production chains | Production chains |
| Small beginnings. Endless possibilities. | Small beginnings, endless possibilities |
| Show (toast; it opened Routes) | Show on map (moves the map). Opening the row is a separate "Open route". |

The brand tagline "Build connections. Grow a world." stays as written.

## 7. References

### 7.1 Kinds

| Kind | Mark | Label | Click opens |
|---|---|---|---|
| route | bullet (number, line colour, shape by mode) | route name; the bullet alone where space is tight | its expanded row in Routes (a route's inspector) |
| stop | roundel | stop name | stop inspector |
| town | `town` glyph | town name | town inspector |
| industry | output cargo tile | industry name | industry inspector |
| vehicle | mode glyph | "Truck 2", plus a small route bullet | vehicle card |
| cargo | cargo tile | cargo name | cargo lens (map highlight of suppliers and buyers). No camera move. |

A contract is shown as its two place references plus a dashed proposed strip.

### 7.2 Markup contract

```html
<button type="button" class="ref ref--prose" data-ref="industry:industry-12" aria-label="Stone quarry, industry">
  <span class="ref-mark">(cargo tile)</span><span class="ref-label">Stone quarry</span>
</button>
```

- References are built only by `ui-refs.js ref(kind, id, label, options)`.
- Variants:
  - `.ref--prose`: inline in sentences. The underline is always visible (1 px, ink at 28%, solid on hover or focus). Baseline-aligned and never wraps inside.
  - `.ref--row`: the whole list row is the reference. The underline appears on hover.
  - `.ref--compact`: the mark only (a route bullet).
  - `.ref--on-ink`: underline in paper at 40%.
- A reference is never nested inside another button. Secondary actions sit beside it.
- A reference to something that no longer exists renders as plain text (`.ref--gone`).
- An entity's own inspector title is not a reference to itself.
- `data-ref-action="show"` marks a "Show on map" button that uses the same machinery.

### 7.3 Behaviour

**Hover or keyboard focus.** Pointer hover waits for 150 ms of intent; keyboard focus acts at once. Only one reference is active at a time. It does three things:
- Every element with the same `data-ref` gets `.is-linked` (well background, solid underline): drawer rows, inspector facts, toast leads, bullets.
- The map highlights the target without moving the camera:
  - a route thickens, other routes dim to 35%, and bullets appear at both termini;
  - a town, industry, stop or vehicle gets the orange locator ring.
- If the target is outside the visible map band, an ink edge pointer appears at the band edge. It shows the kind mark, the name and the distance in tiles, with an orange chevron pointing at the target.

**Click or Enter:**
- The camera glides to frame the target: a whole route, or an industry's footprint.
- The target becomes the selection, and its inspector opens (see the table in 7.1).
- The panel the reference came from keeps its scroll, filter and expanded row.
- An inspector opened from another inspector shows "‹ Back to <previous entity>".
- Esc or close returns focus to the reference that opened it.

**`data-ref-action="show"`** glides and highlights for 4 s. It never opens a panel.

**Touch.** A tap is a click. Press and hold (450 ms) previews the target with the locator ring or an edge pointer, without moving the camera.

### 7.4 Map → panels

- Hovering an entity on the map outlines it and gives `.is-linked` to its rows and references in open panels. Nothing scrolls.
- Selecting an entity on the map opens its inspector.
  - If the entity's list is open and its row is off screen, the list scrolls it into view (instantly under reduced motion).
  - The drawer never opens by itself.
- Selecting an industry or stop emphasises the routes that serve it, both on the map and in "Served by".

### 7.5 Where references appear

References appear on every surface:
- drawer rows (routes, towns, industries);
- inspector facts and sub-lines ("Industry near [Alderbrook]");
- the stop names under a strip;
- the lead of every toast and every News row;
- goal steps;
- error messages;
- headlines;
- the Company leaderboard;
- contract offers;
- Production chains nodes and site lists;
- the cargo lens chip;
- placement tips ("Serves [Stone quarry]");
- Guide text where it names a cargo.

### 7.6 Message templates

Model and insight code is DOM-free. A message that names things carries two versions:
- a plain `message`;
- a `template` with tokens, for example: `"{route:route-104} lost its connection near {town:city-3}. Rebuild the road or retire the route."`

`ui-refs.js renderTemplate(template, game, {onInk})` turns the tokens into references. `copy.js plain(template, resolveName)` produces the plain text for live regions and `#status-message`.

The tokens are:
- `{route:id}`
- `{stop:id}`
- `{town:id}`
- `{industry:id}`
- `{vehicle:id}`
- `{cargo:id}`
- `{money:n}`
- `{date:day}`

## 8. The line language (the memorable element)

### 8.1 Bullet

- **Sizes.** 20 px (rows, inspector, map at Town and Detail zoom) and 16 px (prose, toasts, map at Region zoom).
- **Numeral.** 12/700, tabular, in the line's on-colour. The number is `route.number`, a stable identity: numbering here means something.
- **Shape by mode:**
  - road: rounded square (radius 4);
  - rail: circle;
  - water: pill, 1.6× wide;
  - air: diamond, with the numeral upright.

  With two or more digits, each shape stretches horizontally: road becomes a rounded rectangle, rail a stadium, water a longer pill and air a pointed hexagon.
- **Edges.** Light fills get a 1 px ink edge at 35% on paper. Deep fills need no edge.
- **Paused route.** The bullet is drawn at 50%, next to a pause mark.

### 8.2 Strip diagram

The strip shows a route's state at a glance, left to right from the first stop to the last.

```
  [stone] 48
 ◯━━━━▆━━━━━━━›━━━━━━━▭━━━━━━◯
 Stone quarry          Alderbrook Central
```

- **Line:** 4 px in the line colour. Light lines get a 1 px ink edge at 35%.
- **Stops:** roundels (a 12 px paper disc with a 2.5 px ink ring) at both ends, plus any intermediate stops spaced by path distance. The end names sit underneath as stop references, in two equal columns that wrap and are never truncated.
- **Vehicles:** capsules, 14 × 8 px:
  - ink-filled when loaded;
  - paper with a 1.5 px ink edge when empty;
  - placed by progress along the path;
  - at most 8, followed by a "+N" tag.
- **Waiting cargo:** above each stop, a 14 px cargo tile and the count (12/600, tabular). The status line says whether the number is a problem.
- **Direction (freight only):** up to three chevrons in the on-colour along the line. Two-way passenger routes have none.
- **Broken:** the line stops at the break. The gap is dashed in `--error`, with the `broken` glyph (16 px) at the cut. The fix goes in the status line ("Show the gap", "Rebuild road").
- **Size:** 56 px tall including labels. The width fills the row.

### 8.3 Variants

- **Proposed** (the New route form, contract offers): a dashed `--ink-2` line between two roundels, with no bullet yet. A forecast line sits below it: "About +$3.0k a month, pays back in about 6 months".
- **Contract:** a proposed strip, plus the bonus as a tag ("×1.5 bonus") and "12 months left".
- **Ladder** (goals, first-route checklist, Company goals): the strip turned vertical.
  - Done step: an ink roundel with a paper check.
  - Current step: a signal ring.
  - Future step: a hollow `--edge` ring.
  - The connector is solid within a part and dashed into the next part.
- **Launch:** a new route's strip line draws once from A to B in 400 ms (not under reduced motion). This replaces the 1.2 s route-flash wash.

### 8.4 Lines on the map

- **Edge.** Each line is edged in its on-colour:
  - deep lines get a paper halo (core + 3 px, paper at 90%) under the core;
  - light lines get an ink casing (core + 2.5 px, ink at 55%) under the core.
- **Core width** in screen px: 3 at Region, 3.5 at Town, 4.5 at Detail.
- **Emphasis** (hovered, selected or shown): the core grows by 1.5 px and the other lines dim to 35%.
- **Freight flow:** small chevrons in the on-colour every 44 px, offset by simulation time so that a paused frame stays still.
- **Broken segment:** dashed `--error`, with a cut mark at the break.
- **Paused or offline route:** the line at 45% alpha, with no flow.
- **Bullets:**
  - at Town and Detail zoom, every stop roundel carries the bullets of the routes that serve it (at most 3, then "+N");
  - at Region zoom, only terminus bullets are drawn, and any that collide with a nameplate are dropped.

## 9. Map vocabulary (UI drawn on the map)

| Mark | Look | Meaning |
|---|---|---|
| Town nameplate | Paper plate at 94%, radius 4, ink edge at 14%. Name 13/600; population 12/500 in ink-2 after a 1 px rule. | A town (world label) |
| Stop roundel | Paper disc with a 2.5 px ink ring, 10 px at Town zoom | A stop. Replaces the lettered B/T sign. |
| Unused stop | Roundel with an `--edge` ring | A stop no route uses |
| Industry badge | Paper tile with the output pictogram. Ring in the serving line colour, 3 px storage meter (ink; warn at 90% or more), missing-input chips. | An industry and its service |
| Selection | Orange footprint outline (2.5 px) over a 5 px paper casing, plus an ink name tag above | The selected thing |
| Locator ring | Orange ring (2.5 px) over a 5 px paper casing, fading in over 120 ms | "This one": a hovered reference, or a toast's Show on map |
| Keyboard cursor | Dashed orange footprint outline over paper | The keyboard map cursor |
| Hover | Paper outline, 1.5 px at 85% | The pointer is over something clickable |
| Reach ring | Dashed paper ring with an ink casing at 35% | A stop's catchment (stop tool, selected stop) |
| Property outline | `--ok` footprint outline (2 px) over a 4 px paper casing at 75%: solid for a building you own, dashed for a plot developers built on your zone. Town and Detail views only, while building in towns or inspecting a town or property. The casing keeps it legible on grass and at night. | Your property |
| Context lines | Thin dashed paper lines with an ink casing at 35% | Nearest targets of a selected industry |
| Edge pointer | Ink tag at the band edge: mark, name, "177 tiles", orange chevron | A hovered target that is off screen |
| Floaters | Paper pill: cargo tile and "+$1,356" in ok | Income from a delivery (world label) |
| Break | Dashed error segment with the cut glyph | A route's missing link |

Map ink tags and pointers are DOM overlays in `#map-overlays`, positioned with `renderer.worldToScreen`. They are recomputed only when the camera or the target changes.

## 10. Fluency

### 10.1 Motion only answers

| Event | Motion | Duration | Reduced motion |
|---|---|---|---|
| Hover, linked state | Colour | 120 ms | Instant |
| Map highlight or locator | Fade in | 120 ms | Instant |
| Drawer open / close | 8 px slide + fade from the nav rail | 180 ms | Instant |
| Inspector open | 8 px slide from the right + fade | 180 ms | Instant |
| Inspector changes entity | Content crossfade; old height held as `min-height` | 120 ms | Instant |
| Phone sheet detent | Translate | 180 ms | Instant |
| Row expand / collapse | `grid-template-rows` 0fr → 1fr | 160 ms | Instant |
| Toast in / out | Rise 8 px + fade / fade | 160 / 120 ms | Instant |
| Camera | Glide (10.2) | 280–480 ms | Cut, then a static ring for 1.2 s |
| Money the player spent or received | "−$18,000" beside the balance, opacity only | 1.2 s | Shown without fade |
| A value the player changed | Well tint behind the figure | 600 ms | None |
| Meter value change | Width | 300 ms | Instant |
| New route | Strip line draws from A to B | 400 ms | None |
| Loading train | Loop (the only loop) | — | Paused |

Ambient income never animates in the DOM; the canvas floaters show it. The `.income-pulse` on profit is removed. Weather and floaters keep their existing reduced-motion behaviour.

### 10.2 Camera

- **When it glides.** On reference clicks, Show on map, goal steps, toast and News actions, and edge pointer clicks.
- **How long.** `280 + 60 × screens` ms, clamped to 280–480 ms, with `--ease`.
- **Long jumps.** Beyond 3 screens the camera cuts instead of gliding, then shows the locator ring. A "Back to where you were" ink chip appears at the bottom left of the band for 8 s.
- **Cancelling.** Any drag, wheel, pinch or key pan cancels a glide at once.
- **The camera never moves unless the player asked:**
  - Opening a panel never moves it.
  - If a panel would cover the selection (phone sheets, compact widths), the selection pans into the visible band. This only happens when it would otherwise be hidden.
- **Framing** always uses the visible band: the canvas minus open panels. The band is kept in `--band-l`, `--band-r`, `--band-t` and `--band-b` on `.map-section` and passed to `renderer.setBand`.

### 10.3 Reduced motion

- Keep the global rule that sets `animation: none; transition: none` under `prefers-reduced-motion: reduce`, and add `scroll-behavior: auto`.
- `ui-motion.js scrollIntoViewSafe()` replaces every `scrollIntoView({behavior: 'smooth'})`.
- Glides become cuts followed by a static locator ring for 1.2 s.
- Floaters, weather and strip capsules stay still, and the loading train stops.

### 10.4 No layout jumps

- **Figures.** Tabular figures everywhere. The HUD balance reserves 9.5ch and the date 5.2em.
- **Fixed widths:**
  - drawer 400;
  - inspector 368;
  - goal line = inspector width;
  - toasts at most 480 and at most two lines.
- **Date cell.** It always has two lines: a weather word or "Paused". Pausing moves nothing.
- **Rows.** Rows expand in place, and the rows above never move. Buttons keep their width when their label changes to a pending state.
- **Inspector.** It refreshes in place, keyed by entity (inspector-stable-refresh). When it switches entity it crossfades and holds the old height until the new content has been measured.
- **Overlays.** Toasts, headlines and the tool bar sit in reserved overlay slots, so nothing pushes the layout.
- **Narrow screens.** At 360 px or narrower, a row's status moves to its own line instead of being truncated.
- **Goal.** Collapsing the goal changes nothing around it.

### 10.5 Context is kept

- Each drawer tab remembers its scroll, search, filter and expanded row for the session.
- Esc steps back one level at a time. Esc never leaves the game.
  1. Tool (or route picking).
  2. Popover or menu.
  3. Inspector (to its Back target, if there is one).
  4. Drawer.
- Closing any panel returns focus to where it was opened from, or to the canvas if that is gone.
- Opening a reference from a toast doesn't dismiss the other toasts.
- On phones, the inspector sheet replaces the routes sheet, and Back returns to it at the same scroll.
- Only changes the player caused are marked: a well tint behind the changed figure, and the money delta beside the balance.

## 11. Minimalism

### 11.1 Default screen (desktop)

```
┌[t] Build  Routes ▲2  Towns  Industries┐                ┌ $372,875            Jan 1950 │ ❚❚ 1× 3× 8× │ news• ≡ ┐
└────────────────────────────────────────┘                │ +$1,034 this month  Rain     │             │         │
                                                           └─────────────────────────────────────────────────────┘
                                                                         ┌ ⚑ First 100 deliveries   24 of 100 ⌄ ┐
                                                                         └▔▔▔▔▔▔▔▔▔▔░░░░░░░░░░░░░░░░░░░░░░░░░░┘ (orange progress edge)
                                (map, full bleed, to the top edge)

                  ┌ ✓ Route launched: [2] Stone quarry to Alderbrook   ⌖ Show on map ┐       ┌ layers overview │ − Town ⌄ + ┐
                  └───────────────────────────────────────────────────────────────────┘       └────────────────────────────┘
```

While the game is paused, a 2 px orange line runs along the top edge of the map.

Working state (wide):

```
┌[t] Build  Routes ▲2  Towns  Industries┐     ┌ cluster ─────────────────────────┐
├ Routes 3          [+ New route]      ×┤     ┌ ⚑ First 100 deliveries 24 of 100 ⌄┐
│ [All 3] [Needs attention 2]            │     ┌ [art] Stone quarry         ⌖  ×  ┐
├────────────────────────────────────────┤     │       Industry near [Alderbrook] │
│ [2] Stone quarry to Alderbrook +$1,356 │     ├──────────────────────────────────┤
│     Stone by road, 2 trucks  ✓ Running │     │ Status   ✓ Producing             │
│   (strip, fleet, figures, actions)     │     │ Makes    [stone] 48 a month      │
├────────────────────────────────────────┤     │ Stored   ▬▬▬░░░ 13 of 60         │
│ [1] Alderbrook – Pinehaven      −$154  │     │ Served by [2] …to Alderbrook     │
│     Passengers by road, 1 bus ✓ Running│     ├──────────────────────────────────┤
└────────────────────────────────────────┘     │ Buyers of stone nearby           │
                                               │ [Alderbrook]  Served   14 tiles  │
                                               ├──────────────────────────────────┤
                                               │ [New route from here] Chain ›    │
                                               └──────────────────────────────────┘
```

### 11.2 Removed from the screen

- The full-width top bar band. A transparent `.topbar` container holds the rails.
- The Balance and "Profit · month" labels.
- The Paused chip.
- The weather chip (`.map-topline`). Weather moves into the date line and the menu header.
- The Map options popover. Grid and Route lines are map layers, and "Back to home town" moves into the zoom menu.
- The "Drag to explore" hint.
- The status bar footer. `#status-message` stays as an sr-only live region.
- The sidebar footer. Save status moves into the menu header.
- The Manage toggle and the mobile management nav.
- The "Management", "Next goal" and "Network" eyebrows.
- The duplicate "+ New route".
- The Fleet upgrades box. It becomes a line in the route row, and a News entry.
- Three filter selects, "Clear filters" and "n of n routes".
- The Explore / Done box in Build.
- Keyboard letters on cards. They move into tooltips.
- The terrain tip paragraph.
- Coordinates, "Activity", "Coverage 5 tiles", the numbered target list and the minimap by default.
- About 196 dead selectors.

### 11.3 Where things live now

| Thing | Place |
|---|---|
| Finance detail | Ledger tooltip on the balance; click opens Company |
| Production chains, Guide, Achievements, Saved games, Sound, New world | Menu |
| Map layers | Zoom rail (desktop); menu (phones) |
| Overview map | Zoom rail button and M (desktop); menu (phones) |
| Home town | Zoom menu: "Back to home town (H)" |
| News | Cluster button with an unread dot (desktop); menu with the dot on the menu button (phones) |
| Route rename, upgrade, retire | The route row's More menu |
| Tool rules | Active-tool bar, only while a tool is active |
| Explanations | Guide, or one reason line |
| Search and filters | Shown only above 6 items. Routes also shows "Needs attention" when something needs it. |

### 11.4 Budgets

- One orange-filled button on screen.
- At most 2 toasts, plus one "+N more in News" summary.
- One headline.
- One edge pointer.
- One expanded route row.
- No permanent hints.
- The goal ladder is expanded only during onboarding, until the first route is launched. After that the goal is one line, and a new goal tints the line once. The ladder never expands by itself.
- Numbering only for identity (route numbers) and rank (leaderboard).

## 12. Components

The class names in 16.3 are a contract. Parallel implementers rely on them.

### 12.1 Rails

- **Shared:** paper, `--e1`, `--r-4`, height `--rail-h`, 4 px padding. Items inside are 40 px tall (44 on touch). A 1 px `--rule` separator between groups marks a group boundary.
- **Nav rail** (top left). Its minimum width is `--drawer-w` at wide and compact widths, so the drawer can grow out of it. Contents:
  - The t tile: 32 px, `--signal` fill, paper "t" italic 700. It links to `/fun/` with the label "All games".
  - The tabs Build, Routes, Towns, Industries: icon 20 and label 14/500 in ink-2. Hover shows the well.
  - The active tab has an ink label and a 2 px ink bar inside the rail's bottom edge.
  - Routes shows the attention count ("▲2" in warn, aria "Routes, 2 need attention") only when it is above zero.
  - Tabs are buttons with `aria-expanded` and `aria-controls` pointing at the drawer.
- **Instrument cluster** (top right). Its cells:
  - **Balance.** The figure in `--fs-lead` 600 `data-num`, and under it the profit in 12/500 (ok or error colour) followed by " this month" in ink-2. Hover or focus opens the ledger; click opens Company.
  - **Date.** 14/600, and under it the weather word (ink-2) or "Paused" (signal-ink).
  - **Speed.** A segmented control: pause, 1×, 3×, 8×. The selected segment is an ink fill; the paused segment is a signal fill with an ink glyph.
  - **News** icon button with the unread dot.
  - **Menu** icon button.
- **Zoom rail** (bottom right): layers, overview, a divider, then −, the zoom level name with a chevron ("Region", "Town" or "Detail"), and +. The zoom menu lists Region, Town, Detail and "Back to home town (H)".

### 12.2 Goal line and ladder

- **Line.** A paper rail, `--e1`, height `--goal-h`, width `--inspector-w`, right-aligned under the cluster. It contains:
  - the flag glyph in signal;
  - the title in `--fs-lead` (ellipsis if long);
  - the figure "24 of 100" in 13 `data-num`;
  - a chevron.

  A 2 px `--signal` progress line runs along its bottom edge. The progress line is the only place orange marks progress.
- **Expanded.** A paper sheet (`--e2`) opens under the line at the same width and shows the ladder (8.3):
  - done steps with their dates;
  - the current step with its template detail and one signal-filled action that performs the step and shows its price ("Add truck to route 2 $18k"), plus "Show on map";
  - future steps, hollow.

  The footer shows "Part 1 of 4" and "All goals".
- **Onboarding.** The first-route checklist uses the same ladder.
- **With the inspector.** When the inspector opens at wide widths, the inspector starts under the goal line. The line stays one line.

### 12.3 Drawer

- It grows from the nav rail: same left edge, width `--drawer-w`, attached under the rail. The rail's bottom corners are square while the drawer is open.
- Its height fits the content, up to the viewport minus the rail and two gutters. It uses `--e2` and scrolls inside.
- **Header** (`.drawer-head`): the title in `--fs-title`, the count in 14 ink-2 `data-num`, `.drawer-actions` (at most one primary button), and a close icon button (`#close-management`).
- **Optional filter row:** a segmented control ("All n | Needs attention n") and a search field when there are more than 6 items.
- **Body:** rows with hairline dividers and no cards. A footer note appears only when it carries information, for example "Newer trucks arrive in 1951."

### 12.4 List rows

- A row is at least 40 px tall (48 on touch), with 12 px of vertical and 16 px of horizontal padding and `--rule` dividers. Hover shows `--well`.
- **Routes row:**
  - Line 1: bullet 20, name 14/600, and money on the right (with "a month" in caption under it).
  - Line 2: cargo tile 16, "Stone by road, 2 trucks" in 13 ink-2, and the status mark on the right.
- **Towns row:** town glyph, name, population `data-num`, growth word and served bullets.
- **Industries row:** output cargo tile, name, "near Alderbrook", status word and served bullets.
- The whole row is a `.ref--row`, so hovering it lights the map.
- **Expanded row** (`.row--expanded`, one at a time, `--well` background, no stripe). It contains:
  - the strip;
  - the status line (state glyph, word, reason, fix action);
  - the fleet stepper row;
  - figures in the facts layout;
  - options (switches);
  - an action row: Show on map, Edit, and More (Rename, Upgrade trucks, Retire route).

### 12.5 Inspector

- **Placement:**
  - wide: right column, `--inspector-w`, under the goal line;
  - compact: overlays the drawer;
  - phone: inside a sheet.

  It uses `--e2` and scrolls inside.
- **Back line** (when the inspector was reached through a reference): "‹ Back to Stone quarry", a quiet button.
- **Header:**
  - a 40 px portrait tile: a painterly sprite, or a kind glyph on a well tile for terrain and roads;
  - the name in `--fs-title`;
  - a sub-line in 13 ink-2 with references ("Industry near [Alderbrook]");
  - a locate icon button (`data-ref-action="show"`);
  - a close button.
- **Body:** a facts grid (12.7), then sections divided by hairlines, each with a 13/600 heading. No boxed callouts and no numbered lists.
- **Footer:** one primary action ("New route from here") and one chevron link ("Production chain ›").

### 12.6 Buttons

| Variant | Look | Use |
|---|---|---|
| `.button--primary` | Ink fill, on-ink text | The main action of a surface |
| `.button--secondary` | Paper, 1 px `--edge`, ink text | Second actions |
| `.button--quiet` | Icon + text, well on hover | Show on map, Edit, Back |
| `.button--signal` | Signal fill, ink text | Only the current goal step's action |
| `.button--danger` | Quiet style in `--error` | Retire, Remove; always confirmed in place |

- **Sizes:** 32 by default, 28 with `.button--dense` (desktop lists), 44 on touch.
- **Text:** 14/500 label, with a 16 px icon on the left.
- **Price:** `.price` follows the label, tabular.
- **Disabled:** well fill and ink-3 text, with the reason in a tooltip.
- **Pending:** keeps its width.
- **Icon buttons:** 32 (44 on touch), glyph 20, `--r-2`, always with an `aria-label` and a tooltip.

### 12.7 Facts, sections, disclosure

- **`.facts`:** a two-column grid.
  - Label column: 112 px, 13 ink-2.
  - Value column: 14 ink, `data-num`.
  - 8 px row gap.
- **`.section`:** a top `--rule` hairline, 16 px padding and a 13/600 heading.
- **`.disclosure`:** a row button with a chevron that rotates 180°. Nothing auto-expands.

### 12.8 Controls

- **`.segmented`:** a well trough with 2 px padding and segments 28 px tall (44 on touch). The selected segment is an ink fill with on-ink text. A segment may hold a count.
- **`.stepper`:** "[− 2 trucks +]", with a `--edge` border and a 14 `data-num` value. The + button is disabled when unaffordable, with the tooltip "Need $18k". The tooltip on − shows the refund.
- **`.field`:** 32 px tall (44 on touch), paper, `--edge` border, `--r-2`, 14 px text, ink-2 placeholder. A leading icon is used for search, and selects get a chevron.
- **`.switch`:** a native checkbox styled as a 32 × 18 track. On is ink, with a paper knob.

### 12.9 Toasts

- **Surface:** ink, `--e3`, `--r-3`.
- **Width:** `min(--toast-max, band width − 2 gutters)`.
- **Position:** bottom centre of the visible band, 16 px from the bottom and above the tool bar. On phones they move to the top of the band while a sheet is open.
- **Anatomy:**
  1. Lead: the subject's reference (compact bullet, cargo tile or town glyph) or a state glyph.
  2. Message from `renderTemplate`, 14/20, at most two lines.
  3. Optional figure ("+$1,356" in ok-on-ink).
  4. One action: "Show on map" (icon-only on phones) or a named fix. A fix opens the place where the fix happens with the button focused; it never spends money.
  5. Repeat count "×3".
- **Timing:** 5 s for ok, 8 s for warn and error. The timer pauses on hover or focus. There is no close button, and pointer events stay on.
- **Grouping:** notices that share a topic become one toast, for example "3 routes lost their connection: [1] [3] [4]". Its Show on map frames all the breaks.

### 12.10 Tooltips, ledger, menus, popovers

- **Tooltip:** ink, `--r-1`, 12/16, maximum 240 px, after a 500 ms delay. Keyboard letters appear here: "Road (R)".
- **Ledger** (balance tooltip):
  - Fares this month
  - Running costs this month
  - Investment this month
  - Profit last month
  - Prices this year
  - Delivered this year
  - Routes
  - Towns served
- **Menu:** paper, `--e2`, `--r-4`, 280 px wide.
  - Header line: weather and "Saved 2 min ago" in 13 ink-2.
  - Rows: icon 20, label 14/500, and a shortcut hint in 12 ink-2 on the right (`.kbd`). Rows are 40 px tall, 44 on touch.
  - Order: Company, Production chains (C), Guide (?), Achievements, Saved games (Ctrl+S), Sound, a rule, New world.
- **Popover** (layers, zoom menu, overview): paper, `--e2`, anchored to its button, closed by Esc and by clicking outside.

### 12.11 Dialogs

- **Surface:** native `<dialog>`, paper, `--r-4`, `--e4` over `--scrim`.
- **Size:** maximum width 720 (Production chains and Company 960), padding 24.
- **Header:** the title in `--fs-display`, an optional sub-line in 14 ink-2, and a close button.
- **Body:** sections divided by `--rule`, with 14/600 headings.
- **Footer:** actions on the right.
- **Phones:** a full-screen sheet with a sticky header.
- **Focus:** moves to the title on open and back to the opener on close.

### 12.12 Tags, meters, states, cargo tiles

- **`.tag`:** well background, `--r-1`, 13/600, tabular, with an optional cargo tile. Tags hold quantities, never states.
- **`.meter`:** a 4 px well track (`--r-round`) with an ink fill.
  - `.meter--warn` applies only when the value itself is a problem (storage at 90% or more).
  - `.meter--signal` is used only for goal progress.
- **`.state`:** a 16 px glyph and a 13/500 word in the state colour, followed by `.reason` in 13 ink.
- **`.cargo-tile`:** a well tile (16, 20 or 32 px) holding a cargo pictogram.

### 12.13 Headlines

- A paper card at the top centre of the band: maximum width 440, `--e2`, `--r-4`.
- **Kicker line:** the kicker in 12/500 ink-2 on the left and the date on the right, above a double hairline. This is the one newspaper touch, and it uses no middle dot.
- **Content:** the title in `--fs-display`; the detail in 14 `.prose`; one action; a close button.
- One headline at a time. It is hidden while a menu, dialog, the tool bar or a phone sheet (beyond half height) is open.
- On phones the title steps down to `--fs-title`. While a sheet sends toasts to the top of the band, the card steps aside until they go. The title, like the detail, uses proportional figures.

### 12.14 Active-tool bar, placement tip, picking

- **`.tool-bar`:** a paper rail, `--e1`, `--r-4`, at the bottom centre of the band, above toasts in z-order.
  - `__glyph`: a 20 px icon on a well tile.
  - `__name`: 14/600.
  - `__rule`: one line of 13 ink-2 that teaches the tool.
  - Optional mode segment (Road | Rail for bridges and tunnels).
  - Optional secondary **Turn** before Done for the Airport tool (44 px); on phones it takes the recent-tools dock's place.
  - `__actions` with the primary "Done" (Esc).
  - On phones, a recent-tools dock of up to 3 icon buttons sits left of Done.
- **Route picking** uses the same bar: "Picking stops. Click a stop on the map, or press Esc."
- **`.tip`** (placement tip): an ink tag, `--e3`, `--r-3`. It follows the pointer, and sits above the finger on touch.
  - Line 1: the tool and quantity ("Road, 7 tiles") and the price `data-num`.
  - Optional lines: coverage ("Serves [Stone quarry]") and forecasts.
  - Invalid: an error-on-ink glyph and what happened plus how to fix it ("Can't build on water. Use a bridge.").
  - Partial: warn-on-ink.

### 12.15 Build drawer

- **Header:** "Build", with a segmented control "Network | Town | Industry".
- **Network** has two groups:
  - **Place:** sprite cards in 2 columns (Road, Rail, Stop, Port, Bridge, Tunnel, Airport). Each card has a 48 px sprite, the name in 14/600 and a price line in 13 ink-2 ("from $180 a tile"). The selected card has a 2 px ink outline.
  - **Shape the land:** a row of line-icon buttons (Bulldoze, Raise, Lower, Level).
- **Town:** zones, buildings (sprite cards with price and tier word), Found town and Workshop.
- **Industry:** industry cards with output cargo tiles and prices.

### 12.16 Demand rows (towns, the second pillar)

- `.demand-row`: label (Homes, Shops, Workshops), a meter, a word ("Strong", "Some", "Low") and an optional action ("Invest $12k").
- Town inspector sections, in order:
  1. Needs
  2. Outlook
  3. Town economy
  4. Your property
  5. Town hall

  Sections are collapsed by default.

### 12.17 Charts and tables

- **Charts:** 1.5 px ink money line; `--ok`/`--error` profit bars; `--rule` gridlines; 12 px ink-2 tabular axis labels. Hover values appear in an ink tooltip. No gradients, no area fills and no legends when a direct label fits.
- **Tables** (leaderboard, annual table): rank numbers in 13 ink-2 `data-num`, route references, and right-aligned figures. Hairline rows, no zebra stripes.

### 12.18 Empty states

`.empty`: one sentence in 14 ink that says what will appear here and how to get it, followed by one button. No illustrations.

### 12.19 Start menu and loading

- Both use the same tokens. Hero type (`--fs-hero`) appears only here.
- Start tabs are a segmented control, and world options are fields.
- Buttons: New world, Continue, Load a saved game.
- The loading screen shows "Step 1 of 3" and the train loop (paused under reduced motion). Errors offer "Try again".

## 13. Phones and small screens

- **Top bar** (700 px or narrower): docked, 52 px plus `safe-area-inset-top`, paper, with a `--rule` bottom hairline. Contents:
  - the t tile;
  - the balance (compact money, 16/600) with the profit under it (12);
  - the date and its second line;
  - pause (44 px);
  - one speed button (44 px) that cycles 1×, 3×, 8×;
  - the menu (44 px), carrying the News unread dot. News moves into the menu.
- **Tab bar:** docked, 56 px plus `safe-area-inset-bottom`, paper, with a `--rule` top hairline. It holds Build, Routes, Towns and Industries, each with a 24 px icon over a 12/500 label. The active tab has an ink label and a 2 px ink bar on its top edge. Routes shows the attention count.
- **Goal pill:** 36 px, at the left under the top bar: flag, title (with ellipsis) and figure. Tapping it opens the ladder as a sheet. It hides while any sheet is open.
- **Sheets:** the drawer and the inspector are bottom sheets above the tab bar. They use `--e2`, `--r-5` top corners and a grabber (32 × 4, `--edge`). They have three detents:
  - peek, 88 px (title row and status);
  - half, 50%;
  - full: the viewport minus the top bar minus 8 px.

  Dragging and Esc/Back move between detents. The inspector sheet replaces the drawer sheet, and Back restores it with the same scroll and expanded row. Opening a sheet or changing its detent pans the selection into the band above the sheet, but only if it would otherwise be hidden.
- **Toasts:** at the bottom above the tab bar. While a sheet is open they move to the top of the band. Their actions are icon-only, with an `aria-label`.
- **Zoom:** pinch, plus 44 px + and − buttons stacked at the bottom right above the tab bar. The buttons hide while a sheet is open. Layers and Overview map live in the menu.
- **Touch:**
  - Every target is at least 44 × 44. References in prose get a 44 px hit area through padding, not bigger type.
  - Long-press previews references.
  - No information is available only on hover: the ledger opens on tap.
- **Narrow** (360 px or narrower):
  - the t tile is hidden;
  - money is compact;
  - a row's status moves to its own line;
  - secondary buttons in rows become icon-only with an `aria-label`; primary buttons keep their label and price;
  - nothing scrolls horizontally at 320 px.
- **Short landscape** (`pointer: coarse` and a height of 500 px or less):
  - the top bar is 44 px;
  - the tab bar becomes a left rail of 4 icon buttons;
  - sheets become right-hand panels (60% of the width, full height);
  - toasts appear at the top centre of the remaining band.
- **Safe areas:** bars, sheets, toasts and the tool bar all respect `env(safe-area-inset-*)`.

```
┌──────────────────────────────────────┐
│ t  $372.9k       Jan 1950   ❚❚  1×  ≡•│
│    +$1,034       Rain                 │
├──────────────────────────────────────┤
│ ⚑ First 100 deliveries  24 of 100     │
│                                      │
│               (map)             [+]  │
│  [toast]                        [−]  │
├──────────────────────────────────────┤
│  Build    Routes ▲2   Towns   Industries│
└──────────────────────────────────────┘
```

## 14. Accessibility floor

- **WCAG 2.2 AA:**
  - text at least 4.5:1 (3:1 for large text);
  - control edges, focus rings and meaningful glyphs at least 3:1.
- **Colour is never the only signal.** States have glyphs and words, and routes have numbers.
- **Keyboard:**
  - Everything is reachable, and references are buttons.
  - Esc follows the order in 10.5.
  - The map has a keyboard cursor, focus is always visible, and focus returns to where it came from.
- **Target sizes:** at least 24 × 24 on desktop and 44 × 44 on touch.
- **Names:** icon-only controls have an `aria-label` and a tooltip. A reference's accessible name is "<name>, <kind>".
- **Live regions:**
  - `#status-message` is polite and receives plain text from `copy.plain`;
  - the toast region is polite;
  - errors are assertive.
- **Reduced motion** as in 10.3.
- **Zoom:** at 200% browser zoom a 1280 px window falls into the phone layout and still works.
- **Language:** `lang="en"`.

## 15. Planned surfaces and where they live

| Feature spec | Surface and rules |
|---|---|
| next-goal-card, milestone-ladder, plan-connection | Goal line and ladder (12.2). Parts, not chapters. One signal action per current step ("Plan road $x"). Company goals in the Company dialog use the ladder. |
| notification-pipeline, ui-notices | Toasts (12.9) with template references. News dialog with rows grouped by month. |
| ttd-headlines | Headline card (12.13). The kicker and date have no middle dot. |
| fleet-per-route, route-attention, route-forecast, edit-route, pause-route, ttd-full-load, ttd-vehicle-models, names-and-rename, ttd-transit-payment, ttd-cargo-payment | Routes rows and expanded row (12.4): stepper, status line, forecast line under the proposed strip, options as switches, More menu, the "Newer trucks arrive" line, attention segment and nav count |
| cargo-contracts | "Contract offers" section in Routes: proposed strip, bonus tag, months left, Plan route |
| company-report-credit, ttd-company-rating | Company dialog (12.11, 12.17): overview, charts, leaderboard, rating reasons, credit. Ledger tooltip on the balance. |
| ttd-achievements | Achievements dialog: tier roundels, progress meters, earned dates. A celebration toast with the achievements glyph. |
| ttd-airports | Air bullet (diamond), `plane` glyph, "airport" stop kind, Place card. No new chrome. |
| city-market, city-property, city-town-hall, city-workshops, city-investment-feedback, town-needs, town-outlook, ttd-town-authority, service-share-growth, town-street-growth | Town inspector sections (12.16), Build Town category, rent floaters (paper pills), placement tip forecasts |
| industry-status-markers, overlay-placer-and-badges, delivery-floaters | Map vocabulary (9) |
| inspector-bottom-sheet, mobile-layout-pass, gesture-containment | Phone rules (13) |
| active-tool-bar, construction-ergonomics, area-zoning, construction-undo, truthful-construction-preview | Tool bar and tips (12.14). Undo as a toast action ("Road built. [Undo]"). |
| clickable-vehicles-and-stops, inspector-service-links | Vehicle references and vehicle card. Stop inspector "Routes here" and "New route from here". |
| cargo-lens | Cargo references turn the lens on. The lens chip is itself a cargo reference with a close glyph. |
| keyboard-map-cursor, selection-context-lines | Dashed orange cursor; context lines as in 9 |
| entity-lists | Towns and Industries lists (12.4), nearest first, paged |
| session-clarity | Start menu (12.19) and the paused cue (12.1) |
| ttd-mail | Mail cargo pictogram, "mail" in words |

## 16. Implementation map

### 16.1 Files

| File | Role |
|---|---|
| `tokens.css` | All tokens (section 4), base element rules, focus, reduced motion |
| `components.css` | Shared primitives (section 12, contract 16.3) |
| `refs.css` | References, the line language, map overlays |
| `hud.css` | Rails, drawer shell, menu, zoom, overview panel, phone bars |
| `build.css` | Build drawer, placement tips |
| `routes.css` | Routes drawer |
| `places.css` | Inspector, Towns and Industries lists |
| `notices.css` | Toasts, goal, News, headlines |
| `dialogs.css` | Dialog pattern, Guide, Overview map, Company, Achievements, confirmations |
| `chains.css`, `saves.css`, `visibility.css`, `start-menu.css`, `loading-screen.css` | Their own dialogs and panels |
| `design-tokens.js` | JS copy of the tokens for the canvas; `LINE_COLORS`, `MAP` |
| `ui-icons.js` | Pictograms |
| `copy.js` | Words, formatters, template tokens |
| `route-lines.js` | Line colours, route numbers, default route names |
| `ui-refs.js` | References, templates, linking, reveal |
| `ui-line.js` | Bullet, roundel, strip, ladder |
| `ui-motion.js` | Reduced motion, glide timing, tint, delta, crossfade, safe scrolling |

### 16.2 Guards and harness

**Tests:**
- `tests/ui-lint.test.mjs`: tokens only in CSS, a 12 px floor, no uppercase, known icon names, and counts of banned strings that may only go down.
- `tests/design-tokens.test.mjs`
- `tests/ui-icons.test.mjs`
- `tests/copy.test.mjs`
- `tests/route-lines.test.mjs`
- `tests/ui-refs.test.mjs`
- `tests/ui-system-browser-check.mjs`: contrast, type floor, overflow, focus, targets and budgets over every state at desk, phone and narrow sizes.
- `tests/interconnection-browser-check.mjs`

**Harness:**
- `tests/ui-states/<surface>.mjs`: named states per surface.
- `tools/ui-snapshot.mjs`: screenshots and a computed-style diff.

**Dev pages:**
- `tools/icon-sheet.html`
- `tools/ui-specimen.html`
- `tools/route-stress.mjs`

### 16.3 Class contract

| File | Classes |
|---|---|
| `components.css` | `.button`, `.button--primary`, `--secondary`, `--quiet`, `--signal`, `--danger`, `--dense`, `.price`, `.icon-button`, `.segmented`, `.stepper`, `.field`, `.switch`, `.tag`, `.meter`, `.meter--warn`, `.meter--signal`, `.state`, `.state--ok`, `--warn`, `--error`, `--paused`, `--info`, `.reason`, `.cargo-tile`, `.facts`, `.section`, `.disclosure`, `.row`, `.row--expanded`, `.empty`, `.tooltip`, `.menu`, `.popover`, `.kbd`, `.on-ink`, `.prose`, `.tool-bar`, `.tool-bar__glyph`, `__name`, `__rule`, `__actions`, `.tip`, `.i`, `.i16`, `.i20`, `.i24` |
| `refs.css` | `.ref`, `.ref--prose`, `--row`, `--compact`, `--on-ink`, `--gone`, `.is-linked`, `.bullet`, `.bullet--road`, `--rail`, `--water`, `--air`, `--16`, `.roundel`, `.strip`, `.strip__line`, `__stop`, `__vehicle`, `__vehicle--loaded`, `__waiting`, `__cut`, `.strip--proposed`, `.ladder`, `.ladder__step--done`, `--current`, `--next`, `.edge-pointer`, `.map-tag`, `.back-chip`, `.is-tinted`, `.delta` |
| Surfaces | `.rail`, `.drawer-head`, `.drawer-actions` (hud.css); `.goal-line`, `.toast`, `.toast__lead`, `.toast__action`, `.headline-card` (notices.css); `.demand-row` (places.css); `.dialog-head`, `.chart` (dialogs.css) |

Keep every existing id and `data-*` attribute that tests use, unless an item says otherwise and updates the tests.

### 16.4 Adding UI

1. Put the rules in the file for the surface.
2. Use tokens only.
3. Build every entity mention with `ref()` or `renderTemplate()`, and every figure with `copy.js`.
4. Add the new state to `tests/ui-states/<surface>.mjs`.
5. Capture it with `tools/ui-snapshot.mjs` at 1440, 1024, 390 and 320, and look at every screenshot.
6. If a rule here turns out to be wrong, change this file in the same commit and say why.

Reference mockups from the design round may still exist in the session scratchpad (`ui/wayfinding`, `ui/instrument`, `ui/atlas`). They are illustrations only; this file is authoritative.

## 17. Checklist for every UI change

- [ ] Tokens only. No new colours, sizes, radii, shadows or z-index values.
- [ ] Every text is 12 px or larger; contrast is AA; figures are tabular with `data-num`.
- [ ] Sentence case. No eyebrows, middle-dot glue, arrows as icons, or text close buttons.
- [ ] Glossary words used. The action keeps its name in its result, and errors say what happened and how to fix it.
- [ ] Every named thing is a reference, and hovering it lights the map.
- [ ] Motion only in answer to the player, and none under reduced motion.
- [ ] No layout jump. Panels keep their scroll, and Esc and focus return work.
- [ ] Nothing new on the default screen. At most one orange-filled button.
- [ ] Works at 1440, 1024, 390 and 320, and in short landscape. 44 px targets on touch.
- [ ] Screenshots taken and looked at.
