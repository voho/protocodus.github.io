# Product media and claim sources

Product images reviewed 27 October 2026 against the current public Reason Shop
galleries. The product catalog and instrument details describe
Reason Rack Extensions. Podcare remains a separate podcast production tool.
Product pages cover Rack Extensions and Podcare only; instruments without a
Rack device, such as Septum, have no page.

## Current media

| Product | Source | Web media |
| --- | --- | --- |
| YouKnow | Public Shop listing 1.3.0; current gallery rear prints 1.3.0f4. Exact URLs and SHA-256 records are in `youknow/ASSET_PROVENANCE.json`. | Complete front/rear PNGs and rack WebPs, 1600 × 1171; 800 × 800 public Shop thumbnail; proportional panel/rear/card aliases. The earlier 1.3.2f4 candidate PDF is unchanged. |
| Maremba | Public Shop listing 1.5.0; current gallery rear prints 1.5.7f5. Exact URLs and SHA-256 records are in `maremba/ASSET_PROVENANCE.json`. | Complete front/rear PNGs and WebPs, 1600 × 1171; card 880 × 644; exact 800 × 800 public Shop thumbnail. The earlier 1.5.1f7 player guide is unchanged. |
| Acustra | Public Shop listing 1.3.2; current gallery rear prints 1.9.0d2. Exact URLs and SHA-256 records are in `acustra/ASSET_PROVENANCE.json`. | Complete front/rear PNGs and rack/panel/rear WebP aliases, 1457 × 1200; card 880 × 725. The existing quick-start PDF is unchanged. |
| Electry | Unchanged complete Rack renders in `Design/Rendered`, revision `c140bb8f`; earlier candidate media retained. | `electry-rack-front.webp` and `electry-rack-rear.webp`, 754 × 621 |
| Ceres | Unchanged Rack 1.0.0f1 first-public-release candidate prepared 23 October 2026; exact release sources, default panel state and SHA-256 records in [`ceres/ASSET_PROVENANCE.json`](ceres/ASSET_PROVENANCE.json). | Complete front/back PNGs and matching WebPs, 754 × 414; 800 × 800 thumbnail; four-page candidate player guide |
| Press78 | Unchanged Rack 0.1.0b15 panel renders `Docs/screenshots/Press78_{Front,Back}.png`, canonical revision `1f74ad77`; earlier candidate media retained. | `press78-rack-front.webp` and `press78-rack-rear.webp`, 754 × 552 |
| Aculele | Rack 0.2.0d2 development panel previews from `Examples/Aculele/Design/render_panels.py --review`, branch revision `e769e2e5`; no SDK build. Records in [`aculele/ASSET_PROVENANCE.json`](aculele/ASSET_PROVENANCE.json). | `aculele-rack-front.webp` and `aculele-rack-rear.webp`, 1508 × 1104; 800 × 800 thumbnail |
| Respira | Rack 0.1.0d1 final first-pass panel previews committed in `Examples/Respira/Docs/screenshots/`, main revision `28707b7f`; no SDK build. Records in [`respira/ASSET_PROVENANCE.json`](respira/ASSET_PROVENANCE.json). | `respira-rack-front.webp` and `respira-rack-rear.webp`, 1508 × 552; 800 × 800 thumbnail |
| Aculyre | Rack 0.4.0d1 development panel previews from `Examples/Aculyre/Design/render_panels.py`, branch revision `2ecab2ac`; no SDK build. Records in [`aculyre/ASSET_PROVENANCE.json`](aculyre/ASSET_PROVENANCE.json). | `aculyre-rack-front.webp` and `aculyre-rack-rear.webp`, 1508 × 828; 800 × 800 thumbnail |
| Lamer Degrader | Public Shop listing 1.0.0; existing full front/rear PNGs and thumbnail verified byte-for-byte against current public Shop originals. Exact URLs and hashes are in `lamer/ASSET_PROVENANCE.json`. | Complete front/rear PNGs and WebPs, 1600 × 293; 800 × 800 thumbnail. Existing mascots, poster and demonstration video retained. |
| Podcare | Existing repository illustration | Existing card retained |

Released-product panel PNGs and the Shop thumbnails used on this site are exact
copies of the current public Shop originals. Updated WebP conversions preserve
the complete panel and its aspect ratio, using quality 90 and method 6;
proportional size changes use Lanczos resizing. Complete Rack panels include
controls; bare panel backgrounds are not used as interface screenshots.

The current public gallery artwork for Maremba and Acustra prints a newer build
than each product's public version listing. Matching those published gallery
images does not verify publication of a newer downloadable binary: the release
listings remain 1.5.0 and 1.3.2 respectively. No release version is inferred from
an image caption or local source metadata.

This image refresh leaves every PDF at its earlier revision, including YouKnow's
1.3.2f4 candidate guide. Earlier source receipts remain in each product's
provenance record. Upcoming Ceres, Electry and Press78 media and page claims are
unchanged; their retained candidate panels do not advertise the latest local
development builds as Shop releases. Detailed model research and earlier
validation below retain their original revision scope.

## Claim boundaries

The following notes retain the earlier model research and candidate claim
boundaries; candidate-only features are not evidence of Shop publication.
The Rack READMEs, exposed properties and active DSP paths establish the described
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
- Ceres: 1.0.0f1 circuit-modelled Rack candidate for Reason 14 or later,
  with 1–16 voices per layer, Mono/Double layering, mixed saw/pulse/sine/noise
  sources, resonant high-/low-pass filters, filter and amplifier envelopes,
  PWM, SUB and ring modulation, velocity response and Sustain I/II. Front
  BRILLIANCE/RESONANCE levers and rear EXT IN support tonal control and external
  audio modulation; no CV inputs are claimed. The 6RU edition has 23 accepted
  patches: 13 labelled Classic Estimates, nine modern basses/plucks/pads and
  Init. Classic patches project the original table through the available Rack
  controls; no measured hardware-equivalence claim is made. Voice count and
  1x/2x/4x quality are saved with the patch; Init uses four voices, Mono and 1x.
  Stereo-linked final sample-peak protection has a −1 dBFS ceiling, immediate
  attack and 50 ms recovery, without added latency or makeup gain. Native
  timing results do not establish a Reason CPU-meter improvement. The page
  labels this as a forthcoming candidate: Reason Shop acceptance and publication
  are pending, with no public U45 download. Feature authority is recorded in
  `ceres/ASSET_PROVENANCE.json`, including the release player guide, parameter
  manifest, accepted bank comparison and output-protection source.
- Press78: two-operator FM, per-operator envelopes, LFO, chorus and output
  circuit, twelve voices, Note/Gate/FM/Level CV and stereo outputs, from its
  `SHOP.md` at 0.1.0b15. The factory bank is not described: commercial
  redistribution of the imported bank has not been cleared (Press78 README).
- Aculele: soprano, concert and tenor bodies; spruce, mahogany or maple;
  nylon or fluorocarbon strings in standard (re-entrant), Low G or D tuning;
  finger, pick, thumb and strum playing with keyswitched strokes; stereo mic,
  mono mic and piezo capture; a direct piezo output; Note/Gate CV; rear
  oversampling; seven factory patches; from the Rack README at 0.2.0d2 and the
  canonical README. Body dimensions are described as published, not measured;
  no other manufacturer's name appears on the page.
- Respira: the mod wheel as the hand on the bellows, nothing sounding without
  air, simulated steel reeds in their own chambers, eight registers over five
  ranks, Assist, Air, the split keyboard's bass and chord buttons, pitch bend,
  Momentum and oversampling on the rear, a dry stereo output and eight register patches plus
  Init, from the Rack README at 0.1.0d1 and the canonical README.
- Aculyre: one bridge bar on a modal soundbox so idle strings ring in sympathy,
  a 16-string steel or nylon lyre harp and a six-string gut lyre with a 20 ms
  crossfade between them, finger/nail/pick, pluck position and angle, release,
  mute, sympathy, sharping levers, the live string display, rear oversampling,
  Note/Gate CV, stereo outputs and eight factory patches, from the Rack README
  at 0.4.0d1 and the canonical README.
- None of the three has been built with the Jukebox SDK or loaded in Reason.
  Their pages name no Reason version, no CPU figure and no sound claim beyond
  what the models do; requirements and banks are confirmed at release.
- Lamer: genuine MP3/Vorbis encoding and decoding, spectral bit allocation,
  quantization, repeated generations, prefilters and latency-aligned dry/wet.
  Bitrate is a coding target. Encoder changes and Bitrate Crossfade remain
  manual preferences, rather than sequencer-automatable controls.

## Store and demo verification

The [Protocodus Reason Shop catalog](https://www.reasonstudios.com/shop/browse/?developer=Protocodus)
lists four published products: [YouKnow](https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/),
[Maremba](https://www.reasonstudios.com/shop/rack-extension/maremba/),
[Acustra](https://www.reasonstudios.com/shop/rack-extension/acustra-acoustic-guitar/)
and [Lamer Degrader](https://www.reasonstudios.com/shop/rack-extension/lamer-degrader/).
Ceres, Electry and Press78 retain their upcoming-product status; Aculele, Respira
and Aculyre join them as coming soon.

The following [SoundCloud sets page](https://soundcloud.com/protocodus/sets)
observations are retained from the 16 October review; audio and video were not
refreshed or reverified in this image update:

| Product | Playlist | Public tracks at review |
| --- | --- | --- |
| YouKnow | [2299308180](https://soundcloud.com/protocodus/sets/youknow-sound-demos-v1) | 7 |
| Maremba | [2308692153](https://soundcloud.com/protocodus/sets/maremba-sound-demos-v1) | 5 |
| Acustra | [2307313401](https://soundcloud.com/protocodus/sets/acustra-sound-demos-v1) | 0; empty player omitted |

Both playable embeds share the original YouKnow dark treatment in the shared
stylesheet: source accent `#03422e`, artwork hidden, nonvisual player, inversion
filter and a forced-colors override. Lamer's existing local video is retained.

## Validation history

### Aculele, Respira and Aculyre coming soon — 27 October 2026

Three coming-soon catalog cards, product pages and availability rows are added.
Their panels are 2x development previews rendered by each device's own panel
renderer from the revisions in its `ASSET_PROVENANCE.json`, converted to WebP at
quality 90 and method 6 without cropping. Each 800 × 800 thumbnail follows the
Shop thumbnail layout (the front panel on the Protocodus background, the name in
the panel's lettering with its RE pair at half opacity, a one-line description,
the Protocodus logo at the bottom); the thumbnails also serve as the pages'
social images. The panels were rendered while each instrument's first pass was
still under way; they are replaced once each first pass is done.

### Public Shop media review — 27 October 2026

Current public Shop HTML supplies the front/rear gallery and thumbnail URLs.
Exact downloaded PNG hashes, dimensions and source URLs are recorded in the four
released products' `ASSET_PROVENANCE.json` files. YouKnow, Maremba and Acustra
panels and their proportional aliases now follow those public images. Lamer's
existing PNGs and thumbnail already match the current Shop originals and retain
their bytes. Existing PDF, audio and video files are outside this refresh.

The sections below describe their dated revisions, including superseded media;
they are historical records rather than claims about the current image files.

### Ceres first-release candidate — 23 October 2026

Only Ceres's catalog card, product page, availability row and matching media
change. Version 1.0.0f1 remains a candidate pending Reason Shop acceptance and
publication. The source handoff is `Examples/Ceres/Release/1.0.0f1/` in the Rack
repository; all source paths and the engine revision are recorded in
[`ceres/ASSET_PROVENANCE.json`](ceres/ASSET_PROVENANCE.json).

The three PNGs and player-guide PDF are exact release-material copies. Front
and back panels show Init in Mono, four voices per layer and 1x quality; the rear
prints 1.0.0f1. Both WebPs preserve the complete 754 × 414 panels, converted at
quality 90 and method 6. The thumbnail is 800 × 800. The accepted 23-patch bank
retains all 1,518 saved control values, including its output trims; earlier
calibration on the 0.6.1 engine is not a current-level claim.

| Ceres web asset | Verified SHA-256 |
| --- | --- |
| [`Ceres_Front.png`](ceres/Ceres_Front.png) | `c8269ea6b55d8463b1f5194280663363ce6f99c8f8d54cabb42b53599b470f91` |
| [`Ceres_Back.png`](ceres/Ceres_Back.png) | `f31f550b09afc9625d15f8a2359fd2cb680b6fe6e716cd1f7fa26c85974a0c75` |
| [`Ceres_Thumbnail_800.png`](ceres/Ceres_Thumbnail_800.png) | `299dca08001bfb8b162894a2b19543bee66889f5b363424ae46b85e792b570e1` |
| [`Ceres_User_Guide.pdf`](ceres/Ceres_User_Guide.pdf) | `8b32fb060d4b761aefee65bd955ce5b4bd7abfd1c6c3e255380f34cdd4b0aa16` |
| [`ceres-rack-front.webp`](ceres/ceres-rack-front.webp) | `6674d8bbc13b775a70a040918a3be0306e3c25c71a6081469fe7e954d0757b26` |
| [`ceres-rack-rear.webp`](ceres/ceres-rack-rear.webp) | `1cc3872409f11162a5ca1af6ef3323beb3a3f5afe33748989af6e1f33910371e` |

The scoped `ceres/.gitattributes` marks PDFs as binary. A fresh Git checkout
with `core.autocrlf=true` preserves the guide's exact bytes and valid xref
offsets. Local references and fragments, all asset hashes, desktop/mobile
layout, navigation/background checks and `git diff --check` pass. Public U45
artifacts are not distributed by this site.

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
