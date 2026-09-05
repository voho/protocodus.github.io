# Ashline visual direction

These instructions apply to Ashline and all files under `fun/ashline/`.

## Style and atmosphere

Ashline is an original 2D military science-fiction RTS set on a desolate volcanic frontier. Preserve the feel of realistic, pre-rendered military miniatures: functional industrial machinery, weathered ivory armor, graphite mechanisms, layered steel, restrained faction paint, and tiny amber work lights. The mood is rugged, tactical, and atmospheric. Its classic RTS influence should carry through readable battlefield composition and mechanical detail, with original branding and designs.

Use a fixed, mostly overhead orthographic camera: approximately 80% top view and 20% side view. Roofs dominate, while shallow visible side walls give objects height and variety. Keep this camera angle identical for every unit, facing, and animation frame. Turning changes a unit's heading on the ground plane; it must never tilt the camera, expose a side-on profile, or switch to a different elevation. Avoid a completely flat vertical view in the final rendering.

Align buildings with the world grid. Keep side depth and short cast shadows consistent in screen space as units turn. Use soft, nearly diffuse roof lighting and restrained ambient occlusion; strong baked directional shadows must not rotate with a sprite. Maintain common physical scale and stable body anchors through a full rotation and between animation frames.

The current unit pipeline uses one overhead source atlas, rotates each unit on the ground plane, then applies the same shallow projection and side depth to every heading. Keep projection after heading rotation. Do not restore the old mixture of independently angled directional sprites. Source textures may be strictly overhead; the final in-game view must retain the requested small amount of side depth.

The terrain consists of charcoal/taupe ash, basalt, slate dust, fractured rock, subdued rust deposits, and luminous mint mineral crystals. Surface detail should remain quiet enough for armies to read immediately. Avoid cartoon proportions, pixel-art treatment, low-poly facets, thick ink outlines, excessive bloom, or pervasive neon lighting.

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
| Friendly faction paint | Restrained steel blue/cyan, reference `#6da9b7` |
| Enemy faction paint | Rust red/copper, reference `#cb6c50`; warm orange lights |
| Resources and work lights | Amber `#d9a764` |
| Warnings | Warm orange `#e29677` |
| Ground material | Low-contrast charcoal/taupe, around `#46443e` |
| Unit armor and machinery | Light weathered ivory over dark graphite mechanisms |
| Mineral deposits | Pale luminous mint crystals, grounded in dark rubble |

Reserve saturated color and strong highlights for meaningful signals. Keep faction markings distinct from mineral glow; cyan alone cannot identify a friendly unit beside a shard field.

## Mandatory unit readability

**Units must be very distinct visually, both from one another and from the background, so players can identify their type, facing, and faction at a glance. Gameplay readability takes priority over decorative realism.**

- Give every class a unique silhouette, proportions, and major equipment shapes. Recognition must work without selecting the unit, reading its label, or relying on color alone.
- Preserve clear brightness and edge separation between units and terrain. Keep ivory armor readable against dark ground; use controlled edge highlights, contact shadows, or subtle outlines where needed. Weathering must not camouflage a unit into the ash.
- Keep identifying features large enough to survive gameplay scaling. Distinct wheels, tracks, weapons, and cargo silhouettes matter more than small surface details. Infantry must remain recognizable at the smallest supported gameplay zoom.
- Use faction paint and team indicators consistently across sprites, portraits, and the minimap. Unit classes must still be distinguishable in grayscale.
- Selection rings and health bars supplement an already readable sprite. Unselected units must remain easy to find.
- Dust, smoke, explosions, mineral glow, and environmental decoration must not obscure unit identity for sustained periods. Contrast aids must respect fog of war and never expose concealed enemies.

| Unit | Required identifying features |
| --- | --- |
| Rifle squad | Clear human silhouette, separated legs, helmet/shoulder armor, and carried rifle |
| Recon rover | Compact, agile four-wheel buggy; visible tires, small roof gun, sensor antenna |
| Vanguard tank | Broad, heavy tracked hull; distinct central turret and single cannon |
| Siege crawler | Elongated tracked chassis, oversized long gun extending beyond the hull, exposed siege machinery |
| Shard hauler | Bulky six-wheel industrial truck, asymmetric cabin, obvious mineral hopper and collection teeth; no weapon turret |

Buildings also need recognizable functional silhouettes: nexus communications equipment, reactor cylinders, refinery conveyor/hopper, barracks garrison, foundry garage, and standalone rail sentry.

## Interface and effects

Keep the battlefield dominant. Use compact translucent charcoal panels, thin borders, restrained cyan highlights, Space Grotesk text, and monospace telemetry. Production is collapsible; selection controls are contextual. Mobile layouts must retain readable labels and usable touch targets without covering the main action.

Use brief, directional combat effects and restrained industrial animation: muzzle flashes, shells, recoil, tracks, steam, and work lights. Show unexplored territory as concealed and previously explored territory as dimmed; preserve the distinction from currently visible terrain.

## Review visual changes in context

Inspect changed art in the running game at normal and minimum zoom, on desktop and mobile. Check both factions, a complete smooth turn including angles between the eight compass headings, idle/moving frames, mixed groups, and units beside rocks, buildings, and bright minerals. Verify that roof-to-side proportions and the direction of visible side depth stay consistent throughout rotation. Compare silhouettes and grayscale readability as well as color. Reject clipped weapons, unstable scale, drifting anchors, chroma-key halos, or units that disappear into terrain.

Use `assets/generated/ASSETS.md` for asset references and generation prompts, `assets.js` for sprite preparation, `render.js` for battlefield rendering, and `ashline.css` for HUD tokens. Keep future assets consistent with this direction and update provenance when replacing generated art.
