// The reproduction commands in docs/BALANCE.md replay the recorded trials: each plays the profiles the recorded
// reports of its batch used, so adding a map profile cannot silently widen a documented batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAP_PROFILES} from '../sim.js';

const read = file => readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');

test('BALANCE.md reproduction commands play the recorded profiles', () => {
  const block = read('BALANCE.md').match(/^## Reproduce$[\s\S]*?^```sh\n([\s\S]*?)^```$/m)?.[1];
  assert.ok(block, 'BALANCE.md has a Reproduce command block');
  const commands = block.split('\n').filter(line => line.startsWith('node tests/race-balance.mjs ')).map(line => {
    const args = line.split(/\s+/), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
    // The same defaults as tests/race-balance.mjs.
    return {line, suite: option('--suite') ?? 'calibration', size: option('--size') ?? 'standard', difficulty: option('--difficulty') ?? 'hard',
      doctrines: option('--doctrines') ?? null, profiles: option('--profile')?.split(',') ?? Object.keys(MAP_PROFILES)};
  });
  assert.ok(commands.length);
  const {reports} = JSON.parse(read('balance-results.json'));
  for (const command of commands) {
    const recorded = reports.map(report => report.parameters).filter(p => p.suite === command.suite && p.size === command.size
      && p.difficulty === command.difficulty && (p.doctrines?.join(',') ?? null) === command.doctrines);
    assert.ok(recorded.length, `recorded results for: ${command.line}`);
    assert.deepEqual([...command.profiles].sort(), [...new Set(recorded.flatMap(p => p.profiles))].sort(), command.line);
  }
});
