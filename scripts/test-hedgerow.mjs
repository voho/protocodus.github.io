// Keep the growing standalone game checks discoverable and run them in
// separate processes, one at a time, so full-world fixtures release memory.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = new URL('../fun/hedgerow/tests/', import.meta.url);
const arguments_ = process.argv.slice(2);
const list = arguments_.includes('--list');
const browser = arguments_.includes('--browser');
const filters = arguments_.filter(argument => argument !== '--list' && argument !== '--browser');
const checks = readdirSync(directory)
  .filter(name => {
    const browserCheck = name.endsWith('-browser-check.mjs') || name === 'terrain-textures-browser.mjs';
    return (name.endsWith('-check.mjs') || name === 'terrain-textures-browser.mjs') && browserCheck === browser
      && (!filters.length || filters.some(filter => name.includes(filter)));
  })
  .sort();
if (!checks.length) {
  console.error('No Hedgerow checks match the supplied filter.');
  process.exit(1);
}
if (list) {
  console.log(checks.join('\n'));
  process.exit(0);
}

const started = performance.now();
const failures = [];
for (const [index, name] of checks.entries()) {
  const before = performance.now();
  console.log(`[${index + 1}/${checks.length}] ${name}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(name, directory))], {
    cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  });
  const seconds = ((performance.now() - before) / 1000).toFixed(2);
  if (result.status !== 0 || result.error) {
    failures.push(name);
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error);
    console.error(`FAIL ${name} (${seconds}s)`);
  } else {
    console.log(`PASS (${seconds}s)`);
  }
}
console.log(`${checks.length - failures.length}/${checks.length} Hedgerow checks passed in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
