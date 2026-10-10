// The runner gives a browser-driven measurement tool the same Playwright module, channel and static server as
// browser checks, even when no browser check runs. A stand-in Playwright records what the tool received.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile), ashline = fileURLToPath(new URL('..', import.meta.url));

// Stops the tool at launch, after fetching a module the benchmark page imports from the served game.
const standIn = `
  import {writeFileSync} from 'node:fs';
  export const chromium = {
    executablePath: () => process.execPath,
    async launch({channel}) {
      const {ASHLINE_URL: url = null, ASHLINE_SCREENSHOTS: screenshots = null} = process.env;
      const status = url && await fetch(new URL('assets.js', url)).then(response => response.status, () => 'unreachable');
      writeFileSync(new URL('record.json', import.meta.url), JSON.stringify({url, channel, screenshots, status}));
      process.exit(0);
    },
  };`;

test('--tools runs render-benchmark against the built-in server', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'ashline-runner-'));
  t.after(() => rmSync(folder, {recursive: true, force: true}));
  writeFileSync(join(folder, 'playwright.mjs'), standIn);
  const env = {...process.env, ASHLINE_PLAYWRIGHT: pathToFileURL(join(folder, 'playwright.mjs')).href, ASHLINE_BROWSER: 'chromium'};
  delete env.ASHLINE_URL; delete env.ASHLINE_SCREENSHOTS;
  await run(process.execPath, ['tests/run-checks.mjs', '--tools', '--logs', join(folder, 'logs'), 'render-benchmark'], {cwd: ashline, env, timeout: 60000});
  const record = JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8'));
  assert.match(record.url ?? '', /^http:\/\/127\.0\.0\.1:\d+\/.*fun\/ashline\/$/, 'the tool gets the built-in server');
  assert.equal(record.status, 200, 'the server is still up while tools run');
  assert.equal(record.channel, 'chromium');
  assert.equal(record.screenshots, join(folder, 'logs', 'screenshots', 'render-benchmark'));
});

test('a suite that only sets the Playwright path for a child stays a node:test suite', async () => {
  const {stdout} = await run(process.execPath, ['tests/run-checks.mjs', '--list'], {cwd: ashline});
  const listed = kind => stdout.match(new RegExp(`^${kind} \\(\\d+\\): (.*)$`, 'm'))[1].split(', ');
  assert.ok(listed('suite').includes('run-checks.test'));
  assert.ok(listed('tool').includes('render-benchmark'));
  assert.ok(listed('browser').includes('ui-browser-check'));
});
