# Ashline visual direction

These instructions apply to Ashline and all files under `fun/ashline/`.

## Style and atmosphere

Ashline is an original 2D military science-fiction RTS set on a desolate volcanic frontier. Units and buildings use deliberately low-resolution RTS sprites with the form and lighting of military miniatures: functional machinery, broad armor plates, graphite mechanisms, clear faction paint, and sparse amber work lights. Design the art for its actual gameplay size, using clean pixel clusters, a few distinct shades per material, and strong major shapes. Avoid high-resolution photographic textures, tiny rivets, dense scratches, and fine detail that becomes noise or blur when reduced. Friendly forces use bright ivory armor with cobalt panels; enemy forces use broad crimson armor with pale warm highlights. The mood is rugged, tactical, and atmospheric, with original branding and designs.

Use a fixed, mostly overhead orthographic camera: approximately 80% top view and 20% side view. Roofs dominate, while shallow visible side walls give objects height and variety. Keep this camera angle identical for every unit, facing, and animation frame. Turning changes a unit's heading on the ground plane; it must never tilt the camera, expose a side-on profile, or switch to a different elevation. Avoid a completely flat vertical view in the final rendering.

Align buildings with the world grid. Keep side depth and short cast shadows consistent in screen space as units turn. Use soft, nearly diffuse roof lighting and restrained ambient occlusion; strong baked directional shadows must not rotate with a sprite. Maintain common physical scale and stable body anchors through a full rotation and between animation frames.

All units and buildings cast soft silhouette shadows toward the lower right, with one fixed light source from the upper left. Larger structures cast longer shadows; construction shadows grow with completion. Keep shadows on the ground beneath other objects and selection indicators. Concealed enemies and remembered enemy silhouettes must not cast live shadows that reveal their current state.

The current unit pipeline uses overhead source atlases, rotates each unit on the ground plane, then applies the same shallow projection and side depth to every heading. Keep projection after heading rotation. Do not restore the old mixture of independently angled directional sprites. Source textures may be strictly overhead; the final in-game view must retain the requested small amount of side depth. Cache unit and building frames close to their gameplay pixel sizes and use nearest-neighbor sampling for sprite normalization, rotation, zoom, portraits, and production previews. Preserve continuous headings and stable anchors; never blur the body art to hide pixel steps. Terrain, fog, light effects, and soft shadows retain their separate smooth rendering.

The terrain consists of charcoal/taupe ash, basalt, slate dust, fractured rock, subdued rust deposits, and luminous mint mineral crystals. Surface detail should remain quiet enough for armies to read immediately. Low-resolution pixel clusters belong on the units and buildings; keep their proportions grounded and their major equipment recognizable. Avoid cartoon proportions, vector-icon simplification, low-poly facets, thick ink outlines, excessive bloom, or pervasive neon lighting.

Lava pools lie within the same ground plane: irregular rounded basalt shores, textured dark cooling crust, warm orange molten channels, and sparse pale amber bubbles. Use quiet surface motion and small local highlights. Keep banks grounded in the surrounding ash; avoid flat black tile cutouts, hard grid-shaped edges, or large glowing halos. Lava must remain clearly different from mint mineral deposits, with nearby ivory units and faction markings easy to identify. Unexplored lava stays hidden, and remembered pools show no live motion outside current vision.

Deadwood adds botanical variety without overtaking the military silhouettes: bare broad-crowned hardwoods, charred conifers, twisted wind-bent trees, ash-bleached forked snags, hollow stumps, and fallen trunks. Use dry taupe, muted grey-brown, graphite char, and small ochre splinters; bleached bark stays darker than ivory unit armor. Keep branching open and substantial enough to read at minimum zoom. Source crowns are overhead layers, prepared with the same fixed shallow projection as unit roofs; never rotate the camera or turn these props into tall side-elevation portraits. Cluster them sparsely in rocky ground, preserve roots/rubble as a clear obstructed footprint, and keep mineral deposits, roads, and base clearings readable. Soft shadows fall lower-right. Canopies may fade for visible units behind them; concealed units must never affect tree opacity.

## Palette

Use the existing palette as the reference; textured materials may vary naturally with wear and lighting.

| Role | Reference |
| --- | --- |
| Deep background | `#111b20` |
| HUD panels | `#142027`, usually translucent (`#142027ed`) |
| Primary text | Soft ivory `#dbe4de` |
| Secondary text | Muted blue-grey `#97acb1` |
| Controls and selection accents | Pale cyan `#8dccca` |
| Fine HUD borders | `#8bb0b32e` |
| Friendly faction paint | Bright ivory armor, cobalt blue panels and square insignia `#2d7cf2`, ice highlights `#dcf1ff` |
| Enemy faction paint | Broad crimson armor and diamond insignia `#d8344c`, pale salmon highlights `#ffd8d5` |
| Resources and work lights | Amber `#d9a764` |
| Warnings | Warm orange `#e29677` |
| Ground material | Low-contrast charcoal/taupe, around `#46443e` |
| Unit armor and machinery | Faction armor over dark graphite mechanisms; preserve visible wear and edge highlights |
| Mineral deposits | Pale luminous mint crystals, grounded in dark rubble |
| Deadwood | Dusty taupe and grey-brown bark, graphite char, restrained ochre splinters |
| Lava | Charcoal cooling crust `#2f2924`, deep red-orange `#c23109`, molten orange `#f86810`, small amber highlights `#ffce5b` |

Reserve saturated color and strong highlights for meaningful signals. Faction ownership is one of those signals: do not reduce enemies to the same ivory armor with tiny differently colored stripes. Apply crimson across the major armor surfaces of every enemy unit and building, including portraits, production previews, idle facilities, and all cargo levels. Keep dark mechanisms, amber lamps, and mint minerals in their original materials. Friendly ivory stays lighter than enemy armor in grayscale; blue squares and red diamonds provide an additional shape cue independent of color. Keep faction markings distinct from mineral glow.

## Mandatory unit readability

**Units must be very distinct visually, both from one another and from the background, so players can identify their type, facing, and faction at a glance. Gameplay readability takes priority over decorative realism.**

- Give every class a unique silhouette, proportions, and major equipment shapes. Recognition must work without selecting the unit, reading its label, or relying on color alone.
- Preserve clear brightness and edge separation between units and terrain. Keep ivory and crimson armor readable against dark ground; use controlled edge highlights, contact shadows, or subtle outlines where needed. Weathering must not camouflage a unit into the ash.
- Keep identifying features large enough to survive gameplay scaling. Distinct wheels, tracks, weapons, and cargo silhouettes matter more than small surface details. Use broad contiguous armor and faction-color patches, substantial weapon barrels, and a few large cargo crystals. Infantry must remain recognizable at the smallest supported gameplay zoom. Judge the actual small sprite first, before any enlarged contact sheet.
- Use faction paint and team indicators consistently across sprites, portraits, and the minimap. Unit classes must still be distinguishable in grayscale.
- Selection rings and health bars supplement an already readable sprite. Unselected units must remain easy to find.
- Dust, smoke, explosions, mineral glow, and environmental decoration must not obscure unit identity for sustained periods. Contrast aids must respect fog of war and never expose concealed enemies.

| Unit | Required identifying features |
| --- | --- |
| Rifle squad | Clear human silhouette, separated legs, helmet/shoulder armor, and carried rifle |
| Rocket infantry | Human silhouette with a broad shoulder launcher, thick tube extending beyond the body, and spare rocket pack; visibly heavier equipment than rifle squads |
| Recon rover | Compact, agile four-wheel buggy; visible tires, small roof gun, sensor antenna |
| Vanguard tank | Broad, heavy tracked hull; distinct central turret and single cannon |
| Siege crawler | Elongated tracked chassis, oversized long gun extending beyond the hull, exposed siege machinery |
| Shard hauler | Bulky six-wheel industrial truck, asymmetric cabin, obvious mineral hopper and collection teeth; no weapon turret |

Buildings also need recognizable functional silhouettes: nexus communications equipment, reactor cylinders, refinery conveyor/hopper, barracks garrison, foundry garage, standalone rail sentry, and a raised rocket tower with paired missile pods on a broad pedestal. Rocket towers occupy two tiles per side; their missile battery must remain distinct from the smaller rail sentry's single barrel.

Operational visuals must reflect the simulation. Show the current queued unit inside its production bay, with assembly advancing alongside progress. Idle production bays are empty, dim, and still. Refinery cargo, conveyors, and processing exhaust run only for delivered minerals; training a hauler is a separate activity. Empty haulers have a visibly hollow dark hopper, partial loads reveal increasing mint cargo, and full loads fill the bed. Cargo drains during unloading. Preserve the same body silhouette, camera, and anchor across all cargo levels. Previously seen enemy facilities retain their last observed state under fog, without revealing later changes.

## Interface and effects

Keep the battlefield dominant. Use compact translucent charcoal panels, thin borders, restrained cyan highlights, Space Grotesk text, and monospace telemetry. Production is collapsible; selection controls are contextual. Mobile layouts must retain readable labels and usable touch targets without covering the main action.

Use brief, directional combat effects and restrained industrial animation: muzzle flashes, shells, recoil, tracks, steam, and work lights. Show unexplored territory as concealed and previously explored territory as dimmed; preserve the distinction from currently visible terrain.

Unit ranks use three small fixed-screen chevrons beneath the sprite: subdued grey slots for unearned ranks and restrained warm gold for earned ranks. A blue square for friendlies or red diamond for enemies sits beside the chevrons on the same compact dark plate. Keep all three ranks and the team shape legible at minimum zoom, independent of unit heading and beneath the body silhouette. Buildings carry a small matching team badge; minimap markers use the same colors and shapes. Draw live indicators only for living friendly or currently visible enemy entities; remembered building badges dim under fog with their last observed silhouettes. Fog must never expose a hidden unit or promotion. The contextual selection panel uses one compact rank/kills/bonus line for a single unit. Mixed groups and buildings must not inherit the first unit’s rank or health as a group statistic.

Rocket infantry walks and trains as infantry, without vehicle tracks or assembly gantries. Rockets have a readable ivory missile body, brief amber exhaust, a restrained smoke trail, and an impact burst. Their trails and targeting must respect current visibility; never reveal a concealed launch site or hidden target movement.

## Review visual changes in context

Inspect changed art in the running game at normal and minimum zoom, on desktop and mobile. Check both factions, a complete smooth turn including angles between the eight compass headings, idle/moving frames, mixed groups, and units beside rocks, buildings, and bright minerals. Verify that roof-to-side proportions and the direction of visible side depth stay consistent throughout rotation. Compare silhouettes and grayscale readability as well as color. Reject clipped weapons, unstable scale, drifting anchors, chroma-key halos, or units that disappear into terrain.

Use `assets/generated/ASSETS.md` for asset references and generation prompts, `assets.js` for sprite preparation, `render.js` for battlefield rendering, and `ashline.css` for HUD tokens. Keep future assets consistent with this direction and update provenance when replacing generated art.
