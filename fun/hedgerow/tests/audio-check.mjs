// Run: node fun/hedgerow/tests/audio-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSampleBank, SOUND_SAMPLES, spatialProfile } from '../js/audio-samples.js';

const root = new URL('../assets/audio/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const shipped = [...new Set(Object.values(SOUND_SAMPLES).flat())];
assert.equal(shipped.length, manifest.assets.length, 'every shipped recording has provenance');
let bytes = 0;
for (const file of shipped) {
  const entry = manifest.assets.find(e => e.file === file);
  assert.ok(entry, `source record for ${file}`);
  assert.equal(entry.license, 'CC0-1.0');
  assert.match(await readFile(new URL(entry.licenseFile, root), 'utf8'), /CC0/);
  assert.match(entry.download, /\/([a-f\d]{40})\//, 'downloads pinned to immutable commits');
  const data = await readFile(new URL(file, root)); bytes += data.length;
  assert.equal(data.length, entry.bytes);
  assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `checksum ${file}`);
  if (file.endsWith('.wav')) {
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    assert.equal(data.readUInt16LE(22), 1, 'mono reports for stable spatial panning');
    assert.equal(data.readUInt32LE(24), 44100);
    assert.equal(data.readUInt16LE(34), 16);
    let peak = 0;
    for (let i = 44; i < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
    assert.ok(peak > 20000 && peak < 27000, `${file} audible with headroom`);
    assert.equal(data.readInt16LE(44), 0, 'attack starts without a click');
    assert.equal(data.readInt16LE(data.length - 2), 0, 'tail ends without a click');
  } else assert.equal(data.toString('ascii', 0, 4), 'OggS');
}
assert.ok(bytes < 700_000, 'compact local sound payload');

const listener = { x: 0, y: 1.7, z: 0, yaw: 0 };
const source = (x, z) => ({ x, y: 1.7, z });
assert.equal(spatialProfile(listener, source(-10, 0)).pan, 1, 'camera right (-X) sounds right');
assert.equal(spatialProfile(listener, source(10, 0)).pan, -1, 'camera left (+X) sounds left');
assert.ok(Math.abs(spatialProfile({ ...listener, yaw: Math.PI / 2 }, source(10, 0)).pan) < 1e-8, 'rotation keeps forward centered');
const near = spatialProfile(listener, source(0, 10));
const far = spatialProfile(listener, source(0, 100));
const blocked = spatialProfile(listener, source(0, 10), { occlusion: 1 });
assert.ok(near.gain > far.gain && near.cutoff > far.cutoff, 'distance attenuates and removes highs');
assert.ok(blocked.gain < near.gain && blocked.cutoff < near.cutoff * 0.15, 'wall muffles a world sound');
assert.ok(spatialProfile(listener, source(0, -10)).cutoff < near.cutoff, 'rear cues have a softer spectral signature');
assert.equal(spatialProfile(listener, source(0, 400)), null, 'outside audible range has no voice');
assert.ok(Number.isFinite(spatialProfile(listener, source(0, 0)).gain));

const played = [], active = new Set();
const ctx = {
  currentTime: 2,
  async decodeAudioData(buffer) { return buffer; },
  createGain() { return { gain: { value: 1 }, connect() { return this; }, disconnect() {} }; },
  createBufferSource() {
    const source = { playbackRate: { value: 1 }, buffer: null, onended: null,
      connect() { return { connect() {} }; }, disconnect() {},
      start(t) { assert.ok(t >= ctx.currentTime); played.push(this.buffer.file); active.add(this); },
      stop() { active.delete(this); this.onended?.(); } };
    return source;
  },
};
let requests = 0, inflight = 0, peakInflight = 0;
const bank = createSampleBank(ctx, { random: () => 0, maxVoices: 3, fetcher: async url => {
  requests++; inflight++; peakInflight = Math.max(peakInflight, inflight);
  await Promise.resolve(); inflight--;
  const file = url.pathname.split('/').at(-1);
  // A missing recording must not fail the entire preload.
  return { ok: file !== 'metalClick.ogg', status: 404, async arrayBuffer() { return { file }; } };
} });
assert.equal(bank.play('rifle', {}, 0), false, 'synthesis can play before loading');
const loading = bank.preload();
assert.equal(bank.preload(), loading, 'one shared preload');
await loading;
assert.equal(requests, shipped.length);
assert.equal(bank.status.failed, 1);
assert.equal(bank.status.loaded, shipped.length - 1);
assert.ok(peakInflight <= 4, 'bounded decode/download concurrency');
assert.equal(bank.play('click', {}, 0), false, 'missing sample falls back to synthesis');
for (let i = 0; i < 3; i++) assert.equal(bank.play('rifle', {}, 0), true);
assert.notEqual(played[0], played[1], 'successive shots use different takes');
assert.equal(played[0], played[2]);
assert.equal(bank.status.voices, 3);
assert.equal(bank.play('rifle', {}, 0), true, 'full sample budget never creates synthetic overflow');
assert.equal(played.length, 3);
bank.play('rifle', {}, 0, { priority: true });
assert.equal(played.length, 4, 'local priority sound takes oldest voice');
assert.equal(bank.status.voices, 3);
for (const source of [...active]) source.stop();
assert.equal(bank.status.voices, 0, 'ended voices leave the pool');

console.log(`audio-check: ${shipped.length} CC0 assets (${bytes} bytes); checksums, levels, spatial cues, fallback, variation and voice budget pass`);
