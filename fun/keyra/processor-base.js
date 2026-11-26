// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
export function registerPiano(name, renderer, createPiano) {
  class KeyraProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.piano = createPiano(sampleRate, options.processorOptions);
      this.pending = [];
      this.next = 0;
      this.configured = false;
      this.port.onmessage = ({ data }) => this.receive(data);
      this.port.postMessage({ type: 'ready', renderer });
    }

    receive(event) {
      if (event.type === 'configure') {
        this.piano.setPreset(event.preset ?? 0);
        for (const [id, value] of Object.entries(event.controls ?? {})) this.piano.setControl(id, value);
        this.next = 0;
        let frame = currentFrame;
        this.pending = (event.events ?? []).map(input => {
          frame = Math.max(frame, currentFrame + Math.round((input.delayMs || 0) * sampleRate / 1000));
          return { frame, input };
        });
        this.configured = true;
      } else if (event.type === 'panic' || event.type === 'allSoundOff') {
        this.pending.length = this.next = 0;
        this.piano.allSoundOff();
      } else if (this.next < this.pending.length) {
        this.pending.push({ frame: this.pending[this.pending.length - 1].frame, input: event });
      } else {
        this.apply(event);
      }
    }

    apply(event) {
      switch (event.type) {
        case 'noteOn': this.piano.noteOn(event.note, event.velocity, event.channel); break;
        case 'noteOff': this.piano.noteOff(event.note, event.channel); break;
        case 'controlChange': this.piano.controlChange(event.cc, event.value, event.channel); break;
        case 'pitchBend': this.piano.pitchBend(event.semitones, event.channel); break;
        case 'control': this.piano.setControl(event.id, event.value); break;
        case 'preset': this.piano.setPreset(event.index); break;
        case 'allKeysUp': this.piano.allKeysUp(); break;
        case 'allSoundOff':
        case 'panic': this.piano.allSoundOff(); break;
      }
    }

    process(inputs, outputs) {
      if (this.configured && outputs[0]?.length >= 2) {
        while (this.next < this.pending.length && this.pending[this.next].frame <= currentFrame) {
          this.apply(this.pending[this.next++].input);
        }
        if (this.next && this.next === this.pending.length) this.pending.length = this.next = 0;
        this.piano.render(outputs[0][0], outputs[0][1]);
      }
      return true;
    }
  }
  registerProcessor(name, KeyraProcessor);
}
