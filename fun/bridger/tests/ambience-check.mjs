import assert from 'node:assert/strict';

/* Observe only decoded, looping recordings. Synthesized construction sounds
   can play normally without being counted as ambience. */
export async function checkAmbience(browser, origin) {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const requests = [];
  page.on('request', (request) => {
    const world = new URL(request.url()).pathname.match(/\/ambience\/([\w-]+)\.mp3$/)?.[1];
    if (world) requests.push(world);
  });
  await page.addInitScript(() => {
    const probe = window.ambienceProbe = { decoded: 0, starts: [], active: 0 };
    const buffers = new WeakMap();
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (bytes) {
      const id = ++probe.decoded;
      const hold = probe.holdNext;
      probe.holdNext = false;
      const buffer = await decode.call(this, bytes);
      buffers.set(buffer, id);
      if (hold) await new Promise((resolve) => { probe.release = resolve; });
      return buffer;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      if (!this.loop || !buffers.has(this.buffer)) return;
      probe.starts.push(buffers.get(this.buffer));
      probe.active++;
      this.addEventListener('ended', () => { probe.active--; }, { once: true });
    };
  });
  try {
    await page.goto(`${origin}/fun/bridger/#easy-audio1`);
    await page.waitForFunction(() => document.body.classList.contains('ready'));
    const initial = await page.evaluate(() => document.body.dataset.theme);
    assert.deepEqual(requests, [], 'the initial world waits for a gesture before fetching ambience');
    await page.click('[data-dialog="help"] button');
    const playing = (count) => page.waitForFunction((n) => ambienceProbe.active === n, count);
    await playing(1);
    assert.deepEqual(requests, [initial], 'unlocking fetches only the selected world');

    const sound = page.locator('[data-action="sound"]');
    await sound.click();
    await playing(0);
    const visibility = (hidden) => page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await visibility(true);
    await visibility(false);
    assert.equal(await page.evaluate(() => ambienceProbe.starts.length), 1, 'a muted tab stays silent when it becomes visible');
    await visibility(true);
    await sound.click();
    assert.equal(await page.evaluate(() => ambienceProbe.starts.length), 1, 'unmuting a hidden tab stays silent');
    await visibility(false);
    await playing(1);
    await visibility(true);
    await playing(0);
    await visibility(false);
    await playing(1);

    // Change actual mission seeds. Hold an already decoded buffer until a
    // later world is playing to exercise the race that aborting fetch cannot stop.
    await page.evaluate(() => { ambienceProbe.holdNext = true; location.hash = 'easy-audio2'; });
    await page.waitForFunction(() => !!ambienceProbe.release);
    const stale = await page.evaluate(() => ambienceProbe.decoded);
    const oldWorld = await page.evaluate(() => document.body.dataset.theme);
    await page.evaluate(() => { location.hash = 'easy-audio4'; });
    await page.waitForFunction((id) => ambienceProbe.starts.at(-1) > id, stale);
    await page.evaluate(async () => {
      ambienceProbe.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(await page.evaluate((id) => ambienceProbe.starts.includes(id), stale), false, 'late audio never starts for an abandoned world');
    await playing(1);
    const newWorld = await page.evaluate(() => document.body.dataset.theme);
    assert.deepEqual([...new Set(requests)], [initial, oldWorld, newWorld], 'world changes fetch only the visited recordings');

    await page.evaluate(async () => {
      const { THEME_IDS } = await import('./js/scenery.js');
      const decoder = new OfflineAudioContext(1, 1, 16000);
      for (const id of THEME_IDS) {
        const response = await fetch(`assets/ambience/${id}.mp3`);
        if (!response.ok) throw new Error(`Missing ${id} recording (${response.status})`);
        const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
        if (!buffer.getChannelData(0).some((sample) => Math.abs(sample) > 1 / 32768)) {
          throw new Error(`The ${id} recording is silent`);
        }
      }
    });
  } finally {
    await page.close();
  }
}
