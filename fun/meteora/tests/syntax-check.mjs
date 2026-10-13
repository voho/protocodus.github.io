// Run with: node tests/syntax-check.mjs
// Every module parses, including the ones only the browser loads (the HUD,
// the renderer, the menus), which no other check imports.
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, run, assert } from './harness.mjs';

const root = new URL('..', import.meta.url).pathname;
const files = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.m?js$/.test(name) ? [path] : [];
});
const all = [...files(join(root, 'js')), ...files(join(root, 'tests')), ...files(join(root, 'tools')).filter(f => !f.includes('/blender/'))];

// `node --check` on a .js file can pass a module with a syntax error (it
// falls back from CommonJS without reporting it), so each file is checked
// as an .mjs copy, which is parsed as a module and nothing else.
test(`all ${all.length} modules parse`, () => {
  const bad = [];
  const dir = mkdtempSync(join(tmpdir(), 'meteora-syntax-'));
  try {
    for (const file of all) {
      const copy = join(dir, 'probe.mjs');
      copyFileSync(file, copy);
      const out = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
      if (out.status !== 0) bad.push(`${file.slice(root.length)}: ${(out.stderr.match(/SyntaxError.*/) ?? [out.stderr.trim()])[0]}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(bad, []);
});
await run();
