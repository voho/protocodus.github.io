import assert from 'node:assert/strict';
import { chromiumOptions } from './browser-options.mjs';

assert.deepEqual(chromiumOptions({}), { channel: 'chrome', headless: true });
assert.deepEqual(chromiumOptions({ TYRAN_BROWSER: 'chromium' }), { channel: 'chromium', headless: true });
for (const origin of ['http://localhost:8773', 'http://127.0.0.1:8773', 'http://[::1]:8773']) {
  const options = chromiumOptions({ TYRAN_BROWSER: 'chromium', TYRAN_SOFTWARE_GPU: '1', TYRAN_URL: origin + '/fun/tyran/' });
  assert.equal(options.channel, 'chromium');
  assert(options.args.includes('--enable-unsafe-swiftshader'));
  assert(!options.args.includes('--disable-gpu'));
}
assert(chromiumOptions({ TYRAN_SOFTWARE_GPU: '1' }).args.length > 0);
assert.equal(chromiumOptions({ TYRAN_SOFTWARE_GPU: '0', TYRAN_URL: 'https://example.com' }).args, undefined);
for (const origin of ['https://example.com', 'http://localhost.example.com', 'http://127.0.0.1.example.com']) {
  assert.throws(() => chromiumOptions({ TYRAN_SOFTWARE_GPU: '1', TYRAN_URL: origin }), /loopback/);
}
console.log('Browser options: defaults, Chromium selection and loopback software GPU checks passed.');
