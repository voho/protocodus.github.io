#!/usr/bin/env python3
"""Rebuild Tyran's sound effects from their public-domain (CC0) source archives.

Usage: python3 -I fun/tyran/tools/build-sfx.py <download-cache-dir> [output-dir]

Every archive is fetched from its original page, checked against a pinned
SHA-256 and read in memory; nothing from an archive is executed. Each effect is
decoded with FFmpeg, folded to mono at 44.1 kHz, trimmed to its sound (no
leading silence), given short click-free fades, optionally layered with a
low-frequency body, loudness-matched within its cue group and peak-limited to
-1 dBFS. Output is 16-bit PCM WAV with seeded TPDF dither, so runs are
byte-identical. Requires ffmpeg (with libsoxr) and numpy.
"""
import hashlib
import io
import subprocess
import sys
import urllib.request
import wave
import zipfile
from pathlib import Path

import numpy as np

RATE = 44100
ARCHIVES = {
    'kenney-sci-fi': ('https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip',
                      '119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04'),
    'kenney-digital': ('https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip',
                       '24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06'),
    'kenney-impact': ('https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
                      '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8'),
    'kenney-interface': ('https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
                         'f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232'),
    'rubberduck-bang': ('https://opengameart.org/sites/default/files/25-CC0-bang-sfx.zip',
                        'c0c9ecc11e2dc0d190f0cced755569858234b8528286bc83becb6314c663407f'),
    'rubberduck-sci-fi': ('https://opengameart.org/sites/default/files/sci-fi-sfx.zip',
                          '7824c08e54b5b68d6c70ced9d8fe9e47f86ce19c1d8d47d093e1dc1b579f78ec'),
    'rubberduck-sci-fi-60': ('https://opengameart.org/sites/default/files/60-sci-fi-sfx_0.zip',
                             '11ebf7d8c4ece445128eeb95c969e0ed36ff34fc2c8ef0e04a154d62e2f938f8'),
    'black-lodge': ('https://opengameart.org/sites/default/files/50-Free-SciFi-SFX-blacklodgegames.com_.zip',
                    'f0cc620c86546eb6b35019d52cbb17f9693c70ee9b4dd636019ad0a08358de81'),
}
SCI, DIGITAL, IMPACT, UI = 'kenney-sci-fi:Audio/', 'kenney-digital:Audio/', 'kenney-impact:Audio/', 'kenney-interface:Audio/'
BANG, RD, RD60 = 'rubberduck-bang:', 'rubberduck-sci-fi:', 'rubberduck-sci-fi-60:'
BLG = 'black-lodge:50-Free-SciFi-SFX-blacklodgegames.com/'
# A low-frequency body under the thin firework recordings, so explosions thump.
BODY_SMALL = {'src': SCI + 'lowFrequency_explosion_001.ogg', 'gain': .45, 'filter': 'lowpass=f=170'}
BODY_LARGE = {'src': SCI + 'lowFrequency_explosion_000.ogg', 'gain': .55, 'filter': 'lowpass=f=150'}

# group -> list of variants: (main source, {max seconds, fade seconds, layers, filter})
EFFECTS = {
    'laser-small': [(SCI + f'laserSmall_00{i}.ogg', {'max': .26}) for i in (0, 1, 2, 3)],
    'laser-retro': [(SCI + f'laserRetro_00{i}.ogg', {'max': .26}) for i in (0, 1, 3)],
    'laser-heavy': [(SCI + f'laserLarge_00{i}.ogg', {'max': .55, 'fade': .12}) for i in (0, 1, 3)],
    'enemy-shot': [(RD60 + f'sfx_20{v}.ogg', {'max': .2}) for v in 'abc'],
    'enemy-shot-heavy': [(RD + 'shoot_01.ogg', {'max': .3}), (RD + 'shoot_02.ogg', {'max': .2})],
    'explosion': [(BANG + f'bang_0{i}.ogg', {'max': .95, 'fade': .35, 'layers': [BODY_SMALL]}) for i in (1, 6, 7, 9)],
    'explosion-large': [(RD + 'explosion_01.ogg', {'max': 1.6, 'fade': .5}),
                        (BANG + 'cannon_01.ogg', {'max': 1.4, 'fade': .45, 'layers': [BODY_LARGE]}),
                        (BANG + 'cannon_02.ogg', {'max': 1.6, 'fade': .5, 'layers': [BODY_LARGE]})],
    'boom': [(SCI + 'lowFrequency_explosion_000.ogg', {'max': 1.5, 'fade': .5, 'filter': 'highpass=f=24'}),
             (SCI + 'lowFrequency_explosion_001.ogg', {'max': 1, 'fade': .35, 'filter': 'highpass=f=24'})],
    'debris': [(BANG + 'fw_03.ogg', {'max': 1.05, 'fade': .3})],
    'impact': [(IMPACT + f'impactPlate_heavy_00{i}.ogg', {'max': .5}) for i in (1, 3, 4)],
    'shield-hit': [(IMPACT + f'impactGlass_light_00{i}.ogg', {'max': .2, 'filter': 'highpass=f=500'}) for i in (0, 2, 4)],
    'deflect': [(IMPACT + f'impactMetal_light_00{i}.ogg', {'max': .3}) for i in (0, 1, 2)],
    'shield-break': [(IMPACT + f'impactGlass_heavy_00{i}.ogg', {'max': .45}) for i in (0, 2)],
    'glass-break': [(IMPACT + f'impactGlass_medium_00{i}.ogg', {'max': .45}) for i in (0, 1)],
    'weak-break': [(SCI + f'impactMetal_00{i}.ogg', {'max': .55, 'fade': .2}) for i in (0, 3)],
    'shield-up': [(SCI + 'forceField_002.ogg', {'max': .8, 'fade': .25})],
    'pickup': [(DIGITAL + f'powerUp{i}.ogg', {'max': .45}) for i in (7, 8, 9)],
    'purchase': [(UI + 'confirmation_003.ogg', {}), (UI + 'confirmation_001.ogg', {})],
    'weapon': [(DIGITAL + 'phaserUp6.ogg', {}), (DIGITAL + 'phaserUp2.ogg', {})],
    'power-up': [(DIGITAL + 'powerUp11.ogg', {}), (DIGITAL + 'powerUp12.ogg', {})],
    'drone': [(DIGITAL + 'phaseJump3.ogg', {}), (DIGITAL + 'phaseJump5.ogg', {})],
    'extra-life': [(DIGITAL + 'powerUp1.ogg', {'max': 1.1})],
    'power-down': [(DIGITAL + 'phaserDown1.ogg', {}), (DIGITAL + 'phaserDown3.ogg', {})],
    'rescue': [(DIGITAL + 'powerUp10.ogg', {})],
    'bonus': [(DIGITAL + 'powerUp4.ogg', {}), (DIGITAL + 'powerUp5.ogg', {})],
    'ace': [(DIGITAL + 'powerUp3.ogg', {'max': 1})],
    'combo': [(DIGITAL + 'pepSound1.ogg', {}), (DIGITAL + 'pepSound3.ogg', {})],
    'alarm': [(BLG + 'blg_warning_alarm_01.wav', {'max': 1.5, 'fade': .4})],
    'alert': [(BLG + 'blg_warning_alarm_02.wav', {'max': .75, 'fade': .2})],
    'hull-alarm': [(UI + 'error_004.ogg', {})],
    'boss-open': [(SCI + 'doorOpen_001.ogg', {})],
    'boss-close': [(SCI + 'doorClose_001.ogg', {})],
    'notify': [(UI + 'question_003.ogg', {})],
    'challenge': [(DIGITAL + 'zapThreeToneUp.ogg', {'max': 1.1, 'fade': .35})],
    'objective': [(UI + 'confirmation_002.ogg', {})],
    'checkpoint': [(UI + 'confirmation_004.ogg', {})],
    'split': [(DIGITAL + 'phaseJump1.ogg', {})],
    'dive': [(DIGITAL + 'highDown.ogg', {})],
    'tractor-charge': [(BLG + 'blg_energy_field_03.wav', {'max': 1.1, 'fade': .3})],
    'tractor': [(SCI + 'forceField_000.ogg', {'max': .95, 'fade': .2})],
    'respawn': [(RD + 'teleport_01.ogg', {})],
    'beam-charge': [(BLG + 'blg_beam_02.wav', {'max': .9, 'fade': .2})],
    'beam': [(BLG + 'blg_beam_01.wav', {'max': .9, 'fade': .3})],
    'graze': [(UI + 'tick_002.ogg', {})],
}
TARGET_RMS_DB = -16  # Body loudness before the shared -1 dBFS peak ceiling.


OPENED = {}


def archive(cache, name):
    if name in OPENED: return OPENED[name]
    url, digest = ARCHIVES[name]
    path = cache / Path(url).name
    if not path.exists():
        with urllib.request.urlopen(url) as response: path.write_bytes(response.read())
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest: sys.exit(f'{path} does not match its pinned SHA-256')
    OPENED[name] = zipfile.ZipFile(io.BytesIO(data))
    return OPENED[name]


def decode(cache, ref, extra=''):
    name, member = ref.split(':', 1)
    data = archive(cache, name).read(member)
    chain = f'aresample={RATE}:resampler=soxr:precision=28,highpass=f=18' + (f',{extra}' if extra else '')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-af', chain, '-ac', '2', '-ar', str(RATE), '-f', 'f64le', 'pipe:1'],
                         input=data, capture_output=True, check=True).stdout
    stereo = np.frombuffer(raw, dtype='<f8').reshape(-1, 2)
    return stereo.mean(axis=1)


def envelope(x, window=.005):
    size = max(1, int(RATE * window))
    return np.sqrt(np.convolve(x * x, np.ones(size) / size, 'same'))


def render(cache, ref, spec):
    x = decode(cache, ref, spec.get('filter', ''))
    # Start just before the first audible sample: digital-pack files carry ~0.1 s of silence.
    peak = np.max(np.abs(x))
    start = max(0, int(np.argmax(np.abs(x) > peak * 10 ** (-40 / 20))) - int(.002 * RATE))
    x = x[start:]
    for layer in spec.get('layers', []):
        body = decode(cache, layer['src'], layer.get('filter', ''))
        body = body[max(0, int(np.argmax(np.abs(body) > np.max(np.abs(body)) * .1)) - int(.002 * RATE)):]
        body *= layer['gain'] * np.max(np.abs(x)) / max(1e-9, np.max(np.abs(body)))
        if len(body) > len(x): x = np.concatenate([x, np.zeros(len(body) - len(x))])
        x[:len(body)] += body
    # End where the sound has decayed into the noise floor, or at the cue's cap.
    env = envelope(x)
    audible = np.where(env > np.max(env) * 10 ** (-54 / 20))[0]
    end = min(len(x), (audible[-1] + int(.01 * RATE)) if len(audible) else len(x), int(spec.get('max', 4) * RATE))
    x = x[:end].copy()
    fade = min(len(x) // 3, int(spec.get('fade', .04) * RATE))
    if fade: x[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    attack = min(len(x), int(.0015 * RATE))
    x[:attack] *= np.linspace(0, 1, attack) ** 2
    return x


def body_rms(x):
    env = envelope(x, .02)
    loud = env > np.max(env) * 10 ** (-20 / 20)
    return float(np.sqrt(np.mean(x[loud] ** 2)))


def write(path, x, seed):
    rng = np.random.default_rng(seed)
    dither = (rng.random(len(x)) - rng.random(len(x)))
    pcm = np.clip(np.round(x * 32767 + dither), -32768, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE); out.writeframes(pcm.tobytes())


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    cache = Path(sys.argv[1]); cache.mkdir(parents=True, exist_ok=True)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / 'assets' / 'audio' / 'sfx'
    out.mkdir(parents=True, exist_ok=True)
    seed = 0
    for group, variants in EFFECTS.items():
        rendered = [render(cache, ref, spec) for ref, spec in variants]
        # One gain per variant reaches the body target; the group then shares
        # a ceiling so random variant choice never jumps in level.
        gains = [10 ** (TARGET_RMS_DB / 20) / max(1e-9, body_rms(x)) for x in rendered]
        ceiling = min(10 ** (-1 / 20) / max(1e-9, np.max(np.abs(x)) * g) for x, g in zip(rendered, gains))
        for index, (x, gain) in enumerate(zip(rendered, gains), 1):
            seed += 1
            write(out / f'{group}-{index}.wav', x * gain * min(1, ceiling), seed)
            print(f'{group}-{index}.wav  {len(x) / RATE:.3f} s  <- {variants[index - 1][0]}')


if __name__ == '__main__':
    main()
