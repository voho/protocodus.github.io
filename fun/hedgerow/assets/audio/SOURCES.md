# Hedgerow sound sources

The active runtime loads 24 **CC0 1.0 public domain** audio files. They are
served from the game itself, with no third-party runtime requests. Total audio
payload: **240,385 bytes**. `manifest.json` records each exact file's size,
SHA-256, original filename, and edits. Acquired 6 November 2026. The directory
also retains 16 inactive files from the earlier sound bank, with their source
receipts under `retainedAssets` in the manifest; these are not downloaded
during gameplay.

## Firearm blast recordings

- Creators: Ben Jaszczak, Brian Nelson, Kevin Heras, and Matthew Nanney.
- Collection: **The Free Firearm Sound Library — Prepared SFX Library**.
- Original source and license declaration:
  <https://opengameart.org/content/the-free-firearm-sound-library>.
- The source lists CC0 and reproduces the creators' no-rights-reserved dedication.
- Download mirror: <https://github.com/petroulacl/fps-asset-kit>, pinned commit
  `a19b7458a593598211c95ec46ef4eb4b6d1f94d7`.
- Original metadata is in the mirror's
  `sfx/firearm_sfx/Prepared SFX Library/Prepared Master Sheet.csv`.

| Runtime files | Original recording | Excerpts, seconds | Use |
| --- | --- | --- | --- |
| `rifle-01.ogg`, `rifle-02.ogg` | `1917/B_24P.wav` — Springfield 1917, .30-06, near field | 1.28–2.70; 6.70–8.12 | Garand blast layer |
| `bolt-01.ogg`, `bolt-02.ogg` | `Mosin Nagant/M_21P.wav` — bolt rifle, 7.62×54, near field | 1.00–2.32; 4.98–6.30 | Kar98k blast layer |
| `smg-01.ogg`, `smg-02.ogg` | `PPSh/P_16P.wav` — submachine gun, mid field | 0.26–1.00; 5.22–5.96 | Thompson, MP 40, and MG 42 blast layer |

These are period-firearm sound design layers, **not recordings of the exact
in-game weapon models**. Weapon-specific pitch, low-frequency pressure,
mechanical action, rate of fire, and environment echoes are applied in Web Audio.
Each excerpt is mixed to mono at 44.1 kHz, peak normalized to 0.82, given a 2 ms
attack and 25 ms end fade, and encoded as Vorbis quality 5. No modern gun names
are presented to players as authentic recordings of a WWII model.

Pinned download path example:
<https://raw.githubusercontent.com/petroulacl/fps-asset-kit/a19b7458a593598211c95ec46ef4eb4b6d1f94d7/sfx/firearm_sfx/Prepared%20SFX%20Library/1917/B_24P.wav>.

## Material footsteps and impacts

- Creator: Kenney Vleugels, **Kenney Impact Sounds 1.0** (19 December 2019).
- Original source and license: <https://kenney.nl/assets/impact-sounds>.
- Creator's public-domain guidance: <https://kenney.nl/support>.
- Download mirror: <https://github.com/GeorgeQLe/assets-sfx-combat>, pinned commit
  `9662dc1bed3b06ae753045915f9accfac044c7ce`.
- Original pack license is retained verbatim as `KENNEY-LICENSE.txt`.
- All 15 OGG payloads are copied unchanged from
  `assets/kenney/impact-sounds/Audio/` in that mirror.

Selected files: three variants each of `footstep_concrete`, `footstep_grass`,
and `footstep_wood`; two variants each of `impactMetal_light`, `impactWood_light`,
and `impactMining`. Original numeric suffixes are retained. Stereo sources are
mixed to mono in memory before positional playback; the vendored files remain
unchanged. Wetness, heel/toe detail, webbing, and ricochets retain procedural layers.

Pinned license:
<https://raw.githubusercontent.com/GeorgeQLe/assets-sfx-combat/9662dc1bed3b06ae753045915f9accfac044c7ce/LICENSES/kenney-impact-sounds-license.txt>.

## Clothing and mechanical detail

- Creator: Kenney Vleugels, **RPG Audio**.
- Source: <https://kenney.nl/assets/rpg-audio>.
- Files: `cloth1.ogg`, `cloth2.ogg` and `metalLatch.ogg`, copied unchanged
  from `assets/kenney/rpg-audio/Audio/` in the same pinned mirror above.
- License: CC0 1.0; original pack text is retained verbatim as
  `kenney-rpg-audio-license.txt`.

These are generic material layers, not recordings of a specific historical
weapon. Alternating cloth excerpts replace white-noise webbing detail on the
moving kit and body contacts. A quiet latch excerpt replaces synthesized reload
clicks; the existing slides and low mechanical knocks retain weapon-specific
pitch and timing. Playback skips the recordings' padded starts (85 ms for cloth,
40 ms for the latch), uses short in-memory excerpts with a 15 ms tail fade, and
limits latch gain because the unchanged Vorbis file can decode above full scale.
No new audio payloads are created or fetched remotely. Missing files retain the
previous complete synthesis, and the shared 36-sample voice budget keeps gunfire
ahead of these quiet details. `tests/audio-foley-check.mjs` checks actual decoded
PCM, excerpt onset, simulation pause/cancellation, moving sources, exact mute,
voice priority and complete cleanup.

## Runtime behavior and validation

`js/audio.js` loads three files at a time in the background. Failed requests or
unsupported codecs keep the procedural sound path, so starting the mission and
firing never wait for these files. Samples vary without immediate repetition,
world sounds retain distance filtering and panning, and distant muzzle blasts
and explosions arrive after their sound-travel time. Nearby combat briefly
lowers the weather bed to protect important cues.

The collision world supplies one direct-path acoustic probe when a positioned
sound starts. Masonry, earth banks, wood, metal and foliage use different
transmission gains and low-pass cutoffs; the sound remains audible behind cover.
The audio-clock cache lasts 320 ms, invalidates after 0.8 m of horizontal or
0.25 m of vertical listener movement, holds at most 128 source cells, and runs
at most four world probes per 100 ms window. Boots and muzzles use separate
height cells. Reuse also requires the source to stay within 0.35 m horizontally
and 0.15 m vertically, so stepping out from a narrow masonry wing resamples its
path even within a shared coarse cell. Playing voices never perform per-frame world traces. This is a
bounded single-path approximation, rather than a full diffraction simulation.
Active world sounds follow listener motion with gain, pan and air-filter updates
at 20 Hz, up to 32 buses per update in round-robin order. This adds no geometry
probes: the source's cached transmission remains the event snapshot. A distant
shot therefore arrives from the right world bearing even if the listener turns.

Reloads combine quiet recorded latch detail with synthesized slides and low
mechanical knocks for the Garand, Thompson, Kar98k, MP 40 and MG 42. Player reload/bolt sequences cancel when the weapon
switches. Player mechanical cues advance on the animation's simulation clock,
so slow rendering cannot make the bolt or magazine finish audibly ahead of its
pose. Pending cues contain descriptors; AudioSources start only when a threshold
is crossed. At most four action groups hold 32 cues each. Pause preserves them,
and death, reset or a switch discard the pending cues and fade any active parts.
`tests/audio-actions-check.mjs` renders normal and four-times-slower simulation
cadence, main's advance-before-new-shot ordering, paused advancement, cancellation
and queue limits. NPC reload handles advance separately with each soldier's
reload timer. Magazine/clip and bolt beats use the shipped rig's named event
fractions, and each beat takes its world position and material path when it
actually occurs. A soldier running into cover therefore does not leave the
rest of his reload behind. At most 12 NPC action groups hold 32 descriptors
each; death, interrupted/replaced reloads, reset and menus cancel them without
affecting another soldier or the player's weapon. Normal completion discards
unused descriptors while letting an already-emitted final mechanical tail end.
`tests/audio-actors-check.mjs`
uses real rig events and PCM to check moving/covered sources, slow simulation,
pause, per-actor cancellation, queue limits and cleanup. Gunshot attacks/tails
and sound propagation keep their audio-clock timelines. Reflections remove
sub-bass and reduce the second return to keep
automatic fire clear; a final smooth peak guard leaves ordinary levels unchanged
below 0.82 and catches coincident blast/fire transients at a 0.94 ceiling.
Wildlife shares the weather fade/duck bus so it fades with the mission ambience.
Pont's quiet aircraft pass follows a fixed world flight bearing, so turning
changes the heard direction without rotating the flight with the listener.
One pass at most, including its fade, uses the existing 20 Hz spatial update
budget and no world traces. Roof/weather exposure and ambience volume affect
the engine bed; pause freezes its audio clock and menus release its oscillators.
`tests/audio-aircraft-check.mjs` renders bearing/level, shelter, mute, menu
cancellation, the one-pass bound and cleanup. This is original procedural
multi-engine ambience, not a recording of an identified aircraft.
Canal frog calls originate at their configured water-bank height rather than
following the listener up a bridge or hill. Each call keeps its emission point;
walking or turning updates only its heard distance, filtering and bearing.
The 36-sample voice budget protects the player's attack and nearby threats ahead
of quieter distant tails. One-shot panners, filters and echo sends disconnect
after their last source ends, including sources scheduled for later playback.
The visible brass case triggers one quiet original synthesized tick/ring on
its actual first ground contact. The landing material and normal impact speed
control audibility; mud, grass, foliage, fabric and water absorb it. Later small
bounces add no invented sound train. Eight contact voices at most play at once,
and each releases within a fraction of a second. The Thompson and MP 40 use the
short case mesh pool. `tests/audio-casings-check.mjs` checks the actual physics
ground frame, slow-render timing, pool reuse, material/mix silence, live pause,
reset, source budget and resource cleanup without booting a WebGL scene.
Horizon artillery reports accept the flash's world bearing and a travel delay
in seconds on the audio clock. Their broad stereo bearing follows listener
turns without extra world traces; pause freezes the remaining delay. At most
four report groups can be scheduled or playing, and leaving the mission cancels
pending reports so they do not collect in a menu. `tests/audio-horizon-check.mjs`
checks real PCM delay, bearings, menu cancellation and the report limit, plus a
live audio-clock pause/resume. A 20 ms volume fade avoids slider clicks; changing volume while
paused cancels older ramps, and mute reaches exact zero on both main/ringing buses.
Roof coverage softens the outside weather on a separate stage and reduces
helmet ticks/drips. Horizon enclosure distinguishes an open-sided canopy from
a walled passage; stepping outside restores the evolving weather. Nearby fire
and weapon sounds keep their individual acoustic paths.

Visible burning wrecks/buildings add quiet, original procedural roar and crackle
within 65 m. The effects system's live fire objects control position, size and
extinguishing. At most four fire voices (including fading voices) run at once;
gain/pan updates run at 4 Hz, and at most one emitter path refresh runs per update.
They add no downloaded audio payload. `tests/audio-fires-check.mjs` renders their
distance response, wall filtering, conservative level, fade and resource limits.
The shared fire texture prepares during loading with an independent random
stream, so the first nearby fire adds no texture-generation work to a play frame.

The Prague relay can play a quiet original keyed signal and receiver hiss while
its report phase is active. This is a fictional short signal pattern, not a
transcribed historical message or a human recording. Two receiver voices at most
use one shared texture, prepared when their source list is installed. Position
updates run at 8 Hz, with at most one cached path refresh per update. Receiver
audio keeps its own world path and master volume/daze, while phase completion,
menu gating and pause stop/freeze its loops. `tests/audio-radios-check.mjs` renders
phase gating, stereo bearing, listener turns, distance/wall filtering and cleanup.
`tests/audio-prague-check.mjs` verifies open courtyards and roofed/blocked passage
paths against the mission's placed procedural colliders without a GPU boot.

Bodies use an original procedural thump and restrained clothing/kit detail at
the first meaningful pelvis, spine or chest floor contact. The physics callback
passes the actual surface point, material and downward speed; it does not use an
estimated death timer or invent a later rifle clatter. Eight short contact groups
at most include a reserved player slot. Suspension freezes tails, while retry
and menu cancellation stop them. `tests/ragdoll-contact-check.mjs` checks real-rig
contact timing, unchanged physics, surfaces and cancellation at20–240Hz;
`tests/body-consumer-check.mjs` and `tests/ai-body-audio-check.mjs` cover actual
player/NPC deaths. `tests/audio-bodies-check.mjs` renders the real WebAudio mix,
material/speed differences, bearing, occlusion, exact mute and bounded cleanup.
The contact body remains original synthesis; the quiet cloth layer uses the
CC0 RPG Audio excerpts described above and retains its procedural fallback.

Dropped clips, magazines and rifles also sound only at their first actual floor
contact. Their existing collision radius supplies a restrained size scale, and
material plus incoming speed determines the knock; tiny clips are silent on soft
ground or in water. This original synthesis avoids using a grenade clank for
every object. Eight independent equipment groups at most share contact
cancellation with bodies. `tests/debris-contact-check.mjs` verifies physical
contacts and preserves the genuine grenade bounce, while
`tests/audio-debris-check.mjs` renders material/size/speed, spatial filtering,
mute, pause, cancellation and resource limits.

`node fun/hedgerow/tests/audio-check.mjs` validates file hashes and payload size,
decodes all files using Chromium Web Audio, renders a real gunshot, verifies the
one-second muzzle-blast delay at 343 m and distance attenuation, checks real PCM
wall transmission, captured-weapon reload timing and cancellation, mixed-combat
headroom, the 36-voice limit and node cleanup, confirms that muting silences
existing tinnitus, and verifies audible procedural gunfire when all sample
requests fail. `tests/audio-space-check.mjs` checks real collider paths, cache
invalidation, material transmission and the trace/memory budgets. Full CC0 legal
text is retained in `CC0-1.0.txt`.

Pass `--report path.json` to `audio-check.mjs` to save its measured PCM levels,
cover filtering, stereo bearings, headroom, cancellation and recovery results.
