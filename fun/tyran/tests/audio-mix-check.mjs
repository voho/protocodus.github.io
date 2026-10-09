// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/audio-mix-check.mjs
// Positional cues, reverb tails, music ducking, the critical-hull alarm and
// bounded synth layers, measured on the real Web Audio graph.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [];
const rms = page => page.evaluate(async () => {
  let peak = 0;
  const data = new Float32Array(meter.fftSize);
  for (let i = 0; i < 6; i++) {
    meter.getFloatTimeDomainData(data);
    peak = Math.max(peak, Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return peak;
});
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(async () => {
    const { AudioEngine } = await import('./audio.js');
    window.mix = new AudioEngine();
    const button = document.createElement('button'); button.id = 'mix-start'; button.textContent = 'Mix';
    button.style = 'position:fixed;top:0;left:0;z-index:99999';
    button.onclick = () => {
      mix.start(); mix.update(true);
      window.meter = mix.context.createAnalyser(); meter.fftSize = 2048; mix.transitionBus.connect(meter);
      // Record every panner the engine creates and the position it was given.
      window.pans = [];
      const create = mix.context.createStereoPanner.bind(mix.context);
      mix.context.createStereoPanner = () => { const node = create(); pans.push(node); return node; };
    };
    document.body.append(button);
  });
  await page.click('#mix-start');
  await page.waitForFunction(() => mix.context.state === 'running' && mix.musicPlaying && !mix.music.paused, null, { timeout: 15000 });

  const positional = await page.evaluate(() => {
    for (const [type, variant] of [['explosion', ''], ['hit', 'shield'], ['hit', 'hull'], ['hit', 'kinetic'], ['volley', ''], ['volley', 'boss'],
      ['blocked', 'strong'], ['blocked', 'resist'], ['barrier-break', ''], ['shield-break', ''], ['shield-online', ''], ['shot', 'pulse'], ['shot', 'lance']]) {
      mix.lastShot = mix.lastVolley = mix.lastBlock = mix.lastExplosion = -1;
      mix.effect(type, 40, variant, -.6);
    }
    mix.effect('pickup', 20, '', 0);
    return { count: pans.length, values: pans.map(node => node.pan.value) };
  });
  assert(positional.count >= 13, `Every positional cue gets its own panner (${positional.count})`);
  // Sub-bass layers sit at half width; everything else carries the event position.
  assert(positional.values.every(value => value < 0) && positional.values.some(value => Math.abs(value + .6) < 1e-6), 'Panners follow the event to the left');

  // A heavy blast ducks the soundtrack briefly and then returns it to unity.
  const duck = await page.evaluate(async () => {
    mix.effect('explosion', 140, '', 0);
    await new Promise(resolve => setTimeout(resolve, 80));
    const low = mix.musicDuck.gain.value;
    await new Promise(resolve => setTimeout(resolve, 1600));
    return { low, recovered: mix.musicDuck.gain.value };
  });
  assert(duck.low < .75, `Heavy blasts duck the music (${duck.low})`);
  assert(duck.recovered > .97, `The duck recovers (${duck.recovered})`);

  // Critical hull muffles the music and sounds the alarm; recovery restores it.
  const danger = await page.evaluate(async () => {
    const before = mix.synthVoices.size;
    mix.update(true, 0, '', 1);
    const alarm = mix.synthVoices.size - before;
    await new Promise(resolve => setTimeout(resolve, 700));
    const muffled = mix.musicFilter.frequency.value;
    mix.update(true, 0, '', 0);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return { alarm, muffled, open: mix.musicFilter.frequency.value };
  });
  assert(danger.alarm >= 2, 'The alarm plays at critical hull');
  assert(danger.muffled < 3000, `Critical hull muffles the soundtrack (${danger.muffled})`);
  assert(danger.open > 15000, `Recovered hull restores the full soundtrack (${danger.open})`);

  // Synth layers are capped even during a rampage.
  assert(await page.evaluate(() => { for (let i = 0; i < 300; i++) mix.tone(440, 440, 1, .001); return mix.synthVoices.size; }) <= 64);

  // Pause cuts reverb tails as well as voices.
  await page.evaluate(() => { mix.stopVoices(); mix.stopMusic(); mix.effect('nova', 100); mix.effect('explosion', 150, '', .4); });
  await page.waitForTimeout(120);
  assert((await rms(page)) > .001, 'Heavy cues are audible');
  await page.evaluate(() => mix.pause());
  await page.waitForTimeout(60);
  assert((await rms(page)) < .0001, 'Pause silences reverb tails immediately');
  assert.deepEqual(errors, []);
  console.log('Audio mix checks passed.');
} finally { await browser.close(); }
