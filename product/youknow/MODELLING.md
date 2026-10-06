# YouKnow product-page claim sources

Reviewed 6 October 2026 against
[`protocodus/virtual-instrument-youknow` at `73a8e620`](https://github.com/protocodus/virtual-instrument-youknow/tree/73a8e62070983bd5353fa664fd02ae097486453a)
and
[`protocodus/reason-rack-extensions` at `10e44dba`](https://github.com/protocodus/reason-rack-extensions/tree/10e44dbabf9439ff111a69f577ccb01e75eb673a).
This evidence map covers the product page and homepage teaser.

## Positioning and product selection

Lead with the musical consequences of the implemented circuits: oscillator
history, individual filter-card response, signal-dependent resonance and
amplifier saturation, and the width and texture of the clocked BBD chorus.
The page's circuit disclosures connect the control, capacitor, transistor,
noise and output models to their effects on playing and sound.

The plug-in selects `ActiveProductFidelityProfile` through
`Source/DSP/YouKnowActiveProductFidelity.h`. That alias resolves to
`ProductHardwareRealismProfile`; `Source/PluginProcessor.cpp` configures the
engine before preparation and applies the profile to parameter snapshots.
These selections matter: an optional comparison
API or a raw-engine reference default does not establish product availability.
New instances use Original timing and six voices; saved Direct sessions keep
Direct and can use up to sixteen voices. Defaults include Character 100%, Aging 50%,
1x quality, Poly/Cubic and Normal numerical kernels, and LINE High/Open/0 pF.
The TIMING and OUTPUT menus expose the user-selectable paths described below.
The five-change hardware-realism comparison was selected by ear on 5 October;
subsequent component estimates were enabled at the owner’s request. Neither
choice turns unmeasured original-card coordinates into measured calibration.

The source describes 1.2.0 development packages and subsequent source changes.
This audit verifies current source behavior, not the content or publication
status of Gumroad downloads. The existing store CTAs are retained without a
new release claim. The SoundCloud playlist remains labelled V1 demos.

## Plug-in claims and evidence

Paths refer to the pinned standalone repository above. README section names
and source symbols are used rather than historical line numbers.

| Public claim | Active implementation and evidence | Claim boundary |
| --- | --- | --- |
| Shared 8 MHz clock, integer timers, capacitor ramp, comparator pulse and divided sub | `README.md`, “What is modelled / Digital control system” and “Oscillator”; `Source/DSP/YouKnowDcoComponents.h`, `YouKnowDcoReset.h`, and `YouKnowEngine.cpp`. C54 charge and count/CV ordering are stateful. | Compact pitch-table generators approximate the identified ROM within the documented count/CV bounds. The finite-linear reset is the product policy; unknown MC5534A reset curves and parasitic glitches are not measured claims. |
| Six persistent voice-card models and oscillator/sub history | `README.md`, “Voices, character and aging”; `YouKnowEngine.cpp` voice-card state and assignment. The first six cards keep DCO/sub/noise history. | Faster kernels approximate idle analogue-card work. Equal timer counts share one steady pitch; there is no independent DCO-detune generator or measured population phase distribution. |
| Shared converter scans 23 destinations with holds and circuit smoothing | `README.md`, “Digital control system”; `Source/DSP/YouKnowControlDac.h`, `YouKnowVcaControl.h`; product enables converter-hold droop. | Direct intra-pass offsets follow the service chart's geometry, chosen by ear; they are not measured installed timestamps. Leakage magnitudes follow typical sheets with a declared sign convention. |
| Firmware-derived envelopes, LFO, PWM and portamento | `README.md`, “Digital control system” and “Oscillator and envelope circuit completion”; `YouKnowEngine.cpp` and firmware control classes. | Digital laws are resolved for identified firmware images; physical timing against arbitrary hardware units remains unmeasured. Portamento also uses a derived loaded-pot law. |
| Original performance timing and selectable Direct | `README.md`, “Oscillator and envelope circuit completion”; `Source/DSP/YouKnowOriginalPerformance.*`, `YouKnowFirmwareAssignerAudioBridge.*`, `Source/PluginProcessor.cpp` Performance Timing parameter; `Tests/YouKnowOriginalPerformancePluginTests.cpp`. | User-selectable A-5 assigner, module UART and B-2 execution, at nominal clocks with host timestamps declared as DIN frame starts. It uses six voices and hardware tone/velocity resolution; Original is the new-instance default; saved Direct sessions retain Direct. Switching clears notes/tails and costs more CPU. Installed clock/RX phases and whole-hardware latency are not established. |
| Diode sub-level response and transistor noise-level onset | `README.md`, “Mixer and noise”; `Source/DSP/YouKnowSubLevel.h`, `YouKnowNoiseC41.h`, and `YouKnowNoiseCalibration.h`; product enables `enableNoiseLevelSoftJunction`. | SUB has held-out recording checks from one identified unit. Tr22 uses a named typical-part junction and nominal trimmer coordinate; the active product selects the coupled WAVE/Tr19/D6/C56 mixer using its named evidence calibration. |
| Coupling-capacitor transients and interacting WAVE/SUB levels | `ProductHardwareRealismProfile::tryConfigureBeforePrepare` supplies `CoupledSubMixer::evidenceCalibration()`; `YouKnowEngine.cpp` and `YouKnowCoupledMixer.h` solve the coupled WAVE/Tr19/D6/C56 path. | The coupled path is now selected in the product. Named component/source coordinates and comparison evidence do not identify every installed impedance or switching transient. |
| Four nonlinear filter stages and circuit-derived resonance | `README.md`, “Filter and voice amplifier”; `YouKnowEngine.cpp`; product enables `enableResonanceSoftJunction`. | Stages, feedback, fixed service trims and current-dependent response are modeled. The Tr18 low-control junction uses nominal conditional priors; full RES retains the service endpoint. No perfect whole-unit match is claimed. |
| Original voice-module filter tuning | `ProductHardwareRealismProfile::applyTo` selects `useOriginalCardVcfCalibration` and `useBa662AResonanceOffsetEstimate`. | Nominal original-module and BA662A offset coordinates are explicit schematic/component estimates. The serviced #439522 replacement-card fit remains a diagnostic/reference profile, rather than the active product selection. |
| BA662 saturation, Tr20 current control, service gain and temperature response | `YouKnowVcaControl.h`, `YouKnowEngine.cpp`, `YouKnowVoiceVcaAntialias.h`; the active profile enables evidence VCA calibration and junction temperature. | Named Tr20 estimates alter envelope tails and C58 loading. The transistor temperature coefficient and installed transfer limits are conditional estimates; local antialiasing is numerical processing. |
| Circuit resistor and current-dependent transistor noise | `README.md`, “Filter and voice amplifier”; `Source/DSP/YouKnowOtaShotNoise.h`, `YouKnowBa662Noise.h`; product enables OTA, output-mirror and tail-mirror noise. | The model uses Johnson–Nyquist and collector shot-noise physics with independent deterministic streams. BA662 mirror reductions and emitter resistors are declared priors; installed excess/flicker spectra remain open. Character zero keeps the digital-silence contract. |
| Unit Character, Aging and warm-up | `README.md`, “Voices, character and aging” and “Known gaps”; `YouKnowProductFidelity.h` selects the shared-clock temperature proxy. | Character scales additional bounded/voiced tolerances, not measured population statistics. The Murata clock proxy and three-second warm-up are explicit assumptions. Aging changes filter trims and noise, following one documented recalibration; it does not independently detune DCOs. |
| Four-position HPF, bass boost, retained capacitor charge and boost saturation | `README.md`, “Bus and output”; `Source/DSP/YouKnowHighPassSwitch.h`; `ProductFidelityProfile::highPassSwitchOhms`. | Coupled network is active at 110 ohms, a selected datasheet coordinate rather than an installed-switch measurement. Switch charge injection is not modeled. |
| Two 256-stage MN3009 chorus models, opposite clocks, holding, saturation and transfer loss | `ProductHardwareRealismProfile` selects `HardwareEvidence` timing, `ServicedBiasEstimate` transfer and `HoltersParkerJuno60Estimate` insertion gain. | Original-board data support effective Mode-I motion. Mode II uses named component estimates; the +2.3 dB insertion-gain prior comes from a same-chip Juno-60 measurement, not an original-Juno-106 wet-level calibration. |
| Nonlinear chorus followers and coupled support filters | `README.md`, “Chorus”; `ProductFidelityProfile::configureBeforePrepare` selects `Nominal2SA1015Nonlinear`; `YouKnowChorus.cpp`. | Circuit loading and transistor currents are modeled with declared typical-part and source/load assumptions. Numerical error varies with processing quality; independent circuit calculations do not constitute a measured complete original-unit response. |
| Clocked charge-packet hiss calibrated against one original chorus board | `README.md`, “Chorus”; `Source/DSP/YouKnowChorusBucketNoise.h`, product covariance and `IdleFloor439522` noise profile; `Tools/FitChorusBucketNoise.py`, `AnalyzeChorusIdleFloors.py`. | Effective covariance has held-out spectral checks on #439522's original chorus board. Internal storage/transfer strengths are not uniquely identified, and this is not a population noise calibration. |
| Stateful chorus switching and clock stop/restart | `README.md`, “Chorus”; product enables `enableChorusClockMuteCircuit`, `enableChorusFiniteMuteDrive` and `enableChorusFiniteTr5Drive`; `Source/DSP/YouKnowChorusMuteDrive.h`. | The active product jointly solves C16/C13/C15 and finite transistor/JFET drive, retaining bucket/capacitor history. Typical-part gain and cutoff define conditional switching timings; installed transients, charge injection and signal-dependent JFET distortion remain open. The older two-node mute and software fade are raw comparison behavior. |
| Common VCA, mixing, AC coupling, volume and output loading | `README.md`, “Bus and output”; `Source/DSP/YouKnowOutputNetwork.h`, `YouKnowOutputJack.h`; product enables common-VCA/summer magnitude poles and mute-dependent loading. | LINE High/Open/0 pF is the compatible default. User-selectable H/M/L, receiver resistance and cable/input capacitance alter nominal bass, treble and resistor noise. The digital output realization approximates magnitude and phase; unknown receiver values are not inferred. |
| Selectable PHONES amplifier and electrical headphone loads | `README.md`, “Bus and output”; `Source/DSP/YouKnowHeadphoneOutput.h`; OUTPUT parameters in `PluginProcessor.cpp` and menu in `PluginEditor.cpp`. Product enables amplifier dynamics and intrinsic noise. | Declared 32/80/300/600-ohm loads with LINE assumed unplugged. Circuit gain, coupling, source resistance, nominal M5218L bandwidth/slew and noise are modeled; headphone acoustic response and installed amplifier overload are not inferred. |
| Additional I+II chorus mode | `README.md`, “Chorus” and “Instrument-level extensions”; `YouKnowChorus.cpp`. | A narrower mono-fold product extension, not a verified third hardware stereo-clock mode. Hardware-format SysEx stores it as II. |
| 144 presets plus INIT and hardware-format SysEx | `README.md`, “Original factory bank”, “Choosing a sound” and “System exclusive”; `Source/DSP/YouKnowPresets.cpp`, `YouKnowSysEx.cpp`; `Tests/YouKnowSysExTests.cpp`. | 128 original parameter states cross-checked across three archives plus 16 YouKnow sounds. They are settings, not sampled audio or a bundled tone ROM. SysEx carries the hardware tone; complete performance/session settings require a host preset/project. |
| Independent circuit checks and identified hardware comparisons | `README.md`, “What is modelled”, “Juno-106 fidelity research” and “Known gaps”; `Docs/hardware-validation.md`; the named calibration/audit tools above. | Tests qualify particular mechanisms, rates and settings. Neither a whole-instrument fidelity percentage nor perfect equivalence to every hardware unit is established. |

## Rack Extension claims and evidence

The Rack sources are `Examples/YouKnow/README.md`, `Docs/USER_GUIDE.md`,
`motherboard_def.lua`, `info.lua`, `Docs/DSP_SOURCE.md` and
`Docs/RELEASE_EVIDENCE.md` at the pinned Rack repository revision.

- The 1.2.0f1 candidate requires Reason 14+, offers up to 16 voices, eight
  CV inputs and 42 automatable custom controls, plus Reason's standard wheels
  and sustain support.
- Its bank is 99 original Protocodus sounds plus Init. No third-party original
  factory bank is claimed for this edition.
- Rear Sync LFO maps rate and delayed onset to song-tempo note lengths;
  it does not sync the chorus clock or retrigger LFO phase on transport seeks.
- The working adapter directly compiles canonical DSP at `73a8e620` through
  its `Instrument/` submodule and selects the current active circuit profile.
  It retains Rack controls, chart/direct MIDI/CV timing and output calibration,
  rather than the native Original performance adapter or TIMING/OUTPUT menus.
  Current antialiasing latency is 120 samples below 176.4 kHz and 41 above.
  Twenty-six factory pads are adjusted by 0.22–2.00 dB; musical settings and Init
  are unchanged. The retained 1.2.0f1 binary still uses the older copied DSP.
  The new adapter has not been SDK-built or validated in Reason.
- Dist images and manual are the 1.2.0f1 materials from packaging commit
  `9381100b867e3be142c40c3eb4830071c345f46d`. The page calls it a development
  candidate; native validation does not establish Reason Studios acceptance
  or Shop availability.

## Boundaries for future copy

- Use “models”, “circuit-modelled” and named mechanisms to explain realism.
  Avoid “perfect”, whole-unit “exact” equivalence, market leadership or a
  whole-instrument fidelity percentage without evidence for those claims.
- Keep current product selections separate from research comparisons. The
  coupled mixer is now active; configured exponential DCO reset, alternative
  clock/phase assumptions and the step-split chorus solver remain research paths. Original timing and the three-capacitor chorus clock-mute
  circuit are now actual product features and must not be listed as absent.
- Hardware measurements, component-derived calculations, voiced coordinates
  and product policy are different evidence classes. In particular, a
  replacement-card filter fit is not a measurement of original modules, a
  named temperature proxy is not a measured chassis warm-up, and nominal
  clock execution is not a calibrated host-to-hardware latency.
- Core oscillator/sub history is persistent; faster idle-card processing and
  sample-rate-dependent numerical realizations remain disclosed approximations.
- Package, store and host-acceptance statements require their own evidence.
  Source review does not verify a commercial download or acceptance status.

The 6 October Linux build is recorded separately in the release notes.
This page does not establish storefront package parity or Reason acceptance.
