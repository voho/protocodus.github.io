# Product media

YouKnow verified on 3 October 2026; other products retain the verification dates below. Instrument panels are authentic source screenshots or assembled Rack Extension panels. WebP copies retain the complete interface; 880-pixel variants serve the homepage.

On the 27 September pass Electry was regenerated from `6dacb95e` after the 11 September interface finish: SSIM between the previous WebP and the current source was 0.926 at unchanged dimensions. Taikor was regenerated from `b5565919`, where the editor grew to 1280 × 920. The YouKnow plug-in was re-measured at that time, and Podcare's source was unchanged at `c5f5539d`. The current YouKnow refresh is documented below. The YouKnow Rack Extension set was replaced by the 1.1.0f8 candidate's, and Maremba's set was added from the 1.4.0f3 artwork, both taken from `reason-rack-extensions` `dist/` at `0da82228`. That pass used cache key `?v=20260927`; Podcare retains `?v=20260909`. The current YouKnow plug-in, rear panel and manual use `?v=20261003`; its unchanged Rack Extension front keeps `?v=20260927`.

| Product | Source | Original dimensions |
| --- | --- | --- |
| Electry | [Screenshot at 6dacb95e](https://github.com/protocodus/virtual-instrument-electry/blob/6dacb95e00b63181eae3de94eb933dc52e945428/Docs/screenshots/electry-standalone.png) | 1180 × 910 |
| Acustra | Editor snapshot rendered from [4f198756](https://github.com/protocodus/virtual-instrument-acustra/blob/4f198756105a9ce2ebd01729e5aa5dc1081e9854/Source/PluginEditor.cpp) using the processor-test snapshot harness | 1120 × 800 |
| Taikor | [Screenshot at b5565919](https://github.com/protocodus/virtual-instrument-taikor/blob/b5565919f69ac439ae08205318cb7a789e8c6afc/Docs/screenshots/taikor-standalone.png) | 1280 × 920 |
| YouKnow plug-in | [Current CI screenshot at 9ebd0e64](https://github.com/protocodus/virtual-instrument-youknow/blob/9ebd0e64e4801b22cf073e3b983d08df8f276e54/Docs/screenshots/youknow-standalone.png), rendered from source `e75f0bb856e4f6de050187899138c6ca8b1269a8` | 1360 × 718 |
| YouKnow Rack Extension | Front, back, thumbnail and manual of the 1.2.0f1 candidate, from [`dist/` at fd418773](https://github.com/protocodus/reason-rack-extensions/tree/fd418773b59368b65d3d8f672de23e16747adf50/dist) | 1600 × 1171 |
| Maremba Rack Extension | Front, back, thumbnail and player guide of the 1.4.0f3 artwork, from the same `dist/` revision (the 1.4.0f4 candidate rebuilt only the U45 and kept the artwork) | 1600 × 1171 |
| Podcare | [Repository illustration at c5f5539d](https://github.com/voho/podcare/blob/c5f5539d1554de8c3284026a4bacbc37dfb99cf5/logo.png), used as artwork, not a GUI screenshot | 1080 × 616 |

The YouKnow Rack Extension manual SHA-256 is `c703f89f4fa303d04b0b9ad377334da75ceda8803c84d67bc4521c5bd127b199`. The Maremba player guide (eight pages) SHA-256 is `97fb8aafcb6002461e3fa8dd793a5a3964e1e8b1820e5d4a881bf7b44a2abb0f`; its rear panel carries the build caption 1.4.0f3. Both candidates are unreleased; their inclusion here does not imply Shop availability. The generated Maremba Shop hero (`dist/Maremba_Shop_Hero.png`) is a conceptual product photograph and is not used on the site.

The product repositories' READMEs and playing guides are the source for feature and format descriptions; Maremba's are the Rack Extension README and `docs/USER_GUIDE.md`. YouKnow Linux packages contain VST3 and standalone, while its macOS and Windows packages also include CLAP. Podcare is installed from source and has no graphical interface or packaged release.

Product research, current demos and player guides link to their source repositories. The YouKnow, Electry and Taikor plug-in pages carry a single call to action, "Buy at Gumroad", pointing at `protocodus.gumroad.com/l/<slug>`; the Taikor listing did not exist when this was written. Maremba has no store listing: its primary action is the player guide, and its availability row states that it is in development. Acustra uses an email contact action, as documented below. The homepage Podcare card is not a link. YouKnow identifies the current plug-in as a 1.2.0 development build and links the build/installation documentation; this does not verify the contents of the Gumroad downloads.

When refreshing media, check the current upstream file rather than its name alone, preserve its aspect ratio, update HTML dimensions and cache keys, and verify desktop, tablet and phone layouts.

## Acustra — 1 October 2026

Acustra's committed screenshot predates the removal of Nylon and Cedar and the addition of Piezo Mix and Gather Chords. The new `acustra-panel.webp` and 880 × 629 `acustra-card.webp` are derived from a fresh 1120 × 800 editor snapshot of clean source revision `4f198756105a9ce2ebd01729e5aa5dc1081e9854`, not that older screenshot. Both retain the complete interface and use cache key `?v=20261001`.

To reproduce the source snapshot in the Acustra checkout, build `AcustraPluginProcessorTests`, then run it with `ACUSTRA_EDITOR_SNAPSHOT` set to an absolute PNG output path. The harness renders the editor directly without an audio device; its processor contract tests passed. The source PNG SHA-256 is `c97a19aedd5efbb1ce3faf8a168b1454a9950ac4a467761c35d20c6a75fdb88b`. WebP derivatives use `cwebp -q 88 -m 6`, with `-resize 880 0` for the homepage variant.

Feature and format descriptions follow the README, current editor, CMake format targets and CI platform builds at that revision. Acustra has no published GitHub release, and `protocodus.gumroad.com/l/acustra` returned HTTP 404 on this date. Its page therefore uses an email contact action and explicitly lists its status as in development.

## YouKnow — 3 October 2026

The plug-in hero and 880 × 465 homepage card are regenerated from the authentic 1360 × 718 editor screenshot in successful CI run `36967735594`, attempt 1, source `e75f0bb856e4f6de050187899138c6ca8b1269a8`. Refresh commit `9ebd0e64e4801b22cf073e3b983d08df8f276e54` records version `1.2.0-build.36967735594.1`. The PNG is byte-identical to the 29 September editor snapshot: the 2 October changes affect DSP, with no editor changes. Its SHA-256 is `b46a2bfb4ff4f7b6819a0704229e705545d2f1c35b1b8bff423ee2301a707468`. The previous website screenshot predates the Session OUTPUT menu. WebP derivatives use `cwebp -q 88 -m 6`, with `-resize 880 0` for the card; neither crops the interface.

Rack Extension media follows the `1.2.0f1` candidate at `fd418773b59368b65d3d8f672de23e16747adf50`. Front and thumbnail are byte-identical to the existing media and remain unchanged. The updated back panel is also shown on the page as a 1400 × 1025 WebP, produced with `cwebp -q 88 -m 6 -resize 1400 0`. Its full PNG SHA-256 is `061410b69a837052a24fb0c41a481e58dc40735eef079a2eb9c8e58b31db7063`. The seven-page candidate manual is updated alongside it. Local release evidence records acceptance submission on 29 September, while the official Reason Shop search returned no YouKnow results on 3 October. The page retains development wording and does not imply Shop publication.

The plug-in feature copy now includes the output connection controls, current nonlinear chorus filters, retained chorus switching state, session tools and numerical quality choices. The SoundCloud playlist is explicitly labelled as earlier v1 recordings, with a link to current engine renders. Platform and preset counts are checked against the current README and user guide; edition-specific counts remain 144 plug-in sounds plus INIT and 99 Rack Extension sounds plus Init.
