# Ashline audio

## Original soundtrack

Original music created for Ashline and supplied for use in the game. The five locally hosted MP3s play in this order, returning to the first track after the fifth:

| Track | Local file | Duration | Size |
| --- | --- | --- | --- |
| **Weight of the Iron Sky** | `Weight_Of_The_Iron_Sky.mp3` | 173.37 seconds | 4,167,117 bytes |
| **Before the Fallen Spire** | `Before_the_Fallen_Spire.mp3` | 158.28 seconds | 3,804,747 bytes |
| **Where Giants Fell** | `Where_Giants_Fell.mp3` | 174.39 seconds | 4,191,568 bytes |
| **Throne of Blackened Glass** | `Throne_of_Blackened_Glass.mp3` | 173.45 seconds | 4,168,998 bytes |
| **Vindex Ignis** | `Vindex_Ignis.mp3` | 63.27 seconds | 1,524,570 bytes |

All five tracks are stereo MP3 at 44.1 kHz, verified October 11, 2026. Playback starts after a user gesture, advances when a track ends, and fades out when the game pauses or ends. Pause and music mute retain the current track and playback position for resuming. The existing music volume, combat intensity filter and alert/voice ducking apply to the whole playlist.

SHA-256 file verification:

- `Weight_Of_The_Iron_Sky.mp3`: `54f7810b5151d1d8143d94879c26d519a18c0454dbdfb31b2745b793b9f5ed79`
- `Before_the_Fallen_Spire.mp3`: `d25a2c67ae74d519b74cf9e58de524ec0c949600c47d971fada7296caaf7858c`
- `Where_Giants_Fell.mp3`: `d0f64666f6229efc981c6ffb7476625b29af0d56124a13a6e6649b4357eb3732`
- `Throne_of_Blackened_Glass.mp3`: `ff01366d94e6f474afa3ca6c033550da0f3d66f8901ab804bbed23d1588d2fd7`
- `Vindex_Ignis.mp3`: `33eb5af950b9975a5367c5e426d5fe04b16e67415bfa5cadd77268855fa44910`

## Original generated sound effects

All effects are synthesized in code by `soundbank.js` from noise, oscillators, filters, envelopes and bit reduction, rendered to mono PCM at 24 kHz. No third-party samples or recordings are used, and no voice imitates real speech or an existing franchise. Every recipe has its own seed, so the bank is identical on every load.

- **Interface:** selection, move, attack and harvest orders, rally, control groups, errors, cancellation, construction start and completion, unit ready, shard delivery, sale and repair.
- **Weapons by race:** Organics powder rifles, recon guns, autocannons, tank and siege cannons, rocket launchers, the rail sentry and the rocket battery, with gritty reports and mechanical clanks. AI Unity pulse, rail, laser and FM weapons for the same roles. Each weapon has three variants and slight pitch variation.
- **Impacts and losses:** rocket and heavy-rocket bursts, the artillery landing and incoming whistle, an infantry thud, a robot break-up, a vehicle burst, a small-structure crumble and a building collapse.
- **Alerts:** under-attack klaxon, unit and structure lost, research and upgrade complete, promotion, power loss, reserve and recovery, new, complete and failed objectives, incoming wave, enemy contact, warnings and exploration finished.
- **Abilities:** one cue per ability and race (Dig in / Brace protocol, Long shot / Extended lock, Flare / Sensor probe, Overdrive / Overclock, Afterburner / Sprint, Barrage / Arc barrage, Field patch / Nano-patch).
- **Unit voices and transmissions:** wordless lines for each role and context (select, move, attack, attack-move, harvest, ready, ability, annoyed, transmission). Human crews use squelched radio and two-formant syllables. Vael launcher teams use a lower, growling register. AI Unity uses bit-crushed chirp motifs.
- **Ambient beds:** seamless loops for wind, lava rumble and bubbles, and friendly industry.
- **Result stingers:** longer victory and defeat cues that play while the soundtrack fades out.

The bank renders in a background worker after the first user gesture. A mixer with glue compression, a limiter, ducking and a voice budget keeps large battles controlled. Effects, voices, ambience and music have separate volume controls. Playback begins only after a user gesture, battle sounds pause with the game, and result stingers finish over the result menu.
