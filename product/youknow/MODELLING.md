# YouKnow Rack Extension product-page sources

Reviewed 14 October 2026. The page describes the **released Reason Rack Extension
1.3.0**, published 13 October, rather than the native plug-in or a later candidate.

## Release and assets

- Publication and availability: <https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/>.
- Rack source revision: `4b99c934a66ed22d5e8e64677ac1b1aae9330375` in
  `protocodus/reason-rack-extensions`, `Examples/YouKnow`, internal build `1.3.0f4`.
- The published Shop front and rear PNGs are byte-identical to the prepared
  `Release/1.3.0f4/` panels. The manual and thumbnail are copied from that same
  release package. `ASSET_PROVENANCE.json` records source paths and file hashes.
- The existing SoundCloud playlist is explicitly labelled as earlier V1 demos;
  it is not presented as a recording of this release.

## Claims and controls

| Page claim | Release source |
| --- | --- |
| Circuit-modelled oscillator, filter, amplifier and stereo BBD chorus | `README.md`, `Docs/USER_GUIDE.md`, `Docs/DSP_SOURCE.md`, canonical `Instrument/` engine pinned by this revision |
| Saw, pulse, sub and noise; persistent voice states; nonlinear resonant filter; shared ADSR | `Docs/USER_GUIDE.md` and engine/control contracts |
| Chorus I, II and narrow I+II; adjustable chorus hiss | `Docs/USER_GUIDE.md`, `motherboard_def.lua` |
| 100 patches, comprising 99 Protocodus sounds and Init | `Public/`, `Docs/SHOP_COPY.md` |
| Poly 1, Poly 2, Unison and up to 16 voices | `motherboard_def.lua`, `YouKnow.cpp`, `Docs/USER_GUIDE.md` |
| Unit Character saves with the patch; Aging saves with the song | `motherboard_def.lua`, `Docs/USER_GUIDE.md` |
| Tempo-synced LFO rate and delayed onset | `Docs/USER_GUIDE.md`, rear `Sync LFO` property and Rack wrapper |
| Eight CV inputs and 42 custom automated/Remote controls | `motherboard_def.lua`, `Remote/`, `Docs/SHOP_COPY.md` |
| Rear oversampling, saturation, interpolation and solver controls | `motherboard_def.lua`, `GUI2D/`, `Docs/USER_GUIDE.md` |
| Revised model, Unison glide and smooth mode-level transitions in 1.3 | `CHANGELOG.md`, 1.3.0f1 through 1.3.0f4 |

The Rack bank has **100 patches**, not the native plug-in's 144 presets plus Init.
The Rack does not expose the native plug-in's Original/Direct timing menu,
LINE/PHONES load menus or hardware SysEx interface. Those features and the
Gumroad/native-format offer were removed from this page.

## Wording boundaries

Describe modelled mechanisms and their musical effects without claiming a
perfect match to every hardware unit. Component estimates and engineering
choices are not measurements of every original circuit. I+II is a product
extension. Processing quality changes numerical detail and CPU cost.
Reason 14+, macOS and Windows are the advertised Rack platform requirements.
