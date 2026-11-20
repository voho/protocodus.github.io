// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { createCore } from './core.mjs';
import { StereoInstrument } from './stereo.mjs';

export class OreganaDSP extends StereoInstrument {
  constructor(sampleRate) {
    super(sampleRate, createCore());
  }
}
