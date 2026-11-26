// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
function fileError() { throw new Error('Keyra DSP runtime error'); }

// The C++ runtime uses file descriptors for fatal diagnostics. The worklet
// propagates the error to its host and has no file descriptors.
export const runtimeImports = {
  wasi_snapshot_preview1: { fd_close: fileError, fd_seek: fileError, fd_write: fileError },
};
