// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { createCore } from './core.mjs';
import { StereoPiano } from './stereo.mjs';

export class KeyraDSP extends StereoPiano {
  constructor(sampleRate) { super(sampleRate, createCore()); }
}
