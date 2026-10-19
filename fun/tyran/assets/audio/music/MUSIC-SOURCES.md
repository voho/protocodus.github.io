# Tyran music inventory

These five MP3 files were supplied by the user, who identified them as generated with Suno AI. They replace the previous downloaded soundtrack. The audio and all text metadata are exactly as supplied; only the embedded cover picture was removed (see below).

This inventory records the supplied provenance; it makes no additional license or public-domain claim.

Tracks 1–3 rotate by absolute sector number throughout the endless campaign. Track 4 plays during guardian combat and track 5 during challenge stages. Each selected track loops. Songs stream from the server while they play: startup downloads none of them, a song starts once its first few seconds have arrived (under a second at 1.5 Mbit/s in the browser checks), and a track that is never needed is never downloaded. The browser's own HTTP cache, revalidated on every visit, makes repeat plays cheap and can never serve a stale soundtrack. One media element plays every song, so a single user gesture authorizes the whole soundtrack. If a song cannot load, another track stands in; nothing synthesized ever replaces the soundtrack.

| File | Use | Duration | Bytes | Input LUFS | True peak dBTP | Playback gain |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `1.mp3` | Flight sectors 1, 4, 7, … | 209.893 s | 4831870 | -14.79 | -1.61 | 0.245 |
| `2.mp3` | Flight sectors 2, 5, 8, … | 209.534 s | 4728361 | -14.98 | -1.67 | 0.251 |
| `3.mp3` | Flight sectors 3, 6, 9, … | 204.374 s | 4675847 | -14.50 | -2.22 | 0.237 |
| `4.mp3` | Guardian / boss combat | 204.494 s | 4670150 | -14.41 | -2.24 | 0.235 |
| `5.mp3` | Challenge stage | 194.774 s | 4498247 | -14.92 | -3.07 | 0.249 |

All five audio streams are stereo MP3 at 48 kHz. Durations were measured with `ffprobe`; byte counts are of the shipped files; integrated loudness and true peak were measured with the input analysis of FFmpeg’s `loudnorm` filter. Playback gains align the songs near −27 LUFS before the shared master gain and limiter, leaving space for game effects. Analysis wrote no audio output and did not re-encode or normalize these source files.

## Cover picture removed for streaming

Each supplied file embedded its Suno cover picture as an ID3v2.4 `APIC` frame (8–12 KB). Chromium exposes that picture as a second stream and buffers about 1.5 MB of a song before it starts playing it, which made a streamed song take roughly 8 seconds to start at 1.5 Mbit/s instead of under half a second. [`../../../tools/strip-cover-art.py`](../../../tools/strip-cover-art.py) removed only those frames: the other tag frames (title, artist, comment, Suno identifiers and the embedded `GEOB` object) and every byte of the MP3 stream after the tag are unchanged. Decoding each shipped file with FFmpeg gives output identical to its supplied original, with the same frame count and duration.

## SHA-256 of shipped files

- `1.mp3`: `7c122ef78a6498e8ab02af164113a5517761a302bb860afdb3ba8efbb6070157`
- `2.mp3`: `139f9dfbd163b034833639bd8515341d8424d64495280013c151979004432c72`
- `3.mp3`: `a94ed2da7748ad62704181e0194b83e933f05840bacf3083371425b4d1b7329b`
- `4.mp3`: `53b48e89cfb1c09e1ba8eb2d3fb08f9414b8be7f0b8e7b44386f0c2375baa7a0`
- `5.mp3`: `5eb24ea914be1bc3705c70e19d48be643b1c49575829205645db236b4935f4bd`

## SHA-256 of the supplied originals

- `1.mp3`: `a560515a9c78686f5a821c7f363f5cd55481b0ae016eb952a56cdeaf8e7c2507`
- `2.mp3`: `da30c1c20dd1112824711387a0f8ee7c786d687f8080bf3d775c501f214323bf`
- `3.mp3`: `a66ea90840a6497b791a34443d460c3b09a0f8368203e9854724da7f27218558`
- `4.mp3`: `e6ce71fd67835ff355737532710aa5a73989b16e3cac5886750f76dbb4471b85`
- `5.mp3`: `6e633d0a48df84fd9723c1f7247c16289152b2c644d6af12588ef51192dea4fc`

Inventory and measurements recorded on 2026-09-26; cover pictures removed on 2026-10-19.
