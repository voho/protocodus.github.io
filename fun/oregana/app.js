import { controls, presets } from './metadata.js';
import { createPanel } from './panel.js';
import { setupInputs } from './inputs.js';

const startButton = document.querySelector('#audio-start');
const status = document.querySelector('#audio-status');
// This light factory registration has sounding stops on all four keybeds.
let preset = presets.findIndex(registration => registration.name === 'Chapel Italian');
const edits = new Map();
const manualIndex = controls.findIndex(control => control.id === 'keyboard');
const pedalIndex = controls.findIndex(control => control.id === 'pedal_keys');
let wheel = 0, expression = 1, bend = 0;
let session = null;

function showAudio(label, message, active = false) {
  startButton.textContent = label;
  startButton.setAttribute('aria-pressed', String(active));
  status.textContent = message;
}

function send(event) {
  if (session?.ready) session.node.port.postMessage(event);
}

function stopAudio(message = 'Audio stopped') {
  const previous = session;
  session = null;
  delete status.dataset.renderer;
  inputs.releaseAll();
  if (previous) {
    previous.context.onstatechange = null;
    previous.node?.port.close();
    previous.node?.disconnect();
    previous.context.close().catch(() => {});
  }
  showAudio('Start audio', message);
}

function updateState(current) {
  if (session !== current || !current.ready) return;
  if (current.context.state === 'running') {
    showAudio('Stop audio', 'Audio on', true);
  } else {
    inputs.releaseAll();
    showAudio('Resume audio', 'Audio paused');
  }
}

// A minimal module returning i8x16.splat(0) tests SIMD without fetching the engine.
const simdProbe = Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,8,1,6,0,65,0,253,15,11);
let simdModule;

async function compileAccelerator() {
  if (!globalThis.WebAssembly?.validate(simdProbe)) return null;
  if (simdModule) return simdModule;
  const response = await fetch(new URL('./dsp/organ-simd.wasm', import.meta.url));
  if (!response.ok) throw new Error('Could not load the accelerated organ');
  simdModule = await WebAssembly.compile(await response.arrayBuffer());
  return simdModule;
}

async function loadOrgan(current, tryAcceleration = true) {
  const context = current.context;
  try {
    if (!context.audioWorklet) throw new Error('AudioWorklet unavailable');
    const module = tryAcceleration ? await compileAccelerator().catch(() => null) : null;
    if (session !== current) return;
    const entry = module ? './processor-simd.js' : './processor.js';
    let node;
    try {
      await context.audioWorklet.addModule(new URL(entry, import.meta.url));
      if (session !== current) return;
      node = new AudioWorkletNode(context, module ? 'oregana-simd' : 'oregana', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: module ? { module } : {}
      });
    } catch (error) {
      // Some environments support SIMD on the page but cannot send a module to a worklet.
      if (module) return loadOrgan(current, false);
      throw error;
    }
    current.node = node;
    node.onprocessorerror = () => {
      if (session !== current || current.node !== node) return;
      if (module && !current.ready) {
        node.port.close();
        node.disconnect();
        current.node = null;
        void loadOrgan(current, false);
      } else {
        stopAudio('The audio engine stopped. Start audio to try again.');
      }
    };
    node.port.onmessage = ({ data }) => {
      if (session !== current || current.node !== node || data.type !== 'ready') return;
      status.dataset.renderer = data.renderer;
      // Preserve a quick first press and release across the worklet download.
      // Bound replay time so the console catches up promptly even on a slow link.
      const notes = current.notes;
      if (notes.length) {
        const first = notes[0].time;
        const scale = Math.min(1, 160 / Math.max(1, notes[notes.length - 1].time - first));
        for (const note of notes) note.delayMs = (note.time - first) * scale;
      }
      node.port.postMessage({ type: 'configure', preset, edits: [...edits], wheel, expression, bend, notes });
      current.ready = true;
      current.notes = [];
      updateState(current);
    };
    node.connect(context.destination);
  } catch (error) {
    if (session !== current) return;
    console.error('Oregana audio initialization failed', error);
    stopAudio('Audio could not start. Use a browser with Web Audio on HTTPS or localhost, then retry.');
  }
}

function startAudio() {
  if (!session) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !window.isSecureContext) {
      showAudio('Start audio', 'Web Audio requires a compatible browser on HTTPS or localhost.');
      return;
    }
    try {
      let context;
      try {
        // Match the pipes' native rate when the device supports it.
        context = new Context({ sampleRate: 48000, latencyHint: 'interactive' });
      } catch (error) {
        if (error.name !== 'NotSupportedError') throw error;
        context = new Context({ latencyHint: 'interactive' });
      }
      if (context.sampleRate < 44100 || context.sampleRate > 192000) {
        void context.close();
        showAudio('Start audio', 'Choose an audio device running at 44.1–192 kHz.');
        return;
      }
      const current = session = { context, node: null, ready: false, notes: [] };
      context.onstatechange = () => updateState(current);
      showAudio('Starting…', 'Loading organ');
      void loadOrgan(current);
    } catch {
      showAudio('Start audio', 'The audio device could not open. Check your output device and retry.');
      return;
    }
  }
  // Resume inside the originating pointer/key gesture, before awaiting any module.
  const current = session;
  if (current && current.context.state !== 'running') {
    current.context.resume().catch(() => {
      if (session === current) stopAudio('Audio paused. Press Start audio to try again.');
    });
  }
}

function play(type, note, velocity, division) {
  if ((type === 'noteOn' || type === 'divisionNoteOn') && (!session || session.context.state !== 'running')) startAudio();
  if (!session) return;
  const event = division === undefined ? { type, note, velocity } : { type, division, note, velocity };
  if (session.ready) send(event);
  else session.notes.push({ ...event, time: performance.now() });
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
  panic() {
    if (session) session.notes = [];
    send({ type: 'panic' });
  }
});
updateRouting();

startButton.addEventListener('click', () => {
  if (session?.ready && session.context.state === 'running') stopAudio();
  else startAudio();
});
window.addEventListener('pagehide', () => stopAudio());
