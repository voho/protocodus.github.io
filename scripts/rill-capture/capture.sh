#!/usr/bin/env bash
# Capture complete, unretouched application frames from the capture-only build.
set -euo pipefail
if [[ $# != 3 ]]; then
  echo 'Usage: capture.sh CAPTURE_BINARY DEMO_DIRECTORY OUTPUT_DIRECTORY' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
binary=$(realpath "$1")
demo=$(realpath "$2")
mkdir -p "$3"
output=$(realpath "$3")
project="$demo/glass-current.daw.json"
[[ -f "$project" ]] || { echo "Missing demo: $project" >&2; exit 1; }
export RILL_CONFIG_DIR="$demo/config"
export RILL_CACHE_DIR="$demo/cache"
export WINIT_X11_SCALE_FACTOR=1.25
capture() {
  local name=$1 view=$2 track=$3
  RILL_CAPTURE_TRACK="$track" xvfb-run -a -s '-screen 0 2600x1600x24' \
    python3 "$script_dir/capture_window.py" "$binary" --screenshot "$output/readme-$name.png" --project "$project" --view "$view"
}
capture arrangement arrangement Kick
capture piano-roll clip 'Glass chords'
capture audio-editor clip Kick
capture mixer mixer Kick
capture ai-assistant assistant 'Glass chords'
if [[ -n ${RILL_CAPTURE_AUTOMATION_TRACK:-} ]]; then
  capture automation automation "$RILL_CAPTURE_AUTOMATION_TRACK"
fi
