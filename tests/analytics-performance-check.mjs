// Run with: node tests/analytics-performance-check.mjs
// Exercise Web Vitals registration and delivery without contacting Google.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../assets/js/analytics-performance.js', import.meta.url), 'utf8');
const official = await readFile(new URL('../assets/vendor/web-vitals/web-vitals.js', import.meta.url), 'utf8');
const methods = ['onCLS', 'onLCP', 'onINP', 'onFCP', 'onTTFB'];
const officialExports = await import('data:text/javascript;base64,' + Buffer.from(official).toString('base64'));
for (const method of methods) assert.equal(typeof officialExports[method], 'function', `Vendored module exports ${method}`);

const settle = () => new Promise(resolve => setImmediate(resolve));
function browser(enabled, options = {}) {
  const events = [], urls = [], callbacks = {}, registrations = [];
  const listeners = new Map();
  const state = { enabled };
  const vitals = Object.fromEntries(methods.map(method => [method, callback => {
    registrations.push(method);
    callbacks[method] = callback;
  }]));
  if (options.unsupported) vitals.onINP = undefined;
  if (options.throwCollector) vitals.onCLS = () => { throw new Error('unsupported observer'); };
  const window = {
    protocodusAnalytics: {
      isEnabled: () => state.enabled,
      track: (name, fields) => events.push({ name, fields }),
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const document = { currentScript: { src: 'https://protocodus.cz/assets/js/analytics-performance.js' } };
  runInNewContext(source.replace('import(moduleUrl.href)', 'loadModule(moduleUrl.href)'), {
    window, document, URL,
    loadModule: async url => {
      urls.push(url);
      await options.load?.();
      return vitals;
    },
  });
  // Deferred enable handlers cannot depend on document.currentScript.
  document.currentScript = null;
  return {
    events, urls, callbacks, registrations, state,
    enable(value) { state.enabled = value; listeners.get('protocodus:analytics-enabled')?.(); },
  };
}

const delayed = browser(false);
await settle();
assert.equal(delayed.urls.length, 0, 'Disabled startup makes no module request');
delayed.enable(true);
delayed.enable(true);
await settle();
assert.deepEqual(delayed.urls, ['https://protocodus.cz/assets/vendor/web-vitals/web-vitals.js']);
assert.deepEqual(delayed.registrations, methods, 'Enabling later registers each metric once');
delayed.enable(true);
await settle();
assert.equal(delayed.urls.length, 1, 'Repeated enable calls do not reload collectors');

delayed.callbacks.onLCP({ name: 'LCP', value: 1234, rating: 'good', id: 'private-id', entries: [{ url: 'private-url' }] });
assert.equal(delayed.events[0].name, 'web_vital');
assert.deepEqual(JSON.parse(JSON.stringify(delayed.events[0].fields)), {
  metric_name: 'LCP', metric_value: 1234, metric_rating: 'good',
}, 'Only the three allowed metric fields are sent');
delayed.enable(false);
delayed.callbacks.onCLS({ name: 'CLS', value: 0.1, rating: 'good' });
assert.equal(delayed.events.length, 1, 'Disabled analytics suppresses later reports');
delayed.enable(true);
delayed.callbacks.onFCP({ name: 'FCP', value: 350, rating: 'good' });
assert.equal(delayed.events.length, 2, 'Re-enabling restores delivery without another registration');

let release;
const pending = browser(true, { load: () => new Promise(resolve => { release = resolve; }) });
pending.enable(false);
release();
await settle();
assert.equal(pending.registrations.length, 0, 'Disabling during import prevents collector registration');
pending.enable(true);
release();
await settle();
assert.deepEqual(pending.registrations, methods, 'A later enable recovers after a disabled import');

let fail = true;
const failed = browser(true, { load: async () => { if (fail) throw new Error('blocked module'); } });
await settle();
assert.equal(failed.registrations.length, 0, 'Failed imports do not register or report');
failed.enable(false);
assert.equal(failed.urls.length, 1, 'Disabling does not retry a failed request');
fail = false;
failed.enable(true);
await settle();
assert.deepEqual(failed.registrations, methods, 'Explicit re-enable can recover from an import failure');

const partial = browser(true, { unsupported: true, throwCollector: true });
await settle();
assert.deepEqual(partial.registrations, ['onLCP', 'onFCP', 'onTTFB'], 'Unsupported collectors do not stop the remaining metrics');

console.log('Web Vitals checks passed: official exports, enable-later loading, deduplicated collectors, minimal payload, disable/import races and failure recovery.');
