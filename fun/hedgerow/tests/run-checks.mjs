// Run the Hedgerow checks separately from the rest of the static website.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const browser = process.argv.includes('--browser');
const directory = new URL('./', import.meta.url);
const checks = (await readdir(directory)).filter(name => name.endsWith('-check.mjs') && name.endsWith('-browser-check.mjs') === browser).sort();
for (const name of checks) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(name, directory))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Hedgerow: ${checks.length} ${browser ? 'browser' : 'simulation and asset'} suites passed.`);
