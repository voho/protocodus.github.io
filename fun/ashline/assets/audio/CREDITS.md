# Ashline audio

## Soundtrack

- **Space Adventure**, by **MintoDog**, published January 8, 2025.
- Local file: `space-adventure.mp3` (original file, renamed only).
- File verification: 5,214,163 bytes; 130.29 seconds; stereo MP3 at 44.1 kHz; SHA-256 `d778093ed7e826b8ad604f489cda3675b2d8203576d906a0d2553cfe20f0a93f`.
- Creator's upload and license: https://opengameart.org/content/space-adventure
- Original download: https://opengameart.org/sites/default/files/space_adventure_bpm140.mp3
- License: **CC0 1.0 Universal (public domain dedication)**, https://creativecommons.org/publicdomain/zero/1.0/
- Verified September 5, 2026: the creator's upload lists **CC0** under License(s), describes the track as synthwave, and states it is loopable. The music is hosted locally; gameplay does not contact OpenGameArt.
- Courtesy credit: Music: “Space Adventure” by MintoDog (CC0).

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
