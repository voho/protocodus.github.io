# Sound sources

This document records the preserved earlier 32-file sound bank. Current
playback uses the 21-file bank described in [SOURCES.md](SOURCES.md); the
manifest preserves receipts for the 19 earlier-only files as inactive assets.

Hedgerow bundles 32 CC0 1.0 sound effects, approximately 597 KiB in total.
No sound is fetched from another website during play. The original procedural
sound remains available when a file fails to load or its codec is unsupported.

## Recordings

| Files | Original recording / pack | Creator | Licence |
| --- | --- | --- | --- |
| `rifle-30-06-*.wav` | Springfield 1917, near microphone; `B_24P.wav` | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney | CC0 1.0 |
| `rifle-762-*.wav` | Mosin Nagant, near microphone; `M_21P.wav` | Same recordists | CC0 1.0 |
| `pistol-45-*.wav` | M1911, near microphone; `A_42P.wav` | Same recordists | CC0 1.0 |
| `smg-9mm-*.wav` | Carl Gustav M45, near microphone; `G_31P.wav` | Same recordists | CC0 1.0 |
| `footstep_*.ogg`, `impact*.ogg` | Impact Sounds 1.0 | Kenney / Kenney Vleugels | CC0 1.0 |
| `cloth*.ogg`, `beltHandle1.ogg`, `metal*.ogg`, `bookFlip1.ogg` | RPG Audio | Kenney / Kenney Vleugels | CC0 1.0 |

The [Free Firearm Sound Library's author listing](https://opengameart.org/content/the-free-firearm-sound-library)
identifies the collection as CC0. Its [preserved master sheet](https://github.com/buddingmonkey/FreeFirearmsSFXLibrary/blob/beb2f4041f3d6740fa0aeaf0e71159bd65a78c1b/Prepared%20Master%20Sheet.csv)
identifies each recording. The source download mirror includes the complete CC0
legal text, retained as `free-firearm-library-CC0.txt`.

These reports are **sound-design ingredients**, not claims of exact recordings
of the game's Garand, Kar98k, Thompson, MP40 or MG42. The runtime combines their
natural attacks with the existing weapon-specific synthesized body, action and
environmental echoes. No modern spoken commands or music are included.

Kenney's original pack licence notices are retained beside the effects. The
creator's [Impact Sounds](https://kenney.nl/assets/impact-sounds) and
[RPG Audio](https://kenney.nl/assets/rpg-audio) listings identify these packs as
CC0; the downloaded copies come from a pinned GitHub mirror. Attribution is
optional under CC0 but is preserved here for traceability.

## Processing and verification

`manifest.json` records every shipped file, creator, original collection,
immutable download URL, licence, edit and SHA-256 checksum, verified on
6 November 2026. Kenney's Ogg files are unmodified. Firearm takes were isolated,
downmixed to mono at 44.1 kHz, DC-centred, peak-normalized to 0.79, faded over
0.5 ms at the start and 30 ms at the end, and encoded as 16-bit PCM WAV. Precise
source offsets and durations are in the manifest. There is no further lossy
encoding of those reports.

`node fun/hedgerow/tests/audio-check.mjs` verifies the shipped checksums, licence
coverage, WAV levels, sample loading fallback, variation, bounded playback and
world-space direction / obstruction behavior.

## Mix

Effects and ambience have separate gains under the master level. Weather ducks
briefly under close gunfire and explosions, then recovers. Gunfire travels at
343 m/s (capped at 0.7 s for distant gameplay cues). Obstructions lower volume
and high frequencies; rear sources also lose some high-frequency detail. The
world query is cached, rather than run per audio sample. Recorded voices are
limited to 48; consecutive events avoid the same take where alternatives exist.
