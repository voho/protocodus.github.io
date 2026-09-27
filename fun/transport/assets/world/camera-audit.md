# Fixed-camera artwork audit — September 2026

The terrain uses a 2:1 dimetric projection: `(x-y, (x+y)/2)`, with ground axes at ±26.565° and upright verticals. Ground textures receive that transform once. Buildings, plants, vehicles and infrastructure are authored for the camera and must be drawn upright with uniform scaling.

## Review and corrections

| Family | Finding and action |
| --- | --- |
| 27 houses | Reviewed all climate variants against paired ground-axis guides. Most fit the view with small rotations within their plots. Retained their art and gardens. The expensive townhouse retains modest painterly camera drift; it is not an exact geometric model. |
| 51 civic/commercial sprites | Retained civic buildings and five commerce identities. Replaced the overly frontal bank, garage and hardware shop in all climates. Only those nine cells changed; window light anchors were remeasured. |
| 33 industry sprites | Ground parcels fit the shallow diamond axes. Retained their art and reserved footprints. |
| 72 vehicle frames | Regenerated bus, locomotive, wagon, ferry, freighter and tanker against mathematical guides. Retained express bus, coach and truck art. Repacked all nine families with a shared scale so north/south views retain foreshortening. Verified all eight direction identities, including repaired north-facing ferry/tanker frames. |
| Cargo | The overhead material patches had been rotated in screen space. They now receive a single ground-plane projection aligned to the selected body frame. |
| Stops and ports | Regenerated steep source views, removed nonuniform runtime scaling and remeasured night-light anchors. The same square bounds apply to map sprites and panes. |
| Eight tunnel portals | Regenerated shallower mouths and approaches, retaining the accepted front and rear cells from separate passes. Rear entrances expose the back of the masonry. |
| Trees, plants and rocks | Organic upright silhouettes do not have rigid ground axes to measure. Retained compatible art. Removed the second ground projection from small stone details; all scenery still requires a flat footprint. Mountains are terrain geometry. |

Ground-aligned generated edges remain approximate, usually within a few degrees of the target. This audit fixes conspicuous camera mismatches and actual stretching/projection bugs; it does not claim pixel-exact orthographic construction for every painterly edge. A pitched roof edge is not a ground-axis measurement. For two perpendicular horizontal edges, `tan(abs(a))*tan(abs(b)) ≈ 0.25` is consistent with this camera even when a building is rotated within its plot.

## Active sources and prompts

- [Commerce corrections](buildings-commerce-camera-v2/generation.json), with guide and per-climate source masters.
- [Stops and ports](isometric-infrastructure-v2/isometric-prompt.json), [tunnel portals](isometric-portals-v2/isometric-prompt.json), with original generated inputs and lossless registration records.
- `vehicle-{kind}-dimetric-v2/` contains source art, `prompt.json`, atlas metadata and 256px masters. Regenerated families also retain their geometry guides. `vehicles-dimetric-v2/` uses exact southeast master copies for UI and loading fallback.
- Original directories remain available as provenance. No original generated sheet was overwritten by the corrections.

## Verification

The projection unit tests check all eight headings and the cargo basis. The packer regression checks shared-scale foreshortening and legacy behavior. Browser checks cover vehicle directions, trailers, loaded cargo, missing-directional fallback, station light panes, shipping/bridge occlusion, artwork in panels and actual isometric scene rendering. The supported zoom levels are 0.5×, 1× and 2×, each checked at DPR 1 and 2 where applicable.
