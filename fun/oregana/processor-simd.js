import { OrganProcessor } from './processor-base.js';
import { SimdDSP } from './dsp/simd.mjs';

class OreganaSimdProcessor extends OrganProcessor {
  constructor({ processorOptions }) {
    super(new SimdDSP(sampleRate, processorOptions.module), 'simd');
  }
}

registerProcessor('oregana-simd', OreganaSimdProcessor);
