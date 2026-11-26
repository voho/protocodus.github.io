const pianoLow = 21, pianoHigh = 108;
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = note => noteNames[note % 12] + (Math.floor(note / 12) - 1);
const bindings = [
  'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'
];
// Keyra's native momentary pedal switches. They coexist with continuous CC
// pedals, including a partially depressed damper, on the same MIDI channel.
const pedals = [
  { name: 'soft', note: 12, cc: 67 },
  { name: 'sostenuto', note: 13, cc: 66 },
  { name: 'sustain', note: 14, cc: 64 }
];

export function setupInputs({ startAudio, midi }) {
  const byId = id => document.getElementById(id);
  const keyboard = byId('keyboard');
  const bed = document.createElement('div');
  bed.className = 'piano-keybed';
  const keys = new Map();
  const pressed = new Map();
  const counts = new Uint32Array(128);
  const pointers = new Set();
  const ports = new Map();
  const controllerStates = new Map(); // port -> map of channel/controller -> value
  const panelPedals = { soft: 0, sostenuto: 0, sustain: 0 };
  const downOctave = byId('octave-down'), upOctave = byId('octave-up');
  const midiButton = byId('midi-connect'), midiStatus = byId('midi-status');
  let midiAccess = null, base = 48, focusNote = 60, order = 0;

  function effectiveController(channel, cc) {
    let value = cc === 128 ? 8192 : 0;
    let latest = -1;
    for (const states of controllerStates.values()) {
      const entry = states.get(channel * 129 + cc);
      if (!entry) continue;
      if (cc === 1 || cc === 128) {
        if (entry.order > latest) { latest = entry.order; value = entry.value; }
      } else {
        value = Math.max(value, entry.value);
      }
    }
    return value;
  }

  function updatePedals() {
    for (const pedal of pedals) {
      let depth = counts[pedal.note] ? 1 : panelPedals[pedal.name];
      for (let channel = 0; channel < 16; channel++) {
        depth = Math.max(depth, effectiveController(channel, pedal.cc) / 127);
      }
      byId('pedal-' + pedal.name).setAttribute('aria-pressed', String(
        pedal.name === 'sostenuto' ? depth >= 0.5 : depth > 0
      ));
    }
  }

  function setPanelPedals(values) {
    for (const { name } of pedals) {
      if (Number.isFinite(values[name])) panelPedals[name] = values[name];
    }
    updatePedals();
  }

  function showNote(note) {
    if (note >= pianoLow) keys.get(note)?.setAttribute('aria-pressed', String(counts[note] > 0));
    else updatePedals();
  }

  function release(owner, velocity = 0) {
    const press = pressed.get(owner);
    if (!press) return;
    midi(0x80 | press.channel, press.note, velocity);
    counts[press.note]--;
    if (--press.count === 0) pressed.delete(owner);
    showNote(press.note);
  }

  function attack(owner, note, velocity, channel = 0, port = null) {
    const previous = pressed.get(owner);
    if (previous && previous.note !== note) release(owner);
    const current = pressed.get(owner);
    // A MIDI sequencer may restrike a note before releasing its earlier
    // press. Keyra counts these and strikes a fresh hammer for every note-on.
    if (current && !port) return;
    if (current) current.count++;
    else pressed.set(owner, { note, channel, port, count: 1 });
    counts[note]++;
    midi(0x90 | channel, note, velocity);
    showNote(note);
  }

  function sendController(channel, cc, value) {
    if (cc === 128) midi(0xe0 | channel, value & 127, value >> 7);
    else midi(0xb0 | channel, cc, value);
  }

  function receiveController(port, channel, cc, value) {
    const states = controllerStates.get(port);
    states.set(channel * 129 + cc, { value, order: ++order });
    sendController(channel, cc, effectiveController(channel, cc));
    if (cc === 64 || cc === 66 || cc === 67) updatePedals();
  }

  function channelCommand(channel, cc, value) {
    if (cc === 120 || cc === 123) {
      // The native channel command releases every press and keyswitch. Forget
      // its owners here so a later key-up cannot release a new hammer strike.
      for (const [owner, press] of pressed) {
        if (press.channel !== channel) continue;
        counts[press.note] -= press.count;
        pressed.delete(owner);
        showNote(press.note);
      }
      if (channel === 0) pointers.clear();
    } else if (cc === 121) {
      for (const states of controllerStates.values()) {
        for (const id of states.keys()) if (Math.floor(id / 129) === channel) states.delete(id);
      }
    }
    midi(0xb0 | channel, cc, value);
    updatePedals();
  }

  function releaseAll() {
    pointers.clear();
    for (const [owner, press] of pressed) {
      while (press.count) release(owner);
    }
    const channels = new Set();
    for (const states of controllerStates.values()) {
      for (const id of states.keys()) channels.add(Math.floor(id / 129));
      states.clear();
    }
    for (const channel of channels) midi(0xb0 | channel, 121, 0);
    updatePedals();
  }

  function silence() {
    releaseAll();
    midi(0xb0, 120, 0); // Keyra's strings and room belong to one piano.
  }

  let whites = 0;
  for (let note = pianoLow; note <= pianoHigh; ++note) {
    const natural = !noteNames[note % 12].includes('♯');
    const key = document.createElement('button');
    key.type = 'button';
    key.className = natural ? 'piano-key ivory' : 'piano-key ebony';
    key.dataset.note = note;
    key.style.setProperty('--key-index', whites);
    key.tabIndex = note === focusNote ? 0 : -1;
    key.setAttribute('aria-label', noteName(note));
    key.setAttribute('aria-pressed', 'false');
    const binding = document.createElement('span');
    binding.className = 'key-binding';
    key.append(binding);
    if (note % 12 === 0 || note === pianoLow) {
      const pitch = document.createElement('span');
      pitch.className = 'key-pitch';
      pitch.textContent = noteName(note);
      key.append(pitch);
    }
    bed.append(key);
    keys.set(note, key);
    if (natural) whites++;
  }
  keyboard.append(bed);

  function centerKeys() {
    const first = keys.get(Math.max(pianoLow, base));
    const last = keys.get(Math.min(pianoHigh, base + 24));
    keyboard.scrollLeft = (first.offsetLeft + last.offsetLeft + last.offsetWidth - keyboard.clientWidth) / 2;
  }

  function mapKeys() {
    for (const [note, key] of keys) {
      const code = bindings[note - base];
      const letter = code?.replace(/^(Key|Digit)/, '') || '';
      key.firstElementChild.textContent = letter;
      key.setAttribute('aria-label', noteName(note) + (letter ? ', computer key ' + letter : ''));
    }
    byId('keyboard-range').textContent = noteName(Math.max(pianoLow, base)) + '–' + noteName(Math.min(pianoHigh, base + 24));
    downOctave.disabled = base <= 12;
    upOctave.disabled = base >= 84;
    centerKeys();
  }

  function shift(direction) {
    base = Math.max(12, Math.min(84, base + direction * 12));
    mapKeys();
  }

  mapKeys();
  if (window.ResizeObserver) new ResizeObserver(centerKeys).observe(keyboard);
  else window.addEventListener('resize', centerKeys);
  downOctave.addEventListener('click', () => shift(-1));
  upOctave.addEventListener('click', () => shift(1));
  byId('panic').addEventListener('click', silence);

  function playPointer(event, key) {
    const owner = 'pointer:' + event.pointerId;
    if (!key || !bed.contains(key)) { release(owner); return; }
    const rect = key.getBoundingClientRect();
    // Playing nearer the exposed end strikes harder. A pressure-sensitive
    // pen supplies its measured pressure instead.
    const depth = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure :
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    attack(owner, Number(key.dataset.note), Math.round(38 + depth * 89));
  }

  bed.addEventListener('pointerdown', event => {
    const key = event.target.closest('.piano-key');
    if (!key || event.button !== 0) return;
    event.preventDefault();
    key.focus({ preventScroll: true });
    startAudio();
    pointers.add(event.pointerId);
    bed.setPointerCapture(event.pointerId);
    playPointer(event, key);
  });
  bed.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) playPointer(event, document.elementFromPoint(event.clientX, event.clientY)?.closest('.piano-key'));
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    bed.addEventListener(name, event => {
      pointers.delete(event.pointerId);
      release('pointer:' + event.pointerId);
    });
  }
  bed.addEventListener('focusin', event => {
    const key = event.target.closest('.piano-key');
    if (!key) return;
    keys.get(focusNote).tabIndex = -1;
    focusNote = Number(key.dataset.note);
    key.tabIndex = 0;
  });

  function accessibleClick(event, note) {
    if (event.detail) return;
    const owner = Symbol();
    startAudio();
    attack(owner, note, note < pianoLow ? 127 : 88);
    setTimeout(() => release(owner), 300);
  }
  bed.addEventListener('click', event => {
    const key = event.target.closest('.piano-key');
    if (key) accessibleClick(event, Number(key.dataset.note));
  });

  for (const pedal of pedals) {
    const button = byId('pedal-' + pedal.name);
    button.dataset.pedalNote = pedal.note;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      button.focus({ preventScroll: true });
      startAudio();
      button.setPointerCapture(event.pointerId);
      attack('pedal:' + event.pointerId, pedal.note, 127);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(name, event => release('pedal:' + event.pointerId));
    }
    button.addEventListener('click', event => accessibleClick(event, pedal.note));
  }

  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target.isContentEditable || target.closest?.('select,textarea,input:not([type=range]):not([type=checkbox]):not([type=button])')) return;
    const key = target.closest?.('.piano-key');
    if (key && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const to = { ArrowLeft: focusNote - 1, ArrowRight: focusNote + 1, Home: pianoLow, End: pianoHigh };
      keys.get(to[event.key])?.focus();
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault();
      if (!event.repeat) shift(event.code === 'BracketLeft' ? -1 : 1);
      return;
    }
    const offset = bindings.indexOf(event.code);
    const pedal = target.closest?.('[data-pedal-note]');
    let note;
    if (offset >= 0) note = base + offset;
    else if (event.code === 'Space' || event.code === 'Enter') {
      if (pedal) note = Number(pedal.dataset.pedalNote);
      else if (key && event.code === 'Enter') note = Number(key.dataset.note);
      else if (event.code === 'Space' && (key || !target.closest?.('button,input,a,summary'))) note = 14;
    }
    if (note === undefined || (offset >= 0 && (note < pianoLow || note > pianoHigh))) return;
    event.preventDefault();
    if (!event.repeat) {
      startAudio();
      attack('key:' + event.code, note, note < pianoLow ? 127 : 88);
    }
  });
  window.addEventListener('keyup', event => {
    const owner = 'key:' + event.code;
    if (pressed.has(owner)) { event.preventDefault(); release(owner); }
  });
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  function onMidi(port, data) {
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0, channel = data[0] & 15;
    const number = data[1] & 127, value = data[2] & 127;
    if (status === 0x90 || status === 0x80) {
      if (!(number >= pianoLow && number <= pianoHigh) && !(number >= 12 && number <= 14)) return;
      const owner = 'midi:' + encodeURIComponent(port.id) + ':' + channel + ':' + number;
      if (status === 0x90 && value) {
        if (!document.hidden) attack(owner, number, value, channel, port);
      } else release(owner, value);
    } else if (status === 0xe0) {
      receiveController(port, channel, 128, (value << 7) | number);
    } else if (status === 0xb0) {
      if ([1, 64, 66, 67].includes(number)) receiveController(port, channel, number, value);
      else if ([120, 121, 123].includes(number)) channelCommand(channel, number, value);
    }
  }

  function detach(port) {
    port.onmidimessage = null;
    ports.delete(port.id);
    for (const [owner, press] of pressed) {
      if (press.port === port) while (press.count) release(owner);
    }
    const states = controllerStates.get(port);
    controllerStates.delete(port);
    let removedBend = false;
    for (const id of states.keys()) {
      const channel = Math.floor(id / 129), cc = id % 129;
      sendController(channel, cc, effectiveController(channel, cc));
      if (cc === 128) removedBend = true;
    }
    // The last wheel on any channel bends Keyra's shared strings. After
    // restoring the removed port's channels, restore that surviving wheel.
    if (removedBend) {
      let last = null, channel;
      for (const remaining of controllerStates.values()) {
        for (const [id, entry] of remaining) {
          if (id % 129 === 128 && (!last || entry.order > last.order)) {
            last = entry;
            channel = Math.floor(id / 129);
          }
        }
      }
      if (last) sendController(channel, 128, last.value);
    }
    updatePedals();
  }

  function refreshMidi() {
    const connected = [...midiAccess.inputs.values()].filter(port => port.state === 'connected');
    for (const port of ports.values()) if (!connected.includes(port)) detach(port);
    for (const port of connected) {
      if (ports.has(port.id)) continue;
      ports.set(port.id, port);
      controllerStates.set(port, new Map());
      port.onmidimessage = ({ data }) => onMidi(port, data);
    }
    midiStatus.textContent = connected.length ? connected.map(port => port.name || 'MIDI input').join(', ') : 'Waiting for a MIDI keyboard';
  }

  async function toggleMidi() {
    if (midiAccess) {
      midiAccess.onstatechange = null;
      for (const port of ports.values()) {
        detach(port);
        port.close().catch(() => {});
      }
      midiAccess = null;
      midiButton.textContent = 'Connect MIDI';
      midiStatus.textContent = 'Disconnected';
      return;
    }
    startAudio();
    midiButton.disabled = true;
    midiStatus.textContent = 'Requesting MIDI access…';
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = refreshMidi;
      refreshMidi();
      midiButton.textContent = 'Disconnect MIDI';
    } catch (error) {
      midiStatus.textContent = ['SecurityError', 'NotAllowedError'].includes(error.name)
        ? 'MIDI permission blocked. Allow MIDI in your browser to connect.'
        : 'Could not connect MIDI. Try again.';
    } finally {
      midiButton.disabled = false;
    }
  }
  if (navigator.requestMIDIAccess) {
    midiButton.addEventListener('click', toggleMidi);
    midiStatus.textContent = 'Disconnected';
  } else {
    midiButton.disabled = true;
    midiStatus.textContent = 'Web MIDI unavailable in this browser';
  }
  updatePedals();
  return { releaseAll, setPanelPedals };
}
