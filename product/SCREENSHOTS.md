# Product media and claim sources

Reviewed on 14 October 2026. Product pages follow the released Reason Rack Extensions where available. Preview builds are labelled separately from products available in the Reason Studios Shop.

## Release authority

- **YouKnow 1.3.0** and **Maremba 1.5.0** are the versions listed by the Reason Studios Shop, released 13 October 2026 and verified 14 October. Shop URLs are the only purchase destinations on these pages.
- **Acustra 1.3.3f2** and **Lamer Degrader 1.0.0f10** are prepared Rack Extension previews. Their pages say **COMING SOON**.
- **Electry, Taikor and Septum** have no Rack Extension implementation in the inspected Rack repository. Their pages retain the plug-in feature descriptions and authentic editor images, say **COMING SOON**, and do not advertise Rack compatibility or invent Rack versions.
- Podcare and the games are outside this instrument update.

YouKnow’s Rack bank contains 100 patches (99 Protocodus sounds plus Init), not the plug-in’s 144-preset bank. Plug-in-only firmware timing, output connection menus and SysEx features are not advertised for the Rack release. Maremba’s public Shop image was older than its listed version, so the website uses complete panel composites from the matching 1.5.0 release source. Later development controls are not presented as released features.

## Media and guides

Full panel images are authentic composed runtime panels, not concept artwork. Front and rear PNGs are copied or exported from their matching release materials; WebPs retain the full interface and original aspect ratio. Product captions distinguish Rack panels from plug-in editor screenshots. Each image’s declared HTML dimensions and `srcset` descriptors match the exported file.

| Product | Media and feature provenance |
| --- | --- |
| YouKnow | [Release assets and hashes](youknow/ASSET_PROVENANCE.json), [Rack claim evidence](youknow/MODELLING.md) |
| Maremba | [Release assets, source and guide](maremba/ASSET_PROVENANCE.json) |
| Acustra | [Preview assets and source](acustra/ASSET_PROVENANCE.json) |
| Lamer Degrader | [Preview assets and retained demo provenance](lamer/ASSET_PROVENANCE.json) |

The published-version manuals are refreshed alongside their panels. Older development notes are retained in [the 6–12 October archive](releases/archive-2026-10-12.html); the [versions and availability page](releases/index.html) describes the current products. The old [6 October build manifest](releases/2026-10-06.json) remains a historical record.

## Retained plug-in screenshots

| Product | Existing screenshot source | Dimensions |
| --- | --- | --- |
| Electry | `virtual-instrument-electry` revision `6dacb95e00b63181eae3de94eb933dc52e945428`, `Docs/screenshots/electry-standalone.png` | 1180 × 910; card 880 × 679 |
| Taikor | `virtual-instrument-taikor` revision `5483f0c6bd8c3de712df949acdfe5112a0dc977e`, `Docs/screenshots/taikor-standalone.png` | 1280 × 920; card 880 × 633 |
| Septum | `virtual-instrument-septum` revision `39b24e5ab723e3cb1b306f31987552504079df89`, editor snapshot via `SEPTUM_EDITOR_SNAPSHOT` | 1960 × 1206; card 880 × 541 |

These depict the plug-in editions; no Rack screenshots are substituted for products without a Rack port. Features are checked against their source READMEs and active DSP rather than inferred from other instruments.

## Official Reason artwork

The unchanged SVGs in `assets/images/reason-rack-extension.svg` and `assets/images/reason-studios-shop-white.svg` come from Reason Studios’ [Third-Party Logo Pack](https://cdn.reasonstudios.com/developers/Third-Party-Logo-Pack-24.zip), linked by the official [marketing guidelines](https://developer.reasonstudios.com/learning-and-support/marketing).

The Rack Extension technology icon is an unlinked compatibility mark on the two available products. The approved Shop badge links directly to each product’s Shop page. Original proportions and clear space are preserved; preview products use text availability labels without official technology logos.

## Refresh workflow

Verify the public released version independently of the highest local candidate. Inspect its `info.lua`, player guide, control mapping and complete panel exports. Keep purchase links, feature descriptions, guides, card images, full-size panels, Open Graph images and the versions page consistent. Update provenance and cache keys, then verify local links, actual image dimensions and desktop/tablet/mobile layout.
