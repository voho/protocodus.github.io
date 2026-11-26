import { controls, presets } from './metadata.js';
import { createPanel } from './panel.js';
import { setupInputs } from './inputs.js';

import { createInstrumentAudio } from '../shared/instrument-audio.js';

// This light factory registration has sounding stops on all four keybeds.
let preset = presets.findIndex(registration => registration.name === 'Chapel Italian');
const edits = new Map();
const manualIndex = controls.findIndex(control => control.id === 'keyboard');
const pedalIndex = controls.findIndex(control => control.id === 'pedal_keys');
let wheel = 0, expression = 1, bend = 0;
const { startAudio, send, perform, panic } = createInstrumentAudio({
  baseUrl: import.meta.url, processor: 'oregana', instrument: 'organ', accelerator: './dsp/organ-simd.wasm',
  minimumRate: 44100, preferredRate: 48000, releaseAll: () => inputs.releaseAll(),
  configure: notes => ({ type: 'configure', preset, edits: [...edits], wheel, expression, bend, notes })
});

function play(type, note, velocity, division) {
  perform(division === undefined ? { type, note, velocity } : { type, division, note, velocity });
}

function updateRouting() {
  const value = index => edits.get(index) ?? presets[preset].values[index];
  inputs.setRouting(value(manualIndex), value(pedalIndex));
}

const panel = createPanel({
  controls, presets, initialPreset: preset,
  onPreset(index) {
    preset = index;
    edits.clear();
    panel.setValues(presets[index].values, index);
    updateRouting();
    send({ type: 'preset', index });
  },
  onControl(index, value) {
    if (value === presets[preset].values[index]) edits.delete(index);
    else edits.set(index, value);
    if (index === manualIndex || index === pedalIndex) updateRouting();
    send({ type: 'control', index, value });
  }
});

const inputs = setupInputs({
  startAudio,
  noteOn: (note, velocity) => play('noteOn', note, velocity),
  noteOff: (note, velocity) => play('noteOff', note, velocity),
  divisionNoteOn: (division, note, velocity) => play('divisionNoteOn', note, velocity, division),
  divisionNoteOff: (division, note, velocity) => play('divisionNoteOff', note, velocity, division),
  setWheel(value) { wheel = value; send({ type: 'controllers', wheel, expression }); },
  setExpression(value) { expression = value; send({ type: 'controllers', wheel, expression }); },
  setBend(value) { bend = value; send({ type: 'bend', value }); },
  panic
});
updateRouting();
