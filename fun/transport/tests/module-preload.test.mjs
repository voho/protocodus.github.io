import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_PRELOAD } from '../app-preload.js';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
// Static edges only: `import … from './x.js'`, `import './x.js'` and `export … from './x.js'`.
const importsOf = name => [...read(name).matchAll(/^\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"]\.\/([\w.-]+\.js)['"]/gm)].map(match => match[1]);
const graph = (entry, seen = new Set()) => { if (!seen.has(entry)) { seen.add(entry); for (const name of importsOf(entry)) graph(name, seen); } return seen; };
const sorted = list => [...list].sort();
const dependenciesFirst = (list, label) => list.forEach((name, i) => { for (const dependency of importsOf(name)) if (list.includes(dependency)) assert.ok(list.indexOf(dependency) < i, `${label}: ${dependency} is listed before ${name}`); });
const html = read('index.html'), menu = graph('start-menu.js'), app = graph('app.js');
const preloads = [...html.matchAll(/<link rel="modulepreload" href="\.\/([\w.-]+\.js)">/g)].map(match => match[1]);

test('index.html preloads the loader and the whole start menu graph, dependencies first, before boot.js', () => {
  assert.ok(menu.size > 30 && menu.has('loading-screen.js') && menu.has('model.js') && menu.has('app-preload.js'));
  assert.deepEqual(sorted(preloads), sorted(new Set([...menu, 'loading-screen.js'])));
  assert.equal(new Set(preloads).size, preloads.length, 'each module is preloaded once');
  assert.equal(preloads[0], 'loading-screen.js', 'boot.js needs the loader first');
  dependenciesFirst(preloads, 'index.html');
  assert.equal((html.match(/rel="modulepreload"/g) || []).length, preloads.length, 'every modulepreload link uses the checked form');
  assert.ok(html.lastIndexOf('rel="modulepreload"') < html.indexOf('<script type="module" src="./boot.js">'));
  assert.ok(!preloads.includes('app.js') && !preloads.includes('world-worker.js'), 'the game graph waits for the menu');
});

test('APP_PRELOAD lists exactly the game modules the start menu does not load', () => {
  const names = APP_PRELOAD.map(path => { assert.match(path, /^\.\/[\w.-]+\.js$/); return path.slice(2); });
  assert.deepEqual(sorted(names), sorted([...app].filter(name => !menu.has(name))));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.at(-1), 'app.js');
  dependenciesFirst(names, 'APP_PRELOAD');
  assert.ok(!names.includes('world-worker.js'), 'a document modulepreload never reaches the worker');
  assert.ok(names.includes('town-forecast.js'), 'the placement tip’s forecasts load with the game');
  assert.ok(Object.isFrozen(APP_PRELOAD));
});
