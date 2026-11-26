// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { StereoPiano } from './stereo.mjs';
import { runtimeImports } from './runtime.mjs';

export class SimdDSP extends StereoPiano {
  constructor(sampleRate, module) {
    super(sampleRate, new WebAssembly.Instance(module, runtimeImports).exports);
  }
}
