import { bodies, controls, micNames, presets } from './metadata.js';
import { createPanel } from './panel.js';
import { setupInputs } from './inputs.js';
import { createInstrumentAudio } from '../shared/instrument-audio.js';

let preset = 0;
const edits = new Map();
const { startAudio, perform, send } = createInstrumentAudio({
  baseUrl: import.meta.url, processor: 'keyra', instrument: 'piano', accelerator: './dsp/keyra-simd.wasm',
  minimumRate: 8000, releaseAll: () => inputs.releaseAll(),
  configure: events => ({ type: 'configure', preset, controls: Object.fromEntries(edits), events })
});

function midi(status, data1, data2) {
  const channel = (status & 0x0f) + 1;
  const command = status & 0xf0;
  switch (command) {
    case 0x80:
    case 0x90:
      perform({ type: command === 0x90 && data2 > 0 ? 'noteOn' : 'noteOff', channel, note: data1, velocity: data2 });
      break;
    case 0xb0:
      perform({ type: 'controlChange', channel, cc: data1, value: data2 });
      break;
    case 0xe0: {
      const centered = ((data2 << 7) | data1) - 8192;
      perform({ type: 'pitchBend', channel, semitones: 2 * centered / (centered < 0 ? 8192 : 8191) });
      break;
    }
  }
}

const inputs = setupInputs({ startAudio, midi });
createPanel({
  bodies, controls, micNames, presets, initialPreset: preset,
  onPreset(index) {
    preset = index;
    // Native factory programs change only the parameters present in the program.
    for (const id of Object.keys(presets[index].values)) edits.delete(id);
    inputs.setPanelPedals(presets[index].values);
    send({ type: 'preset', index });
  },
  onControl(id, value) {
    edits.set(id, value);
    if (id === 'soft' || id === 'sostenuto' || id === 'sustain') inputs.setPanelPedals({ [id]: value });
    send({ type: 'control', id, value });
  }
});
