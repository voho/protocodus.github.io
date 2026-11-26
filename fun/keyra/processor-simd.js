import { registerPiano } from './processor-base.js';
import { SimdDSP } from './dsp/simd.mjs';

registerPiano('keyra-simd', 'simd', (rate, options) => new SimdDSP(rate, options.module));
