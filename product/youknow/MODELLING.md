# YouKnow Rack Extension product-page sources

## Current media review — 27 October 2026

The screenshots, thumbnail and proportional WebP variants now match the current
public [Reason Shop gallery](https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/).
The original PNGs match the published 1.3.0f4 artwork byte for byte. The page's
release feature summary reflects its four quality controls and 42 custom
controls; the separate 1.3.2 candidate history remains available below.

The Shop currently lists version 1.3.0 and a release date of 5 October 2026.
The earlier observation of 13 October is retained in the historical receipts,
not used as the current listing date. `ASSET_PROVENANCE.json` records the exact
public image URLs, hashes, dimensions and conversion settings. The existing
1.3.2f4 PDF remains unchanged and is explicitly labelled as a candidate guide.

## Historical feature review — 18 October 2026

The page distinguishes the **published Rack Extension 1.3.0** (13 October 2026)
from the **unreleased 1.3.2 candidate** prepared on 18 October. Publication is
verified against the primary [Reason Shop page](https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/).
At that review, the screenshots and PDF represented the later candidate; their exact
renderer source, bytes, dimensions and conversion settings are recorded in
`ASSET_PROVENANCE.json`. The latest panel refresh refines control-group centering,
label alignment and padding without changing controls or sound settings. Front
slider labels have consistent space below their section lines, and the visible
sliders share an even bottom margin. This does not imply Shop acceptance of the
candidate.

Current source: `protocodus/reason-rack-extensions`, `Examples/YouKnow`, canonical
DSP pin `468710551e68c0393f609135f7926d85c562952c` (1.3.2). The Rack guide,
motherboard, wrapper and current SHOP metadata establish these claims:

- Direct/chart Rack scheduling provides direct Reason MIDI/CV response and a
  one-to-sixteen-voice limit, default six. The native Original performance path
  is a distinct six-voice firmware/serial mode and is not exposed by the Rack UI.
- The Rack bank contains 99 independently authored Protocodus sounds plus Init;
  the separate native bank has 144 presets. Rack SysEx, native timing/output
  menus and native-format installation are not implied by the Rack features.
- The current candidate exposes eight CV inputs and 43 custom controls for
  automation/Remote, alongside standard wheels and sustain. The live 1.3.0 Shop
  copy still describes four quality selectors and 42 custom controls.
- Defaults: 1x oversampling, Poly saturation, Cubic interpolation, Normal solver
  and Normal Circuit Rate. Aging starts at 50%, Sync LFO off, and six voices.
  Unit Character is patch-saved; Aging and processing choices are song-saved.
- The VCA range and reference peak are qualified by note, velocity, host rate,
  default quality, Aging and Volume. They are not a loudness-normalization
  promise. Later calibration/hidden-trim changes can alter older song levels.
- An enabled, nonzero chorus hiss continues with no notes while cabled and
  keeps its processing active. Noise zero/chorus off permits quiet idle rest.
- Both RATE and DLY numeric readouts are blank when Sync LFO is off. They
  show note divisions only when synced. Reason retains descriptive control
  tooltip templates; these are not promised numeric frequency/time displays.
  The readout change leaves physical control laws, timing and audio unchanged.
- The 1.3.2 arithmetic optimization preserves deterministic sample bits;
  native timing comparisons do not establish a Reason-host CPU improvement.

The [native README](https://github.com/protocodus/virtual-instrument-youknow#downloads)
lists macOS universal `.pkg`/manual `.zip`, Windows x64 `.zip` and Linux x64
`.tar.gz` packages. They are development artifacts requiring GitHub sign-in and
expire after 30 days; macOS is ad-hoc signed/not notarized and Windows unsigned.
The primary GitHub Releases page has no published signed/tagged release.
Native formats are VST3, CLAP and standalone on all three platforms, with Audio
Unit on macOS only. No Rack download is described as a native installer or vice
versa. The existing V1 demos are identified as earlier recordings.

## Historical published-page review — 14 October 2026

The earlier page described the released Rack Extension 1.3.0. Its original
published-media/source receipt is retained below for provenance.

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
