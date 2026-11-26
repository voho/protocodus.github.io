// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { controls } from '../metadata.js';

const indices = new Map(controls.map(({ id }, index) => [id, index]));
const blockSize = 128;

export class StereoPiano {
  constructor(sampleRate, core) {
    this.core = core;
    core._initialize();
    core.init(sampleRate);
    this.left = new Float32Array(core.memory.buffer, core.leftSamples(), blockSize);
    this.right = new Float32Array(core.memory.buffer, core.rightSamples(), blockSize);
  }

  setPreset(index) { this.core.setPreset(index); }
  setControl(id, value) {
    const index = indices.get(id);
    if (index !== undefined) this.core.setControl(index, value);
  }
  noteOn(note, velocity, channel = 1) { this.core.noteOn(note, velocity, channel); }
  noteOff(note, channel = 1) { this.core.noteOff(note, channel); }
  controlChange(cc, value, channel = 1) { this.core.controlChange(cc, value, channel); }
  pitchBend(semitones, channel = 1) { this.core.pitchBend(semitones, channel); }
  allKeysUp() { this.core.allKeysUp(); }
  allSoundOff() { this.core.allSoundOff(); }

  render(left, right) {
    for (let offset = 0; offset < left.length; offset += blockSize) {
      const frames = Math.min(blockSize, left.length - offset);
      this.core.render(frames);
      if (frames === blockSize) {
        left.set(this.left, offset);
        right.set(this.right, offset);
      } else {
        for (let i = 0; i < frames; ++i) {
          left[offset + i] = this.left[i];
          right[offset + i] = this.right[i];
        }
      }
    }
  }
}
