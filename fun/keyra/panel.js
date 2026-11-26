// Keyra's factory programs set the voicing and microphone blend. The player's
// output, tuning, mechanical level, microphone polarity and pedals persist.
const voicing = ['hammer', 'age', 'detune', 'stretch', 'dynamics', 'tuning', 'mechanics'];
const cabinet = ['lid', 'soundboard', 'sympathetic', 'duplex', 'room', 'width', 'felt', 'mute'];
const mechanicsExponent = Math.log(0.175 / 2) / Math.log(0.4);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, id, label) {
  const node = element('button', className, label);
  node.type = 'button';
  node.id = id;
  node.setAttribute('aria-pressed', 'false');
  return node;
}

function sliderPosition(id, value) {
  if (id !== 'mechanics') return value;
  return Math.pow(value / 2, 1 / mechanicsExponent);
}

function physicalValue(id, position) {
  if (id !== 'mechanics') return position;
  return position === 0.4 ? 0.175 : 2 * Math.pow(position, mechanicsExponent);
}

function displayValue(id, value) {
  if (id === 'tuning') return Number(value.toFixed(1)) + ' Hz';
  return Math.round(100 * sliderPosition(id, value)) + '%';
}

export function createPanel({ controls, presets, bodies, micNames, onPreset, onControl, initialPreset = 0 }) {
  const catalog = new Map(controls.map(control => [control.id, control]));
  const values = Object.fromEntries(controls.map(control => [control.id, control.initial]));
  const refresh = new Map();
  const readout = document.getElementById('current-preset');
  let currentPreset = initialPreset;
  let selectedButton;

  const presetButtons = presets.map((preset, index) => {
    const pick = button('preset', 'preset-' + index, preset.name);
    pick.addEventListener('click', () => {
      setPreset(index);
      onPreset(index);
    });
    document.getElementById('presets').append(pick);
    return pick;
  });

  function updatePreset() {
    const preset = presets[currentPreset];
    const edited = Object.entries(preset.values).some(([id, value]) => Math.abs(values[id] - value) > 1e-6);
    const name = preset.name + (edited ? ' (edited)' : '');
    if (readout.textContent !== name) readout.textContent = name;
    const next = edited ? undefined : presetButtons[currentPreset];
    if (next !== selectedButton) {
      selectedButton?.setAttribute('aria-pressed', 'false');
      next?.setAttribute('aria-pressed', 'true');
      selectedButton = next;
    }
  }

  function setControl(id, value) {
    values[id] = value;
    refresh.get(id)(value);
    updatePreset();
  }

  function edit(id, value) {
    setControl(id, value);
    onControl(id, value);
  }

  function addRange(parent, id, layout = 'parameter', labelText) {
    const control = catalog.get(id);
    const row = element('div', layout);
    const label = element('label', 'parameter-name', labelText || control.name);
    const slider = element('input');
    slider.type = 'range';
    slider.id = label.htmlFor = 'control-' + id;
    slider.min = control.min;
    slider.max = id === 'mechanics' ? 1 : control.max;
    slider.step = 'any';
    if (layout === 'fader') slider.setAttribute('aria-orientation', 'vertical');
    if (layout === 'pedal-position') label.classList.add('visually-hidden');
    const output = element('output');
    output.setAttribute('for', slider.id);
    slider.addEventListener('input', () => edit(id, physicalValue(id, slider.valueAsNumber)));
    refresh.set(id, value => {
      slider.value = sliderPosition(id, value);
      output.value = displayValue(id, value);
      slider.setAttribute('aria-valuetext', output.value);
      slider.title = control.name + ' · ' + output.value;
    });
    row.append(label, slider, output);
    parent.append(row);
  }

  const bodyGroup = element('div', 'body-options');
  bodyGroup.id = 'control-body';
  bodyGroup.setAttribute('role', 'group');
  bodyGroup.setAttribute('aria-labelledby', 'body-heading');
  const bodyButtons = bodies.map(body => {
    const pick = button('body-button', 'control-body-' + body.value, body.name);
    pick.addEventListener('click', () => edit('body', body.value));
    bodyGroup.append(pick);
    return pick;
  });
  refresh.set('body', value => {
    bodyButtons.forEach((pick, index) => pick.setAttribute('aria-pressed', String(bodies[index].value === value)));
  });
  document.getElementById('body-choices').append(bodyGroup);

  addRange(document.getElementById('master'), 'gain');
  for (const id of voicing) addRange(document.getElementById('voicing'), id);
  for (const id of cabinet) addRange(document.getElementById('cabinet'), id);
  for (const id of ['soft', 'sostenuto', 'sustain']) {
    addRange(document.getElementById('position-' + id), id, 'pedal-position', catalog.get(id).name + ' position');
  }
  for (const name of micNames) {
    const channel = element('div', 'channel');
    const id = 'invert' + name;
    const invert = button('invert', 'control-' + id, 'Invert');
    invert.setAttribute('aria-label', name + ' microphone polarity inversion');
    invert.title = 'Invert ' + name + ' microphone polarity';
    invert.addEventListener('click', () => edit(id, values[id] ? 0 : 1));
    refresh.set(id, value => invert.setAttribute('aria-pressed', String(Boolean(value))));
    addRange(channel, 'mic' + name, 'fader', name);
    channel.append(invert);
    document.getElementById('microphones').append(channel);
  }

  function setPreset(index) {
    currentPreset = index;
    Object.assign(values, presets[index].values);
    for (const [id, update] of refresh) update(values[id]);
    updatePreset();
  }
  setPreset(initialPreset);
  return { setControl, setPreset };
}
