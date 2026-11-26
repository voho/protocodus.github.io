import assert from 'node:assert/strict';

export async function checkMediaRecovery(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    const errors = [], requests = new Map();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('bridger-seen-help', '1');
      const NativeContext = window.AudioContext;
      window.deviceAvailable = false;
      window.audioAttempts = 0;
      window.AudioContext = function () {
        window.audioAttempts++;
        if (!window.deviceAvailable) throw new DOMException('Audio device unavailable', 'NotSupportedError');
        return new NativeContext();
      };
    });
    await page.route('**/*', route => {
      const { pathname, origin: requestedOrigin } = new URL(route.request().url());
      if (requestedOrigin !== origin) return route.abort();
      const asset = pathname.split('/').pop();
      const failures = asset === 'sky-jungle.webp' ? 2 : asset === 'wheel-road.webp' ? 1 : 0;
      if (failures) {
        const count = (requests.get(asset) || 0) + 1;
        requests.set(asset, count);
        if (count <= failures) return route.abort('connectionreset');
      }
      return route.continue();
    });
    await page.goto(`${origin}/fun/bridger/?theme=jungle#easy-browsercheck`);
    await page.waitForFunction(() => window.bridger?.view);
    await page.evaluate(async () => {
      const { image } = await import('./js/art.js');
      window.sky = image('sky-jungle');
      window.wheel = image('wheel-road');
    });
    await page.waitForFunction(() => {
      return wheel.naturalWidth && sky.complete && !sky.naturalWidth && performance.getEntriesByName(sky.src).length === 2;
    }, null, { timeout: 8000 });
    assert.equal(requests.get('wheel-road.webp'), 2, 'A lost wheel request recovers automatically');
    // Check the actual paused scene redraws when the connection comes back.
    const before = await page.locator('#stage').evaluate(canvas => canvas.getContext('2d').getImageData(30, 100, 20, 20).data.join());
    await page.context().setOffline(true);
    await page.context().setOffline(false);
    await page.waitForFunction(old => document.querySelector('#stage').getContext('2d')
      .getImageData(30, 100, 20, 20).data.join() !== old, before, { timeout: 8000 });
    assert.equal(requests.get('sky-jungle.webp'), 3, 'Reconnecting reloads the missing landscape');

    await page.getByRole('button', { name: 'Test the bridge' }).click();
    await page.waitForFunction(() => bridger.sim?.time > 0.6);
    assert.equal(await page.evaluate(() => window.audioAttempts), 1, 'A refused audio device lets play continue without retrying each frame');
    await page.evaluate(() => { window.deviceAvailable = true; });
    await page.getByRole('button', { name: 'Stop the test' }).click();
    assert.equal(await page.evaluate(() => window.audioAttempts), 2, 'A new gesture can reopen the recovered audio device');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
