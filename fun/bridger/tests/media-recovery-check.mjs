import assert from 'node:assert/strict';

export async function checkMediaRecovery(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    const errors = [], requests = new Map();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('bridger-seen-help', '1');
      window.createImageBitmap = undefined;
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
      if (asset.endsWith('.webp')) {
        const count = (requests.get(asset) || 0) + 1;
        requests.set(asset, count);
        if (count <= failures) return route.abort('connectionreset');
      }
      return route.continue();
    });
    await page.goto(`${origin}/fun/bridger/?theme=jungle#easy-browsercheck`);
    await page.locator('[data-retry]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('ready')), false,
      'An incomplete landscape stays in startup');
    await page.locator('[data-retry]').click();
    await page.waitForSelector('body.ready');
    assert.ok(await page.evaluate(async () => {
      const { image } = await import('./js/art.js');
      return image('sky-jungle') instanceof HTMLImageElement && image('sky-jungle').naturalWidth > 0;
    }), 'Browsers without ImageBitmap can play with predecoded images');
    assert.equal(requests.get('wheel-road.webp'), 2, 'A lost wheel request recovers automatically');
    assert.equal(requests.get('sky-jungle.webp'), 3, 'Startup retry recovers the missing landscape');
    assert.equal(requests.get('loco.webp'), 1, 'Retry retains other vehicles');
    assert.equal(requests.get('sky-snow.webp'), 1, 'Retry retains other worlds');
    const initial = await page.evaluate(() => window.audioAttempts);

    await page.getByRole('button', { name: 'Test the bridge' }).click();
    await page.waitForFunction(() => bridger.sim?.time > 0.6);
    assert.equal(await page.evaluate(() => window.audioAttempts), initial + 1, 'A refused audio device lets play continue without retrying each frame');
    await page.evaluate(() => { window.deviceAvailable = true; });
    await page.getByRole('button', { name: 'Stop the test' }).click();
    assert.equal(await page.evaluate(() => window.audioAttempts), initial + 2, 'A new gesture can reopen the recovered audio device');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
