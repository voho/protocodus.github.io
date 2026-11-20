// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { StereoInstrument } from './stereo.mjs';

// libc++ only uses file descriptors to report fatal runtime errors. Propagate
// those failures to the host in a worklet, which has no file descriptors.
function fileError() { throw new Error('Oregana DSP runtime error'); }
const imports = {
  wasi_snapshot_preview1: { fd_close: fileError, fd_seek: fileError, fd_write: fileError }
};

export class SimdDSP extends StereoInstrument {
  constructor(sampleRate, compiledModule) {
    const instance = new WebAssembly.Instance(compiledModule, imports);
    super(sampleRate, instance.exports);
  }
}
