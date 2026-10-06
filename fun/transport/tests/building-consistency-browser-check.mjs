// A repeatable real-world comparison, with current catalog coverage and shared
// physical scale. This is a visual review artifact, not an approved pixel golden.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-building-consistency-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], failures = [], profiles = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(new URL('tools/building-consistency.html', base).href);
  await page.evaluate(() => window.buildingConsistencyReady);
  for (const [zoom, filename] of [[1, 'overview.png'], [2, 'detail.png']]) {
    const profile = await page.evaluate(zoom => buildingConsistency.show(zoom), zoom);
    assert.equal(profile.flat, true, 'all terrain heights are zero');
    assert.equal(profile.immutable, true, 'the renderer leaves the world unchanged');
    assert.equal(profile.stats.heightStep, 0);
    assert.equal(profile.stats.devicePixelRatio, 1);
    assert.equal(profile.stats.worldArtwork.loading, 0);
    assert.deepEqual(profile.stats.worldArtwork.errors, []);
    for (const row of profile.rows) {
      assert.ok(row.centre.x > 0 && row.centre.x < profile.width && row.centre.y > 0 && row.centre.y < profile.height, `${row.name}: visible centre`);
      assert.equal(row.submitted, true, `${row.name}: actual sprite submitted at calibrated size`);
      for (const envelope of row.envelopes) assert.ok(envelope.x >= 0 && envelope.y >= 0 && envelope.x + envelope.width <= profile.width && envelope.y + envelope.height <= profile.height, `${row.name}: complete sprite envelope visible`);
      if (row.type === 'industry') assert.deepEqual([row.width, row.height], [5, 5]);
    }
    for (const prefix of ['isometric:bus-stop', 'isometric:train-stop', 'isometric:port-']) assert.ok(Object.keys(profile.stats.worldArtwork.rasterizedEntries).some(key => key.startsWith(prefix)), `${prefix}: authored station artwork used`);
    assert.equal(profile.stats.airports, 2, 'both airport orientations included');
    const capture = async () => Buffer.from(await page.evaluate(() => buildingConsistency.canvas.toDataURL('image/png').split(',')[1]), 'base64');
    const first = await capture();
    await page.evaluate(zoom => buildingConsistency.show(zoom), zoom);
    const second = await capture();
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(first), hash(second), 'fixed-clock rendering produces the same image twice');
    await writeFile(`${output}/${filename}`, first);
    profiles.push({ filename, zoom, width: profile.width, height: profile.height, samples: profile.samples, sha256: hash(first), rows: profile.rows, sections: profile.sections, scale: profile.scale });
  }
  assert.deepEqual(errors, [], 'no browser errors'); assert.deepEqual(failures, [], 'no missing assets');
  await writeFile(`${output}/coverage.json`, `${JSON.stringify({ profiles, errors, failures }, null, 2)}\n`);
  console.log(JSON.stringify({ output, profiles: profiles.map(({ filename, zoom, width, height, samples }) => ({ filename, zoom, width, height, samples })) }));
} finally { await browser.close(); }
