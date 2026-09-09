# Product media

Verified on 9 September 2026. Instrument panels are authentic source screenshots or assembled Rack Extension panels. WebP copies retain the complete interface; 880-pixel variants serve the homepage.

On this pass Taikor was regenerated from `d645d4a` after the upstream vintage-Japanese redesign: SSIM between the previous WebP and the current source was 0.335, a different interface entirely. Electry (`704dc52`) and YouKnow (`72e1d448`) were re-measured against their current upstream files at SSIM 0.988 and 0.979, differences attributable to WebP encoding alone, so their media is unchanged. Taikor's two files carry the cache key `?v=20260909b`; every other image keeps `?v=20260909`.

| Product | Source | Original dimensions |
| --- | --- | --- |
| Electry | [Screenshot at 704dc524](https://github.com/protocodus/virtual-instrument-electry/blob/704dc52439aa527e3072c2531ab7b3262a87e326/Docs/screenshots/electry-standalone.png) | 1180 × 910 |
| Taikor | [Screenshot at d645d4a](https://github.com/protocodus/virtual-instrument-taikor/blob/d645d4a6d0942deab741fbf9b40ec6aba7064bb8/Docs/screenshots/taikor-standalone.png) | 1280 × 880 |
| YouKnow plug-in | [Screenshot at 72e1d448](https://github.com/protocodus/virtual-instrument-youknow/blob/72e1d4482324465993c8e62609fa345e848d3b70/Docs/screenshots/youknow-standalone.png) | 1360 × 718 |
| YouKnow Rack Extension | Author's generated `Release/1.0.0f17` materials, from [746f8880 release evidence](https://github.com/protocodus/reason-rack-extensions/blob/746f8880a36e89ab0823a8fb9708d478c55601c3/Examples/YouKnow/Docs/RELEASE_EVIDENCE.md) | 1600 × 1171 |
| Podcare | [Repository illustration at c5f5539d](https://github.com/voho/podcare/blob/c5f5539d1554de8c3284026a4bacbc37dfb99cf5/logo.png), used as artwork, not a GUI screenshot | 1080 × 616 |

The YouKnow front, back, thumbnail and manual come from the same f17 candidate. The manual SHA-256 is `38b5e31d1d9c0223e6619feac160b917183dd82777c9ca10825c25ac52ac7861`. The candidate is unreleased; its inclusion here does not imply Shop availability.

The product repositories' READMEs and playing guides are the source for feature and format descriptions. YouKnow Linux packages contain VST3 and standalone, while its macOS and Windows packages also include CLAP. Podcare is installed from source and has no graphical interface or packaged release.

The product pages no longer link to any repository. Each page carries a single call to action, "Buy at Gumroad", pointing at `protocodus.gumroad.com/l/<slug>`; the Taikor listing did not exist when this was written. The homepage Podcare card is no longer a link. Format lists in the page sidebars are now the only availability claim, and the pages make no statement about build or download status.

When refreshing media, check the current upstream file rather than its name alone, preserve its aspect ratio, update HTML dimensions and cache keys, and verify desktop, tablet and phone layouts.
