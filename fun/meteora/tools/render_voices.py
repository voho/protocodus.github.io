"""Meteora — record the lines tools/voices.mjs gathered.

  python tools/render_voices.py --model DIR [--only KEY ...]

Needs kokoro-onnx (pip install kokoro-onnx soundfile) and its model files
in DIR (kokoro-v1.0.int8.onnx, or kokoro-v1.0.onnx, and voices-v1.0.bin
from github.com/thewh1teagle/kokoro-onnx releases), and ffmpeg. Kokoro is
an open speech model (Apache-2.0): what it records may be published.

Each speaker has a voice of their own and a pace (CAST). Every line is
trimmed of leading and trailing silence, brought to one loudness and
written as assets/voice/<key>.mp3 — mono, 24 kHz, 40 kbit/s: the radio
filter in js/voices.js keeps only the telephone band anyway. Lines already
recorded are kept, so a re-run records only what is new. Then
assets/voice/index.json lists every recording: key → [seconds, where it is
spoken...], which the game reads to fetch a mission's lines while it loads.
"""
import argparse, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
LINES = os.path.join(HERE, 'voices', 'lines.json')
OUT = os.path.join(ROOT, 'assets', 'voice')

# speaker → (Kokoro voice, speed, language)
CAST = {
    'doukas': ('bf_emma', 0.95, 'en-gb'),
    'wren': ('af_bella', 1.04, 'en-us'),
    'saint': ('am_michael', 1.0, 'en-us'),
    'okonkwo': ('af_sarah', 1.0, 'en-us'),
    'ferrante': ('am_onyx', 0.92, 'en-us'),
    'perpetua': ('am_puck', 1.02, 'en-us'),
    'varlaam': ('bf_isabella', 1.0, 'en-gb'),
    'halo': ('am_fenrir', 1.02, 'en-us'),
    'ember': ('af_kore', 1.02, 'en-us'),
    'mule': ('bm_fable', 0.98, 'en-gb'),
    'convoy': ('bm_fable', 0.98, 'en-gb'),
    'narrator': ('bm_george', 0.9, 'en-gb'),
    'tender': ('af_alloy', 1.06, 'en-us'),
    'system': ('am_echo', 1.04, 'en-us'),
    'harrow': ('am_onyx', 0.8, 'en-us'),
}
TRIM = ('silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,'
        'areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.08,areverse,'
        'loudnorm=I=-18:TP=-1.5:LRA=9')


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out.strip()), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='folder with the Kokoro model and voices')
    ap.add_argument('--only', nargs='*', help='keys to (re)record')
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    import soundfile as sf
    model = next((os.path.join(args.model, f) for f in ('kokoro-v1.0.onnx', 'kokoro-v1.0.int8.onnx')
                  if os.path.exists(os.path.join(args.model, f))), None)
    kokoro = Kokoro(model, os.path.join(args.model, 'voices-v1.0.bin'))
    lines = json.load(open(LINES))
    os.makedirs(OUT, exist_ok=True)
    index = {}
    made = 0
    for line in lines:
        key, who = line['key'], line['who']
        if who not in CAST:
            print('no voice for', who, file=sys.stderr)
            continue
        path = os.path.join(OUT, f'{key}.mp3')
        redo = args.only is not None and key in args.only
        if redo or not os.path.exists(path):
            voice, speed, lang = CAST[who]
            samples, rate = kokoro.create(line['text'], voice=voice, speed=speed, lang=lang)
            with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
                sf.write(wav.name, samples, rate)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav.name, '-af', TRIM, '-ac', '1', '-ar', '24000',
                                '-c:a', 'libmp3lame', '-b:a', '40k', path], check=True)
            made += 1
            if made % 20 == 0:
                print(f'{made} recorded', flush=True)
        index[key] = [duration(path), *line['missions']]
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'), sort_keys=True)
    total = sum(os.path.getsize(os.path.join(OUT, f'{k}.mp3')) for k in index)
    print(f'{len(index)} lines ({made} new), {sum(v[0] for v in index.values()) / 60:.1f} min, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
