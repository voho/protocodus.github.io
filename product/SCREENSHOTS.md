# Product media and claim sources

Reviewed 16 October 2026. The product catalog and instrument details describe
Reason Rack Extensions. Podcare remains a separate podcast production tool.
Product pages cover Rack Extensions and Podcare only; instruments without a
Rack device, such as Taikor and Septum, have no page.

## Current media

| Product | Source | Web media |
| --- | --- | --- |
| YouKnow | Rack 1.3.2 candidate prepared 18 October 2026; exact source build and SHA-256 records in `youknow/ASSET_PROVENANCE.json` | Fresh complete front/rear PNGs, 800 × 800 thumbnail, candidate PDF, 1600 × 1171 rack WebPs and proportional panel/card variants |
| Maremba | Rack 1.5.1f7 release panels and player guide, revision `e2b36073` | `maremba-panel.webp` and `maremba-rear.webp`, 1600 × 1171; card 880 × 644; original front/back PNGs and guide copied from the release |
| Acustra | Current Rack release front/back renders, revision `af1708c8` | `acustra-rack-front.webp` and `acustra-rack-rear.webp`, 1457 × 1200 |
| Electry | Complete Rack renders in `Design/Rendered`, revision `c140bb8f` | `electry-rack-front.webp` and `electry-rack-rear.webp`, 754 × 621 |
| Ceres | Rack 0.1.0b11 development hand-off `dist/Ceres_{Front,Back}.png`, Rack revision `04c38031` | `ceres-rack-front.webp` and `ceres-rack-rear.webp`, 754 × 414 |
| Press78 | Rack 0.1.0b15 panel renders `Docs/screenshots/Press78_{Front,Back}.png`, canonical revision `1f74ad77` | `press78-rack-front.webp` and `press78-rack-rear.webp`, 754 × 552 |
| Lamer Degrader | Existing Rack 1.0.0f9 promotional assets and processed demonstration | Existing panel, rear, mascots and video retained |
| Podcare | Existing repository illustration | Existing card retained |

New WebP conversions preserve the full panel and its aspect ratio. Complete
Rack renders include controls; bare panel backgrounds are not used as interface
screenshots. Source panels and guides can represent a newer development revision
than the version available in the store; store release versions are not inferred
from local source metadata.

## Claim boundaries

The Rack READMEs, exposed properties and active DSP paths establish the marketed
features. The relevant source is under `Examples/<Product>` in the
[Reason Rack Extensions repository](https://github.com/protocodus/reason-rack-extensions).

- YouKnow: nonlinear oscillator/filter/amplifier/chorus path, persistent voice
  states, 100 independently authored Rack patches (99 sounds plus Init), up to
  16 voices (six by default), eight CV inputs and 43 automatable custom controls
  in the latest candidate. Default processing is 1x/Poly/Cubic/Normal solver/
  Normal Circuit Rate; Aging starts at 50% and Sync LFO off. Native Original
  timing, its 144-preset bank, SysEx and output menus are identified separately.
- Acustra: coupled strings, bridge/body response, hand contact, microphones and
  piezo electronics. Four body choices, two active woods, four tunings and eight
  Rack patches follow the exposed edition. Desktop-only features are omitted.
- Electry: eight-string physical model, seven articulations and direct pickup
  output. The Rack edition bypasses the desktop amp/effect chain. CC1 controls
  palm muting; CC2 controls body resonance. No MPE claim is made.
- Maremba: bar/tine modes, nonlinear contact, resonators, sympathetic coupling,
  membranes, Close/Room/Piezo paths, seven audio outputs and 20 Rack patches.
  Drive affects Main; direct captures retain their independent calibration.
- Ceres: four-voice circuit model with Mono/Double layering, mixed sources,
  high-/low-pass filters, filter and amplifier envelopes, SUB and ring
  modulation, velocity response and Sustain I/II, from the Rack README and
  root `SHOP.md` at 0.1.0b11. The page marks the edition and its factory bank
  as in development; no CV inputs are claimed because the device has none.
- Press78: two-operator FM, per-operator envelopes, LFO, chorus and output
  circuit, twelve voices, Note/Gate/FM/Level CV and stereo outputs, from its
  `SHOP.md` at 0.1.0b15. The factory bank is not described: commercial
  redistribution of the imported bank has not been cleared (Press78 README).
- Lamer: genuine MP3/Vorbis encoding and decoding, spectral bit allocation,
  quantization, repeated generations, prefilters and latency-aligned dry/wet.
  Bitrate is a coding target. Encoder changes and Bitrate Crossfade remain
  manual preferences, rather than sequencer-automatable controls.

## Store and demo verification

The [Protocodus Reason Shop catalog](https://www.reasonstudios.com/shop/browse/?developer=Protocodus)
contains [YouKnow](https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/)
and [Maremba](https://www.reasonstudios.com/shop/rack-extension/maremba/).
Other Rack products use “Coming soon!” without invented store URLs.

The [SoundCloud sets page](https://soundcloud.com/protocodus/sets) contains:

| Product | Playlist | Public tracks at review |
| --- | --- | --- |
| YouKnow | [2299308180](https://soundcloud.com/protocodus/sets/youknow-sound-demos-v1) | 7 |
| Maremba | [2308692153](https://soundcloud.com/protocodus/sets/maremba-sound-demos-v1) | 5 |
| Acustra | [2307313401](https://soundcloud.com/protocodus/sets/acustra-sound-demos-v1) | 0; empty player omitted |

Both playable embeds share the original YouKnow dark treatment in the shared
stylesheet: source accent `#03422e`, artwork hidden, nonvisual player, inversion
filter and a forced-colors override. Lamer's existing local video is retained.

## Validation

### YouKnow refresh — 18 October 2026

Only YouKnow's homepage card/social image, product copy, release history and
media are refreshed in this change. The public Reason Shop still lists 1.3.0,
released 13 October 2026; the page labels 1.3.2 as an unreleased Rack candidate.
The 16 October Circuit Rate and VCA calibration changes are identified as later
candidate work rather than features of the 13 October Shop publication.
Native 1.3.2 source and development-package availability remain separate from
Rack acceptance. Native timing gains are not presented as Reason CPU results.
The existing V1 SoundCloud recordings are explicitly labelled as earlier demos.

Raw PNGs and the PDF are copied byte-for-byte from the fresh Rack handoff;
WebPs use Pillow 11.0.0, quality 90 and method 6. Proportional variants use
Lanczos resizing. The square thumbnail keeps the company background, front panel and large
product name, with the official Protocodus logo at the bottom.
The subsequent panel refresh refines control-group centering, label alignment
and padding without changing the controls or sound settings. Separate media
cache keys identify the refreshed source panels. The latest display refresh leaves
both free LFO numeric readouts (RATE and DLY) blank, retains synced note
divisions and descriptive control tooltips, and changes no physical control
law, timing or audio. The front slider spacing update adds a common gap above
slider labels and an even margin below visible sliders, retaining the same
controls and sound settings.
`youknow/ASSET_PROVENANCE.json` retains the older published-media receipt and
records all new input/output hashes, sizes, dimensions and source identity.

### Earlier catalog review — 16 October 2026

The catalog, seven instrument details and availability page were checked at
1440, 768 and 390 pixels wide. Local links/fragments, unique IDs, image paths
and declared image ratios were checked. Existing navigation/background checks
and `git diff --check` pass. The historical development manifest remains at
`releases/2026-10-06.json`; the public releases route now shows Rack availability.
