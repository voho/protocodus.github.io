// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
import { createCore } from './core.mjs';

// The native bridge renders up to one standard Web Audio quantum at a time.
const blockSize = 128;

export class OreganaDSP {
  constructor(sampleRate) {
    this.core = createCore();
    this.core._initialize();
    this.core.init(sampleRate);
    const memory = this.core.memory.buffer;
    this.left = new Float32Array(memory, this.core.leftSamples(), blockSize);
    this.right = new Float32Array(memory, this.core.rightSamples(), blockSize);
  }

  setPreset(index) { this.core.setPreset(index); }
  setControl(index, value) { this.core.setControl(index, value); }
  setControllers(wheel, expression) { this.core.setControllers(wheel, expression); }
  setBend(value) { this.core.setBend(value); }
  noteOn(note, velocity) { this.core.noteOn(note, velocity); }
  noteOff(note, velocity = 64) { this.core.noteOff(note, velocity); }
  allKeysUp() { this.core.allKeysUp(); }
  allSoundOff() { this.core.allSoundOff(); }

  render(left, right) {
    for (let offset = 0; offset < left.length; offset += blockSize) {
      const count = Math.min(blockSize, left.length - offset);
      this.core.render(count);
      if (count === blockSize) {
        left.set(this.left, offset);
        right.set(this.right, offset);
      } else {
        // Avoid allocating subarray views on the audio thread.
        for (let frame = 0; frame < count; frame++) {
          left[offset + frame] = this.left[frame];
          right[offset + frame] = this.right[frame];
        }
      }
    }
  }
}
