import test from 'node:test';
import assert from 'node:assert/strict';
import {RATE, RECIPES, SOUND_KINDS, AMBIENT_KINDS, ALIASES, VOICE_FAMILIES, VOICE_ROLES, VOICE_CONTEXTS, renderKind, renderVoice, voiceKey, voiceFamily, parseVoiceKey} from '../soundbank.js';

const peak = data => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
// Normalized correlation of two buffers over their shared length: 1 means the same waveform.
function similarity(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb || 1);
}
// Zero crossings per second: a coarse brightness measure that separates dark rumbles from bright clicks.
const crossings = data => { let count = 0; for (let i = 1; i < data.length; i++) if (data[i - 1] < 0 !== data[i] < 0) count++; return count / (data.length / RATE); };

test('every recipe renders finite, audible, normalized and click-free audio', () => {
  assert.deepEqual([...SOUND_KINDS, ...AMBIENT_KINDS].sort(), Object.keys(RECIPES).sort());
  assert.deepEqual(AMBIENT_KINDS.sort(), ['ambient.industry', 'ambient.lava', 'ambient.wind']);
  for (const [kind, recipe] of Object.entries(RECIPES)) {
    assert(['ui', 'weapons', 'impacts', 'alerts', 'ambient'].includes(recipe.bus), `${kind} routes to a mixer bus`);
    for (let variant = 0; variant < (recipe.variants || 1); variant++) {
      const data = renderKind(kind, variant);
      assert.equal(data.length, Math.round(recipe.duration * RATE), `${kind} keeps its declared length`);
      assert(data.every(Number.isFinite), `${kind}#${variant} is finite`);
      assert(Math.abs(peak(data) - recipe.level) < 1e-5 && peak(data) < 1, `${kind}#${variant} is normalized below full scale`);
      assert(rms(data) > .004, `${kind}#${variant} carries energy`);
      if (!recipe.loop) assert(Math.abs(data[0]) < .02 && Math.abs(data.at(-1)) < .02, `${kind}#${variant} starts and ends without a click`);
    }
  }
});

test('ambient beds loop seamlessly', () => {
  for (const kind of AMBIENT_KINDS) {
    const data = renderKind(kind);
    let largest = 0;
    for (let i = 1; i < data.length; i++) largest = Math.max(largest, Math.abs(data[i] - data[i - 1]));
    assert(Math.abs(data[0] - data.at(-1)) <= largest, `${kind} wraps no harder than its own largest step`);
    assert(RECIPES[kind].duration >= 4, `${kind} is long enough not to sound like a short loop`);
  }
});

test('renders are deterministic; variants and races sound different', () => {
  for (const kind of ['organics.rifle', 'aiUnity.tank', 'death.vehicle']) {
    assert.deepEqual(renderKind(kind, 1), renderKind(kind, 1), `${kind} renders identically every time`);
    assert(similarity(renderKind(kind, 0), renderKind(kind, 1)) < .9, `${kind} variants differ`);
  }
  for (const role of ['rifle', 'scout', 'striker', 'tank', 'artillery', 'rocket', 'rocketTower', 'turret']) {
    const organics = renderKind(`organics.${role}`), unity = renderKind(`aiUnity.${role}`);
    assert(Math.abs(similarity(organics, unity)) < .5, `Organics and Unity ${role} fire have distinct timbres`);
    assert.equal(RECIPES[`organics.${role}`].category, 'weapon');
    assert(RECIPES[`organics.${role}`].variants >= 2 && RECIPES[`aiUnity.${role}`].jitter > 0, `${role} fire varies between shots`);
  }
  assert(crossings(renderKind('death.building')) < crossings(renderKind('death.infantry')), 'A building collapse is darker than an infantry loss');
  assert(RECIPES['death.building'].duration > RECIPES['death.vehicle'].duration && RECIPES['death.vehicle'].duration > RECIPES['death.infantry'].duration, 'Deaths scale with size');
});

test('every gameplay cue has a recipe', () => {
  for (const kind of ['select', 'order', 'attackOrder', 'harvestOrder', 'rally', 'error', 'cancel', 'group', 'buildStart', 'buildComplete', 'unitReady', 'delivery', 'sell', 'repair', 'victory', 'defeat'])
    assert(RECIPES[kind], `${kind} interface cue`);
  for (const kind of ['underAttack', 'unitLost', 'structureLost', 'research', 'upgrade', 'promotion', 'powerDown', 'powerUp', 'reserve', 'objective', 'objectiveNew', 'objectiveFailed', 'wave', 'enemySpotted', 'warning', 'explored'])
    assert.equal(RECIPES[`alert.${kind}`]?.category, 'alert', `${kind} stinger`);
  for (const ability of ['digIn', 'longShot', 'flare', 'overdrive', 'afterburner', 'barrage', 'fieldPatch']) for (const race of ['organics', 'aiUnity'])
    assert(RECIPES[`${race}.${ability}`], `${race} ${ability} ability cue`);
  for (const kind of ['impact.rocket', 'impact.rocketHeavy', 'impact.shell', 'impact.whistle', 'death.infantry', 'death.robot', 'death.vehicle', 'death.small', 'death.building'])
    assert.equal(RECIPES[kind]?.category, 'impact', `${kind} impact`);
  for (const [alias, kind] of Object.entries(ALIASES)) assert(RECIPES[kind], `Alias ${alias} resolves`);
  for (const kind of ['victory', 'defeat']) assert(RECIPES[kind].duration >= 3, `${kind} is a long stinger`);
});

test('unit voices cover every family, role and context with bounded wordless lines', () => {
  assert.equal(voiceFamily('organics', 'rifle'), 'human');
  assert.equal(voiceFamily('organics', 'rocket'), 'vael', 'Organics rocket teams are Vael');
  assert.equal(voiceFamily('aiUnity', 'rocket'), 'unity');
  assert.equal(parseVoiceKey('voice.human.tank.select').role, 'tank');
  for (const bad of ['voice.human.tank', 'voice.elf.tank.select', 'voice.human.wall.select', 'voice.human.tank.dance', 'select']) assert.equal(parseVoiceKey(bad), null, bad);
  assert.throws(() => renderVoice('voice.human.wall.select'), RangeError);
  let longest = 0;
  for (const family of VOICE_FAMILIES) for (const role of VOICE_ROLES) for (const context of VOICE_CONTEXTS) {
    const data = renderVoice(voiceKey(family, role, context), 1);
    longest = Math.max(longest, data.length / RATE);
    assert(data.every(Number.isFinite) && peak(data) < 1 && rms(data) > .01, `${family} ${role} ${context} is audible and bounded`);
  }
  assert(longest < 2.5, 'Acknowledgements and transmissions stay short');
  const select = renderVoice('voice.human.rifle.select', 0), annoyed = renderVoice('voice.human.rifle.annoyed', 0);
  assert(annoyed.length > select.length, 'The annoyed reply is a longer line');
  assert.deepEqual(renderVoice('voice.unity.scout.move', 2), renderVoice('voice.unity.scout.move', 2));
  assert(Math.abs(similarity(renderVoice('voice.human.rifle.move', 0), renderVoice('voice.unity.rifle.move', 0))) < .5, 'Crews and machines speak differently');
  assert(crossings(renderVoice('voice.vael.rocket.select', 0)) < crossings(renderVoice('voice.human.scout.select', 0)), 'The Vael register sits below a human crew');
});

test('the full bank renders within a background budget', () => {
  const started = performance.now();
  let samples = 0;
  for (const [kind, recipe] of Object.entries(RECIPES)) for (let variant = 0; variant < (recipe.variants || 1); variant++) samples += renderKind(kind, variant).length;
  const elapsed = performance.now() - started;
  assert(samples / RATE < 120, `The effect bank stays compact (${(samples / RATE).toFixed(1)} s of audio)`);
  assert(elapsed < 4000, `The effect bank renders in ${elapsed.toFixed(0)} ms`);
});
