# Product media and claim sources

Reviewed on 6 October 2026. The existing instrument order is retained, with Septum added before Podcare. Product pages link the current development release record.

Instrument images are authentic editor captures or assembled Rack Extension panels. Every WebP shows the complete interface, with its aspect ratio retained. YouKnow, Acustra and Septum editor images use `20261006`. Retained images and guides keep their previous cache keys; the shared stylesheet uses `20261006-instrument-releases`.

## Current media

| Product | Source at this review | Full source dimensions | Homepage WebP |
| --- | --- | --- | --- |
| YouKnow plug-in | Fresh editor snapshot from [73a8e620](https://github.com/protocodus/virtual-instrument-youknow/tree/73a8e62070983bd5353fa664fd02ae097486453a), via `YOUKNOW_EDITOR_SNAPSHOT` | 1360 × 747 | 880 × 483 |
| Electry | [Current editor capture](https://github.com/protocodus/virtual-instrument-electry/blob/6dacb95e00b63181eae3de94eb933dc52e945428/Docs/screenshots/electry-standalone.png) and implementation at 6dacb95e; the latest changes after the capture harden the processor without changing the editor | 1180 × 910 | 880 × 679 |
| Acustra | Fresh editor snapshot from [c321d7d7](https://github.com/protocodus/virtual-instrument-acustra/tree/c321d7d7d900fa8fb05f498864072b84767ab8d2), via `ACUSTRA_EDITOR_SNAPSHOT`; includes the current six-string fretboard | 1120 × 980 | 880 × 770 |
| Taikor | [Current generated editor capture at 5483f0c6](https://github.com/protocodus/virtual-instrument-taikor/blob/5483f0c6bd8c3de712df949acdfe5112a0dc977e/Docs/screenshots/taikor-standalone.png), refreshed from implementation 16910078f94d | 1280 × 920 | 880 × 633 |
| YouKnow Rack Extension | Authentic 1.2.0f1 front, back, thumbnail and manual from [packaged assets at 9381100b](https://github.com/protocodus/reason-rack-extensions/tree/9381100b867e3be142c40c3eb4830071c345f46d/dist), inspected at Rack source [efc0d78a](https://github.com/protocodus/reason-rack-extensions/tree/efc0d78aa0f87a5d15612640805d27e1d279dbd0) | 1600 × 1171; site panel 1400 × 1025 | YouKnow’s homepage uses the plug-in |
| Maremba Rack Extension | Authentic 1.4.0f6 front, back and thumbnail from [current dist assets](https://github.com/protocodus/reason-rack-extensions/tree/efc0d78aa0f87a5d15612640805d27e1d279dbd0/dist); current HD composites verified against the distributed PNGs | 1600 × 1171; site panels 1400 × 1025 | 880 × 644 |
| Septum | Fresh editor snapshot from [39b24e5a](https://github.com/protocodus/virtual-instrument-septum/tree/39b24e5ab723e3cb1b306f31987552504079df89), via `SEPTUM_EDITOR_SNAPSHOT` | 1960 × 1206 | 880 × 541 |
| Podcare | Existing [repository illustration at c5f5539d](https://github.com/voho/podcare/blob/c5f5539d1554de8c3284026a4bacbc37dfb99cf5/logo.png); unchanged in this instrument refresh | 1080 × 616 | Existing illustration |

The Rack Extension panels are assembled from their real artwork and controls. The conceptual Maremba Shop hero is not used as an interface image. Rack candidates retain their development availability statements.

WebPs were encoded with Pillow and method 6: quality 90 for refreshed YouKnow, Acustra and Septum; retained Electry/Taikor use 92 and Maremba uses 90. Homepage variants use Lanczos resizing to 880 pixels wide. HTML dimensions, `srcset` widths, accessible descriptions and full-size links follow the refreshed assets. YouKnow’s plug-in image is now 747 pixels high rather than 718, including the current monitor, timing and output-connection menus.

### Acustra snapshot

Build `AcustraPluginProcessorTests` in the current Acustra source, then run it with `ACUSTRA_EDITOR_SNAPSHOT` set to an absolute PNG path. The editor renders without an audio device. This review’s source PNG SHA-256 is `d0e44df22347a04f49713cdeaeeb99d7a313ac7a9afdcdb5cbf5a23311c8e890`.

The harness rendered the current default editor and its size/state variants successfully. Its processor suite still reports the pre-existing strum-onset boundary assertion documented by the environment setup; this review build is not described as passing that suite.

### Player guides

YouKnow’s manual is copied exactly from the 1.2.0f1 package. SHA-256: `c703f89f4fa303d04b0b9ad377334da75ceda8803c84d67bc4521c5bd127b199`.

Maremba’s retained distribution PDF still described f3. The website guide was regenerated from the current [source player guide](https://github.com/protocodus/reason-rack-extensions/blob/efc0d78aa0f87a5d15612640805d27e1d279dbd0/Examples/Maremba/docs/USER_GUIDE.md) and authentic f6 panels, with the source renderer staged outside the instrument repo and its page layout adjusted to fit the expanded text. It remains eight pages and correctly describes the independent direct outputs. SHA-256: `9c407e5e28e8eafb8fe80b0519ee0fbccc039915933ff1f4be40c8e53ffcc79e`. The source repo and retained release packages are unchanged.

## Claim evidence

Descriptions lead with the audible consequences of the active models. The source READMEs, current implementation, accepted listening decisions and playing guides establish each claim; historical experiments are checked against the shipping/default or explicitly selectable path.

| Instrument | Feature evidence and wording boundaries |
| --- | --- |
| YouKnow | [Detailed page evidence map](youknow/MODELLING.md), current `ActiveProductFidelityProfile` / `ProductHardwareRealismProfile`, oscillator, control-DAC, filter/VCA, chorus and output models. New instances use six-voice Original timing; saved Direct states keep Direct and can use up to 16 voices. Original-module filter coordinates, Mode-II timing and same-chip insertion gain are named estimates, not newly measured original-unit calibration. |
| Electry | Current `README.md`, `Source/DSP/ElectryEngine.*` and `ElectryFx.*`: two-plane string vibration and losses, finite pick/finger contact, fret/bridge/hand state, magnetic pickup response, circuit-derived pedal and amp stages, cabinet voicing and effects. Amp families are original voices informed by circuits; the page does not claim exact named-amplifier replication. |
| Acustra | Current `README.md`, accepted `Docs/decisions.md`, `Source/DSP/AcustraEngine.*`, processor and editor: steel strings, contact/release, passive measured bridge and body, voiced chords/connected transitions, microphone radiation, piezo circuit and studio room. Room and Release Noise are host parameters beyond the visible panel. The Bellido measured classical body is also steel-strung in this instrument; retired Nylon/Cedar and rejected model experiments are not marketed. |
| Taikor | Current `Source/DSP` membrane, `BachiModel`, `CoupledCavity`, `ShellBoundary`, `TaikoEngine`, `EnsembleEngine` and `IRReverb`, with the physical-realism decision records. Shipping bachi are wooden across Hardness. Hits use no recorded drum samples; room convolution does use impulse responses. Front/rear heads, shell/air interactions and player variation are implemented. |
| Maremba | Current DSP, player guide, physical-model/capture references and f5/f6 evidence. The subsequent Kalimba bridge correction supplies signed reactions from the yielding mount and remains unbuilt in the SDK. Seven tuning choices include equal temperament. Rolls apply to wooden instruments; the Kalimba wheel covers sound holes. Direct captures have their own calibration and omit main Volume and capture Level controls. |

Existing Electry and YouKnow plug-in sales links are retained; storefront package parity is not inferred from repository state. Taikor uses a contact action because the previous site audit recorded no Gumroad listing. Acustra also uses contact, and Maremba’s primary action remains the player guide.

For later refreshes, inspect current upstream bytes and active code paths, preserve image aspect ratios, update cache keys and declared dimensions, and check the homepage and all six product pages at desktop, tablet and phone widths, including Septum and the release page.

## 6 October build record

[Development release notes](releases/index.html) record the five Linux versions,
source revisions and unreleased Rack changes. Acustra retains its known chord-onset
processor assertion. Rack universal builds stop at the missing licensed SDK.
Store downloads and archived Rack images/manuals are not inferred to contain the
new source. Packaging checks and hashes are in `releases/2026-10-06.json`.
