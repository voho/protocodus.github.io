# Tyran music inventory

These five MP3 files were supplied by the user, who identified them as generated with Suno AI. They replace the previous downloaded soundtrack. The supplied files are retained unchanged, including their embedded metadata and cover artwork.

This inventory records the supplied provenance; it makes no additional license or public-domain claim.

Tracks 1–3 rotate by absolute sector number throughout the endless campaign. Track 4 plays during guardian combat and track 5 during challenge stages. Each selected track loops. All five compressed files load into memory and the versioned browser cache before flight; playback uses blob URLs and makes no in-game audio downloads.

| File | Use | Duration | Bytes | Input LUFS | True peak dBTP | Playback gain |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `1.mp3` | Flight sectors 1, 4, 7, … | 209.893 s | 4843073 | -14.79 | -1.61 | 0.245 |
| `2.mp3` | Flight sectors 2, 5, 8, … | 209.534 s | 4740751 | -14.98 | -1.67 | 0.251 |
| `3.mp3` | Flight sectors 3, 6, 9, … | 204.374 s | 4683897 | -14.50 | -2.22 | 0.237 |
| `4.mp3` | Guardian / boss combat | 204.494 s | 4682716 | -14.41 | -2.24 | 0.235 |
| `5.mp3` | Challenge stage | 194.774 s | 4509453 | -14.92 | -3.07 | 0.249 |

All five audio streams are stereo MP3 at 48 kHz. Duration and byte counts were measured with `ffprobe`; integrated loudness and true peak were measured with the input analysis of FFmpeg’s `loudnorm` filter. Playback gains align the songs near −27 LUFS before the shared master gain and limiter, leaving space for game effects. Analysis wrote no audio output and did not re-encode or normalize these source files.

## SHA-256 of unchanged supplied files

- `1.mp3`: `a560515a9c78686f5a821c7f363f5cd55481b0ae016eb952a56cdeaf8e7c2507`
- `2.mp3`: `da30c1c20dd1112824711387a0f8ee7c786d687f8080bf3d775c501f214323bf`
- `3.mp3`: `a66ea90840a6497b791a34443d460c3b09a0f8368203e9854724da7f27218558`
- `4.mp3`: `e6ce71fd67835ff355737532710aa5a73989b16e3cac5886750f76dbb4471b85`
- `5.mp3`: `6e633d0a48df84fd9723c1f7247c16289152b2c644d6af12588ef51192dea4fc`

Inventory and measurements recorded on 2026-09-26.
