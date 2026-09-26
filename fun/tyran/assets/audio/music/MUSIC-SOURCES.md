# Tyran music sources

These three full synthwave recordings were downloaded on 2026-09-26. Each
creator's OpenGameArt submission explicitly lists **CC0** and links to the
[CC0 1.0 Universal Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/)
([legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode)).
Credits are retained here as provenance and appreciation.

| Local file | Track / artist | Duration | Size | Suggested game use |
| --- | --- | --- | --- | --- |
| `space-adventure.mp3` | Space Adventure — MintoDog | 2:10.286 | 5,214,163 bytes | Normal stages |
| `synthwave-type.mp3` | synthwave_type — G_P | 1:53.162 | 2,263,307 bytes | Boss encounters |
| `slampe.mp3` | Slampe - Synthwave House — Fupi | 2:34.389 | 3,707,278 bytes | Challenge stages |

Total audio payload: **11,184,748 bytes** (10.67 MiB). All files are stereo,
44.1 kHz MP3. They contain the complete source recordings; none are excerpts.

## Space Adventure

- Artist: **MintoDog**.
- [Creator's source and track-specific CC0 declaration](https://opengameart.org/content/space-adventure).
- [Original download](https://opengameart.org/sites/default/files/space_adventure_bpm140.mp3).
- Original filename: `space_adventure_bpm140.mp3`.
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- The creator describes it as synthwave, 140 BPM, and loopable.
- Processing: renamed only; original 320 kb/s MP3 bytes preserved.
- SHA-256: `d778093ed7e826b8ad604f489cda3675b2d8203576d906a0d2553cfe20f0a93f`.

## synthwave_type

- Artist: **G_P**.
- [Creator's source and track-specific CC0 declaration](https://opengameart.org/content/synthwavetype).
- [Original download](https://opengameart.org/sites/default/files/synth_type_1.mp3).
- Original filename: `synth_type.mp3` (download URL uses `synth_type_1.mp3`).
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- The creator identifies it as a synthwave track.
- Processing: renamed only; original 160 kb/s MP3 bytes preserved.
- SHA-256: `df87e826f113f3fc425b24fc85361e1f5866045eb44f06096ea64b792a362389`.

## Slampe - Synthwave House

- Artist: **Fupi**.
- [Creator's source and track-specific CC0 declaration](https://opengameart.org/content/slampe-synthwave-house).
- [Original download](https://opengameart.org/sites/default/files/slampe.wav).
- Original filename: `slampe.wav`.
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- The creator describes it as a full synthwave/house song made from samples of
  their own songs; the submission is tagged 114 BPM.
- Processing: complete WAV converted to 192 kb/s MP3 with FFmpeg/libmp3lame;
  title, artist, and CC0 source URL added as metadata. No arrangement changes.
- SHA-256: `b6baf4b660c21b93467ffeb7a7db3439f618f1e2ddba61e9079ccea6a52e17e7`.

## Verification

The source pages and their CC0 links were checked on the download date.
`ffprobe` verified codec, channels, sample rate, and full duration; `ffmpeg`
decoded each complete local MP3 with no errors. The sources are individual
audio downloads and do not include separate license files.
