#!/usr/bin/env python3
"""Generate the original Glass Current session used in RILL screenshots.

No downloaded music or presets are included. The PCM is synthesized below with
Python's standard library; the MIDI arrangement is original and deterministic.
An existing real VST3 instrument is required so the project contains no missing
or unassigned instrument placeholders. Surge XT 1.3.4 was used for the captures.
"""

import argparse
import array
import json
import math
import random
import sys
import wave
from pathlib import Path

SAMPLE_RATE = 24_000
TEMPO = 120.0
BEATS_PER_PHRASE = 16.0
CHORD_ROOTS = (50, 46, 53, 48)  # D minor 7, Bb major 7, F major 7, C dominant 7.
CHORD_INTERVALS = ((0, 3, 7, 10), (0, 4, 7, 11), (0, 4, 7, 11), (0, 4, 7, 10))


class Demo:
    def __init__(self, directory: Path, instrument: Path, instrument_name: str):
        self.directory = directory
        self.instrument = instrument
        self.instrument_name = instrument_name
        self.next_id = 100

    def ident(self):
        self.next_id += 1
        return self.next_id

    def track(self, name, kind, color, output=None):
        return dict(
            id=self.ident(), name=name, kind=kind, color=color,
            gain=0.75, input_gain=1.0, pan=0.0, mute=False, solo=False,
            instrument="None", instrument_state=[], instrument_parameters=[],
            clips=[], latency_samples=0, inserts=[], sends=[], output_bus=output,
            parent_folder=None, collapsed=False, automation=None,
            audio_input=None, midi_input=None,
        )

    def clip(self, name, start, content):
        return dict(
            id=self.ident(), name=name, start=start, length=BEATS_PER_PHRASE,
            offset=0.0, source_rate=1.0, content=content,
        )

    def write_audio(self):
        rng = random.Random(61106)
        for kind in ("kick", "snare", "hats", "texture"):
            samples = array.array("h")
            for frame in range(SAMPLE_RATE * 8):
                seconds = frame / SAMPLE_RATE
                beat = seconds * TEMPO / 60.0
                phase = beat % 1.0
                if kind == "kick":
                    local = phase * 0.5
                    signal = 0.7 * math.exp(-local * 15) * math.sin(
                        2 * math.pi * (47 * local + 2.8 * (1 - math.exp(-local * 24)))
                    )
                    left = right = signal
                elif kind == "snare":
                    local = (beat % 2 - 1) * 0.5
                    signal = (
                        (rng.uniform(-1, 1) * 0.5 + math.sin(seconds * 2 * math.pi * 175) * 0.15)
                        * math.exp(-max(0, local) * 25)
                        if local >= 0 else 0.0
                    )
                    left = right = signal
                elif kind == "hats":
                    local = (beat % 0.5) * 0.5
                    signal = rng.uniform(-1, 1) * 0.23 * math.exp(-local * 100)
                    left, right = signal, signal * (0.85 if int(beat * 2) % 2 else 1.0)
                else:
                    envelope = math.sin(math.pi * seconds / 8) ** 2
                    left = 0.16 * envelope * sum(
                        amplitude * math.sin(2 * math.pi * frequency * seconds)
                        for amplitude, frequency in ((1.0, 146.8324), (0.45, 220.0), (0.25, 293.6648))
                    )
                    right = 0.16 * envelope * sum(
                        amplitude * math.sin(2 * math.pi * frequency * seconds + 0.12)
                        for amplitude, frequency in ((1.0, 146.9), (0.45, 220.05), (0.25, 293.72))
                    )
                samples.extend(int(max(-0.98, min(0.98, value)) * 32767) for value in (left, right))
            if sys.byteorder != "little":
                samples.byteswap()
            with wave.open(str(self.directory / "audio" / f"{kind}.wav"), "wb") as writer:
                writer.setnchannels(2)
                writer.setsampwidth(2)
                writer.setframerate(SAMPLE_RATE)
                writer.writeframes(samples.tobytes())

    def notes(self, mode):
        notes = []
        lead = ((81, 77, 74, 79, 77), (77, 74, 72, 74, 77),
                (81, 79, 77, 76, 72), (79, 76, 74, 72, 69))
        for bar, (root, intervals) in enumerate(zip(CHORD_ROOTS, CHORD_INTERVALS)):
            if mode == "chords":
                events = [(root + 12 + interval, bar * 4.0, 3.75, 82 - voice * 3)
                          for voice, interval in enumerate(intervals)]
            elif mode == "bass":
                events = [(root - 12, bar * 4 + position, 0.7, velocity)
                          for position, velocity in ((0, 104), (1.5, 82), (2.5, 90), (3.5, 76))]
            elif mode == "arp":
                events = [(root + 12 + intervals[voice], bar * 4 + step * 0.5, 0.38, 72 + step % 3 * 8)
                          for step, voice in enumerate((0, 2, 3, 2, 1, 2, 3, 2))]
            else:
                events = [(pitch, bar * 4 + step * 0.75, 0.6, 85 - step % 2 * 7)
                          for step, pitch in enumerate(lead[bar])]
            notes.extend(dict(id=self.ident(), pitch=pitch, start=start, length=length, velocity=velocity)
                         for pitch, start, length, velocity in events)
        return notes

    def project(self):
        rhythm = self.track("Rhythm bus", "Bus", [93, 166, 158])
        music = self.track("Music bus", "Bus", [162, 141, 203])
        tracks = []
        for name, kind, color in (
            ("Kick", "kick", [87, 174, 156]),
            ("Snare", "snare", [108, 155, 216]),
            ("Hi-hats", "hats", [155, 140, 213]),
            ("Atmosphere", "texture", [197, 150, 105]),
        ):
            track = self.track(name, "Audio", color, rhythm["id"] if kind != "texture" else music["id"])
            for phrase in range(8):
                if (kind == "snare" and phrase in (0, 4)) or (kind == "hats" and phrase == 4):
                    continue
                section = "Intro" if phrase == 0 else "Break" if phrase == 4 else "Return" if phrase >= 5 else "Groove"
                content = {"Audio": dict(path=str(self.directory / "audio" / f"{kind}.wav"),
                                         gain=1.0, fade_in=0.02, fade_out=0.08)}
                track["clips"].append(self.clip(f"{section} · {name.lower()}", phrase * 16.0, content))
            tracks.append(track)
        for name, color, mode in (
            ("Glass chords", [203, 184, 109], "chords"),
            ("Round bass", [153, 190, 111], "bass"),
            ("Glass arpeggio", [92, 176, 189], "arp"),
            ("Echo lead", [183, 144, 201], "lead"),
        ):
            track = self.track(name, "Midi", color, music["id"])
            track["instrument"] = {"Vst3": {"path": str(self.instrument), "class_id": None}}
            track["instrument_name"] = self.instrument_name
            for phrase in range(8):
                if (mode in ("bass", "arp") and phrase in (0, 4)) or (mode == "lead" and phrase not in (2, 3, 6, 7)):
                    continue
                section = "Opening" if phrase == 0 else "Breakdown" if phrase == 4 else "Chorus" if phrase >= 5 else "Verse"
                track["clips"].append(self.clip(f"{section} · {name.lower()}", phrase * 16.0,
                                                 {"Midi": {"notes": self.notes(mode)}}))
            tracks.append(track)
        for track, gain, pan in zip(tracks, (0.7, 0.55, 0.32, 0.3, 0.36, 0.44, 0.27, 0.28),
                                    (0.0, -0.05, -0.18, 0.12, 0.0, 0.0, 0.25, -0.15)):
            track.update(gain=gain, pan=pan)
        rhythm["gain"] = music["gain"] = 1.0
        atmosphere = next(track for track in tracks if track["name"] == "Atmosphere")
        automation = self.track("Atmosphere · Volume", "Automation", [197, 150, 105])
        automation["automation"] = dict(
            target=dict(track=atmosphere["id"], parameter="TrackGain"),
            interpolation="Smooth", clips=[], override_value=None,
            points=[dict(id=self.ident(), beat=beat, value=gain / 1.5)
                    for beat, gain in ((0.0, 0.12), (16.0, 0.3), (48.0, 0.36), (64.0, 0.12),
                                       (80.0, 0.28), (112.0, 0.36), (128.0, 0.12))],
        )
        return dict(name="Glass Current", tempo=TEMPO, beats_per_bar=4, loop_enabled=True,
                    loop_start=0.0, loop_end=128.0, metronome_enabled=False,
                    metronome_gain=0.25, precount_bars=0, tracks=tracks + [rhythm, music, automation])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=Path(__file__).parent / "output")
    parser.add_argument("--instrument-path", type=Path, required=True, help="Existing, usable VST3 instrument bundle")
    parser.add_argument("--instrument-name", help="Actual native instrument name (defaults to the bundle name)")
    args = parser.parse_args()
    instrument = args.instrument_path.expanduser().resolve(strict=True)
    if instrument.suffix.lower() != ".vst3":
        parser.error("--instrument-path must name an existing .vst3 instrument")
    instrument_name = args.instrument_name or instrument.stem
    root = args.output.expanduser().resolve()
    for directory in ("audio", "config", "cache", "scratch", "captures"):
        (root / directory).mkdir(parents=True, exist_ok=True)
    demo = Demo(root, instrument, instrument_name)
    demo.write_audio()
    project = demo.project()
    path = root / "glass-current.daw.json"
    path.write_text(json.dumps({"version": 6, "project": project}, indent=2) + "\n")
    (root / "config" / "settings.json").write_text(json.dumps(dict(
        appearance="Dark", scratch_dir=str(root / "scratch"), vst_dirs=[], track_density="compact",
    ), indent=2) + "\n")
    print(path)
    print("32 bars · 4 audio tracks · 4 MIDI tracks · 2 buses · 1 automation lane")
    print(f"Instrument: {instrument_name} ({instrument})")
    print("MIDI/Assistant: Glass chords · Audio editor: Kick · Automation: Atmosphere · Volume")


if __name__ == "__main__":
    main()
