// Run with: node tests/music-check.mjs
// The soundtrack: every mood has a piece, every mission's own pieces exist,
// and every piece is on disk.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, run, assert } from './harness.mjs';
import { MOODS, TRACKS, trackFor } from '../js/music.js';
import { MISSIONS, SPECIAL_OPS, TRAINING } from '../js/campaign.js';
import { SURVIVAL } from '../js/missions/survival.js';

test('every mood plays a piece, and every piece is on disk', () => {
  for (const [mood, key] of Object.entries(MOODS)) assert.ok(TRACKS[key], `${mood} → ${key}`);
  for (const t of Object.values(TRACKS)) {
    const path = fileURLToPath(new URL(`../assets/music/${t.file}`, import.meta.url));
    assert.ok(existsSync(path) && statSync(path).size > 100000, t.file);
  }
});

test('a mission\'s soundtrack replaces the flight\'s moods, not the debrief\'s', () => {
  assert.equal(trackFor('combat'), 'armada');
  assert.equal(trackFor('menu'), 'sea');
  for (const mood of ['calm', 'stealth', 'tension', 'combat', 'climax']) assert.equal(trackFor(mood, 'gravity'), 'gravity');
  assert.equal(trackFor('victory', 'gravity'), 'grandeur');
  assert.equal(trackFor('climax', { climax: 'grandeur' }), 'grandeur');
  assert.equal(trackFor('combat', { climax: 'grandeur' }), 'armada');
});

test('missions name moods and pieces that exist', () => {
  for (const m of [...MISSIONS, ...SPECIAL_OPS, TRAINING, SURVIVAL]) {
    if (m.music) assert.ok(m.music in MOODS, `${m.id}: ${m.music}`);
    const s = m.soundtrack;
    if (typeof s === 'string') assert.ok(TRACKS[s], `${m.id}: ${s}`);
    else if (s) for (const [mood, key] of Object.entries(s)) assert.ok(mood in MOODS && TRACKS[key], `${m.id}: ${mood} → ${key}`);
  }
  assert.equal(SPECIAL_OPS.find(m => m.id === 'm11').soundtrack, 'gravity', 'the Well falls to its own piece');
});
await run();
