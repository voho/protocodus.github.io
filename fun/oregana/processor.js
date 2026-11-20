import { OreganaDSP } from './dsp/organ.mjs';

class OreganaProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.organ = new OreganaDSP(sampleRate);
    this.configured = false;
    this.startupNotes = [];
    this.nextNote = 0;
    this.port.onmessage = ({ data }) => this.handle(data);
    this.port.postMessage({ type: 'ready' });
  }

  handle(event) {
    switch (event.type) {
      case 'configure':
        this.organ.setPreset(event.preset);
        for (const [index, value] of event.edits) this.organ.setControl(index, value);
        this.organ.setControllers(event.wheel, event.expression);
        this.organ.setBend(event.bend);
        this.startupNotes = event.notes.map(note => ({
          ...note, frame: currentFrame + Math.round(note.delayMs * sampleRate / 1000)
        }));
        this.configured = true;
        break;
      case 'noteOn':
      case 'noteOff':
        // Retain input order if another key arrives while the first gesture is replayed.
        if (this.nextNote < this.startupNotes.length) {
          event.frame = this.startupNotes[this.startupNotes.length - 1].frame;
          this.startupNotes.push(event);
        } else {
          this.play(event);
        }
        break;
      case 'control': this.organ.setControl(event.index, event.value); break;
      case 'preset': this.organ.setPreset(event.index); break;
      case 'controllers': this.organ.setControllers(event.wheel, event.expression); break;
      case 'bend': this.organ.setBend(event.value); break;
      case 'panic':
        this.startupNotes.length = this.nextNote = 0;
        this.organ.allSoundOff();
        break;
    }
  }

  play(event) {
    if (event.type === 'noteOn') this.organ.noteOn(event.note, event.velocity);
    else this.organ.noteOff(event.note, event.velocity);
  }

  process(inputs, outputs) {
    if (this.configured) {
      while (this.nextNote < this.startupNotes.length && this.startupNotes[this.nextNote].frame <= currentFrame) {
        this.play(this.startupNotes[this.nextNote++]);
      }
      if (this.nextNote && this.nextNote === this.startupNotes.length) {
        this.startupNotes.length = this.nextNote = 0;
      }
      this.organ.render(outputs[0][0], outputs[0][1]);
    }
    return true;
  }
}

registerProcessor('oregana', OreganaProcessor);
