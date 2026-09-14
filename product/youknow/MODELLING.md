# YouKnow product-page claim sources

Reviewed 2026-09-14 against [protocodus/virtual-instrument-youknow at
12346be](https://github.com/protocodus/virtual-instrument-youknow/tree/12346be1a9a485ae5a07e0ee52074cf427011b88),
the repository's default-branch HEAD at review time. This is the evidence map
for the product page and its homepage teaser, not a competitor ranking.

## Positioning

Market the musical consequences of the implemented model: oscillator history
and individual cards, level-sensitive filter and amplifier behavior, and the
texture and width of clocked bucket-brigade chorus. The page leads with those
benefits and offers the deeper circuit description in native HTML disclosures.

The source README identifies 1.1.0 as unreleased and describes development
packages. This audit verifies the current implementation, not the contents of
the Gumroad downloads. Confirm package parity before publishing new build
claims. The existing platform, sales and Rack Extension availability statements
were retained; the plug-in research is not evidence for Rack Extension parity.
The SoundCloud playlist remains explicitly identified as V1 demos.

## Claims and evidence

Paths and line numbers refer to the pinned instrument source above.

| Public claim | Implementation and supporting evidence |
| --- | --- |
| Shared 8 MHz clock, integer timers, capacitor ramp, comparator pulse and divided sub | `README.md:269–280,314–355`; `Source/DSP/YouKnowEngine.cpp:9627`; `Source/DSP/YouKnowDcoComponents.h:10–56`. Charging current and retained charge are implemented. |
| Six persistent cards, oscillator/sub history, POLY and Solo Unison assignment | `README.md:348–355,1175–1185`; `Source/DSP/YouKnowEngine.cpp:6792–6819,7749`. Pitch is shared-clock based; do not describe independent random DCO detuning. |
| Shared converter scans 23 destinations, with individual holds and smoothing | `README.md:281–309`; `Source/DSP/YouKnowControlDac.h:32`; `Source/DSP/YouKnowEngine.cpp:1442`. Shipping scan timing follows service-chart geometry. |
| Firmware-derived envelopes, gate/retrigger handling, LFO, PWM and glide | `README.md:298–309`; `Source/DSP/YouKnowEngine.cpp:2447–2518,7646–7689,7761`. Independently implemented behavior, not bundled original firmware or cycle-perfect CPU emulation. |
| Diode-based sub response and shared filtered noise source | `README.md:359–389`; `Source/DSP/YouKnowSubLevel.h:12–41`. SUB calibration has held-out hardware checks. The fully coupled sub mixer remains an explicitly calibrated comparison option. |
| Four nonlinear filter stages, resonance compensation, fixed service tuning | `README.md:393–415`; `Source/DSP/YouKnowEngine.cpp:3449`. The filter retains amplitude-dependent frequency movement. |
| Individual six-card filter calibration | `README.md:416–425`; `Source/DSP/YouKnowProductFidelity.h:36`. The reference is one serviced Juno-106 with Borish replacement VCF/VCA cards, not a population of original modules. |
| BA662 signal saturation, service gain and coupled transistor/capacitor control | `README.md:433–453`; `Source/DSP/YouKnowVcaControl.h`; `Source/DSP/YouKnowEngine.h:243–266`. Temperature-dependent response is partial modeling, not full measured device characterization. |
| Unit Character and Aging | `README.md:1187–1218`. Character scales additional seeded variation; the measured filter base stays active at zero. Aging changes filter trims and noise, not DCO pitch. |
| Temperature affects the shared clock and analog paths | `Source/DSP/YouKnowProductFidelity.h:17–29`; `README.md:907–1072`. The shared clock uses a named Murata proxy; the three-second startup is a software choice, not measured original-unit warm-up. |
| Four-position HPF with bass boost, interacting capacitors and switch resistance | `README.md:456–477`; `Source/DSP/YouKnowHighPassSwitch.h`; `Source/DSP/YouKnowProductFidelity.h:14–21`. Product enables the coupled network at 110 ohms; this is a chosen datasheet coordinate, not an installed-switch measurement. |
| Two 256-stage MN3009 chorus lines, opposite modulation, holding, saturation, transfer loss and noise | `README.md:532–579`; `Source/DSP/YouKnowChorus.h:101–113`; `Source/DSP/YouKnowChorus.cpp:1210–1298`. Transfer loss is an aggregate model. Absolute original-unit timing, wet level and noise remain open. |
| Coupled chorus support filters and delayed mute control | `README.md:548–591`; `Source/DSP/YouKnowChorus.cpp:1676–1699`. Shipping uses the coupled two-capacitor mute network; optional three-capacitor clock-stop simulation is not a product claim. The final JFET glide is a software declick policy. |
| Common VCA, loaded output mix/volume, treble roll-off and mono routing | `README.md:467–528`; `Source/DSP/YouKnowOutputJack.h:9–33`. Output magnitude approximates the nominal circuit; do not claim exact output capacitor phase/charge reconstruction. |
| Additional narrower I+II mode | `README.md:537–546,1479–1486`; `Source/DSP/YouKnowChorus.cpp:1775–1786`. Explicit product extension with a mono-fold policy, not a verified third hardware clock mode. |
| 128 original factory tone settings cross-checked across three archives, plus 16 original presets and INIT | `README.md:1286–1295`; `Source/DSP/YouKnowPresets.cpp`; `Tests/YouKnowSysExTests.cpp`. These are parameter states, not sampled audio or a bundled ROM. |
| Hardware-format SysEx import/export | `README.md:1409–1434`; `Source/DSP/YouKnowSysEx.cpp`; `Tests/YouKnowSysExTests.cpp`. Full YouKnow performance settings additionally require a host preset/project. |
| Independent circuit checks and hardware comparisons with held-out settings | `README.md:330–337,359–370,408–425,1129–1149`; `Tools/AnalyzeSubMixerCalibration.py:4–16,32–37`; `Tools/AnalyzeHardwarePwm.py:4–25`; `Docs/hardware-validation.md`. Validation supports specific mechanisms; it is not a whole-instrument fidelity percentage. |

## Boundaries for future copy

- The research explicitly does not establish market leadership. Do not change
  the positioning to “most faithful,” “one of the most faithful,” or “perfect”
  without comparable evidence across other products and multiple identified
  units. See `Docs/modeling-research-2026-09.md:3–7,90–94`.
- Some component values are derived, bounded or selected by ear. Hardware
  comparisons have known source-level and chorus-calibration gaps. The public
  page links the research so those distinctions remain inspectable.
- Only core oscillator phase/sub state is promised to continue between notes.
  Faster numerical modes approximate idle analog-card processing.
- Full instruction-timed firmware replay, explicitly calibrated envelope-hold
  and reset circuits, the fully coupled sub mixer, alternative chorus timings,
  and the three-capacitor clock-mute option are research comparisons. A source
  file existing is not enough to market that path as enabled in the product.

No product source, audio demos, store downloads or deployment settings were
changed by this page revision.
