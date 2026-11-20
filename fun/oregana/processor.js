import { OrganProcessor } from './processor-base.js';
import { OreganaDSP } from './dsp/organ.mjs';

class OreganaProcessor extends OrganProcessor {
  constructor() {
    super(new OreganaDSP(sampleRate), 'javascript');
  }
}

registerProcessor('oregana', OreganaProcessor);
