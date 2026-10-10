/* A twenty-line test runner, so the checks need nothing beyond Node. Each
   check file registers cases with `test`, then awaits `run`, which prints
   one line per case and exits non-zero when any of them failed. */
import assert from 'node:assert/strict';

const cases = [];
export function test(name, fn) { cases.push([name, fn]); }
export function near(actual, expected, eps, label = '') {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label} expected ${expected} ± ${eps}, got ${actual}`);
}
export function finite(values, label = '') {
  for (const v of values) assert.ok(Number.isFinite(v), `${label} not finite: ${values}`);
}
export async function run() {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (error) { failed++; console.log(`FAIL ${name}\n     ${error.message}`); }
  }
  console.log(failed ? `${failed} of ${cases.length} failed` : `${cases.length} passed`);
  if (failed) process.exit(1);
}
export { assert };
