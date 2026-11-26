"""Ship the upstream acoustic notices and reference credits for the browser DSP."""
from pathlib import Path
import sys

original, destination = map(Path, sys.argv[1:])
# The native plug-in, graphics, and commercial DAW SDKs are separate builds.
text = original.read_text().split("## JUCE ", 1)[0].strip()
text = text.replace("Experiments/Research/GrandPianoV2/reference/ATTRIBUTION.md)", "./SALAMANDER-ATTRIBUTION.md)")
text = text.replace("Experiments/Research/GrandPianoV2/reference/upstream/LICENSE-CC-BY-3.0.txt)", "./SALAMANDER-CC-BY-3.0.txt)")
text += "\n\n## Browser runtime\n\nThe browser builds include routines from LLVM, WASI libc and musl. Binaryen generates the JavaScript build. [Runtime licenses](../../oregana/dsp/RUNTIME-LICENSES.txt)\n"
destination.write_text(text)
