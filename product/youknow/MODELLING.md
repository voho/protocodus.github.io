# YouKnow product-page claim sources

Reviewed 2026-10-03 against [protocodus/virtual-instrument-youknow at
e75f0bb](https://github.com/protocodus/virtual-instrument-youknow/tree/e75f0bb856e4f6de050187899138c6ca8b1269a8),
the implementation completed on 2026-10-02. This is the evidence map for the
product page and its homepage teaser, not a competitor ranking.

The matching published repository packages are **1.2.0-build.36967735594.1**.
[CI run 36967735594, attempt 1](https://github.com/protocodus/virtual-instrument-youknow/actions/runs/36967735594)
passed against the same source; [refresh commit
9ebd0e64](https://github.com/protocodus/virtual-instrument-youknow/commit/9ebd0e64e4801b22cf073e3b983d08df8f276e54)
committed the packages, checksums and refreshed audio on 2026-10-02.
Its `dist/BUILD.txt` records that source and build identity. The screenshot
remains the current 1360×718 panel: this refresh required no image change,
and the implementation has no panel changes since the prior screenshot.

## Positioning

Market the musical consequences of the implemented model: oscillator history
and individual cards, level-sensitive filter and amplifier behavior, and the
texture and width of clocked bucket-brigade chorus. The page leads with those
benefits and offers the deeper circuit description in native HTML disclosures.

The source README identifies **1.2.0 as development packages**, with no tagged
production release for this version. Matching repository packages are verified
above; this does not verify the files supplied by Gumroad. The CI macOS
installer is unsigned and not notarized, its bundles are ad-hoc signed, and
the Windows binaries are unsigned. Do not label these signed production
installers. The plug-in research does not establish Rack Extension parity.
The SoundCloud playlist remains explicitly identified as V1 demos.

## Claims and evidence

Paths refer to the pinned instrument source above. README section names are
used instead of line numbers so the evidence stays navigable when notes grow.
Product selections are centralized in `Source/DSP/YouKnowProductFidelity.h`;
raw-engine reference defaults and comparison APIs are not automatically
shipping plug-in behavior.

| Public claim | Implementation and supporting evidence |
| --- | --- |
| Shared 8 MHz clock, integer timers, capacitor ramp, comparator pulse and divided sub | `README.md`, **What is modelled → Digital control system / Oscillator**; `Source/DSP/YouKnowEngine.cpp`; `Source/DSP/YouKnowDcoComponents.h`; `Tests/YouKnowDcoCurrentTests.cpp`. Charging current and retained charge are implemented. The shared clock's temperature response uses a named component proxy. |
| Six persistent cards, oscillator/sub history, POLY and Solo Unison assignment | `README.md`, **Voices, character and aging / MIDI**; `Source/DSP/YouKnowEngine.cpp`; `Source/DSP/YouKnowEngine.h`. Six is the hardware default; the VOICES extension supports 1–16. Pitch is shared-clock based; do not describe independent random DCO detuning. |
| Shared converter scans 23 destinations, with individual holds, smoothing and nominal leakage | `README.md`, **What is modelled → Digital control system**, **Juno-106 fidelity research → Control DAC circuitry**; `Source/DSP/YouKnowControlDac.h`; `Source/DSP/YouKnowProductFidelity.h`; `Tests/YouKnowControlDacBufferTests.cpp`. Shipping scan timing follows service-chart geometry; leakage uses typical component values, not an installed-unit measurement. |
| Firmware-derived envelopes, gate/retrigger handling, LFO, PWM and glide | `README.md`, **What is modelled → Digital control system**, **Juno-106 fidelity research → Oscillator and envelope circuit completion**; `Source/DSP/YouKnowEngine.cpp`; `Tests/YouKnowEnvelopeFirmwareTests.cpp`. Ordinary playback independently implements the recovered behavior; it does not run bundled original firmware or full instruction-timed CPU replay. |
| Diode-based sub response, shared filtered noise and retained mixer-coupling charge | `README.md`, **What is modelled → Mixer and noise**; `Source/DSP/YouKnowSubLevel.h`; `Source/DSP/YouKnowProductFidelity.h`; `Tests/YouKnowSawCouplingTests.cpp`. SUB calibration has held-out hardware checks. The product retains the unipolar saw mean until C56/C50 remove it; switching saw, PWM or SUB can move the stored coupling charge. Effective input resistance remains a derived approximation; the fully coupled sub mixer requires explicit comparison calibration. |
| Four nonlinear filter stages, resonance compensation, fixed service tuning | `README.md`, **What is modelled → Filter and voice amplifier**, **Juno-106 fidelity research → Implemented findings**; `Source/DSP/YouKnowEngine.cpp`. The filter retains amplitude-dependent frequency movement, local offsets and temperature-dependent resonance headroom with fixed service adjustment. |
| Individual six-card filter calibration and calibrated pulse/saw balance | `README.md`, **What is modelled → Oscillator / Filter and voice amplifier**; `Source/DSP/YouKnowProductFidelity.h`; `Docs/hardware-validation.md`. The reference is one serviced Juno-106 with original DCOs and Borish replacement VCF/VCA cards. Its pulse/saw calibration and measured filter profile do not establish a population of original modules. |
| BA662 signal saturation, service gain and coupled transistor/capacitor control | `README.md`, **What is modelled → Filter and voice amplifier**; `Source/DSP/YouKnowVcaControl.h`; `Source/DSP/YouKnowEngine.h`; `Tests/YouKnowVcaServiceTests.cpp`; `Tests/YouKnowVcaTemperatureTests.cpp`. C59 coupling follows the inferred fixed service input trim. Temperature-dependent response and amplifier impedance remain conditional models, not complete measured device characterization. |
| Unit Character and Aging | `README.md`, **Voices, character and aging**; `USER_GUIDE.md`, **Shape the sound**. Character scales additional seeded variation; the measured filter base and circuit saturation stay active at zero. Aging defaults to 50% and changes filter trims and noise, not DCO pitch. |
| Temperature affects the shared clock and analog paths | `Source/DSP/YouKnowProductFidelity.h`; `README.md`, **Voice instability and pitch drift / Voices, character and aging**. The shared clock uses a named Murata proxy; the three-second startup is a software choice, not measured original-unit warm-up. |
| Four-position HPF with bass boost, interacting capacitors and switch resistance | `README.md`, **What is modelled → Bus and output**; `Source/DSP/YouKnowHighPassSwitch.h`; `Source/DSP/YouKnowProductFidelity.h`; `Tools/AuditHighPassNetwork.cpp`. Product enables the coupled network at 110 ohms; this is a selected datasheet coordinate, not an installed-switch measurement. |
| Two 256-stage MN3009 chorus lines, opposite modulation, holding, saturation, transfer loss and noise | `README.md`, **What is modelled → Chorus**; `Source/DSP/YouKnowChorus.h`; `Source/DSP/YouKnowChorus.cpp`; `Tests/YouKnowChorusClockIntegrationTests.cpp`; `Tests/YouKnowChorusHalfCycleTests.cpp`. The clock integrates between audio samples and uses complementary input/output phases. Transfer loss is an aggregate model. Chosen sweep and hiss calibrations still leave installed-unit timing, wet level and hiss spectrum unresolved. |
| Coupled chorus support filters with finite, signal-dependent transistor loading | `README.md`, **What is modelled → Chorus**; `Source/DSP/YouKnowProductFidelity.h`; `Source/DSP/YouKnowChorus.cpp`; `Tests/YouKnowChorusFollowerTests.cpp`; `Tests/YouKnowChorusNonlinearTests.cpp`. Shipping selects `Nominal2SA1015Nonlinear`: collector/base currents and mutual loading act inside the capacitor network without compensating output gain. Transistor grade, bias and effective BBD output impedance remain assumptions; circuit-reference agreement does not measure original-unit distortion. |
| Three-capacitor chorus mute and delayed BBD clock stop/restart | `README.md`, **What is modelled → Chorus**; `Source/DSP/YouKnowProductFidelity.h`, `enableChorusClockMuteCircuit`; `Source/DSP/YouKnowChorus.h`; `Tests/YouKnowChorusClockMuteTests.cpp`. C16/C13/C15 and transistor base loading now ship, preserving capacitor and bucket state through interrupted toggles. Timings use nominal junction/rail assumptions. The final JFET's 5 ms glide remains a software declick policy, not measured transition behavior. |
| Common VCA, loaded output mix/volume, treble roll-off, resistor noise and mono routing | `README.md`, **What is modelled → Bus and output**, and **Release history → Unreleased — 2026-10-02**; `Source/DSP/YouKnowOutputJack.h`; `Source/DSP/YouKnowProductFidelity.h`; `Tests/YouKnowCommonVcaOutputTests.cpp`; `Tests/YouKnowOutputSummerMagnitudeTests.cpp`; `Tests/YouKnowOutputSummerMuteTests.cpp`. The common-VCA and final-summer poles retain their nominal audio-band magnitude loss. Delayed wet mute also changes the final summer's resistor noise and bandwidth. Phase, clipping boundaries and switching details remain approximate. |
| OUTPUT settings High/Medium/Low and receiver loading | `USER_GUIDE.md`, **Shape the sound**; `README.md`, **What is modelled → Bus and output**; `Source/DSP/YouKnowOutputNetwork.h`; `Source/PluginProcessor.cpp`; `Source/PluginEditor.cpp`; `Tests/YouKnowOutputNetworkTests.cpp`. Choices are High/Medium/Low plus Open, 10 kΩ, 47 kΩ, 100 kΩ or 1 MΩ; High/Open is the default. Loading changes bass coupling, treble response, level and internal resistor noise, with one shared receiver load in mono. This is a nominal resistive-load magnitude model, not exact phase, selector-contact charge simulation, receiver noise or cable capacitance. Settings persist in sessions and survive tone recalls. |
| Additional narrower I+II mode | `README.md`, **What is modelled → Chorus**, **MIDI → System exclusive**; `Source/DSP/YouKnowChorus.cpp`. Explicit product extension with a summed-rate and mono-fold policy, not a verified third hardware clock mode. Hardware `.syx` stores I+II as Chorus II. |
| 128 original factory tone settings cross-checked across archives, plus 16 original presets and INIT | `README.md`, **Choosing a sound / Original factory bank**; `USER_GUIDE.md`, **Explore the presets**; `Source/DSP/YouKnowPresets.h`; `Source/DSP/YouKnowPresets.cpp`; `Tests/YouKnowSysExTests.cpp`. The 144 sounds comprise 128 archival tones plus eight original basses and eight original pads. These are parameter states, not sampled audio or a bundled ROM. |
| Hardware-format SysEx import/export and full host-session recall | `README.md`, **MIDI → System exclusive**; `USER_GUIDE.md`, **Save and load**; `Source/DSP/YouKnowSysEx.cpp`; `Source/PluginProcessor.cpp`; `Tests/YouKnowSysExTests.cpp`; `Tests/PluginProcessorTests.cpp`. A `.syx` export stores hardware-compatible tone data only; volume, playing controls and extensions require a host preset/project. |
| Preset navigation, graded variation, panic, scalable panel and contextual help | `README.md`, **Interface / Choosing a sound**; `USER_GUIDE.md`, **CPU, help and support**; `Source/PluginEditor.cpp`; `Source/PluginProcessor.cpp`; `Source/DSP/YouKnowPanel.h`. Variation has 1%, 10% and 50% actions. Preset/INIT/variation operations preserve session processing and connection choices. Panic clears held/sustained notes and sounding voices. The 1360×718 opening panel scales from 1200×633 to 2280×1203. |
| macOS, Windows and Linux plug-in/standalone availability | `README.md`, **Download**; `USER_GUIDE.md`, **Install**; `INSTALL_MACOS.md`; `INSTALL_WINDOWS.md`; `INSTALL_LINUX.md`; `CMakeLists.txt`; matched `dist/BUILD.txt`. macOS 11+ universal: AU, VST3, CLAP and standalone. Windows x64: VST3, CLAP and standalone. Linux x86_64: VST3 and standalone, built on Ubuntu 24.04 with compatible libraries required. No documented minimum Windows version or current Rack Extension parity is inferred. |
| Offline use, privacy and customer guidance | `USER_GUIDE.md`, **CPU, help and support**; `PRIVACY.md`; `LICENSE`; `THIRD_PARTY_NOTICES.md`. No activation account, telemetry, automatic update checks or network licensing. The user and platform installation guides document the supplied development packages. Original product code/assets use MIT; dependencies retain their terms. |
| Current musical demos and screenshot | `README.md`, **Audio demos / Musical showcases / Factory preset demos**; `Docs/audio/showcase-manifest.json`; `Docs/screenshots/youknow-standalone.png`; matched refresh commit `9ebd0e64`. Five 24-bit/96 kHz stereo showcases, fifteen factory preset performances, a ten-part composition and mechanism examples demonstrate the current model. V1 SoundCloud recordings remain separately labeled. |
| Independent circuit checks and hardware comparisons with held-out settings | `README.md`, **What is modelled / Juno-106 fidelity research**; `Tools/AnalyzeSubMixerCalibration.py`; `Tools/AnalyzeHardwarePwm.py`; `Docs/hardware-validation.md`. Validation supports specific mechanisms; it is not a whole-instrument fidelity percentage. |

## Boundaries for future copy

- The research explicitly does not establish market leadership. Do not change
  the positioning to “most faithful,” “one of the most faithful,” or “perfect”
  without comparable evidence across other products and multiple identified
  units. See `Docs/modeling-research-2026-09.md`, **Current state**.
- Some component values are derived, bounded or selected by ear. Hardware
  comparisons have known source-level, noise-spectrum and chorus-calibration
  gaps. The public page links the research so those distinctions remain
  inspectable. Nominal transistor-filter and output-network circuit checks do
  not establish a measured match to every original unit.
- Core oscillator phase/sub state continues between notes. Faster numerical
  modes approximate idle analog-card processing. Increasing the voice count
  beyond six is a product extension, not original hardware behavior.
- Full instruction-timed firmware replay, live assigner/voice-board serial
  bridging, explicitly calibrated envelope-hold and reset circuits, the fully
  coupled sub mixer and alternative chorus timings remain comparison APIs.
  Ordinary playback retains the logical host-event adapter without original
  serial-wire latency. A source file existing is not enough to market its
  path as enabled in the product.
- The three-capacitor clock-mute circuit and nominal nonlinear chorus support
  filters are now product selections; they must not remain listed as
  comparison-only features. Their physical calibration boundaries still
  apply, including nominal junctions, follower bias/output impedance and the
  software JFET glide.
- Repository package/source parity above does not verify store fulfillment or
  the separately developed Rack Extension. Keep 1.2.0's development status
  visible and verify sales-download parity before extending those claims.

No product source, store downloads or deployment settings were changed by
this evidence-map revision.
