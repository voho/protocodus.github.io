import { divisions } from './metadata.js';

const settingGroups = [
  ['Couplers & tremulants', 'couplers', id => /^(coupler_|tremulant_)/.test(id)],
  ['Wind & action', 'wind', id => ['wind_supply', 'pressure', 'wind', 'blower', 'action', 'dead_pipes', 'ciphers', 'runnings'].includes(id)],
  ['Tuning & voicing', 'tuning', id => ['temperament', 'pitch', 'temperature', 'tuning', 'voicing'].includes(id)],
  ['Church acoustics', 'acoustics', id => ['room', 'room_size', 'decay', 'decay_bass', 'decay_treble', 'width', 'seat'].includes(id)],
  ['Division mixer', 'mixer', id => /^(level|mute|solo)_/.test(id)],
];
const roman = ['I', 'II', 'III', 'P'];
const couplerNames = {
  coupler_pos_hw: 'II to I', coupler_rec_hw: 'III to I', coupler_rec_pos: 'III to II',
  coupler_hw_ped: 'I to P', coupler_pos_ped: 'II to P', coupler_rec_ped: 'III to P',
  tremulant_pos: 'Trem. II', tremulant_rec: 'Trem. III',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text) {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function physicalLabel(control, value) {
  if (!control.unit && control.min === 0 && control.max === 1) return Math.round(value * 100) + '%';
  const number = Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return number + (control.unit === '%' ? '%' : control.unit ? ' ' + (control.unit === 'C' ? '°C' : control.unit) : '');
}

export function createPanel({ controls, presets, onControl, onPreset, initialPreset = 0 }) {
  const readout = document.getElementById('current-registration');
  const updateViews = [];
  const stops = [];
  let values = controls.map(control => control.initial);
  let currentPreset = initialPreset;
  let selectedPiston;

  // Keep every piston visible. The building or region appears on its bank
  // once, while each button retains the complete factory name for assistive UI.
  const banks = new Map();
  const presetButtons = presets.map((preset, index) => {
    const grouped = preset.group !== 'Registrations';
    const space = preset.name.indexOf(' ');
    const groupName = grouped ? preset.name.slice(0, space) : 'Voices & ensembles';
    const label = grouped ? preset.name.slice(space + 1) : preset.name;
    if (!banks.has(groupName)) {
      const bank = element('section', 'preset-group');
      const grid = element('div', 'pistons');
      bank.append(element('h3', '', groupName), grid);
      document.getElementById('preset-bank').append(bank);
      banks.set(groupName, grid);
      if (!grouped) bank.classList.add('ensembles');
      if (groupName === 'Church') bank.classList.add('church');
    }
    const piston = button('preset-button', label);
    piston.id = 'preset-' + index;
    piston.setAttribute('aria-label', preset.name);
    piston.setAttribute('aria-pressed', 'false');
    piston.title = preset.name;
    piston.addEventListener('click', () => onPreset(index));
    banks.get(groupName).append(piston);
    return piston;
  });
  const divisionGrids = divisions.map((name, index) => {
    const group = element('section', 'division');
    group.id = 'division-' + index;
    const heading = element('h2');
    heading.append(element('span', 'roman', roman[index]), document.createTextNode(name));
    const grid = element('div', 'stop-grid');
    group.append(heading, grid);
    document.getElementById(index < 2 ? 'stops-left' : 'stops-right').append(group);
    return grid;
  });

  const updateRegistration = () => {
    const preset = presets[currentPreset];
    const edited = values.some((value, i) => Math.abs(value - preset.values[i]) > 1e-8);
    const description = preset.name + (edited ? ' (edited)' : '');
    if (readout.textContent !== description) readout.textContent = description;
    const nextPiston = edited ? undefined : presetButtons[currentPreset];
    if (nextPiston !== selectedPiston) {
      selectedPiston?.setAttribute('aria-pressed', 'false');
      nextPiston?.setAttribute('aria-pressed', 'true');
      selectedPiston = nextPiston;
    }
  };
  const updateCount = () => {
    const drawn = stops.filter(index => values[index] > 0).length;
    document.getElementById('stop-count').textContent = drawn + (drawn === 1 ? ' stop' : ' stops');
  };
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
    const row = element('div', 'stop');
    const toggle = button('stop-button', control.name.replaceAll("'", '′'));
    toggle.id = 'control-' + control.id;
    toggle.addEventListener('click', () => edit(index, values[index] > 0 ? 0 : 1));
    const slider = element('input', 'draw-range');
    slider.type = 'range';
    slider.id = 'draw-' + control.id;
    slider.min = 0;
    slider.max = 1;
    slider.step = 'any';
    slider.setAttribute('aria-label', divisions[control.division] + ' ' + control.name + ' draw');
    slider.addEventListener('input', () => edit(index, slider.valueAsNumber));
    updateViews[index] = value => {
      const description = physicalLabel(control, value);
      row.classList.toggle('drawn', value > 0);
      toggle.setAttribute('aria-pressed', String(value > 0));
      slider.value = value;
      slider.setAttribute('aria-valuetext', description);
      toggle.title = slider.title = control.name + ' · ' + description + ' drawn';
    };
    row.append(toggle, slider);
    divisionGrids[control.division].append(row);
    stops.push(index);
  }

  function createRange(control, index, title) {
    const row = element('div', 'range-control');
    const label = element('label', 'range-label', title);
    const slider = element('input');
    const output = element('output');
    slider.type = 'range';
    slider.id = label.htmlFor = 'control-' + control.id;
    slider.setAttribute('aria-label', control.name);
    output.setAttribute('for', slider.id);
    // Values exchanged with the engine are physical. Only the thumb position
    // on a logarithmic control is normalised.
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
      output.value = physicalLabel(control, value);
      slider.setAttribute('aria-valuetext', output.value);
    };
    row.append(label, slider, output);
    return row;
  }

  function createChoice(control, index, title) {
    const group = element('div', 'choice');
    group.id = 'control-' + control.id;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', title);
    const options = element('div', 'options');
    const buttons = control.options.map((option, i) => {
      const pick = button('choice-button', option);
      pick.id = group.id + '-' + i;
      pick.addEventListener('click', () => edit(index, i));
      options.append(pick);
      return pick;
    });
    updateViews[index] = value => buttons.forEach((pick, i) => pick.setAttribute('aria-pressed', String(i === value)));
    group.append(element('span', 'choice-label', title), options);
    return group;
  }

  function createSwitch(control, index) {
    const shortName = couplerNames[control.id] || control.name.split(' ').at(-1);
    const toggle = button('switch', shortName);
    toggle.id = 'control-' + control.id;
    toggle.setAttribute('aria-label', control.name);
    toggle.title = control.name;
    toggle.addEventListener('click', () => edit(index, values[index] ? 0 : 1));
    updateViews[index] = value => { toggle.setAttribute('aria-pressed', String(Boolean(value))); };
    return toggle;
  }

  const settings = settingGroups.map(([title, id, includes]) => {
    const group = element('section', 'setting-strip ' + id);
    const grid = element('div', 'parameter-grid');
    group.append(element('h2', '', title), grid);
    document.getElementById('settings-groups').append(group);
    return { grid, includes };
  });
  controls.forEach((control, index) => {
    if (Number.isInteger(control.division)) {
      createStop(control, index);
      return;
    }
    let title = control.name;
    if (control.id === 'keyboard') title = 'Keyboard / MIDI';
    if (control.id.startsWith('level_')) title = control.name.split(' ')[0].replace('Recit', 'Récit');
    if (control.id.startsWith('tremulant_')) title = control.name.replace('Tremulant ', '');
    const view = control.options ? createChoice(control, index, title)
      : control.steps === 2 ? createSwitch(control, index) : createRange(control, index, title);
    const primaries = {
      volume: 'performance-controls', swell: 'performance-controls', crescendo: 'performance-controls',
      keyboard: 'manual-control', pedal_keys: 'pedal-control',
    };
    const parent = primaries[control.id] ? document.getElementById(primaries[control.id]) : settings.find(group => group.includes(control.id)).grid;
    parent.append(view);
  });

  function setValues(nextValues, presetIndex = currentPreset) {
    currentPreset = presetIndex;
    values = Array.from(nextValues);
    updateViews.forEach((update, index) => update(values[index]));
    updateCount();
    updateRegistration();
  }
  setValues(presets[initialPreset].values, initialPreset);
  return { setValues, setControl };
}
