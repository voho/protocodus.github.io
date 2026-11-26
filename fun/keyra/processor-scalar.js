// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { registerPiano } from './processor-base.js';
import { SimdDSP as WasmPiano } from './dsp/simd.mjs';

registerPiano('keyra-scalar', 'scalar', (rate, { module }) => new WasmPiano(rate, module));
