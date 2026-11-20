import { divisions as divisionNames } from './metadata.js';

// The engine and the controls exchange physical values. Only the position of a
// logarithmic slider is normalised, matching the native instrument's mapping.
const settingGroups = [
  ['Couplers & tremulants', id => id.startsWith('coupler_') || id.startsWith('tremulant_')],
  ['Wind & action', id => ['wind_supply', 'pressure', 'wind', 'blower', 'action', 'dead_pipes', 'ciphers', 'runnings'].includes(id)],
  ['Tuning & voicing', id => ['temperament', 'pitch', 'temperature', 'tuning', 'voicing'].includes(id)],
  ['Church acoustics', id => ['room', 'room_size', 'decay', 'decay_bass', 'decay_treble', 'width', 'seat'].includes(id)],
  ['Division mixer', id => /^(level|mute|solo)_/.test(id)],
];
const roman = ['I', 'II', 'III', 'P'];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function physicalLabel(control, value) {
  if (!control.unit && control.min === 0 && control.max === 1) return Math.round(value * 100) + '%';
  const number = Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return number + (control.unit === '%' ? '%' : control.unit ? ' ' + (control.unit === 'C' ? '°C' : control.unit) : '');
}

export function createPanel({ controls, presets, onControl, onPreset }) {
  const registration = document.getElementById('registration');
  const keyboard = document.getElementById('keyboard');
  const stopBank = document.getElementById('stop-bank');
  const fineDraw = document.getElementById('fine-draw');
  const updateViews = [];
  const stopRows = [];
  const settings = [];
  let values = controls.map(control => control.initial);
  let currentPreset = 0;

  const edited = new Option('Edited registration', '');
  edited.disabled = true;
  edited.hidden = true;
  registration.add(edited);
  const groups = new Map();
  presets.forEach((preset, index) => {
    if (!groups.has(preset.group)) {
      const group = element('optgroup');
      group.label = preset.group;
      registration.append(group);
      groups.set(preset.group, group);
    }
    groups.get(preset.group).append(new Option(preset.name, index));
  });
  // A mouse or touch selection returns the player to the keys. Keyboard-only
  // selection keeps the native picker's arrows and type-ahead available.
  function bindChoice(select, apply) {
    let pointerChoice = false;
    select.addEventListener('pointerdown', event => { pointerChoice = event.button === 0; });
    for (const event of ['keydown', 'blur', 'pointercancel']) {
      select.addEventListener(event, () => { pointerChoice = false; });
    }
    select.addEventListener('change', () => {
      apply(Number(select.value));
      if (pointerChoice) {
        pointerChoice = false;
        keyboard.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
      }
    });
  }
  bindChoice(registration, onPreset);
  function stepPreset(direction) {
    onPreset((currentPreset + direction + presets.length) % presets.length);
  }
  document.getElementById('preset-prev').addEventListener('click', () => stepPreset(-1));
  document.getElementById('preset-next').addEventListener('click', () => stepPreset(1));

  const updateRegistration = () => {
    const preset = presets[currentPreset];
    const changed = values.some((value, i) => Math.abs(value - preset.values[i]) > 1e-8);
    edited.text = preset.name + ' (edited)';
    registration.value = changed ? '' : String(currentPreset);
  };
  const updateCount = () => {
    const drawn = stopRows.filter(row => values[row.index] > 0).length;
    document.getElementById('stop-count').textContent = drawn + ' drawn';
  };

  const filterButtons = divisionNames.map((name, index) => {
    const button = element('button', 'division-tab');
    button.type = 'button';
    button.id = 'division-' + index;
    button.append(element('span', 'roman', roman[index]), document.createTextNode(name));
    button.setAttribute('aria-controls', 'stop-bank');
    button.addEventListener('click', () => showDivision(index));
    document.getElementById('division-filters').append(button);
    return button;
  });
  function showDivision(division) {
    filterButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === division)));
    stopRows.forEach(row => { row.node.hidden = row.division !== division; });
  }

  function setControl(index, value) {
    values[index] = value;
    updateViews[index](value);
    if (controls[index].division !== undefined) updateCount();
    updateRegistration();
  }
  function edit(index, value) {
    setControl(index, value);
    onControl(index, value);
  }

  function createStop(control, index) {
    const node = element('div', 'stop');
    const button = element('button', 'stop-button', control.name);
    button.type = 'button';
    button.id = 'control-' + control.id;
    button.addEventListener('click', () => edit(index, values[index] > 0 ? 0 : 1));
    const slider = element('input', 'draw-range');
    slider.type = 'range';
    slider.id = 'draw-' + control.id;
    slider.min = 0;
    slider.max = 1;
    slider.step = 'any';
    slider.hidden = true;
    slider.setAttribute('aria-label', divisionNames[control.division] + ' ' + control.name + ' draw');
    slider.addEventListener('input', () => edit(index, slider.valueAsNumber));
    updateViews[index] = value => {
      const drawn = value > 0;
      const description = physicalLabel(control, value);
      node.classList.toggle('drawn', drawn);
      slider.value = value;
      slider.setAttribute('aria-valuetext', description);
      button.setAttribute('aria-pressed', String(drawn));
      button.title = control.name + ' · ' + description + ' drawn';
    };
    node.append(button, slider);
    stopBank.append(node);
    stopRows.push({ node, index, slider, division: control.division });
  }
  fineDraw.addEventListener('change', () => {
    stopRows.forEach(row => { row.slider.hidden = !fineDraw.checked; });
  });

  function createRange(control, index, title) {
    const row = element('div', 'range-control');
    const head = element('div', 'range-head');
    const label = element('label', 'range-label', title);
    const slider = element('input');
    const output = element('output');
    slider.type = 'range';
    slider.id = label.htmlFor = 'control-' + control.id;
    output.setAttribute('for', slider.id);
    const log = control.curve === 'log';
    slider.min = log ? 0 : control.min;
    slider.max = log ? 1 : control.max;
    slider.step = 'any';
    slider.addEventListener('input', () => {
      const position = slider.valueAsNumber;
      edit(index, log ? control.min * Math.pow(control.max / control.min, position) : position);
    });
    updateViews[index] = value => {
      slider.value = log ? Math.log(value / control.min) / Math.log(control.max / control.min) : value;
      const description = physicalLabel(control, value);
      output.value = description;
      slider.setAttribute('aria-valuetext', description);
    };
    head.append(label, output);
    row.append(head, slider);
    return row;
  }

  function createChoice(control, index, title) {
    const row = element('div', 'parameter-choice');
    const label = element('label', '', title);
    const select = element('select');
    select.id = label.htmlFor = 'control-' + control.id;
    control.options.forEach((name, i) => select.add(new Option(name, i)));
    bindChoice(select, value => edit(index, value));
    updateViews[index] = value => { select.value = value; };
    row.append(label, select);
    return row;
  }

  function createSwitch(control, index) {
    const label = element('label', 'switch');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'control-' + control.id;
    checkbox.addEventListener('change', () => edit(index, Number(checkbox.checked)));
    updateViews[index] = value => { checkbox.checked = Boolean(value); };
    label.append(checkbox, document.createTextNode(control.name));
    return label;
  }

  const groupsContainer = document.getElementById('settings-groups');
  settingGroups.forEach(([title, includes]) => {
    const group = element('details');
    const grid = element('div', 'parameter-grid');
    group.append(element('summary', '', title), grid);
    groupsContainer.append(group);
    settings.push({ grid, includes });
  });

  controls.forEach((control, index) => {
    if (Number.isInteger(control.division)) {
      createStop(control, index);
      return;
    }
    const title = control.id === 'keyboard' ? 'Manual' : control.name;
    const view = control.options
      ? createChoice(control, index, title)
      : control.steps === 2 ? createSwitch(control, index) : createRange(control, index, title);
    const primary = {
      volume: 'volume-control',
      keyboard: 'manual-control',
      pedal_keys: 'pedal-control',
      swell: 'expression-controls',
      crescendo: 'expression-controls',
    }[control.id];
    const parent = primary ? document.getElementById(primary) : settings.find(group => group.includes(control.id)).grid;
    parent.append(view);
  });
  showDivision(0);

  function setValues(nextValues, presetIndex = currentPreset) {
    currentPreset = presetIndex;
    values = Array.from(nextValues);
    updateViews.forEach((update, index) => update(values[index]));
    updateCount();
    updateRegistration();
  }
  setValues(presets[0].values, 0);
  return { setValues, setControl };
}
