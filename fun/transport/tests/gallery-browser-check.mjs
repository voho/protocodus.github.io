import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, openGameMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-gallery';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], results = [];
try {
  for (const profile of [{ width: 1150, height: 800, density: 1 }, { width: 720, height: 800, density: 2 }, { width: 520, height: 800, density: 1 }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.density });
    let blockArt = true;
    const held = [];
    await context.route('**/*.png', route => blockArt ? held.push(route) : route.continue());
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/gallery-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="./tokens.css"><link rel="stylesheet" href="./components.css"><link rel="stylesheet" href="./dialogs.css"><link rel="stylesheet" href="./gallery.css"><style>body{background:#78934d}dialog{background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:0}#modal{inset:auto;left:8px;top:60px;margin:0}</style><dialog id="modal"><div id="modal-content"></div></dialog>' }));
    await page.goto(new URL('gallery-qa', base).href);
    await page.evaluate(async () => {
      const { mountGallery } = await import('./gallery-view.js');
      const game = { biome: 'taiga', day: 0, seed: 1847, money: 400000, routes: [], vehicles: [] };
      const modal = document.querySelector('dialog'), root = document.querySelector('#modal-content');
      window.galleryQA = { game, before: JSON.stringify(game), calls: [], mount: options => {
        modal.showModal();
        galleryQA.view = mountGallery(root, game, {
          onClose: () => { galleryQA.calls.push(['close']); modal.close(); },
          onBuild: kind => { galleryQA.calls.push(['build', kind]); modal.close(); },
          onOpenChains: selection => { galleryQA.calls.push(['chain', selection]); modal.close(); },
        }, options);
      } };
      galleryQA.mount({ entryId: 'building:house-cheap-1', category: 'homes' });
    });
    assert.equal(await page.locator('.gallery-entry').count(), 9);
    assert.ok((await page.locator('.gallery-detail').innerText()).includes('12, 24, 36'));
    await page.locator('[data-gallery-turn]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.gallery-portrait canvas').getAttribute('data-building-variant'), '1');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-gallery-turn')), true);
    await page.locator('[data-gallery-design]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.gallery-portrait canvas').getAttribute('data-building-variant'), '7');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-gallery-design')), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.gallery-portrait canvas').getAttribute('data-building-variant'), '13');
    const initialKey = await page.locator('.gallery-portrait canvas').getAttribute('data-art-drawn');
    blockArt = false; await Promise.all(held.map(route => route.continue()));
    await page.waitForFunction(key => document.querySelector('.gallery-portrait canvas')?.dataset.artDrawn !== key, initialKey);
    await page.waitForFunction(async () => (await import('./atlas-runtime.js')).worldArtStats().usable > 0);
    await page.locator('#gallery-category').selectOption('industry');
    await page.locator('#gallery-search').fill('dairy');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gallery-search', 'search updates keep the input focused');
    assert.equal(await page.locator('.gallery-entry').count(), 2);
    await page.locator('[data-gallery-entry="industry:dairy-farm"]').click();
    assert.ok((await page.locator('.gallery-detail').innerText()).includes('5 × 5 tiles'));
    assert.ok((await page.locator('.gallery-detail').innerText()).includes('2 × 2 tiles'));
    const farmPixels = await page.locator('.gallery-portrait canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let nonempty = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) nonempty++; return nonempty;
    });
    assert.ok(farmPixels > 1000 * profile.density, 'farm portrait includes its yard, fields and fences');
    await page.locator('[data-gallery-related="industry:dairy-plant"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#gallery-object-heading').innerText(), 'Dairy plant');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gallery-object-heading', 'linked object transfers keyboard focus');
    await page.locator('[data-gallery-back]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#gallery-object-heading').innerText(), 'Dairy farm');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gallery-object-heading', 'back navigation transfers keyboard focus');
    await page.locator('[data-gallery-chain]').click();
    assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
    assert.equal((await page.evaluate(() => galleryQA.calls.at(-1)))[0], 'chain');
    await page.evaluate(() => galleryQA.mount({ category: 'industry', climate: 'all', entryId: 'industry:dairy-farm' }));
    await page.locator('#gallery-climate').selectOption('tundra');
    assert.equal(await page.locator('[data-gallery-entry="industry:dairy-farm"]').count(), 0);
    await page.locator('#gallery-climate').selectOption('all');
    await page.locator('[data-gallery-entry="industry:dairy-farm"]').click();
    await page.locator('[data-gallery-build]').click();
    assert.deepEqual(await page.evaluate(() => galleryQA.calls.at(-1)), ['build', 'dairy-farm']);
    await page.evaluate(() => galleryQA.mount({ category: 'community', entryId: 'building:town-hall' }));
    await page.locator('[data-gallery-entry="building:town-hall"]').focus();
    await page.keyboard.press('ArrowUp');
    assert.notEqual(await page.evaluate(() => galleryQA.view.getSelection().entryId), 'building:town-hall');
    await page.screenshot({ path: `${output}/gallery-${profile.width}-dpr${profile.density}.png` });
    const bounds = await page.locator('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= profile.width + 1, 'dialog fits a computer window');
    assert.ok(bounds.y < 80, 'gallery aligns to the upper left');
    const overflow = await page.locator('.gallery-explorer').evaluate(root => root.scrollWidth > root.clientWidth + 1);
    assert.equal(overflow, false, 'catalog has no horizontal overflow');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => galleryQA.calls.at(-1)), ['close']);
    assert.equal(await page.evaluate(() => galleryQA.before === JSON.stringify(galleryQA.game)), true, 'viewing and preview climate do not modify company data');
    results.push({ ...profile, farmPixels, upperLeft: { x: bounds.x, y: bounds.y } });
    await context.close();
  }
  // Real navigation and callbacks: no injected world or behind-the-app mounting.
  const context = await browser.newContext({ viewport: { width: 1150, height: 800 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await createWorldFromMenu(page, { biome: 'taiga', size: 'square512', generationVersion: 10 });
  const saved = await page.evaluate(() => JSON.stringify(transport.game));
  async function openGallery() {
    const gallery = await openGameMenu(page, '#game-menu [data-open-gallery]');
    await gallery.click();
    await page.locator('.gallery-explorer').waitFor();
  }
  await openGallery();
  await page.locator('#gallery-category').selectOption('shops');
  await page.locator('#gallery-search').fill('pharmacy');
  await page.locator('[data-gallery-entry="building:shop-pharmacy"]').click();
  assert.equal(await page.locator('.gallery-recipe').count(), 0, 'pharmacy has no invented freight recipe');
  await page.locator('#gallery-category').selectOption('industry');
  await page.locator('#gallery-search').fill('dairy farm');
  await page.locator('[data-gallery-entry="industry:dairy-farm"]').click();
  await page.locator('[data-gallery-build]').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open && !document.querySelector('#active-tool-bar').hidden);
  assert.equal(await page.locator('#active-tool-name').innerText(), 'Dairy farm');
  await openGallery();
  await page.locator('#gallery-search').fill('dairy plant');
  await page.locator('[data-gallery-entry="industry:dairy-plant"]').click();
  await page.locator('[data-gallery-chain]').click();
  await page.locator('.chains-explorer').waitFor();
  assert.ok(await page.locator('[data-chain-industry="dairy-plant"]').count());
  await page.locator('#modal .close-modal').click();
  await openGallery();
  await page.locator('#gallery-category').selectOption('community');
  await page.locator('#gallery-search').fill('town hall');
  await page.locator('[data-gallery-entry="building:town-hall"]').click();
  await page.screenshot({ path: `${output}/gallery-in-game.png` });
  assert.equal(await page.evaluate(() => JSON.stringify(transport.game)), saved, 'real menu, build selection and chain navigation leave simulation and save data unchanged');
  await context.close();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log('PASS: gallery search, climate filters, household facts, farm composition, consumer/back navigation, build/chain callbacks, keyboard controls, desktop/Retina layout and read-only state.');
} finally { await browser.close(); }
