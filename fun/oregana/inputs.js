// Physical key positions stay the same across computer keyboard layouts.
const bindings = [
  'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'
];
const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pitchName = note => pitchNames[note % 12] + (Math.floor(note / 12) - 1);
const firstNote = 21;
const lastNote = 108;
const divisions = ['Hauptwerk', 'Positiv', 'Récit', 'Pedal'];
const manualOrder = [2, 1, 0, 3];
const routed = 4; // Computer and MIDI notes follow the host's manual and pedal controls.

// Pointer, keyboard and device owners hold a shared pallet until the last one releases it.
export function setupInputs({ startAudio, noteOn, noteOff, divisionNoteOn, divisionNoteOff, setWheel, setExpression, setBend, panic }) {
  const keyboard = document.getElementById('keyboard');
  const octaveDown = document.getElementById('octave-down');
  const octaveUp = document.getElementById('octave-up');
  const keyboardRange = document.getElementById('keyboard-range');
  const midiButton = document.getElementById('midi-connect');
  const midiStatus = document.getElementById('midi-status');
  const held = new Map();
  const owners = Array.from({ length: 5 }, () => new Uint16Array(128));
  const pointers = new Set();
  const keybeds = divisions.map(() => new Map());
  let baseNote = 48;
  let manual = 0;
  let pedalMode = 1;

  function refreshLights() {
    const routedNotes = owners[routed];
    const lowest = pedalMode === 1 ? routedNotes.findIndex(count => count > 0) : -1;
    for (const [division, keys] of keybeds.entries()) {
      for (const [note, key] of keys) {
        const split = pedalMode === 2 && note < 48;
        const receives = division === 3 ? split || note === lowest : division === manual && !split;
        const pressed = owners[division][note] > 0 || (receives && routedNotes[note] > 0);
        if (key.getAttribute('aria-pressed') !== String(pressed)) key.setAttribute('aria-pressed', String(pressed));
      }
    }
  }

  function setRouting(selectedManual, selectedPedalMode) {
    manual = selectedManual;
    pedalMode = selectedPedalMode;
    keyboard.querySelectorAll('.organ-deck-row').forEach(row => {
      row.dataset.selected = String(Number(row.dataset.division) === manual);
    });
    refreshLights();
  }

  function release(owner, velocity = 64) {
    const key = held.get(owner);
    if (!key) return;
    const { division, note } = key;
    held.delete(owner);
    if (--owners[division][note] === 0) {
      if (division === routed) noteOff(note, velocity);
      else divisionNoteOff(division, note, velocity);
      refreshLights();
    }
  }

  function press(owner, note, velocity = 64, division = routed) {
    const previous = held.get(owner);
    if (previous?.division === division && previous.note === note) return;
    release(owner);
    if (note < firstNote || note > lastNote) return;
    held.set(owner, { division, note });
    if (owners[division][note]++ === 0) {
      if (division === routed) noteOn(note, velocity);
      else divisionNoteOn(division, note, velocity);
      refreshLights();
    }
  }

  function releaseAll() {
    pointers.clear();
    for (const owner of held.keys()) release(owner);
  }

  function silence() {
    releaseAll();
    panic();
  }

  function drawManual(division, start, end) {
    const row = document.createElement('div');
    row.className = 'organ-deck-row';
    row.dataset.division = division;
    row.dataset.selected = String(division === manual);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', divisions[division] + (division === 3 ? 'board' : ' manual'));

    const label = document.createElement('div');
    label.className = 'manual-plaque';
    label.setAttribute('aria-hidden', 'true');
    const numeral = document.createElement('b');
    numeral.textContent = ['I', 'II', 'III', 'P'][division];
    const name = document.createElement('span');
    name.textContent = divisions[division];
    label.append(numeral, name);

    const bed = document.createElement('div');
    bed.className = 'organ-keybed';
    const keys = keybeds[division];
    keys.clear();
    let whites = 0;
    for (let note = start; note <= end; ++note) {
      const key = document.createElement('button');
      const natural = !pitchNames[note % 12].includes('♯');
      const tone = pitchName(note);
      key.type = 'button';
      key.className = natural ? 'organ-key ivory' : 'organ-key ebony';
      key.dataset.note = note;
      key.style.setProperty('--key-position', whites);
      key.tabIndex = note === start ? 0 : -1;
      key.setAttribute('aria-label', divisions[division] + ' ' + tone);
      key.setAttribute('aria-pressed', 'false');
      if (division !== 3) {
        const letter = document.createElement('span');
        letter.className = 'key-binding';
        letter.textContent = bindings[note - baseNote].replace(/^(Key|Digit)/, '');
        key.append(letter);
      }
      if (note % 12 === 0 || note === start) {
        const pitch = document.createElement('span');
        pitch.className = 'key-pitch';
        pitch.textContent = tone;
        key.append(pitch);
      }
      keys.set(note, key);
      bed.append(key);
      if (natural) whites++;
    }
    bed.style.setProperty('--white-keys', whites);
    row.append(label, bed);
    return row;
  }

  function drawKeys() {
    const start = Math.max(firstNote, baseNote);
    const end = Math.min(lastNote, baseNote + 24);
    keyboard.replaceChildren(...manualOrder.map(division =>
      division === 3 ? drawManual(3, 36, 67) : drawManual(division, start, end)));
    refreshLights();
    keyboardRange.textContent = pitchName(start) + ' – ' + pitchName(end);
    octaveDown.disabled = baseNote <= 12;
    octaveUp.disabled = baseNote >= 84;
  }

  function shiftOctave(direction) {
    const next = Math.max(12, Math.min(84, baseNote + direction * 12));
    if (next === baseNote) return;
    const activeKey = document.activeElement?.closest('.organ-key');
    baseNote = next;
    drawKeys();
    if (activeKey) {
      const division = keyDivision(activeKey);
      const keys = keybeds[division];
      const note = Number(activeKey.dataset.note) + (division === 3 ? 0 : direction * 12);
      (keys.get(note) || keys.values().next().value).focus({ preventScroll: true });
    }
  }

  function keyDivision(key) {
    return Number(key.closest('[data-division]').dataset.division);
  }

  function playKey(owner, key) {
    press(owner, Number(key.dataset.note), 64, keyDivision(key));
  }

  function playPointer(event, key) {
    const owner = 'pointer:' + event.pointerId;
    if (key && keyboard.contains(key)) playKey(owner, key);
    else release(owner);
  }

  keyboard.addEventListener('pointerdown', event => {
    const key = event.target.closest('.organ-key');
    if (!key || event.button !== 0) return;
    event.preventDefault();
    key.focus({ preventScroll: true });
    startAudio();
    pointers.add(event.pointerId);
    keyboard.setPointerCapture(event.pointerId);
    playPointer(event, key);
  });
  keyboard.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    playPointer(event, target?.closest('.organ-key'));
  });
  function endPointer(event) {
    pointers.delete(event.pointerId);
    release('pointer:' + event.pointerId);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    keyboard.addEventListener(event, endPointer);
  }

  // Screen reader and switch controls can send a click without a pointer or key event.
  keyboard.addEventListener('click', event => {
    const key = event.target.closest('.organ-key');
    if (event.detail !== 0 || !key) return;
    startAudio();
    const owner = Symbol();
    playKey(owner, key);
    window.setTimeout(() => release(owner), 300);
  });

  octaveDown.addEventListener('click', () => shiftOctave(-1));
  octaveUp.addEventListener('click', () => shiftOctave(1));
  document.getElementById('panic').addEventListener('click', silence);
  keyboard.addEventListener('focusin', event => {
    const key = event.target.closest('.organ-key');
    if (!key) return;
    key.parentElement.querySelector('[tabindex="0"]').tabIndex = -1;
    key.tabIndex = 0;
  });

  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target.isContentEditable || target.closest?.('select, textarea, input:not([type=range]):not([type=checkbox]):not([type=button])')) return;
    const key = target.closest?.('.organ-key');
    if (key && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const note = Number(key.dataset.note);
      const division = keyDivision(key);
      let keys = keybeds[division];
      let to = note;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const next = manualOrder.indexOf(division) + (event.key === 'ArrowUp' ? -1 : 1);
        if (manualOrder[next] === undefined) return;
        keys = keybeds[manualOrder[next]];
        to = Math.max(keys.keys().next().value, Math.min(note, keys.keys().next().value + keys.size - 1));
      } else {
        const first = keys.keys().next().value;
        to = { ArrowLeft: note - 1, ArrowRight: note + 1, Home: first, End: first + keys.size - 1 }[event.key];
      }
      keys.get(to)?.focus({ preventScroll: true });
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault();
      if (!event.repeat) shiftOctave(event.code === 'BracketLeft' ? -1 : 1);
      return;
    }
    const index = bindings.indexOf(event.code);
    const activateKey = key && (event.code === 'Space' || event.code === 'Enter');
    if (index < 0 && !activateKey) return;
    event.preventDefault();
    if (!event.repeat) {
      startAudio();
      if (activateKey) playKey('key:' + event.code, key);
      else press('key:' + event.code, baseNote + index);
    }
  });
  window.addEventListener('keyup', event => {
    const owner = 'key:' + event.code;
    if (held.has(owner)) {
      event.preventDefault();
      release(owner);
    }
  });
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  const devices = new Map();
  const controllers = [
    { send: setWheel, initial: 0, owner: null },
    { send: setExpression, initial: 1, owner: null },
    { send: setBend, initial: 0, owner: null }
  ];
  let access = null;

  function setController(index, value, port) {
    controllers[index].owner = port;
    controllers[index].send(value);
  }

  function onMidi(data, port, sourcePrefix) {
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const channelPrefix = sourcePrefix + (data[0] & 15) + ':';
    const number = data[1] & 127;
    const value = data[2] & 127;
    const owner = channelPrefix + number;
    if (status === 0x90 && value) {
      if (!document.hidden) press(owner, number, value);
    } else if (status === 0x80 || status === 0x90) {
      release(owner, value || 64);
    } else if (status === 0xe0) {
      setController(2, (((value << 7) | number) - 8192) / 8192, port);
    } else if (status === 0xb0) {
      if (number === 1) setController(0, value / 127, port);
      if (number === 11) setController(1, value / 127, port);
      if (number === 120) silence();
      if (number === 123) releaseMidi(channelPrefix);
    }
  }

  function releaseMidi(prefix) {
    for (const owner of held.keys()) {
      if (typeof owner === 'string' && owner.startsWith(prefix)) release(owner);
    }
  }

  function detachPort(port) {
    port.onmidimessage = null;
    releaseMidi(devices.get(port));
    devices.delete(port);
    for (const controller of controllers) {
      if (controller.owner === port) {
        controller.owner = null;
        controller.send(controller.initial);
      }
    }
  }

  function refreshMidi() {
    const connected = new Set([...access.inputs.values()].filter(port => port.state === 'connected'));
    for (const port of devices.keys()) {
      if (!connected.has(port)) detachPort(port);
    }
    for (const port of connected) {
      if (devices.has(port)) continue;
      const prefix = 'midi:' + encodeURIComponent(port.id) + ':';
      devices.set(port, prefix);
      port.onmidimessage = event => onMidi(event.data, port, prefix);
    }
    const names = [...connected].map(port => port.name || 'MIDI input');
    midiStatus.textContent = names.length ? names.join(', ') : 'Waiting for a MIDI keyboard';
  }

  async function toggleMidi() {
    if (access) {
      access.onstatechange = null;
      for (const port of devices.keys()) {
        detachPort(port);
        port.close().catch(() => {});
      }
      access = null;
      midiButton.textContent = 'Connect MIDI';
      midiStatus.textContent = 'Disconnected';
      return;
    }
    startAudio();
    midiButton.disabled = true;
    midiStatus.textContent = 'Requesting access…';
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = refreshMidi;
      refreshMidi();
      midiButton.textContent = 'Disconnect MIDI';
    } catch (error) {
      midiStatus.textContent = error.name === 'NotAllowedError' || error.name === 'SecurityError'
        ? 'MIDI access blocked. Allow MIDI in your browser to connect.'
        : 'Could not open MIDI. Try connecting again.';
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
  drawKeys();
  return { releaseAll, setRouting };
}
