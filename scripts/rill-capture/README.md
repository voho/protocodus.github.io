# Native RILL captures

The 8 November 2026 images use RILL commit `451b7dc`, built on Linux. They are
complete native eframe screenshots, without compositing, painted-over UI, or
simulated assistant replies.

`make_demo.py` creates the original Glass Current session and audio assets.
`capture-harness.patch` changes capture setup only: window size, fitted timelines,
selected track, D-minor editor scale, stereo audio Fit after source admission,
and a prepared, unsent request pinned to the
selected MIDI clip. It disables device startup, discovery and automatic plug-in
previews during capture. Production rendering and interaction code are unchanged.

Apply the patch in a detached worktree, not in the shipping checkout:

```sh
git -C /path/to/rill-daw worktree add --detach /tmp/rill-capture 451b7dc
git -C /tmp/rill-capture apply /path/to/website/scripts/rill-capture/capture-harness.patch
cd /tmp/rill-capture
CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo build --locked -p daw-app --bin rill
python3 /path/to/website/scripts/rill-capture/make_demo.py /tmp/rill-demo \
  --instrument-path "/path/to/Surge XT.vst3"
/path/to/website/scripts/rill-capture/capture.sh target/debug/rill /tmp/rill-demo /tmp/rill-images
```

The capture script needs Python 3, `libX11.so.6`, `Xvfb` and `xvfb-run` on
`PATH`, plus the native app's shared library dependencies. An actual installed
VST3 instrument is required; none is bundled. `WINIT_X11_SCALE_FACTOR=1.25` renders 1600 × 1000 logical
windows at 2000 × 1250 pixels; Mixer uses 1920 × 1000, yielding 2400 × 1250.
Set `RILL_CAPTURE_AUTOMATION_TRACK="Atmosphere · Volume"` to capture the demo
automation editor as well. `capture_window.py` parks the X11 pointer outside the
window so native hover tooltips do not cover the music. Use a separate Cargo target directory, or preserve and
restore the production executable when sharing build artifacts.

The assistant image contains a draft only. No credentials, network request,
provider response, generated conversation, or AI-generated song changes are
included in the capture setup.

The MIDI tracks are assigned to the real Surge XT 1.3.4 instrument from its
[official Linux plug-ins archive](https://github.com/surge-synthesizer/releases-xt/releases/download/1.3.4/surge-xt-linux-1.3.4-pluginsonly.tar.gz).
The archive's SHA-256 is
`dd431b75f5fa197c4bffa6ca27ca46970f0a94c834119bb1db7decdeec4c28db`.
Extract the `Surge XT.vst3` bundle and supply its absolute path to the generator;
the plug-in and generated audio are local capture inputs, not website assets.
The demo's four audio loops are deterministic original PCM synthesis, with no
downloaded music or presets. The session has 32 bars at 120 BPM, four audio tracks,
four MIDI tracks, two buses and an Atmosphere volume automation lane.
