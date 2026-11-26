import { registerPiano } from './processor-base.js';
import { KeyraDSP } from './dsp/piano.mjs';

registerPiano('keyra', 'javascript', rate => new KeyraDSP(rate));
