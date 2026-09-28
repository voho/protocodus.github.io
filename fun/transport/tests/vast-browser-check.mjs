// Validate the larger default against real browser localStorage, not the user's profile.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-vast-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/');
  // Stay on the start menu: an active company would rightly autosave over the vast world on reload.
  await page.locator('#start-menu').waitFor();
  const result = await page.evaluate(async () => {
    const { createGame, saveGame, loadGame, tick, SAVE_KEY } = await import('./model.js');
    const { encodeGame } = await import('./save-codec.js');
    const { writeSaveSlot, readSaveSlot, listSaveSlots, SAVE_SLOT_PREFIX } = await import('./save-slots.js');
    const game = createGame({size:'vast'}), started = performance.now();
    tick(game, 360);
    const tickMs = performance.now() - started, saveAt = performance.now(), autosave = saveGame(game);
    const autosaveMs = performance.now() - saveAt, stored = JSON.parse(localStorage.getItem(SAVE_KEY));
    const savedAt = performance.now(), first = await writeSaveSlot(game, { name: 'Forest continent' });
    const slotMs = performance.now() - savedAt, generatedAt = performance.now(), desert = createGame({ biome: 'desert', seed: 82461, size:'vast' });
    const generateMs = performance.now() - generatedAt, second = await writeSaveSlot(desert, { name: 'Desert continent' });
    if (!autosave.ok || !first.ok || !second.ok) return { autosave, first, second };
    const fingerprint = g => {
      const normalized = { ...g, maintenanceRevision: 0, routes: g.routes.map(r => ({ ...r, pathRevision: 0 })) };
      // Restored routes list their path last; compare content, not key order.
      const value = JSON.stringify(encodeGame(normalized), (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
      let hash = 2166136261;
      for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
      return `${value.length}:${hash >>> 0}`;
    };
    const resumed = await readSaveSlot(first.id), desertResumed = await readSaveSlot(second.id);
    const matches = resumed.ok && fingerprint(resumed.game) === fingerprint(game);
    const desertMatches = desertResumed.ok && fingerprint(desertResumed.game) === fingerprint(desert);
    tick(game, 2.375); tick(resumed.game, 2.375);
    const continues = fingerprint(game) === fingerprint(resumed.game), nextAutosave = saveGame(game);
    const bytes = Object.keys(localStorage).reduce((sum, key) => sum + (key.length + localStorage.getItem(key).length) * 2, 0);
    return {
      size: game.size, dimensions: [game.width, game.height], towns: game.cities.length, industries: game.industries.length,
      autosave, first, second, matches, desertMatches, continues, nextAutosave, bytes,
      encoding: stored.tiles.encoding, slotEncoding: JSON.parse(localStorage.getItem(SAVE_SLOT_PREFIX + first.id)).encoding,
      slots: listSaveSlots().slots.length, autoLoads: !!loadGame(), generateMs, autosaveMs, slotMs, tickMs,
    };
  });
  assert.equal(result.autosave.ok, true, result.autosave.message);
  assert.equal(result.first.ok, true, result.first.message);
  assert.equal(result.second.ok, true, result.second.message);
  assert.deepEqual(result.dimensions, [768, 576]); assert.equal(result.towns, 64);
  assert.equal(result.encoding, 'utf16-15'); assert.equal(result.slotEncoding, 'gzip-utf16');
  assert.equal(result.matches, true); assert.equal(result.desertMatches, true); assert.equal(result.continues, true);
  assert.equal(result.nextAutosave.ok, true); assert.equal(result.autoLoads, true);
  assert.ok(result.bytes < 5 * 1024 * 1024, `real native storage uses ${(result.bytes / 1024 ** 2).toFixed(2)} MiB`);
  await page.reload(); await loadAutosaveFromMenu(page);
  assert.equal(await page.evaluate(() => transport.game.size), 'vast', 'reload resumes the larger world');
  const catalog = await page.evaluate(async () => (await import('./save-slots.js')).listSaveSlots());
  assert.equal(catalog.slots.length, 3); assert.ok(catalog.slots.every(slot => slot.status === 'ready'));
  await openGameAction(page, 'world-button'); await page.locator('#start-world-form').waitFor();
  assert.equal(await page.locator('#start-world-form [name="size"] option').count(), 3, 'new companies offer the three square sizes');
  assert.equal(await page.locator('#start-world-form [name="size"]').inputValue(), 'square512');
  await page.screenshot({ path: `${output}/vast-world-options.png` });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${output}/vast-company.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser-benchmark.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  console.log(`Vast browser checks passed; screenshots and benchmark: ${output}`);
} finally { await browser.close(); }
