# Tyran sound effects

Every shipped effect comes from a sound library released into the public domain under **Creative Commons CC0 1.0** ([deed](https://creativecommons.org/publicdomain/zero/1.0/)). Attribution is optional; thank you to Kenney, rubberduck and Black Lodge Games. The archives were downloaded on 2026-10-19 from the pages below. Each page states CC0 as its license, and where an archive bundles a license notice it is preserved here.

| Pack | Author | Source page | Archive SHA-256 | Notice |
| --- | --- | --- | --- | --- |
| Sci-fi Sounds 1.0 | Kenney | [kenney.nl/assets/sci-fi-sounds](https://kenney.nl/assets/sci-fi-sounds) | `119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04` | `KENNEY-SCI-FI-LICENSE.txt` |
| Digital Audio | Kenney | [kenney.nl/assets/digital-audio](https://kenney.nl/assets/digital-audio) | `24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06` | `KENNEY-DIGITAL-LICENSE.txt` |
| Impact Sounds 1.0 | Kenney | [kenney.nl/assets/impact-sounds](https://kenney.nl/assets/impact-sounds) | `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8` | `KENNEY-IMPACT-LICENSE.txt` |
| Interface Sounds 1.0 | Kenney | [kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds) | `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232` | `KENNEY-INTERFACE-LICENSE.txt` |
| 25 CC0 bang / firework SFX (field recordings) | rubberduck | [opengameart.org/content/25-cc0-bang-firework-sfx](https://opengameart.org/content/25-cc0-bang-firework-sfx) | `c0c9ecc11e2dc0d190f0cced755569858234b8528286bc83becb6314c663407f` | License field on the page |
| 50 CC0 Sci-Fi SFX | rubberduck | [opengameart.org/content/50-cc0-sci-fi-sfx](https://opengameart.org/content/50-cc0-sci-fi-sfx) | `7824c08e54b5b68d6c70ced9d8fe9e47f86ce19c1d8d47d093e1dc1b579f78ec` | License field on the page |
| 60 CC0 Sci-Fi SFX | rubberduck | [opengameart.org/content/60-cc0-sci-fi-sfx](https://opengameart.org/content/60-cc0-sci-fi-sfx) | `11ebf7d8c4ece445128eeb95c969e0ed36ff34fc2c8ef0e04a154d62e2f938f8` | License field on the page |
| 50 Free SciFi Sound FX | Black Lodge Games | [opengameart.org/content/50-free-scifi-soundfx-192khz-64-bit-24576kbps-wav](https://opengameart.org/content/50-free-scifi-soundfx-192khz-64-bit-24576kbps-wav) | `f0cc620c86546eb6b35019d52cbb17f9693c70ee9b4dd636019ad0a08358de81` | `BLACK-LODGE-README.txt` |

Full archive URLs and checksums are pinned in [`../../../tools/build-sfx.py`](../../../tools/build-sfx.py), which rebuilds every file below byte for byte: `python3 -I fun/tyran/tools/build-sfx.py <download-cache-dir>` (needs FFmpeg with libsoxr and numpy). Each source is folded to mono at 44.1 kHz (high-precision SoX resampling), trimmed so it starts on its first audible sample, cut where it decays into the noise floor or at its cue's length cap, and given click-free fades. The four small explosions and two of the large ones get a low-pass-filtered Kenney low-frequency explosion underneath, so the bright firework recordings land with weight. Variants of a cue are loudness-matched to one another and peak-limited to −1 dBFS, then written as 16-bit PCM WAV with seeded dither. No other creative changes were made. In play, the engine adds positional panning, a little pitch variation on combat sounds and the room reverb on heavy blasts. File checksums are in `SHA256SUMS.txt`.

The previous set shipped 18 Kenney effects at 22,050 Hz and decoded them through a 22,050 Hz context; every other cue was a synthesized beep. All cues now play these recordings at the full rate, and the old synthesizer layers remain only as a stand-in for a file that fails to load.

| Shipped file | Use | Source pack | Archive path | Low-frequency layer (Kenney Sci-fi Sounds) |
| --- | --- | --- | --- | --- |
| `laser-small-1.wav` | Pulse and seeker guns | Kenney Sci-fi Sounds | `Audio/laserSmall_000.ogg` |  |
| `laser-small-2.wav` | Pulse and seeker guns | Kenney Sci-fi Sounds | `Audio/laserSmall_001.ogg` |  |
| `laser-small-3.wav` | Pulse and seeker guns | Kenney Sci-fi Sounds | `Audio/laserSmall_002.ogg` |  |
| `laser-small-4.wav` | Pulse and seeker guns | Kenney Sci-fi Sounds | `Audio/laserSmall_003.ogg` |  |
| `laser-retro-1.wav` | Scatter and arc guns | Kenney Sci-fi Sounds | `Audio/laserRetro_000.ogg` |  |
| `laser-retro-2.wav` | Scatter and arc guns | Kenney Sci-fi Sounds | `Audio/laserRetro_001.ogg` |  |
| `laser-retro-3.wav` | Scatter and arc guns | Kenney Sci-fi Sounds | `Audio/laserRetro_003.ogg` |  |
| `laser-heavy-1.wav` | Lance and plasma guns | Kenney Sci-fi Sounds | `Audio/laserLarge_000.ogg` |  |
| `laser-heavy-2.wav` | Lance and plasma guns | Kenney Sci-fi Sounds | `Audio/laserLarge_001.ogg` |  |
| `laser-heavy-3.wav` | Lance and plasma guns | Kenney Sci-fi Sounds | `Audio/laserLarge_003.ogg` |  |
| `enemy-shot-1.wav` | Hostile fire, small hulls | rubberduck, 60 CC0 Sci-Fi SFX | `sfx_20a.ogg` |  |
| `enemy-shot-2.wav` | Hostile fire, small hulls | rubberduck, 60 CC0 Sci-Fi SFX | `sfx_20b.ogg` |  |
| `enemy-shot-3.wav` | Hostile fire, small hulls | rubberduck, 60 CC0 Sci-Fi SFX | `sfx_20c.ogg` |  |
| `enemy-shot-heavy-1.wav` | Hostile fire, large hulls and guardians | rubberduck, 50 CC0 Sci-Fi SFX | `shoot_01.ogg` |  |
| `enemy-shot-heavy-2.wav` | Hostile fire, large hulls and guardians | rubberduck, 50 CC0 Sci-Fi SFX | `shoot_02.ogg` |  |
| `explosion-1.wav` | Kills | rubberduck, 25 CC0 bang / firework SFX | `bang_01.ogg` | `Audio/lowFrequency_explosion_001.ogg` |
| `explosion-2.wav` | Kills | rubberduck, 25 CC0 bang / firework SFX | `bang_06.ogg` | `Audio/lowFrequency_explosion_001.ogg` |
| `explosion-3.wav` | Kills | rubberduck, 25 CC0 bang / firework SFX | `bang_07.ogg` | `Audio/lowFrequency_explosion_001.ogg` |
| `explosion-4.wav` | Kills | rubberduck, 25 CC0 bang / firework SFX | `bang_09.ogg` | `Audio/lowFrequency_explosion_001.ogg` |
| `explosion-large-1.wav` | Large hulls, guardians, pilot loss, nova | rubberduck, 50 CC0 Sci-Fi SFX | `explosion_01.ogg` |  |
| `explosion-large-2.wav` | Large hulls, guardians, pilot loss, nova | rubberduck, 25 CC0 bang / firework SFX | `cannon_01.ogg` | `Audio/lowFrequency_explosion_000.ogg` |
| `explosion-large-3.wav` | Large hulls, guardians, pilot loss, nova | rubberduck, 25 CC0 bang / firework SFX | `cannon_02.ogg` | `Audio/lowFrequency_explosion_000.ogg` |
| `boom-1.wav` | Low thump under heavy blasts, hull hits, shield collapse, nova | Kenney Sci-fi Sounds | `Audio/lowFrequency_explosion_000.ogg` |  |
| `boom-2.wav` | Low thump under heavy blasts, hull hits, shield collapse, nova | Kenney Sci-fi Sounds | `Audio/lowFrequency_explosion_001.ogg` |  |
| `debris-1.wav` | Debris crackle after heavy blasts | rubberduck, 25 CC0 bang / firework SFX | `fw_03.ogg` |  |
| `impact-1.wav` | Hull damage | Kenney Impact Sounds | `Audio/impactPlate_heavy_001.ogg` |  |
| `impact-2.wav` | Hull damage | Kenney Impact Sounds | `Audio/impactPlate_heavy_003.ogg` |  |
| `impact-3.wav` | Hull damage | Kenney Impact Sounds | `Audio/impactPlate_heavy_004.ogg` |  |
| `shield-hit-1.wav` | Shield absorbs a round | Kenney Impact Sounds | `Audio/impactGlass_light_000.ogg` |  |
| `shield-hit-2.wav` | Shield absorbs a round | Kenney Impact Sounds | `Audio/impactGlass_light_002.ogg` |  |
| `shield-hit-3.wav` | Shield absorbs a round | Kenney Impact Sounds | `Audio/impactGlass_light_004.ogg` |  |
| `deflect-1.wav` | Barrier, sealed armor and drone blocks; kinetic hits | Kenney Impact Sounds | `Audio/impactMetal_light_000.ogg` |  |
| `deflect-2.wav` | Barrier, sealed armor and drone blocks; kinetic hits | Kenney Impact Sounds | `Audio/impactMetal_light_001.ogg` |  |
| `deflect-3.wav` | Barrier, sealed armor and drone blocks; kinetic hits | Kenney Impact Sounds | `Audio/impactMetal_light_002.ogg` |  |
| `shield-break-1.wav` | Shield collapse | Kenney Impact Sounds | `Audio/impactGlass_heavy_000.ogg` |  |
| `shield-break-2.wav` | Shield collapse | Kenney Impact Sounds | `Audio/impactGlass_heavy_002.ogg` |  |
| `glass-break-1.wav` | Barrier broken | Kenney Impact Sounds | `Audio/impactGlass_medium_000.ogg` |  |
| `glass-break-2.wav` | Barrier broken | Kenney Impact Sounds | `Audio/impactGlass_medium_001.ogg` |  |
| `weak-break-1.wav` | Guardian weak point destroyed | Kenney Sci-fi Sounds | `Audio/impactMetal_000.ogg` |  |
| `weak-break-2.wav` | Guardian weak point destroyed | Kenney Sci-fi Sounds | `Audio/impactMetal_003.ogg` |  |
| `shield-up-1.wav` | Shield back online, respawn | Kenney Sci-fi Sounds | `Audio/forceField_002.ogg` |  |
| `pickup-1.wav` | Pickups | Kenney Digital Audio | `Audio/powerUp7.ogg` |  |
| `pickup-2.wav` | Pickups | Kenney Digital Audio | `Audio/powerUp8.ogg` |  |
| `pickup-3.wav` | Pickups | Kenney Digital Audio | `Audio/powerUp9.ogg` |  |
| `purchase-1.wav` | Shop purchase | Kenney Interface Sounds | `Audio/confirmation_003.ogg` |  |
| `purchase-2.wav` | Shop purchase | Kenney Interface Sounds | `Audio/confirmation_001.ogg` |  |
| `weapon-1.wav` | Weapon pickup or purchase | Kenney Digital Audio | `Audio/phaserUp6.ogg` |  |
| `weapon-2.wav` | Weapon pickup or purchase | Kenney Digital Audio | `Audio/phaserUp2.ogg` |  |
| `power-up-1.wav` | Power level up, challenge result | Kenney Digital Audio | `Audio/powerUp11.ogg` |  |
| `power-up-2.wav` | Power level up, challenge result | Kenney Digital Audio | `Audio/powerUp12.ogg` |  |
| `drone-1.wav` | Wing drone joins | Kenney Digital Audio | `Audio/phaseJump3.ogg` |  |
| `drone-2.wav` | Wing drone joins | Kenney Digital Audio | `Audio/phaseJump5.ogg` |  |
| `extra-life-1.wav` | Extra ship | Kenney Digital Audio | `Audio/powerUp1.ogg` |  |
| `power-down-1.wav` | Power lost, pilot captured | Kenney Digital Audio | `Audio/phaserDown1.ogg` |  |
| `power-down-2.wav` | Power lost, pilot captured | Kenney Digital Audio | `Audio/phaserDown3.ogg` |  |
| `rescue-1.wav` | Captured pilot rescued | Kenney Digital Audio | `Audio/powerUp10.ogg` |  |
| `bonus-1.wav` | Squadron wiped, formation broken | Kenney Digital Audio | `Audio/powerUp4.ogg` |  |
| `bonus-2.wav` | Squadron wiped, formation broken | Kenney Digital Audio | `Audio/powerUp5.ogg` |  |
| `ace-1.wav` | Ace downed, perfect challenge | Kenney Digital Audio | `Audio/powerUp3.ogg` |  |
| `combo-1.wav` | Kill chain (pitch rises with the chain) | Kenney Digital Audio | `Audio/pepSound1.ogg` |  |
| `combo-2.wav` | Kill chain (pitch rises with the chain) | Kenney Digital Audio | `Audio/pepSound3.ogg` |  |
| `alarm-1.wav` | Guardian klaxon | Black Lodge Games, 50 Free SciFi SFX | `50-Free-SciFi-SFX-blacklodgegames.com/blg_warning_alarm_01.wav` |  |
| `alert-1.wav` | Midboss, captor and hazard encounters | Black Lodge Games, 50 Free SciFi SFX | `50-Free-SciFi-SFX-blacklodgegames.com/blg_warning_alarm_02.wav` |  |
| `hull-alarm-1.wav` | Critical-hull two-tone alarm | Kenney Interface Sounds | `Audio/error_004.ogg` |  |
| `boss-open-1.wav` | Guardian armor opens | Kenney Sci-fi Sounds | `Audio/doorOpen_001.ogg` |  |
| `boss-close-1.wav` | Guardian armor closes | Kenney Sci-fi Sounds | `Audio/doorClose_001.ogg` |  |
| `notify-1.wav` | New wave, convoy and bonus-flight encounters | Kenney Interface Sounds | `Audio/question_003.ogg` |  |
| `challenge-1.wav` | Challenging stage begins | Kenney Digital Audio | `Audio/zapThreeToneUp.ogg` |  |
| `objective-1.wav` | Objective complete | Kenney Interface Sounds | `Audio/confirmation_002.ogg` |  |
| `checkpoint-1.wav` | Checkpoint reached | Kenney Interface Sounds | `Audio/confirmation_004.ogg` |  |
| `split-1.wav` | Enemy splits | Kenney Digital Audio | `Audio/phaseJump1.ogg` |  |
| `dive-1.wav` | Diving attacker | Kenney Digital Audio | `Audio/highDown.ogg` |  |
| `tractor-charge-1.wav` | Tractor beam charges | Black Lodge Games, 50 Free SciFi SFX | `50-Free-SciFi-SFX-blacklodgegames.com/blg_energy_field_03.wav` |  |
| `tractor-1.wav` | Tractor beam (looped) | Kenney Sci-fi Sounds | `Audio/forceField_000.ogg` |  |
| `respawn-1.wav` | Pilot respawns | rubberduck, 50 CC0 Sci-Fi SFX | `teleport_01.ogg` |  |
| `beam-charge-1.wav` | Guardian beam charges | Black Lodge Games, 50 Free SciFi SFX | `50-Free-SciFi-SFX-blacklodgegames.com/blg_beam_02.wav` |  |
| `beam-1.wav` | Guardian beam fires | Black Lodge Games, 50 Free SciFi SFX | `50-Free-SciFi-SFX-blacklodgegames.com/blg_beam_01.wav` |  |
| `graze-1.wav` | Graze tick (pitch climbs on a streak) | Kenney Interface Sounds | `Audio/tick_002.ogg` |  |
