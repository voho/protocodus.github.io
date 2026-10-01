# Product media

Verified on 27 September 2026. Instrument panels are authentic source screenshots or assembled Rack Extension panels. WebP copies retain the complete interface; 880-pixel variants serve the homepage.

On this pass Electry was regenerated from `6dacb95e` after the 11 September interface finish: SSIM between the previous WebP and the current source was 0.926 at unchanged dimensions. Taikor was regenerated from `b5565919`, where the editor grew to 1280 × 920. The YouKnow plug-in was re-measured against `9e0742d2` at SSIM 0.986, a difference attributable to WebP encoding alone, so its media is unchanged, and Podcare's source is unchanged at `c5f5539d`. The YouKnow Rack Extension set was replaced by the 1.1.0f8 candidate's, and Maremba's set was added from the 1.4.0f3 artwork, both taken from `reason-rack-extensions` `dist/` at `0da82228`. Refreshed and new images carry the cache key `?v=20260927`; the YouKnow plug-in and Podcare images keep `?v=20260909`.

| Product | Source | Original dimensions |
| --- | --- | --- |
| Electry | [Screenshot at 6dacb95e](https://github.com/protocodus/virtual-instrument-electry/blob/6dacb95e00b63181eae3de94eb933dc52e945428/Docs/screenshots/electry-standalone.png) | 1180 × 910 |
| Acustra | Editor snapshot rendered from [4f198756](https://github.com/protocodus/virtual-instrument-acustra/blob/4f198756105a9ce2ebd01729e5aa5dc1081e9854/Source/PluginEditor.cpp) using the processor-test snapshot harness | 1120 × 800 |
| Taikor | [Screenshot at b5565919](https://github.com/protocodus/virtual-instrument-taikor/blob/b5565919f69ac439ae08205318cb7a789e8c6afc/Docs/screenshots/taikor-standalone.png) | 1280 × 920 |
| YouKnow plug-in | [Screenshot at 72e1d448](https://github.com/protocodus/virtual-instrument-youknow/blob/72e1d4482324465993c8e62609fa345e848d3b70/Docs/screenshots/youknow-standalone.png), re-measured against [9e0742d2](https://github.com/protocodus/virtual-instrument-youknow/blob/9e0742d21b874328116a3da9516b2c7c5ffef73a/Docs/screenshots/youknow-standalone.png) | 1360 × 718 |
| YouKnow Rack Extension | Front, back, thumbnail and manual of the 1.1.0f8 candidate, from [`dist/` at 0da82228](https://github.com/protocodus/reason-rack-extensions/tree/0da8222828882b091f5d8d12e15ed1424208310c/dist) | 1600 × 1171 |
| Maremba Rack Extension | Front, back, thumbnail and player guide of the 1.4.0f3 artwork, from the same `dist/` revision (the 1.4.0f4 candidate rebuilt only the U45 and kept the artwork) | 1600 × 1171 |
| Podcare | [Repository illustration at c5f5539d](https://github.com/voho/podcare/blob/c5f5539d1554de8c3284026a4bacbc37dfb99cf5/logo.png), used as artwork, not a GUI screenshot | 1080 × 616 |

The YouKnow Rack Extension manual SHA-256 is `d597e8d2879cb8a6e843017138f7ed6fb4e9a7a19e9600db6ec2cef921640642`. The Maremba player guide (eight pages) SHA-256 is `97fb8aafcb6002461e3fa8dd793a5a3964e1e8b1820e5d4a881bf7b44a2abb0f`; its rear panel carries the build caption 1.4.0f3. Both candidates are unreleased; their inclusion here does not imply Shop availability. The generated Maremba Shop hero (`dist/Maremba_Shop_Hero.png`) is a conceptual product photograph and is not used on the site.

The product repositories' READMEs and playing guides are the source for feature and format descriptions; Maremba's are the Rack Extension README and `docs/USER_GUIDE.md`. YouKnow Linux packages contain VST3 and standalone, while its macOS and Windows packages also include CLAP. Podcare is installed from source and has no graphical interface or packaged release.

The product pages do not link to any repository. The YouKnow, Electry and Taikor plug-in pages carry a single call to action, "Buy at Gumroad", pointing at `protocodus.gumroad.com/l/<slug>`; the Taikor listing did not exist when this was written. Maremba has no store listing: its primary action is the player guide, and its availability row states that it is in development. Acustra uses an email contact action, as documented below. The homepage Podcare card is not a link. Format lists in the page sidebars are the only availability claim, and the pages make no statement about build or download status.

When refreshing media, check the current upstream file rather than its name alone, preserve its aspect ratio, update HTML dimensions and cache keys, and verify desktop, tablet and phone layouts.

## Acustra — 1 October 2026

Acustra's committed screenshot predates the removal of Nylon and Cedar and the addition of Piezo Mix and Gather Chords. The new `acustra-panel.webp` and 880 × 629 `acustra-card.webp` are derived from a fresh 1120 × 800 editor snapshot of clean source revision `4f198756105a9ce2ebd01729e5aa5dc1081e9854`, not that older screenshot. Both retain the complete interface and use cache key `?v=20261001`.

To reproduce the source snapshot in the Acustra checkout, build `AcustraPluginProcessorTests`, then run it with `ACUSTRA_EDITOR_SNAPSHOT` set to an absolute PNG output path. The harness renders the editor directly without an audio device; its processor contract tests passed. The source PNG SHA-256 is `c97a19aedd5efbb1ce3faf8a168b1454a9950ac4a467761c35d20c6a75fdb88b`. WebP derivatives use `cwebp -q 88 -m 6`, with `-resize 880 0` for the homepage variant.

Feature and format descriptions follow the README, current editor, CMake format targets and CI platform builds at that revision. Acustra has no published GitHub release, and `protocodus.gumroad.com/l/acustra` returned HTTP 404 on this date. Its page therefore uses an email contact action and explicitly lists its status as in development.
