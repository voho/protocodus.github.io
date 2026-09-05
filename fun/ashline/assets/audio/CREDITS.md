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

`audio.js` synthesizes Ashline's effects as short mono PCM buffers when the player first enables audio. No third-party samples or recordings are used. Noise transients, filtered rumble, pitched mechanical tails, and enveloped tones distinguish rifle bursts, recon fire, tank fire, artillery, and explosions. Separate cues cover selection, orders, errors, construction start/completion, trained units, mineral delivery, victory, and defeat.

The buffers are reused through native Web Audio. Per-effect rate limits, a simultaneous-voice limit, and a shared compressor keep large battles controlled. Sound effects and music have independent controls; playback begins only after a user gesture. Battle sounds and music pause with the game; victory and defeat cues can finish over the result menu.
