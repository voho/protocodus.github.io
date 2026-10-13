// Run with: node tests/voices-check.mjs
// Casting the radio voices and pacing their lines.
import { test, run, assert } from './harness.mjs';
import { castVoices, createVoices, rateFor } from '../js/voices.js';

const V = (name, lang, localService = true) => ({ name, lang, localService });
const MAC = [
  V('Samantha', 'en-US'), V('Daniel', 'en-GB'), V('Karen', 'en-AU'), V('Moira', 'en-IE'), V('Tessa', 'en-ZA'),
  V('Rishi', 'en-IN'), V('Fred', 'en-US'), V('Zarvox', 'en-US'), V('Trinoids', 'en-US'), V('Bad News', 'en-US'),
  V('Flo (English (UK))', 'en-GB'), V('Eddy (English (US))', 'en-US'), V('Amélie', 'fr-CA'),
];
const WINDOWS = [V('Microsoft David - English (United States)', 'en-US'), V('Microsoft Zira - English (United States)', 'en-US')];
const FEMALE = ['doukas', 'wren', 'okonkwo', 'varlaam', 'ember'];
const MALE = ['saint', 'ferrante', 'perpetua', 'halo', 'mule'];

test('every speaker gets a voice, and the player none', () => {
  const cast = castVoices(MAC);
  for (const who of [...FEMALE, ...MALE, 'tender', 'system', 'harrow']) assert.ok(cast.get(who)?.voice, who);
  assert.equal(cast.has('you'), false);
});
test('voices follow the script: women and men as written', () => {
  for (const list of [MAC, WINDOWS]) {
    const cast = castVoices(list);
    for (const who of FEMALE) assert.ok(/samantha|karen|moira|tessa|flo|zira/i.test(cast.get(who).voice.name), `${who}: ${cast.get(who).voice.name}`);
    for (const who of MALE) assert.ok(/daniel|rishi|eddy|david/i.test(cast.get(who).voice.name), `${who}: ${cast.get(who).voice.name}`);
  }
});
test('accents and quality decide among the rest; novelty voices never speak', () => {
  const cast = castVoices(MAC);
  assert.equal(cast.get('okonkwo').voice.name, 'Tessa');
  assert.equal(cast.get('wren').voice.name, 'Samantha');
  assert.equal(cast.get('harrow').voice.name, 'Trinoids');
  for (const [, part] of cast) assert.ok(!/bad news|amélie/i.test(part.voice.name));
  // The flat Eloquence voices only when nothing better is left.
  assert.notEqual(cast.get('doukas').voice.name, 'Flo (English (UK))');
});
test('two parts on one voice are told well apart by pitch', () => {
  for (const list of [MAC, WINDOWS]) {
    const byVoice = new Map();
    for (const [, p] of castVoices(list)) byVoice.set(p.voice, [...(byVoice.get(p.voice) ?? []), p.pitch]);
    for (const [v, ps] of byVoice) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.abs(ps[i] - ps[j]) >= 0.079, `${v.name}: ${ps}`);
  }
});
test('the narrator, never on the radio, gets the best voice; flat voices only fill gaps', () => {
  const cast = castVoices(MAC);
  assert.equal(cast.get('narrator').voice.name, 'Daniel');
  for (const [who, p] of cast) assert.ok(!/eddy|flo/i.test(p.voice.name), `${who}: ${p.voice.name}`);
});
test('without an English voice the radio is only read', () => {
  assert.equal(castVoices([V('Anna', 'de-DE')]).size, 0);
  assert.equal(castVoices([]).size, 0);
});
test('a line is spoken faster when it would outlast its time on screen, never past understanding', () => {
  assert.equal(rateFor('x'.repeat(40), 4, 1), 1);
  assert.ok(rateFor('x'.repeat(100), 7, 1) > 1.05);
  assert.equal(rateFor('x'.repeat(130), 7, 1), 1.2);
  assert.equal(rateFor('x'.repeat(400), 8.7, 1), 1.2);
  assert.equal(rateFor('short', 0.2, 1.08), 1.08);
});
test('in Node the radio is tracked but nothing is spoken', () => {
  const voices = createVoices();
  assert.equal(voices.available, false);
  const world = { mission: { time: 5, radio: [{ who: 'doukas', text: 'One', at: 0, dur: 3 }, { who: 'saint', text: 'Two', at: 3, dur: 3 }, { who: 'wren', text: 'Three', at: 8, dur: 3 }] } };
  assert.equal(voices.update(world, false), 2);
  assert.equal(voices.update(world, false), 0);
  world.mission.time = 9;
  assert.equal(voices.update(world, false), 1);
});
await run();
