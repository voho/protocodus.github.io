// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { registerPiano } from './processor-base.js';
import { StereoPiano } from './dsp/stereo.mjs';
import { runtimeImports } from './dsp/runtime.mjs';

registerPiano('keyra-scalar', 'scalar', (rate, { module }) =>
  new StereoPiano(rate, new WebAssembly.Instance(module, runtimeImports).exports));
