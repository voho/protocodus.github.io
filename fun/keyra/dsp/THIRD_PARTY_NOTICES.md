# Third-party notices

## Acoustic reference and numerical calibration

Since 2.0.0 the piano itself (strings, hammers, soundboard, microphones) is a
physical model, `Source/DSP/PianoModel.cpp`: it holds no recording and no
table fitted from one. The recordings below serve three things: the action's
noises, a few constants of the model, and benchmarks. No recorded waveform or
impulse response is loaded by the instrument, and none is in this repository,
a Keyra build or any audio Keyra publishes.

**The action's noises** (keys, dampers and pedal knocks) are numbers fitted
for 1.0.0 and kept: body mode frequencies, decays and levels, knock levels
and phases and band noise densities, in `Source/DSP/Measured*.h`.

Salamander Grand Piano V3 recordings are by **Alexander Holm**, licensed under
[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
The pinned upstream source, original metadata, license and modification record
are retained under `Experiments/Research/GrandPianoV2/reference/`. See
[ATTRIBUTION.md](./SALAMANDER-ATTRIBUTION.md) and
[LICENSE-CC-BY-3.0.txt](./SALAMANDER-CC-BY-3.0.txt).

The grands' action is fitted from these recordings (the set pinned in
`Tools/corpus/salamander-v3.json`), and they are the grand's benchmark
(`Tools/benchmark_recordings.py`). This attribution does not imply
endorsement by the recording author or instrument maker.

The upright's action is fitted the same way from the **Helsinki 1967
Tube-Ribbon Edition** recordings by **Mikko Patama**. Its author permits Keyra
to derive numerical parameters from its recordings provided the recordings
themselves are not distributed (his permission, as the project owner relayed
it on 28 October 2026). `Tools/corpus/helsinki-1967.json` pins the measured
set by SHA256 and `Tools/decode_helsinki.py` reads it from a copy of the
library. This attribution does not imply endorsement by the recording author.

**Constants of the model.** The hammers' stiffness, the strings' losses and
the frame's knock were set against notes of "Steinway Grand" for Decent
Sampler by **Jon Meyer**, from a copy of the library
(`Tools/corpus/hamburg-grand.json` pins the set by SHA256 and
`Tools/decode_hamburg.py` reads it). The upright's hammer stiffness was set
against eleven forte notes of the ENSTDkCl upright in **MAPS** (V. Emiya,
N. Bertin, B. David and R. Badeau, "MAPS: a piano database for multipitch
estimation and automatic transcription of music", Télécom ParisTech, 2010),
licensed under
[CC BY-NC-SA 2.0 FR](https://creativecommons.org/licenses/by-nc-sa/2.0/fr/).
Since 2.1.0 the velocity's law, how steeply the felt stiffens, what the
bridge takes from the upper strings, where the board's radiation begins to
fall and how far apart a pair's channels may be were set against the
Salamander recordings above, and the velocity's law was compared with the
same MAPS upright's notes. Since 2.3.0 how far the iron frame gives under a
blow, and up to what frequency, were set against the Salamander recordings
and against pedal-down notes of "Yamaha C3" for Decent Sampler by
**wesleywilson29** (Pianobook), from a copy of the library
(`Tools/corpus/yamaha-c3.json` pins it by SHA256, and
`Tools/corpus/yamaha-c3-pedal-wash.json` holds the band levels
`Tools/benchmark_pedal_wash.py` compares, no audio). Since 2.4.0 the two
knocks under a note, the top octave's hammers and strings, the close pair's
share of the room and how far the action's noises vary were set against the
Salamander recordings, and the upright's thump against the same MAPS
upright's notes at three loudnesses. From each, a handful
of numbers was compared and a constant chosen; nothing is copied. These
credits do not imply endorsement by the authors or the instruments' makers.

**Benchmarks.** 1.x also measured VCSL Keys' "Grand Piano, K" (Versilian
Studios, CC0 1.0) and "Grandpa's Piano" (David Hawkins, Pianobook) for two
pianos that 2.0.0 no longer has; their corpus pins remain under
`Tools/corpus/`.

Keyra's playing of whole phrases is set beside the openings of thirty
performances of **MAESTRO v3.0.0** (Curtis Hawthorne and others, "Enabling
Factorized Piano Music Modeling and Generation with the MAESTRO Dataset",
ICLR 2019), licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Nothing from the dataset is copied: no recording, MIDI file or excerpt of it
is in this repository, a Keyra build or any audio Keyra publishes.
`Tools/fetch_maestro.py` fetches the openings for measurement and
`Tools/corpus/maestro-v3.json` pins them by SHA256; the differences
`Tools/benchmark_phrases.py` reads are reported as numbers. This credit does not imply endorsement by the dataset's authors,
the performers or the instrument's maker.

## Browser runtime

The browser builds include routines from LLVM, WASI libc and musl. Binaryen generates the JavaScript build. [Runtime licenses](../../oregana/dsp/RUNTIME-LICENSES.txt)
